import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Car, Lock, MapPin, Navigation, Speaker, StickyNote, Users } from 'lucide-react';
import { get } from '../../api';
import { byMonth, fullDate, monthHeading, relativeDay, type Place } from './boardShared';

interface CrewShow {
  id: string;
  date: string;
  time: string | null;
  title: string;
  is_private: boolean;
  place: Place | null;
  call_time: string | null;
  soundcheck_time: string | null;
  stage_time: string | null;
  parking: string | null;
  notes: string | null;
  reminders: string[];
  sound_company: string | null;
  members: Array<{ name: string; role: string }>;
  crew: Array<{ role: string; name: string }>;
  ticket_url: string | null;
}

/**
 * The band's link: the coming shows with what each night needs — who plays what, the sound
 * company, when to arrive, when the sound check starts, where to park, and what to bring.
 * No login; the token is the credential (server/showBoard.ts). Money never appears here.
 */
export function CrewBoard() {
  const { token } = useParams();
  const [data, setData] = useState<{ title: string; shows: CrewShow[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { document.documentElement.dataset.ws = 'moon'; }, []);
  useEffect(() => {
    get(`/public/boards/crew/${token}`).then((d) => {
      setData(d);
      document.title = d.title;
    }).catch((e) => setError(e.message));
  }, [token]);

  return (
    <div dir="rtl" className="min-h-screen bg-canvas">
      <main className="max-w-2xl mx-auto px-4 py-6 md:py-10 space-y-5">
        <header>
          <h1 className="ser text-2xl md:text-3xl text-ink">{data?.title ?? 'לוח הופעות לצוות'}</h1>
          <p className="mt-1 text-sm text-muted">לשימוש פנימי — לא להעביר הלאה.</p>
        </header>
        {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-3">{error}</div>}
        {!data && !error && <div className="text-center text-faint py-10">טוען…</div>}
        {data && !data.shows.length && <div className="text-center text-faint py-10">אין הופעות קרובות.</div>}
        {data && byMonth(data.shows).map((group) => (
          <section key={group.month} className="space-y-3">
            <h2 className="text-[13px] font-semibold text-muted">{monthHeading(`${group.month}-01`)}</h2>
            {group.items.map((show) => <CrewCard key={show.id} show={show} />)}
          </section>
        ))}
      </main>
    </div>
  );
}

function TimeCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl bg-soft border border-line px-3 py-2 text-center">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="num text-lg font-bold text-ink" dir="ltr">{value ?? '—'}</div>
    </div>
  );
}

function CrewCard({ show }: { show: CrewShow }) {
  const soon = relativeDay(show.date);
  const times = [
    { label: 'הגעה', value: show.call_time },
    { label: 'בלאנס', value: show.soundcheck_time },
    { label: 'עלייה לבמה', value: show.stage_time },
    { label: 'שעת האירוע', value: show.time !== show.stage_time ? show.time : null },
  ].filter((t, i) => t.value || i < 2);

  return (
    <article className="bg-surface border border-line rounded-2xl p-4 md:p-5 space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="font-semibold text-ink-2">{fullDate(show.date)}</span>
          {soon && <span className="rounded-full bg-accent text-white text-[11px] font-bold px-2 py-0.5">{soon}</span>}
          {show.is_private && (
            <span className="inline-flex items-center gap-1 rounded-full bg-soft border border-line text-[11px] px-2 py-0.5">
              <Lock size={11} /> אירוע פרטי
            </span>
          )}
        </div>
        <h3 className="mt-1 text-xl font-bold text-ink">{show.title}</h3>
        {show.place && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-body">
            <span className="inline-flex items-start gap-1.5">
              <MapPin size={14} className="mt-0.5 shrink-0" />
              <span>{show.place.name}{show.place.address && <span className="text-muted"> · {show.place.address}</span>}</span>
            </span>
            <a href={show.place.waze_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent font-semibold hover:underline">
              <Navigation size={13} /> Waze
            </a>
            <a href={show.place.maps_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              מפה
            </a>
          </div>
        )}
      </div>

      {show.reminders.map((r) => (
        <div key={r} className="flex items-center gap-2 rounded-xl bg-warn-soft text-warn-ink border border-warn/25 px-3 py-2 text-sm font-semibold">
          <AlertTriangle size={16} className="shrink-0" /> לא לשכוח: {r}
        </div>
      ))}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {times.map((t) => <TimeCell key={t.label} label={t.label} value={t.value} />)}
      </div>

      {show.parking && (
        <div className="flex items-start gap-2 text-sm text-ink-2">
          <Car size={16} className="mt-0.5 shrink-0 text-muted" />
          <span><span className="text-muted">חניה: </span>{show.parking}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-muted mb-1.5"><Users size={14} /> בהרכב</div>
          <ul className="text-sm space-y-1">
            {show.members.map((m) => (
              <li key={m.name} className="flex justify-between gap-3">
                <span className="text-muted">{m.role}</span><span className="text-ink font-medium">{m.name}</span>
              </li>
            ))}
            {!show.members.length && <li className="text-faint">לא צוין</li>}
          </ul>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-muted mb-1.5"><Speaker size={14} /> צוות טכני</div>
          <ul className="text-sm space-y-1">
            <li className="flex justify-between gap-3">
              <span className="text-muted">חברת הגברה</span>
              <span className={show.sound_company ? 'text-ink font-medium' : 'text-faint'}>{show.sound_company ?? 'אין / לא שובצה'}</span>
            </li>
            {show.crew.map((c) => (
              <li key={`${c.role}-${c.name}`} className="flex justify-between gap-3">
                <span className="text-muted">{c.role}</span><span className="text-ink font-medium">{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {show.notes && (
        <div className="flex items-start gap-2 rounded-xl bg-soft border border-line px-3 py-2 text-sm text-ink-2 whitespace-pre-line">
          <StickyNote size={15} className="mt-0.5 shrink-0 text-muted" /> {show.notes}
        </div>
      )}
    </article>
  );
}
