import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { get, post, del } from '../api';
import { Button, Input, Switch, fieldClass } from '../ui';

/**
 * מחשבון נקודות זיכוי — answer who you are, and it works out the number.
 *
 * The point of storing the *status* rather than the number is that the number goes stale on
 * its own. A child born in 2023 is worth 2.5 points in the year it was born, 4.5 the next two
 * years and 3.5 the year after that; a discharged soldier's credit runs out 36 months after
 * discharge; the מילואים points are read off last year's days. Keep the facts and the number
 * recomputes itself every January. Keep the number and it is wrong by February.
 *
 * Saving also writes the total into the plain נקודות זיכוי setting, so every estimate in the
 * app picks it up without knowing the calculator exists.
 */
export function CreditPointsCalculator({ year, onSaved }: { year: number; onSaved?: () => void }) {
  const [status, setStatus] = useState<any>(null);
  const [breakdown, setBreakdown] = useState<any>(null);
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    get(`/tax/credit-points?year=${year}`)
      .then((d) => { setStatus(d.status); setBreakdown(d.breakdown); setConfigured(d.configured); })
      .catch((e) => setError(e.message));
  }, [year]);

  // The total is recomputed on the server as the form is filled in, so the schedule lives in
  // exactly one place rather than being reimplemented here to make the preview feel quick.
  useEffect(() => {
    if (!status) return;
    let cancelled = false;
    post(`/tax/credit-points/preview?year=${year}`, { status })
      .then((d) => { if (!cancelled) setBreakdown(d.breakdown); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [status, year]);

  if (error) return <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>;
  if (!status) return <p className="text-sm text-muted">טוען…</p>;

  const set = (patch: Record<string, unknown>) => {
    setStatus((s: any) => ({ ...s, ...patch }));
    setSaved('');
  };
  const setChild = (index: number, patch: Record<string, unknown>) =>
    set({ children: status.children.map((c: any, i: number) => (i === index ? { ...c, ...patch } : c)) });

  const save = async () => {
    setError('');
    try {
      const d = await post(`/tax/credit-points?year=${year}`, { status });
      setBreakdown(d.breakdown);
      setConfigured(true);
      setSaved(`נשמר — ${d.breakdown.total} נקודות זיכוי הוחלו על הערכות המס`);
      onSaved?.();
    } catch (err: any) { setError(err.message); }
  };

  const reset = async () => {
    setError('');
    try {
      const d = await del('/tax/credit-points');
      setStatus(d.status);
      setConfigured(false);
      setSaved('המחשבון נוקה — ההערכות חוזרות למספר שמוקלד בשדה למעלה');
      onSaved?.();
    } catch (err: any) { setError(err.message); }
  };

  const thisYear = new Date().getFullYear();

  return (
    <div className="space-y-5">
      <p className="text-xs text-faint">
        ממלאים מצב אישי — והמספר מחושב לכל שנת מס בנפרד. זה העיקר: אותם נתונים שווים מספר שונה
        בכל שנה, כי הבנדים של הילדים זזים עם הגיל וזיכוי החייל המשוחרר נגמר 36 חודשים מהשחרור.
        כל עוד המחשבון מלא, ההערכות מתעדכנות מעצמן בכל ינואר.
      </p>

      {/* The answer, kept in view while the form below is filled in. */}
      <div className="bg-soft border border-line rounded-xl p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted">נקודות זיכוי לשנת {year}</span>
          <span className="text-2xl font-bold num">{breakdown?.total ?? '—'}</span>
        </div>
        {breakdown && !breakdown.empty && (
          <div className="mt-3 pt-3 border-t border-line space-y-1">
            {breakdown.lines.map((line: any, i: number) => (
              <div key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-muted">
                  {line.label}
                  <span className="text-faint"> · {line.section}</span>
                  {line.note && <span className="block text-xs text-faint">{line.note}</span>}
                </span>
                <span className="num shrink-0">{line.points}</span>
              </div>
            ))}
          </div>
        )}
        {breakdown && (
          <p className="text-xs text-faint mt-3">
            שווי {breakdown.total} נקודות: כ-{Math.round(breakdown.total * 2904).toLocaleString('he-IL')} ₪
            הנחה במס בשנה.
          </p>
        )}
      </div>

      <Field label="מין">
        <select value={status.gender} onChange={(e) => set({ gender: e.target.value })} className={fieldClass}>
          <option value="male">גבר</option>
          <option value="female">אישה — 0.5 נקודה נוספת</option>
        </select>
      </Field>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Switch checked={status.resident} onChange={(v) => set({ resident: v })} label="תושב/ת ישראל" />
        <Switch checked={status.single_parent} onChange={(v) => set({ single_parent: v })} label="הורה במשפחה חד-הורית" />
        <Switch checked={status.only_parent} onChange={(v) => set({ only_parent: v })} label="הורה יחיד" />
        <Switch checked={status.divorced_paying_mezonot} onChange={(v) => set({ divorced_paying_mezonot: v })} label="גרוש/ה שנישא/ה ומשלם/ת מזונות" />
        <Switch checked={status.supported_spouse} onChange={(v) => set({ supported_spouse: v })} label="בן/בת זוג שפרנסתו/ה עליי" />
        <Switch checked={status.disability} onChange={(v) => set({ disability: v })} label="נכות 100% או עיוורון" />
      </div>

      {/* ---- children ---- */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h4 className="text-sm font-bold">ילדים</h4>
          <Button variant="ghost" onClick={() => set({ children: [...status.children, { birth_year: thisYear, primary_parent: false, disabled: false }] })}>
            <Plus size={14} /> הוספת ילד/ה
          </Button>
        </div>
        <p className="text-xs text-faint mb-2">
          שנת לידה בלבד — הבנד נקרא מול שנת המס. «מקבל/ת קצבת ילדים» מכפיל את הזכאות מגיל 6
          ומעלה, ורק ההורה הזה מקבל את חצי הנקודה בשנת הבגרות.
        </p>
        {status.children.length === 0 && <p className="text-sm text-muted">אין ילדים רשומים.</p>}
        <div className="space-y-2">
          {status.children.map((child: any, i: number) => (
            <div key={i} className="flex flex-wrap items-center gap-3 bg-soft border border-line rounded-xl px-3 py-2">
              <label className="flex items-center gap-2 text-[13px] text-muted">
                שנת לידה
                <input
                  type="number" min="1900" max={thisYear + 1} value={child.birth_year}
                  onChange={(e) => setChild(i, { birth_year: parseInt(e.target.value, 10) || 0 })}
                  className={`${fieldClass} w-24 num`}
                />
              </label>
              <Switch checked={child.primary_parent} onChange={(v) => setChild(i, { primary_parent: v })} label="מקבל/ת קצבת ילדים" />
              <Switch checked={child.disabled} onChange={(v) => setChild(i, { disabled: v })} label="נטול/ת יכולת" />
              <button
                type="button" onClick={() => set({ children: status.children.filter((_: any, j: number) => j !== i) })}
                className="text-muted hover:text-neg transition-colors ms-auto" aria-label="הסרה"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ---- service, aliyah, studies ---- */}
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="תאריך עלייה (אם רלוונטי)" type="date" dir="ltr" value={status.aliya_date}
          onChange={(e) => set({ aliya_date: e.target.value })}
        />
        <Input
          label="תאריך שחרור משירות סדיר" type="date" dir="ltr" value={status.discharge_date}
          onChange={(e) => set({ discharge_date: e.target.value })}
        />
        <div className="md:col-span-2">
          <Switch
            checked={status.full_service} onChange={(v) => set({ full_service: v })}
            label="שירות סדיר מלא — 23 חודשים לגבר, 22 לאישה (מכפיל את זיכוי החייל המשוחרר)"
          />
        </div>
        <Input
          label={`ימי מילואים כלוחם בשנת ${year - 1}`} type="number" min="0" max="400"
          value={status.reserve_days_prev_year}
          onChange={(e) => set({ reserve_days_prev_year: parseInt(e.target.value, 10) || 0 })}
        />
        <div className="text-xs text-faint self-end pb-2">
          הזיכוי לפי סעיף 39B ניתן על ימי השנה <b>הקודמת</b>, מ-2026 ואילך, ורק על סמך אישור צה"ל.
        </div>
        <Input
          label="שנת סיום לימודים / התמחות" type="number" min="1950" max={thisYear}
          value={status.studies_end_year ?? ''}
          onChange={(e) => set({ studies_end_year: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="שנות תואר ראשון" type="number" min="0" max="3" value={status.first_degree_years}
            onChange={(e) => set({ first_degree_years: parseInt(e.target.value, 10) || 0 })}
          />
          <Input
            label="שנות תואר שני" type="number" min="0" max="2" value={status.second_degree_years}
            onChange={(e) => set({ second_degree_years: parseInt(e.target.value, 10) || 0 })}
          />
        </div>
        <div className="md:col-span-2">
          <Switch
            checked={status.vocational_certificate} onChange={(v) => set({ vocational_certificate: v })}
            label="תעודת מקצוע (נדרשת הצהרה בטופס 119)"
          />
        </div>
      </div>

      {saved && <div className="text-sm text-pos">{saved}</div>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={save}>שמירה והחלה על הערכות המס</Button>
        {configured && <Button variant="ghost" onClick={reset}>ניקוי המחשבון</Button>}
      </div>

      <p className="text-xs text-faint">
        המחשבון מכסה את נקודות הזיכוי בלבד. הנחת יישוב מוטב (סעיף 11) וזיכוי החזקה במוסד
        (סעיף 44) הם אחוזים ולא נקודות, והם אינם נכללים כאן.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block max-w-xs">
      <span className="block text-[13px] text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}
