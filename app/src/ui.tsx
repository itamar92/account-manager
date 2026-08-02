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
};

const badgeLabels: Record<string, string> = {
  unpaid: 'לא חויב',
  invoiced: 'בחשבונית',
  paid: 'שולם',
  issued: 'פתוחה',
  cancelled: 'בוטלה',
  draft: 'טיוטה',
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

export function Table({ headers, children }: { headers: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="text-right text-slate-400 border-b border-slate-800">
            {/* Keyed by position: header labels are a fixed list and some are blank
                (action columns), so the label itself is not unique. */}
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">{children}</tbody>
      </table>
    </div>
  );
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
