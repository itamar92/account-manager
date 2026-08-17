import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, post, put, del, nis } from '../api';
import { Button, Input, Modal, DataTable, PageHeader, SearchInput, textMatch } from '../ui';

const emptyForm = { name: '', email: '', phone: '', tax_id: '', payment_terms_days: 30, notes: '' };

export function Clients() {
  const [clients, setClients] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  const load = () => get('/clients').then((d) => setClients(d.clients)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // `?new=1` is how the header's quick action opens the dialog; the parameter is dropped
  // again so a reload does not reopen a dialog that was already closed.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    openNew();
    searchParams.delete('new');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams]);

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
  const withBalance = clients.filter((c) => Number(c.unpaid_total) > 0).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="לקוחות"
        sub={<><span className="num">{clients.length}</span> לקוחות · <span className="num">{withBalance}</span> עם יתרה פתוחה</>}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי שם או אימייל…" className="w-52" />
            <Button onClick={openNew}>+ לקוח חדש</Button>
          </>
        }
      />
      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}

      <DataTable
        empty="אין לקוחות עדיין"
        rows={visible}
        rowKey={(c) => c.id}
        rowClassName={() => 'hover:bg-soft'}
        columns={[
          { key: 'name', header: 'שם', mobile: 'title', sortValue: (c) => c.name, className: 'font-medium', render: (c) => c.name },
          {
            key: 'email', header: 'אימייל', sortValue: (c) => c.email, className: 'text-muted',
            render: (c) => <span dir="ltr">{c.email || '—'}</span>,
          },
          {
            key: 'unpaid', header: 'עבודות שטרם חויבו', sortValue: (c) => c.unpaid_total || 0,
            render: (c) => c.unpaid_count > 0 ? (
              <Link to={`/works?client=${c.id}`} className="text-accent hover:underline">
                {nis(c.unpaid_total)} ({c.unpaid_count})
              </Link>
            ) : '—',
          },
          {
            key: 'open', header: 'חשבוניות פתוחות', sortValue: (c) => c.open_invoices_total || 0,
            render: (c) => c.open_invoices_total > 0 ? <span className="text-warn">{nis(c.open_invoices_total)}</span> : '—',
          },
          {
            key: 'actions', mobile: 'actions', className: 'text-left whitespace-nowrap',
            render: (c) => (
              <div className="flex gap-3 justify-end">
                <button onClick={() => openEdit(c)} className="text-sm text-accent hover:underline">עריכה</button>
                <button onClick={() => remove(c)} className="text-sm text-neg hover:underline">מחיקה</button>
              </div>
            ),
          },
        ]}
      />

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
