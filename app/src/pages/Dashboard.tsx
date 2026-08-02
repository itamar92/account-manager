import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { get, nis } from '../api';
import { Card, StatCard, StatusBadge, Empty } from '../ui';
import { MEMBERS, PAYMENT_STATUS_STYLES, paymentStatusLabel } from './moonlight/shared';

export function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="טוען…" />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">סקירה כללית</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="חשבוניות פתוחות (גבייה)" value={nis(data.openInvoices.total)} sub={`${data.openInvoices.count} חשבוניות`} accent="text-amber-400" />
        <StatCard label="התקבל השנה" value={nis(data.paidYtd.total)} accent="text-emerald-400" />
        <StatCard label="עבודות שטרם חויבו" value={nis(data.unpaidWorks.total)} sub={`${data.unpaidWorks.count} עבודות`} accent="text-sky-400" />
        <StatCard label="Moonlight — רווח מצטבר" value={nis(data.band.totalProfit)} sub={`${data.band.upcomingEvents} הופעות קרובות`} accent="text-indigo-400" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h2 className="font-bold mb-4">הכנסות לפי חודש</h2>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer>
              <BarChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12 }}
                  formatter={(v: any, name: any) => [nis(v), name === 'paid' ? 'שולם' : 'פתוח']}
                />
                <Bar dataKey="paid" stackId="a" fill="#34d399" radius={[0, 0, 0, 0]} />
                <Bar dataKey="open" stackId="a" fill="#fbbf24" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

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
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">Moonlight Finance — חלוקה לחברים</h2>
          <Link to="/moonlight" className="text-sm text-indigo-400 hover:underline">לאזור המלא ←</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {MEMBERS.map((m) => (
            <div key={m.key} className="bg-slate-800/50 rounded-xl p-3 text-center">
              <div className="text-sm text-slate-400">{m.name}</div>
              <div className="text-lg font-bold text-indigo-300">{nis(data.band[m.key])}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* The two loose ends of a show that has already happened: money that has not come in,
          and suppliers who have not been paid. */}
      <div className="grid lg:grid-cols-2 gap-4">
        <FollowUpCard
          title="הופעות שממתינות לתשלום"
          total={data.bandFollowUps?.awaitingPaymentTotal}
          rows={data.bandFollowUps?.awaitingPayment}
          empty="כל ההופעות שולמו"
          accent="text-amber-400"
          render={(row: any) => (
            <>
              <span className={PAYMENT_STATUS_STYLES[row.payment_status]}>{paymentStatusLabel(row.payment_status)}</span>
              <span className="font-medium">{nis(row.amount)}</span>
            </>
          )}
        />
        <FollowUpCard
          title="הופעות עם חוב לספקים"
          total={data.bandFollowUps?.owedToSuppliersTotal}
          rows={data.bandFollowUps?.owedToSuppliers}
          empty="אין חובות פתוחים לספקים"
          accent="text-rose-400"
          render={(row: any) => <span className="font-medium text-rose-400">{nis(row.outstanding)}</span>}
        />
      </div>
    </div>
  );
}

function FollowUpCard({ title, total, rows, empty, accent, render }: {
  title: string;
  total?: number;
  rows?: any[];
  empty: string;
  accent: string;
  render: (row: any) => React.ReactNode;
}) {
  const list = rows ?? [];
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold">{title}</h2>
        <span className={`text-lg font-bold ${accent}`}>{nis(total)}</span>
      </div>
      {list.length === 0 ? <Empty text={empty} /> : (
        <div className="space-y-2">
          {list.slice(0, 6).map((row) => (
            <div key={row.id} className="flex items-center justify-between text-sm border-b border-slate-800/60 pb-2 last:border-0">
              <div>
                <div className="font-medium">{row.venue}</div>
                <div className="text-xs text-slate-500">{row.date}</div>
              </div>
              <div className="flex items-center gap-3">{render(row)}</div>
            </div>
          ))}
          {list.length > 6 && (
            <Link to="/moonlight" className="block text-xs text-indigo-400 hover:underline pt-1">
              ועוד {list.length - 6} הופעות ←
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
