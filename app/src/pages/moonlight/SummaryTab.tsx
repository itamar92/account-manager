import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, nis } from '../../api';
import { PerShowChart } from '../../charts';
import { Button, Card, Empty, FilterBar, Input, MonthSelect, PageHeader, StatCard, YearSelect } from '../../ui';
import { MEMBERS, PAYMENT_STATUS_STYLES, paymentStatusLabel, roleName } from './shared';
import { DivisionTable } from './DivisionTable';

const yearBounds = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/** The bounds of one month, for narrowing the summary to a single period. */
const monthBounds = (year: number, month: number) => {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${lastDay}` };
};

/**
 * Moonlight's own dashboard: the statistics over any span, the money still coming to each
 * member from shows that were not yet paid out, and the follow-up lists — money that has
 * not arrived, suppliers not yet paid, and upcoming shows with nobody staffed.
 *
 * It keeps its own range rather than following the tables: the tables are for working on this
 * year, while the point of the summary is being able to look back over previous ones.
 */
export function SummaryTab({ onError }: { onError: (message: string) => void }) {
  const thisYear = new Date().getFullYear();
  const [range, setRange] = useState(yearBounds(thisYear));
  const [month, setMonth] = useState<number | ''>('');
  const [custom, setCustom] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [division, setDivision] = useState<any>(null);
  const [followUps, setFollowUps] = useState<any>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    get(`/moonlight/summary?${qs}`).then((d) => setSummary(d.summary)).catch((e) => onError(e.message));
    get(`/moonlight/division?${qs}`).then((d) => setDivision(d.division)).catch((e) => onError(e.message));
  }, [range.from, range.to]);

  // The follow-ups are not range-bound: an unpaid show is a loose end whatever year it is in.
  useEffect(() => {
    get('/moonlight/follow-ups').then((d) => setFollowUps(d.followUps)).catch((e) => onError(e.message));
  }, []);

  // Which year the range is showing, or '' when it spans more than one.
  const selectedYear = !custom && range.from.slice(0, 4) === range.to.slice(0, 4)
    ? parseInt(range.from.slice(0, 4), 10)
    : '';

  const setPeriod = (year: number | '', nextMonth: number | '') => {
    setCustom(false);
    setMonth(year === '' ? '' : nextMonth);
    setRange(
      year === '' ? { from: '2000-01-01', to: '2099-12-31' }
        : nextMonth === '' ? yearBounds(year)
        : monthBounds(year, nextMonth)
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="סקירה כספית"
        sub={summary ? <><span className="num">{summary.eventCount}</span> הופעות · <span className="num">{summary.upcomingEvents}</span> קרובות</> : undefined}
      />

      <FilterBar>
        <YearSelect value={selectedYear} onChange={(year) => setPeriod(year, month)} />
        <MonthSelect
          value={selectedYear === '' ? '' : month}
          disabled={selectedYear === ''}
          onChange={(next) => setPeriod(selectedYear, next)}
        />
        <Button variant="ghost" onClick={() => setCustom(!custom)}>
          {custom ? 'לפי שנה' : 'טווח מותאם'}
        </Button>
        {custom && (
          <>
            <Input type="date" value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <Input type="date" value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </>
        )}
      </FilterBar>

      {!summary ? <Empty text="טוען…" /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="סה״כ הכנסות (לפני מע״מ)" value={nis(summary.totalRevenue)} accent="text-pos"
              sub={`${summary.eventCount} הופעות`} />
            <StatCard label="סה״כ הוצאות הופעות" value={nis(summary.totalExpenses)} accent="text-neg" />
            <StatCard label="רווח מצטבר" value={nis(summary.totalProfit)} accent="text-accent" />
            <StatCard label="הוצאות כלליות" value={nis(summary.generalExpenses)} accent="text-neg"
              sub={`מתוכן מהקופה ${nis(summary.fundExpenses)}`} />
          </div>

          <Card>
            <h2 className="ser text-lg mb-3">רווח כולל לכל אחד בטווח הנבחר</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {MEMBERS.map((m) => (
                <div key={m.key} className="bg-soft rounded-xl p-3 text-center">
                  <div className="text-sm text-muted">{m.name}</div>
                  <div className="text-xl font-bold mt-1 text-accent">{nis(summary[m.key])}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="ser text-lg mb-3">הכנסות, הוצאות ורווח לפי הופעה</h2>
            <PerShowChart rows={summary.perShow ?? []} />
          </Card>

          <DivisionTable division={division} />

          {/* The loose ends: money that has not come in, suppliers who have not been paid,
              and upcoming shows with nobody staffed. */}
          <div className="grid lg:grid-cols-2 gap-4">
            <FollowUpCard
              title="הופעות שממתינות לתשלום"
              total={followUps?.awaitingPaymentTotal}
              rows={followUps?.awaitingPayment}
              empty="כל ההופעות שולמו"
              accent="text-warn"
              render={(row: any) => (
                <>
                  <span className={PAYMENT_STATUS_STYLES[row.payment_status]}>{paymentStatusLabel(row.payment_status)}</span>
                  <span className="font-medium">{nis(row.amount)}</span>
                </>
              )}
            />
            <FollowUpCard
              title="הופעות עם חוב לספקים"
              total={followUps?.owedToSuppliersTotal}
              rows={followUps?.owedToSuppliers}
              empty="אין חובות פתוחים לספקים"
              accent="text-neg"
              render={(row: any) => <span className="font-medium text-neg">{nis(row.outstanding)}</span>}
            />
          </div>

          {(followUps?.missingAssignments?.length ?? 0) > 0 && (
            <Card className="border-warn/25">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-warn">
                  ⚠ הופעות קרובות עם שיבוץ חסר ({followUps.missingAssignments.length})
                </h2>
                <span className="text-sm text-accent">לשונית «שיבוצים» ←</span>
              </div>
              <div className="space-y-2">
                {followUps.missingAssignments.slice(0, 6).map((row: any) => (
                  <div key={row.id} className="flex items-center justify-between text-sm border-b border-line pb-2 last:border-0">
                    <div>
                      <div className="font-medium">{row.venue}</div>
                      <div className="text-xs text-faint">{row.date}</div>
                    </div>
                    <span className="text-warn text-xs">
                      חסר: {row.missing.map((r: string) => roleName(r)).join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="text-sm text-faint">הופעות קרובות: {summary.upcomingEvents}</div>
        </>
      )}
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
        <h2 className="ser text-lg">{title}</h2>
        <span className={`text-lg font-bold ${accent}`}>{nis(total)}</span>
      </div>
      {list.length === 0 ? <Empty text={empty} /> : (
        <div className="space-y-2">
          {list.slice(0, 6).map((row) => (
            <div key={row.id} className="flex items-center justify-between text-sm border-b border-line pb-2 last:border-0">
              <div>
                <div className="font-medium">{row.venue}</div>
                <div className="text-xs text-faint">{row.date}</div>
              </div>
              <div className="flex items-center gap-3">{render(row)}</div>
            </div>
          ))}
          {list.length > 6 && (
            <Link to="/moonlight" className="block text-xs text-accent hover:underline pt-1">
              ועוד {list.length - 6} הופעות ←
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
