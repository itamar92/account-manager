import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { get, put, nis } from '../api';
import { Button, Card, Empty, EditableCell, MoneyInput, Modal, Segmented, StatCard, Textarea } from '../ui';

/**
 * הדוח השנתי — the טופס 1301 ladder as it is shaping up, this year beside last.
 *
 * The page is deliberately shaped like the accountant's own השומה הצפויה page, section for
 * section, so the two can be held side by side. Every figure carries where it came from: the
 * books, something typed in from a certificate, or this app's own estimate of a ceiling. That
 * last badge is the important one — the ceilings on the pension deduction and credit are the
 * part most likely to differ from a real assessment, and each can be overridden with what the
 * assessment actually allowed.
 */
export function AnnualReport({ year }: { year: number }) {
  const [report, setReport] = useState<any>(null);
  const [basis, setBasis] = useState<'projected' | 'ytd'>('projected');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    get(`/reports/annual?year=${year}&basis=${basis}`)
      .then((d) => setReport(d.report))
      .catch((e) => setError(e.message));
  };
  useEffect(load, [year, basis]);

  if (error) return <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>;
  if (!report) return <Empty text="טוען…" />;

  const a = report.current;
  const prev = report.previous;
  const owed = a.balance >= 0;
  // Last year's figure for a line, matched by key, so a row can be read against something real.
  const prevOf = (group: string, key: string) =>
    prev?.[group]?.find((l: any) => l.key === key)?.amount ?? null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label={owed ? 'יתרה לתשלום' : 'יתרה להחזר'}
          value={nis(Math.abs(a.balance))}
          sub={owed ? 'אחרי ניכוי במקור ומקדמות' : 'צפוי לחזור מרשות המסים'}
          accent={owed ? 'text-neg' : 'text-pos'}
        />
        <StatCard label="הכנסה חייבת" value={nis(a.taxable_income)} sub="מכל המקורות, אחרי ניכויים" />
        <StatCard label="מס מגיע" value={nis(a.tax_due)} sub={`ברוטו ${nis(a.gross_tax)} פחות זיכויים`} accent="text-warn" />
        <StatCard
          label="שיעור מס שולי"
          value={`${Math.round(a.marginal_rate * 100)}%`}
          sub="מה עולה השקל הבא של רווח"
          accent="text-accent"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={basis}
          onChange={(v) => setBasis(v as any)}
          options={[
            { value: 'projected', label: 'תחזית שנתית' },
            { value: 'ytd', label: 'עד כה' },
          ]}
        />
        <Button variant="ghost" onClick={() => setEditing(true)}>עריכת הנתונים המוצהרים</Button>
      </div>

      {a.basis === 'projected' && a.months_elapsed < 12 && (
        <p className="text-xs text-faint">
          ההכנסה מהעסק היא תחזית לפי {a.months_elapsed} החודשים שנסגרו, בהנחת המשך באותו קצב.
          הנתונים המוצהרים — משכורת, מילואים, הפקדות, ניכוי במקור ומקדמות — הם תמיד סכומים שנתיים,
          ולכן בשנה שעדיין רצה כדאי להזין בהם את הצפי לשנה כולה.
        </p>
      )}

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="ser text-lg">השומה הצפויה {a.year}</h2>
          {prev && <span className="text-xs text-faint">עמודה שנייה: {prev.year}</span>}
        </div>

        <div className="text-sm">
          <Section
            title="א. הכנסות"
            lines={a.income}
            total={a.total_income}
            totalLabel='סה"כ הכנסות'
            prevTotal={prev?.total_income}
            prevOf={(k) => prevOf('income', k)}
          />
          <Section
            title="ב. ניכויים"
            lines={a.deductions}
            total={a.total_deductions}
            totalLabel='סה"כ ניכויים'
            prevTotal={prev?.total_deductions}
            prevOf={(k) => prevOf('deductions', k)}
            negative
            empty="לא הוזנו הפקדות לקרן השתלמות או לקופת גמל"
          />
          <Row label="הכנסה חייבת במס" amount={a.taxable_income} prev={prev?.taxable_income} strong />
          <Row label="מס לפי מדרגות" amount={a.gross_tax} prev={prev?.gross_tax} />

          <Section
            title="ג. זיכויים"
            lines={a.credits}
            total={a.total_credits}
            totalLabel='סה"כ זיכויים'
            prevTotal={prev?.total_credits}
            prevOf={(k) => prevOf('credits', k)}
            negative
          />
          <Row label="מס מגיע" amount={a.tax_due} prev={prev?.tax_due} strong accent="text-warn" />

          <Section
            title="ד. ניכויים במקור ותשלומים"
            lines={a.payments}
            total={a.total_payments}
            totalLabel='סה"כ ששולם כבר'
            prevTotal={prev?.total_payments}
            prevOf={(k) => prevOf('payments', k)}
            negative
            empty="לא הוזנו ניכוי במקור או מקדמות — בלי אלה היתרה למטה היא כל המס, ולא מה שנשאר לשלם"
          />

          <div className={clsx(
            'flex items-center justify-between gap-3 mt-3 px-4 py-3 rounded-xl font-bold',
            owed ? 'bg-neg-soft text-neg' : 'bg-pos-soft text-pos'
          )}>
            <span>{owed ? 'יתרת מס לתשלום' : 'יתרת מס להחזר'}</span>
            <span className="flex items-baseline gap-3">
              {prev != null && (
                <span className="text-xs font-normal opacity-70">
                  {prev.year}: {nis(Math.abs(prev.balance))}
                </span>
              )}
              <span>{nis(Math.abs(a.balance))}</span>
            </span>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-line">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">ביטוח לאומי ומס בריאות כעצמאי</span>
            <span className="font-bold text-warn">{nis(a.national_insurance)}</span>
          </div>
          <p className="text-xs text-faint mt-1">{a.ni_note}. נגבה בנפרד מהדוח השנתי.</p>
        </div>

        <p className="text-xs text-faint mt-4">
          הערכה בלבד, לפי מדרגות המס של {a.rates_year} ו-{a.credit_points} נקודות זיכוי.
          {a.rates_note && ` ${a.rates_note}.`}{' '}
          שורות המסומנות «הערכה» מחשבות תקרה בעצמן — אפשר להחליף אותן במה שהשומה בפועל התירה.
          אינה תחליף לדוח שמגיש רואה החשבון.
        </p>
      </Card>

      {a.credit_breakdown && !a.credit_breakdown.empty && (
        <Card>
          <h2 className="ser text-lg mb-3">נקודות הזיכוי — מאיפה הן מגיעות</h2>
          <div className="text-sm max-w-xl">
            {a.credit_breakdown.lines.map((line: any, i: number) => (
              <div key={i} className="flex items-baseline justify-between gap-3 py-1">
                <span>
                  {line.label}
                  <span className="text-xs text-faint"> · {line.section}</span>
                  {line.note && <span className="block text-xs text-faint">{line.note}</span>}
                </span>
                <span className="num shrink-0">{line.points}</span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-line pt-2 mt-1 font-bold">
              <span>סה"כ</span>
              <span className="num">{a.credit_breakdown.total}</span>
            </div>
          </div>
          <p className="text-xs text-faint mt-3">
            מחושב מהמצב האישי שנשמר בהגדרות → מע"מ ומס, לשנת המס {a.year}. הבנדים משתנים עם הגיל,
            ולכן אותו מצב שווה מספר אחר בכל שנה.
          </p>
        </Card>
      )}

      <ProfileModal
        open={editing}
        year={year}
        profile={a.profile}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); load(); }}
      />
    </div>
  );
}

