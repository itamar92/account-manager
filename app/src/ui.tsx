import React from 'react';
import { clsx } from 'clsx';

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-5', className)}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className={clsx('text-2xl font-bold mt-1', accent || 'text-slate-100')}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </Card>
  );
}

const badgeStyles: Record<string, string> = {
  unpaid: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  invoiced: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  paid: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  issued: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  cancelled: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  draft: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  // Expenses: an open one is still editable in Morning, a reported one is with the accountant.
  open: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  reported: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

const badgeLabels: Record<string, string> = {
  unpaid: 'לא חויב',
  invoiced: 'בחשבונית',
  paid: 'שולם',
  issued: 'פתוחה',
  cancelled: 'בוטלה',
  draft: 'טיוטה',
  open: 'טרם דווח',
  reported: 'דווח',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs border whitespace-nowrap', badgeStyles[status] || badgeStyles.draft)}>
      {badgeLabels[status] || status}
    </span>
  );
}

export function Button({
  children, onClick, variant = 'primary', type = 'button', disabled, className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    ghost: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700',
    danger: 'bg-rose-600/80 hover:bg-rose-600 text-white',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed', styles[variant], className)}
    >
      {children}
    </button>
  );
}

export function Input({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="block text-sm text-slate-400 mb-1">{label}</span>}
      <input
        {...props}
        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
      />
    </label>
  );
}

export function Textarea({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="block text-sm text-slate-400 mb-1">{label}</span>}
      <textarea
        rows={3}
        {...props}
        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm resize-y focus:outline-none focus:border-indigo-500"
      />
    </label>
  );
}

const modalWidths = {
  md: 'md:max-w-lg',
  lg: 'md:max-w-2xl',
  xl: 'md:max-w-3xl',
};

