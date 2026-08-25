import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { get, put, monthName, nis } from '../api';
import { Card, DataTable, Empty, EditableCell, PageHeader, PeriodBadge, Segmented, StatCard, YearSelect } from '../ui';
import { BASIS_LABEL, BasisToggle, IncomeExpenseChart, type Basis } from '../charts';

type Tab = 'vat' | 'incomeTax';

const tabs: [Tab, string][] = [
  ['vat', 'דוח מע"מ'],
  ['incomeTax', 'מס הכנסה'],
];

/**
 * The tax reports (דוחות) — what each מע"מ period owes, and what the year's profit means for
 * מס הכנסה.
 *
 * Everything on this page is computed from the invoices and the expenses already synced from
 * Morning, so there is nothing to enter and nothing that can fall out of step with the lists
 * it came from. The one thing that is stored is the tick beside a period once it has actually
 * been filed and paid — the app cannot learn that from the books.
 */
export function Reports() {
  const [tab, setTab] = useState<Tab>('vat');
  const [year, setYear] = useState(new Date().getFullYear());
  const [vat, setVat] = useState<any>(null);
  const [incomeTax, setIncomeTax] = useState<any>(null);
  const [error, setError] = useState('');

  // Both reports are loaded together: they are two readings of the same year, and switching
  // tabs should not mean waiting again.
  const load = () => {
    get(`/reports/vat?year=${year}`).then((d) => setVat(d.report)).catch((e) => setError(e.message));
    get(`/reports/income-tax?year=${year}`).then((d) => setIncomeTax(d.report)).catch((e) => setError(e.message));
  };
  useEffect(load, [year]);

  const toggleFiling = async (kind: 'vat' | 'income_tax', periodKey: string, field: 'filed' | 'paid', on: boolean) => {
    setError('');
    try {
      await put(`/reports/filings/${kind}/${periodKey}`, { [field]: on });
      load();
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="דוחות וסגירת חודש"
        sub={`שנת ${year} · מע"מ ומס הכנסה`}
        actions={
          <>
            <Segmented value={tab} onChange={setTab} options={tabs.map(([value, label]) => ({ value, label }))} />
            <YearSelect value={year} allowAll={false} onChange={(v) => setYear(v === '' ? new Date().getFullYear() : v)} />
          </>
        }
      />

      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}

      {tab === 'vat' && <VatReport report={vat} onToggle={toggleFiling} />}
      {tab === 'incomeTax' && <IncomeTaxReport report={incomeTax} onToggle={toggleFiling} />}
    </div>
  );
}

type ToggleFn = (kind: 'vat' | 'income_tax', periodKey: string, field: 'filed' | 'paid', on: boolean) => void;

/** ₪ with its sign spelled out as a direction, so a refund never reads as a debt. */
function VatDue({ amount }: { amount: number }) {
  return (
    <span className={amount >= 0 ? 'text-warn' : 'text-pos'}>
      {nis(Math.abs(amount))}
      <span className="text-xs text-faint"> {amount >= 0 ? 'לתשלום' : 'להחזר'}</span>
    </span>
  );
}

