import React, { useState } from 'react';
import { del, post, put, nis } from '../../api';
import { Card, Combobox, DataTable, EditableCell, Empty, SearchInput, YearSelect, textMatch } from '../../ui';
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
 * The cost side of each show. There is no add here: every show in the income tab owns exactly
 * one row, created with it, and its name is the show's name plus the date — so the two tables
 * can never disagree about which gig a cost belongs to.
 *
 * Deleting follows from that. A row assigned to a show is emptied rather than removed, since
 * the show it belongs to still needs somewhere to write costs; a row assigned to nothing is a
 * leftover and goes for good.
 *
 * The assignment itself is the other thing done here. Rows written before the tables were
 * linked name their show in prose, and the ones that could not be matched automatically are
 * attached by hand — which is also how a row filed against the wrong show gets moved.
 */
export function EventExpensesTab({ expenses, events, year, onYearChange, isOwner, onError, reload }: Props) {
  const [search, setSearch] = useState('');

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

  const removeRow = async (row: any) => {
    const question = row.event_id
      ? `לרוקן את שורת ההוצאות של «${row.event}»? כל הסכומים בשורה יימחקו והיא תישאר ריקה.`
      : `למחוק את שורת ההוצאות «${row.event}»? היא לא משויכת לאף הופעה.`;
    if (!confirm(question)) return;
    onError('');
    try {
      await del(`/moonlight/event-expenses/${row.id}`);
      reload();
    } catch (err: any) { onError(err.message); }
  };

  const visible = expenses.filter((x) => textMatch(search, x.event));

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="font-bold">הוצאות הופעות</h2>
          <YearSelect value={year} onChange={onYearChange} />
        </div>
        <p className="text-xs text-slate-500">שם ההופעה מגיע מטבלת ההכנסות · הסכומים כאן מזינים את «הוצאות» ו«רווח»</p>
      </div>

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי הופעה…" className="w-full sm:max-w-xs" />
      </div>

      {visible.length === 0 ? <Empty text="אין נתונים בטווח הזה" /> : (
        <DataTable
          rows={visible}
          rowKey={(x) => x.id}
          rowClassName={() => 'hover:bg-slate-800/40 align-top'}
          columns={[
            {
              key: 'event', header: 'הופעה', mobile: 'title', sortValue: (x) => x.event,
              className: 'font-medium whitespace-nowrap min-w-[14rem]',
              render: (x) => isOwner ? (
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
              ) : x.event_id ? x.event : <span className="text-amber-400">⚠ {x.event}</span>,
            },
            ...COLUMNS.map((c) => ({
              key: c.key,
              header: c.label,
              sortValue: (x: any) => Number(x[c.key]) || 0,
              className: 'whitespace-nowrap',
              render: (x: any) => (
                <>
                  <EditableCell type="number" value={x[c.key]} display={Number(x[c.key]) ? nis(x[c.key]) : '—'}
                    disabled={!isOwner} onSave={(v) => saveField(x.id, { [c.key]: v })} />
                  {c.paid && (
                    <label className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                      <EditableCell type="checkbox" value={x[`${c.key}_paid`]} disabled={!isOwner}
                        onSave={(v) => saveField(x.id, { [`${c.key}_paid`]: v })} />
                      שולם
                    </label>
                  )}
                </>
              ),
            })),
            {
              key: 'vat', header: 'מע"מ', sortValue: (x) => Number(x.vat_summary) || 0,
              render: (x) => (
                <EditableCell type="number" value={x.vat_summary} display={Number(x.vat_summary) ? nis(x.vat_summary) : '—'}
                  disabled={!isOwner} onSave={(v) => saveField(x.id, { vat_summary: v })} />
              ),
            },
            {
              key: 'total', header: 'סה"כ', sortValue: (x) => rowTotal(x),
              className: 'font-medium text-rose-400 whitespace-nowrap',
              render: (x) => <span className="font-medium text-rose-400">{nis(rowTotal(x))}</span>,
            },
            isOwner && {
              key: 'actions', mobile: 'actions' as const, className: 'text-left whitespace-nowrap',
              render: (x: any) => (
                <button onClick={() => removeRow(x)} className="text-sm text-rose-400 hover:underline">
                  {x.event_id ? 'ניקוי' : 'מחיקה'}
                </button>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}