export function Modal({ title, open, onClose, children, size = 'md' }: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: keyof typeof modalWidths;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-0 md:p-4" onClick={onClose}>
      <div
        className={clsx(
          'bg-slate-900 border border-slate-700 rounded-t-2xl md:rounded-2xl w-full max-h-[90vh] overflow-y-auto p-5',
          modalWidths[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface DataColumn<T> {
  /** Stable id; also what the sort state points at. */
  key: string;
  /** Desktop column header. Doubles as the mobile label when it is a string. */
  header?: React.ReactNode;
  /** Mobile-card / sort-menu label, for columns whose header is not plain text. */
  label?: string;
  render: (row: T) => React.ReactNode;
  /** Providing this makes the column sortable, on both layouts. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Extra classes for the desktop cell. */
  className?: string;
  /**
   * Where the value lives in the mobile card: 'title' is the card heading, 'lead' sits
   * before it (checkboxes), 'actions' collect in the card footer, 'hidden' drops it.
   * Default ('field') is a labelled value in the card body.
   */
  mobile?: 'title' | 'lead' | 'field' | 'actions' | 'hidden';
}

type SortState = { key: string; dir: 1 | -1 } | null;

/**
 * The one way tables are shown: a real table with sortable headers on a wide screen, and
 * stacked cards with a sort picker on a phone — where a nine-column table is only a strip
 * you scroll sideways and can never take in whole.
 *
 * Columns may be `false` so a page can switch some off (per role) inline.
 */
export function DataTable<T>({
  columns, rows, rowKey, rowClassName, onRowClick, isExpanded, renderExpanded, defaultSort,
}: {
  columns: Array<DataColumn<T> | false | null | undefined>;
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  /** Rows that currently show their `renderExpanded` panel — the caller keeps the set. */
  isExpanded?: (row: T) => boolean;
  renderExpanded?: (row: T) => React.ReactNode;
  defaultSort?: { key: string; dir: 1 | -1 };
}) {
  const cols = columns.filter((c): c is DataColumn<T> => !!c);
  const [sort, setSort] = React.useState<SortState>(defaultSort ?? null);

  const active = sort ? cols.find((c) => c.key === sort.key) : undefined;
  let sorted = rows;
  if (sort && active?.sortValue) {
    const value = active.sortValue;
    sorted = [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      // Blanks sink to the bottom in either direction.
      if (va == null || va === '') return vb == null || vb === '' ? 0 : 1;
      if (vb == null || vb === '') return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'he', { numeric: true });
      return cmp * sort.dir;
    });
  }

  const label = (c: DataColumn<T>) => c.label ?? (typeof c.header === 'string' ? c.header : '');
  const sortable = cols.filter((c) => c.sortValue);
  const cycle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));

  const leads = cols.filter((c) => c.mobile === 'lead');
  const titles = cols.filter((c) => c.mobile === 'title');
  const fields = cols.filter((c) => !c.mobile || c.mobile === 'field');
  const actions = cols.filter((c) => c.mobile === 'actions');

  return (
    <>
      {/* desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-slate-400 border-b border-slate-800">
              {cols.map((c) => (
                <th key={c.key} className="px-3 py-2 font-medium whitespace-nowrap">
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => cycle(c.key)}
                      className="inline-flex items-center gap-1 hover:text-slate-200 transition-colors"
                    >
                      {c.header}
                      <span className="text-[10px] text-indigo-400 w-2.5 inline-block">
                        {sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {sorted.map((r) => (
              <React.Fragment key={rowKey(r)}>
                <tr
                  className={clsx(rowClassName?.(r), onRowClick && 'cursor-pointer')}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {cols.map((c) => (
                    <td key={c.key} className={clsx('px-3 py-2.5', c.className)}>{c.render(r)}</td>
                  ))}
                </tr>
                {isExpanded?.(r) && renderExpanded && (
                  <tr className="bg-slate-800/20">
                    <td colSpan={cols.length} className="px-4 py-3">{renderExpanded(r)}</td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile */}
      <div className="md:hidden space-y-3">
        {sortable.length > 0 && (
          <div className="flex gap-2">
            <select
              aria-label="מיון"
              value={active?.sortValue ? sort!.key : ''}
              onChange={(e) => setSort(e.target.value ? { key: e.target.value, dir: sort?.dir ?? 1 } : null)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="">מיון: סדר רגיל</option>
              {sortable.map((c) => <option key={c.key} value={c.key}>מיון: {label(c)}</option>)}
            </select>
            <button
              type="button"
              disabled={!sort}
              onClick={() => setSort((s) => (s ? { ...s, dir: s.dir === 1 ? -1 : 1 } : s))}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-300 disabled:opacity-40 whitespace-nowrap"
            >
              {(sort?.dir ?? 1) === 1 ? '▲ עולה' : '▼ יורד'}
            </button>
          </div>
        )}

        {sorted.map((r) => (
          <div
            key={rowKey(r)}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={clsx('border border-slate-800 rounded-xl p-3 bg-slate-800/20', rowClassName?.(r))}
          >
            {(leads.length > 0 || titles.length > 0) && (
              <div className="flex items-center gap-2.5">
                {leads.map((c) => <React.Fragment key={c.key}>{c.render(r)}</React.Fragment>)}
                <div className="flex-1 min-w-0 font-medium">
                  {titles.map((c) => <React.Fragment key={c.key}>{c.render(r)}</React.Fragment>)}
                </div>
              </div>
            )}
            {fields.length > 0 && (
              <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {fields.map((c) => (
                  <div key={c.key}>
                    <div className="text-xs text-slate-500 mb-0.5">{label(c)}</div>
                    <div>{c.render(r)}</div>
                  </div>
                ))}
              </div>
            )}
            {actions.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-end gap-4">
                {actions.map((c) => <React.Fragment key={c.key}>{c.render(r)}</React.Fragment>)}
              </div>
            )}
            {isExpanded?.(r) && renderExpanded && (
              <div className="mt-3 pt-2.5 border-t border-slate-800/60">{renderExpanded(r)}</div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/** The free-text filter above a table, styled to sit beside the filter selects. */
export function SearchInput({ value, onChange, placeholder, className }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || 'חיפוש…'}
      className={clsx(
        'bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500',
        className
      )}
    />
  );
}

/** Case-insensitive "any of these fields contains the query". */
export function textMatch(query: string, ...fields: Array<string | number | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f != null && String(f).toLowerCase().includes(q));
}

export function Empty({ text }: { text: string }) {
  return <div className="text-center text-slate-500 py-10">{text}</div>;
}

/**
 * A table cell you edit by clicking it, saving on blur or Enter and abandoning on Escape.
 *
 * It exists so a table can be corrected in place without the detour through an edit dialog —
 * the dialog stays for entering a row from scratch. Read-only viewers get the plain value, so
 * the hover affordance never promises an edit that would be refused.
 */
export function EditableCell({
  value, onSave, type = 'text', disabled, display, align, placeholder,
}: {
  value: string | number | boolean | null | undefined;
  onSave: (value: any) => void | Promise<void>;
  type?: 'text' | 'number' | 'date' | 'checkbox';
  disabled?: boolean;
  /** What to show when idle, for values that are formatted (currency, dates). */
  display?: React.ReactNode;
  align?: 'right' | 'left';
  placeholder?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  if (type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        disabled={disabled}
        onChange={(e) => onSave(e.target.checked ? 1 : 0)}
        className="accent-indigo-500 w-4 h-4 disabled:opacity-50"
      />
    );
  }

  const idle = display ?? (value === '' || value == null ? '—' : String(value));
  if (disabled) return <span>{idle}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(value == null ? '' : String(value)); setEditing(true); }}
        title="לחיצה לעריכה"
        className={clsx(
          'w-full rounded px-1 -mx-1 text-start hover:bg-slate-800 hover:ring-1 hover:ring-slate-700 transition-colors',
          align === 'left' && 'text-left'
        )}
      >
        {idle}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const next = type === 'number' ? Number(draft) || 0 : draft;
    if (String(next) !== String(value ?? '')) onSave(next);
  };

  return (
    <input
      autoFocus
      type={type}
      value={draft}
      placeholder={placeholder}
      dir={type === 'number' ? 'ltr' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
      }}
      className="w-full min-w-[4.5rem] bg-slate-800 border border-indigo-500 rounded px-1.5 py-0.5 text-sm focus:outline-none"
    />
  );
}