function VatReport({ report, onToggle }: { report: any; onToggle: ToggleFn }) {
  if (!report) return <Empty text="טוען…" />;

  const { totals } = report;
  const openExpenses = report.periods.reduce((n: number, p: any) => n + p.open_expenses, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label='מע"מ עסקאות' value={nis(totals.incomeVat)} sub={`על ${nis(totals.income)} מחזור`} accent="text-warn" />
        {/* Both figures here are the deductible ones — what the filing may claim, not what was
            paid out. An expense deducted at 80% contributes 80% of itself to each. */}
        <StatCard label='מע"מ תשומות' value={nis(totals.expensesVat)} sub={`על ${nis(totals.expenses)} הוצאות מוכרות`} accent="text-pos" />
        <StatCard
          label={totals.vatDue >= 0 ? 'סה"כ לתשלום השנה' : 'סה"כ להחזר השנה'}
          value={nis(Math.abs(totals.vatDue))}
          sub="מצטבר לכל תקופות הדיווח"
          accent={totals.vatDue >= 0 ? 'text-neg' : 'text-pos'}
        />
        <StatCard
          label="תדירות דיווח"
          value={report.frequency === 'monthly' ? 'חודשי' : 'דו-חודשי'}
          sub="ניתן לשינוי בהגדרות"
        />
      </div>

      {openExpenses > 0 && (
        <div className="text-sm text-warn">
          {openExpenses} הוצאות בשנה זו עדיין מסומנות ב-Morning כלא מדווחות — מע"מ התשומות שלהן נכלל כאן,
          אך כדאי לוודא שהן נכנסו לדיווח.
        </div>
      )}

      <div>
        <h2 className="ser text-lg mb-3">תקופות דיווח {report.year}</h2>
        <DataTable
          rows={report.periods}
          rowKey={(p: any) => p.key}
          columns={[
            // Deliberately allowed to wrap: a bi-monthly label is long enough that keeping it on
            // one line pushes the ten-column table off the side of the page.
            { key: 'period', header: 'תקופה', mobile: 'title', className: 'font-medium', render: (p: any) => p.label },
            {
              key: 'due', header: 'מועד הגשה', sortValue: (p: any) => p.due_date,
              className: 'whitespace-nowrap text-muted', render: (p: any) => p.due_date,
            },
            {
              key: 'income', header: 'עסקאות חייבות', sortValue: (p: any) => p.income,
              className: 'whitespace-nowrap', render: (p: any) => nis(p.income),
            },
            {
              key: 'outputVat', header: 'מע"מ עסקאות', sortValue: (p: any) => p.output_vat,
              className: 'whitespace-nowrap text-warn', render: (p: any) => nis(p.output_vat),
            },
            {
              key: 'expenses', header: 'תשומות', sortValue: (p: any) => p.expenses,
              className: 'whitespace-nowrap text-muted', render: (p: any) => nis(p.expenses),
            },
            {
              key: 'inputVat', header: 'מע"מ תשומות', sortValue: (p: any) => p.input_vat,
              className: 'whitespace-nowrap text-pos', render: (p: any) => nis(p.input_vat),
            },
            {
              key: 'due_amount', header: 'לתשלום', sortValue: (p: any) => p.vat_due,
              className: 'whitespace-nowrap font-medium', render: (p: any) => <VatDue amount={p.vat_due} />,
            },
            {
              key: 'status', header: 'סטטוס', sortValue: (p: any) => p.status,
              render: (p: any) => <PeriodBadge status={p.status} />,
            },
            {
              key: 'filed', header: 'דווח', label: 'דווח', mobile: 'actions',
              render: (p: any) => (
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <EditableCell type="checkbox" value={!!p.filing?.filed_at}
                    onSave={(v: any) => onToggle('vat', p.key, 'filed', !!v)} />
                  <span className="md:hidden">דווח</span>
                </label>
              ),
            },
            {
              key: 'paid', header: 'שולם', label: 'שולם', mobile: 'actions',
              render: (p: any) => (
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <EditableCell type="checkbox" value={!!p.filing?.paid_at}
                    onSave={(v: any) => onToggle('vat', p.key, 'paid', !!v)} />
                  <span className="md:hidden">שולם</span>
                </label>
              ),
            },
          ]}
        />
        <p className="text-xs text-faint mt-3">
          החישוב על בסיס מצטבר — מסמך שייך לתקופה שבה הוצא, גם אם הכסף טרם התקבל. חשבוניות זיכוי מקזזות.
          מועד ההגשה הוא ה-15 בחודש שאחרי סוף התקופה (נדחה ליום ראשון כשהוא חל בשבת); דחיות בשל חגים אינן מחושבות.
        </p>
      </div>
    </div>
  );
}

