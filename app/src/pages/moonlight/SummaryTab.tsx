import React, { useEffect, useState } from 'react';
import { get, nis } from '../../api';
import { Button, Card, Empty, Input, StatCard, YearSelect } from '../../ui';
import { MEMBERS } from './shared';

const yearBounds = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/**
 * The statistics, over any span you ask for.
 *
 * It keeps its own range rather than following the tables: the tables are for working on this
 * year, while the point of the summary is being able to look back over previous ones.
 */
export function SummaryTab({ onError }: { onError: (message: string) => void }) {
  const thisYear = new Date().getFullYear();
  const [range, setRange] = useState(yearBounds(thisYear));
  const [custom, setCustom] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    get(`/moonlight/summary?${qs}`).then((d) => setSummary(d.summary)).catch((e) => onError(e.message));
  }, [range.from, range.to]);

  // Which year the range is showing, or '' when it spans more than one.
  const selectedYear = !custom && range.from.slice(0, 4) === range.to.slice(0, 4)
    ? parseInt(range.from.slice(0, 4), 10)
    : '';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="block text-sm text-slate-400 mb-1">טווח תאריכים</span>
            <YearSelect value={selectedYear} onChange={(year) => {
              setCustom(false);
              setRange(year === '' ? { from: '2000-01-01', to: '2099-12-31' } : yearBounds(year));
            }} />
          </div>
          <Button variant="ghost" onClick={() => setCustom(!custom)}>
            {custom ? 'לפי שנה' : 'טווח מותאם'}
          </Button>
          {custom && (
            <>
              <Input label="מתאריך" type="date" value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })} />
              <Input label="עד תאריך" type="date" value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </>
          )}
        </div>
      </Card>

      {!summary ? <Empty text="טוען…" /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="סה״כ הכנסות (לפני מע״מ)" value={nis(summary.totalRevenue)} accent="text-emerald-400"
              sub={`${summary.eventCount} הופעות`} />
            <StatCard label="סה״כ הוצאות הופעות" value={nis(summary.totalExpenses)} accent="text-rose-400" />
            <StatCard label="רווח מצטבר" value={nis(summary.totalProfit)} accent="text-indigo-400" />
            <StatCard label="הוצאות כלליות" value={nis(summary.generalExpenses)} accent="text-rose-400"
              sub={`מתוכן מהקופה ${nis(summary.fundExpenses)}`} />
          </div>
          <Card>
            <h2 className="font-bold mb-4">חלוקה לחברי הלהקה</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {MEMBERS.map((m) => (
                <div key={m.key} className="bg-slate-800/50 rounded-xl p-4 text-center">
                  <div className="text-sm text-slate-400">{m.name}</div>
                  <div className="text-xl font-bold text-indigo-300">{nis(summary[m.key])}</div>
                </div>
              ))}
            </div>
          </Card>
          <div className="text-sm text-slate-500">הופעות קרובות: {summary.upcomingEvents}</div>
        </>
      )}
    </div>
  );
}
