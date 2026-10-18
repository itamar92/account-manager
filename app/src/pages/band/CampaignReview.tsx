import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleHelp, ExternalLink, Link2, Ticket, XCircle } from 'lucide-react';
import { get, put } from '../../api';
import { Button, Combobox, Input, Tag, Textarea } from '../../ui';
import { eventLabel, type BandMember } from './shared';
import { TaskPicker } from './TaskPicker';
import { when, Working, type AdvisorJob } from './advisorShared';
import { ActionButtons } from './MetaActions';

type Tone = 'neutral' | 'pos' | 'warn' | 'neg' | 'accent';

export const AVAILABILITY: Record<string, { label: string; tone: Tone }> = {
  available: { label: 'יש כרטיסים', tone: 'pos' },
  few_left: { label: 'כרטיסים אחרונים', tone: 'warn' },
  sold_out: { label: 'אזל', tone: 'accent' },
  not_on_sale: { label: 'עוד לא במכירה', tone: 'neutral' },
  unknown: { label: 'לא ידוע', tone: 'neutral' },
};

const STATUSES: Record<string, { label: string; tone: Tone }> = {
  on_track: { label: 'בדרך הנכונה', tone: 'pos' },
  at_risk: { label: 'בסיכון', tone: 'warn' },
  off_track: { label: 'לא עומד ביעד', tone: 'neg' },
  not_started: { label: 'עוד לא התחיל', tone: 'neutral' },
  finished: { label: 'הסתיים', tone: 'neutral' },
};

const ACTIONS: Record<string, string> = {
  continue: 'להמשיך כמו שזה',
  raise_budget: 'להעלות תקציב',
  lower_budget: 'להוריד תקציב',
  change_creative: 'להחליף מודעה',
  change_audience: 'לשנות קהל',
  start_campaign: 'להפעיל קמפיין',
  pause: 'להשהות',
  stop: 'לעצור',
  wait: 'לחכות ולבדוק שוב',
};

interface Props {
  events: any[];
  isOwner: boolean;
  /** The show chosen for the plan above — the same one is reviewed here. */
  eventId: string;
  onEventChange: (eventId: string) => void;
  /** Bumped by the tab when a review or a ticket check finished, so this re-reads. */
  reloadKey: number;
  reviewJob?: AdvisorJob;
  ticketJob?: AdvisorJob;
  agentBusy: boolean;
  onReview: (note: string, checkTickets: boolean) => Promise<unknown>;
  onCheckTickets: (note: string) => Promise<unknown>;
  members: BandMember[];
  taskShow: (eventId: string) => any;
  onTasksAdded: () => void;
  /** A change the review proposed was carried out in Meta. */
  onActionDone: () => void;
  onError: (message: string) => void;
}

/**
 * בדיקת מצב — for a campaign that is already running: the plan against what happened since, what
 * the club's ticket page says, and one decision with the alternatives beside it.
 *
 * The ticket check is the agent reading the club's site. When it cannot find the club or the
 * show it asks, and the answer — a link, or a sentence — goes to the next check and is kept.
 */
