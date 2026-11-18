import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Clock, Link2, MapPin, Navigation, Search, Share2, Ticket, X } from 'lucide-react';
import { get } from '../../api';
import { byMonth, dayNumber, monthHeading, monthShort, relativeDay, weekday, type Place } from './boardShared';

interface PublicShow {
  id: string;
  date: string;
  time: string | null;
  title: string;
  place: Place | null;
  region: string | null;
  act: string | null;
  ticket_url: string | null;
}

/** Each act keeps one colour wherever it appears, picked from its name. */
export function actHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function ActBadge({ name, active, onClick, size = 'md' }: {
  name: string; active?: boolean; onClick?: () => void; size?: 'sm' | 'md';
}) {
  const hue = actHue(name);
  const style = active
    ? { background: `hsl(${hue} 85% 68%)`, color: '#16121f', borderColor: `hsl(${hue} 85% 68%)` }
    : { background: `hsl(${hue} 70% 60% / 0.14)`, color: `hsl(${hue} 90% 82%)`, borderColor: `hsl(${hue} 70% 65% / 0.35)` };
  const cls = `shrink-0 inline-flex items-center gap-1.5 rounded-full border font-semibold transition ${size === 'sm'
    ? 'text-[11px] px-2 py-0.5' : 'text-sm px-3.5 py-1.5'}`;
  const dot = <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? '#16121f' : `hsl(${hue} 90% 72%)` }} />;
  return onClick
    ? <button onClick={onClick} className={cls} style={style}>{dot}{name}</button>
    : <span className={cls} style={style}>{dot}{name}</span>;
}

