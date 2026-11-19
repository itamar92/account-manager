import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { del, get, post, put } from '../../api';
import { Button, Combobox, Input, Modal, Switch, fieldClass } from '../../ui';
import { eventLabel } from './shared';

interface Source {
  id: string;
  name: string;
  url: string;
  active: number;
  all_shows: number;
  match_to: 'shows' | 'calendar';
  calendar_words: string | null;
  last_run_at: string | null;
  last_status: 'ok' | 'empty' | 'unreadable' | 'error' | null;
  last_message: string | null;
  last_found: number;
}

export interface TicketLink {
  id: string;
  event_id: string | null;
  url: string;
  title: string | null;
  event_date: string;
  event_time: string | null;
  venue: string | null;
  price: number | null;
  availability: 'available' | 'limited' | 'sold_out' | null;
  status: 'suggested' | 'confirmed' | 'rejected';
  source_name: string | null;
  calendar_event_id?: string | null;
  calendar_title?: string | null;
}

/** What a source is: a page selling Moonlight, or another band's site read against the calendar. */
const KINDS = [
  { value: 'shows', label: 'מקום שמוכר כרטיסים למונלייט' },
  { value: 'calendar', label: 'אתר של להקה שאני מנגן בה — רק תאריכים שביומן שלי' },
] as const;

const AVAILABILITY: Record<string, string> = { sold_out: 'אזל', limited: 'כרטיסים אחרונים' };

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-pos', empty: 'bg-faint', unreadable: 'bg-warn', error: 'bg-neg',
};

