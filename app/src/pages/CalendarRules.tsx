import React, { useEffect, useState } from 'react';
import { get, post, put, del } from '../api';
import { Button, Card, Input, Empty } from '../ui';

export interface Rule {
  id: string;
  name: string;
  target: 'band' | 'personal';
  calendar_id: string;
  keywords: string;
  organizers: string;
  ignore_words: string;
  client_name: string | null;
  fixed_amount: number;
  skip_declined: number;
  match_description: number;
  enabled: number;
  sort_order: number;
}

interface Override {
  event_id: string;
  action: 'exclude' | 'include';
  rule_id: string | null;
  summary: string | null;
  event_date: string | null;
}

interface CalendarOption {
  id: string;
  summary: string;
  primary?: boolean;
}

const REASON_LABELS: Record<string, string> = {
  keyword: 'מילת מפתח',
  organizer: 'מארגן',
  manual: 'החלטה ידנית',
  ignored: 'מילת התעלמות',
  declined: 'סירבת להזמנה',
  'no-match': 'לא תואם',
  cancelled: 'בוטל ביומן',
};

/**
 * Editor for the calendar rules — which events get drawn into the app, for the band and
 * for personal work. Every field is live: rules are patterns you tune, the preview shows
 * what they would draw and why, and individual events can be pinned in or out by hand
 * when a pattern gets one wrong.
 */
