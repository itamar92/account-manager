import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, monthName, nis } from '../api';
import { Card, StatCard, StatusBadge, Empty, YearSelect } from '../ui';
import { BASIS_LABEL, BasisToggle, IncomeExpenseChart, type Basis } from '../charts';

export function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [basis, setBasis] = useState<Basis>('net');
  const [error, setError] = useState('');

  useEffect(() => {
    get(`/dashboard?year=${year}`).then(setData).catch((e) => setError(e.message));
  }, [year]);

  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="טוען…" />;

  const totals = data.yearTotals;
  const month = data.month;
  const net = basis === 'net';
  const income = net ? totals.income : totals.incomeTotal;
  const expenses = net ? totals.expenses : totals.expensesTotal;
  const profit = net ? totals.profit : totals.profitTotal;
  const monthProfit = net ? month.profit : month.profitTotal;
  const vatNote = BASIS_LABEL[basis];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">סקירה כללית</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Both views of the same year, side by side — switching is a reading choice, not a filter. */}
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect value={year} allowAll={false} onChange={(v) => setYear(v === '' ? new Date().getFullYear() : v)} />
        </div>
      </div>

      {/* The year's money in one row: what came in, what went out, what is left. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label={`הכנסות ${year}`} value={nis(income)} sub={vatNote} accent="text-emerald-400" />
        <StatCard label={`הוצאות ${year}`} value={nis(expenses)} sub={vatNote} accent="text-rose-400" />
        <StatCard
          label={`רווח ${year}`}
          value={nis(profit)}
          sub={`${nis(income)} פחות ${nis(expenses)}`}
          accent={profit >= 0 ? 'text-indigo-300' : 'text-rose-400'}
        />
        <StatCard
          label={`רווח ${monthName(month.month)}`}
          value={nis(monthProfit)}
          sub={`הכנסות ${nis(net ? month.income : month.incomeTotal)} · הוצאות ${nis(net ? month.expenses : month.expensesTotal)}`}
          accent={monthProfit >= 0 ? 'text-indigo-300' : 'text-rose-400'}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="font-bold">הכנסות מול הוצאות · {year}</h2>
          <Link to="/reports" className="text-sm text-indigo-400 hover:underline">דוחות מע"מ ומס הכנסה ←</Link>
        </div>
        <IncomeExpenseChart rows={data.monthly} basis={basis} />
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="חשבוניות פתוחות (גבייה)" value={nis(data.openInvoices.total)} sub={`${data.openInvoices.count} חשבוניות`} accent="text-amber-400" />
        <StatCard label={`התקבל ב-${year}`} value={nis(data.paidYtd.total)} accent="text-emerald-400" />
        <StatCard label="עבודות שטרם חויבו" value={nis(data.unpaidWorks.total)} sub={`${data.unpaidWorks.count} עבודות`} accent="text-sky-400" />
        <StatCard label="Moonlight — רווח מצטבר" value={nis(data.band.totalProfit)} sub={`${data.band.upcomingEvents} הופעות קרובות`} accent="text-indigo-400" />
      </div>

      {/* items-start so the shorter card keeps its own height instead of stretching to match. */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">חשבוניות אחרונות</h2>
            <Link to="/invoices" className="text-sm text-indigo-400 hover:underline">הכל ←</Link>
          </div>
          <div className="space-y-2">
            {data.recentInvoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-800/60 last:border-0">
                <div>
                  <div className="font-medium">{inv.client_name}</div>
                  <div className="text-xs text-slate-500">#{inv.number} · {inv.date}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{nis(inv.total)}</span>
                  <StatusBadge status={inv.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* The VAT the year has accumulated, as a pointer into the report that files it. */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">מע"מ {year}</h2>
            <Link to="/reports" className="text-sm text-indigo-400 hover:underline">לדוח המלא ←</Link>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">מע"מ עסקאות</span>
              <span className="font-medium">{nis(totals.incomeVat)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">מע"מ תשומות</span>
              <span className="font-medium text-emerald-400">{nis(totals.expensesVat)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <span className="text-slate-300">{totals.vatDue >= 0 ? 'לתשלום' : 'להחזר'}</span>
              <span className={`font-bold ${totals.vatDue >= 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {nis(Math.abs(totals.vatDue))}
              </span>
            </div>
            <p className="text-xs text-slate-500 pt-1">
              מצטבר לכל השנה — הפירוט לפי תקופות דיווח נמצא בדוח מע"מ.
            </p>
          </div>
        </Card>
      </div>

      {/* The band's money detail — member split, shows awaiting payment, supplier debts —
          lives on the Moonlight summary tab; here only the headline figure above. */}
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Moonlight Finance</h2>
          <Link to="/moonlight" className="text-sm text-indigo-400 hover:underline">
            לחלוקה בין החברים, כספים בדרך וחובות לספקים ←
          </Link>
        </div>
      </Card>
    </div>
  );
}
