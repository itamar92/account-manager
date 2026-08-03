import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, put, del, nis } from '../api';
import { Button, Card, Input, Modal, DataTable, Empty, SearchInput, textMatch } from '../ui';

const emptyForm = { name: '', email: '', phone: '', tax_id: '', payment_terms_days: 30, notes: '' };

export function Clients() {
  const [clients, setClients] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = () => get('/clients').then((d) => setClients(d.clients)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (c: any) => { setEditing(c); setForm({ ...emptyForm, ...c }); setOpen(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) await put(`/clients/${editing.id}`, form);
      else await post('/clients', form);
      setOpen(false);
      load();
    } catch (err: any) { setError(err.message); }
  };

  /**
   * Deletes a client. Uninvoiced works go with it, but only after saying how many — the
   * server refuses to touch them otherwise. A client with invoices, or one an enabled
   * calendar rule feeds, is refused there and the reason is shown as-is.
   */
  const remove = async (client: any) => {
    const works = client.unpaid_count
      ? `\n\nיימחקו איתו גם ${client.unpaid_count} עבודות שטרם חויבו (${nis(client.unpaid_total)}).`
      : '';
    if (!confirm(`למחוק את הלקוח «${client.name}»?${works}`)) return;
    setError('');
    try {
      await del(`/clients/${client.id}?delete_works=1`);
      load();
    } catch (err: any) { setError(err.message); }
  };

  const visible = clients.filter((c) => textMatch(search, c.name, c.email));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">לקוחות</h1>
        <Button onClick={openNew}>+ לקוח חדש</Button>
      </div>
      {error && <div className="text-sm text-rose-400">{error}</div>}

      <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי שם או אימייל…" className="w-full sm:max-w-xs" />

      <Card>
        {visible.length === 0 ? <Empty text="אין לקוחות עדיין" /> : (
          <DataTable
            rows={visible}
            rowKey={(c) => c.id}
            rowClassName={() => 'hover:bg-slate-800/40'}
            columns={[
              { key: 'name', header: 'שם', mobile: 'title', sortValue: (c) => c.name, className: 'font-medium', render: (c) => c.name },
              {
                key: 'email', header: 'אימייל', sortValue: (c) => c.email, className: 'text-slate-400',
                render: (c) => <span dir="ltr">{c.email || '—'}</span>,
              },
              {
                key: 'unpaid', header: 'עבודות שטרם חויבו', sortValue: (c) => c.unpaid_total || 0,
                render: (c) => c.unpaid_count > 0 ? (
                  <Link to={`/works?client=${c.id}`} className="text-sky-400 hover:underline">
                    {nis(c.unpaid_total)} ({c.unpaid_count})
                  </Link>
                ) : '—',
              },
              {
                key: 'open', header: 'חשבוניות פתוחות', sortValue: (c) => c.open_invoices_total || 0,
                render: (c) => c.open_invoices_total > 0 ? <span className="text-amber-400">{nis(c.open_invoices_total)}</span> : '—',
              },
              {
                key: 'actions', mobile: 'actions', className: 'text-left whitespace-nowrap',
                render: (c) => (
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => openEdit(c)} className="text-sm text-indigo-400 hover:underline">עריכה</button>
                    <button onClick={() => remove(c)} className="text-sm text-rose-400 hover:underline">מחיקה</button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal title={editing ? 'עריכת לקוח' : 'לקוח חדש'} open={open} onClose={() => setOpen(false)}>
        <form onSubmit={save} className="space-y-3">
          <Input label="שם *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="אימייל" type="email" dir="ltr" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="טלפון" dir="ltr" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="ח.פ / ע.מ" dir="ltr" value={form.tax_id || ''} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
          <Input label="תנאי תשלום (ימים)" type="number" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: parseInt(e.target.value) || 30 })} />
          <Button type="submit" className="w-full">שמירה</Button>
        </form>
      </Modal>
    </div>
  );
}
