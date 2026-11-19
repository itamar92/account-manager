import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle, Car, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, List, Lock, MapPin, Moon, Navigation,
  StickyNote, Sun, Ticket, User, Users,
} from 'lucide-react';
import { get } from '../../api';
import { byMonth, localDate, monthHeading, relativeDay, type Place } from './boardShared';

interface CrewShow {
  id: string;
  date: string;
  title: string;
  act: string | null;
  is_private: boolean;
  /** «סגור», or «אופציה» — held for a quote the client has not signed (the word in the event's name). */
  status: 'confirmed' | 'option';
  past: boolean;
  place: Place | null;
  call_time: string | null;
  /** The calendar event's start, unless the description or the owner says otherwise. */
  soundcheck_time: string | null;
  doors_time: string | null;
  /** The club's usual hour (זאפה/גריי 21:30); a private event's is typed per show. */
  stage_time: string | null;
  parking: string | null;
  notes: string | null;
  reminders: string[];
  sound_company: string | null;
  members: Array<{ name: string; role: string }>;
  crew: Array<{ role: string; name: string }>;
  ticket_url: string | null;
}

interface CrewData { title: string; band_name: string; today: string; people: string[]; shows: CrewShow[] }

type Tab = 'month' | 'upcoming' | 'all';
type View = 'cards' | 'list';

/**
 * The band's palette, deliberately not the app's: this page is a backstage pass, not a ledger.
 * Night-navy with a magenta accent by default, a light version one tap away.
 */
const THEMES = {
  dark: {
    '--cb-bg': '#13131d', '--cb-card': '#1b1b29', '--cb-raised': '#232334', '--cb-line': '#2b2b3f',
    '--cb-text': '#eceaf6', '--cb-muted': '#8f8ca8', '--cb-accent': '#c950e8', '--cb-accent-ink': '#ffffff',
    '--cb-warn': '#f5a524', '--cb-warn-soft': 'rgba(245,165,36,0.12)', '--cb-chip': '#262638',
  },
  light: {
    '--cb-bg': '#f5f4fa', '--cb-card': '#ffffff', '--cb-raised': '#f1effa', '--cb-line': '#e3e0ef',
    '--cb-text': '#1d1a2e', '--cb-muted': '#6f6b88', '--cb-accent': '#b23fd6', '--cb-accent-ink': '#ffffff',
    '--cb-warn': '#c27803', '--cb-warn-soft': 'rgba(245,165,36,0.14)', '--cb-chip': '#efedf7',
  },
} as const;

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const wd = (iso: string, style: 'long' | 'short' | 'narrow') =>
  localDate(iso).toLocaleDateString('he-IL', { weekday: style }).replace('יום ', '');
const mon = (iso: string) => localDate(iso).toLocaleDateString('he-IL', { month: 'short' });

const involves = (show: CrewShow, person: string) =>
  show.members.some((m) => m.name === person) || show.crew.some((c) => c.name === person) || show.sound_company === person;

/**
 * The band's link: the coming shows with what each night needs — who plays, the sound company,
 * when to arrive, the sound check, parking, what to bring. No login; the token is the credential
 * (server/showBoard.ts). Money never appears here.
 */
