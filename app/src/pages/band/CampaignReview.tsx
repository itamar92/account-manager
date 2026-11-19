import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleHelp, ExternalLink, Link2, Ticket, XCircle } from 'lucide-react';
import { get, put } from '../../api';
import { Button, Input, Tag, Textarea } from '../../ui';
import { type BandMember } from './shared';
import { TaskPicker } from './TaskPicker';
import { InlineError, when, Working, type AdvisorJob } from './advisorShared';
import { ActionButtons } from './MetaActions';

type Tone = 'neutral' | 'pos' | 'warn' | 'neg' | 'accent';

export const AVAILABILITY: Record<string, { label: string; tone: Tone }> = {
  available: { label: 'יש כרטיסים', tone: 'pos' },
  few_left: { label: 'כרטיסים אחרונים', tone: 'warn' },
  sold_out: { label: 'אזל', tone: 'accent' },
  not_on_sale: { label: 'עוד לא במכירה', tone: 'neutral' },
  unknown: { label: 'לא ידוע', tone: 'neutral' },
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
  /** The show chosen in the strip above. */
  eventId: string;
  /** Bumped by the tab when a review or a ticket check finished, so this re-reads. */
  reloadKey: number;
  reviewJob?: AdvisorJob;
  ticketJob?: AdvisorJob;
  agentBusy: boolean;
  /** Why the last review or ticket check failed, said beside its button. */
  reviewFailure?: string;
  ticketFailure?: string;
  onDismissFailure: (kind: 'review' | 'tickets') => void;
  onReview: (note: string, checkTickets: boolean) => Promise<unknown>;
  onCheckTickets: (note: string) => Promise<unknown>;
  members: BandMember[];
  taskShow: (eventId: string) => any;
  onTasksAdded: () => void;
  onActionDone: () => void;
  onError: (message: string) => void;
}

