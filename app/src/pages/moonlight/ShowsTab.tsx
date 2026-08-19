import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { del, get, post, nis } from '../../api';
import { Button, Combobox, Empty, FilterBar, PageHeader, Pill, PeriodSelect, SearchInput, textMatch } from '../../ui';
import { eventLabel, expenseRowTotal, paymentStatusLabel, type PeriodTabProps } from './shared';

const HEB_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

const today = () => new Date().toISOString().slice(0, 10);

/** Status colours for the pill: [background, text]. */
const STATUS_TONE: Record<string, [string, string]> = {
  waiting_report: ['bg-soft', 'text-muted'],
  invoice_sent: ['bg-moon-soft', 'text-moon'],
  received: ['bg-pos-soft', 'text-pos'],
};

type Filter = 'upcoming' | 'past' | 'all';

const FILTERS: Array<[Filter, string]> = [
  ['upcoming', 'קרובות'],
  ['past', 'שהתקיימו'],
  ['all', 'הכל'],
];

interface Props extends PeriodTabProps {
  events: any[];
  onNewEvent: () => void;
}

/**
 * The shows, one card each — the way into everything about a show.
 *
 * There is no editing here on purpose. A row that let you type income into it was how the band
 * ended up reading one show across three tabs; a card that says where the show stands and opens
 * the whole thing is the shorter road to the same numbers.
 */
