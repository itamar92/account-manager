import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, nis } from '../api';
import { Card, StatCard, StatusBadge, Empty, PageHeader } from '../ui';
import { OverviewPanel } from './OverviewPanel';
import { useAuth } from '../AuthContext';

export function Dashboard() {
  const [data, setData] = useState<any>(null);
  // The year the cards under the panel report on. The panel owns the period control and hands
  // its window down, so the page never asks the same question twice in two different places.
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [error, setError] = useState('');

  useEffect(() => {
    get(`/dashboard?year=${year}`).then(setData).catch((e) => setError(e.message));
  }, [year]);

  return (
    <div className="space-y-5">
      <PageHeader title="סקירה" sub="הכנסות, הוצאות מוכרות ומע״מ — לתקופה שנבחרה" />

      {/* The period's money: three figures, the months behind them, and who paid. */}
      <OverviewPanel onPeriod={(period) => setYear(parseInt(period.from.slice(0, 4), 10))} />

      {error && <Empty text={error} />}
      {!error && !data && <Empty text="טוען…" />}
      {!error && data && <DashboardRest data={data} year={year} />}
    </div>
  );
}

/** Everything under the panel: the balances the year still carries, and the pointers out. */
function DashboardRest({ data, year }: { data: any; year: number }) {
  const totals = data.yearTotals;
  const bandName = useAuth().branding.band_name;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="חשבוניות פתוחות (גבייה)" value={nis(data.openInvoices.total)} sub={`${data.openInvoices.count} חשבוניות`} accent="text-warn" />
        <StatCard label={`התקבל ב-${year}`} value={nis(data.paidYtd.total)} accent="text-pos" />
        <StatCard label="עבודות שטרם חויבו" value={nis(data.unpaidWorks.total)} sub={`${data.unpaidWorks.count} עבודות`} accent="text-accent" />
        <StatCard label={`${bandName} — רווח מצטבר`} value={nis(data.band.totalProfit)} sub={`${data.band.upcomingEvents} הופעות קרובות`} accent="text-accent" />
      </div>

      {/* items-start so the shorter card keeps its own height instead of stretching to match. */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="ser text-lg">חשבוניות אחרונות</h2>
            <Link to="/invoices" className="text-sm text-accent hover:underline">הכל ←</Link>
          </div>
          <div className="space-y-2">
            {data.recentInvoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between text-sm py-1.5 border-b border-line last:border-0">
                <div>
                  <div className="font-medium">{inv.client_name}</div>
                  <div className="text-xs text-faint">#{inv.number} · {inv.date}</div>
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
            <h2 className="ser text-lg">מע"מ {year}</h2>
            <Link to="/reports" className="text-sm text-accent hover:underline">לדוח המלא ←</Link>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">מע"מ עסקאות</span>
              <span className="font-medium">{nis(totals.incomeVat)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">מע"מ תשומות</span>
              <span className="font-medium text-pos">{nis(totals.expensesVat)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-line">
              <span className="text-ink-2">{totals.vatDue >= 0 ? 'לתשלום' : 'להחזר'}</span>
              <span className={`font-bold ${totals.vatDue >= 0 ? 'text-warn' : 'text-pos'}`}>
                {nis(Math.abs(totals.vatDue))}
              </span>
            </div>
            <p className="text-xs text-faint pt-1">
              מצטבר לכל השנה — הפירוט לפי תקופות דיווח נמצא בדוח מע"מ.
            </p>
          </div>
        </Card>
      </div>

      {/* The band's money detail — member split, shows awaiting payment, supplier debts —
          lives on the band summary tab; here only the headline figure above. */}
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="ser text-lg">כספי {bandName}</h2>
          <Link to="/band/summary" className="text-sm text-accent hover:underline">
            לחלוקה בין החברים, כספים בדרך וחובות לספקים ←
          </Link>
        </div>
      </Card>
    </>
  );
}
