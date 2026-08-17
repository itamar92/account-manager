import React from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { monthLabel, monthName, nis } from './api';
import { Empty, Segmented } from './ui';

/**
 * Whether figures count VAT. Profit before VAT is the real one — neither VAT figure is the
 * business's money — but the totals with VAT are what actually moved through the bank, so
 * both views are worth having, as the Morning dashboard offers them.
 */
export type Basis = 'net' | 'gross';

/** Which fields of a monthly P&L row each basis reads. */
export const SERIES: Record<Basis, { income: string; expenses: string; profit: string }> = {
  net: { income: 'income', expenses: 'expenses', profit: 'profit' },
  gross: { income: 'incomeTotal', expenses: 'expensesTotal', profit: 'profitTotal' },
};

export const CHART_COLORS = { income: '#12805F', expenses: '#DDE0E6', profit: '#3B5BDB' };

/** Light-theme axis furniture, shared by both charts so they read as one drawing. */
const AXIS = '#8A9099';
const GRID = '#EDEEF1';
const TOOLTIP_STYLE = {
  background: '#fff',
  border: '1px solid #E6E8EC',
  borderRadius: 12,
  boxShadow: '0 12px 30px rgba(20,24,32,.12)',
  fontSize: 13,
};

export const BASIS_LABEL: Record<Basis, string> = { net: 'לפני מע"מ', gross: 'כולל מע"מ' };

/** The two-way switch for the basis, shared by the pages that offer it. */
export function BasisToggle({ value, onChange }: { value: Basis; onChange: (value: Basis) => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={(Object.keys(BASIS_LABEL) as Basis[]).map((key) => ({ value: key, label: BASIS_LABEL[key] }))}
    />
  );
}

/**
 * The year at a glance: income against expenses, one pair of bars per month, no axes.
 *
 * It sits on the inbox where the chart is a backdrop to the list above it rather than the
 * thing being read — the full one, with its scale and its profit line, is a click away.
 */
export function MiniBarChart({ rows, basis = 'net' }: { rows: any[]; basis?: Basis }) {
  const keys = SERIES[basis];
  const max = Math.max(1, ...rows.map((r) => Math.max(Number(r[keys.income]) || 0, Number(r[keys.expenses]) || 0)));
  return (
    <div dir="ltr" className="flex items-end gap-2 md:gap-3.5 h-[170px]">
      {rows.map((row) => (
        <div key={row.month} className="flex-1 flex flex-col justify-end h-full gap-1.5">
          <div className="flex items-end gap-[3px] h-full" title={`${monthName(row.month)} · ${nis(row[keys.income])}`}>
            <div
              className="flex-1 rounded-t bg-accent"
              style={{ height: `${Math.max((Number(row[keys.income]) || 0) / max * 100, 1)}%` }}
            />
            <div
              className="flex-1 rounded-t bg-[#DDE0E6]"
              style={{ height: `${Math.max((Number(row[keys.expenses]) || 0) / max * 100, 1)}%` }}
            />
          </div>
          <div className="text-[11px] text-faint text-center">{monthLabel(row.month)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The year's income against its expenses, month by month, with profit drawn over the two as a
 * line — it is the difference between them, not a third quantity competing for the same space.
 *
 * `dir="ltr"` on the frame is deliberate: the months run January to December left to right, the
 * order a time axis is read in whichever way the page around it runs.
 */
export function IncomeExpenseChart({ rows, basis, height = 'h-72 md:h-80' }: {
  rows: any[];
  basis: Basis;
  height?: string;
}) {
  const keys = SERIES[basis];
  return (
    <div className={height} dir="ltr">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthLabel} stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={AXIS} fontSize={11} width={64} tickLine={false} axisLine={false} tickFormatter={(v: number) => nis(v)} />
          <Tooltip
            cursor={{ fill: 'rgba(20,22,26,.04)' }}
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(m: any) => monthName(String(m))}
            formatter={(v: any, name: any) => [nis(v), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar name="הכנסות" dataKey={keys.income} fill={CHART_COLORS.income} radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Bar name="הוצאות" dataKey={keys.expenses} fill={CHART_COLORS.expenses} radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Line name="רווח" type="monotone" dataKey={keys.profit} stroke={CHART_COLORS.profit} strokeWidth={2}
            dot={{ r: 3, fill: CHART_COLORS.profit }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Income, expenses and profit per show, oldest first — the same three quantities as the
 * monthly chart above, broken down by show instead of by month for a closer look at a range.
 *
 * The show labels run along the bottom rather than the side: there can be many more shows in a
 * year than months, so they are angled to stay readable without eating the chart's height.
 */
export function PerShowChart({ rows, height = 'h-72 md:h-80' }: { rows: any[]; height?: string }) {
  if (rows.length === 0) return <Empty text="אין הופעות בטווח הנבחר" />;
  return (
    <div className={height} dir="ltr">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 32 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="label" stroke={AXIS} fontSize={10} angle={-35} textAnchor="end" height={70} tickLine={false} axisLine={false} />
          <YAxis stroke={AXIS} fontSize={11} width={64} tickLine={false} axisLine={false} tickFormatter={(v: number) => nis(v)} />
          <Tooltip
            cursor={{ fill: 'rgba(20,22,26,.04)' }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any, name: any) => [nis(v), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar name="הכנסות" dataKey="income" fill="#6B45D6" radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Bar name="הוצאות" dataKey="expenses" fill="#DDD9EF" radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Bar name="רווח" dataKey="profit" fill="#12805F" radius={[6, 6, 0, 0]} maxBarSize={28} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
