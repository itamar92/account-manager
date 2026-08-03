import React from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { monthLabel, monthName, nis } from './api';

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

export const CHART_COLORS = { income: '#34d399', expenses: '#fb7185', profit: '#818cf8' };

export const BASIS_LABEL: Record<Basis, string> = { net: 'לפני מע"מ', gross: 'כולל מע"מ' };

/** The two-way switch for the basis, shared by the pages that offer it. */
export function BasisToggle({ value, onChange }: { value: Basis; onChange: (value: Basis) => void }) {
  return (
    <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-sm">
      {(Object.keys(BASIS_LABEL) as Basis[]).map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            value === key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {BASIS_LABEL[key]}
        </button>
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
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="month" tickFormatter={monthLabel} stroke="#64748b" fontSize={11} />
          <YAxis stroke="#64748b" fontSize={11} width={64} tickFormatter={(v: number) => nis(v)} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12 }}
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
