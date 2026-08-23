import React, { useEffect, useMemo, useState } from 'react';
import { get, nis } from '../api';
import { Button, Input, Modal, SearchInput, YearSelect, filterClass, textMatch } from '../ui';

/** The months as a period invoice names them — no "all months" here, a range has two ends. */
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** The bounds of a whole month, the unit a period invoice is almost always billed in. */
const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;
const monthEnd = (year: number, month: number) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${last}`;
};

const heDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/**
 * One invoice for a client's work over a stretch of time — «חשבונית תקופתית».
 *
 * A month is the unit the work is usually billed in, but not always one month: a client billed
 * for July and August is billed once, for both. So the period is a range of months rather than
 * a single one, and the dialog opens on what that range actually contains before anything is
 * issued — a period invoice is wrong far more often by what it left out than by what it holds.
 *
 * Which is why the works outside the range are here too. A job that ran late, or one that was
 * entered under the wrong date, belongs on the same invoice as the month it is being billed
 * with; the range chooses what is ticked, it does not decide what may be.
 */
export function PeriodInvoiceModal({ open, onClose, clients, onIssue, initialClientId }: {
  open: boolean;
  onClose: () => void;
  clients: any[];
  /** Hands the ticked works to the issue dialog — the document is what creates the invoice. */
  onIssue: (clientId: string, workIds: string[]) => void;
  initialClientId?: string;
}) {
  const now = new Date();
  const [clientId, setClientId] = useState(initialClientId || '');
  const [year, setYear] = useState(now.getFullYear());
  const [fromMonth, setFromMonth] = useState(now.getMonth() + 1);
  const [toMonth, setToMonth] = useState(now.getMonth() + 1);
  const [custom, setCustom] = useState(false);
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [works, setWorks] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // A range that runs backwards is a mis-click on one of the two selects, not a request for
  // nothing — it is read in the order it makes sense in.
  const range = custom
    ? customRange
    : {
        from: monthStart(year, Math.min(fromMonth, toMonth)),
        to: monthEnd(year, Math.max(fromMonth, toMonth)),
      };

  useEffect(() => { if (open && initialClientId) setClientId(initialClientId); }, [open, initialClientId]);

  // Every unbilled work the client has, whatever its date: the range decides what is ticked,
  // and the rest stay available to add.
  useEffect(() => {
    if (!open || !clientId) { setWorks([]); return; }
    setLoading(true);
    setError('');
    get(`/works?status=unpaid&client_id=${encodeURIComponent(clientId)}`)
      .then((d) => setWorks(d.works))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, clientId]);

  const inRange = useMemo(
    () => works.filter((w) => range.from && range.to && w.date >= range.from && w.date <= range.to),
    [works, range.from, range.to]
  );
  const outside = useMemo(
    () => works.filter((w) => !inRange.includes(w)),
    [works, inRange]
  );

  // Choosing a client or a period re-answers the question, so the ticks follow it.
  useEffect(() => {
    setSelected(new Set(inRange.map((w) => w.id)));
  }, [clientId, range.from, range.to, works]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const selectedWorks = works.filter((w) => selected.has(w.id));
  const total = selectedWorks.reduce((sum, w) => sum + (Number(w.total) || 0), 0);
  const outsideVisible = outside.filter((w) => textMatch(search, w.description));
  const outsideSelected = outside.filter((w) => selected.has(w.id)).length;

  return (
    <Modal title="חשבונית תקופתית" open={open} onClose={onClose} size="lg">
      <div className="space-y-4">
        <label className="block">
          <span className="block text-[13px] text-muted mb-1.5">לקוח *</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={filterClass + ' w-full'}>
            <option value="">בחרו לקוח…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <div>
          <div className="text-[13px] text-muted mb-1.5">תקופה</div>
          <div className="flex flex-wrap items-center gap-2">
            {custom ? (
              <>
                <Input type="date" value={customRange.from}
                  onChange={(e) => setCustomRange({ ...customRange, from: e.target.value })} />
                <Input type="date" value={customRange.to}
                  onChange={(e) => setCustomRange({ ...customRange, to: e.target.value })} />
              </>
            ) : (
              <>
                <YearSelect value={year} allowAll={false} onChange={(v) => setYear(v === '' ? now.getFullYear() : v)} />
                <MonthPick value={fromMonth} label="מחודש" onChange={setFromMonth} />
                <span className="text-muted text-sm">עד</span>
                <MonthPick value={toMonth} label="עד חודש" onChange={setToMonth} />
              </>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                if (!custom) setCustomRange({ from: range.from, to: range.to });
                setCustom(!custom);
              }}
            >
              {custom ? 'לפי חודשים' : 'טווח מותאם'}
            </Button>
          </div>
          {range.from && range.to && (
            <div className="num text-xs text-faint mt-1.5">{heDate(range.from)} – {heDate(range.to)}</div>
          )}
        </div>

        {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}

        {!clientId ? (
          <p className="text-sm text-muted">בחרו לקוח כדי לראות את העבודות שטרם חויבו.</p>
        ) : loading ? (
          <p className="text-sm text-muted">טוען…</p>
        ) : (
          <>
            <WorkList
              title={`עבודות בתקופה (${inRange.length})`}
              empty="אין עבודות שטרם חויבו בתקופה הזו"
              rows={inRange}
              selected={selected}
              onToggle={toggle}
              onToggleAll={() => {
                const next = new Set(selected);
                const allOn = inRange.every((w) => next.has(w.id));
                inRange.forEach((w) => (allOn ? next.delete(w.id) : next.add(w.id)));
                setSelected(next);
              }}
            />

            {outside.length > 0 && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-bold">
                    עבודות מחוץ לתקופה ({outside.length})
                    {outsideSelected > 0 && <span className="text-accent font-medium"> · {outsideSelected} נבחרו</span>}
                  </h3>
                  <SearchInput value={search} onChange={setSearch} placeholder="חיפוש בפירוט…" className="w-44" />
                </div>
                <p className="text-xs text-faint mb-2">
                  עבודות שטרם חויבו של אותו לקוח, מחוץ לטווח שנבחר — סמנו כדי לצרף אותן לאותה חשבונית.
                </p>
                <WorkList
                  rows={outsideVisible}
                  empty="אין עבודות נוספות"
                  selected={selected}
                  onToggle={toggle}
                  showYear
                />
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <div className="text-sm">
            נבחרו <b>{selected.size}</b> עבודות · סה"כ כולל מע"מ <b className="num">{nis(total)}</b>
          </div>
          <Button onClick={() => onIssue(clientId, [...selected])} disabled={selected.size === 0 || !clientId}>
            המשך להנפקה ←
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** One end of the month range. */
function MonthPick({ value, label, onChange }: {
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      className={filterClass}
    >
      {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
    </select>
  );
}

/** One tickable list of works — the same row whether it fell inside the period or outside it. */
function WorkList({ title, rows, empty, selected, onToggle, onToggleAll, showYear }: {
  title?: string;
  rows: any[];
  empty: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll?: () => void;
  showYear?: boolean;
}) {
  return (
    <div>
      {title && (
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-bold">{title}</h3>
          {onToggleAll && rows.length > 0 && (
            <button onClick={onToggleAll} className="text-xs text-accent hover:underline">
              {rows.every((w) => selected.has(w.id)) ? 'ניקוי הבחירה' : 'בחירת הכל'}
            </button>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-faint">{empty}</p>
      ) : (
        <div className="border border-line rounded-xl divide-y divide-line max-h-56 overflow-y-auto">
          {rows.map((w) => (
            <label key={w.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-soft">
              <input
                type="checkbox"
                className="accent-accent shrink-0"
                checked={selected.has(w.id)}
                onChange={() => onToggle(w.id)}
              />
              <span className="num text-xs text-faint shrink-0 w-20">
                {showYear ? w.date : w.date.slice(5).replace('-', '/')}
              </span>
              <span className="flex-1 min-w-0 truncate">{w.description}</span>
              <span className="num shrink-0">{nis(w.total)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
