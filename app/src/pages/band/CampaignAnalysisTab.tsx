import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { del, get, post, put } from '../../api';
import { SyncButton } from '../../SyncButton';
import { Button, Card, PeriodSelect, Section, Tag } from '../../ui';
import { useBandMembers, type PeriodTabProps } from './shared';
import { CampaignTasksPanel, israelToday } from './CampaignTasksPanel';
import { AdvisorSummary, FindingCounts, FindingsList, SuggestionsList } from './AdvisorReport';
import { CampaignPlan, type SavedDraft } from './CampaignPlan';
import { AdvisorChat } from './AdvisorChat';
import { ddmm, useOpenSections, Working, type AdvisorJob } from './advisorShared';

interface Props extends PeriodTabProps {
  events: any[];
}

type JobKind = AdvisorJob['kind'];

/** How often a page that found a run already going asks whether it is done. */
const JOB_POLL_MS = 4000;

/**
 * יועץ קמפיינים — the judgement the פרסום tab deliberately does not make.
 *
 * That tab reports what each show's promotion cost. This one asks an AI agent, over an SSH
 * connection to a machine where it is already logged in, whether that was money well spent, what
 * to change, and what a campaign for the next show should look like. Nothing here writes to Meta
 * or to the books: every answer is text to read, argue with, and act on by hand.
 *
 * The page is the verdict on top and folding sections under it, each heading saying what is
 * inside, so the answer is read first and the detail opened when wanted. Everything the agent
 * answered is stored — the last analysis, every show's plan, the conversation — so a reload paints
 * it again instead of asking again, and a run still in progress when the page loaded is waited
 * for rather than started twice. Only the owner can start a run; band members read along.
 */
