import React, { useState } from 'react';
import { del, post, put, nis } from '../../api';
import { Button, Card, Combobox, EditableCell, Empty, Input, Modal, Table, YearSelect } from '../../ui';
import { PAYERS, eventLabel, type TabProps } from './shared';

interface Props extends TabProps {
  expenses: any[];
  events: any[];
  year: number | '';
  onYearChange: (year: number | '') => void;
}

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  description: '',
  event_id: '',
  paid_by: 'קופה',
  amount: '',
  paid: false,
};

/** Costs that belong to the band rather than to one show — though they can be assigned to one. */
export function GeneralExpensesTab({ expenses, events, year, onYearChange, isOwner, onError, reload }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  // 'כללי' first: an expense that belongs to no single show is the common case here.
  const showOptions = [
    { value: '', label: 'כללי' },
    ...events.map((e) => ({ value: e.id, label: eventLabel(e) })),
  ];
  const payerOptions = PAYERS.map((name) => ({ value: name, label: name }));

  const saveField = async (id: string, patch: Record<string, any>) => {
    try {
      await put(`/moonlight/general-expenses/${id}`, patch);
      reload();
    } catch (err: any) { onError(err.message); }
  };

  const addExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post('/moonlight/general-expenses', {
        ...form,
        amount: parseFloat(form.amount) || 0,
        paid: form.paid ? 1 : 0,
      });
      setOpen(false);
      setForm(emptyForm);
      reload();
    } catch (err: any) { onError(err.message); }
  };

  const removeExpense = async (row: any) => {
    if (!confirm(`למחוק את «${row.description}»?`)) return;
    try {
      await del(`/moonlight/general-expenses/${row.id}`);
      reload();
    } catch (err: any) { onError(err.message); }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="font-bold">הוצאות כלליות</h2>
          <YearSelect value={year} onChange={onYearChange} />
        </div>
        {isOwner && <Button onClick={() => setOpen(true)}>+ הוצאה</Button>}
      </div>

      {expenses.length === 0 ? <Empty text="אין נתונים בטווח הזה" /> : (
        <Table headers={['תאריך', 'פירוט', 'שיוך להופעה', 'מי שילם', 'סכום', 'שולם', isOwner ? '' : ' ']}>
          {expenses.map((g) => (
            <tr key={g.id} className="hover:bg-slate-800/40">
              <td className="px-3 py-2.5 whitespace-nowrap">
                <EditableCell type="date" value={g.date} disabled={!isOwner}
                  onSave={(v) => saveField(g.id, { date: v })} />
              </td>
              <td className="px-3 py-2.5 font-medium">
                <EditableCell value={g.description} disabled={!isOwner}
                  onSave={(v) => saveField(g.id, { description: v })} />
              </td>
              <td className="px-3 py-2.5 text-slate-400 min-w-[12rem]">
                <Combobox value={g.event_id || ''} options={showOptions} disabled={!isOwner}
                  onChange={(v) => saveField(g.id, { event_id: v })} />
              </td>
              <td className="px-3 py-2.5 min-w-[8rem]">
                <Combobox value={g.paid_by || ''} options={payerOptions} disabled={!isOwner}
                  onChange={(v) => saveField(g.id, { paid_by: v })} />
              </td>
              <td className="px-3 py-2.5 text-rose-400">
                <EditableCell type="number" value={g.amount} display={nis(g.amount)} disabled={!isOwner}
                  onSave={(v) => saveField(g.id, { amount: v })} />
              </td>
              <td className="px-3 py-2.5">
                <EditableCell type="checkbox" value={g.paid} disabled={!isOwner}
                  onSave={(v) => saveField(g.id, { paid: v })} />
              </td>
              <td className="px-3 py-2.5 text-left">
                {isOwner && (
                  <button onClick={() => removeExpense(g)} className="text-sm text-rose-400 hover:underline">מחיקה</button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal title="הוצאה כללית חדשה" open={open} onClose={() => setOpen(false)}>
        <form onSubmit={addExpense} className="space-y-3">
          <Input label="תאריך *" type="date" value={form.date} required
            onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="פירוט *" value={form.description} required
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div>
            <span className="block text-sm text-slate-400 mb-1">שיוך להופעה</span>
            <Combobox value={form.event_id} options={showOptions}
              onChange={(v) => setForm({ ...form, event_id: v })} />
          </div>
          <div>
            <span className="block text-sm text-slate-400 mb-1">מי שילם</span>
            <Combobox value={form.paid_by} options={payerOptions}
              onChange={(v) => setForm({ ...form, paid_by: v })} />
          </div>
          <Input label="סכום *" type="number" step="0.01" value={form.amount} required
            onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.paid} className="accent-indigo-500"
              onChange={(e) => setForm({ ...form, paid: e.target.checked })} />
            שולם
          </label>
          <Button type="submit" className="w-full">הוספה</Button>
        </form>
      </Modal>
    </Card>
  );
}
