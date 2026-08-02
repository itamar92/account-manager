import React from 'react';
import { post, put, nis } from '../../api';
import { Card, Combobox, EditableCell, Empty, Table, YearSelect } from '../../ui';
import { eventLabel, type TabProps } from './shared';

/** The cost lines of a show, in table order. `paid` marks the ones settled separately. */
const COLUMNS: Array<{ key: string; label: string; paid?: boolean }> = [
  { key: 'campaign', label: 'קמפיין' },
  { key: 'akom', label: 'אקו"ם', paid: true },
  { key: 'hall_fee', label: 'שכירות אולם', paid: true },
  { key: 'sound_company', label: 'חברת סאונד', paid: true },
  { key: 'bracelets', label: 'צמידים', paid: true },
  { key: 'lightman', label: 'תאורן', paid: true },
  { key: 'soundman', label: 'סאונדמן', paid: true },
  { key: 'singer', label: 'זמר/ת', paid: true },
  { key: 'refreshments', label: 'כיבוד' },
  { key: 'design', label: 'עיצוב' },
  { key: 'other', label: 'אחר' },
  { key: 'expense_amount', label: 'הוצאה נוספת' },
];

const rowTotal = (row: any) => COLUMNS.reduce((sum, c) => sum + (Number(row[c.key]) || 0), 0);

interface Props extends TabProps {
  expenses: any[];
  events: any[];
  year: number | '';
  onYearChange: (year: number | '') => void;
}

/**
 * The cost side of each show. There is no add or delete here: every show in the income tab
 * owns exactly one row, created with it, and its name is the show's name plus the date — so
 * the two tables can never disagree about which gig a cost belongs to.
 *
 * The one exception is the assignment itself. Rows written before the tables were linked name
 * their show in prose, and the ones that could not be matched automatically are attached here
 * by hand — which is also how a row filed against the wrong show gets moved.
 */
export function EventExpensesTab({ expenses, events, year, onYearChange, isOwner, onError, reload }: Props) {
  const saveField = async (id: string, patch: Record<string, any>) => {
    try {
      await put(`/moonlight/event-expenses/${id}`, patch);
      reload();
    } catch (err: any) { onError(err.message); }
  };

  // A show whose row already holds costs cannot take another, so it is not offered. The empty
  // row every show starts with is not in the way — assigning over it replaces it.
  const taken = new Set(expenses.filter((x) => x.event_id && rowTotal(x) > 0).map((x) => x.event_id));
  const assign = async (row: any, eventId: string) => {
    onError('');
    try {
      await post(`/moonlight/event-expenses/${row.id}/assign`, { event_id: eventId });
      reload();
    } catch (err: any) { onError(err.message); }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="font-bold">הוצאות הופעות</h2>
          <YearSelect value={year} onChange={onYearChange} />
        </div>
        <p className="text-xs text-slate-500">שם ההופעה מגיע מטבלת ההכנסות · הסכומים כאן מזינים את «הוצאות» ו«רווח»</p>
      </div>

      {expenses.length === 0 ? <Empty text="אין נתונים בטווח הזה" /> : (
        <Table headers={['הופעה', ...COLUMNS.map((c) => c.label), 'מע"מ', 'סה"כ']}>
          {expenses.map((x) => (
            <tr key={x.id} className="hover:bg-slate-800/40 align-top">
              <td className="px-3 py-2.5 font-medium whitespace-nowrap min-w-[14rem]">
                {isOwner ? (
                  <>
                    {!x.event_id && (
                      <div className="text-amber-400 text-xs mb-1" title="השורה לא משויכת להופעה — בחרו הופעה מהרשימה">
                        ⚠ {x.event}
                      </div>
                    )}
                    <Combobox
                      value={x.event_id || ''}
                      placeholder="בחרו הופעה לשיוך…"
                      options={[
                        { value: '', label: 'ללא שיוך' },
                        ...events
                          .filter((e) => !taken.has(e.id) || e.id === x.event_id)
                          .map((e) => ({ value: e.id, label: eventLabel(e) })),
                      ]}
                      onChange={(v) => assign(x, v)}
                    />
                  </>
                ) : x.event_id ? x.event : <span className="text-amber-400">⚠ {x.event}</span>}
              </td>
              {COLUMNS.map((c) => (
                <td key={c.key} className="px-3 py-2.5 whitespace-nowrap">
                  <EditableCell type="number" value={x[c.key]} display={Number(x[c.key]) ? nis(x[c.key]) : '—'}
                    disabled={!isOwner} onSave={(v) => saveField(x.id, { [c.key]: v })} />
                  {c.paid && (
                    <label className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                      <EditableCell type="checkbox" value={x[`${c.key}_paid`]} disabled={!isOwner}
                        onSave={(v) => saveField(x.id, { [`${c.key}_paid`]: v })} />
                      שולם
                    </label>
                  )}
                </td>
              ))}
              <td className="px-3 py-2.5">
                <EditableCell type="number" value={x.vat_summary} display={Number(x.vat_summary) ? nis(x.vat_summary) : '—'}
                  disabled={!isOwner} onSave={(v) => saveField(x.id, { vat_summary: v })} />
              </td>
              <td className="px-3 py-2.5 font-medium text-rose-400 whitespace-nowrap">{nis(rowTotal(x))}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
