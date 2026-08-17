import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post, nis } from '../api';
import {
  Button, Modal, StatusBadge, DataTable, FilterBar, PageHeader, PeriodSelect, SearchInput,
  filterClass, textMatch, usePeriodFilter,
} from '../ui';
import { MorningIssueModal } from './MorningIssueModal';

export function Invoices() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  // Opens on the year you are working in; older years are a deliberate step back.
  const period = usePeriodFilter();
  const [detail, setDetail] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = () => {
    const qs = period.params();
    if (statusFilter) qs.set('status', statusFilter);
    return get(`/invoices?${qs}`)
      .then((d) => setInvoices(d.invoices))
      .catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [statusFilter, period.year, period.month]);

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

  /** Called once the issue dialog has produced a real Morning document. */
  const onIssued = (invoice: any, result: any) => {
    setIssuing(false);
    setDetail(invoice);
    setError('');
    setNotice(`המסמך הונפק ב-Morning · מספר ${result.documentNumber || invoice.number}`);
    load();
  };

  const visible = invoices.filter((inv) => textMatch(search, inv.client_name, inv.number));
  // What the page is really about, said in the subtitle: the ones still owed.
  const open = invoices.filter((inv) => inv.status === 'issued');
  const openCount = open.length;
  const openTotal = open.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="חשבוניות"
        sub={<><span className="num">{openCount}</span> פתוחות · <span className="num">{nis(openTotal)}</span> ממתין להתקבל</>}
      />

      <FilterBar>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterClass}>
          <option value="">כל הסטטוסים</option>
          <option value="issued">פתוחות</option>
          <option value="paid">שולמו</option>
          <option value="cancelled">בוטלו</option>
        </select>
        <PeriodSelect year={period.year} month={period.month}
          onYearChange={period.setYear} onMonthChange={period.setMonth} />
        <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי לקוח או מספר…" className="flex-1 min-w-[10rem] sm:max-w-xs" />
      </FilterBar>

      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}
      {notice && <div className="text-sm text-pos bg-pos-soft rounded-xl px-4 py-2.5">{notice}</div>}

      <DataTable
        empty="אין חשבוניות"
        rows={visible}
        rowKey={(inv) => inv.id}
        onRowClick={(inv) => openDetail(inv.id)}
        rowClassName={() => 'hover:bg-soft'}
        columns={[
          {
            key: 'number', header: 'מס׳', sortValue: (inv) => Number(inv.number) || inv.number,
            className: 'font-mono text-ink-2', render: (inv) => `#${inv.number}`,
          },
          {
            key: 'type', header: 'סוג', sortValue: (inv) => inv.doc_type_label, className: 'whitespace-nowrap',
            render: (inv) => (
              <span className={`text-xs ${inv.is_revenue ? 'text-muted' : 'text-warn'}`}>
                {inv.doc_type_label || '—'}
              </span>
            ),
          },
          { key: 'date', header: 'תאריך', sortValue: (inv) => inv.date, className: 'whitespace-nowrap', render: (inv) => inv.date },
          { key: 'client', header: 'לקוח', mobile: 'title', sortValue: (inv) => inv.client_name, className: 'font-medium', render: (inv) => inv.client_name },
          { key: 'total', header: 'סכום', sortValue: (inv) => inv.total, className: 'font-medium', render: (inv) => nis(inv.total) },
          { key: 'status', header: 'סטטוס', sortValue: (inv) => inv.status, render: (inv) => <StatusBadge status={inv.status} /> },
          { key: 'works', header: 'שורות', sortValue: (inv) => inv.works_count || 0, className: 'text-muted', render: (inv) => inv.works_count || '—' },
          {
            key: 'actions', mobile: 'actions', className: 'text-left',
            render: (inv) => inv.status === 'issued' && (
              <button
                onClick={(e) => { e.stopPropagation(); setStatus(inv.id, 'paid'); }}
                className="text-xs text-pos hover:underline whitespace-nowrap"
              >
                סמן כשולם
              </button>
            ),
          },
        ]}
      />

      {/* Hidden while the issue dialog is up — it is a step out of this invoice, not a layer on it. */}
      <Modal title={detail ? `חשבונית #${detail.number}` : ''} open={!!detail && !issuing} onClose={() => setDetail(null)}>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-lg">{detail.client_name}</div>
                <div className="text-sm text-muted">{detail.date}{detail.due_date ? ` · לתשלום עד ${detail.due_date}` : ''}</div>
              </div>
              <StatusBadge status={detail.status} />
            </div>

            {detail.works?.length > 0 && (
              <div className="border border-line rounded-xl divide-y divide-line">
                {detail.works.map((w: any) => (
                  <div key={w.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <div>{w.description}</div>
                      <div className="text-xs text-faint">{w.date}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>{nis(w.total)}</span>
                      <StatusBadge status={w.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="text-sm space-y-1 text-ink-2">
              <div className="flex justify-between"><span>לפני מע"מ</span><span>{nis(detail.subtotal)}</span></div>
              <div className="flex justify-between"><span>מע"מ</span><span>{nis(detail.vat_amount)}</span></div>
              <div className="flex justify-between font-bold text-ink text-base"><span>סה"כ</span><span>{nis(detail.total)}</span></div>
              {detail.paid_date && <div className="flex justify-between text-pos"><span>שולם בתאריך</span><span>{detail.paid_date}</span></div>}
            </div>

            <div className="text-xs text-faint">
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
                <Button variant="ghost" onClick={() => { setNotice(''); setIssuing(true); }} className="w-full">
                  הנפקה ב-Morning
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <MorningIssueModal
        invoiceId={detail?.id ?? null}
        open={issuing && !!detail}
        onClose={() => setIssuing(false)}
        onIssued={onIssued}
      />
    </div>
  );
}
