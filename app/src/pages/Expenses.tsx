import React, { useEffect, useState } from 'react';
import { get, post, nis } from '../api';
import {
  Button, Card, DataTable, Empty, SearchInput, StatCard, StatusBadge, YearSelect, textMatch,
} from '../ui';

/** The category filter's value for expenses Morning has not classified — matches the server. */
const UNCATEGORIZED = '__none__';

/**
 * The expenses Morning holds: what the business spent, filed under the categories it was
 * classified with, and how much of it is input VAT (מע"מ תשומות) waiting to be reclaimed.
 *
 * Read-only by design — an expense is entered and classified in Morning, and shown here
 * beside the income it has to be set against.
 */
export function Expenses() {
  const [data, setData] = useState<any>(null);
  // Opens on the current year, as the invoice list does — older years are a step back.
  const [year, setYear] = useState<number | ''>(new Date().getFullYear());
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    const qs = new URLSearchParams();
    if (year !== '') qs.set('year', String(year));
    if (status) qs.set('status', status);
    if (category) qs.set('category', category);
    return get(`/expenses?${qs}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [year, status, category]);

  const sync = async () => {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const { result } = await post('/integrations/morning/expenses-sync');
      setNotice(
        `${result.fetched} הוצאות (${result.from} – ${result.to}) · ${result.created} חדשות · ${result.updated} עודכנו` +
        (result.skipped ? ` · ${result.skipped} דולגו` : '')
      );
      load();
    } catch (err: any) { setError(err.message); }
    finally { setSyncing(false); }
  };

  if (!data) return <Empty text={error || 'טוען…'} />;

  const { summary, status: integration } = data;
  const visible = data.expenses.filter((e: any) =>
    textMatch(search, e.supplier_name, e.description, e.category, e.number)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">הוצאות</h1>
        <div className="flex flex-wrap gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
            <option value="">כל הסטטוסים</option>
            <option value="open">טרם דווחו</option>
            <option value="reported">דווחו</option>
            <option value="unknown">ללא סטטוס</option>
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
            <option value="">כל הסיווגים</option>
            {data.categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
            <option value={UNCATEGORIZED}>ללא סיווג</option>
          </select>
          <YearSelect value={year} onChange={setYear} />
          <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי ספק, פירוט או סיווג…"
            className="flex-1 min-w-[10rem] sm:max-w-xs" />
          <Button variant="ghost" onClick={sync} disabled={!integration.configured || syncing}>
            {syncing ? 'מסנכרן…' : 'סנכרון מ-Morning'}
          </Button>
        </div>
      </div>

      {error && <div className="text-sm text-rose-400">{error}</div>}
      {notice && <div className="text-sm text-emerald-400">{notice}</div>}
      {!integration.configured && (
        <div className="text-sm text-slate-400">
          Morning לא מוגדר — חסרים <code dir="ltr" className="text-indigo-300">GREEN_INVOICE_ID</code> /{' '}
          <code dir="ltr" className="text-indigo-300">GREEN_INVOICE_SECRET</code>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label='סה"כ הוצאות (כולל מע"מ)' value={nis(summary.total)} sub={`${summary.count} מסמכים`} accent="text-rose-400" />
        <StatCard label='לפני מע"מ' value={nis(summary.subtotal)} />
        <StatCard label='מע"מ תשומות' value={nis(summary.vat)} sub="לקיזוז בדיווח" accent="text-emerald-400" />
        <StatCard
          label="סונכרן לאחרונה"
          value={integration.last_sync ? new Date(integration.last_sync).toLocaleDateString('he-IL') : '—'}
          sub={`${integration.synced} הוצאות מ-Morning`}
        />
      </div>

      {summary.byCategory.length > 1 && (
        <Card>
          <h2 className="font-bold mb-3">לפי סיווג</h2>
          <div className="space-y-2">
            {summary.byCategory.map((row: any) => (
              <button
                key={row.category}
                onClick={() => setCategory(row.category === 'ללא סיווג' ? UNCATEGORIZED : row.category)}
                className="w-full text-right hover:bg-slate-800/40 rounded-lg px-2 py-1.5 transition-colors"
              >
                <div className="flex items-center justify-between text-sm gap-3">
                  <span className="truncate">{row.category}</span>
                  <span className="text-slate-400 shrink-0">
                    {nis(row.total)} <span className="text-xs text-slate-600">· {row.count}</span>
                  </span>
                </div>
                {/* Each category against the largest one, so the year's weight is visible at a glance. */}
                <div className="mt-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-rose-500/60"
                    style={{ width: `${Math.max(2, (row.total / (summary.byCategory[0].total || 1)) * 100)}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card>
        {visible.length === 0 ? (
          <Empty text={integration.synced ? 'אין הוצאות בטווח הזה' : 'עדיין לא סונכרנו הוצאות מ-Morning'} />
        ) : (
          <DataTable
            rows={visible}
            rowKey={(e: any) => e.id}
            rowClassName={() => 'hover:bg-slate-800/40'}
            columns={[
              { key: 'date', header: 'תאריך', sortValue: (e: any) => e.date, className: 'whitespace-nowrap', render: (e: any) => e.date },
              {
                key: 'supplier', header: 'ספק', mobile: 'title', sortValue: (e: any) => e.supplier_name,
                className: 'font-medium', render: (e: any) => e.supplier_name,
              },
              {
                key: 'description', header: 'פירוט', sortValue: (e: any) => e.description,
                className: 'text-slate-400 max-w-[16rem] truncate', render: (e: any) => e.description || '—',
              },
              {
                key: 'category', header: 'סיווג', sortValue: (e: any) => e.category,
                render: (e: any) => e.category
                  ? <span className="text-xs text-slate-300">{e.category}</span>
                  : <span className="text-xs text-slate-600">ללא סיווג</span>,
              },
              {
                key: 'doc', header: 'מסמך', sortValue: (e: any) => e.number, className: 'whitespace-nowrap text-xs text-slate-500',
                render: (e: any) => [e.doc_type_label, e.number ? `#${e.number}` : ''].filter(Boolean).join(' ') || '—',
              },
              {
                key: 'amount', header: 'לפני מע"מ', sortValue: (e: any) => e.amount, className: 'whitespace-nowrap',
                render: (e: any) => (
                  <>
                    {nis(e.amount)}
                    {e.currency && e.currency !== 'ILS' && (
                      <span className="text-xs text-slate-500" dir="ltr"> ({e.currency})</span>
                    )}
                  </>
                ),
              },
              { key: 'vat', header: 'מע"מ', sortValue: (e: any) => e.vat_amount, className: 'text-slate-400', render: (e: any) => nis(e.vat_amount) },
              { key: 'total', header: 'סה"כ', sortValue: (e: any) => e.total, className: 'font-medium text-rose-400', render: (e: any) => nis(e.total) },
              {
                key: 'status', header: 'סטטוס', sortValue: (e: any) => e.status,
                // Morning does not always say; an em dash is the honest answer to that.
                render: (e: any) => e.status === 'unknown'
                  ? <span className="text-slate-600">—</span>
                  : <StatusBadge status={e.status} />,
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
