import React from 'react';
import { clsx } from 'clsx';

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-surface border border-line rounded-2xl p-4 md:p-5', className)}>
      {children}
    </div>
  );
}

/**
 * The dark slab. One per screen at most: it is what the eye lands on first, so it is reserved
 * for the single figure a page exists to report — the VAT owed, the money still in the air.
 */
export function InkPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-ink text-white rounded-2xl p-5 md:p-6', className)}>{children}</div>
  );
}

/**
 * The heading every page opens with: title, and one line saying what the numbers under it add
 * up to. `actions` sit on the far side, dropping under the title when the line runs out.
 */
export function PageHeader({ title, sub, actions }: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="ser text-2xl md:text-3xl">{title}</h1>
        {sub && <p className="mt-1.5 text-sm md:text-[15px] text-body">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-surface border border-line rounded-2xl px-4 py-3.5 md:px-5 md:py-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={clsx('num text-xl md:text-2xl font-extrabold tracking-[-0.03em] mt-1', accent || 'text-ink')}>{value}</div>
      {sub && <div className="text-[13px] text-muted mt-1">{sub}</div>}
    </div>
  );
}

/**
 * A filter pill. The row of them replaces the old select-per-filter: on this design a list's
 * subsets are the first thing under its title, not something you go looking for in a dropdown.
 */
export function Pill({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'text-[13px] font-semibold px-3.5 py-1.5 rounded-full whitespace-nowrap transition-colors',
        active
          ? 'bg-accent text-white'
          : 'bg-surface border border-line text-ink-2 hover:border-line-strong'
      )}
    >
      {children}
    </button>
  );
}

/** The segmented control: same choice as a pill row, but for a switch of view rather than a filter. */
export function Segmented<T extends string>({ value, options, onChange, className }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex gap-0.5 bg-soft border border-line rounded-lg p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'text-[13px] font-semibold px-3.5 py-1.5 rounded-md whitespace-nowrap transition-colors',
            value === o.value ? 'bg-accent text-white' : 'text-muted hover:text-ink-2'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The white strip a list's filters sit in, between the title and the table. Giving them their
 * own surface is what stops a row of naked selects from reading as part of the page heading.
 */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-2.5 bg-surface border border-line rounded-xl p-2.5', className)}>
      {children}
    </div>
  );
}

/** What a filter `<select>` wears, so the bare ones in the pages match the shared controls. */
export const filterClass =
  'bg-soft border border-line rounded-lg px-3 py-2 text-sm text-ink-2 font-medium focus:outline-none focus:border-accent';

/** Status colours: [background, text, label]. */
const badgeStyles: Record<string, [string, string]> = {
  unpaid: ['bg-warn-soft', 'text-warn-ink'],
  invoiced: ['bg-moon-soft', 'text-moon'],
  paid: ['bg-pos-soft', 'text-pos'],
  issued: ['bg-warn-soft', 'text-warn-ink'],
  cancelled: ['bg-soft', 'text-muted'],
  draft: ['bg-soft', 'text-muted'],
  // Expenses: an open one is still editable in Morning, a reported one is with the accountant.
  open: ['bg-warn-soft', 'text-warn-ink'],
  reported: ['bg-pos-soft', 'text-pos'],
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
  const [bg, fg] = badgeStyles[status] || badgeStyles.draft;
  return (
    <span className={clsx('inline-block px-2.5 py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap', bg, fg)}>
      {badgeLabels[status] || status}
    </span>
  );
}

/**
 * Where a tax period stands. Separate from StatusBadge because the words collide: an "open"
 * expense means one Morning has not reported yet, while an open מע"מ period is simply one
 * still running — nothing anybody has to act on.
 */
const periodStyles: Record<string, [string, string, string]> = {
  open: ['bg-soft', 'text-muted', 'תקופה פתוחה'],
  due: ['bg-warn-soft', 'text-warn-ink', 'להגשה'],
  overdue: ['bg-neg-soft', 'text-neg', 'באיחור'],
  filed: ['bg-accent-soft', 'text-accent-ink', 'דווח'],
  paid: ['bg-pos-soft', 'text-pos', 'שולם'],
};

