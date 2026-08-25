import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChartPie, HelpCircle } from 'lucide-react';
import { dayShort, get, signedPercent } from '../api';
import { Card, Empty, LabeledSelect, Switch } from '../ui';
import { ClientDonut, IncomeExpenseVatChart, OVERVIEW_LABELS, fullBasisLabels } from '../charts';

/** The periods the panel offers. The labels are the server's — it is the one that knows the year. */
type PeriodKey = 'current_year' | 'prev_year' | 'current_quarter' | 'current_month' | 'prev_month' | 'last_12m';

const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: 'current_year', label: `שנה נוכחית (${new Date().getFullYear()})` },
  { value: 'prev_year', label: `שנה קודמת (${new Date().getFullYear() - 1})` },
  { value: 'current_quarter', label: 'רבעון נוכחי' },
  { value: 'current_month', label: 'חודש נוכחי' },
  { value: 'prev_month', label: 'חודש קודם' },
  { value: 'last_12m', label: '12 החודשים האחרונים' },
];

type ExpenseBasis = 'recognized' | 'full';

const BASIS_OPTIONS: Array<{ value: ExpenseBasis; label: string }> = [
  { value: 'recognized', label: 'מוכר למס הכנסה' },
  { value: 'full', label: 'סכום מלא' },
];

/**
 * A shekel figure with its agorot kept, but set smaller.
 *
 * The panel's three headline numbers are read against each other at a glance, and two decimal
 * places at full size is two digits of noise in that comparison — dropping them entirely would
 * stop the figure matching the filing it comes from, so they stay, quietly.
 */
function Money({ value }: { value: number }) {
  const [whole, agorot] = Math.abs(Number(value) || 0).toFixed(2).split('.');
  const sign = Number(value) < 0 ? '-' : '';
  return (
    <span dir="ltr" className="num inline-flex items-baseline text-ink">
      <span className="text-[26px] md:text-[28px] font-extrabold tracking-[-0.035em]">
        {sign}₪{Number(whole).toLocaleString('he-IL')}
      </span>
      <span className="text-base font-bold text-body">.{agorot}</span>
    </span>
  );
}

/** How the figure moved against the same period a year, quarter or month earlier. */
function DeltaBadge({ change }: { change: number | null }) {
  if (change == null) return null;
  return (
    <span
      dir="ltr"
      className="num text-[11px] font-bold text-muted bg-soft border border-line rounded px-1.5 py-0.5"
      title="לעומת התקופה המקבילה הקודמת"
    >
      {signedPercent(change)}
    </span>
  );
}

/** One of the three headline figures: the number, what it is, and anything that qualifies it. */
function Figure({ value, label, change, hint, children }: {
  value: number;
  label: string;
  change?: number | null;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-[9.5rem]">
      <Money value={value} />
      <div className="flex items-center gap-1.5 mt-0.5 text-[13px] text-muted">
        <span>{label}</span>
        {change !== undefined && <DeltaBadge change={change ?? null} />}
        {hint && (
          <span title={hint} className="inline-flex text-faint cursor-help">
            <HelpCircle size={14} aria-label={hint} />
          </span>
        )}
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/**
 * The סקירה panel: the period's money in three figures, the months behind them, and where the
 * receipts came from.
 *
 * It replaces the year cards and the income-against-expenses chart the dashboard opened with.
 * Two things it does that they did not: it answers for a chosen period rather than a calendar
 * year, and its expense side is weighted by what the tax return recognises — 45% of the car,
 * 15% of the household bills — so the הוצאות figure is the one a filing will accept rather than
 * the sum of the invoices. `סכום מלא` puts the invoices back.
 *
 * `onPeriod` hands the resolved window up: the cards below this panel still read a year, and
 * they follow the year the panel is showing rather than one chosen separately.
 */
export function OverviewPanel({ onPeriod }: { onPeriod?: (period: { from: string; to: string }) => void }) {
  const [period, setPeriod] = useState<PeriodKey>('current_year');
  const [basis, setBasis] = useState<ExpenseBasis>('recognized');
  const [incomeWithVat, setIncomeWithVat] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    get(`/dashboard/overview?period=${period}&basis=${basis}`)
      .then((res) => {
        if (!live) return;
        setData(res);
        onPeriod?.(res.period);
      })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [period, basis]);

  const recognized = basis === 'recognized';
  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <LabeledSelect
        label="חישוב הוצאות"
        value={basis}
        options={BASIS_OPTIONS}
        onChange={setBasis}
        className="w-44"
      />
      <LabeledSelect
        label="לתקופה"
        value={period}
        options={PERIOD_OPTIONS}
        onChange={setPeriod}
        icon={<CalendarDays size={16} />}
        className="w-56"
      />
    </div>
  );

  if (error) return <Card><Empty text={error} /></Card>;
  if (!data) return <Card><Empty text="טוען…" /></Card>;

  const t = data.totals;
  const income = incomeWithVat ? t.incomeTotal : t.income;
  const incomeChange = incomeWithVat ? data.change.incomeTotal : data.change.income;
  const range = `${dayShort(data.period.from)} - ${dayShort(data.period.to)}`;

  return (
    <Card className="p-0 overflow-hidden">
      {/* The period's three figures, and the two choices that decide what they count. */}
      <div className="flex flex-wrap-reverse items-start justify-between gap-x-6 gap-y-5 p-4 md:p-5 border-b border-line">
        {controls}
        <div className="flex items-start gap-5 md:gap-7">
          <Figure
            value={income}
            label="סה״כ הכנסות"
            change={incomeChange}
          >
            <Switch checked={incomeWithVat} onChange={setIncomeWithVat} label="הכנסות כולל מע״מ" />
          </Figure>
          <div className="self-stretch border-s border-line" />
          <Figure
            value={t.expenses}
            label={recognized ? 'סה״כ הוצאות מוכרות' : 'סה״כ הוצאות'}
            change={data.change.expenses}
          />
          <div className="self-stretch border-s border-line" />
          <Figure
            value={t.vatDue}
            label="סה״כ מע״מ לתשלום"
            hint={`מע״מ עסקאות ${Math.round(t.incomeVat).toLocaleString('he-IL')} ₪ פחות מע״מ תשומות ${Math.round(t.expensesVat).toLocaleString('he-IL')} ₪ בתקופה. סכום שלילי הוא החזר.`}
          >
            <Link
              to="/reports"
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-2 bg-surface border border-line rounded-full px-3 py-1.5 hover:border-line-strong transition-colors"
            >
              <ChartPie size={14} className="text-faint" />
              סגירה
            </Link>
          </Figure>
        </div>
      </div>

      {/* The ring first: in a right-to-left page it is the one the eye reaches before the axes. */}
      <div className="grid lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] gap-6 p-4 md:p-5">
        <div>
          <h2 className="text-[15px] font-bold text-ink-2 mb-2">פילוח תקבולים לפי לקוחות עיקריים</h2>
          <ClientDonut rows={data.clients} />
        </div>
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h2 className="text-[15px] font-bold text-ink-2">
              {recognized ? 'סה״כ הכנסות והוצאות (בשקלול אחוזים מוכרים למס)' : 'סה״כ הכנסות והוצאות (סכום מלא)'}
            </h2>
            <span className="text-[13px] text-muted" dir="rtl">לתקופה: <span dir="ltr" className="num">{range}</span></span>
          </div>
          <IncomeExpenseVatChart rows={data.monthly} labels={recognized ? OVERVIEW_LABELS : fullBasisLabels} />
        </div>
      </div>
    </Card>
  );
}
