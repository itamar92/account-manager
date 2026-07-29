import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post, del, nis } from '../api';
import { Button, Card, Input, Modal, StatusBadge, Table, Empty } from '../ui';

export function Works() {
  const [works, setWorks] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState('');
  const [searchParams] = useSearchParams();
  const [clientFilter, setClientFilter] = useState(searchParams.get('client') || '');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ client_id: '', date: new Date().toISOString().slice(0, 10), description: '', amount: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    const qs = new URLSearchParams();
    if (statusFilter) qs.set('status', statusFilter);
    if (clientFilter) qs.set('client_id', clientFilter);
    get(`/works?${qs}`).then((d) => setWorks(d.works)).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); setSelected(new Set()); }, [statusFilter, clientFilter]);
  useEffect(() => { get('/clients').then((d) => setClients(d.clients)); }, []);

  const toggle = (w: any) => {
    if (w.status !== 'unpaid') return;
    const next = new Set(selected);
    next.has(w.id) ? next.delete(w.id) : next.add(w.id);
    setSelected(next);
  };

  const selectedWorks = works.filter((w) => selected.has(w.id));
  const selectedClientIds = useMemo(() => new Set(selectedWorks.map((w) => w.client_id)), [selectedWorks]);
  const selectedTotal = selectedWorks.reduce((s, w) => s + w.total, 0);
  const canInvoice = selected.size > 0 && selectedClientIds.size === 1;

  const createInvoice = async () => {
    try {
      const d = await post('/invoices', {
        client_id: selectedWorks[0].client_id,
        work_ids: [...selected],
      });
      navigate(`/invoices?open=${d.invoice.id}`);
    } catch (err: any) { setError(err.message); }
  };

  const addWork = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post('/works', { ...form, amount: parseFloat(form.amount) });
      setOpen(false);
      setForm({ ...form, description: '', amount: '' });
      load();
    } catch (err: any) { setError(err.message); }
  };

  const removeWork = async (id: string) => {
    if (!confirm('למחוק את העבודה?')) return;
    try { await del(`/works/${id}`); load(); } catch (err: any) { setError(err.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">עבודות</h1>
        <Button onClick={() => setOpen(true)}>+ עבודה חדשה</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
          <option value="">כל הלקוחות</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
          <option value="">כל הסטטוסים</option>
          <option value="unpaid">לא חויב</option>
          <option value="invoiced">בחשבונית</option>
          <option value="paid">שולם</option>
        </select>
      </div>

      {error && <div className="text-sm text-rose-400">{error}</div>}

      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-indigo-500/40">
          <div className="text-sm">
            נבחרו <b>{selected.size}</b> עבודות · סה"כ <b>{nis(selectedTotal)}</b>
            {!canInvoice && <span className="text-amber-400 mr-2">— חשבונית אפשרית רק ללקוח אחד</span>}
          </div>
          <Button onClick={createInvoice} disabled={!canInvoice}>צור חשבונית מהעבודות שנבחרו</Button>
        </Card>
      )}

      <Card>
        {works.length === 0 ? <Empty text="אין עבודות" /> : (
          <Table headers={['', 'תאריך', 'לקוח', 'פירוט', 'סכום', 'כולל מע"מ', 'סטטוס', '']}>
            {works.map((w) => (
              <tr key={w.id} className={w.status === 'unpaid' ? 'hover:bg-slate-800/40 cursor-pointer' : 'opacity-75'} onClick={() => toggle(w)}>
                <td className="px-3 py-2.5">
                  {w.status === 'unpaid' && (
                    <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w)} onClick={(e) => e.stopPropagation()} className="accent-indigo-500" />
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{w.date}</td>
                <td className="px-3 py-2.5 font-medium">{w.client_name}</td>
                <td className="px-3 py-2.5 text-slate-300">{w.description}</td>
                <td className="px-3 py-2.5">{nis(w.amount)}</td>
                <td className="px-3 py-2.5 font-medium">{nis(w.total)}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={w.status} />
                  {w.invoice_number && <span className="text-xs text-slate-500 mr-1">#{w.invoice_number}</span>}
                </td>
                <td className="px-3 py-2.5 text-left">
                  {w.status === 'unpaid' && (
                    <button onClick={(e) => { e.stopPropagation(); removeWork(w.id); }} className="text-xs text-rose-400 hover:underline">מחיקה</button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal title="עבודה חדשה" open={open} onClose={() => setOpen(false)}>
        <form onSubmit={addWork} className="space-y-3">
          <label className="block">
            <span className="block text-sm text-slate-400 mb-1">לקוח *</span>
            <select required value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
              <option value="">בחר לקוח…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <Input label="תאריך *" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Input label="פירוט *" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          <Input label='סכום לפני מע"מ *' type="number" step="0.01" dir="ltr" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Button type="submit" className="w-full">הוספה</Button>
        </form>
      </Modal>
    </div>
  );
}
