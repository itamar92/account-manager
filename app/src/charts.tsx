import React from 'react';
import { clsx } from 'clsx';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { monthLabel, monthName, monthSlash, nis, nisExact, plain } from './api';
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
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="label" stroke={AXIS} fontSize={10} angle={-35} textAnchor="end" height={90} interval={0} tickLine={false} axisLine={false} />
          <YAxis stroke={AXIS} fontSize={11} width={64} tickLine={false} axisLine={false} tickFormatter={(v: number) => nis(v)} />
          <Tooltip
            cursor={{ fill: 'rgba(20,22,26,.04)' }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any, name: any) => [nis(v), name]}
          />
          {/* Above the plot: below it the rotated show names run straight into it. */}
          <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
          <Bar name="הכנסות" dataKey="income" fill="#6B45D6" radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Bar name="הוצאות" dataKey="expenses" fill="#DDD9EF" radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Bar name="רווח" dataKey="profit" fill="#12805F" radius={[6, 6, 0, 0]} maxBarSize={28} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * the סקירה panel's two drawings
 * ------------------------------------------------------------------------- */

/**
 * The overview's four series. Income and expenses each get a colour and their VAT gets a pale
 * version of it, because the VAT is not a fifth and sixth quantity — it is the part of the same
 * bar that was never the business's money, and it should read as that bar's lighter top.
 */
export const OVERVIEW_COLORS = {
  expenses: '#F3C63F',
  expensesVat: '#FBE6A4',
  income: '#6C7AE0',
  incomeVat: '#BCC2F2',
};

export const OVERVIEW_LABELS = {
  expenses: 'הוצאות מוכרות למס',
  expensesVat: 'מע"מ הוצאות מוכר',
  income: 'הכנסות',
  incomeVat: 'מע"מ הכנסות',
};

/** Expenses at full amount are not "recognised for tax" — the two bars say which they are. */
export const fullBasisLabels = {
  ...OVERVIEW_LABELS,
  expenses: 'הוצאות',
  expensesVat: 'מע"מ הוצאות',
};

/**
 * The tooltip both overview drawings share: one line per series, its name over its figure, in
 * the order the bars are stacked rather than the order recharts happens to hand them over.
 */
function OverviewTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div dir="rtl" style={TOOLTIP_STYLE} className="px-3 py-2 space-y-1.5">
      {[...payload].reverse().map((entry: any) => (
        <div key={entry.dataKey}>
          <div className="text-[11px] text-muted leading-tight">{entry.name}</div>
          <div className="num text-[13px] font-bold" style={{ color: entry.color }}>{nisExact(entry.value)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Income against expenses over the period, VAT stacked on each as its own band.
 *
 * Two stacks per month rather than four bars: the question the panel is read for is how the
 * two sides compare, and the VAT is a property of each side, not a competitor to it. `dir="ltr"`
 * on the frame keeps the months running earliest-first left to right, which is how a time axis
 * is read whichever way the page around it runs.
 */
export function IncomeExpenseVatChart({ rows, labels = OVERVIEW_LABELS, height = 'h-72 md:h-80' }: {
  rows: any[];
  labels?: typeof OVERVIEW_LABELS;
  height?: string;
}) {
  if (rows.length === 0) return <Empty text="אין תנועה בתקופה הנבחרת" />;
  return (
    <div className={height} dir="ltr">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthSlash} stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={AXIS} fontSize={11} width={56} tickLine={false} axisLine={false} tickFormatter={plain} />
          <Tooltip cursor={{ fill: 'rgba(20,22,26,.04)' }} content={<OverviewTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
          <Bar name={labels.expenses} dataKey="expenses" stackId="out" fill={OVERVIEW_COLORS.expenses} maxBarSize={26} />
          <Bar name={labels.expensesVat} dataKey="expensesVat" stackId="out" fill={OVERVIEW_COLORS.expensesVat} radius={[5, 5, 0, 0]} maxBarSize={26} />
          <Bar name={labels.income} dataKey="income" stackId="in" fill={OVERVIEW_COLORS.income} maxBarSize={26} />
          <Bar name={labels.incomeVat} dataKey="incomeVat" stackId="in" fill={OVERVIEW_COLORS.incomeVat} radius={[5, 5, 0, 0]} maxBarSize={26} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The slice colours, ordered so neighbours on the ring are never the same hue at two
 * lightnesses — the ring is read by telling one slice from the one beside it.
 */
const DONUT_COLORS = [
  '#7C86E8', '#5BD3D0', '#7BE0A0', '#3FA98C', '#2E7FD6',
  '#3B4EC0', '#9BE7B8', '#8FD8F5', '#12805F', '#B7BEF2', '#C9CED6',
];

/** A slice is labelled only when there is room on it for the number to be legible. */
const LABEL_FLOOR = 0.07;

/**
 * The share written across the middle of its own slice, as the panel this follows writes it.
 *
 * Inside rather than outside: a ring with ten slices has labels on every side of it, and hung
 * outside they collide with each other and with the card's edge. On the band they cannot.
 */
function sliceLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (!(percent >= LABEL_FLOOR)) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const rad = -midAngle * (Math.PI / 180);
  return (
    <text
      x={cx + radius * Math.cos(rad)}
      y={cy + radius * Math.sin(rad)}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight={700}
      fill="#14161a"
    >
      {(percent * 100).toFixed(1)}%
    </text>
  );
}

/**
 * Where the period's receipts came from: one ring, the largest clients named beside it.
 *
 * The legend is written out rather than left to recharts because client names are long and a
 * built-in legend either truncates them all to nothing or pushes the ring off the card. Here
 * the names take a fixed column and the ring keeps the rest.
 */
export function ClientDonut({ rows, height = 'h-72 md:h-80' }: { rows: any[]; height?: string }) {
  if (rows.length === 0) return <Empty text="לא התקבלו תקבולים בתקופה הנבחרת" />;
  const color = (i: number) => DONUT_COLORS[i % DONUT_COLORS.length];
  return (
    <div className={clsx('flex items-center gap-2', height)}>
      <div className="flex-1 min-w-0 h-full" dir="ltr">
        <ResponsiveContainer>
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Pie
              data={rows}
              dataKey="total"
              nameKey="name"
              innerRadius="46%"
              outerRadius="92%"
              paddingAngle={1}
              stroke="#fff"
              strokeWidth={2}
              labelLine={false}
              isAnimationActive={false}
              label={sliceLabel}
            >
              {rows.map((row, i) => <Cell key={row.name} fill={color(i)} />)}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: any, name: any) => [nisExact(v), name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* The names sit on the far side of the ring, as they do on the panel this follows. */}
      <ul className="w-28 md:w-36 shrink-0 space-y-1.5 text-[12px] text-ink-2">
        {rows.map((row, i) => (
          <li key={row.name} className="flex items-center justify-end gap-1.5" title={`${row.name} · ${nisExact(row.total)}`}>
            <span className="truncate">{row.name}</span>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color(i) }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