export function CrewBoard() {
  const { token } = useParams();
  const [data, setData] = useState<CrewData | null>(null);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (store.get('crew-theme') === 'light' ? 'light' : 'dark'));
  const [person, setPerson] = useState(() => store.get('crew-person') ?? '');
  const [tab, setTab] = useState<Tab>('upcoming');
  const [view, setView] = useState<View>(() => (store.get('crew-view') === 'list' ? 'list' : 'cards'));

  useEffect(() => {
    get<CrewData>(`/public/boards/crew/${token}`).then((d) => {
      setData(d);
      document.title = d.title;
    }).catch((e) => setError(e.message));
  }, [token]);
  useEffect(() => { document.body.style.background = THEMES[theme]['--cb-bg']; store.set('crew-theme', theme); }, [theme]);
  useEffect(() => { store.set('crew-person', person); }, [person]);
  useEffect(() => { store.set('crew-view', view); }, [view]);

  // A name remembered from an earlier visit who is no longer on any show is quietly dropped.
  const activePerson = data && person && data.people.includes(person) ? person : '';
  const mine = useMemo(
    () => (data?.shows ?? []).filter((s) => !activePerson || involves(s, activePerson)),
    [data, activePerson]
  );
  const listed = tab === 'upcoming' ? mine.filter((s) => !s.past) : mine;

  return (
    <div dir="rtl" style={THEMES[theme] as React.CSSProperties}
      className="min-h-screen bg-[var(--cb-bg)] text-[var(--cb-text)] transition-colors">
      <main className="max-w-[640px] mx-auto px-4 py-6 md:py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight leading-tight">{data?.title ?? 'לוח הופעות'}</h1>
            <p className="text-sm text-[var(--cb-muted)] mt-1">כל ההופעות, השעות והצוות</p>
          </div>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="החלפת תצוגה בהירה/כהה"
            className="shrink-0 w-10 h-10 rounded-full grid place-items-center bg-[var(--cb-raised)] border border-[var(--cb-line)] hover:brightness-110">
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </header>

        {error && <div className="mt-6 rounded-2xl border border-[var(--cb-line)] bg-[var(--cb-card)] p-6 text-center">{error}</div>}
        {!data && !error && <div className="mt-16 text-center text-[var(--cb-muted)]">טוען…</div>}

        {data && (
          <>
            <label className="mt-5 flex items-center gap-2.5 rounded-xl border border-[var(--cb-line)] bg-[var(--cb-raised)] px-3.5 h-11">
              <User size={16} className="text-[var(--cb-muted)] shrink-0" />
              <select value={activePerson} onChange={(e) => setPerson(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm appearance-none cursor-pointer">
                <option value="">{`כל ${data.band_name} · בחרו שם לראות רק את שלכם`}</option>
                {data.people.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <ChevronDown size={15} className="text-[var(--cb-muted)] shrink-0" />
            </label>

            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 grid grid-cols-3 rounded-xl bg-[var(--cb-raised)] border border-[var(--cb-line)] p-1">
                {([['month', 'חודשי'], ['upcoming', 'קרובות'], ['all', 'כל ההופעות']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setTab(key)}
                    className={`h-8 rounded-lg text-sm font-semibold transition ${tab === key
                      ? 'bg-[var(--cb-card)] text-[var(--cb-text)] shadow-sm'
                      : 'text-[var(--cb-muted)] hover:text-[var(--cb-text)]'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {tab !== 'month' && (
                <div className="flex rounded-xl bg-[var(--cb-raised)] border border-[var(--cb-line)] p-1">
                  {([['cards', LayoutGrid, 'כרטיסים'], ['list', List, 'רשימה']] as const).map(([key, Icon, label]) => (
                    <button key={key} onClick={() => setView(key)} aria-label={label} title={label}
                      className={`w-9 h-8 rounded-lg grid place-items-center transition ${view === key
                        ? 'bg-[var(--cb-card)] text-[var(--cb-text)] shadow-sm' : 'text-[var(--cb-muted)]'}`}>
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {tab === 'month'
              ? <MonthView shows={mine} today={data.today} person={activePerson} />
              : !listed.length
                ? <Empty text={activePerson ? `אין הופעות של ${activePerson} כרגע.` : 'אין הופעות קרובות.'} />
                : byMonth(listed).map((group) => (
                  <section key={group.month} className="mt-7">
                    <h2 className="text-sm font-bold text-[var(--cb-muted)] mb-3">{monthHeading(`${group.month}-01`)}</h2>
                    {view === 'cards'
                      ? <div className="space-y-3">{group.items.map((s) => <ShowCard key={s.id} show={s} person={activePerson} />)}</div>
                      : <ListGroup shows={group.items} person={activePerson} />}
                  </section>
                ))}
          </>
        )}
      </main>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="mt-8 rounded-2xl border border-dashed border-[var(--cb-line)] p-8 text-center text-[var(--cb-muted)]">{text}</div>;
}

function DateTile({ date, past }: { date: string; past?: boolean }) {
  return (
    <div className={`shrink-0 w-[58px] rounded-xl flex flex-col items-center justify-center py-2 bg-[var(--cb-accent)] text-[var(--cb-accent-ink)] ${past ? 'opacity-45' : ''}`}>
      <span className="text-[11px] font-semibold opacity-90">{wd(date, 'long')}</span>
      <span className="text-[26px] font-extrabold leading-none my-0.5">{localDate(date).getDate()}</span>
      <span className="text-[11px] font-semibold opacity-90">{mon(date)}</span>
    </div>
  );
}

function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warn' | 'accent' }) {
  const tones = {
    plain: 'bg-[var(--cb-chip)] text-[var(--cb-text)] border-[var(--cb-line)]',
    warn: 'bg-[var(--cb-warn)] text-[#1b1206] border-transparent',
    accent: 'bg-[var(--cb-accent)] text-[var(--cb-accent-ink)] border-transparent',
  };
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
}

function ShowCard({ show, person, embedded }: { show: CrewShow; person: string; embedded?: boolean }) {
  const [crewOpen, setCrewOpen] = useState(!!person);
  useEffect(() => setCrewOpen(!!person), [person]);
  const soon = relativeDay(show.date);
  const team = [
    ...show.members.map((m) => ({ name: m.name, role: m.role })),
    ...(show.sound_company ? [{ name: show.sound_company, role: 'חברת הגברה' }] : []),
    ...show.crew,
  ];
  const times = [
    ['הגעה', show.call_time], ['בלאנס', show.soundcheck_time], ['פתיחת דלתות', show.doors_time], ['עלייה לבמה', show.stage_time],
  ].filter(([, v]) => v) as Array<[string, string]>;

  return (
    <article className={`${embedded ? '' : `rounded-2xl border bg-[var(--cb-card)] ${show.status === 'option'
      ? 'border-dashed border-[var(--cb-warn)]' : 'border-[var(--cb-line)]'}`} p-4 ${show.past ? 'opacity-70' : ''}`}>
      <div className="flex gap-4">
        <DateTile date={show.date} past={show.past} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {soon && <Badge tone="accent">{soon}</Badge>}
            {show.status === 'option' ? <Badge tone="warn">אופציה</Badge> : <Badge>סגור</Badge>}
            {show.is_private && <Badge><Lock size={10} /> פרטי</Badge>}
            {show.ticket_url && (
              <a href={show.ticket_url} target="_blank" rel="noopener noreferrer"><Badge><Ticket size={10} /> כרטיסים</Badge></a>
            )}
            {show.past && <Badge>עבר</Badge>}
          </div>
          <h3 className="text-[19px] font-extrabold leading-snug">{show.title}</h3>
          {show.act && <div className="text-sm text-[var(--cb-muted)]">{show.act}</div>}
          {show.place && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="inline-flex items-start gap-1.5">
                <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--cb-muted)]" />
                <span>{show.place.name}{show.place.address && <span className="text-[var(--cb-muted)]"> · {show.place.address}</span>}</span>
              </span>
              <a href={show.place.waze_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-bold text-[var(--cb-accent)] hover:underline">
                <Navigation size={13} /> Waze
              </a>
            </div>
          )}
        </div>
      </div>

      {(show.reminders.length > 0 || times.length > 0 || show.parking || show.notes) && (
        <div className="mt-3.5 space-y-2.5">
          {show.reminders.map((r) => (
            <div key={r} className="flex items-center gap-2 rounded-xl bg-[var(--cb-warn-soft)] text-[var(--cb-warn)] px-3 py-2 text-sm font-bold">
              <AlertTriangle size={15} className="shrink-0" /> לא לשכוח: {r}
            </div>
          ))}
          {times.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {times.map(([label, value]) => (
                <div key={label} className="rounded-lg bg-[var(--cb-raised)] border border-[var(--cb-line)] px-2.5 py-1.5 flex items-baseline gap-1.5">
                  <span className="text-[12px] text-[var(--cb-muted)]">{label}</span>
                  <span className="text-[15px] font-extrabold tabular-nums" dir="ltr">{value}</span>
                </div>
              ))}
            </div>
          )}
          {show.parking && (
            <div className="flex items-start gap-2 text-sm">
              <Car size={15} className="mt-0.5 shrink-0 text-[var(--cb-muted)]" />
              <span><span className="text-[var(--cb-muted)]">חניה: </span>{show.parking}</span>
            </div>
          )}
          {show.notes && (
            <div className="flex items-start gap-2 text-sm whitespace-pre-line">
              <StickyNote size={15} className="mt-0.5 shrink-0 text-[var(--cb-muted)]" />
              <span>{show.notes}</span>
            </div>
          )}
        </div>
      )}

      {team.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setCrewOpen(!crewOpen)} className="inline-flex items-center gap-1.5 text-sm font-extrabold">
            <Users size={15} /> צוות ({team.length})
            <ChevronDown size={15} className={`text-[var(--cb-muted)] transition-transform ${crewOpen ? 'rotate-180' : ''}`} />
          </button>
          {crewOpen && (
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-[var(--cb-raised)] p-3.5">
              {team.map((t) => (
                <div key={`${t.role}-${t.name}`} className={t.name === person ? 'text-[var(--cb-accent)]' : ''}>
                  <div className="text-sm font-bold leading-tight">{t.name}</div>
                  <div className="text-[12px] text-[var(--cb-muted)]">{t.role}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function ListGroup({ shows, person }: { shows: CrewShow[]; person: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="rounded-2xl border border-[var(--cb-line)] bg-[var(--cb-card)] overflow-hidden divide-y divide-[var(--cb-line)]">
      {shows.map((s) => {
        const d = localDate(s.date);
        const isOpen = open === s.id;
        return (
          <div key={s.id} className={s.past ? 'opacity-70' : ''}>
            <button onClick={() => setOpen(isOpen ? null : s.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-[var(--cb-raised)] ${s.status === 'option' ? 'outline-1 outline-dashed outline-[var(--cb-warn)] -outline-offset-4 rounded-xl' : ''}`}>
              <span className="w-[3px] self-stretch rounded-full bg-[var(--cb-accent)]" />
              <span className="w-11 shrink-0 text-center">
                <span className="block text-[15px] font-extrabold tabular-nums">{d.getDate()}.{d.getMonth() + 1}</span>
                <span className="block text-[11px] text-[var(--cb-muted)]">{wd(s.date, 'narrow')}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold truncate">{s.title}</span>
                <span className="block text-[12px] text-[var(--cb-muted)] truncate">
                  {[
                    s.act,
                    s.call_time ? `הגעה ${s.call_time}` : s.soundcheck_time && `בלאנס ${s.soundcheck_time}`,
                    s.stage_time && `במה ${s.stage_time}`,
                  ].filter(Boolean).join(' · ')}
                </span>
              </span>
              {s.status === 'option' && <Badge tone="warn">אופציה</Badge>}
              {s.is_private && <Badge>פרטי</Badge>}
              <ChevronDown size={16} className={`shrink-0 text-[var(--cb-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && <div className="px-2 pb-2"><div className="rounded-xl border border-[var(--cb-line)] bg-[var(--cb-card)]"><ShowCard show={s} person={person} embedded /></div></div>}
          </div>
        );
      })}
    </div>
  );
}

/** A month on a grid, Sunday first; a day with a show is marked and opens it underneath. */
function MonthView({ shows, today, person }: { shows: CrewShow[]; today: string; person: string }) {
  const [cursor, setCursor] = useState(() => today.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);
  const [y, m] = cursor.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const byDay = new Map<string, CrewShow[]>();
  for (const s of shows) if (s.date.startsWith(cursor)) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  const move = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setPicked(null);
  };
  const cells: Array<string | null> = [...Array(first.getDay()).fill(null),
    ...Array.from({ length: days }, (_, i) => `${cursor}-${String(i + 1).padStart(2, '0')}`)];
  const inMonth = shows.filter((s) => s.date.startsWith(cursor));
  const shown = picked ? byDay.get(picked) ?? [] : inMonth;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => move(-1)} aria-label="החודש הקודם" className="w-9 h-9 rounded-full grid place-items-center bg-[var(--cb-raised)]"><ChevronRight size={17} /></button>
        <div className="font-extrabold">{monthHeading(`${cursor}-01`)}</div>
        <button onClick={() => move(1)} aria-label="החודש הבא" className="w-9 h-9 rounded-full grid place-items-center bg-[var(--cb-raised)]"><ChevronLeft size={17} /></button>
      </div>
      <div className="rounded-2xl border border-[var(--cb-line)] bg-[var(--cb-card)] p-2.5">
        <div className="grid grid-cols-7 text-center text-[11px] text-[var(--cb-muted)] mb-1">
          {['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((iso, i) => {
            if (!iso) return <div key={`e${i}`} />;
            const list = byDay.get(iso);
            const isToday = iso === today;
            const isPicked = iso === picked;
            return (
              <button key={iso} disabled={!list} onClick={() => setPicked(isPicked ? null : iso)}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition
                  ${list ? (list.every((x) => x.status === 'option')
                  ? 'border-2 border-dashed border-[var(--cb-warn)] text-[var(--cb-text)] font-extrabold'
                  : 'bg-[var(--cb-accent)] text-[var(--cb-accent-ink)] font-extrabold') : 'text-[var(--cb-muted)]'}
                  ${isPicked ? 'ring-2 ring-[var(--cb-text)]' : ''} ${isToday && !list ? 'border border-[var(--cb-accent)] text-[var(--cb-text)]' : ''}`}>
                {localDate(iso).getDate()}
                {list && list.length > 1 && <span className="text-[9px] font-bold opacity-90">×{list.length}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {shown.length
        ? <div className="mt-4 space-y-3">{shown.map((s) => <ShowCard key={s.id} show={s} person={person} />)}</div>
        : <Empty text="אין הופעות בחודש הזה." />}
    </div>
  );
}
