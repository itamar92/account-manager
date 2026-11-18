import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, MapPin, Navigation, Share2, Ticket } from 'lucide-react';
import { get } from '../../api';
import { byMonth, dayNumber, monthHeading, monthShort, relativeDay, weekday, type Place } from './boardShared';

interface PublicShow {
  id: string;
  date: string;
  time: string | null;
  title: string;
  place: Place | null;
  ticket_url: string | null;
}

/**
 * The friends' link: every upcoming show, tidy, with where and when and a way to buy a ticket.
 * No login and no shell — see server/showBoard.ts. Private events never reach this page.
 */
export function PublicShowBoard() {
  const { token } = useParams();
  const [data, setData] = useState<{ title: string; shows: PublicShow[] } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { document.documentElement.dataset.ws = 'moon'; }, []);
  useEffect(() => {
    get(`/public/boards/shows/${token}`).then((d) => {
      setData(d);
      document.title = d.title;
    }).catch((e) => setError(e.message));
  }, [token]);

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
        {data && !data.shows.length && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-8 text-center text-white/70">
            עוד אין תאריכים חדשים. כדאי לחזור לכאן בקרוב 🎶
          </div>
        )}
        {data && byMonth(data.shows).map((group) => (
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
  return (
    <li className="flex gap-4 rounded-2xl bg-white/[0.06] border border-white/10 p-4 hover:bg-white/[0.09] transition">
      <div className="shrink-0 w-16 rounded-xl bg-violet-500/20 border border-violet-300/20 flex flex-col items-center justify-center py-2">
        <span className="text-[11px] text-violet-100/80">{monthShort(show.date)}</span>
        <span className="text-2xl font-extrabold leading-none mt-0.5">{dayNumber(show.date)}</span>
        <span className="text-[11px] text-violet-100/70 mt-1">{weekday(show.date).replace('יום ', '')}</span>
      </div>
      <div className="min-w-0 flex-1">
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
        </div>
      </div>
    </li>
  );
}
