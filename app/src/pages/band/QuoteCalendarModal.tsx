import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarPlus } from 'lucide-react';
import { get, post, put } from '../../api';
import { Button, Input, Modal } from '../../ui';
import { quoteDate, type CalendarDraft, type Quote, type QuoteItem, type QuoteShow } from './quotes';

type Saved = { quote: Quote; items: QuoteItem[]; show: QuoteShow | null; calendar_matched: boolean };

const terms = (value: string | null | undefined) =>
  (value ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

/**
 * The quote's event on the band's calendar: held as «אופציה» while the client decides, renamed
 * when they sign. The calendar sync makes the show out of it, as out of any event on that
 * calendar — which is why the dialog warns when the title would not be read as a show.
 *
 * Everyone ticked gets Google's own invitation: the members by default, a supplier when chosen.
 */
export function QuoteCalendarModal({ open, onClose, quote, onSaved }: {
  open: boolean;
  onClose: () => void;
  quote: Quote;
  onSaved: (data: Saved) => void;
}) {
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(null);
    setError('');
    get<CalendarDraft>(`/band/quotes/${quote.id}/calendar`).then((d) => {
      setDraft(d);
      setTitle(d.form.title);
      setLocation(d.form.location);
      setStart(d.form.start_time ?? '');
      setEnd(d.form.end_time ?? '');
      const known = new Set([...d.members, ...d.suppliers].map((p) => p.email.toLowerCase()));
      setChosen(new Set(d.form.attendees.map((e) => e.toLowerCase()).filter((e) => known.has(e))));
      // Guests added in Google itself, who are neither a member nor a supplier, stay on.
      setExtra(d.form.attendees.filter((e) => !known.has(e.toLowerCase())).join(', '));
    }).catch((e) => setError(e.message));
  }, [open, quote.id]);

  const suppliersByRole = useMemo(() => {
    const groups = new Map<string, CalendarDraft['suppliers']>();
    for (const s of draft?.suppliers ?? []) groups.set(s.role_name, [...(groups.get(s.role_name) ?? []), s]);
    return [...groups.entries()];
  }, [draft]);

  // The same test the sync applies, as far as the title goes: an ignore word keeps it out, a
  // keyword lets it in.
  const lowered = title.toLowerCase();
  const ignored = terms(draft?.rule?.ignore_words).find((w) => lowered.includes(w));
  const keywords = terms(draft?.rule?.keywords);
  const recognised = !ignored && (!keywords.length || keywords.some((k) => lowered.includes(k)));

  const toggle = (email: string) => {
    const next = new Set(chosen);
    const key = email.toLowerCase();
    if (next.has(key)) next.delete(key); else next.add(key);
    setChosen(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    const attendees = [...chosen, ...extra.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)];
    const body = { title, location, start_time: start || null, end_time: end || null, attendees };
    try {
      const saved = draft.event
        ? await put<Saved>(`/band/quotes/${quote.id}/calendar`, body)
        : await post<Saved>(`/band/quotes/${quote.id}/calendar`, body);
      onSaved(saved);
      onClose();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  const blocked = draft && (!draft.configured
    ? 'היומן לא מחובר לאפליקציה, ולכן אי אפשר ליצור ממנה אירוע. את ההופעה יוצרים ביומן, כמו תמיד.'
    : !draft.rule
      ? 'אין כלל יומן פעיל להופעות הלהקה — הוסיפו אחד בהגדרות → יומן.'
      : !draft.date ? 'חסר תאריך אירוע בהצעה — הוסיפו אותו ושמרו.' : '');

  return (
    <Modal title={draft?.event ? 'האירוע ביומן' : 'שריון ביומן'} open={open} onClose={onClose} size="lg">
      {!draft ? (
        error ? <p className="text-sm text-neg">{error}</p> : <p className="text-sm text-faint py-6 text-center">טוען…</p>
      ) : blocked ? (
        <p className="text-sm text-body">{blocked}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {draft.signed && draft.event?.is_option && (
            <p className="text-[13.5px] bg-pos-soft text-ink-2 rounded-xl px-4 py-2.5">
              הלקוח חתם — הורדנו את «אופציה» מהכותרת. השמירה מעדכנת את האירוע ומודיעה למוזמנים.
            </p>
          )}
          {draft.gone && (
            <p className="text-[13.5px] bg-warn-soft text-ink-2 rounded-xl px-4 py-2.5">
              האירוע הקודם של ההצעה נמחק מהיומן. אפשר ליצור חדש.
            </p>
          )}

          <div>
            <Input label="כותרת" value={title} onChange={(e) => setTitle(e.target.value)} required />
            {title.trim() && !recognised && (
              <p className="flex items-start gap-1.5 text-[12.5px] text-warn-ink mt-1.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                {ignored
                  ? <>המילה «{ignored}» בכותרת מסמנת לסנכרון לדלג על האירוע — לא תיווצר ממנו הופעה.</>
                  : <>הסנכרון מזהה הופעה לפי {keywords.map((k) => `«${k}»`).join(' / ')} בכותרת. בלי אחת מהן לא תיווצר הופעה.</>}
              </p>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-3 items-end">
            <div className="text-sm">
              <span className="block text-[13px] text-muted mb-1.5">תאריך</span>
              <div className="py-2 num">{quoteDate(draft.date)} <span className="text-[12px] text-faint">· מההצעה</span></div>
            </div>
            <Input label="משעה" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            <Input label="עד" type="time" value={end} disabled={!start} onChange={(e) => setEnd(e.target.value)} />
          </div>
          {!start && <p className="text-[12px] text-faint -mt-2">בלי שעה, האירוע הוא לכל היום.</p>}

          <Input label="מיקום" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="כתובת או שם המקום" />

          <fieldset className="space-y-2">
            <legend className="text-[13px] text-muted mb-1.5">חברי הלהקה</legend>
            <div className="flex flex-wrap gap-2">
              {draft.members.map((m) => (
                <Check key={m.email} label={m.name} sub={m.email} checked={chosen.has(m.email.toLowerCase())} onChange={() => toggle(m.email)} />
              ))}
              {!draft.members.length && <p className="text-[12.5px] text-faint">לחברי הלהקה אין כתובות מייל בהגדרות.</p>}
            </div>
          </fieldset>

          {suppliersByRole.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-[13px] text-muted mb-1.5">ספקים</legend>
              {suppliersByRole.map(([role, list]) => (
                <div key={role}>
                  <div className="text-[12px] text-faint mb-1">{role}</div>
                  <div className="flex flex-wrap gap-2">
                    {list.map((s) => (
                      <Check key={s.id} label={s.name} sub={s.email} checked={chosen.has(s.email.toLowerCase())} onChange={() => toggle(s.email)} />
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[12px] text-faint">ספק שמוזמן לאירוע משובץ להופעה אוטומטית, לפי המייל שלו.</p>
            </fieldset>
          )}

          <Input label="מוזמנים נוספים (מיילים, מופרדים בפסיק)" dir="ltr" value={extra} onChange={(e) => setExtra(e.target.value)} />

          {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}
          <Button type="submit" className="w-full" disabled={busy || !title.trim()}>
            <span className="flex items-center justify-center gap-1.5">
              <CalendarPlus size={16} />
              {busy ? 'שומר ביומן…' : draft.event ? 'עדכון האירוע' : 'יצירת האירוע ושליחת הזמנות'}
            </span>
          </Button>
          <p className="text-[12px] text-faint text-center -mt-2">
            Google שולח {draft.event ? 'עדכון' : 'הזמנה'} במייל לכל המסומנים{draft.event ? '' : ', וההופעה נוצרת מהאירוע'}.
          </p>
        </form>
      )}
    </Modal>
  );
}

function Check({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex items-center gap-2 rounded-xl border px-3 py-2 cursor-pointer text-sm ${checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent" />
      <span className="min-w-0">
        <span className="block font-medium leading-tight">{label}</span>
        <span className="block text-[11.5px] text-faint truncate" dir="ltr">{sub}</span>
      </span>
    </label>
  );
}
