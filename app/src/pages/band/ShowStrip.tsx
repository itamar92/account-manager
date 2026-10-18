import React from 'react';
import { clsx } from 'clsx';
import { CalendarX } from 'lucide-react';
import { nis } from '../../api';
import { daysAway, ddmm, Meter, when } from './advisorShared';

/** One upcoming show as the server summarises it — see showSummaries() in server/campaignAdvisor.ts. */
export interface ShowSummary {
  event_id: string;
  label: string;
  venue: string;
  date: string;
  days_left: number;
  capacity: number | null;
  plan: { report_id: string; created_at: string; budget_total: number | null; start: string | null; end: string | null } | null;
  review: { status: string | null; headline: string | null; decision: string | null; created_at: string } | null;
  tickets: { availability: string | null; sold: number | null; left: number | null; capacity: number | null; created_at: string } | null;
  spend: number | null;
  pixel_status: string | null;
}

type Tone = 'pos' | 'warn' | 'neg' | 'neutral' | 'accent';

/** Where a show's campaign stands, from the last status review, else from whether it has a plan. */
const REVIEW_STATUS: Record<string, { label: string; tone: Tone }> = {
  on_track: { label: 'בדרך הנכונה', tone: 'pos' },
  at_risk: { label: 'בסיכון', tone: 'warn' },
  off_track: { label: 'לא עומד ביעד', tone: 'neg' },
  not_started: { label: 'הקמפיין עוד לא התחיל', tone: 'neutral' },
  finished: { label: 'הקמפיין הסתיים', tone: 'neutral' },
};

const PIXEL_STATUS: Record<string, string> = {
  none: 'עוד לא ביקשנו',
  requested: 'ביקשנו מהמועדון',
  installed: 'הותקן, לפי המועדון',
  declined: 'המועדון סירב',
};

const DOT: Record<Tone, string> = {
  pos: 'bg-pos', warn: 'bg-warn', neg: 'bg-neg', neutral: 'bg-line-strong', accent: 'bg-accent',
};

export function showStatus(show: ShowSummary, working: boolean): { label: string; tone: Tone } {
  if (working) return { label: 'הסוכן עובד על ההופעה…', tone: 'accent' };
  const review = show.review?.status ? REVIEW_STATUS[show.review.status] : null;
  if (review) return review;
  if (show.plan) return { label: 'יש תוכנית, עוד לא נבדק מצב', tone: 'neutral' };
  return { label: 'אין עדיין תוכנית', tone: 'neutral' };
}

/** Sold, and out of how many — the ticket check's own count first, the show's capacity second. */
const ticketCount = (show: ShowSummary) => {
  const sold = show.tickets?.sold ?? null;
  const capacity = show.tickets?.capacity ?? show.capacity ?? (sold != null && show.tickets?.left != null ? sold + show.tickets.left : null);
  return { sold, capacity };
};

const dateParts = (date: string) => {
  const d = new Date(`${date}T12:00:00`);
  return {
    day: date.slice(8, 10),
    month: d.toLocaleDateString('he-IL', { month: 'short' }),
    weekday: d.toLocaleDateString('he-IL', { weekday: 'long' }),
  };
};

/**
 * The shows still ahead, as a strip of cards: the one control that chooses which show the page is
 * about. Each card already answers the question it is opened for — how the campaign is doing, how
 * many tickets are gone, whether anything is late — so most visits end here.
 */
