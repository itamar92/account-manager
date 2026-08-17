import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, post, put, del, nis } from '../api';
import { Button, Empty, Input, Modal, PageHeader, SearchInput, textMatch } from '../ui';

/** Two letters is what fits an avatar and still says which client it is. */
const initials = (name: string) =>
  String(name).trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '?';

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
  // "Open balance" is everything this client owes: work not yet billed plus invoices not yet
  // paid. Splitting the two across columns made you add them up yourself to answer the only
  // question anybody asks of a client list.
  const balance = (c: any) => (Number(c.unpaid_total) || 0) + (Number(c.open_invoices_total) || 0);
  const withBalance = clients.filter((c) => balance(c) > 0).length;
  const year = new Date().getFullYear();

  return (
    <div className="space-y-4">
      <PageHeader
        title="לקוחות"
        sub={<><span className="num">{clients.length}</span> פעילים · <span className="num">{withBalance}</span> עם יתרה פתוחה</>}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי שם או אימייל…" className="w-52" />
            <Button onClick={openNew}>+ לקוח חדש</Button>
          </>
        }
      />
      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}

      {visible.length === 0 ? (
        <Empty text="אין לקוחות עדיין" />
      ) : (
        <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <div key={c.id} className="bg-surface border border-line rounded-2xl p-4 md:p-5 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-soft text-accent flex items-center justify-center text-[15px] font-bold shrink-0">
                  {initials(c.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold truncate" title={c.name}>{c.name}</div>
                  <div className="num text-[12.5px] text-faint">
                    {c.last_work_date ? `עבודה אחרונה ${c.last_work_date}` : 'עדיין ללא עבודות'}
                  </div>
                </div>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted">הכנסות {year}</span>
                <span className="num font-semibold">{nis(c.revenue_ytd)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">יתרה פתוחה</span>
                {balance(c) > 0 ? (
                  <Link to={`/works?client=${c.id}`} className="num font-semibold text-warn hover:underline">
                    {nis(balance(c))}
                  </Link>
                ) : (
                  <span className="num text-muted">—</span>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-3 mt-auto border-t border-soft">
                <span className="text-[12.5px] text-faint truncate" dir="ltr">{c.email || '—'}</span>
                <div className="flex gap-3 shrink-0">
                  <button onClick={() => openEdit(c)} className="text-[13px] font-semibold text-accent hover:underline">עריכה</button>
                  <button onClick={() => remove(c)} className="text-[13px] font-semibold text-neg hover:underline">מחיקה</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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