export function CalendarRules({ onChange, onError }: {
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null);
  const [preview, setPreview] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState('');

  const load = () =>
    get('/calendar-rules')
      .then((d) => { setRules(d.rules); setOverrides(d.overrides ?? []); })
      .catch((e) => onError(e.message));

  useEffect(() => {
    load();
    get('/clients').then((d) => setClients(d.clients)).catch(() => setClients([]));
    // Best effort: without Google credentials this 503s and the picker falls back to a text field.
    get('/integrations/calendar/calendars')
      .then((d) => setCalendars(d.calendars))
      .catch(() => setCalendars(null));
  }, []);

  const refresh = () => { load(); onChange(); };

  const save = async (rule: Rule, patch: Partial<Rule>) => {
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, ...patch } : r))); // optimistic
    try { await put(`/calendar-rules/${rule.id}`, { ...rule, ...patch }); onChange(); }
    catch (e: any) { onError(e.message); load(); }
  };

  const addRule = async (target: 'band' | 'personal') => {
    try {
      await post('/calendar-rules', {
        name: target === 'band' ? 'הופעות להקה' : 'עבודות פרטיות',
        target,
        calendar_id: calendars?.find((c) => c.primary)?.id || 'primary',
        keywords: target === 'band' ? 'הופעה' : '',
        ignore_words: 'חזר, סאונדצ׳ק',
        skip_declined: 1,
        enabled: 0,
      });
      refresh();
    } catch (e: any) { onError(e.message); }
  };

  const removeRule = async (rule: Rule) => {
    if (!confirm(`למחוק את הכלל "${rule.name}"?`)) return;
    try { await del(`/calendar-rules/${rule.id}`); refresh(); }
    catch (e: any) { onError(e.message); }
  };

  const closePreview = (ruleId: string) =>
    setPreview(({ [ruleId]: _closed, ...rest }) => rest);

  const runPreview = async (rule: Rule) => {
    setBusy(rule.id);
    onError('');
    try {
      const d = await post(`/calendar-rules/${rule.id}/preview`, { rule, include_misses: true });
      setPreview((p) => ({ ...p, [rule.id]: d.result }));
    } catch (e: any) { onError(e.message); }
    finally { setBusy(''); }
  };

  const syncOne = async (rule: Rule) => {
    setBusy(rule.id);
    onError('');
    try {
      const d = await post('/integrations/calendar/sync', { rule_id: rule.id });
      const r = d.result.rules?.[0];
      onError(r
        ? `«${r.ruleName}»: ${r.matched} תואמים · ${r.created} חדשים · ${r.updated} עודכנו · ${r.removed} הוסרו · ${r.skipped} דולגו`
        : 'הכלל מכובה');
      refresh();
    } catch (e: any) { onError(e.message); }
    finally { setBusy(''); }
  };

  /** Pins an event in or out, then re-runs the preview so the change is visible at once. */
  const pinEvent = async (rule: Rule, row: any, action: 'exclude' | 'include') => {
    try {
      await post('/calendar-overrides', {
        event_id: row.eventId,
        action,
        rule_id: action === 'include' ? rule.id : null,
        summary: row.summary,
        event_date: row.date,
      });
      await load();
      onChange();
      await runPreview(rule);
    } catch (e: any) { onError(e.message); }
  };

  const unpin = async (eventId: string) => {
    try { await del(`/calendar-overrides/${encodeURIComponent(eventId)}`); refresh(); }
    catch (e: any) { onError(e.message); }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 className="font-bold">אילו אירועים למשוך מהיומן</h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => addRule('band')}>+ כלל להקה</Button>
          <Button variant="ghost" onClick={() => addRule('personal')}>+ כלל פרטי</Button>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-1">
        אירוע נמשך אם <b>מילת מפתח</b> מופיעה בכותרת <b>או</b> שהמארגן נמצא ברשימה — כך נתפסים
        גם אירועים שהוזמנת אליהם ולא יצרת. <b>מילות התעלמות</b> גוברות על שניהם, כך שאותו מארגן יכול
        לשלוח גם הופעות וגם חזרות. רוצה שחזרות כן ייכנסו? פשוט הסר את «חזר» מרשימת ההתעלמות.
      </p>
      <p className="text-xs text-amber-400/70 mb-4">
        טיפ: ההתאמה היא לפי מחרוזת, ולכן מילה קצרה תופסת יותר הטיות — «חזר» תופס גם «חזרה» וגם «חזרת».
        הריצו <b>תצוגה מקדימה</b> כדי לראות מה נמשך ולמה, ולסמן ידנית אירוע בודד להוצאה או להכללה.
      </p>

      {rules.length === 0 && <Empty text="אין כללים" />}

      <div className="space-y-4">
        {rules.map((rule) => (
          <div key={rule.id} className="border border-slate-800 rounded-xl p-3 bg-slate-800/30">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 flex-1 min-w-[12rem]">
                <input
                  type="checkbox"
                  checked={!!rule.enabled}
                  onChange={(e) => save(rule, { enabled: e.target.checked ? 1 : 0 })}
                  className="w-4 h-4 accent-indigo-500"
                  title="הפעלה/כיבוי"
                />
                <input
                  value={rule.name}
                  onChange={(e) => save(rule, { name: e.target.value })}
                  className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none font-medium flex-1"
                />
                <select
                  value={rule.target}
                  onChange={(e) => save(rule, { target: e.target.value as Rule['target'] })}
                  className={`text-xs px-2 py-1 rounded-full border bg-slate-900 ${
                    rule.target === 'band'
                      ? 'text-indigo-300 border-indigo-500/30'
                      : 'text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  <option value="band">להקה → הופעות</option>
                  <option value="personal">פרטי → עבודות</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={busy === rule.id}
                  onClick={() => (preview[rule.id] ? closePreview(rule.id) : runPreview(rule))}
                >
                  {busy === rule.id ? '…' : preview[rule.id] ? 'סגירת התצוגה' : 'תצוגה מקדימה'}
                </Button>
                <Button variant="ghost" disabled={busy === rule.id || !rule.enabled} onClick={() => syncOne(rule)}>
                  סנכרון
                </Button>
                <Button variant="danger" onClick={() => removeRule(rule)}>מחיקה</Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="block text-sm text-slate-400 mb-1">יומן</span>
                {calendars?.length ? (
                  <select
                    value={rule.calendar_id}
                    onChange={(e) => save(rule, { calendar_id: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  >
                    {!calendars.some((c) => c.id === rule.calendar_id) && (
                      <option value={rule.calendar_id}>{rule.calendar_id}</option>
                    )}
                    {calendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.summary}{c.primary ? ' (ראשי)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    dir="ltr"
                    value={rule.calendar_id}
                    onChange={(e) => save(rule, { calendar_id: e.target.value })}
                    placeholder="primary"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  />
                )}
              </label>
              <Input
                label="מילות מפתח (מופרדות בפסיק)" value={rule.keywords}
                onChange={(e) => save(rule, { keywords: e.target.value })} placeholder="הופעה, מופע"
              />
              <Input
                label="מיילים של מארגנים (מופרדים בפסיק)" dir="ltr" value={rule.organizers}
                onChange={(e) => save(rule, { organizers: e.target.value })} placeholder="udi@karni-band.com"
              />
              <Input
                label="מילות התעלמות (מופרדות בפסיק)" value={rule.ignore_words}
                onChange={(e) => save(rule, { ignore_words: e.target.value })} placeholder="חזר, סאונדצ׳ק"
              />
              {rule.target === 'personal' && (
                <>
                  <label className="block">
                    <span className="block text-sm text-slate-400 mb-1">לקוח לעבודות שייווצרו *</span>
                    <ClientField
                      value={rule.client_name || ''} clients={clients}
                      onChange={(name) => save(rule, { client_name: name })}
                    />
                  </label>
                  <AmountField
                    label='מחיר קבוע לאירוע (₪, לפני מע"מ)'
                    value={rule.fixed_amount}
                    onChange={(amount) => save(rule, { fixed_amount: amount })}
                  />
                </>
              )}
              <div className="flex flex-col justify-end gap-1.5 pb-2 text-sm text-slate-400">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox" checked={!!rule.skip_declined}
                    onChange={(e) => save(rule, { skip_declined: e.target.checked ? 1 : 0 })}
                    className="w-4 h-4 accent-indigo-500"
                  />
                  דלג על אירועים שסירבת להם
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox" checked={!!rule.match_description}
                    onChange={(e) => save(rule, { match_description: e.target.checked ? 1 : 0 })}
                    className="w-4 h-4 accent-indigo-500"
                  />
                  <span>חפש גם בתיאור האירוע <span className="text-slate-600">(ולא רק בכותרת)</span></span>
                </label>
              </div>
            </div>

            {rule.target === 'personal' && !rule.client_name?.trim() && (
              <div className="text-xs text-amber-400 mt-2">
                בלי לקוח לא ייווצרו עבודות — האירועים התואמים ידולגו.
              </div>
            )}

            <div className="text-xs text-slate-500 mt-2">
              השם שיישמר מנוקה אוטומטית ממילים כמו «הופעה», «מופע», «גיג», «show» ו«gig», וממילות
              המפתח של הכלל שבתחילת הכותרת — «הופעה קולדפליי גריי תל אביב» יישמר כ«גריי תל אביב».
              שם שתערכו ידנית לא יידרס בסנכרון הבא.
            </div>

            {rule.target === 'personal' && rule.fixed_amount > 0 && (
              <div className="text-xs text-slate-500 mt-2">
                כל אירוע תואם ייפתח כעבודה בסך ₪{rule.fixed_amount} לפני מע"מ. סכום שכבר הזנת ידנית לא יידרס.
              </div>
            )}

            {preview[rule.id] && (
              <PreviewTable
                result={preview[rule.id]}
                onPin={(row, action) => pinEvent(rule, row, action)}
                onClose={() => closePreview(rule.id)}
              />
            )}
          </div>
        ))}
      </div>

      {overrides.length > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-800">
          <h3 className="font-medium text-sm mb-1">החלטות ידניות</h3>
          <p className="text-xs text-slate-500 mb-3">
            אירועים שסימנת ידנית. הם גוברים על כל הכללים ונשמרים גם אחרי סנכרון מחדש.
          </p>
          <div className="divide-y divide-slate-800/60">
            {overrides.map((o) => (
              <div key={o.event_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className={o.action === 'exclude' ? 'text-rose-400' : 'text-emerald-400'}>
                    {o.action === 'exclude' ? '✕ לא נמשך' : '✓ נמשך תמיד'}
                  </span>
                  <span className="mr-2">{o.summary || o.event_id}</span>
                  {o.event_date && <span className="text-slate-500 mr-2">{o.event_date}</span>}
                </div>
                <button onClick={() => unpin(o.event_id)} className="text-xs text-indigo-400 hover:underline whitespace-nowrap">
                  ביטול
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

const NEW_CLIENT = '__new__';

/**
 * Picks the rule's client from the clients that exist, which is what you want almost always —
 * with an escape hatch for naming a client that has not been created yet, since the sync
 * creates one on first use. A name that no longer matches any client stays editable as text
 * rather than being silently swapped for someone else.
 */
function ClientField({ value, clients, onChange }: {
  value: string;
  clients: Array<{ id: string; name: string }>;
  onChange: (name: string) => void;
}) {
  const known = clients.some((c) => c.name === value);
  const [typing, setTyping] = useState(false);
  const asText = typing || clients.length === 0 || (!!value && !known);
  const field = 'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500';

  if (asText) {
    return (
      <div className="flex gap-2">
        <input
          value={value} onChange={(e) => onChange(e.target.value)} placeholder="קרניבנד"
          className={field} autoFocus={typing}
        />
        {clients.length > 0 && (
          <button type="button" onClick={() => setTyping(false)}
            className="text-xs text-indigo-400 hover:underline whitespace-nowrap">
            מהרשימה
          </button>
        )}
      </div>
    );
  }

  return (
    <select
      value={value} className={field}
      onChange={(e) => {
        if (e.target.value === NEW_CLIENT) { setTyping(true); onChange(''); }
        else onChange(e.target.value);
      }}
    >
      <option value="">בחר לקוח…</option>
      {clients.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
      <option value={NEW_CLIENT}>+ לקוח חדש…</option>
    </select>
  );
}

/**
 * Money field that keeps what you typed while you type it — binding straight to the number
 * would wipe a half-written "0." on its way to 0.5.
 */
function AmountField({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (amount: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value ? String(value) : '');
  return (
    <Input
      label={label} type="number" min="0" step="0.01" dir="ltr" value={shown}
      placeholder="0 — ללא מחיר קבוע"
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseFloat(e.target.value);
        onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function PreviewTable({ result, onPin, onClose }: {
  result: any;
  onPin: (row: any, action: 'exclude' | 'include') => void;
  onClose: () => void;
}) {
  const [showMisses, setShowMisses] = useState(false);
  const rows = result.rows.filter((r: any) => showMisses || r.matched);

  return (
    <div className="mt-3 pt-3 border-t border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-xs text-slate-400">
          {result.matched} תואמים מתוך {result.fetched} אירועים בחלון
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={showMisses} onChange={(e) => setShowMisses(e.target.checked)}
              className="w-3.5 h-3.5 accent-indigo-500" />
            הצג גם מה שלא נמשך
          </label>
          <button onClick={onClose} title="סגירת התצוגה המקדימה"
            className="text-xs text-slate-500 hover:text-slate-300">
            ✕ סגירה
          </button>
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-slate-800">
        {rows.length === 0 ? (
          <div className="text-center text-slate-500 py-6 text-sm">אין אירועים תואמים</div>
        ) : (
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((r: any) => (
                <tr key={r.eventId} className={r.matched ? '' : 'opacity-60'}>
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-400">{r.date}</td>
                  <td className="px-2 py-1.5">
                    {r.summary}
                    {/* The name it would actually be stored under, once the show words come off. */}
                    {r.matched && r.title && r.title !== r.summary && (
                      <span className="text-slate-500" title="השם שיישמר">{' ← '}{r.title}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className={r.matched ? 'text-emerald-400' : 'text-slate-500'}>
                      {r.matched ? '✓ ' : '✕ '}
                      {REASON_LABELS[r.reason] || r.reason}
                      {r.term ? `: ${r.term}` : ''}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-left whitespace-nowrap">
                    {r.reason === 'cancelled' ? null : r.matched ? (
                      <button onClick={() => onPin(r, 'exclude')} className="text-rose-400 hover:underline">
                        אל תמשוך
                      </button>
                    ) : (
                      <button onClick={() => onPin(r, 'include')} className="text-emerald-400 hover:underline">
                        משוך בכל זאת
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