/** Where a figure came from, which is the thing to know before trusting it. */
function OriginChip({ origin }: { origin: string }) {
  if (origin === 'computed') return null;  // the default; a badge on every line is noise
  const label = origin === 'declared' ? 'מוצהר' : 'הערכה';
  return (
    <span className={clsx(
      'text-[10px] px-1.5 py-0.5 rounded-md shrink-0',
      origin === 'declared' ? 'bg-soft text-muted' : 'bg-warn-soft text-warn'
    )}>
      {label}
    </span>
  );
}

function Row({ label, amount, prev, strong, accent, negative }: {
  label: string; amount: number; prev?: number | null; strong?: boolean; accent?: string; negative?: boolean;
}) {
  return (
    <div className={clsx(
      'flex items-baseline justify-between gap-3 py-1.5',
      strong && 'border-t border-line mt-1 pt-2.5'
    )}>
      <span className={clsx(strong ? 'font-bold' : 'text-muted')}>{label}</span>
      <span className="flex items-baseline gap-3 shrink-0">
        {prev != null && <span className="text-xs text-ghost num">{nis(prev)}</span>}
        <span className={clsx('num', strong && 'font-bold', accent || 'text-ink')}>
          {negative ? `−${nis(amount)}` : nis(amount)}
        </span>
      </span>
    </div>
  );
}