/** A run's time as the reader's clock has it. SQLite writes UTC without saying so. */
export const ranAt = (at: string) =>
  new Date(`${at.replace(' ', 'T')}Z`).toLocaleString('he-IL', {
    day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

/**
 * The pages the ticket finder looks on, and what it found on them.
 *
 * Any site can be added here without anything being built for it: the finder reads a page for
 * links that name the band and opens each one. What it cannot read, it says — on the source's
 * own line, where the band will see it — and that show's link can be pasted on its page.
 */
export function TicketSourcesModal({ open, onClose, onChange }: {
  open: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [unassigned, setUnassigned] = useState<TicketLink[]>([]);
  const [gigs, setGigs] = useState<TicketLink[]>([]);
  const [shows, setShows] = useState<any[]>([]);
  const [keywords, setKeywords] = useState('');
  const emptyDraft = { name: '', url: '', match_to: 'shows' as Source['match_to'], calendar_words: '' };
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = () =>
    get('/moonlight/ticket-sources').then((d) => {
      setSources(d.sources);
      setUnassigned(d.unassigned);
      setGigs(d.calendar ?? []);
      setKeywords(d.keywords.join(', '));
    }).catch((e) => setError(e.message));

  const copy = async (link: TicketLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.id);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* the link is still there to open */ }
  };

  // What a calendar entry of that band says, when it is not the city or the hall. Rarely needed,
  // so it is asked for rather than given a field of its own on every row.
  const editWords = (s: Source) => {
    const next = prompt('מילים שמופיעות ביומן בהופעות של הלהקה הזו (מופרדות בפסיק):', s.calendar_words ?? '');
    if (next === null) return;
    act(`words-${s.id}`, async () => {
      await put(`/moonlight/ticket-sources/${s.id}`, { calendar_words: next });
      await run(s.id);
    });
  };

  useEffect(() => {
    if (!open) return;
    setError('');
    setSummary('');
    load();
    get('/moonlight/events').then((d) => setShows(d.events)).catch(() => {});
  }, [open]);

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    setError('');
    try { await fn(); await load(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const run = (sourceId?: string) => act(sourceId ?? 'all', async () => {
    const { result } = await post('/moonlight/ticket-sources/run', sourceId ? { source_id: sourceId } : {});
    setSummary(
      result.added
        ? `נמצאו ${result.added} קישורים חדשים${result.matched ? `, ${result.matched} מהם שויכו להופעות` : ''}.`
        : 'לא נמצאו קישורים חדשים.'
    );
    onChange();
  });

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    act('add', async () => {
      const { source } = await post('/moonlight/ticket-sources', draft);
      setDraft(emptyDraft);
      // A source is only worth having once it is known to work, so it is tried straight away.
      const { result } = await post('/moonlight/ticket-sources/run', { source_id: source.id });
      const r = result.sources[0];
      setSummary(r ? `${source.name}: ${r.message}` : '');
      onChange();
    });
  };

  const upcoming = shows
    .filter((s) => s.date >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Modal title="קישורי כרטיסים" open={open} onClose={onClose} size="lg">
      <div className="space-y-5">
        <p className="text-[13.5px] text-muted leading-relaxed">
          דפים שבהם מחפשים את ההופעות: דף ההופעות של מקום באתר הכרטיסים, כתובת חיפוש
          עם <span dir="ltr" className="num">{'{q}'}</span> במקום מילת החיפוש, או האתר של להקה אחרת
          שאתם מנגנים בה — ממנו נלקחים רק התאריכים שביומן שלכם. כל אתר עובד בלי הגדרה מיוחדת;
          החיפוש רץ פעם ביום, ומיד כשמוסיפים מקור.
        </p>

        {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}
        {summary && <div className="text-sm text-pos bg-pos-soft rounded-xl px-4 py-2.5">{summary}</div>}

        {/* ---- the sources ---- */}
        <div className="flex flex-col divide-y divide-soft border border-line rounded-xl">
          {sources.length === 0 && (
            <div className="text-sm text-faint px-4 py-3.5">עוד לא הוגדרו מקורות.</div>
          )}
          {sources.map((s) => (
            <div key={s.id} className={clsx('px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-2', !s.active && 'opacity-55')}>
              <div className="flex-1 min-w-[12rem]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">{s.name}</span>
                  {s.match_to === 'calendar' && (
                    <button type="button" onClick={() => editWords(s)} disabled={!!busy}
                      title="מילים שמופיעות ביומן בהופעות של הלהקה הזו"
                      className="text-[11.5px] font-semibold rounded-full px-2 py-0.5 bg-moon-soft text-moon hover:brightness-95">
                      רק מהיומן{s.calendar_words ? ` · ${s.calendar_words}` : ''}
                    </button>
                  )}
                </div>
                <a href={s.url.includes('{q}') ? undefined : s.url} target="_blank" rel="noopener noreferrer"
                  dir="ltr" className="block text-[12.5px] text-faint truncate hover:text-muted">
                  {s.url}
                </a>
                <div className="flex items-center gap-1.5 text-[12.5px] text-muted mt-1">
                  <span className={clsx('w-2 h-2 rounded-full shrink-0', STATUS_DOT[s.last_status ?? ''] ?? 'bg-line-strong')} />
                  <span>{s.last_message || 'טרם נבדק'}</span>
                  {s.last_run_at && <span className="text-faint num">· {ranAt(s.last_run_at)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={!!s.active} label="פעיל"
                  onChange={(v) => act(`toggle-${s.id}`, () => put(`/moonlight/ticket-sources/${s.id}`, { active: v }))} />
                <button disabled={!!busy} onClick={() => run(s.id)}
                  className="text-[13px] font-semibold text-accent hover:underline disabled:opacity-50">
                  {busy === s.id ? 'מחפש…' : 'חיפוש'}
                </button>
                <button disabled={!!busy}
                  onClick={() => confirm(`להסיר את «${s.name}»? קישורים שכבר נמצאו יישארו.`)
                    && act(`del-${s.id}`, () => del(`/moonlight/ticket-sources/${s.id}`))}
                  className="text-[13px] font-semibold text-neg hover:underline disabled:opacity-50">
                  הסרה
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ---- a new one ---- */}
        <form onSubmit={add} className="space-y-2.5">
          <label className="block">
            <span className="block text-[13px] text-muted mb-1.5">סוג המקור</span>
            <select className={fieldClass} value={draft.match_to}
              onChange={(e) => setDraft({ ...draft, match_to: e.target.value as Source['match_to'] })}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <div className="grid gap-2.5 sm:grid-cols-[1fr_1.6fr_auto] items-end">
            <Input label="שם" placeholder={draft.match_to === 'calendar' ? 'קרניבנד' : 'זאפה חיפה'} value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Input label="כתובת הדף" dir="ltr" required
              placeholder={draft.match_to === 'calendar' ? 'https://karni-band.com/' : 'https://live.tickchak.co.il/zappa-haifa'}
              value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <Button type="submit" disabled={!!busy || !draft.url.trim()}>
              {busy === 'add' ? 'בודק…' : 'הוספה'}
            </Button>
          </div>
          {draft.match_to === 'calendar' && (
            <div>
              <Input label="מילים ביומן · לא חובה" placeholder="קרני" value={draft.calendar_words}
                onChange={(e) => setDraft({ ...draft, calendar_words: e.target.value })} />
              <p className="text-[12.5px] text-faint mt-1">
                הופעה מהאתר נשמרת רק אם ביומן יש אירוע באותו תאריך שמזכיר את העיר, האולם או המופע —
                או אחת המילים כאן, אם כך אתם רושמים את ההופעות של הלהקה.
              </p>
            </div>
          )}
        </form>

        {/* ---- search words ---- */}
        <form
          className="grid gap-2.5 sm:grid-cols-[1fr_auto] items-end"
          onSubmit={(e) => {
            e.preventDefault();
            act('keywords', () => put('/moonlight/ticket-keywords', { keywords }));
          }}
        >
          <Input label="מילות חיפוש · מופרדות בפסיק" value={keywords}
            onChange={(e) => setKeywords(e.target.value)} />
          <Button type="submit" variant="ghost" disabled={!!busy}>שמירה</Button>
        </form>

        <Button className="w-full" disabled={!!busy || !sources.some((s) => s.active)} onClick={() => run()}>
          {busy === 'all' ? 'מחפש בכל המקורות…' : 'חיפוש בכל המקורות'}
        </Button>

        {/* ---- the owner's gigs with other bands, from the calendar ---- */}
        {gigs.length > 0 && (
          <div>
            <h3 className="ser text-base">ההופעות שלי מהיומן</h3>
            <p className="text-[12.5px] text-muted mt-0.5 mb-2.5">
              תאריכים מאתרי להקות שמופיעים גם ביומן שלכם, עם הקישור לרכישת כרטיסים.
            </p>
            <div className="flex flex-col divide-y divide-soft border border-line rounded-xl">
              {gigs.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
                  <div className="w-[4.5rem] shrink-0 num text-[13px]">
                    <div className="font-semibold">{l.event_date.slice(8, 10)}/{l.event_date.slice(5, 7)}</div>
                    <div className="text-faint">{l.event_time ?? ''}</div>
                  </div>
                  <div className="flex-1 min-w-[11rem]">
                    <a href={l.url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-semibold inline-flex items-center gap-1.5 hover:underline">
                      {l.title || hostOf(l.url)} <ExternalLink size={13} className="text-faint" />
                    </a>
                    <div className="text-[12.5px] text-muted">
                      ביומן: {l.calendar_title || '—'}
                      {l.source_name ? ` · ${l.source_name}` : ''}
                      {l.price != null && <> · <span className="num">₪{l.price}</span></>}
                      {l.availability && AVAILABILITY[l.availability] && (
                        <span className="text-warn-ink font-semibold"> · {AVAILABILITY[l.availability]}</span>
                      )}
                    </div>
                  </div>
                  <button type="button" onClick={() => copy(l)}
                    className="text-[13px] font-semibold text-accent hover:underline inline-flex items-center gap-1">
                    {copied === l.id ? <><Check size={13} /> הועתק</> : <><Copy size={13} /> העתקה</>}
                  </button>
                  <button type="button"
                    onClick={() => act(`rej-${l.id}`, () => put(`/moonlight/ticket-links/${l.id}`, { status: 'rejected' }))}
                    className="text-[13px] font-semibold text-muted hover:text-neg">
                    לא רלוונטי
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- dates on sale with no show ---- */}
        {unassigned.length > 0 && (
          <div>
            <h3 className="ser text-base">נמצאו בלי הופעה ביומן</h3>
            <p className="text-[12.5px] text-muted mt-0.5 mb-2.5">
              המקום מוכר כרטיסים לתאריך שאין בו הופעה רשומה — או שההופעה רשומה בתאריך אחר.
            </p>
            <div className="flex flex-col gap-2.5">
              {unassigned.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-soft rounded-xl px-3.5 py-2.5">
                  <div className="flex-1 min-w-[12rem]">
                    <a href={l.url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-semibold inline-flex items-center gap-1.5 hover:underline">
                      {l.title || hostOf(l.url)} <ExternalLink size={13} className="text-faint" />
                    </a>
                    <div className="num text-[12.5px] text-muted">
                      {l.event_date || 'ללא תאריך'}{l.event_time ? ` · ${l.event_time}` : ''}
                      {l.venue ? ` · ${l.venue}` : ''}{l.source_name ? ` · ${l.source_name}` : ''}
                    </div>
                  </div>
                  <Combobox
                    className="w-52"
                    value=""
                    placeholder="שיוך להופעה…"
                    options={upcoming.map((s) => ({ value: s.id, label: eventLabel(s) }))}
                    onChange={(v) => v && act(`link-${l.id}`, async () => {
                      await put(`/moonlight/ticket-links/${l.id}`, { event_id: v });
                      onChange();
                    })}
                  />
                  <button onClick={() => act(`rej-${l.id}`, () => put(`/moonlight/ticket-links/${l.id}`, { status: 'rejected' }))}
                    className="text-[13px] font-semibold text-muted hover:text-neg">
                    לא רלוונטי
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