/** Loose text match: case, spacing and the geresh people type three different ways. */
const fold = (s: string) => s.toLowerCase().replace(/[׳'`"״]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The friends' link: every upcoming show, tidy, with where and when and a way to buy a ticket.
 * No login and no shell — see server/showBoard.ts. Private events never reach this page.
 */
export function PublicShowBoard() {
  const { token } = useParams();
  const [data, setData] = useState<{ title: string; shows: PublicShow[]; regions: string[] } | null>(null);
  // The filters live in the address, so a filtered board («הופעות בצפון») can be shared as is.
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const region = params.get('region') ?? '';
  const act = params.get('act') ?? '';
  const single = params.get('show') ?? '';
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { document.documentElement.dataset.ws = 'moon'; }, []);
  useEffect(() => {
    get(`/public/boards/shows/${token}`).then((d) => {
      setData(d);
      document.title = d.title;
    }).catch((e) => setError(e.message));
  }, [token]);

  // The acts on the board, the busiest first: a badge per act, generated from the shows themselves.
  const acts = data ? Object.entries(data.shows.reduce<Record<string, number>>((m, show) => {
    if (show.act) m[show.act] = (m[show.act] ?? 0) + 1;
    return m;
  }, {})).sort((a, b) => b[1] - a[1]).map(([name]) => name) : [];
  const regionsPresent = data ? data.regions.filter((r) => data.shows.some((show) => show.region === r)) : [];
  const shown = !data ? [] : single
    ? data.shows.filter((show) => show.id === single)
    : data.shows.filter((show) => (!region || show.region === region) && (!act || show.act === act)
      && (!query || fold([show.title, show.place?.name, show.place?.address].filter(Boolean).join(' ')).includes(fold(query))));
  const filtered = !!(query || region || act);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: data?.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch { /* the share sheet was dismissed */ }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#16121f] text-white">
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.45),transparent_65%)]" />
        <div className="relative max-w-2xl mx-auto px-4 pt-12 pb-8 md:pt-16">
          <p className="text-[13px] tracking-[0.2em] text-violet-200/80 uppercase">Live</p>
          <h1 className="mt-2 text-3xl md:text-5xl font-extrabold tracking-tight leading-tight">
            {data?.title ?? (error ? 'לוח הופעות' : ' ')}
          </h1>
          {data && (
            <div className="mt-4 flex items-center gap-3 text-sm text-white/70">
              <span>{data.shows.length ? `${data.shows.length} הופעות קרובות` : 'אין הופעות קרובות כרגע'}</span>
              <button onClick={share}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 hover:bg-white/10 transition">
                <Share2 size={14} /> {copied ? 'הקישור הועתק' : 'שיתוף'}
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-16">
        {error && <div className="rounded-2xl bg-white/5 border border-white/10 p-6 text-center text-white/80">{error}</div>}
        {!data && !error && <div className="text-center text-white/50 py-16">טוען…</div>}

        {data && single && (
          <Link to={{ search: '' }} replace className="inline-flex items-center gap-1.5 text-sm text-violet-200 hover:text-white mb-4">
            <ArrowRight size={15} /> לכל ההופעות
          </Link>
        )}

        {data && !single && data.shows.length > 1 && (
          <div className="sticky top-0 z-10 -mx-4 px-4 py-3 mb-4 bg-[#16121f]/90 backdrop-blur border-b border-white/5 space-y-3">
            <label className="flex items-center gap-2 rounded-full bg-white/[0.07] border border-white/10 px-4 py-2 focus-within:border-violet-300/50">
              <Search size={16} className="text-white/50 shrink-0" />
              <input value={query} onChange={(e) => setParam('q', e.target.value)} placeholder="חיפוש הופעה, מקום או עיר"
                className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-white/40" />
              {query && <button onClick={() => setParam('q', '')} aria-label="ניקוי"><X size={16} className="text-white/60" /></button>}
            </label>
            {acts.length > 1 && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
                {acts.map((name) => (
                  <ActBadge key={name} name={name} active={act === name} onClick={() => setParam('act', act === name ? '' : name)} />
                ))}
              </div>
            )}
            {regionsPresent.length > 1 && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
                {['', ...regionsPresent].map((r) => (
                  <button key={r || 'all'} onClick={() => setParam('region', r)}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm border transition ${region === r
                      ? 'bg-white text-[#16121f] border-white font-bold'
                      : 'border-white/15 text-white/75 hover:bg-white/10'}`}>
                    {r || 'כל הארץ'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {data && !data.shows.length && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-8 text-center text-white/70">
            עוד אין תאריכים חדשים. כדאי לחזור לכאן בקרוב 🎶
          </div>
        )}
        {data && !!data.shows.length && !shown.length && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-8 text-center text-white/70">
            {single ? 'ההופעה הזאת כבר לא ברשימה.' : 'אין הופעות שמתאימות לחיפוש.'}
            {filtered && (
              <button onClick={() => setParams(new URLSearchParams(), { replace: true })} className="block mx-auto mt-3 text-violet-200 underline">
                להצגת כל ההופעות
              </button>
            )}
          </div>
        )}
        {byMonth(shown).map((group) => (
          <section key={group.month} className="mt-6 first:mt-0">
            <h2 className="text-[13px] font-semibold text-violet-200/70 mb-3">{monthHeading(`${group.month}-01`)}</h2>
            <ul className="space-y-3">
              {group.items.map((show) => <ShowCard key={show.id} show={show} />)}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}

function ShowCard({ show }: { show: PublicShow }) {
  const soon = relativeDay(show.date);
  const [copied, setCopied] = useState(false);
  // A link to this one show, for sending a friend the one night that matters to them.
  const shareOne = async () => {
    const url = `${window.location.origin}${window.location.pathname}?show=${show.id}`;
    try {
      if (navigator.share) await navigator.share({ title: show.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch { /* dismissed */ }
  };
  return (
    <li className="flex gap-4 rounded-2xl bg-white/[0.06] border border-white/10 p-4 hover:bg-white/[0.09] transition">
      <div className="shrink-0 w-16 rounded-xl bg-violet-500/20 border border-violet-300/20 flex flex-col items-center justify-center py-2">
        <span className="text-[11px] text-violet-100/80">{monthShort(show.date)}</span>
        <span className="text-2xl font-extrabold leading-none mt-0.5">{dayNumber(show.date)}</span>
        <span className="text-[11px] text-violet-100/70 mt-1">{weekday(show.date).replace('יום ', '')}</span>
      </div>
      <div className="min-w-0 flex-1">
        {show.act && <div className="mb-1.5"><ActBadge name={show.act} size="sm" /></div>}
        <div className="flex flex-wrap items-center gap-2">
          {soon && <span className="rounded-full bg-amber-400 text-[#16121f] text-[11px] font-bold px-2 py-0.5">{soon}</span>}
          <h3 className="text-lg font-bold leading-snug">{show.title}</h3>
        </div>
        <div className="mt-1.5 space-y-1 text-sm text-white/70">
          {show.time && <div className="flex items-center gap-1.5"><Clock size={14} /> <span dir="ltr">{show.time}</span></div>}
          {show.place && (
            <div className="flex items-start gap-1.5">
              <MapPin size={14} className="mt-0.5 shrink-0" />
              <span>
                <span className="text-white/85">{show.place.name}</span>
                {show.place.address && <span className="text-white/50"> · {show.place.address}</span>}
              </span>
              {show.region && <span className="shrink-0 rounded-full bg-white/10 text-[11px] px-2 py-0.5 text-white/70">{show.region}</span>}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {show.ticket_url && (
            <a href={show.ticket_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-white text-[#16121f] text-sm font-bold px-4 py-1.5 hover:bg-violet-100 transition">
              <Ticket size={15} /> כרטיסים
            </a>
          )}
          {show.place && (
            <a href={show.place.waze_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 text-sm px-3 py-1.5 hover:bg-white/10 transition">
              <Navigation size={14} /> Waze
            </a>
          )}
          <button onClick={shareOne}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 text-sm px-3 py-1.5 hover:bg-white/10 transition">
            <Link2 size={14} /> {copied ? 'הועתק' : 'שליחת ההופעה'}
          </button>
        </div>
      </div>
    </li>
  );
}
