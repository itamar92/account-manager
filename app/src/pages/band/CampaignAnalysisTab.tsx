import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { del, get, post, put } from '../../api';
import { SyncButton } from '../../SyncButton';
import { Card } from '../../ui';
import { useBandMembers, type PeriodTabProps } from './shared';
import { CampaignTasksPanel, israelToday } from './CampaignTasksPanel';
import { PeriodAnalysis } from './AdvisorReport';
import { CampaignPlan } from './CampaignPlan';
import { AdvisorChat } from './AdvisorChat';
import { CampaignReview } from './CampaignReview';
import { JOB_TEXT, useConfirm, ViewTabs, Working, type AdvisorJob } from './advisorShared';
import { ActionsLog } from './MetaActions';
import { PixelPanel } from './PixelPanel';
import { ShowHero, ShowStrip, type ShowSummary } from './ShowStrip';

interface Props extends PeriodTabProps {
  events: any[];
}

type JobKind = AdvisorJob['kind'];
type ShowView = 'status' | 'plan' | 'tasks';
type Panel = 'analysis' | 'chat' | 'tasks' | 'meta';

/** How often a page that found a run already going asks whether it is done. */
const JOB_POLL_MS = 4000;

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/**
 * יועץ קמפיינים — the judgement the פרסום tab deliberately does not make.
 *
 * That tab reports what each show's promotion cost. This one asks an AI agent, over an SSH
 * connection to a machine where it is already logged in, whether that was money well spent, what
 * to change, and what a campaign for the next show should look like. Nothing the agent says writes
 * to Meta or to the books: an answer is text to read and argue with, and a change it proposes that
 * one click can make is offered behind a preview read live from Meta, carried out only when the
 * owner confirms it (`MetaActions.tsx`).
 *
 * The page is built around the show, because that is what a visit is about: is the campaign for
 * the next show working, and what should the next one look like. A strip of the shows still ahead
 * is the one show picker; the chosen show opens below it with its figures on the dark slab and
 * three views — its campaign's status, its plan, its tasks. Whatever is about the whole account
 * (the period's verdict, the conversation, every task, the pixel and the log of changes in Meta)
 * sits in one card under it.
 *
 * Everything the agent answered is stored, so a reload paints it again instead of asking again,
 * and a run still in progress when the page loaded is waited for rather than started twice. Only
 * the owner can start a run; band members read along.
 */