export function ShowStrip({ shows, selected, onSelect, workingOn, lateByShow }: {
  shows: ShowSummary[];
  selected: string;
  onSelect: (eventId: string) => void;
  /** The show a run is working on right now, if any. */
  workingOn?: string;
  lateByShow: (eventId: string) => number;
}) {
  if (!shows.length) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-5">
        <CalendarX className="w-5 h-5 shrink-0 text-muted" aria-hidden />
        <p className="text-sm text-body">
          אין הופעות קרובות בטבלת ההופעות. הופעה שתתווסף שם תופיע כאן, ואפשר יהיה לבנות לה תוכנית קמפיין.
        </p>
      </div>
    );
  }
  return (
    <div className="rail -mx-4 px-4 md:mx-0 md:px-0 flex gap-2.5 overflow-x-auto snap-x snap-mandatory pb-1"
      role="group" aria-label="בחירת הופעה">
      {shows.map((show) => {
        const active = show.event_id === selected;
        const { day, month, weekday } = dateParts(show.date);
        const status = showStatus(show, workingOn === show.event_id);
        const { sold, capacity } = ticketCount(show);
        const late = lateByShow(show.event_id);
        return (
          <button key={show.event_id} type="button" aria-pressed={active} onClick={() => onSelect(show.event_id)}
            className={clsx('snap-start shrink-0 w-[15.5rem] rounded-2xl border p-3.5 text-start transition-[border-color,background-color,box-shadow] duration-200',
              active
                ? 'border-accent bg-surface shadow-[0_0_0_1px_var(--color-accent),0_8px_24px_rgba(36,29,61,.10)]'
                : 'border-line bg-surface hover:border-line-strong')}>
            <div className="flex items-start gap-3">
              <div className={clsx('w-12 shrink-0 rounded-xl py-1.5 text-center', active ? 'bg-accent text-white' : 'bg-soft text-ink')}>
                <div className="num text-xl font-extrabold leading-none tracking-[-0.02em]">{day}</div>
                <div className={clsx('text-[11px] mt-1 leading-none', active ? 'text-white/85' : 'text-muted')}>{month}</div>
              </div>
              <div className="min-w-0 pt-0.5">
                <div className="font-semibold text-ink truncate">{show.venue}</div>
                <div className="text-xs text-muted mt-0.5">{weekday} · {daysAway(show.days_left)}</div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-ink-2">
              <span aria-hidden className={clsx('w-2 h-2 rounded-full shrink-0', DOT[status.tone],
                status.tone === 'accent' && 'animate-pulse motion-reduce:animate-none')} />
              <span className="truncate">{status.label}</span>
            </div>

            <div className="mt-2.5">
              {sold != null ? (
                <>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-muted">כרטיסים</span>
                    <span className="num font-semibold text-ink">{sold}{capacity ? <span className="text-muted font-normal"> / {capacity}</span> : null}</span>
                  </div>
                  {capacity ? <Meter value={sold} max={capacity} className="mt-1" /> : null}
                </>
              ) : (
                <div className="text-xs text-faint">כרטיסים: עוד לא נבדק</div>
              )}
            </div>

            {late > 0 && (
              <div className="mt-2 text-xs font-semibold text-neg-ink">{late === 1 ? 'משימה אחת באיחור' : `${late} משימות באיחור`}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The chosen show's figures on the dark slab: tickets sold against the hall first, because that is
 * what a campaign for a show exists to move, then what it cost and whether the club can tell Meta
 * who bought. The last review's one-line verdict closes it.
 */
export function ShowHero({ show, working }: { show: ShowSummary; working: boolean }) {
  const { weekday } = dateParts(show.date);
  const status = showStatus(show, working);
  const { sold, capacity } = ticketCount(show);
  const perTicket = show.spend && sold ? show.spend / sold : null;
  const year = show.date.slice(0, 4);

  const figure = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-xs text-white/70">{label}</dt>
      <dd className="num text-lg md:text-xl font-bold tracking-[-0.02em] text-white mt-1 truncate">{value}</dd>
      {sub && <dd className="text-xs text-white/60 mt-0.5 truncate">{sub}</dd>}
    </div>
  );

  return (
    <div className="bg-ink text-white px-4 py-5 md:px-6 md:py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-white/70">{weekday} {ddmm(show.date)}/{year} · {daysAway(show.days_left)}</div>
          <h2 className="ser text-2xl md:text-[1.75rem] leading-tight mt-1">{show.venue}</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium">
          <span aria-hidden className={clsx('w-2 h-2 rounded-full', status.tone === 'neutral' ? 'bg-white/50' : DOT[status.tone])} />
          {status.label}
        </span>
      </div>

      <dl className="grid gap-x-6 gap-y-4 grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1 min-w-0">
          <dt className="text-xs text-white/70">כרטיסים שנמכרו</dt>
          <dd className="mt-1 flex items-baseline gap-1.5">
            <span className="num text-4xl font-extrabold tracking-[-0.03em]">{sold ?? '—'}</span>
            {capacity ? <span className="num text-base text-white/60">/ {capacity}</span> : null}
          </dd>
          {sold != null && capacity ? <dd><Meter value={sold} max={capacity} tone="light" className="mt-2" /></dd> : null}
          <dd className="text-xs text-white/60 mt-1.5">
            {show.tickets ? `לפי אתר המועדון · נבדק ${when(show.tickets.created_at)}` : 'עוד לא נבדק באתר המועדון'}
          </dd>
        </div>
        {figure('הוצאה על פרסום', show.spend != null ? nis(show.spend) : '—',
          show.plan?.budget_total ? `מתוך ${nis(show.plan.budget_total)} בתוכנית` : 'אין קמפיין משויך')}
        {figure('עלות לכרטיס', perTicket != null ? `₪${perTicket.toLocaleString('he-IL', { maximumFractionDigits: perTicket < 100 ? 1 : 0 })}` : '—', perTicket != null ? 'הוצאה חלקי כרטיסים' : 'חסרים כרטיסים או הוצאה')}
        {figure('פיקסל באתר המועדון', PIXEL_STATUS[show.pixel_status ?? 'none'] ?? '—')}
      </dl>

      {show.review?.headline && (
        <p className="border-t border-white/10 pt-4 text-[15px] leading-relaxed text-white/90 max-w-[70ch]">
          {show.review.headline}
        </p>
      )}
    </div>
  );
}