export function CampaignAnalysisTab({ events, period, isOwner, onError, onNotice, reload }: Props) {
  const [report, setReport] = useState<any>(null);
  const [agent, setAgent] = useState<any>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([]);
  const [draftReport, setDraftReport] = useState<any>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [brief, setBrief] = useState('');

  const [messages, setMessages] = useState<any[]>([]);
  const [question, setQuestion] = useState('');

  // Every show's tasks and owner, read by the pickers that offer a draft's or an answer's tasks:
  // who owns the show already, and whether those tasks were taken. Re-read after each add.
  const { members } = useBandMembers();
  const [taskShows, setTaskShows] = useState<any[]>([]);
  const [tasksKey, setTasksKey] = useState(0);
  useEffect(() => {
    get('/band/campaign-tasks?all=1').then((d) => setTaskShows(d.shows)).catch(() => {});
  }, [tasksKey]);
  const taskShow = (eventId: string) => taskShows.find((s) => s.event_id === eventId) ?? null;
  const tasksAdded = () => setTasksKey((k) => k + 1);

  const query = () => {
    const qs = period.params().toString();
    return qs ? `?${qs}` : '';
  };

  const loadReport = () => {
    get(`/band/campaign-analysis${query()}`)
      .then((d) => { setReport(d.report); setAgent(d.agent); })
      .catch((e) => onError(e.message));
  };
  const loadChat = () => {
    get('/band/campaign-chat').then((d) => setMessages(d.messages)).catch(() => {});
  };
  const loadDrafts = () => {
    get('/band/campaign-drafts').then((d) => setSavedDrafts(d.drafts)).catch(() => {});
  };
  useEffect(loadReport, [period.year, period.month]);
  useEffect(() => { loadChat(); loadDrafts(); }, []);

  // ---- runs: the ones this page started, and the ones it found already going

  const [localJobs, setLocalJobs] = useState<Partial<Record<JobKind, AdvisorJob>>>({});
  const [remoteJobs, setRemoteJobs] = useState<Partial<Record<JobKind, AdvisorJob>>>({});
  const jobs = { ...remoteJobs, ...localJobs };
  // The agent answers one request at a time, whatever its kind, so any run holds every button.
  const agentBusy = Object.keys(jobs).length > 0;
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const awaiting = useRef(new Set<JobKind>());
  const watched = useRef(new Set<JobKind>());

  const refresh = (kind: JobKind) => {
    if (kind === 'analysis') loadReport();
    if (kind === 'chat') loadChat();
    if (kind === 'draft') { loadDrafts(); setDraftKey((k) => k + 1); }
  };

  // Read through a ref so the poll's timer always calls the newest closure — the period may have
  // moved since it was set.
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = () => {
    get('/band/campaign-jobs').then((d) => {
      const list: AdvisorJob[] = d.jobs ?? [];
      const others = list.filter((job) => !awaiting.current.has(job.kind));
      const running = others.filter((job) => job.status === 'running');
      for (const kind of watched.current) {
        if (running.some((job) => job.kind === kind)) continue;
        const failed = others.find((job) => job.kind === kind && job.status === 'failed');
        // A failed run changed nothing, and what it was asked is handed back to try again with.
        if (!failed) refresh(kind);
        else if (kind === 'chat' && failed.message) setQuestion(failed.message);
      }
      // A run that failed while nobody was looking tells the owner once, here, and is then
      // forgotten. Band members could not have retried it, so it is not theirs to read.
      if (isOwner) {
        for (const job of others.filter((j) => j.status === 'failed')) {
          onError(`הריצה האחרונה של הסוכן נכשלה: ${job.error ?? ''}`);
          del(`/band/campaign-jobs/${job.kind}`).catch(() => {});
        }
      }
      watched.current = new Set(running.map((job) => job.kind));
      setRemoteJobs(Object.fromEntries(running.map((job) => [job.kind, job])));
    }).catch(() => {});
  };
  useEffect(() => { pollRef.current(); }, []);
  const remoteKinds = Object.keys(remoteJobs).sort().join();
  useEffect(() => {
    if (!remoteKinds) return;
    const timer = setInterval(() => pollRef.current(), JOB_POLL_MS);
    return () => clearInterval(timer);
  }, [remoteKinds]);

  /** Starts a run and holds it until it answers; its error is shown here, so the server forgets it. */
  const run = async <T,>(kind: JobKind, details: Partial<AdvisorJob>, request: () => Promise<T>): Promise<T | null> => {
    onError('');
    awaiting.current.add(kind);
    setLocalJobs((j) => ({ ...j, [kind]: { kind, status: 'running', started_at: new Date().toISOString(), ...details } }));
    try {
      return await request();
    } catch (err: any) {
      onError(err.message);
      if (isOwner) del(`/band/campaign-jobs/${kind}`).catch(() => {});
      return null;
    } finally {
      awaiting.current.delete(kind);
      setLocalJobs((j) => {
        const next = { ...j };
        delete next[kind];
        return next;
      });
    }
  };

  // ---- the plan on screen: the one in the address, else the one most recently worked on

  const today = israelToday();
  const autoPlan = [...savedDrafts]
    .sort((a, b) => Number(b.date >= today) - Number(a.date >= today) || b.created_at.localeCompare(a.created_at))[0]?.event_id ?? '';
  const draftEvent = searchParams.get('plan') ?? autoPlan;
  const setDraftEvent = (eventId: string) => {
    const next = new URLSearchParams(searchParams);
    if (eventId) next.set('plan', eventId);
    else next.delete('plan');
    setSearchParams(next, { replace: true });
  };

  // Choosing a show paints its last plan and the brief it was asked with — a plan took a minute to
  // make and should not need making again to be read, or to add its tasks a day later.
  useEffect(() => {
    if (!draftEvent) { setDraftReport(null); return; }
    let current = true;
    get(`/band/campaign-draft/${draftEvent}`).then((d) => {
      if (!current) return;
      setDraftReport(d.report);
      // Read when the plan arrives, not when it was asked for: the run in progress may have been
      // found in between, and its brief is the one being worked on.
      const job = jobsRef.current.draft;
      setBrief(job?.event_id === draftEvent ? job.brief ?? '' : d.report?.request?.brief ?? '');
    }).catch(() => {});
    return () => { current = false; };
  }, [draftEvent, draftKey]);

  // A plan still being drafted when the page loaded is shown for the show it is for.
  useEffect(() => {
    const job = remoteJobs.draft;
    if (!job?.event_id) return;
    if (job.event_id !== draftEvent) setDraftEvent(job.event_id);
    setBrief(job.brief ?? '');
    sections.set('plan', true);
  }, [remoteJobs.draft?.started_at]);

  useEffect(() => {
    if (remoteJobs.chat) sections.set('chat', true);
  }, [remoteJobs.chat?.started_at]);

  // ---- actions

  const analyze = async () => {
    const d = await run('analysis', {}, () => post(`/band/campaign-analysis${query()}`));
    if (d) setReport(d.report);
  };

  const makeDraft = async () => {
    if (!draftEvent) return;
    const eventId = draftEvent;
    if (!searchParams.get('plan')) setDraftEvent(eventId);
    const d = await run('draft', { event_id: eventId, brief }, () => post('/band/campaign-draft', { event_id: eventId, brief }));
    if (d) {
      setDraftReport(d.report);
      loadDrafts();
    }
  };

  const chooseCreative = (field: 'headline' | 'description', value: string) => {
    if (!draftReport) return;
    const id = draftReport.id;
    setDraftReport((r: any) => ({ ...r, response: { ...r.response, creative: { ...r.response.creative, [field]: value } } }));
    put(`/band/campaign-draft/${id}/creative`, { field, value })
      .catch((err) => { onError(err.message); setDraftKey((k) => k + 1); });
  };

  const send = async () => {
    const text = question.trim();
    if (!text) return;
    setQuestion('');
    const d = await run('chat', { message: text }, () => post(`/band/campaign-chat${query()}`, { message: text }));
    if (d) setMessages(d.messages);
    // Hands the question back rather than losing what was typed to a failed round trip.
    else setQuestion(text);
  };

  const clearThread = async () => {
    if (!confirm('למחוק את היסטוריית השיחה?')) return;
    try {
      await del('/band/campaign-chat');
      setMessages([]);
    } catch (err: any) { onError(err.message); }
  };

  // ---- what each folding section says about itself

  const answer = report?.response;
  const findings: any[] = answer?.findings ?? [];
  const suggestions: any[] = answer?.suggestions ?? [];
  const openTasks = taskShows.flatMap((s) => s.tasks ?? []).filter((t: any) => !t.done_at);
  const lateTasks = openTasks.filter((t: any) => t.due_date < today).length;
  const todayTasks = openTasks.filter((t: any) => t.due_date === today).length;
  const planLabel = savedDrafts.find((d) => d.event_id === draftEvent)?.label;

  const sections = useOpenSections({
    findings: findings.some((f) => f?.severity === 'high'),
    suggestions: false,
    plan: !!searchParams.get('plan') || !!jobs.draft,
    tasks: lateTasks + todayTasks > 0,
    chat: !!jobs.chat,
  });

  const showSuggestion = (index: number) => {
    sections.set('suggestions', true);
    // After the section has opened and rendered its list.
    setTimeout(() => document.getElementById(`advisor-suggestion-${index}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const tasksPanel = (bare: boolean) => (
    <CampaignTasksPanel events={events} isOwner={isOwner} onError={onError} reloadKey={tasksKey} bare={bare} />
  );

  // The advisor is useless without the connection, and saying which half is missing beats a
  // button that fails when pressed. The tasks do not need it, so they stay.
  if (agent && !agent.configured) {
    return (
      <div className="space-y-3">
        {tasksPanel(false)}
        <Card>
          <h2 className="ser text-lg mb-2">יועץ קמפיינים</h2>
          <p className="text-sm text-muted leading-relaxed">
            הסוכן לא מוגדר. הניתוח רץ על מכונה אחרת דרך חיבור SSH — יש למלא את השרת, המשתמש,
            המפתח הפרטי ומפתח המארח ב<span className="text-ink-2">הגדרות → סוכן AI</span>,
            ולבדוק את החיבור שם.
          </p>
        </Card>
      </div>
    );
  }

  const header = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="ser text-xl">יועץ קמפיינים</h2>
          <PeriodSelect year={period.year} month={period.month}
            onYearChange={period.setYear} onMonthChange={period.setMonth} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => sections.setAll(!sections.allOpen)}
            className="text-xs text-accent hover:underline">
            {sections.allOpen ? 'סגירת הכל' : 'פתיחת הכל'}
          </button>
          {/* The advisor reads whatever the last pull left behind, so a fresh pull sits beside it. */}
          <SyncButton service="meta" onError={onError} onDone={onNotice} reload={reload} />
          {jobs.analysis
            ? <Working text="הסוכן מנתח" since={jobs.analysis.started_at} />
            : isOwner && <Button onClick={analyze} disabled={agentBusy}>{report ? 'רענון ניתוח' : 'ניתוח קמפיינים'}</Button>}
        </div>
      </div>
      {!report && !jobs.analysis && (
        <p className="text-sm text-faint">
          {isOwner
            ? 'עוד לא נעשה ניתוח לתקופה הזו — «ניתוח קמפיינים» יבקש מהסוכן לעבור על הנתונים'
            : 'עוד לא נעשה ניתוח לתקופה הזו'}
        </p>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      <AdvisorSummary report={report} events={events} header={header} onFirstStep={() => showSuggestion(0)} />

      {findings.length > 0 && (
        <Section title="ממצאים" open={sections.isOpen('findings')} onToggle={() => sections.toggle('findings')}
          summary={<FindingCounts findings={findings} />}>
          <FindingsList findings={findings} suggestions={suggestions} events={events} onShowSuggestion={showSuggestion} />
        </Section>
      )}

      {suggestions.length > 0 && (
        <Section title="המלצות" open={sections.isOpen('suggestions')} onToggle={() => sections.toggle('suggestions')}
          summary={<Tag tone="accent">{suggestions.length} המלצות</Tag>}>
          <SuggestionsList suggestions={suggestions} findings={findings} />
        </Section>
      )}

      <Section title="תוכנית קמפיין" open={sections.isOpen('plan')} onToggle={() => sections.toggle('plan')}
        summary={jobs.draft
          ? <Tag tone="accent">הסוכן בונה תוכנית…</Tag>
          : planLabel
            ? <Tag>{planLabel}</Tag>
            : savedDrafts.length === 0 && <Tag>עוד אין תוכניות</Tag>}>
        <CampaignPlan
          events={events}
          isOwner={isOwner}
          savedDrafts={savedDrafts}
          eventId={draftEvent}
          onEventChange={setDraftEvent}
          report={draftReport?.event_id === draftEvent ? draftReport : null}
          brief={brief}
          onBriefChange={setBrief}
          job={jobs.draft}
          agentBusy={agentBusy}
          onBuild={makeDraft}
          onChoose={chooseCreative}
          members={members}
          taskShow={taskShow}
          onTasksAdded={tasksAdded}
          onError={onError}
        />
      </Section>

      <Section title="משימות קמפיין" open={sections.isOpen('tasks')} onToggle={() => sections.toggle('tasks')}
        summary={<>
          <Tag>{openTasks.length ? `${openTasks.length} פתוחות` : 'אין משימות פתוחות'}</Tag>
          {lateTasks > 0 && <Tag tone="neg">{lateTasks} באיחור</Tag>}
          {todayTasks > 0 && <Tag tone="accent">{todayTasks} להיום</Tag>}
          {!lateTasks && !todayTasks && openTasks.length > 0 && (
            <Tag>הבאה ב-{ddmm([...openTasks].sort((a, b) => a.due_date.localeCompare(b.due_date))[0].due_date)}</Tag>
          )}
        </>}>
        {tasksPanel(true)}
      </Section>

      <Section title="שאלות המשך" open={sections.isOpen('chat')} onToggle={() => sections.toggle('chat')}
        summary={jobs.chat
          ? <Tag tone="accent">הסוכן חושב…</Tag>
          : messages.length > 0 && <Tag>{messages.length} הודעות</Tag>}
        actions={isOwner && messages.length > 0 && sections.isOpen('chat') && (
          <button onClick={clearThread} className="text-xs text-neg hover:underline">ניקוי השיחה</button>
        )}>
        <AdvisorChat
          messages={messages}
          events={events}
          isOwner={isOwner}
          question={question}
          onQuestionChange={setQuestion}
          onSend={send}
          job={jobs.chat}
          agentBusy={agentBusy}
          members={members}
          taskShow={taskShow}
          onTasksAdded={tasksAdded}
          onError={onError}
        />
      </Section>
    </div>
  );
}
