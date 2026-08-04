import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post, put, del, nis } from '../api';
import { Button, Card, Input, Modal, StatusBadge, DataTable, Empty, PeriodSelect, SearchInput, textMatch, usePeriodFilter } from '../ui';

export function Works() {
  const [works, setWorks] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState('');
  // Lists open on the year you are working in; older years are a deliberate step back.
  const period = usePeriodFilter();
  const [searchParams] = useSearchParams();
  const [clientFilter, setClientFilter] = useState(searchParams.get('client') || '');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ client_id: '', date: new Date().toISOString().slice(0, 10), description: '', amount: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [excludeCalendar, setExcludeCalendar] = useState(true);
  const navigate = useNavigate();

  const load = () => {
    const qs = period.params();
    if (statusFilter) qs.set('status', statusFilter);
    if (clientFilter) qs.set('client_id', clientFilter);
    get(`/works?${qs}`).then((d) => setWorks(d.works)).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); setSelected(new Set()); }, [statusFilter, clientFilter, period.year, period.month]);
  useEffect(() => { get('/clients').then((d) => setClients(d.clients)); }, []);

  const toggle = (w: any) => {
    if (w.status !== 'unpaid') return;
    const next = new Set(selected);
    next.has(w.id) ? next.delete(w.id) : next.add(w.id);
    setSelected(next);
  };

  // The search narrows in place, on what the server filters already returned.
  const visible = works.filter((w) => textMatch(search, w.description, w.client_name));

  const toggleAll = () => {
    const selectable = visible.filter((w) => w.status === 'unpaid');
    setSelected(selected.size >= selectable.length && selectable.length > 0
      ? new Set()
      : new Set(selectable.map((w) => w.id)));
  };

  const selectedWorks = works.filter((w) => selected.has(w.id));
  const selectedClientIds = useMemo(() => new Set(selectedWorks.map((w) => w.client_id)), [selectedWorks]);
  const selectedTotal = selectedWorks.reduce((s, w) => s + w.total, 0);
  const canInvoice = selected.size > 0 && selectedClientIds.size === 1;
  const selectedFromCalendar = selectedWorks.filter((w) => w.calendar_event_id).length;

  const createInvoice = async () => {
    try {
      const d = await post('/invoices', {
        client_id: selectedWorks[0].client_id,
        work_ids: [...selected],
      });
      navigate(`/invoices?open=${d.invoice.id}`);
    } catch (err: any) { setError(err.message); }
  };

  /**
   * Deletes everything selected in one request. Works drawn from the calendar are also
   * pinned out of it when asked — otherwise the next sync would simply draw them again.
   */
  const deleteSelected = async () => {
    const suffix = excludeCalendar && selectedFromCalendar
      ? ` ולסמן ${selectedFromCalendar} אירועים שלא יימשכו שוב מהיומן?`
      : '?';
    if (!confirm(`למחוק ${selected.size} עבודות${suffix}`)) return;
    setError('');
    setNotice('');
    try {
      const d = await post('/works/bulk-delete', {
        ids: [...selected],
        exclude_from_calendar: excludeCalendar,
      });
      setSelected(new Set());
      setNotice(`נמחקו ${d.deleted} עבודות${d.excluded ? ` · ${d.excluded} אירועים לא יימשכו שוב` : ''}`);
      if (d.locked?.length) setError(`${d.locked.length} עבודות נשארו — הן כבר מקושרות לחשבונית`);
      load();
    } catch (err: any) { setError(err.message); }
  };

  /** Re-files the selected works under another client, for what a rule filed wrong. */
  const assignClient = async (clientId: string) => {
    setAssignTo('');
    const client = clients.find((c) => c.id === clientId);
    if (!client || !confirm(`להעביר ${selected.size} עבודות ללקוח «${client.name}»?`)) return;
    setError('');
    setNotice('');
    try {
      const d = await post('/works/bulk-client', { ids: [...selected], client_id: clientId });
      setNotice(`${d.updated} עבודות הועברו ל«${client.name}»`);
      if (d.locked?.length) setError(`${d.locked.length} עבודות לא הועברו — הן כבר מקושרות לחשבונית`);
      load();
    } catch (err: any) { setError(err.message); }
  };

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    setForm({ client_id: '', date: new Date().toISOString().slice(0, 10), description: '', amount: '' });
  };

  const startEdit = (w: any) => {
    setForm({ client_id: w.client_id, date: w.date, description: w.description, amount: String(w.amount) });
    setEditing(w.id);
    setOpen(true);
  };

  const saveWork = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await put(`/works/${editing}`, { date: form.date, description: form.description, amount: parseFloat(form.amount) });
      } else {
        await post('/works', { ...form, amount: parseFloat(form.amount) });
      }
      closeModal();
      load();
    } catch (err: any) { setError(err.message); }
  };

  const removeWork = async (id: string) => {
    if (!confirm('למחוק את העבודה?')) return;
    try { await del(`/works/${id}`); load(); } catch (err: any) { setError(err.message); }
  };

  /**
   * Marks a work the calendar sync created as "not billable work". Plain deletion would
   * not stick — the next sync would draw the event again — so the decision is stored
   * against the calendar event itself.
   */
  const excludeFromCalendar = async (work: any) => {
    if (!confirm(`לסמן «${work.description}» כלא-עבודה? האירוע לא יימשך שוב מהיומן.`)) return;
    setError('');
    try {
      const d = await post('/calendar-overrides', {
        event_id: work.calendar_event_id,
        action: 'exclude',
        summary: work.description,
        event_date: work.date,
      });
      if (!d.removed) setError('האירוע לא יימשך שוב, אבל השורה נשמרה כי כבר יש בה סכום — מחק אותה ידנית אם צריך.');
      load();
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">עבודות</h1>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>+ עבודה חדשה</Button>
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
        <PeriodSelect year={period.year} month={period.month}
          onYearChange={period.setYear} onMonthChange={period.setMonth} />
        <SearchInput value={search} onChange={setSearch} placeholder="חיפוש בפירוט או בלקוח…" className="flex-1 min-w-[10rem] sm:max-w-xs" />
      </div>

      {error && <div className="text-sm text-rose-400">{error}</div>}
      {notice && <div className="text-sm text-emerald-400">{notice}</div>}

      {/* Sticky: the actions belong next to the rows you are ticking, however far down the
          table you have scrolled — not at the top of a page you have to scroll back to. */}
      {selected.size > 0 && (
        <Card className="sticky top-2 z-30 border-indigo-500/40 bg-slate-900/95 backdrop-blur shadow-xl shadow-black/40 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              נבחרו <b>{selected.size}</b> עבודות · סה"כ <b>{nis(selectedTotal)}</b>
              {!canInvoice && <span className="text-amber-400 mr-2">— חשבונית אפשרית רק ללקוח אחד</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={assignTo}
                onChange={(e) => { setAssignTo(e.target.value); if (e.target.value) assignClient(e.target.value); }}
                className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm"
              >
                <option value="">שיוך ללקוח אחר…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button variant="danger" onClick={deleteSelected}>מחיקת הנבחרות</Button>
              <Button onClick={createInvoice} disabled={!canInvoice}>צור חשבונית</Button>
            </div>
          </div>
          {selectedFromCalendar > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={excludeCalendar} onChange={(e) => setExcludeCalendar(e.target.checked)}
                className="w-3.5 h-3.5 accent-indigo-500" />
              <span>
                מחיקה תסמן גם את {selectedFromCalendar} האירועים מהיומן כ«לא עבודה»
                <span className="text-slate-600"> (אחרת הם יימשכו שוב בסנכרון הבא)</span>
              </span>
            </label>
          )}
        </Card>
      )}

      <Card>
        {visible.length === 0 ? <Empty text="אין עבודות" /> : (
          <DataTable
            rows={visible}
            rowKey={(w) => w.id}
            onRowClick={toggle}
            rowClassName={(w) => (w.status === 'unpaid' ? 'hover:bg-slate-800/40' : 'opacity-75')}
            columns={[
              {
                key: 'select',
                mobile: 'lead',
                header: (
                  <input
                    type="checkbox" className="accent-indigo-500" title="בחר הכל"
                    checked={selected.size > 0 && selected.size === visible.filter((w) => w.status === 'unpaid').length}
                    onChange={toggleAll}
                  />
                ),
                render: (w) => w.status === 'unpaid' && (
                  <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w)} onClick={(e) => e.stopPropagation()} className="accent-indigo-500" />
                ),
              },
              {
                key: 'date', header: 'תאריך', sortValue: (w) => w.date, className: 'whitespace-nowrap',
                render: (w) => w.date,
              },
              {
                key: 'client', header: 'לקוח', mobile: 'title', sortValue: (w) => w.client_name,
                className: 'font-medium', render: (w) => w.client_name,
              },
              {
                key: 'description', header: 'פירוט', sortValue: (w) => w.description, className: 'text-slate-300',
                render: (w) => (
                  <>
                    {w.description}
                    {!!w.description_locked && w.calendar_event_id && (
                      <span className="text-amber-400 text-xs mr-1" title="הפירוט נערך ידנית — סנכרון מהיומן לא ישנה אותו">✎</span>
                    )}
                  </>
                ),
              },
              { key: 'amount', header: 'סכום', sortValue: (w) => w.amount, render: (w) => nis(w.amount) },
              { key: 'total', header: 'כולל מע"מ', sortValue: (w) => w.total, className: 'font-medium', render: (w) => nis(w.total) },
              {
                key: 'status', header: 'סטטוס', sortValue: (w) => w.status,
                render: (w) => (
                  <>
                    <StatusBadge status={w.status} />
                    {w.invoice_number && <span className="text-xs text-slate-500 mr-1">#{w.invoice_number}</span>}
                  </>
                ),
              },
              {
                key: 'actions', mobile: 'actions', className: 'text-left whitespace-nowrap',
                render: (w) => w.status === 'unpaid' && (
                  <div className="flex gap-3 md:gap-2 justify-end">
                    <button onClick={(e) => { e.stopPropagation(); startEdit(w); }} className="text-xs text-indigo-400 hover:underline">עריכה</button>
                    {w.calendar_event_id && (
                      <button onClick={(e) => { e.stopPropagation(); excludeFromCalendar(w); }}
                        className="text-xs text-amber-400 hover:underline">לא עבודה</button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); removeWork(w.id); }} className="text-xs text-rose-400 hover:underline">מחיקה</button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal title={editing ? 'עריכת עבודה' : 'עבודה חדשה'} open={open} onClose={closeModal}>
        <form onSubmit={saveWork} className="space-y-3">
          <label className="block">
            <span className="block text-sm text-slate-400 mb-1">לקוח *</span>
            <select required disabled={!!editing} value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm disabled:opacity-60">
              <option value="">בחר לקוח…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <Input label="תאריך *" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Input label="פירוט *" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          <Input label='סכום לפני מע"מ *' type="number" step="0.01" dir="ltr" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <Button type="submit" className="w-full">{editing ? 'שמירה' : 'הוספה'}</Button>
        </form>
      </Modal>
    </div>
  );
}
