import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { del, get, post, nis } from '../../api';
import { Button, Card, Combobox, Empty, PeriodSelect, StatCard, Textarea } from '../../ui';
import { eventLabel, useBandMembers, type PeriodTabProps } from './shared';
import { CampaignTasksPanel } from './CampaignTasksPanel';
import { TaskPicker } from './TaskPicker';

interface Props extends PeriodTabProps {
  events: any[];
}

const VERDICTS: Record<string, { label: string; className: string }> = {
  good: { label: 'הפרסום עובד', className: 'bg-pos-soft border-pos/25 text-pos' },
  ok: { label: 'סביר, יש מה לשפר', className: 'bg-warn-soft border-warn/25 text-warn' },
  poor: { label: 'הפרסום לא משתלם', className: 'bg-neg-soft border-neg/25 text-neg' },
};

const SEVERITIES: Record<string, { label: string; className: string }> = {
  high: { label: 'קריטי', className: 'text-neg border-neg/25' },
  medium: { label: 'בינוני', className: 'text-warn border-warn/25' },
  low: { label: 'קל', className: 'text-muted border-line' },
};

const EFFORTS: Record<string, string> = { low: 'מאמץ קטן', medium: 'מאמץ בינוני', high: 'מאמץ גדול' };

/** 'YYYY-MM-DDTHH:MM:SSZ' as something readable, in local time. */
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';

/** A chat answer's tasks, one group per show, in the order the shows first appear. */
function groupByShow(tasks: any[]): Array<[string, any[]]> {
  const groups = new Map<string, any[]>();
  for (const task of tasks) groups.set(task.event_id, [...(groups.get(task.event_id) ?? []), task]);
  return [...groups];
}

