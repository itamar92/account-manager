import React, { useState } from 'react';
import { del, post, put, nis } from '../../api';
import { Button, Combobox, DataTable, EditableCell, Input, Modal, PageHeader, PeriodSelect, SearchInput, textMatch } from '../../ui';
import { PAYERS, eventLabel, type PeriodTabProps } from './shared';

interface Props extends PeriodTabProps {
  expenses: any[];
  events: any[];
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
export function GeneralExpensesTab({ expenses, events, period, isOwner, onError, reload }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');

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

  const visible = expenses.filter((g) => textMatch(search, g.description, g.paid_by));

  return (
    <div className="space-y-4">
      <PageHeader
        title="הוצאות כלליות"
        sub="הוצאות שאינן משויכות להופעה — מתחלקות שווה בשווה בין החברים"
        actions={
          <>
            <PeriodSelect year={period.year} month={period.month}
              onYearChange={period.setYear} onMonthChange={period.setMonth} />
            <SearchInput value={search} onChange={setSearch} placeholder="חיפוש בפירוט או במשלם…" className="w-44" />
            {isOwner && <Button onClick={() => setOpen(true)}>+ הוצאה</Button>}
          </>
        }
      />

      <DataTable
        empty="אין נתונים בטווח הזה"
        rows={visible}
        rowKey={(g) => g.id}
        rowClassName={() => 'hover:bg-soft'}
        columns={[
          {
            key: 'date', header: 'תאריך', sortValue: (g) => g.date, className: 'whitespace-nowrap',
            render: (g) => (
              <EditableCell type="date" value={g.date} disabled={!isOwner}
                onSave={(v) => saveField(g.id, { date: v })} />
            ),
          },
          {
            key: 'description', header: 'פירוט', mobile: 'title', sortValue: (g) => g.description, className: 'font-medium',
            render: (g) => (
              <EditableCell value={g.description} disabled={!isOwner}
                onSave={(v) => saveField(g.id, { description: v })} />
            ),
          },
          {
            key: 'event', header: 'שיוך להופעה', className: 'text-muted min-w-[12rem]',
            render: (g) => (
              <Combobox value={g.event_id || ''} options={showOptions} disabled={!isOwner}
                onChange={(v) => saveField(g.id, { event_id: v })} />
            ),
          },
          {
            key: 'payer', header: 'מי שילם', sortValue: (g) => g.paid_by, className: 'min-w-[8rem]',
            render: (g) => (
              <Combobox value={g.paid_by || ''} options={payerOptions} disabled={!isOwner}
                onChange={(v) => saveField(g.id, { paid_by: v })} />
            ),
          },
          {
            key: 'amount', header: 'סכום', sortValue: (g) => Number(g.amount) || 0, className: 'text-neg',
            render: (g) => (
              <span className="text-neg">
                <EditableCell type="number" value={g.amount} display={nis(g.amount)} disabled={!isOwner}
                  onSave={(v) => saveField(g.id, { amount: v })} />
              </span>
            ),
          },
          {
            key: 'paid', header: 'שולם', sortValue: (g) => (g.paid ? 1 : 0),
            render: (g) => (
              <EditableCell type="checkbox" value={g.paid} disabled={!isOwner}
                onSave={(v) => saveField(g.id, { paid: v })} />
            ),
          },
          isOwner && {
            key: 'actions', mobile: 'actions' as const, className: 'text-left',
            render: (g: any) => (
              <button onClick={() => removeExpense(g)} className="text-sm text-neg hover:underline">מחיקה</button>
            ),
          },
        ]}
      />

      <Modal title="הוצאה כללית חדשה" open={open} onClose={() => setOpen(false)}>
        <form onSubmit={addExpense} className="space-y-3">
          <Input label="תאריך *" type="date" value={form.date} required
            onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="פירוט *" value={form.description} required
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div>
            <span className="block text-sm text-muted mb-1">שיוך להופעה</span>
            <Combobox value={form.event_id} options={showOptions}
              onChange={(v) => setForm({ ...form, event_id: v })} />
          </div>
          <div>
            <span className="block text-sm text-muted mb-1">מי שילם</span>
            <Combobox value={form.paid_by} options={payerOptions}
              onChange={(v) => setForm({ ...form, paid_by: v })} />
          </div>
          <Input label="סכום *" type="number" step="0.01" value={form.amount} required
            onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={form.paid} className="accent-accent"
              onChange={(e) => setForm({ ...form, paid: e.target.checked })} />
            שולם
          </label>
          <Button type="submit" className="w-full">הוספה</Button>
        </form>
      </Modal>
    </div>
  );
}
