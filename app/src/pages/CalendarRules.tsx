import React, { useState } from 'react';
import { post, put, del } from '../api';
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
  skip_declined: number;
  match_description: number;
  enabled: number;
  sort_order: number;
}

const REASON_LABELS: Record<string, string> = {
  keyword: 'מילת מפתח',
  organizer: 'מארגן',
  ignored: 'מילת התעלמות',
  declined: 'סירבת להזמנה',
  'no-match': 'לא תואם',
  cancelled: 'בוטל ביומן',
};

/**
 * Editor for the calendar rules — which events get drawn into the app, for the band and
 * for personal work. Each rule can be previewed before it is trusted: the preview shows
 * every event in the window with the reason it was let in or left out.
 */
export function CalendarRules({ rules, onChange, onError }: {
  rules: Rule[];
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const [preview, setPreview] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState('');

  const save = async (rule: Rule, patch: Partial<Rule>) => {
    try { await put(`/calendar-rules/${rule.id}`, { ...rule, ...patch }); onChange(); }
    catch (e: any) { onError(e.message); }
  };

  const addRule = async (target: 'band' | 'personal') => {
    try {
      await post('/calendar-rules', {
        name: target === 'band' ? 'הופעות להקה' : 'עבודות פרטיות',
        target,
        calendar_id: 'primary',
        keywords: target === 'band' ? 'הופעה' : '',
        ignore_words: 'חזרה, סאונדצ׳ק',
        skip_declined: 1,
        enabled: 0,
      });
      onChange();
    } catch (e: any) { onError(e.message); }
  };

  const removeRule = async (rule: Rule) => {
    if (!confirm(`למחוק את הכלל "${rule.name}"?`)) return;
    try { await del(`/calendar-rules/${rule.id}`); onChange(); }
    catch (e: any) { onError(e.message); }
  };

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
      onError(r ? `«${r.ruleName}»: ${r.matched} תואמים · ${r.created} חדשים · ${r.updated} עודכנו · ${r.skipped} דולגו` : 'הכלל מכובה');
      onChange();
    } catch (e: any) { onError(e.message); }
    finally { setBusy(''); }
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
        אירוע נמשך אם <b>מילת מפתח</b> מופיעה בכותרת/תיאור <b>או</b> שהמארגן נמצא ברשימה — כך נתפסים
        גם אירועים שהוזמנת אליהם ולא יצרת. <b>מילות התעלמות</b> גוברות על שניהם, כך שאותו מארגן יכול
        לשלוח גם הופעות וגם חזרות.
      </p>
      <p className="text-xs text-amber-400/70 mb-4">
        טיפ: ההתאמה היא לפי מחרוזת, ולכן מילה קצרה תופסת יותר הטיות — «חזר» תופס גם «חזרה» וגם «חזרת»,
        בעוד ש-«חזרה» יפספס את «חזרת אלטון». הריצו <b>תצוגה מקדימה</b> כדי לראות מה נמשך ולמה.
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
                <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${
                  rule.target === 'band'
                    ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                }`}>
                  {rule.target === 'band' ? 'להקה → הופעות' : 'פרטי → עבודות'}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={busy === rule.id} onClick={() => runPreview(rule)}>
                  {busy === rule.id ? '…' : 'תצוגה מקדימה'}
                </Button>
                <Button variant="ghost" disabled={busy === rule.id || !rule.enabled} onClick={() => syncOne(rule)}>
                  סנכרון
                </Button>
                <Button variant="danger" onClick={() => removeRule(rule)}>מחיקה</Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="מזהה יומן" dir="ltr" value={rule.calendar_id}
                onChange={(e) => save(rule, { calendar_id: e.target.value })} placeholder="primary"
              />
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
                onChange={(e) => save(rule, { ignore_words: e.target.value })} placeholder="חזרה, סאונדצ׳ק"
              />
              {rule.target === 'personal' && (
                <Input
                  label="לקוח לעבודות שייווצרו *" value={rule.client_name || ''}
                  onChange={(e) => save(rule, { client_name: e.target.value })} placeholder="קרניבנד"
                />
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

            {preview[rule.id] && <PreviewTable result={preview[rule.id]} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PreviewTable({ result }: { result: any }) {
  const [showMisses, setShowMisses] = useState(false);
  const rows = result.rows.filter((r: any) => showMisses || r.matched);

  return (
    <div className="mt-3 pt-3 border-t border-slate-800">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-slate-400">
          {result.matched} תואמים מתוך {result.fetched} אירועים בחלון
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={showMisses} onChange={(e) => setShowMisses(e.target.checked)}
            className="w-3.5 h-3.5 accent-indigo-500" />
          הצג גם מה שלא נמשך
        </label>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800">
        {rows.length === 0 ? (
          <div className="text-center text-slate-500 py-6 text-sm">אין אירועים תואמים</div>
        ) : (
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((r: any) => (
                <tr key={r.eventId} className={r.matched ? '' : 'opacity-50'}>
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-400">{r.date}</td>
                  <td className="px-2 py-1.5">{r.summary}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className={r.matched ? 'text-emerald-400' : 'text-slate-500'}>
                      {r.matched ? '✓ ' : '✕ '}
                      {REASON_LABELS[r.reason] || r.reason}
                      {r.term ? `: ${r.term}` : ''}
                    </span>
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