export function ShowsTab({ events, period, isOwner, onError, reload, onNewEvent }: Props) {
  const navigate = useNavigate();
  // Null means "nobody has chosen yet", which is not the same as choosing קרובות: a band
  // looking at a finished year would otherwise open the page on an empty list.
  const [chosen, setChosen] = useState<Filter | null>(null);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);

  const syncCalendar = async () => {
    setSyncing(true);
    onError('');
    try {
      const d = await post('/integrations/calendar/sync');
      const r = d.result;
      if (r.created + r.updated + r.linked === 0) onError(`לא נמצאו הופעות חדשות (${r.matched} אירועים תואמים)`);
      reload();
    } catch (err: any) { onError(err.message); }
    finally { setSyncing(false); }
  };

  const now = today();
  const upcomingCount = events.filter((e) => e.date >= now).length;
  const filter: Filter = chosen ?? (upcomingCount > 0 ? 'upcoming' : 'past');
  const setFilter = setChosen;

  const visible = useMemo(() => {
    const matched = events.filter((e) => textMatch(search, e.venue, e.location));
    const byFilter = filter === 'all' ? matched
      : filter === 'upcoming' ? matched.filter((e) => e.date >= now)
      : matched.filter((e) => e.date < now);
    // Upcoming reads forwards — the next show first; history reads backwards.
    return [...byFilter].sort((a, b) =>
      filter === 'upcoming' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  }, [events, search, filter, now]);

  const count = (f: Filter) => (f === 'all' ? events.length
    : f === 'upcoming' ? upcomingCount
    : events.length - upcomingCount);

  const unbilled = events.filter((e) => e.payment_status !== 'received' && e.date < now);
  const unbilledTotal = unbilled.reduce((sum, e) => sum + (Number(e.amount_pre_vat) || 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="הופעות"
        sub={
          <>
            <span className="num">{events.length}</span> בטווח · <span className="num">{count('upcoming')}</span> קרובות
            {unbilled.length > 0 && <> · <span className="num text-warn">{nis(unbilledTotal)}</span> טרם התקבל</>}
          </>
        }
        actions={isOwner && (
          <>
            <Button variant="ghost" disabled={syncing} onClick={syncCalendar}>
              {syncing ? 'מסנכרן…' : 'משיכה מהיומן'}
            </Button>
            <Button onClick={onNewEvent}>הופעה חדשה</Button>
          </>
        )}
      />

      <FilterBar>
        {FILTERS.map(([key, label]) => (
          <Pill key={key} active={filter === key} onClick={() => setFilter(key)}>
            {label} {count(key)}
          </Pill>
        ))}
        <span className="w-px h-6 bg-line mx-0.5" />
        <PeriodSelect year={period.year} month={period.month}
          onYearChange={period.setYear} onMonthChange={period.setMonth} />
        <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי מקום…" className="flex-1 min-w-[9rem] sm:max-w-xs" />
      </FilterBar>

      {isOwner && <OrphanCosts onError={onError} onChange={reload} />}

      {visible.length === 0 ? (
        <Empty text="אין הופעות בטווח הזה" />
      ) : (
        <div className="space-y-2.5">
          {visible.map((e) => (
            <ShowCard key={e.id} show={e} onOpen={() => navigate(`/moonlight/shows/${e.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Cost rows that name no show.
 *
 * Every show owns exactly one expense row, created with it — so these can only be leftovers
 * from the spreadsheet migration, where a row named its show in prose and the matching could
 * not be certain. They are the one thing about a show's costs that cannot be fixed from the
 * show itself, since the row does not yet know which show it belongs to.
 *
 * A leftover has two ends, which is why the row offers both: it either names a show whose
 * costs are still missing, and is attached to it, or it restates costs the show already
 * carries, and is deleted. Attaching was the only option here before, so a row of the second
 * kind — the migration's own duplicate of a show already typed up in full — could not be
 * cleared at all: the show refuses a second row of figures, and the panel stayed for good.
 * The row's total is shown because that is what tells the two apart at a glance.
 */
function OrphanCosts({ onError, onChange }: { onError: (m: string) => void; onChange: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [shows, setShows] = useState<any[]>([]);

  const load = () => {
    get('/moonlight/event-expenses')
      .then((d) => setRows((d.expenses || []).filter((x: any) => !x.event_id)))
      .catch(() => {});
    get('/moonlight/events').then((d) => setShows(d.events)).catch(() => {});
  };
  useEffect(load, []);

  if (rows.length === 0) return null;

  const attach = async (row: any, eventId: string) => {
    if (!eventId) return;
    onError('');
    try {
      await post(`/moonlight/event-expenses/${row.id}/assign`, { event_id: eventId });
      load();
      onChange();
    } catch (err: any) { onError(err.message); }
  };

  // Deleting one is final — an unassigned row belongs to no show, so there is nowhere for its
  // figures to survive. The total goes into the question, since that is the whole of what is lost.
  const remove = async (row: any) => {
    const total = expenseRowTotal(row);
    const worth = total ? ` על סך ${nis(total)}` : '';
    if (!confirm(`למחוק את שורת העלויות «${row.event}»${worth}? הפעולה אינה הפיכה.`)) return;
    onError('');
    try {
      await del(`/moonlight/event-expenses/${row.id}`);
      load();
      onChange();
    } catch (err: any) { onError(err.message); }
  };

  return (
    <div className="bg-surface border border-line border-s-[3px] border-s-warn rounded-2xl p-4 md:p-5">
      <h2 className="ser text-base">{rows.length} שורות עלויות ללא שיוך להופעה</h2>
      <p className="text-[13px] text-muted mt-1 mb-3">
        שורות מהגיליון הישן שלא הותאמו לשום הופעה. עד שישויכו, הסכומים שבהן אינם נספרים באף הופעה.
        שורה שהעלויות שבה כבר רשומות בהופעה עצמה אפשר למחוק — היא כפילות מהגיליון הישן.
      </p>
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 flex-wrap text-sm">
            <span className="flex-1 min-w-[10rem] font-medium truncate">{row.event}</span>
            <span className="num text-muted shrink-0">{nis(expenseRowTotal(row))}</span>
            <Combobox
              className="w-56"
              value=""
              placeholder="בחרו הופעה לשיוך…"
              options={shows.map((e) => ({ value: e.id, label: eventLabel(e) }))}
              onChange={(v) => attach(row, v)}
            />
            <button
              type="button"
              onClick={() => remove(row)}
              className="shrink-0 text-[13px] font-semibold text-neg hover:underline px-1 py-1"
            >
              מחיקה
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShowCard({ show, onOpen }: { show: any; onOpen: () => void }) {
  const [day, month] = [show.date.slice(8, 10), HEB_MONTHS[parseInt(show.date.slice(5, 7), 10) - 1]];
  const sold = Number(show.tickets) || 0;
  const capacity = Number(show.capacity) || 0;
  const fill = capacity ? Math.min(Math.round((sold / capacity) * 100), 100) : 0;
  const income = Number(show.amount_pre_vat) || 0;
  const profit = Number(show.profit) || 0;
  const missing: string[] = show.missing || [];
  const [pillBg, pillText] = STATUS_TONE[show.payment_status] ?? STATUS_TONE.waiting_report;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-start bg-surface border border-line rounded-2xl px-4 py-3.5 md:px-5
                 flex items-center gap-4 flex-wrap hover:border-line-strong hover:shadow-[0_2px_10px_rgba(20,24,32,.06)] transition"
    >
      <div className="w-14 text-center shrink-0">
        <div className="num text-[22px] font-extrabold tracking-[-0.03em] leading-none">{day}</div>
        <div className="text-xs text-faint">{month}</div>
      </div>

      <div className="flex-1 min-w-[9rem]">
        <div className="text-base font-semibold truncate">{show.venue}</div>
        <div className="text-[13.5px] text-muted mt-0.5 truncate">
          {missing.length > 0
            ? <span className="text-warn">חסר: {missing.map(roleLabel).join(', ')}</span>
            : show.location || show.date}
        </div>
      </div>

      {/* Tickets read as a proportion only when somebody has said how big the room is. */}
      <div className="w-[8.5rem] shrink-0 hidden sm:flex flex-col gap-1.5">
        <div className="num text-[13px] text-body">
          {capacity ? `${sold.toLocaleString('he-IL')} / ${capacity.toLocaleString('he-IL')}` : `${sold.toLocaleString('he-IL')} כרטיסים`}
        </div>
        {capacity > 0 && (
          <span className="h-1.5 bg-soft rounded-full overflow-hidden">
            <span
              className={clsx('block h-full rounded-full', fill > 80 ? 'bg-moon' : 'bg-moon/55')}
              style={{ width: `${fill}%` }}
            />
          </span>
        )}
      </div>

      <span className={clsx('text-[12.5px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap shrink-0', pillBg, pillText)}>
        {paymentStatusLabel(show.payment_status)}
      </span>

      <div className="w-24 shrink-0 text-start">
        <div className="num ser text-lg">{nis(income)}</div>
        <div className="num text-[12.5px] text-faint">רווח {nis(profit)}</div>
      </div>
    </button>
  );
}

const ROLE_LABELS: Record<string, string> = {
  lightman: 'תאורן', soundman: 'סאונדמן', singer: 'זמר/ת', sound_company: 'חברת הגברה',
};
const roleLabel = (key: string) => ROLE_LABELS[key] || key;