function Section({ title, lines, total, totalLabel, prevTotal, prevOf, negative, empty }: {
  title: string;
  lines: any[];
  total: number;
  totalLabel: string;
  prevTotal?: number | null;
  prevOf: (key: string) => number | null;
  negative?: boolean;
  empty?: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-bold text-faint mb-1">{title}</h3>
      {lines.length === 0 && empty && <p className="text-xs text-warn py-1">{empty}</p>}
      {lines.map((line: any) => (
        <div key={line.key} className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 flex-wrap">
              <span>{line.label}</span>
              <OriginChip origin={line.origin} />
            </span>
            {line.note && <span className="block text-xs text-faint">{line.note}</span>}
          </span>
          <span className="flex items-baseline gap-3 shrink-0">
            {prevOf(line.key) != null && (
              <span className="text-xs text-ghost num">{nis(prevOf(line.key)!)}</span>
            )}
            <span className="num">{negative ? `−${nis(line.amount)}` : nis(line.amount)}</span>
          </span>
        </div>
      ))}
      {lines.length > 0 && (
        <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 mt-1">
          <span className="font-medium">{totalLabel}</span>
          <span className="flex items-baseline gap-3 shrink-0">
            {prevTotal != null && <span className="text-xs text-ghost num">{nis(prevTotal)}</span>}
            <span className="num font-medium">{negative ? `−${nis(total)}` : nis(total)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** The fields, grouped the way the certificates they are copied from are. */
const FIELD_GROUPS: Array<{ title: string; hint?: string; fields: Array<[string, string, string?]> }> = [
  {
    title: 'הכנסות',
    hint: 'משכורת וניכוי במקור מטופס 106; מילואים מאישור הביטוח הלאומי.',
    fields: [
      ['salary', 'משכורת ברוטו', 'שדה 158'],
      ['salary_withheld', 'ניכוי במקור ממשכורת', 'שדה 042'],
      ['miluim', 'תגמולי מילואים', 'שדה 250'],
      ['miluim_withheld', 'ניכוי במקור ממילואים', 'שדה 040'],
      ['other_income', 'הכנסות אחרות'],
      ['other_withheld', 'ניכוי במקור אחר'],
    ],
  },
  {
    title: 'הפקדות — ניכויים',
    hint: 'מהדוחות השנתיים של הקופות. «הותר בשומה» ריק ⇐ הדוח מעריך את התקרה בעצמו.',
    fields: [
      ['keren_hishtalmut_paid', 'קרן השתלמות לעצמאי — הופקד'],
      ['keren_hishtalmut_allowed', 'קרן השתלמות — הותר בשומה'],
      ['pension_atzmai_paid', 'קופת גמל לקצבה עצמאי — הופקד'],
      ['pension_atzmai_allowed', 'קופת גמל עצמאי — הותר בשומה'],
      ['ni_paid', 'ביטוח לאומי ששולם כעצמאי', '52% ממנו מנוכה'],
    ],
  },
  {
    title: 'הפקדות — זיכויים',
    fields: [
      ['pension_sachir_paid', 'קופת גמל לקצבה שכיר — הופקד', 'חלק העובד'],
      ['pension_sachir_allowed', 'קופת גמל שכיר — הותר בשומה'],
      ['life_insurance_paid', 'פרמיות ביטוח חיים', 'שדה 036'],
      ['donations_paid', 'תרומות למוסד מוכר', 'סעיף 46'],
    ],
  },
  {
    title: 'תשלומים ועקיפות',
    hint: 'מקדמות הן ההפרש בין דוח שקט לדוח יקר — כדאי לעדכן אותן במהלך השנה.',
    fields: [
      ['mikdamot_paid', 'מקדמות מס הכנסה ששולמו'],
      ['business_income_override', 'רווח מותאם מהעסק', 'ריק ⇐ לפי הספרים'],
      ['credit_points_override', 'נקודות זיכוי', 'ריק ⇐ לפי המחשבון'],
    ],
  },
];

const OPTIONAL_FIELDS = new Set([
  'keren_hishtalmut_allowed', 'pension_atzmai_allowed', 'pension_sachir_allowed',
  'business_income_override', 'credit_points_override',
]);

function ProfileModal({ open, year, profile, onClose, onSaved }: {
  open: boolean; year: number; profile: any; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Reload from the report every time the modal opens, so it never shows a stale draft.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const group of FIELD_GROUPS) {
      for (const [key] of group.fields) {
        const value = profile?.[key];
        next[key] = value === null || value === undefined ? '' : String(value);
      }
    }
    setForm(next);
    setNotes(profile?.notes ?? '');
    setError('');
  }, [open, profile]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // A blank optional field is sent as null — "the assessment never said" — while a blank
      // required one is a plain zero.
      const body: Record<string, unknown> = { notes };
      for (const group of FIELD_GROUPS) {
        for (const [key] of group.fields) {
          const raw = (form[key] ?? '').trim();
          body[key] = OPTIONAL_FIELDS.has(key) ? (raw === '' ? null : raw) : (raw === '' ? 0 : raw);
        }
      }
      await put(`/reports/annual/profile/${year}`, body);
      onSaved();
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`נתונים מוצהרים — שנת מס ${year}`} open={open} onClose={onClose} size="lg">
      <p className="text-xs text-faint mb-4">
        מה שהספרים לא יכולים לדעת. פעם בשנה, מטופס 106, מאישור הביטוח הלאומי ומהדוחות השנתיים
        של הקופות. כל השדות הם סכומים שנתיים.
      </p>
      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5 mb-3">{error}</div>}

      <div className="space-y-5">
        {FIELD_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-sm font-bold mb-1">{group.title}</h3>
            {group.hint && <p className="text-xs text-faint mb-2">{group.hint}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {group.fields.map(([key, label, hint]) => (
                <label key={key} className="block">
                  <span className="block text-[13px] text-muted mb-1.5">
                    {label}
                    {hint && <span className="text-faint"> · {hint}</span>}
                  </span>
                  <MoneyInput
                    value={form[key] ?? ''}
                    onChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
                    placeholder={OPTIONAL_FIELDS.has(key) ? 'לא הוזן' : '0'}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}

        <Textarea label="הערות" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2 mt-5">
        <Button onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</Button>
        <Button variant="ghost" onClick={onClose}>ביטול</Button>
      </div>
    </Modal>
  );
}