function IncomeTaxReport({ report, onToggle }: { report: any; onToggle: ToggleFn }) {
  const [basis, setBasis] = useState<Basis>('net');
  if (!report) return <Empty text="טוען…" />;

  const { totals, estimate, projection } = report;
  const net = basis === 'net';
  // Categories are shown before VAT — the deductible figure — so the bars are scaled by the
  // same number they print, not by the VAT-inclusive total the list happens to be sorted on.
  const biggestCategory = Math.max(1, ...report.byCategory.map((c: any) => c.subtotal));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label={`הכנסות ${report.year}`} value={nis(totals.income)} sub='לפני מע"מ' accent="text-pos" />
        <StatCard label="הוצאות מוכרות" value={nis(totals.expenses)} sub='לפני מע"מ' accent="text-neg" />
        <StatCard
          label="רווח לפני מס"
          value={nis(totals.profit)}
          sub="הכנסות פחות הוצאות"
          accent={totals.profit >= 0 ? 'text-accent' : 'text-neg'}
        />
        <StatCard
          label="הערכת מס וביטוח לאומי"
          value={nis(estimate.total_liability)}
          sub={`${estimate.effective_rate}% מהרווח`}
          accent="text-warn"
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="ser text-lg">רווח והפסד לפי חודש</h2>
          <BasisToggle value={basis} onChange={setBasis} />
        </div>
        <IncomeExpenseChart rows={report.months} basis={basis} height="h-64 md:h-72" />
      </Card>

      {/* items-start so the shorter card keeps its own height instead of stretching to match. */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div>
          <h2 className="ser text-lg mb-3">פירוט חודשי ({BASIS_LABEL[basis]})</h2>
          <DataTable
            rows={report.months}
            rowKey={(m: any) => m.month}
            columns={[
              { key: 'month', header: 'חודש', mobile: 'title', className: 'font-medium', render: (m: any) => monthName(m.month) },
              {
                key: 'income', header: 'הכנסות', sortValue: (m: any) => (net ? m.income : m.incomeTotal),
                className: 'whitespace-nowrap text-pos', render: (m: any) => nis(net ? m.income : m.incomeTotal),
              },
              {
                key: 'expenses', header: 'הוצאות', sortValue: (m: any) => (net ? m.expenses : m.expensesTotal),
                className: 'whitespace-nowrap text-neg', render: (m: any) => nis(net ? m.expenses : m.expensesTotal),
              },
              {
                key: 'profit', header: 'רווח', sortValue: (m: any) => (net ? m.profit : m.profitTotal),
                className: 'whitespace-nowrap font-medium',
                render: (m: any) => {
                  const value = net ? m.profit : m.profitTotal;
                  return <span className={value >= 0 ? 'text-accent' : 'text-neg'}>{nis(value)}</span>;
                },
              },
            ]}
          />
          <div className="flex items-center justify-between text-sm font-bold px-4 py-3 mt-2 bg-surface border border-line rounded-xl">
            <span>סה"כ {report.year}</span>
            <span className={
              (net ? totals.profit : totals.profitTotal) >= 0 ? 'text-accent' : 'text-neg'
            }>
              {nis(net ? totals.profit : totals.profitTotal)}
            </span>
          </div>
        </div>

        <Card>
          <h2 className="ser text-lg mb-3">הוצאות לפי סיווג</h2>
          {report.byCategory.length === 0 ? (
            <Empty text="אין הוצאות בשנה זו" />
          ) : (
            <div className="space-y-2">
              {report.byCategory.map((row: any) => (
                <div key={row.category}>
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className="truncate">{row.category}</span>
                    <span className="text-muted shrink-0">
                      {nis(row.subtotal)} <span className="text-xs text-ghost">· {row.count}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-soft overflow-hidden">
                    <div className="h-full bg-neg-soft"
                      style={{ width: `${Math.max(2, (row.subtotal / biggestCategory) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="ser text-lg">הערכת חבות מס {report.year}</h2>
          <label className="flex items-center gap-2 text-sm text-muted">
            <EditableCell type="checkbox" value={!!report.filing?.filed_at}
              onSave={(v: any) => onToggle('income_tax', String(report.year), 'filed', !!v)} />
            הדוח השנתי הוגש
          </label>
        </div>

        {/* One column: this is a chain — profit, less ביטוח לאומי, into the brackets, less the
            credit points — and it only reads correctly straight down. */}
        <div className="text-sm max-w-xl">
          <SummaryLine label="רווח חייב (לפני ניכויים)" value={nis(estimate.profit)} />
          <SummaryLine label="ביטוח לאומי ומס בריאות" value={nis(estimate.national_insurance)} />
          <SummaryLine label={`ניכוי ${Math.round(estimate.ni_deductible_share * 100)}% מביטוח לאומי`} value={nis(-estimate.ni_deduction)} />
          <SummaryLine label="הכנסה חייבת במס" value={nis(estimate.taxable_income)} />
          <SummaryLine label="מס לפי מדרגות" value={nis(estimate.tax_before_credits)} />
          <SummaryLine label={`זיכוי ${estimate.credit_points} נקודות`} value={nis(-estimate.credits)} />
          <SummaryLine label="מס הכנסה" value={nis(estimate.income_tax)} strong />
          <SummaryLine label="ביטוח לאומי" value={nis(estimate.national_insurance)} />
          <SummaryLine label="סה״כ מס וביטוח לאומי" value={nis(estimate.total_liability)} strong accent="text-warn" />
          <SummaryLine label="רווח נטו משוער" value={nis(estimate.net_profit)} strong accent="text-pos" />
          <SummaryLine label="שיעור מס אפקטיבי" value={`${estimate.effective_rate}%`} />
        </div>

        {projection && (
          <div className="mt-4 pt-3 border-t border-line">
            <h3 className="text-sm font-bold mb-2">תחזית לשנה מלאה</h3>
            <p className="text-xs text-faint mb-2">
              על בסיס {projection.months_elapsed} החודשים שחלפו, בהנחת המשך באותו קצב.
            </p>
            <div className="text-sm max-w-xl">
              <SummaryLine label="רווח שנתי צפוי" value={nis(projection.profit)} />
              <SummaryLine label="מס וביטוח לאומי צפויים" value={nis(projection.total_liability)} accent="text-warn" />
              <SummaryLine label="רווח נטו צפוי" value={nis(projection.net_profit)} accent="text-pos" />
            </div>
          </div>
        )}

        <p className="text-xs text-faint mt-4">
          הערכה בלבד, לפי מדרגות המס ושיעורי הביטוח הלאומי של {estimate.rates_year} ו-{estimate.credit_points} נקודות
          זיכוי (ניתן לשינוי בהגדרות). החישוב אינו מכיר הכנסות ממקורות אחרים, הפקדות לפנסיה או קרן השתלמות,
          זיכויים אישיים או מקדמות ששולמו — אינו תחליף לדוח שמגיש רואה החשבון.
        </p>
      </Card>
    </div>
  );
}

/** One "label … figure" line of the estimate breakdown. */
function SummaryLine({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: string }) {
  return (
    <div className={clsx('flex items-center justify-between gap-3 py-1', strong && 'border-t border-line pt-2')}>
      <span className="text-muted">{label}</span>
      <span className={clsx('whitespace-nowrap', strong && 'font-bold', accent || 'text-ink')}>{value}</span>
    </div>
  );
}