/** Other wordings the advisor offered for a headline or description; a click swaps one in. */
function Alternatives({ options, current, onChoose }: {
  options?: string[];
  current?: string;
  onChoose: (value: string) => void;
}) {
  const others = (options ?? []).filter((o) => o !== current);
  if (!others.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      <span className="text-faint">חלופות:</span>
      {others.map((option) => (
        <button key={option} onClick={() => onChoose(option)}
          className="rounded-lg border border-line px-2 py-0.5 text-ink-2 hover:border-accent hover:text-accent">
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * A run goes over SSH to another machine and can take a couple of minutes — long enough that a
 * spinner alone reads as a hang. The elapsed count is what says it is still working.
 */
function Working({ text }: { text: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      {text} · {seconds} שניות
    </div>
  );
}

/**
 * יועץ קמפיינים — the judgement the פרסום tab deliberately does not make.
 *
 * That tab reports what each show's promotion cost. This one asks an AI agent, over an SSH
 * connection to a machine where it is already logged in, whether that was money well spent, what
 * to change, and what a campaign for the next show should look like. Nothing here writes to Meta
 * or to the books: every answer is text to read, argue with, and act on by hand.
 *
 * The report is stored, so opening the tab paints the last one immediately rather than spending a
 * minute of somebody's time on a page load. A new run happens only when the button is pressed,
 * and only the owner can press it — band members read along.
 */
export function CampaignAnalysisTab({ events, period, isOwner, onError }: Props) {
  const [report, setReport] = useState<any>(null);
  const [agent, setAgent] = useState<any>(null);
  const [running, setRunning] = useState('');

  const [draftEvent, setDraftEvent] = useState('');
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<any>(null);
  const [draftReportId, setDraftReportId] = useState('');
  const [copied, setCopied] = useState(false);

  // Every show's tasks and owner, read by the pickers that offer a draft's or an answer's tasks:
  // who owns the show already, and whether those tasks were taken. Re-read after each add.
  const { members } = useBandMembers();
  const [taskShows, setTaskShows] = useState<any[]>([]);
  const [tasksKey, setTasksKey] = useState(0);
  useEffect(() => {
    get('/moonlight/campaign-tasks?all=1').then((d) => setTaskShows(d.shows)).catch(() => {});
  }, [tasksKey]);
  const taskShow = (eventId: string) => taskShows.find((s) => s.event_id === eventId) ?? null;
  const tasksAdded = () => setTasksKey((k) => k + 1);

  const [messages, setMessages] = useState<any[]>([]);
  const [question, setQuestion] = useState('');
  const threadEnd = useRef<HTMLDivElement>(null);

  const load = () => {
    const query = period.params().toString();
    get(`/moonlight/campaign-analysis${query ? `?${query}` : ''}`)
      .then((d) => { setReport(d.report); setAgent(d.agent); })
      .catch((e) => onError(e.message));
    get('/moonlight/campaign-chat')
      .then((d) => setMessages(d.messages))
      .catch(() => {});
  };
  useEffect(load, [period.year, period.month]);

  useEffect(() => { threadEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const showDraft = (report: any) => {
    setDraft(report?.response ?? null);
    setDraftReportId(report?.id ?? '');
  };

  // Choosing a show paints its last plan, if it has one — a plan took a minute to make and should
  // not need making again to add its tasks a day later.
  useEffect(() => {
    setCopied(false);
    if (!draftEvent) { showDraft(null); return; }
    get(`/moonlight/campaign-draft/${draftEvent}`).then((d) => showDraft(d.report)).catch(() => {});
  }, [draftEvent]);

  const analyze = async () => {
    setRunning('analysis');
    onError('');
    try {
      const query = period.params().toString();
      const d = await post(`/moonlight/campaign-analysis${query ? `?${query}` : ''}`);
      setReport(d.report);
    } catch (err: any) { onError(err.message); }
    finally { setRunning(''); }
  };

  const makeDraft = async () => {
    if (!draftEvent) return;
    setRunning('draft');
    onError('');
    setCopied(false);
    try {
      const d = await post('/moonlight/campaign-draft', { event_id: draftEvent, brief });
      showDraft(d.report);
    } catch (err: any) { onError(err.message); }
    finally { setRunning(''); }
  };

  const send = async () => {
    const text = question.trim();
    if (!text) return;
    setRunning('chat');
    setQuestion('');
    onError('');
    try {
      const query = period.params().toString();
      const d = await post(`/moonlight/campaign-chat${query ? `?${query}` : ''}`, { message: text });
      setMessages(d.messages);
    } catch (err: any) {
      onError(err.message);
      // Hands the question back rather than losing what was typed to a failed round trip.
      setQuestion(text);
    }
    finally { setRunning(''); }
  };

  const clearThread = async () => {
    if (!confirm('למחוק את היסטוריית השיחה?')) return;
    try {
      await del('/moonlight/campaign-chat');
      setMessages([]);
    } catch (err: any) { onError(err.message); }
  };

  /** Swaps an alternative headline or description into the plan, which is what «העתקה» copies. */
  const chooseCreative = (field: 'headline' | 'description', value: string) =>
    setDraft((d: any) => ({ ...d, creative: { ...d.creative, [field]: value } }));

  /** The draft as one block of text, which is how it gets into Ads Manager. */
  const copyDraft = () => {
    if (!draft) return;
    const text = [
      `מטרה: ${draft.objective}`,
      `קהל: ${draft.audience}`,
      `תקציב: ${draft.budget_total} ₪ סה"כ · ${draft.daily_budget} ₪ ליום`,
      `תאריכים: ${draft.schedule?.start} – ${draft.schedule?.end}`,
      `מיקומים: ${(draft.placements || []).join(', ')}`,
      '',
      draft.creative?.primary_text || '',
      `כותרת: ${draft.creative?.headline || ''}`,
      `תיאור: ${draft.creative?.description || ''}`,
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {});
  };

  const answer = report?.response;
  const verdict = VERDICTS[answer?.verdict] ?? null;
  const eventById = (id: string) => events.find((e) => e.id === id);
  const upcoming = events.filter((e) => e.date >= new Date().toISOString().slice(0, 10));

  const tasksPanel = <CampaignTasksPanel events={events} isOwner={isOwner} onError={onError} reloadKey={tasksKey} />;

  // The advisor is useless without the connection, and saying which half is missing beats a
  // button that fails when pressed. The tasks do not need it, so they stay.
  if (agent && !agent.configured) {
    return (
      <div className="space-y-3">
      {tasksPanel}
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

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="ser text-lg">יועץ קמפיינים</h2>
              <PeriodSelect year={period.year} month={period.month}
                onYearChange={period.setYear} onMonthChange={period.setMonth} />
              {verdict && (
                <span className={clsx('text-xs rounded-lg border px-2 py-1', verdict.className)}>
                  {verdict.label}
                </span>
              )}
            </div>
            {answer?.headline && <p className="text-sm text-ink-2 mt-2">{answer.headline}</p>}
            {report && (
              <p className="text-xs text-faint mt-1">
                נותח ב-{when(report.created_at)}
                {report.duration_ms ? ` · ${Math.round(report.duration_ms / 1000)} שניות` : ''}
                {' · '}הנתונים עצמם נמצאים בלשונית «פרסום»
              </p>
            )}
          </div>
          {isOwner && (
            running === 'analysis'
              ? <Working text="הסוכן מנתח" />
              : <Button onClick={analyze} disabled={!!running}>
                  {report ? 'רענון ניתוח' : 'ניתוח קמפיינים'}
                </Button>
          )}
        </div>
      </Card>

      {tasksPanel}

      {!report && running !== 'analysis' && (
        <Empty text={isOwner
          ? 'עוד לא נעשה ניתוח לתקופה הזו — «ניתוח קמפיינים» יבקש מהסוכן לעבור על הנתונים'
          : 'עוד לא נעשה ניתוח לתקופה הזו'} />
      )}

      {answer?.benchmarks && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard label="עלות לכרטיס" sub="לפי הסוכן"
            value={answer.benchmarks.cost_per_ticket == null ? '—' : nis(answer.benchmarks.cost_per_ticket)} />
          <StatCard label="פרסום מתוך ההכנסה" sub="ממוצע בתקופה"
            value={answer.benchmarks.spend_share_of_revenue == null ? '—' : `${answer.benchmarks.spend_share_of_revenue}%`} />
          <StatCard label="ההופעה המשתלמת" accent="text-pos"
            value={eventById(answer.benchmarks.best_event_id)?.venue ?? '—'}
            sub={eventById(answer.benchmarks.best_event_id)?.date ?? ''} />
          <StatCard label="ההופעה היקרה" accent="text-neg"
            value={eventById(answer.benchmarks.worst_event_id)?.venue ?? '—'}
            sub={eventById(answer.benchmarks.worst_event_id)?.date ?? ''} />
        </div>
      )}

      {answer?.findings?.length > 0 && (
        <Card>
          <h2 className="ser text-lg mb-3">ממצאים</h2>
          <div className="space-y-2">
            {answer.findings.map((finding: any, i: number) => {
              const severity = SEVERITIES[finding.severity] ?? SEVERITIES.low;
              const event = finding.event_id ? eventById(finding.event_id) : null;
              return (
                <div key={i} className="bg-soft border border-line rounded-xl p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={clsx('text-xs rounded-lg border px-2 py-0.5', severity.className)}>
                      {severity.label}
                    </span>
                    <span className="font-medium">{finding.title}</span>
                    {event && (
                      <span className="text-xs text-faint">
                        {eventLabel(event)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted mt-1.5 leading-relaxed">{finding.detail}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {answer?.suggestions?.length > 0 && (
        <Card>
          <h2 className="ser text-lg mb-1">המלצות</h2>
          <p className="text-xs text-faint mb-3">
            מדורגות מהחשובה לפחות חשובה. הסוכן לא משנה דבר ב-Meta — כל שינוי נעשה ידנית.
          </p>
          <div className="space-y-2">
            {answer.suggestions.map((suggestion: any, i: number) => (
              <div key={i} className="bg-soft border border-line rounded-xl p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{i + 1}. {suggestion.title}</span>
                  {suggestion.effort && (
                    <span className="text-xs text-faint">{EFFORTS[suggestion.effort] ?? suggestion.effort}</span>
                  )}
                </div>
                <p className="text-sm text-muted mt-1.5 leading-relaxed">{suggestion.detail}</p>
                {suggestion.expected_impact && (
                  <p className="text-xs text-accent mt-1.5">צפוי: {suggestion.expected_impact}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {isOwner && (
        <Card>
          <h2 className="ser text-lg mb-1">קמפיין חדש</h2>
          <p className="text-xs text-faint mb-3">
            תוכנית לקמפיין להופעה שעוד לא הייתה, בנויה על מה שעבד בקמפיינים הקודמים. התוצאה היא
            טקסט להעתקה ל-Ads Manager — שום דבר לא נוצר ב-Meta.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Combobox
              value={draftEvent}
              onChange={setDraftEvent}
              placeholder="בחרו הופעה…"
              options={[
                { value: '', label: 'בחרו הופעה…' },
                ...upcoming.map((e) => ({ value: e.id, label: eventLabel(e) })),
              ]}
            />
            <div className="sm:col-span-2">
              <Textarea
                label="משהו שחשוב שהסוכן ידע? (לא חובה)"
                value={brief}
                rows={2}
                placeholder="למשל: תקציב עד 800 ₪, הדגש על קהל צעיר מהמרכז"
                onChange={(e) => setBrief(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3">
            {running === 'draft'
              ? <Working text="הסוכן בונה תוכנית" />
              : <Button onClick={makeDraft} disabled={!draftEvent || !!running}>בניית תוכנית</Button>}
          </div>

          {upcoming.length === 0 && (
            <p className="text-xs text-warn mt-2">אין הופעות עתידיות בטבלת ההכנסות</p>
          )}

          {draft && (
            <div className="mt-4 bg-soft border border-line rounded-xl p-3 space-y-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">התוכנית</span>
                <button onClick={copyDraft} className="text-xs text-accent hover:underline">
                  {copied ? 'הועתק ✓' : 'העתקה'}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div><span className="text-faint">מטרה: </span>{draft.objective}</div>
                <div>
                  <span className="text-faint">תאריכים: </span>
                  {draft.schedule?.start} – {draft.schedule?.end}
                </div>
                <div>
                  <span className="text-faint">תקציב: </span>
                  {nis(draft.budget_total)} · {nis(draft.daily_budget)} ליום
                </div>
                <div><span className="text-faint">מיקומים: </span>{(draft.placements || []).join(', ')}</div>
              </div>
              <div><span className="text-faint">קהל: </span>{draft.audience}</div>
              {draft.creative && (
                <div className="border-t border-line pt-2 space-y-1">
                  <div className="text-faint text-xs">נוסח המודעה</div>
                  <p className="whitespace-pre-wrap leading-relaxed">{draft.creative.primary_text}</p>
                  <div><span className="text-faint">כותרת: </span>{draft.creative.headline}</div>
                  <Alternatives options={draft.creative.headline_options} current={draft.creative.headline}
                    onChoose={(v) => chooseCreative('headline', v)} />
                  <div><span className="text-faint">תיאור: </span>{draft.creative.description}</div>
                  <Alternatives options={draft.creative.description_options} current={draft.creative.description}
                    onChoose={(v) => chooseCreative('description', v)} />
                  {draft.creative.based_on && (
                    <p className="text-xs text-faint leading-relaxed">מבוסס על: {draft.creative.based_on}</p>
                  )}
                </div>
              )}
              {draft.tasks?.length > 0 && (
                <div className="border-t border-line pt-2 space-y-2">
                  <div className="text-faint text-xs">משימות מעקב — כל משימה מסומנת תישלח כתזכורת במייל ביום היעד</div>
                  <TaskPicker eventId={draftEvent} tasks={draft.tasks} sourceId={draftReportId}
                    show={taskShow(draftEvent)} members={members} isOwner={isOwner}
                    onAdded={tasksAdded} onError={onError} />
                </div>
              )}
              {draft.notes?.length > 0 && (
                <ul className="border-t border-line pt-2 space-y-1 text-xs text-muted">
                  {draft.notes.map((note: string, i: number) => <li key={i}>• {note}</li>)}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h2 className="ser text-lg">שאלות המשך</h2>
          {isOwner && messages.length > 0 && (
            <button onClick={clearThread} className="text-xs text-neg hover:underline">ניקוי השיחה</button>
          )}
        </div>
        <p className="text-xs text-faint mb-3">
          לסוכן יש את אותם נתונים שבלשונית «פרסום» לתקופה שנבחרה למעלה.
        </p>

        {messages.length === 0 ? (
          <Empty text="אין עדיין שאלות" />
        ) : (
          <div className="space-y-2 max-h-[32rem] overflow-y-auto">
            {messages.map((message: any) => (
              <div key={message.id}
                className={clsx('rounded-xl p-3 text-sm leading-relaxed',
                  message.role === 'user'
                    ? 'bg-accent/15 border border-accent/25'
                    : 'bg-soft border border-line')}>
                <div className="text-xs text-faint mb-1">
                  {message.role === 'user' ? 'אתם' : 'הסוכן'} · {when(message.created_at)}
                </div>
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.tasks?.length > 0 && (
                  <div className="border-t border-line mt-2 pt-2 space-y-3">
                    <div className="text-faint text-xs">משימות שהסוכן מציע — כל משימה מסומנת תישלח כתזכורת במייל ביום היעד</div>
                    {groupByShow(message.tasks).map(([eventId, tasks]) => (
                      <TaskPicker key={eventId} eventId={eventId} tasks={tasks} sourceId={message.id}
                        label={eventById(eventId) ? eventLabel(eventById(eventId)) : undefined}
                        show={taskShow(eventId)} members={members} isOwner={isOwner}
                        onAdded={tasksAdded} onError={onError} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={threadEnd} />
          </div>
        )}

        {isOwner && (
          <div className="mt-3 space-y-2">
            <Textarea
              value={question}
              rows={2}
              disabled={!!running}
              placeholder="למשל: למה הקמפיין של ההופעה בבארבי היה יקר פי שניים?"
              onChange={(e) => setQuestion(e.target.value)}
            />
            {running === 'chat'
              ? <Working text="הסוכן חושב" />
              : <Button onClick={send} disabled={!question.trim() || !!running}>שליחה</Button>}
          </div>
        )}
      </Card>
    </div>
  );
}
