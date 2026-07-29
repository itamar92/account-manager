import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post, nis } from '../api';
import { Button, Card, Modal, StatusBadge, Table, Empty } from '../ui';

export function Invoices() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [pushing, setPushing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = () =>
    get(`/invoices${statusFilter ? `?status=${statusFilter}` : ''}`)
      .then((d) => setInvoices(d.invoices))
      .catch((e) => setError(e.message));
  useEffect(() => { load(); }, [statusFilter]);

  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId) {
      openDetail(openId);
      setSearchParams({}, { replace: true });
    }
  }, []);

  const openDetail = (id: string) =>
    get(`/invoices/${id}`).then((d) => setDetail(d.invoice)).catch((e) => setError(e.message));

  const setStatus = async (id: string, status: string) => {
    try {
      const d = await post(`/invoices/${id}/status`, { status });
      setDetail(d.invoice);
      load();
    } catch (err: any) { setError(err.message); }
  };

  const pushToMorning = async (id: string) => {
    if (!confirm('להנפיק את החשבונית כמסמך אמיתי ב-Morning?')) return;
    setPushing(true);
    setError('');
    try {
      const d = await post(`/invoices/${id}/push-to-morning`);
      setDetail(d.invoice);
      load();
    } catch (err: any) { setError(err.message); }
    finally { setPushing(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">חשבוניות</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
          <option value="">כל הסטטוסים</option>
          <option value="issued">פתוחות</option>
          <option value="paid">שולמו</option>
          <option value="cancelled">בוטלו</option>
        </select>
      </div>
      {error && <div className="text-sm text-rose-400">{error}</div>}

      <Card>
        {invoices.length === 0 ? <Empty text="אין חשבוניות" /> : (
          <Table headers={['מס׳', 'סוג', 'תאריך', 'לקוח', 'סכום', 'סטטוס', 'שורות', '']}>
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-800/40 cursor-pointer" onClick={() => openDetail(inv.id)}>
                <td className="px-3 py-2.5 font-mono text-slate-300">#{inv.number}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={`text-xs ${inv.is_revenue ? 'text-slate-400' : 'text-amber-400/80'}`}>
                    {inv.doc_type_label || '—'}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{inv.date}</td>
                <td className="px-3 py-2.5 font-medium">{inv.client_name}</td>
                <td className="px-3 py-2.5 font-medium">{nis(inv.total)}</td>
                <td className="px-3 py-2.5"><StatusBadge status={inv.status} /></td>
                <td className="px-3 py-2.5 text-slate-400">{inv.works_count || '—'}</td>
                <td className="px-3 py-2.5 text-left">
                  {inv.status === 'issued' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setStatus(inv.id, 'paid'); }}
                      className="text-xs text-emerald-400 hover:underline whitespace-nowrap"
                    >
                      סמן כשולם
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal title={detail ? `חשבונית #${detail.number}` : ''} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-lg">{detail.client_name}</div>
                <div className="text-sm text-slate-400">{detail.date}{detail.due_date ? ` · לתשלום עד ${detail.due_date}` : ''}</div>
              </div>
              <StatusBadge status={detail.status} />
            </div>

            {detail.works?.length > 0 && (
              <div className="border border-slate-800 rounded-xl divide-y divide-slate-800">
                {detail.works.map((w: any) => (
                  <div key={w.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <div>{w.description}</div>
                      <div className="text-xs text-slate-500">{w.date}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>{nis(w.total)}</span>
                      <StatusBadge status={w.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="text-sm space-y-1 text-slate-300">
              <div className="flex justify-between"><span>לפני מע"מ</span><span>{nis(detail.subtotal)}</span></div>
              <div className="flex justify-between"><span>מע"מ</span><span>{nis(detail.vat_amount)}</span></div>
              <div className="flex justify-between font-bold text-slate-100 text-base"><span>סה"כ</span><span>{nis(detail.total)}</span></div>
              {detail.paid_date && <div className="flex justify-between text-emerald-400"><span>שולם בתאריך</span><span>{detail.paid_date}</span></div>}
            </div>

            <div className="text-xs text-slate-500">
              {detail.external_id
                ? <>קיים ב-Morning · <span dir="ltr" className="font-mono">{detail.external_id}</span></>
                : 'קיים רק באפליקציה — טרם הונפק ב-Morning'}
            </div>

            <div className="flex flex-wrap gap-2">
              {detail.status === 'issued' && (
                <>
                  <Button onClick={() => setStatus(detail.id, 'paid')} className="flex-1">סמן כשולם</Button>
                  <Button variant="danger" onClick={() => setStatus(detail.id, 'cancelled')}>ביטול</Button>
                </>
              )}
              {detail.status === 'paid' && (
                <Button variant="ghost" onClick={() => setStatus(detail.id, 'issued')} className="flex-1">החזר לסטטוס פתוח</Button>
              )}
              {!detail.external_id && detail.status !== 'cancelled' && (
                <Button variant="ghost" disabled={pushing} onClick={() => pushToMorning(detail.id)} className="w-full">
                  {pushing ? 'שולח…' : 'הנפקה ב-Morning'}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