export function CampaignReview(props: Props) {
  const { events, isOwner, eventId, reviewJob, ticketJob, agentBusy } = props;
  const [data, setData] = useState<{ review: any; tickets: any; links: { ticket_url: string | null; venue_site: string | null } } | null>(null);
  const [note, setNote] = useState('');
  const [checkFirst, setCheckFirst] = useState(true);
  const [answer, setAnswer] = useState('');
  const [links, setLinks] = useState({ ticket_url: '', venue_site: '' });
  const [editLinks, setEditLinks] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!eventId) { setData(null); return; }
    let current = true;
    get(`/band/campaign-review/${eventId}`).then((d) => {
      if (!current) return;
      setData(d);
      setLinks({ ticket_url: d.links?.ticket_url ?? '', venue_site: d.links?.venue_site ?? '' });
    }).catch(() => {});
    return () => { current = false; };
  }, [eventId, props.reloadKey]);

  // A new show starts with an empty note; the question asked about the last one is not this one's.
  useEffect(() => { setNote(''); setAnswer(''); setEditLinks(false); }, [eventId]);

  const today = new Date().toISOString().slice(0, 10);
  const event = events.find((e) => e.id === eventId);
  const choosable = events.filter((e) => e.date >= today || e.id === eventId);
  const tickets = data?.tickets?.response;
  const review = data?.review?.response;
  const reviewing = reviewJob?.status === 'running' && reviewJob.event_id === eventId;
  const checking = ticketJob?.status === 'running' && ticketJob.event_id === eventId;
  const availability = tickets ? AVAILABILITY[tickets.availability] ?? AVAILABILITY.unknown : null;
  const status = review ? STATUSES[review.status] : null;
  const asking = tickets && !tickets.found && tickets.question;

  const saveLinks = async () => {
    setSaving(true);
    props.onError('');
    try {
      const d = await put(`/band/ticket-links/${eventId}`, links);
      setData((cur) => (cur ? { ...cur, links: d.links } : cur));
      setLinks({ ticket_url: d.links.ticket_url ?? '', venue_site: d.links.venue_site ?? '' });
      setEditLinks(false);
      return true;
    } catch (err: any) {
      props.onError(err.message);
      return false;
    } finally { setSaving(false); }
  };

  /** Saves whatever links were typed in answer to the question, then asks again with the sentence. */
  const answerAndRecheck = async () => {
    const changed = links.ticket_url !== (data?.links.ticket_url ?? '') || links.venue_site !== (data?.links.venue_site ?? '');
    if (changed && !(await saveLinks())) return;
    await props.onCheckTickets(answer.trim());
    setAnswer('');
  };

  const runReview = async () => {
    await props.onReview(note.trim(), checkFirst);
  };

  const linkFields = (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input label="האתר הרשמי של המועדון" dir="ltr" placeholder="https://…" value={links.venue_site}
        onChange={(e) => setLinks((l) => ({ ...l, venue_site: e.target.value }))} />
      <Input label="עמוד ההופעה / רכישת כרטיסים" dir="ltr" placeholder="https://…" value={links.ticket_url}
        onChange={(e) => setLinks((l) => ({ ...l, ticket_url: e.target.value }))} />
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-faint">
        לקמפיין שכבר רץ: הסוכן משווה את התוכנית למה שקרה מאז, בודק באתר המועדון כמה כרטיסים נמכרו, וממליץ מה לעשות עכשיו.
        שום דבר לא משתנה ב-Meta בלי תצוגה מקדימה ואישור שלכם.
      </p>

      <Combobox
        value={eventId}
        onChange={props.onEventChange}
        placeholder="בחרו הופעה…"
        options={[{ value: '', label: 'בחרו הופעה…' }, ...choosable.map((e) => ({ value: e.id, label: eventLabel(e) }))]}
      />

      {eventId && (
        <>
          {/* ---- tickets on the club's site */}
          <div className="rounded-xl border border-line p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Ticket className="w-4 h-4 text-muted" aria-hidden />
                <h3 className="text-sm font-bold text-ink">כרטיסים באתר המועדון</h3>
                {availability && <Tag tone={availability.tone}>{availability.label}</Tag>}
                {data?.tickets && <span className="text-xs text-faint">נבדק {when(data.tickets.created_at)}</span>}
              </div>
              <div className="flex items-center gap-2">
                {isOwner && !checking && (
                  <button type="button" onClick={() => setEditLinks((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    <Link2 className="w-3.5 h-3.5" aria-hidden /> קישורים
                  </button>
                )}
                {isOwner && !checking && (
                  <Button variant="ghost" className="!px-3 !py-2" disabled={agentBusy}
                    onClick={() => props.onCheckTickets('')}>
                    {data?.tickets ? 'בדיקה מחדש' : 'בדיקת כרטיסים'}
                  </Button>
                )}
              </div>
            </div>

            {checking && <Working text="הסוכן בודק באתר המועדון" since={ticketJob?.started_at} />}

            {!data?.tickets && !checking && (
              <p className="text-sm text-faint">
                עוד לא נבדק. {isOwner ? '«בדיקת כרטיסים» תבקש מהסוכן למצוא את ההופעה באתר המועדון ולקרוא את מצב הכרטיסים.' : ''}
              </p>
            )}

            {tickets && (
              <div className="space-y-2">
                {tickets.summary && <p className="text-sm text-ink leading-relaxed">{tickets.summary}</p>}
                {(tickets.tickets_sold != null || tickets.tickets_left != null || tickets.price) && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {tickets.tickets_sold != null && <Tag>נמכרו {tickets.tickets_sold}</Tag>}
                    {tickets.tickets_left != null && <Tag>נשארו {tickets.tickets_left}</Tag>}
                    {(tickets.capacity ?? event?.capacity) ? <Tag>קיבולת {tickets.capacity ?? event?.capacity}</Tag> : null}
                    {tickets.price && <Tag>מחיר {tickets.price}</Tag>}
                  </div>
                )}
                {tickets.evidence && (
                  <blockquote className="text-xs text-muted border-s-2 border-line ps-2 leading-relaxed">{tickets.evidence}</blockquote>
                )}
                {(data?.links.ticket_url || tickets.show_url) && (
                  <a href={data?.links.ticket_url || tickets.show_url} target="_blank" rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden /> לעמוד ההופעה
                  </a>
                )}
              </div>
            )}

            {asking && !checking && (
              <div className="rounded-lg border border-warn/30 bg-warn-soft p-3 space-y-3">
                <p className="flex items-start gap-2 text-sm text-warn-ink">
                  <CircleHelp className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                  <span>{tickets.question}</span>
                </p>
                {isOwner && (
                  <>
                    {linkFields}
                    <Textarea label="או תשובה במילים (לא חובה)" rows={2} value={answer}
                      placeholder="למשל: המכירה דרך האתר של ההיכל, ההופעה מופיעה תחת השם…"
                      onChange={(e) => setAnswer(e.target.value)} />
                    <Button onClick={answerAndRecheck} disabled={agentBusy || saving}>שמירה ובדיקה שוב</Button>
                  </>
                )}
              </div>
            )}

            {editLinks && !asking && isOwner && (
              <div className="space-y-2">
                {linkFields}
                <p className="text-xs text-faint">האתר של המועדון נשמר לכל ההופעות במקום הזה. שדה ריק מוחק את הקישור.</p>
                <div className="flex gap-2">
                  <Button onClick={saveLinks} disabled={saving}>שמירה</Button>
                  <Button variant="ghost" onClick={() => setEditLinks(false)}>ביטול</Button>
                </div>
              </div>
            )}
          </div>

          {/* ---- the status review */}
          {isOwner && (
            <div className="rounded-xl border border-line bg-soft p-3 space-y-3">
              <Textarea
                label="מה השתנה, או מה מטריד אתכם? (לא חובה)"
                value={note}
                rows={2}
                disabled={reviewing}
                placeholder="למשל: המקום אמר שנמכרו 120 כרטיסים, שוקלים להעלות תקציב"
                onChange={(e) => setNote(e.target.value)}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" className="accent-accent" checked={checkFirst} disabled={reviewing}
                  onChange={(e) => setCheckFirst(e.target.checked)} />
                לבדוק קודם את הכרטיסים באתר המועדון (אם לא נבדקו ב-12 השעות האחרונות)
              </label>
              {reviewing
                ? <Working text="הסוכן בודק את מצב הקמפיין" since={reviewJob?.started_at} />
                : (
                  <Button onClick={runReview} disabled={agentBusy}>
                    {review ? 'בדיקת מצב מחדש' : 'בדיקת מצב והמלצה'}
                  </Button>
                )}
            </div>
          )}

          {!review && !reviewing && (
            <p className="text-sm text-faint text-center py-2">
              עוד לא נבדק מצב הקמפיין להופעה הזו
            </p>
          )}

          {review && (
            <article className="rounded-xl border border-line p-3 md:p-4 space-y-4">
              <header className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {status && <Tag tone={status.tone}>{status.label}</Tag>}
                  {review.days_left != null && (
                    <Tag>{review.days_left > 0 ? `${review.days_left} ימים להופעה` : review.days_left === 0 ? 'ההופעה היום' : 'ההופעה עברה'}</Tag>
                  )}
                  <span className="text-xs text-faint">נבדק {when(data!.review.created_at)}</span>
                </div>
                {review.headline && <p className="text-[15px] text-ink leading-relaxed">{review.headline}</p>}
                {data!.review.request?.note && <p className="text-xs text-muted">כתבתם: {data!.review.request.note}</p>}
              </header>

              {review.decision && (
                <div className="rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 space-y-1">
                  <div className="text-xs text-accent-ink font-semibold">
                    ההחלטה המומלצת{review.decision.action && ACTIONS[review.decision.action] ? ` · ${ACTIONS[review.decision.action]}` : ''}
                  </div>
                  <div className="text-sm font-bold text-ink">{review.decision.title}</div>
                  {review.decision.detail && <p className="text-sm text-body leading-relaxed whitespace-pre-wrap">{review.decision.detail}</p>}
                  {review.decision.condition && <p className="text-xs text-muted leading-relaxed">בדיקה הבאה: {review.decision.condition}</p>}
                </div>
              )}

              <ActionButtons actions={review.actions} source="review" sourceId={data!.review.id} eventId={eventId}
                isOwner={isOwner} onError={props.onError} onDone={props.onActionDone} />

              {review.progress?.length > 0 && (
                <div>
                  <div className="text-xs text-faint mb-1.5">תוכנית מול בפועל</div>
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {review.progress.map((row: any, i: number) => (
                      <li key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
                        {row.ok === true && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-pos" aria-label="תקין" />}
                        {row.ok === false && <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-neg" aria-label="חריגה" />}
                        {row.ok == null && <span className="w-4 h-4 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-ink">{row.label}</div>
                          <div className="text-xs text-muted leading-relaxed">
                            {row.planned && <>תוכנית: {row.planned}</>}
                            {row.planned && row.actual && ' · '}
                            {row.actual && <>בפועל: {row.actual}</>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {review.alternatives?.length > 0 && (
                <div>
                  <div className="text-xs text-faint mb-1.5">אפשרויות אחרות</div>
                  <ul className="space-y-2">
                    {review.alternatives.map((alt: any, i: number) => (
                      <li key={i} className="rounded-lg bg-soft px-3 py-2 text-sm">
                        <div className="font-medium text-ink">{alt.title}</div>
                        {alt.detail && <div className="text-body leading-relaxed">{alt.detail}</div>}
                        {alt.when && <div className="text-xs text-muted mt-0.5">מתי: {alt.when}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {review.tickets && (
                <p className="text-sm text-body leading-relaxed"><span className="text-xs text-faint">כרטיסים: </span>{review.tickets}</p>
              )}

              {review.questions?.length > 0 && (
                <div className="rounded-lg border border-line px-3 py-2">
                  <div className="text-xs text-faint mb-1">שאלות שיעזרו להחליט — ענו בתיבה למעלה ובקשו בדיקה מחדש</div>
                  <ul className="list-disc ps-4 space-y-1 text-sm text-body">
                    {review.questions.map((q: string, i: number) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}

              {review.tasks?.length > 0 && (
                <div>
                  <div className="text-xs text-faint mb-1.5">משימות חדשות שהסוכן מציע</div>
                  <TaskPicker eventId={eventId} tasks={review.tasks} sourceId={data!.review.id}
                    show={props.taskShow(eventId)} members={props.members} isOwner={isOwner}
                    onAdded={props.onTasksAdded} onError={props.onError} />
                </div>
              )}
            </article>
          )}
        </>
      )}
    </div>
  );
}
