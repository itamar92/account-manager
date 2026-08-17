import React, { useState } from 'react';
import { clsx } from 'clsx';
import { nis } from '../../api';
import { Card, Empty } from '../../ui';
import { eventLabel } from './shared';

/**
 * How much each member is owed, and how that figure was reached — laid out the way the band's
 * spreadsheet has always laid it out, because the point of this table is that the total can be
 * checked rather than trusted.
 *
 * Three steps, each its own row: the shares of shows whose profit has not been handed out, plus
 * what a member paid out of their own pocket and has not had back, minus an equal part of what
 * the band's float covered for everyone.
 */
export function DivisionTable({ division }: { division: any }) {
  const [showWorking, setShowWorking] = useState(false);
  if (!division) return <Card><Empty text="טוען…" /></Card>;

  const {
    members, shows, showsTotal, refunds, refundsByMember,
    fundExpenses, fundTotal, fundShare, beforeRefund, payout,
  } = division;
  const nothing = shows.length === 0 && refunds.length === 0 && fundExpenses.length === 0;

  const cell = 'px-3 py-2 whitespace-nowrap text-center';
  const head = 'px-3 py-2 text-center font-medium text-muted whitespace-nowrap';

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="ser text-lg">חלוקת כספים — כמה מגיע לכל אחד</h2>
        {!nothing && (
          <button
            onClick={() => setShowWorking(!showWorking)}
            className="text-sm text-accent hover:underline"
          >
            {showWorking ? 'הסתרת אופן החישוב' : 'איך זה מחושב?'}
          </button>
        )}
      </div>
      <p className="text-xs text-faint mb-4">
        רווח מהופעות שהכסף בגינן התקבל וטרם סומנו «שולם לנגנים», פחות חלק שווה בהוצאות ששולמו
        מהקופה, ועוד החזר למי ששילם מכיסו. הוצאה שסומנה «שולם» כבר הוסדרה ואינה נכנסת לחישוב.
      </p>

      {/* The two figures worth seeing without asking. They are separate because a refund is the
          band handing someone their own money back, not a share of anything: counted in, one
          member looks like they earned more than the rest, and the line that says how the shows
          actually went for everybody disappears. */}
      {!nothing && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-right font-medium text-muted" />
                {members.map((m: any) => <th key={m.key} className={head}>{m.name}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-soft">
                {/* Held at its natural width so a phone scrolls the table sideways rather than
                    folding the label into a column of single words. */}
                <td className="px-3 py-2.5 text-right text-ink-2 whitespace-nowrap">
                  חלק ברווח <span className="text-xs text-faint">(לפני החזרי הוצאות)</span>
                </td>
                {members.map((m: any) => (
                  <td key={m.key} className={clsx(cell, 'font-medium text-accent')}>
                    {nis(beforeRefund[m.key])}
                  </td>
                ))}
              </tr>
              <tr className="bg-warn-soft border-t-2 border-warn/25">
                <td className="px-3 py-2.5 text-right font-bold whitespace-nowrap">סה״כ לתשלום</td>
                {members.map((m: any) => (
                  <td key={m.key} className={clsx(cell, 'font-bold text-warn text-base')}>
                    {nis(payout[m.key])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {nothing ? (
        <Empty text="אין מה לחלק בטווח הנבחר — כל ההופעות חולקו וכל ההוצאות הוסדרו" />
      ) : !showWorking ? null : (
        <div className="overflow-x-auto mt-5 pt-4 border-t border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-right font-medium text-muted">הופעות שטרם חולקו</th>
                {members.map((m: any) => <th key={m.key} className={head}>{m.name}</th>)}
                <th className={head}>סה״כ רווח</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-line">
              {shows.length === 0 ? (
                <tr>
                  <td colSpan={members.length + 2} className="px-3 py-3 text-faint text-right">
                    אין הופעות שממתינות לחלוקה
                  </td>
                </tr>
              ) : shows.map((s: any) => (
                <tr key={s.id} className="hover:bg-soft">
                  <td className="px-3 py-2 text-right">{eventLabel(s)}</td>
                  {members.map((m: any) => <td key={m.key} className={cell}>{nis(s[m.key])}</td>)}
                  <td className={clsx(cell, 'font-medium')}>{nis(s.profit)}</td>
                </tr>
              ))}
            </tbody>

            {/* The steps and the result, kept apart from the show rows so the arithmetic reads
                as arithmetic. The shared costs come off before the refunds go back on, so that
                both of the figures shown above the table appear here as lines of it. */}
            <tfoot>
              <tr className="bg-soft border-t-2 border-line">
                <td className="px-3 py-2 text-right font-bold">סה״כ ({showsTotal.count} הופעות)</td>
                {members.map((m: any) => (
                  <td key={m.key} className={clsx(cell, 'font-bold')}>{nis(showsTotal[m.key])}</td>
                ))}
                <td className={clsx(cell, 'font-bold')}>{nis(showsTotal.profit)}</td>
              </tr>

              <StepRow
                sign="−"
                label="הוצאות ששולמו מהקופה (חלק שווה)"
                values={members.map(() => fundShare)}
                total={fundTotal}
                accent="text-neg"
                negate
                cell={cell}
              />

              <tr className="bg-soft border-t border-line">
                <td className="px-3 py-2 text-right font-medium text-ink-2">
                  = חלק ברווח (לפני החזרי הוצאות)
                </td>
                {members.map((m: any) => (
                  <td key={m.key} className={clsx(cell, 'font-medium text-accent')}>
                    {nis(beforeRefund[m.key])}
                  </td>
                ))}
                <td className={clsx(cell, 'font-medium text-accent')}>
                  {nis(division.beforeRefundTotal)}
                </td>
              </tr>

              <StepRow
                sign="+"
                label="החזר למי ששילם מכיסו"
                values={members.map((m: any) => refundsByMember[m.key])}
                total={division.refundsTotal}
                accent="text-pos"
                cell={cell}
              />

              <tr className="bg-warn-soft border-t-2 border-warn/25">
                <td className="px-3 py-3 text-right font-bold">= סה״כ לתשלום</td>
                {members.map((m: any) => (
                  <td key={m.key} className={clsx(cell, 'font-bold text-warn text-base')}>
                    {nis(payout[m.key])}
                  </td>
                ))}
                <td className={clsx(cell, 'font-bold text-warn')}>{nis(division.payoutTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showWorking && !nothing && (
        <div className="grid md:grid-cols-2 gap-4 mt-5 pt-4 border-t border-line">
          <ExpenseList
            title="הוצאות להחזר"
            empty="אף אחד לא שילם מכיסו בטווח הזה"
            accent="text-pos"
            rows={refunds}
            note={(row: any) => row.paid_by}
          />
          <ExpenseList
            title="הוצאות ששולמו מהקופה"
            empty="הקופה לא שילמה על כלום בטווח הזה"
            accent="text-neg"
            rows={fundExpenses}
            note={() => `${nis(fundShare)} לכל אחד`}
          />
        </div>
      )}
    </Card>
  );
}

/** One "+ / −" line of the calculation, the same value under every member or one each. */
function StepRow({ sign, label, values, total, accent, negate, cell }: {
  sign: string;
  label: string;
  values: number[];
  total: number;
  accent: string;
  negate?: boolean;
  cell: string;
}) {
  return (
    <tr className="border-t border-line">
      <td className="px-3 py-2 text-right text-ink-2">
        <span className={clsx('font-bold ml-1', accent)}>{sign}</span> {label}
      </td>
      {values.map((value, i) => (
        <td key={i} className={clsx(cell, value ? accent : 'text-ghost')}>
          {value ? nis(negate ? -value : value) : '—'}
        </td>
      ))}
      <td className={clsx(cell, total ? accent : 'text-ghost')}>
        {total ? nis(negate ? -total : total) : '—'}
      </td>
    </tr>
  );
}

function ExpenseList({ title, rows, empty, accent, note }: {
  title: string;
  rows: any[];
  empty: string;
  accent: string;
  note: (row: any) => string;
}) {
  return (
    <div>
      <h3 className="text-sm font-bold mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-faint">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 text-sm border-b border-line pb-1.5 last:border-0">
              <div className="min-w-0">
                <div className="truncate">{row.description}</div>
                <div className="text-xs text-faint">{row.date} · {note(row)}</div>
              </div>
              <span className={clsx('shrink-0 font-medium', accent)}>{nis(row.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