/**
 * מצב הקמפיין — for a campaign that is already running: the plan against what happened since, what
 * the club's ticket page says, and one decision with the alternatives beside it.
 *
 * The decision leads, because it is what the owner opened the show for; the evidence follows it,
 * and the form that asks again sits after the answer rather than above it. The ticket check is the
 * agent reading the club's site. When it cannot find the club or the show it asks, and the answer
 * — a link, or a sentence — goes to the next check and is kept.
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

  const event = events.find((e) => e.id === eventId);
  const tickets = data?.tickets?.response;
  const review = data?.review?.response;
  const reviewing = reviewJob?.status === 'running' && reviewJob.event_id === eventId;
  const checking = ticketJob?.status === 'running' && ticketJob.event_id === eventId;
  const availability = tickets ? AVAILABILITY[tickets.availability] ?? AVAILABILITY.unknown : null;
  const asking = tickets && !tickets.found && tickets.question;
  const busyElsewhere = agentBusy && !reviewing && !checking;
  const busyTitle = busyElsewhere ? 'הסוכן עונה על בקשה אחרת. אפשר לבקש כשיסיים.' : undefined;

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
    <div className="grid gap-2">
      <Input label="האתר הרשמי של המועדון" dir="ltr" placeholder="https://…" value={links.venue_site}
        onChange={(e) => setLinks((l) => ({ ...l, venue_site: e.target.value }))} />
      <Input label="עמוד ההופעה או רכישת הכרטיסים" dir="ltr" placeholder="https://…" value={links.ticket_url}
        onChange={(e) => setLinks((l) => ({ ...l, ticket_url: e.target.value }))} />
    </div>
  );

  // ---- the form that spends a run on a review — first thing when there is none, last when there is
  const reviewForm = isOwner && (
    <div className="space-y-3">
      <Textarea
        label={review ? 'מה השתנה מאז הבדיקה האחרונה? (לא חובה)' : 'מה השתנה, או מה מטריד אתכם? (לא חובה)'}
        value={note}
        rows={2}
        disabled={reviewing}
        placeholder="למשל: המקום אמר שנמכרו 120 כרטיסים, שוקלים להעלות תקציב"
        onChange={(e) => setNote(e.target.value)}
      />
      <label className="flex items-center gap-2 text-sm text-body min-h-10">
        <input type="checkbox" className="accent-accent w-4 h-4" checked={checkFirst} disabled={reviewing}
          onChange={(e) => setCheckFirst(e.target.checked)} />
        לבדוק קודם כמה כרטיסים נמכרו באתר המועדון
      </label>
      {reviewing
        ? <Working text="הסוכן בודק את מצב הקמפיין" since={reviewJob?.started_at} />
        : (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={runReview} disabled={busyElsewhere} title={busyTitle} variant={review ? 'ghost' : 'primary'}>
              {review ? 'בדיקת מצב מחדש' : 'בדיקת מצב והמלצה'}
            </Button>
            {busyElsewhere && <span className="text-xs text-muted">הסוכן עסוק בבקשה אחרת</span>}
          </div>
        )}
      <InlineError text={props.reviewFailure} onDismiss={() => props.onDismissFailure('review')} />
    </div>
  );

  // ---- tickets on the club's site
  const ticketBox = (
    <section aria-labelledby="tickets-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="tickets-heading" className="flex items-center gap-2 text-[15px] font-bold text-ink">
          <Ticket className="w-4 h-4 text-muted" aria-hidden /> כרטיסים באתר המועדון
        </h3>
        {availability && <Tag tone={availability.tone}>{availability.label}</Tag>}
      </div>

      {checking && <Working text="הסוכן בודק באתר המועדון" since={ticketJob?.started_at} />}

      {!data?.tickets && !checking && (
        <p className="text-sm text-body leading-relaxed">
          עוד לא נבדק.{isOwner ? ' הסוכן ימצא את ההופעה באתר המועדון ויקרא כמה כרטיסים נמכרו.' : ''}
        </p>
      )}

      {tickets && (
        <div className="space-y-2">
          {tickets.summary && <p className="text-sm text-ink leading-relaxed">{tickets.summary}</p>}
          {(tickets.price || tickets.tickets_left != null) && (
            <div className="flex flex-wrap gap-1.5">
              {tickets.tickets_left != null && <Tag>נשארו {tickets.tickets_left}</Tag>}
              {tickets.price && <Tag>מחיר {tickets.price}</Tag>}
              {!tickets.capacity && event?.capacity ? <Tag>קיבולת {event.capacity}</Tag> : null}
            </div>
          )}
          {tickets.evidence && (
            <blockquote className="text-sm text-muted border-s-2 border-line ps-3 leading-relaxed">{tickets.evidence}</blockquote>
          )}
          <p className="text-xs text-muted">נבדק {when(data!.tickets.created_at)}</p>
        </div>
      )}

      {asking && !checking && (
        <div className="rounded-xl bg-warn-soft p-3 space-y-3">
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
              <Button onClick={answerAndRecheck} disabled={agentBusy || saving} title={busyTitle}>שמירה ובדיקה שוב</Button>
            </>
          )}
        </div>
      )}

      {editLinks && !asking && isOwner && (
        <div className="space-y-2 rounded-xl bg-soft p-3">
          {linkFields}
          <p className="text-xs text-muted">האתר של המועדון נשמר לכל ההופעות שם. שדה ריק מוחק את הקישור.</p>
          <div className="flex gap-2">
            <Button onClick={saveLinks} disabled={saving}>שמירה</Button>
            <Button variant="ghost" onClick={() => setEditLinks(false)}>ביטול</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {isOwner && !checking && (
          <Button variant="ghost" className="!px-3" disabled={busyElsewhere} title={busyTitle}
            onClick={() => props.onCheckTickets('')}>
            {data?.tickets ? 'בדיקת כרטיסים מחדש' : 'בדיקת כרטיסים'}
          </Button>
        )}
        {(data?.links.ticket_url || tickets?.show_url) && (
          <a href={data?.links.ticket_url || tickets.show_url} target="_blank" rel="noreferrer noopener"
            className="inline-flex items-center gap-1 min-h-10 text-sm text-accent-ink hover:underline">
            <ExternalLink className="w-3.5 h-3.5" aria-hidden /> לעמוד ההופעה
          </a>
        )}
        {isOwner && !checking && !asking && (
          <button type="button" onClick={() => setEditLinks((v) => !v)}
            className="inline-flex items-center gap-1 min-h-10 text-sm text-accent-ink hover:underline">
            <Link2 className="w-3.5 h-3.5" aria-hidden /> {editLinks ? 'סגירת הקישורים' : 'עריכת קישורים'}
          </button>
        )}
      </div>
      <InlineError text={props.ticketFailure} onDismiss={() => props.onDismissFailure('tickets')} />
    </section>
  );

  if (!eventId) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] items-start">
      <div className="space-y-5 min-w-0">
        {!review && (
          <div className="space-y-4 max-w-2xl">
            <div>
              <h3 className="text-base font-bold text-ink">עוד לא נבדק מצב הקמפיין</h3>
              <p className="text-sm text-body leading-relaxed mt-1">
                {isOwner
                  ? 'הסוכן משווה את התוכנית למה שקרה מאז, בודק כמה כרטיסים נמכרו, וממליץ על צעד אחד לעכשיו.'
                  : 'כשבעל העסק יבקש בדיקת מצב, ההמלצה תופיע כאן.'}
              </p>
            </div>
            {reviewForm}
          </div>
        )}

        {review && (
          <>
            {review.decision && (
              <div className="rounded-2xl bg-accent-soft px-4 py-4 md:px-5 space-y-2">
                <div className="text-xs font-semibold text-accent-ink">
                  ההמלצה{review.decision.action && ACTIONS[review.decision.action] ? ` · ${ACTIONS[review.decision.action]}` : ''}
                </div>
                <div className="text-lg font-bold text-ink leading-snug">{review.decision.title}</div>
                {review.decision.detail && <p className="text-sm text-body leading-relaxed whitespace-pre-wrap">{review.decision.detail}</p>}
                {review.decision.condition && <p className="text-sm text-body leading-relaxed">בדיקה הבאה: {review.decision.condition}</p>}
                {review.actions?.length > 0 && (
                  <div className="pt-2">
                    <ActionButtons actions={review.actions} source="review" sourceId={data!.review.id} eventId={eventId}
                      isOwner={isOwner} onError={props.onError} onDone={props.onActionDone} prominent />
                  </div>
                )}
              </div>
            )}
            {!review.decision && (
              <ActionButtons actions={review.actions} source="review" sourceId={data!.review.id} eventId={eventId}
                isOwner={isOwner} onError={props.onError} onDone={props.onActionDone} />
            )}

            {review.progress?.length > 0 && (
              <div>
                <h3 className="text-[15px] font-bold text-ink mb-2">תוכנית מול בפועל</h3>
                <ul className="divide-y divide-line border-y border-line">
                  {review.progress.map((row: any, i: number) => (
                    <li key={i} className="flex items-start gap-2.5 py-2.5 text-sm">
                      {row.ok === true && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-pos" aria-label="תקין" />}
                      {row.ok === false && <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-neg" aria-label="חריגה" />}
                      {row.ok == null && <span className="w-4 h-4 shrink-0" />}
                      <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:justify-between sm:gap-4">
                        <div className="font-medium text-ink">{row.label}</div>
                        <div className="num text-sm text-muted">
                          {row.planned && <>תוכנית {row.planned}</>}
                          {row.planned && row.actual && ' · '}
                          {row.actual && <>בפועל <span className="text-ink font-semibold">{row.actual}</span></>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {review.alternatives?.length > 0 && (
              <div>
                <h3 className="text-[15px] font-bold text-ink mb-2">אפשרויות אחרות</h3>
                <ul className="space-y-3">
                  {review.alternatives.map((alt: any, i: number) => (
                    <li key={i} className="text-sm">
                      <div className="font-medium text-ink">{alt.title}</div>
                      {alt.detail && <div className="text-body leading-relaxed">{alt.detail}</div>}
                      {alt.when && <div className="text-muted mt-0.5">מתי: {alt.when}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {review.questions?.length > 0 && (
              <div>
                <h3 className="text-[15px] font-bold text-ink mb-1">שאלות שיעזרו להחליט</h3>
                <p className="text-sm text-muted mb-1.5">אפשר לענות עליהן בבדיקה הבאה, כאן למטה.</p>
                <ul className="list-disc ps-4 space-y-1 text-sm text-body">
                  {review.questions.map((q: string, i: number) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            )}

            {review.tasks?.length > 0 && (
              <div>
                <h3 className="text-[15px] font-bold text-ink mb-2">משימות שהסוכן מציע</h3>
                <TaskPicker eventId={eventId} tasks={review.tasks} sourceId={data!.review.id}
                  show={props.taskShow(eventId)} members={props.members} isOwner={isOwner}
                  onAdded={props.onTasksAdded} onError={props.onError} />
              </div>
            )}

            <p className="text-xs text-muted">
              נבדק ב-{when(data!.review.created_at)}
              {data!.review.request?.note && <> · כתבתם: {data!.review.request.note}</>}
            </p>

            {isOwner && (
              <div className="rounded-xl bg-soft p-3 md:p-4">
                <h3 className="text-[15px] font-bold text-ink mb-2">בדיקה חדשה</h3>
                {reviewForm}
              </div>
            )}
          </>
        )}
      </div>

      <aside className="min-w-0 lg:border-s lg:border-line lg:ps-6">
        {ticketBox}
      </aside>
    </div>
  );
}
