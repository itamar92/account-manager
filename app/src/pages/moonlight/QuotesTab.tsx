import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { del, get, post, nis } from '../../api';
import { Button, DataTable, FilterBar, PageHeader, Pill, SearchInput, StatCard, textMatch } from '../../ui';
import {
  STATUS_LABELS, STATUS_STYLES, quoteDate, useQuoteSettings,
  type Quote, type QuoteStatus,
} from './quotes';
import { PackagesModal, QuickCreateModal, QuoteSettingsModal, TemplatesModal } from './QuoteModals';

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return (
    <span className={clsx('inline-block px-2.5 py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap', STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

type Filter = 'all' | 'open' | 'draft' | 'signed' | 'closed';

const FILTERS: Array<{ value: Filter; label: string; matches: (s: QuoteStatus) => boolean }> = [
  { value: 'all', label: 'הכל', matches: () => true },
  { value: 'open', label: 'אצל הלקוח', matches: (s) => s === 'sent' || s === 'viewed' },
  { value: 'draft', label: 'טיוטות', matches: (s) => s === 'draft' },
  { value: 'signed', label: 'נחתמו', matches: (s) => s === 'signed' },
  { value: 'closed', label: 'פג תוקף ובוטלו', matches: (s) => s === 'expired' || s === 'cancelled' },
];

/**
 * The band's price quotes: what is out with a client, what came back signed, and the button
 * that makes the next one.
 *
 * Unlike every other Moonlight tab this one is not view-only for the band — any member can make,
 * edit and send a quote, which is why it takes no `isOwner`.
 */
export function QuotesTab({ onError }: { onError: (message: string) => void }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [templates, setTemplates] = useState<Quote[]>([]);
  const { data: settingsData, reload: reloadSettings } = useQuoteSettings(onError);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = () => {
    get('/moonlight/quotes').then((d) => setQuotes(d.quotes)).catch((e) => onError(e.message));
    get('/moonlight/quotes/templates').then((d) => setTemplates(d.templates)).catch((e) => onError(e.message));
  };
  useEffect(load, []);

  // `?new=1` is how the header's quick action reaches in here; dropped again so a reload does
  // not reopen a dialog that was already closed.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setQuickOpen(true);
    searchParams.delete('new');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams]);

  const open = (id: string) => navigate(`/moonlight/quotes/${id}`);

  const createBlank = async () => {
    try { open((await post('/moonlight/quotes')).quote.id); }
    catch (err: any) { onError(err.message); }
  };

  const createTemplate = async () => {
    try { open((await post('/moonlight/quotes/templates')).quote.id); }
    catch (err: any) { onError(err.message); }
  };

  const duplicate = async (quote: Quote) => {
    try { open((await post(`/moonlight/quotes/${quote.id}/duplicate`)).quote.id); }
    catch (err: any) { onError(err.message); }
  };

  const remove = async (quote: Quote) => {
    if (!confirm(`למחוק את ההצעה ${quote.quote_number}${quote.client_name ? ` ל${quote.client_name}` : ''}?`)) return;
    try { await del(`/moonlight/quotes/${quote.id}`); load(); }
    catch (err: any) { onError(err.message); }
  };

  const year = String(new Date().getFullYear());
  const stats = useMemo(() => {
    const all = quotes ?? [];
    const out = all.filter((q) => q.display_status === 'sent' || q.display_status === 'viewed');
    const signed = all.filter((q) => q.status === 'signed' && q.signed_at?.startsWith(year));
    // Of what reached a client this year, how much came back signed. Drafts never reached one.
    const sent = all.filter((q) => q.status !== 'draft' && q.created_at.startsWith(year));
    const sum = (rows: Quote[]) => rows.reduce((s, q) => s + (Number(q.total) || 0), 0);
    return {
      out: out.length, outValue: sum(out),
      signed: signed.length, signedValue: sum(signed),
      drafts: all.filter((q) => q.status === 'draft').length,
      rate: sent.length ? Math.round((sent.filter((q) => q.status === 'signed').length / sent.length) * 100) : null,
    };
  }, [quotes, year]);

  const matches = FILTERS.find((f) => f.value === filter)!.matches;
  const rows = (quotes ?? []).filter((q) =>
    matches(q.display_status)
    && textMatch(query, q.client_name, q.title, q.quote_number, q.event_location, q.client_phone));

  const noTemplates = templates.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="הצעות מחיר"
        sub={stats.out > 0
          ? <><span className="num">{stats.out}</span> הצעות אצל לקוחות בשווי <span className="num">{nis(stats.outValue)}</span></>
          : 'אין כרגע הצעות שמחכות לתשובה מלקוח'}
        actions={(
          <>
            <Button variant="ghost" onClick={() => setTemplatesOpen(true)}>תבניות</Button>
            <Button variant="ghost" onClick={() => setPackagesOpen(true)}>חבילות</Button>
            <Button variant="ghost" onClick={() => setSettingsOpen(true)}>הגדרות</Button>
            <Button onClick={() => setQuickOpen(true)}>+ הצעה חדשה</Button>
          </>
        )}
      />

      {/* The template is what makes a quote three fields instead of thirty, so a band without
          one is told so up front rather than discovering it inside the dialog. */}
      {noTemplates && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-accent-soft rounded-2xl px-5 py-4">
          <div>
            <div className="font-semibold text-accent-ink">התחילו מתבנית</div>
            <p className="text-[13.5px] text-ink-2 mt-0.5">
              תבנית היא ההצעה הרגילה שלכם — פתיח, שורות ותנאים. מרגע שיש אחת, הצעה חדשה היא רק שם, תאריך ומחיר.
            </p>
          </div>
          <Button onClick={createTemplate}>יצירת תבנית</Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="אצל לקוחות" value={String(stats.out)} sub={stats.out ? nis(stats.outValue) : undefined} />
        <StatCard label={`נחתמו ב־${year}`} value={String(stats.signed)} sub={stats.signed ? nis(stats.signedValue) : undefined} accent="text-pos" />
        <StatCard label="אחוז סגירה השנה" value={stats.rate === null ? '—' : `${stats.rate}%`} sub="מתוך ההצעות שנשלחו" />
        <StatCard label="טיוטות" value={String(stats.drafts)} accent="text-muted" />
      </div>

      <FilterBar>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Pill key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}</Pill>
          ))}
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="חיפוש לקוח, מספר או מקום…" className="md:max-w-64 md:ms-auto" />
      </FilterBar>

      <DataTable
        empty={quotes === null ? 'טוען…' : (quotes.length ? 'אין הצעות שמתאימות לסינון' : 'עדיין אין הצעות מחיר')}
        rows={rows}
        rowKey={(q) => q.id}
        onRowClick={(q) => open(q.id)}
        columns={[
          {
            key: 'client', header: 'לקוח', mobile: 'title', sortValue: (q) => q.client_name,
            render: (q) => (
              <div className="min-w-0">
                <div className="font-medium">{q.client_name || <span className="text-faint">ללא שם</span>}</div>
                <div className="text-[12.5px] text-faint truncate max-w-72">{q.title}</div>
              </div>
            ),
          },
          {
            key: 'number', header: 'מספר', sortValue: (q) => q.quote_number,
            render: (q) => <span className="num text-muted" dir="ltr">{q.quote_number}</span>,
          },
          {
            key: 'event', header: 'אירוע', sortValue: (q) => q.event_date,
            render: (q) => q.event_date || q.event_type
              ? (
                <div>
                  <div className="num">{quoteDate(q.event_date) || '—'}</div>
                  {q.event_type && <div className="text-[12.5px] text-faint">{q.event_type}</div>}
                </div>
              )
              : <span className="text-faint">—</span>,
          },
          {
            key: 'total', header: 'סכום', sortValue: (q) => Number(q.total) || 0,
            render: (q) => <span className="num font-medium">{nis(q.total)}</span>,
          },
          {
            key: 'status', header: 'סטטוס', sortValue: (q) => q.display_status,
            render: (q) => <QuoteStatusBadge status={q.display_status} />,
          },
          {
            key: 'by', header: 'נוצרה ע״י', sortValue: (q) => q.created_by_name,
            render: (q) => <span className="text-muted">{q.created_by_name || '—'}</span>,
          },
          {
            key: 'actions', mobile: 'actions', className: 'text-left whitespace-nowrap',
            render: (q) => (
              // The row opens the quote; these are the two things worth doing without opening it.
              <div className="flex gap-3 md:gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => duplicate(q)} className="text-sm text-accent hover:underline">שכפול</button>
                {(q.status === 'draft' || q.status === 'cancelled') && (
                  <button onClick={() => remove(q)} className="text-sm text-neg hover:underline">מחיקה</button>
                )}
              </div>
            ),
          },
        ]}
      />

      <QuickCreateModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        templates={templates}
        settingsData={settingsData}
        onCreated={open}
        onBlank={createBlank}
        onNewTemplate={createTemplate}
        onError={onError}
      />
      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        templates={templates}
        onOpen={open}
        onNew={createTemplate}
        onChanged={() => { load(); reloadSettings(); }}
        onError={onError}
      />
      <PackagesModal open={packagesOpen} onClose={() => setPackagesOpen(false)} onError={onError} />
      <QuoteSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settingsData={settingsData}
        onSaved={() => { setSettingsOpen(false); reloadSettings(); }}
        onError={onError}
      />
    </div>
  );
}