export function PeriodBadge({ status }: { status: string }) {
  const [bg, fg, label] = periodStyles[status] ?? periodStyles.open;
  return (
    <span className={clsx('inline-block px-2.5 py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap', bg, fg)}>
      {label}
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
    primary: 'bg-accent text-white hover:brightness-110',
    ghost: 'bg-surface text-ink-2 border border-line-strong hover:bg-soft',
    danger: 'bg-neg text-white hover:brightness-110',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'px-4 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed',
        styles[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

/** The one field style, shared by every input, textarea and select on the app. */
export const fieldClass =
  'w-full bg-soft border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ghost ' +
  'focus:outline-none focus:border-accent focus:bg-surface transition-colors';

export function Input({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="block text-[13px] text-muted mb-1.5">{label}</span>}
      <input {...props} className={fieldClass} />
    </label>
  );
}

export function Textarea({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="block text-[13px] text-muted mb-1.5">{label}</span>}
      <textarea rows={3} {...props} className={clsx(fieldClass, 'resize-y')} />
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
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[rgba(26,22,45,.45)] p-0 md:p-4" onClick={onClose}>
      <div
        className={clsx(
          'bg-surface rounded-t-2xl md:rounded-2xl w-full max-h-[90vh] overflow-y-auto p-5 md:p-6 shadow-[0_28px_60px_rgba(20,24,32,.30)]',
          modalWidths[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="ser text-xl">{title}</h2>
          <button
            onClick={onClose}
            className="bg-soft rounded-lg w-8 h-8 text-ink-2 hover:text-ink leading-none shrink-0"
          >
            ✕
          </button>
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
  empty = 'אין נתונים',
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
  /** Shown in place of the table when there is nothing to list. */
  empty?: string;
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

  // The frame stays even with nothing in it: an empty list is a fact about the filters, and it
  // reads as one only if it sits where the table would have been.
  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl">
        <Empty text={empty} />
      </div>
    );
  }

  return (
    <>
      {/* desktop */}
      <div className="hidden md:block bg-surface border border-line rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[14.5px]">
            <thead>
              <tr className="text-right text-muted bg-soft">
                {cols.map((c) => (
                  <th key={c.key} className="px-4 py-3 text-[13px] font-semibold whitespace-nowrap">
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => cycle(c.key)}
                        className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                      >
                        {c.header}
                        <span className="text-[10px] text-accent w-2.5 inline-block">
                          {sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    ) : c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <React.Fragment key={rowKey(r)}>
                  <tr
                    className={clsx(
                      'border-t border-soft',
                      // The zebra is faint on purpose: it guides the eye across a wide row
                      // without turning the table into stripes.
                      i % 2 === 1 && 'bg-[#FAFBFC]',
                      rowClassName?.(r),
                      onRowClick && 'cursor-pointer hover:bg-soft'
                    )}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                  >
                    {cols.map((c) => (
                      <td key={c.key} className={clsx('px-4 py-3', c.className)}>{c.render(r)}</td>
                    ))}
                  </tr>
                  {isExpanded?.(r) && renderExpanded && (
                    <tr className="bg-soft">
                      <td colSpan={cols.length} className="px-4 pb-4">{renderExpanded(r)}</td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* mobile */}
      <div className="md:hidden space-y-3">
        {sortable.length > 0 && (
          <div className="flex gap-2">
            <select
              aria-label="מיון"
              value={active?.sortValue ? sort!.key : ''}
              onChange={(e) => setSort(e.target.value ? { key: e.target.value, dir: sort?.dir ?? 1 } : null)}
              className={clsx(fieldClass, 'flex-1')}
            >
              <option value="">מיון: סדר רגיל</option>
              {sortable.map((c) => <option key={c.key} value={c.key}>מיון: {label(c)}</option>)}
            </select>
            <button
              type="button"
              disabled={!sort}
              onClick={() => setSort((s) => (s ? { ...s, dir: s.dir === 1 ? -1 : 1 } : s))}
              className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink-2 disabled:opacity-40 whitespace-nowrap"
            >
              {(sort?.dir ?? 1) === 1 ? '▲ עולה' : '▼ יורד'}
            </button>
          </div>
        )}

        {sorted.map((r) => (
          <div
            key={rowKey(r)}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={clsx('bg-surface border border-line rounded-2xl p-4', rowClassName?.(r))}
          >
            {(leads.length > 0 || titles.length > 0) && (
              <div className="flex items-center gap-2.5">
                {leads.map((c) => <React.Fragment key={c.key}>{c.render(r)}</React.Fragment>)}
                <div className="flex-1 min-w-0 font-semibold">
                  {titles.map((c) => <React.Fragment key={c.key}>{c.render(r)}</React.Fragment>)}
                </div>
              </div>
            )}
            {fields.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                {fields.map((c) => (
                  <div key={c.key}>
                    <div className="text-xs text-faint mb-0.5">{label(c)}</div>
                    <div>{c.render(r)}</div>
                  </div>
                ))}
              </div>
            )}
            {actions.length > 0 && (
              <div className="mt-3 pt-3 border-t border-soft flex items-center justify-end gap-4">
                {actions.map((c) => <React.Fragment key={c.key}>{c.render(r)}</React.Fragment>)}
              </div>
            )}
            {isExpanded?.(r) && renderExpanded && (
              <div className="mt-3 pt-3 border-t border-soft">{renderExpanded(r)}</div>
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
      className={clsx(fieldClass, className)}
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
  return <div className="text-center text-faint py-10">{text}</div>;
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
        className="accent-accent w-4 h-4 disabled:opacity-50"
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
          'w-full rounded px-1 -mx-1 text-start hover:bg-soft hover:ring-1 hover:ring-line transition-colors',
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
      // The cell opens with what is in it selected, so typing replaces rather than appends.
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
      }}
      className="w-full min-w-[4.5rem] bg-surface border border-accent rounded px-1.5 py-0.5 text-sm focus:outline-none"
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
        'bg-soft border border-line rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent',
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
  'bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink-2 font-medium focus:outline-none focus:border-accent';

/**
 * `''` means every year — lists default to the current one. Reports and the dashboard pass
 * `allowAll={false}`: a מע"מ period or a year's profit only means anything within one year.
 */
export function YearSelect({ value, onChange, label, allowAll = true }: {
  value: number | '';
  onChange: (value: number | '') => void;
  label?: string;
  allowAll?: boolean;
}) {
  return (
    <select
      aria-label={label || 'שנה'}
      value={value === '' ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
      className={selectClass}
    >
      {allowAll && <option value="">כל השנים</option>}
      {recentYears().map((year) => (
        <option key={year} value={year}>{year}</option>
      ))}
    </select>
  );
}

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/**
 * Narrows a year down to one month. `''` is the whole year, which is what every list opens on.
 *
 * It is disabled without a year, because a month on its own is not a period — the server
 * ignores one sent without a year, and the control says so rather than looking broken.
 */
export function MonthSelect({ value, onChange, disabled, label }: {
  value: number | '';
  onChange: (value: number | '') => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <select
      aria-label={label || 'חודש'}
      value={value === '' ? '' : String(value)}
      disabled={disabled}
      title={disabled ? 'בחרו שנה כדי לסנן לפי חודש' : undefined}
      onChange={(e) => onChange(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
      className={clsx(selectClass, 'disabled:opacity-40 disabled:cursor-not-allowed')}
    >
      <option value="">כל החודשים</option>
      {MONTHS.map((name, i) => (
        <option key={name} value={i + 1}>{name}</option>
      ))}
    </select>
  );
}

/**
 * The year+month pair the lists filter by, and the query string they send. Kept here so every
 * table filters the same way and the server sees one shape.
 */
export function usePeriodFilter(initialYear: number | '' = new Date().getFullYear()) {
  const [year, setYear] = React.useState<number | ''>(initialYear);
  const [month, setMonth] = React.useState<number | ''>('');

  // A month belongs to a year; dropping to "all years" leaves it pointing at nothing.
  const changeYear = (next: number | '') => {
    setYear(next);
    if (next === '') setMonth('');
  };

  const params = () => {
    const qs = new URLSearchParams();
    if (year !== '') qs.set('year', String(year));
    if (year !== '' && month !== '') qs.set('month', String(month));
    return qs;
  };

  return { year, month, setYear: changeYear, setMonth, params };
}

/** What a page holding a period filter passes down to the tables that share it. */
export type PeriodFilter = ReturnType<typeof usePeriodFilter>;

/** The two selects together, in the order every filter bar shows them. */
export function PeriodSelect({ year, month, onYearChange, onMonthChange, allowAll = true }: {
  year: number | '';
  month: number | '';
  onYearChange: (value: number | '') => void;
  onMonthChange: (value: number | '') => void;
  allowAll?: boolean;
}) {
  return (
    <>
      <YearSelect value={year} onChange={onYearChange} allowAll={allowAll} />
      <MonthSelect value={month} onChange={onMonthChange} disabled={year === ''} />
    </>
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
        className={fieldClass}
      />
      {open && (
        <div className="absolute z-40 mt-1 w-full max-h-56 overflow-y-auto bg-surface border border-line rounded-xl shadow-[0_12px_30px_rgba(20,24,32,.15)]">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-faint">אין תוצאות</div>}
          {matches.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); choose(option); }}
              className={clsx(
                'block w-full text-right px-3 py-2 text-sm hover:bg-soft',
                option.value === value ? 'text-accent font-semibold' : 'text-ink-2'
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