/**
 * A table cell holding one of a fixed set of values, saved as soon as you pick one. Separate
 * from EditableCell because there is nothing to type and nothing to commit — the choice is
 * the edit.
 */
export function SelectCell({ value, options, onSave, disabled, className }: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onSave: (value: string) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  if (disabled) return <span className={className}>{current?.label || '—'}</span>;
  return (
    <select
      value={value}
      onChange={(e) => onSave(e.target.value)}
      className={clsx(
        'bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-indigo-500',
        className
      )}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Years to offer in a filter: this year down, far enough back to cover the seeded history. */
function recentYears(span = 6): number[] {
  const current = new Date().getFullYear();
  return Array.from({ length: span }, (_, i) => current - i);
}

const selectClass =
  'bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500';

/** `''` means every year — lists default to the current one. */
export function YearSelect({ value, onChange, label }: {
  value: number | '';
  onChange: (value: number | '') => void;
  label?: string;
}) {
  return (
    <select
      aria-label={label || 'שנה'}
      value={value === '' ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
      className={selectClass}
    >
      <option value="">כל השנים</option>
      {recentYears().map((year) => (
        <option key={year} value={year}>{year}</option>
      ))}
    </select>
  );
}

export interface ComboOption { value: string; label: string }

/**
 * A select you can type into to narrow a long list — the show list grows with every gig, so
 * picking one out of a plain dropdown gets slower every month.
 */
export function Combobox({ value, options, onChange, placeholder, disabled, className }: {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const selected = options.find((o) => o.value === value);

  if (disabled) return <span>{selected?.label || '—'}</span>;

  const matches = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const choose = (option: ComboOption) => {
    onChange(option.value);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={clsx('relative', className)}>
      <input
        value={open ? query : selected?.label ?? ''}
        placeholder={placeholder || selected?.label || 'בחירה…'}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        // Deferred so a click on an option registers before the list unmounts.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
      />
      {open && (
        <div className="absolute z-40 mt-1 w-full max-h-56 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-xl">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">אין תוצאות</div>}
          {matches.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); choose(option); }}
              className={clsx(
                'block w-full text-right px-3 py-2 text-sm hover:bg-slate-800',
                option.value === value ? 'text-indigo-300' : 'text-slate-200'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