export function CampaignAnalysisTab({ events, period, isOwner, onError, onNotice, reload }: Props) {
  const [report, setReport] = useState<any>(null);
  const [agent, setAgent] = useState<any>(null);
  const [shows, setShows] = useState<ShowSummary[] | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const [draftReport, setDraftReport] = useState<any>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [brief, setBrief] = useState('');
  const [reviewKey, setReviewKey] = useState(0);
  const { ask, dialog } = useConfirm();

  // Bumped when a change was carried out in Meta, so the log of actions re-reads.
  const [actionsKey, setActionsKey] = useState(0);
  const actionDone = () => setActionsKey((k) => k + 1);

  const [messages, setMessages] = useState<any[]>([]);
  const [question, setQuestion] = useState('');

  // Why each kind of run last failed, said beside the button that started it.
  const [failures, setFailures] = useState<Partial<Record<JobKind, string>>>({});
  const fail = (kind: JobKind, message: string) => setFailures((f) => ({ ...f, [kind]: message }));
  const dismiss = (kind: JobKind) => setFailures((f) => { const next = { ...f }; delete next[kind]; return next; });

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
  const loadShows = () => {
    get('/band/campaign-shows').then((d) => setShows(d.shows)).catch((e) => { setShows([]); onError(e.message); });
  };
  useEffect(loadReport, [period.year, period.month]);
  useEffect(() => { loadChat(); loadShows(); }, []);

  // ---- runs: the ones this page started, and the ones it found already going

  const [localJobs, setLocalJobs] = useState<Partial<Record<JobKind, AdvisorJob>>>({});
  const [remoteJobs, setRemoteJobs] = useState<Partial<Record<JobKind, AdvisorJob>>>({});
  const jobs = { ...remoteJobs, ...localJobs };
  // The agent answers one request at a time, whatever its kind, so any run holds every button.
  const agentBusy = Object.keys(jobs).length > 0;
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const awaiting = useRef(new Set<JobKind>());
  const watched = useRef(new Map<JobKind, AdvisorJob>());

  const showLabel = (eventId?: string) => (eventId ? shows?.find((s) => s.event_id === eventId)?.label : undefined);

  /** Says a finished run out loud, so an owner who went to read something else hears it is done. */
  const announce = (kind: JobKind, eventId?: string) => {
    const label = showLabel(eventId);
    onNotice(`${JOB_TEXT[kind].done}${label ? ` · ${label}` : ''}`);
  };

  const refresh = (kind: JobKind) => {
    if (kind === 'analysis') loadReport();
    if (kind === 'chat') loadChat();
    if (kind === 'draft') setDraftKey((k) => k + 1);
    if (kind === 'review' || kind === 'tickets') setReviewKey((k) => k + 1);
    if (kind !== 'chat' && kind !== 'analysis') loadShows();
  };

  // Read through a ref so the poll's timer always calls the newest closure — the period may have
  // moved since it was set.
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = () => {
    get('/band/campaign-jobs').then((d) => {
      const list: AdvisorJob[] = d.jobs ?? [];
      const others = list.filter((job) => !awaiting.current.has(job.kind));
      const running = others.filter((job) => job.status === 'running');
      for (const [kind, job] of watched.current) {
        if (running.some((r) => r.kind === kind)) continue;
        const failed = others.find((j) => j.kind === kind && j.status === 'failed');
        // A failed run changed nothing, and what it was asked is handed back to try again with.
        if (!failed) { refresh(kind); announce(kind, job.event_id); }
        else if (kind === 'chat' && failed.message) setQuestion(failed.message);
      }
      // A run that failed while nobody was looking tells the owner once, beside its button, and
      // is then forgotten. Band members could not have retried it, so it is not theirs to read.
      if (isOwner) {
        for (const job of others.filter((j) => j.status === 'failed')) {
          fail(job.kind, `הריצה האחרונה של הסוכן נכשלה: ${job.error ?? ''}`);
          del(`/band/campaign-jobs/${job.kind}`).catch(() => {});
        }
      }
      watched.current = new Map(running.map((job) => [job.kind, job]));
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

  /**
   * Starts a run and holds it until it answers; its error is shown beside its button, so the
   * server forgets it. Null is a run that failed; undefined one still working after its request
   * was cut, whose answer the poll will paint.
   */
  const run = async <T,>(kind: JobKind, details: Partial<AdvisorJob>, request: () => Promise<T>): Promise<T | null | undefined> => {
    dismiss(kind);
    awaiting.current.add(kind);
    setLocalJobs((j) => ({ ...j, [kind]: { kind, status: 'running', started_at: new Date().toISOString(), ...details } }));
    try {
      const result = await request();
      announce(kind, details.event_id);
      return result;
    } catch (err: any) {
      // Cloudflare answers a request still open after 100 s with a 524 while the run goes on — a
      // run that looks things up in Meta can take that long. The server knows whether it is still
      // working, so ask it before calling this a failure, and wait for the answer the way a reload
      // would.
      const list: AdvisorJob[] = await get('/band/campaign-jobs').then((d) => d.jobs ?? []).catch(() => []);
      if (list.some((job) => job.kind === kind && job.status === 'running')) {
        awaiting.current.delete(kind);
        pollRef.current();
        return undefined;
      }
      fail(kind, `${err.message}. אפשר לנסות שוב.`);
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

  // ---- the show on screen: the one in the address, else the one a run is busy with, else the
  // nearest show whose campaign has started, else the nearest show

  const today = israelToday();
  const runningShow = Object.values(jobs).find((job) => job?.event_id)?.event_id;
  const ahead = (shows ?? []).filter((s) => s.days_left >= 0);
  const autoShow = runningShow
    ?? ahead.find((s) => s.review || s.tickets || s.spend || s.plan)?.event_id
    ?? ahead[0]?.event_id
    ?? shows?.[0]?.event_id
    ?? '';
  // `plan` is the address the tab used to keep; links saved with it still open the right show.
  const showId = searchParams.get('show') ?? searchParams.get('plan') ?? autoShow;
  const show = shows?.find((s) => s.event_id === showId) ?? null;

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    next.delete('plan');
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };
  const selectShow = (eventId: string) => setParams({ show: eventId, view: null });

  // A show whose campaign is under way opens on its status; one without a plan yet, on its plan.
  const defaultView = (s: ShowSummary | null): ShowView => {
    if (!s) return 'plan';
    if (jobs.draft?.event_id === s.event_id) return 'plan';
    if ((jobs.review ?? jobs.tickets)?.event_id === s.event_id) return 'status';
    const started = s.review || s.tickets || s.spend || (s.plan?.start && s.plan.start <= today);
    return started ? 'status' : 'plan';
  };
  const viewParam = searchParams.get('view') as ShowView | null;
  const view: ShowView = viewParam && ['status', 'plan', 'tasks'].includes(viewParam) ? viewParam : defaultView(show);
  const panelParam = searchParams.get('panel') as Panel | null;
  const panel: Panel = panelParam && ['analysis', 'chat', 'tasks', 'meta'].includes(panelParam) ? panelParam : 'analysis';

  // Choosing a show paints its last plan and the brief it was asked with — a plan took a minute to
  // make and should not need making again to be read, or to add its tasks a day later.
  useEffect(() => {
    if (!showId) { setDraftReport(null); return; }
    let current = true;
    get(`/band/campaign-draft/${showId}`).then((d) => {
      if (!current) return;
      setDraftReport(d.report);
      // Read when the plan arrives, not when it was asked for: the run in progress may have been
      // found in between, and its brief is the one being worked on.
      const job = jobsRef.current.draft;
      setBrief(job?.event_id === showId ? job.brief ?? '' : d.report?.request?.brief ?? '');
    }).catch(() => {});
    return () => { current = false; };
  }, [showId, draftKey]);

  // A run still going when the page loaded is shown where its answer will land.
  useEffect(() => {
    const job = remoteJobs.draft;
    if (!job?.event_id) return;
    setParams({ show: job.event_id, view: 'plan' });
    setBrief(job.brief ?? '');
  }, [remoteJobs.draft?.started_at]);
  const remoteShowJob = remoteJobs.review ?? remoteJobs.tickets;
  useEffect(() => {
    if (!remoteShowJob?.event_id) return;
    setParams({ show: remoteShowJob.event_id, view: 'status' });
  }, [remoteShowJob?.started_at]);
  useEffect(() => {
    if (remoteJobs.chat) setParams({ panel: 'chat' });
  }, [remoteJobs.chat?.started_at]);

  // ---- actions

  const analyze = async () => {
    const d = await run('analysis', {}, () => post(`/band/campaign-analysis${query()}`));
    if (d) setReport(d.report);
  };

  const clearReport = async () => {
    if (!(await ask('מחיקת הסיכום', 'למחוק את הסיכום של התקופה הזו? אפשר לבקש ניתוח חדש בכל רגע.', 'מחיקה'))) return;
    try {
      await del(`/band/campaign-analysis${query()}`);
      setReport(null);
    } catch (err: any) { onError(err.message); }
  };

  /** Starts the chosen show over: its plans and reviews, and its tasks if asked. */
  const resetShow = async (withTasks: boolean) => {
    if (!showId) return;
    onError('');
    try {
      await del(`/band/campaign-draft/${showId}${withTasks ? '?tasks=1' : ''}`);
      setDraftReport(null);
      setBrief('');
      loadShows();
      setReviewKey((k) => k + 1);
      if (withTasks) tasksAdded();
    } catch (err: any) { onError(err.message); }
  };

  const review = async (note: string, checkTickets: boolean) => {
    if (!showId) return;
    const eventId = showId;
    const d = await run('review', { event_id: eventId, message: note },
      () => post('/band/campaign-review', { event_id: eventId, note, check_tickets: checkTickets }));
    if (d) {
      setReviewKey((k) => k + 1);
      loadShows();
      if (d.ticket_error) fail('tickets', `בדיקת הכרטיסים נכשלה, והמצב נבדק בלעדיה: ${d.ticket_error}`);
    }
  };

  const checkTickets = async (note: string) => {
    if (!showId) return;
    const eventId = showId;
    const d = await run('tickets', { event_id: eventId, message: note },
      () => post('/band/ticket-check', { event_id: eventId, note }));
    if (d) { setReviewKey((k) => k + 1); loadShows(); }
  };

  const makeDraft = async () => {
    if (!showId) return;
    const eventId = showId;
    const d = await run('draft', { event_id: eventId, brief }, () => post('/band/campaign-draft', { event_id: eventId, brief }));
    if (d) {
      setDraftReport(d.report);
      loadShows();
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
    else if (d === null) setQuestion(text);
  };

  const clearThread = async () => {
    if (!(await ask('מחיקת השיחה', 'למחוק את כל השאלות והתשובות? אי אפשר לשחזר אותן.', 'מחיקה'))) return;
    try {
      await del('/band/campaign-chat');
      setMessages([]);
    } catch (err: any) { onError(err.message); }
  };

  const toggleTask = async (task: any) => {
    try {
      await put(`/band/campaign-tasks/${task.id}`, { done: !task.done_at });
      tasksAdded();
    } catch (err: any) { onError(err.message); }
  };

  // ---- what the counts on the page say

  const openTasks = taskShows.flatMap((s) => (s.tasks ?? []).map((t: any) => ({ ...t, show_label: s.label }))).filter((t: any) => !t.done_at);
  const dueNow = openTasks.filter((t: any) => t.due_date <= today).sort((a: any, b: any) => a.due_date.localeCompare(b.due_date));
  const lateByShow = (eventId: string) => openTasks.filter((t: any) => t.event_id === eventId && t.due_date < today).length;
  const showOpenTasks = openTasks.filter((t: any) => t.event_id === showId);
  const showLate = lateByShow(showId);
  const periodLabel = period.year === '' ? 'כל השנים' : period.month === '' ? `${period.year}` : `${MONTHS[Number(period.month) - 1]} ${period.year}`;
  const runningJob = (Object.values(jobs) as AdvisorJob[]).find(Boolean);
  const showWorking = !!showId && runningShow === showId;

  // The advisor is useless without the connection, and saying which half is missing beats a
  // button that fails when pressed. The tasks and the pixel do not need it, so they stay: the
  // pixel panel reads Meta directly, and asking the clubs to install it can start before the
  // agent is set up.
  if (agent && !agent.configured) {
    return (
      <div className="space-y-4">
        <Card>
          <h1 className="ser text-2xl mb-2">יועץ קמפיינים</h1>
          <p className="text-sm text-body leading-relaxed max-w-[70ch]">
            הסוכן עוד לא מחובר. הניתוח רץ על מכונה אחרת דרך חיבור SSH: צריך למלא את השרת, המשתמש,
            המפתח הפרטי ומפתח המארח ב<span className="text-ink font-medium">הגדרות ← סוכן AI</span>,
            ולבדוק שם את החיבור. בינתיים אפשר לעבוד עם המשימות ועם הפיקסל.
          </p>
        </Card>
        <Card>
          <h2 className="ser text-lg mb-3">משימות קמפיין</h2>
          <CampaignTasksPanel events={events} isOwner={isOwner} onError={onError} reloadKey={tasksKey} onChanged={tasksAdded} />
        </Card>
        <Card>
          <h2 className="ser text-lg mb-3">פיקסל ומעקב מכירות</h2>
          <PixelPanel isOwner={isOwner} onError={onError} onChanged={actionDone} />
        </Card>
        <Card>
          <h2 className="ser text-lg mb-3">שינויים שנעשו ב-Meta</h2>
          <ActionsLog reloadKey={actionsKey} />
        </Card>
      </div>
    );
  }

  const tasksBadge = (count: number, late: number) => count > 0 && (
    <span className={clsx('num rounded-full px-1.5 min-w-5 text-center text-[11px] font-bold leading-5',
      late > 0 ? 'bg-neg-soft text-neg-ink' : 'bg-soft text-muted')}>{count}</span>
  );

  return (
    <div className="space-y-5">
      {/* ---- title, and the one place that says the agent is busy and with what */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ser text-2xl md:text-3xl">יועץ קמפיינים</h1>
            <p className="mt-1 text-sm md:text-[15px] text-body">
              {shows && shows.length > 0 ? 'בחרו הופעה כדי לראות איך הקמפיין שלה מתקדם, או לבנות לה תוכנית.' : 'תוכניות, בדיקות מצב והמלצות לקמפיינים של ההופעות.'}
            </p>
          </div>
          {/* The advisor reads whatever the last pull left behind, so a fresh pull sits beside it. */}
          <SyncButton service="meta" onError={onError} onDone={(m) => { onNotice(m); loadShows(); }} reload={reload} />
        </div>
        {runningJob && (
          <div className="sticky top-[65px] z-20 rounded-xl border border-accent/20 bg-accent-soft/95 backdrop-blur px-3.5 py-2.5 space-y-0.5">
            <Working text={`הסוכן ${JOB_TEXT[runningJob.kind].doing}${showLabel(runningJob.event_id) ? ` · ${showLabel(runningJob.event_id)}` : ''}`}
              since={runningJob.started_at} />
            <p className="text-xs text-muted">אפשר להמשיך לעבוד בינתיים. הסוכן עונה על בקשה אחת בכל פעם, אז בקשות חדשות יחכו עד שיסיים.</p>
          </div>
        )}
      </header>

      {/* ---- the shows ahead: the one show picker on the page */}
      <section aria-labelledby="shows-heading" className="space-y-2.5">
        <h2 id="shows-heading" className="text-sm font-semibold text-muted">ההופעות הקרובות</h2>
        {shows === null
          ? <div className="h-[9.5rem] rounded-2xl bg-surface border border-line animate-pulse motion-reduce:animate-none" aria-label="טוען הופעות" />
          : <ShowStrip shows={shows} selected={showId} onSelect={selectShow} workingOn={runningShow} lateByShow={lateByShow} />}
      </section>

      {/* ---- what is due: only late and today's tasks, ticked here without opening anything */}
      {dueNow.length > 0 && (
        <section aria-labelledby="due-heading" className="rounded-2xl border border-line bg-surface px-4 py-3">
          <h2 id="due-heading" className="text-sm font-semibold text-ink mb-1">לטיפול היום</h2>
          <ul className="divide-y divide-line">
            {dueNow.slice(0, 5).map((task: any) => {
              const late = task.due_date < today;
              const days = Math.round((Date.parse(today) - Date.parse(task.due_date)) / 86_400_000);
              return (
                <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                  <label className="flex flex-1 min-w-[12rem] items-center gap-3 min-h-10 cursor-pointer">
                    <input type="checkbox" className="accent-accent w-[18px] h-[18px] shrink-0" checked={false}
                      onChange={() => toggleTask(task)} />
                    <span className="text-[15px] text-ink">{task.title}</span>
                  </label>
                  <button type="button" onClick={() => setParams({ show: task.event_id, view: 'tasks' })}
                    className="text-sm text-accent-ink hover:underline min-h-10 ps-[30px] sm:ps-0">{task.show_label}</button>
                  <span className={clsx('text-xs font-semibold', late ? 'text-neg-ink' : 'text-accent-ink')}>
                    {late ? `באיחור ${days === 1 ? 'של יום' : `של ${days} ימים`}` : 'היום'}
                  </span>
                </li>
              );
            })}
          </ul>
          {dueNow.length > 5 && (
            <button type="button" onClick={() => setParams({ panel: 'tasks' })} className="mt-1 min-h-10 text-sm text-accent-ink hover:underline">
              ועוד {dueNow.length - 5} משימות
            </button>
          )}
        </section>
      )}

      {/* ---- the chosen show */}
      {show && (
        <section aria-label={show.label} key={show.event_id}
          className="settle-in rounded-2xl border border-line bg-surface overflow-hidden">
          <ShowHero show={show} working={showWorking} />
          <ViewTabs label="מה להציג על ההופעה" className="px-2 md:px-3" value={view}
            onChange={(v) => setParams({ view: v })}
            options={[
              { value: 'status', label: 'מצב הקמפיין' },
              { value: 'plan', label: show.plan ? 'התוכנית' : 'תוכנית' },
              { value: 'tasks', label: 'משימות', badge: tasksBadge(showOpenTasks.length, showLate) },
            ]} />
          <div key={view} className="settle-in p-4 md:p-6">
            {view === 'status' && (
              <CampaignReview
                events={events}
                isOwner={isOwner}
                eventId={showId}
                reloadKey={reviewKey}
                reviewJob={jobs.review}
                ticketJob={jobs.tickets}
                agentBusy={agentBusy}
                reviewFailure={failures.review}
                ticketFailure={failures.tickets}
                onDismissFailure={dismiss}
                onReview={review}
                onCheckTickets={checkTickets}
                members={members}
                taskShow={taskShow}
                onTasksAdded={tasksAdded}
                onActionDone={actionDone}
                onError={onError}
              />
            )}
            {view === 'plan' && (
              <CampaignPlan
                events={events}
                isOwner={isOwner}
                eventId={showId}
                report={draftReport?.event_id === showId ? draftReport : null}
                brief={brief}
                onBriefChange={setBrief}
                job={jobs.draft?.event_id === showId ? jobs.draft : undefined}
                agentBusy={agentBusy}
                failure={failures.draft}
                onDismissFailure={() => dismiss('draft')}
                onBuild={makeDraft}
                onChoose={chooseCreative}
                members={members}
                taskShow={taskShow}
                onTasksAdded={tasksAdded}
                onReset={resetShow}
                onError={onError}
              />
            )}
            {view === 'tasks' && (
              <CampaignTasksPanel events={events} isOwner={isOwner} onError={onError} reloadKey={tasksKey}
                eventId={showId} onChanged={tasksAdded} />
            )}
          </div>
        </section>
      )}
      {shows && shows.length > 0 && !show && showId && (
        <p className="text-sm text-body">ההופעה שבכתובת כבר לא ברשימת ההופעות הקרובות. בחרו הופעה מהרשימה.</p>
      )}

      {/* ---- the whole account: the period's verdict, the conversation, every task, pixel and log */}
      <section aria-labelledby="overview-heading" className="rounded-2xl border border-line bg-surface overflow-hidden">
        <div className="px-4 md:px-6 pt-4">
          <h2 id="overview-heading" className="ser text-lg">כל הקמפיינים</h2>
        </div>
        <ViewTabs label="מבט על כל הקמפיינים" className="px-2 md:px-3 mt-1" value={panel}
          onChange={(p) => setParams({ panel: p === 'analysis' ? null : p })}
          options={[
            { value: 'analysis', label: 'סיכום תקופה' },
            { value: 'chat', label: 'שאלות לסוכן', badge: messages.length > 0 && <span className="num text-[11px] text-muted">{messages.length}</span> },
            { value: 'tasks', label: 'כל המשימות', badge: tasksBadge(openTasks.length, dueNow.filter((t: any) => t.due_date < today).length) },
            { value: 'meta', label: 'פיקסל ושינויים ב-Meta' },
          ]} />
        <div key={panel} className="settle-in p-4 md:p-6">
          {panel === 'analysis' && (
            <PeriodAnalysis report={report} events={events} period={period} isOwner={isOwner}
              job={jobs.analysis} agentBusy={agentBusy} failure={failures.analysis} onDismissFailure={() => dismiss('analysis')}
              onAnalyze={analyze} onClear={clearReport} onActionDone={actionDone} />
          )}
          {panel === 'chat' && (
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
              onActionDone={actionDone}
              onError={onError}
              failure={failures.chat}
              onDismissFailure={() => dismiss('chat')}
              periodLabel={periodLabel}
              onClear={clearThread}
            />
          )}
          {panel === 'tasks' && (
            <CampaignTasksPanel events={events} isOwner={isOwner} onError={onError} reloadKey={tasksKey} onChanged={tasksAdded} />
          )}
          {panel === 'meta' && (
            <div className="space-y-8">
              <section aria-labelledby="pixel-heading">
                <h3 id="pixel-heading" className="text-[15px] font-bold text-ink mb-3">פיקסל ומעקב מכירות</h3>
                <PixelPanel isOwner={isOwner} onError={onError} onChanged={actionDone} />
              </section>
              <section aria-labelledby="log-heading">
                <h3 id="log-heading" className="text-[15px] font-bold text-ink mb-3">שינויים שנעשו ב-Meta</h3>
                <ActionsLog reloadKey={actionsKey} />
              </section>
            </div>
          )}
        </div>
      </section>
      {dialog}
    </div>
  );
}

