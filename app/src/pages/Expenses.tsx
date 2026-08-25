import React, { useEffect, useState } from 'react';
import { get, post, nis } from '../api';
import {
  Button, Card, DataTable, Empty, FilterBar, PageHeader, PeriodSelect, SearchInput, StatCard, StatusBadge,
  filterClass, textMatch, usePeriodFilter,
} from '../ui';

/** The category filter's value for expenses Morning has not classified — matches the server. */
const UNCATEGORIZED = '__none__';

/**
 * The expenses Morning holds: what the business spent, filed under the categories it was
 * classified with, and how much of it may actually be reclaimed as input VAT (מע"מ תשומות).
 *
 * Read-only by design — an expense is entered and classified in Morning, and shown here
 * beside the income it has to be set against.
 */
export function Expenses() {
  const [data, setData] = useState<any>(null);
  // Opens on the current year, as the invoice list does — older years are a step back.
  const period = usePeriodFilter();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  // The category breakdown is a question you ask now and then, not something to read past on
  // the way to the table — so it stays folded until it is asked for.
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    const qs = period.params();
    if (status) qs.set('status', status);
    if (category) qs.set('category', category);
    return get(`/expenses?${qs}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [period.year, period.month, status, category]);

  const sync = async () => {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const { result } = await post('/integrations/morning/expenses-sync');
      setNotice(
        `${result.fetched} הוצאות (${result.from} – ${result.to}) · ${result.created} חדשות · ${result.updated} עודכנו` +
        ` · ${result.reported} מסומנות כדווחו ב-Morning` +
        // Worth saying out loud: expenses whose status Morning did not state are the ones that
        // look like a mapping problem in the list, and this is where that shows up first.
        (result.unknown ? ` · ${result.unknown} ללא סטטוס מ-Morning` : '') +
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
    <div className="space-y-4">
      <PageHeader
        title="הוצאות"
        sub={
          <>
            <span className="num">{summary.count}</span> מסמכים מוצגים · סה"כ <span className="num">{nis(summary.total)}</span>
            {' · '}מע"מ תשומות <span className="num text-pos">{nis(summary.deductible_vat)}</span>
          </>
        }
        actions={
          <Button variant="ghost" onClick={sync} disabled={!integration.configured || syncing}>
            {syncing ? 'מסנכרן…' : 'סנכרון מ-Morning'}
          </Button>
        }
      />

      <FilterBar>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={filterClass}>
          <option value="">כל הסטטוסים</option>
          <option value="open">טרם דווחו</option>
          <option value="reported">דווחו</option>
          <option value="unknown">סטטוס לא ידוע</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={filterClass}>
          <option value="">כל הסיווגים</option>
          {data.categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
          <option value={UNCATEGORIZED}>ללא סיווג</option>
        </select>
        <PeriodSelect year={period.year} month={period.month}
          onYearChange={period.setYear} onMonthChange={period.setMonth} />
        <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי ספק, פירוט או סיווג…"
          className="flex-1 min-w-[10rem] sm:max-w-xs" />
      </FilterBar>

      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}
      {notice && <div className="text-sm text-pos bg-pos-soft rounded-xl px-4 py-2.5">{notice}</div>}
      {integration.unknown > 0 && (
        <div className="text-sm text-muted bg-soft rounded-xl px-4 py-2.5">
          ל-<span className="num">{integration.unknown}</span> הוצאות Morning לא החזירה סטטוס דיווח, והן
          מוצגות כ<b>סטטוס לא ידוע</b> ולא כ"טרם דווחו" — כדי שלא ייראו כאילו לא דווחו בזמן שהן כן.
          להצגת השדה שבו Morning שומרת את הדיווח בחשבון הזה:{' '}
          <code dir="ltr" className="text-accent">npm run expenses:probe</code>
        </div>
      )}

      {!integration.configured && (
        <div className="text-sm text-muted">
          Morning לא מוגדר — חסרים <code dir="ltr" className="text-accent">GREEN_INVOICE_ID</code> /{' '}
          <code dir="ltr" className="text-accent">GREEN_INVOICE_SECRET</code>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label='סה"כ הוצאות (כולל מע"מ)' value={nis(summary.total)} sub={`${summary.count} מסמכים`} accent="text-neg" />
        <StatCard
          label='לפני מע"מ'
          value={nis(summary.subtotal)}
          // Only when the two differ: on books where everything is deducted in full, the
          // recognised figure is the figure, and saying so twice is noise.
          sub={summary.deductible !== summary.subtotal ? `מוכר לצורכי מס ${nis(summary.deductible)}` : undefined}
        />
        {/* The card says לקיזוז בדיווח, so it has to be the reclaimable figure and not the VAT
            on the documents. Where a deduction percentage holds some of it back, the full sum
            is named underneath — that gap is money paid out that will not come back. */}
        <StatCard
          label='מע"מ תשומות'
          value={nis(summary.deductible_vat)}
          sub={summary.deductible_vat !== summary.vat
            ? `לקיזוז בדיווח · מתוך ${nis(summary.vat)} בחשבוניות`
            : 'לקיזוז בדיווח'}
          accent="text-pos"
        />
        <StatCard
          label="סונכרן לאחרונה"
          value={integration.last_sync ? new Date(integration.last_sync).toLocaleDateString('he-IL') : '—'}
          sub={`${integration.synced} הוצאות מ-Morning`}
        />
      </div>

      {summary.byCategory.length > 1 && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="ser text-lg">פילוח הוצאות לפי קטגוריות</h2>
            <Button variant="ghost" onClick={() => setBreakdownOpen(!breakdownOpen)}>
              {breakdownOpen ? 'הסתרה' : 'הצגת הפילוח'}
            </Button>
          </div>
          {breakdownOpen && (
            <div className="space-y-2 mt-3">
              {summary.byCategory.map((row: any) => (
                <button
                  key={row.category}
                  onClick={() => setCategory(row.category === 'ללא סיווג' ? UNCATEGORIZED : row.category)}
                  className="w-full text-right hover:bg-soft rounded-lg px-2 py-1.5 transition-colors"
                >
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className="truncate">{row.category}</span>
                    <span className="text-muted shrink-0">
                      {nis(row.total)} <span className="text-xs text-ghost">· {row.count}</span>
                    </span>
                  </div>
                  {/* Each category against the largest one, so the year's weight is visible at a glance. */}
                  <div className="mt-1 h-1 rounded-full bg-soft overflow-hidden">
                    <div
                      className="h-full bg-neg-soft"
                      style={{ width: `${Math.max(2, (row.total / (summary.byCategory[0].total || 1)) * 100)}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      <DataTable
            empty={integration.synced ? 'אין הוצאות בטווח הזה' : 'עדיין לא סונכרנו הוצאות מ-Morning'}
            rows={visible}
            rowKey={(e: any) => e.id}
            rowClassName={() => 'hover:bg-soft'}
            columns={[
              {
                key: 'date', header: 'תאריך', sortValue: (e: any) => e.date, className: 'whitespace-nowrap',
                // The מע"מ period Morning files the expense under is shown only when it is not
                // the document's own month. That is the case worth seeing — an August invoice
                // reported in July's period sits in a different filing than its date suggests —
                // and printing it on every row would just repeat the date beside it.
                render: (e: any) => (
                  <>
                    {e.date}
                    {e.reporting_date && e.reporting_date.slice(0, 7) !== e.date.slice(0, 7) && (
                      <span className="block text-xs text-faint">
                        דיווח {e.reporting_date.slice(5, 7)}/{e.reporting_date.slice(0, 4)}
                      </span>
                    )}
                  </>
                ),
              },
              {
                key: 'supplier', header: 'ספק', mobile: 'title', sortValue: (e: any) => e.supplier_name,
                className: 'font-medium', render: (e: any) => e.supplier_name,
              },
              {
                key: 'description', header: 'פירוט', sortValue: (e: any) => e.description,
                className: 'text-muted max-w-[16rem] truncate', render: (e: any) => e.description || '—',
              },
              {
                key: 'category', header: 'סיווג', sortValue: (e: any) => e.category,
                render: (e: any) => e.category
                  ? <span className="text-xs text-ink-2">{e.category}</span>
                  : <span className="text-xs text-ghost">ללא סיווג</span>,
              },
              {
                key: 'doc', header: 'מסמך', sortValue: (e: any) => e.number, className: 'whitespace-nowrap text-xs text-faint',
                render: (e: any) => [e.doc_type_label, e.number ? `#${e.number}` : ''].filter(Boolean).join(' ') || '—',
              },
              {
                key: 'amount', header: 'לפני מע"מ', sortValue: (e: any) => e.amount, className: 'whitespace-nowrap',
                render: (e: any) => (
                  <>
                    {nis(e.amount)}
                    {e.currency && e.currency !== 'ILS' && (
                      <span className="text-xs text-faint" dir="ltr"> ({e.currency})</span>
                    )}
                  </>
                ),
              },
              {
                key: 'vat', header: 'מע"מ', sortValue: (e: any) => e.vat_amount, className: 'text-muted',
                // A partly deductible expense shows what may be reclaimed, with the VAT on the
                // document behind it — the row is the one place the deduction is visible per
                // expense, and the two figures only differ where a percentage was applied.
                render: (e: any) => (
                  e.deductible_vat != null && e.deductible_vat !== e.vat_amount
                    ? (
                      <>
                        <span className="text-pos">{nis(e.deductible_vat)}</span>
                        <span className="block text-xs text-faint">מתוך {nis(e.vat_amount)}</span>
                      </>
                    )
                    : nis(e.vat_amount)
                ),
              },
              { key: 'total', header: 'סה"כ', sortValue: (e: any) => e.total, className: 'font-medium text-neg', render: (e: any) => nis(e.total) },
              { key: 'status', header: 'סטטוס', sortValue: (e: any) => e.status, render: (e: any) => <StatusBadge status={e.status} /> },
            ]}
          />
    </div>
  );
}
