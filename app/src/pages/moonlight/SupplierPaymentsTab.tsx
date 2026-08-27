import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post, nis, nisExact } from '../../api';
import {
  Button, DataTable, Input, Modal, PageHeader, Segmented, StatCard, Textarea, fieldClass,
} from '../../ui';
import { roleName, showHref, type TabProps } from './shared';

/**
 * What the band has paid its suppliers, and which of those payments still owe it a document.
 *
 * The page exists because of one habit: אבי is paid once for the four gigs he did since the
 * last transfer. Marking four cost lines «שולם» records that they are settled but not that
 * they were settled together, and «did his invoice arrive?» is a question about the transfer,
 * not about any one of the four shows. So a payment is a row here, the shows hang off it, and
 * the row is what waits for a document.
 *
 * The number that matters is money rather than a count of chores: a payment with nothing filed
 * against it is not a deductible expense, and the מע"מ inside it cannot be reclaimed.
 */

/** How long a document may be outstanding before the row starts arguing about it. */
const CHASE_DAYS = 15;
const LATE_DAYS = 45;

const ageStyle = (days: number): string =>
  days >= LATE_DAYS ? 'bg-neg-soft text-neg'
    : days >= CHASE_DAYS ? 'bg-warn-soft text-warn'
      : 'bg-soft text-muted';

const ageLabel = (days: number): string =>
  days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`;

const DOC_STATUS: Record<string, { label: string; className: string }> = {
  waiting: { label: 'ממתין לחשבונית', className: 'text-warn' },
  documented: { label: 'חשבונית התקבלה', className: 'text-pos' },
  verified: { label: 'אומת ידנית', className: 'text-muted' },
  not_required: { label: 'לא נדרשת חשבונית', className: 'text-faint' },
};

type Filter = 'waiting' | 'all' | 'closed';

export function SupplierPaymentsTab({ isOwner, onError }: TabProps) {
  const [payments, setPayments] = useState<any[]>([]);
  const [queue, setQueue] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [filter, setFilter] = useState<Filter>('waiting');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payFor, setPayFor] = useState<any | null>(null);
  const [matching, setMatching] = useState(false);

  const load = () => {
    get('/moonlight/supplier-payments')
      .then((d) => { setPayments(d.payments); setQueue(d.queue); })
      .catch((e) => onError(e.message));
    get('/moonlight/suppliers').then((d) => setSuppliers(d.suppliers)).catch(() => {});
  };
  useEffect(load, []);

  const rows = useMemo(() => payments.filter((p) => (
    filter === 'all' ? true : filter === 'waiting' ? p.doc_status === 'waiting' : p.doc_status !== 'waiting'
  )), [payments, filter]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const act = async (fn: () => Promise<any>) => {
    onError('');
    try { await fn(); load(); } catch (e: any) { onError(e.message); }
  };

  const runMatch = async () => {
    setMatching(true);
    onError('');
    try {
      const d = await post('/moonlight/supplier-payments/match');
      setPayments(d.payments);
      setQueue(d.queue);
      if (!d.linked) onError('לא נמצאו התאמות ודאיות חדשות — הצעות מופיעות מתחת לכל תשלום');
    } catch (e: any) { onError(e.message); }
    finally { setMatching(false); }
  };

  const waitingCount = payments.filter((p) => p.doc_status === 'waiting').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="תשלומים לספקים"
        sub="כל העברה והשורות שהיא סגרה — וכל מה שעדיין לא חזרה עליו חשבונית"
        actions={isOwner && (
          <>
            <span title="משווה הוצאות מ־Morning לתשלומים שממתינים לחשבונית">
              <Button variant="ghost" disabled={matching} onClick={runMatch}>
                {matching ? 'מתאים…' : 'התאמה מ־Morning'}
              </Button>
            </span>
            <Button onClick={() => setPayFor({ supplier_id: '' })}>+ תשלום לספק</Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          label="שולם וממתין לחשבונית"
          value={nis(queue?.total ?? 0)}
          sub={waitingCount ? `${waitingCount} תשלומים` : 'הכול מתועד'}
          accent={queue?.total ? 'text-neg' : 'text-pos'}
        />
        <StatCard
          label='מע"מ שטרם ניתן להשבה'
          value={nis(queue?.vat_at_risk ?? 0)}
          sub="הערכה לפי שיעור המע״מ העסקי"
        />
        <StatCard
          label="הממתין הוותיק ביותר"
          value={queue?.oldest_days ? `${queue.oldest_days} ימים` : '—'}
          sub={queue?.oldest_days >= LATE_DAYS ? 'שווה טלפון' : 'בטווח הסביר'}
          accent={queue?.oldest_days >= LATE_DAYS ? 'text-neg' : undefined}
        />
      </div>

      <p className="text-[13px] text-muted">
        תשלום שאין מולו מסמך אינו הוצאה מוכרת, והמע״מ שבתוכו אינו בר־השבה — ולכן הסכום כאן, ולא
        מספר השורות, הוא מה שקובע אם שווה לרדוף אחרי הניירת.
        שורות שאין להן ספק משובץ (אק״ום, שכר אולם, צמידים) לא מגיעות לרשימה: אין ממי לבקש.
      </p>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'waiting', label: `ממתין (${waitingCount})` },
          { value: 'closed', label: 'טופל' },
          { value: 'all', label: 'הכול' },
        ]}
      />

      <DataTable
        empty={filter === 'waiting' ? 'אין תשלומים שממתינים לחשבונית 🎉' : 'אין תשלומים רשומים'}
        rows={rows}
        rowKey={(p: any) => p.id}
        onRowClick={(p: any) => toggle(p.id)}
        isExpanded={(p: any) => expanded.has(p.id)}
        renderExpanded={(p: any) => (
          <PaymentDetail payment={p} isOwner={isOwner} act={act} />
        )}
        columns={[
          {
            key: 'supplier', header: 'ספק', mobile: 'title',
            sortValue: (p: any) => p.supplier_name,
            className: 'font-medium',
            render: (p: any) => p.supplier_name,
          },
          {
            key: 'date', header: 'תאריך תשלום', className: 'whitespace-nowrap',
            sortValue: (p: any) => p.date,
            render: (p: any) => p.date,
          },
          {
            key: 'shows', header: 'הופעות', sortValue: (p: any) => p.lines.length,
            render: (p: any) => `${p.lines.length}`,
          },
          {
            key: 'amount', header: 'סכום', className: 'whitespace-nowrap',
            sortValue: (p: any) => p.amount,
            render: (p: any) => <span className="num">{nis(p.amount)}</span>,
          },
          {
            key: 'missing', header: 'חסר תיעוד', className: 'whitespace-nowrap',
            sortValue: (p: any) => p.missing,
            render: (p: any) => (p.doc_status === 'waiting'
              ? <span className="num text-neg font-medium">{nis(p.missing)}</span>
              : <span className="text-faint">—</span>),
          },
          {
            key: 'status', header: 'סטטוס', sortValue: (p: any) => p.doc_status,
            render: (p: any) => {
              const status = DOC_STATUS[p.doc_status] ?? { label: p.doc_status, className: '' };
              return (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className={status.className}>{status.label}</span>
                  {p.doc_status === 'waiting' && (
                    <span className={`text-[11.5px] rounded-full px-2 py-0.5 ${ageStyle(p.age_days)}`}>
                      {ageLabel(p.age_days)}
                    </span>
                  )}
                  {p.suggestions?.length > 0 && (
                    <span className="text-[11.5px] text-accent">· {p.suggestions.length} הצעות</span>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      <PaySupplierModal
        open={!!payFor}
        suppliers={suppliers}
        initialSupplierId={payFor?.supplier_id || ''}
        onClose={() => setPayFor(null)}
        onSaved={() => { setPayFor(null); load(); }}
        onError={onError}
      />
    </div>
  );
}

/** One payment opened up: what it settled, what answers for it, and what to do about it. */
function PaymentDetail({ payment, isOwner, act }: {
  payment: any;
  isOwner: boolean;
  act: (fn: () => Promise<any>) => Promise<void>;
}) {
  const waiting = payment.doc_status === 'waiting';
  return (
    <div className="grid md:grid-cols-2 gap-5 py-1">
      <div className="space-y-2">
        <div className="text-[13px] text-muted">שורות שנסגרו בתשלום הזה</div>
        {payment.lines.map((line: any) => (
          <Link
            key={`${line.event_id}-${line.role}`}
            to={showHref(line.event_id)}
            className="flex items-center justify-between text-sm border-b border-line pb-1.5 last:border-0 hover:bg-soft rounded px-1 -mx-1"
          >
            <div>
              <div className="font-medium">{line.venue}</div>
              <div className="text-xs text-faint">{line.date} · {roleName(line.role)}</div>
            </div>
            <span className="num">{nis(line.amount)}</span>
          </Link>
        ))}
        <div className="flex items-center justify-between pt-1 font-bold text-sm">
          <span>סה״כ הועבר</span>
          <span className="num">{nisExact(payment.amount)}</span>
        </div>
        {payment.notes && <p className="text-xs text-faint">{payment.notes}</p>}
      </div>

      <div className="space-y-3">
        <div className="text-[13px] text-muted">מסמכים מ־Morning</div>
        {payment.docs.length === 0 && (
          <div className="text-sm text-faint">עדיין לא שויך מסמך.</div>
        )}
        {payment.docs.map((doc: any) => (
          <div key={doc.id} className="flex items-center justify-between gap-2 text-sm border-b border-line pb-1.5 last:border-0">
            <div className="min-w-0">
              <div className="truncate">{doc.supplier_name} · {doc.number || 'ללא מספר'}</div>
              <div className="text-xs text-faint">
                {doc.date} · מכסה {nis(doc.allocated_amount)}
                {doc.matched_by === 'auto' && ' · שויך אוטומטית'}
              </div>
            </div>
            {isOwner && (
              <button
                className="text-xs text-neg hover:underline shrink-0"
                onClick={() => act(() => del(`/moonlight/supplier-payments/${payment.id}/docs/${doc.id}`))}
              >
                ניתוק
              </button>
            )}
          </div>
        ))}

        {waiting && payment.suggestions?.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-[13px] text-muted">
              הצעות — הוצאות מ־Morning של אותו ספק בטווח התאריכים
            </div>
            {payment.suggestions.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-sm bg-soft rounded-lg px-2.5 py-2">
                <div className="min-w-0">
                  <div className="truncate">
                    {s.supplier_name} · <span className="num">{nisExact(s.total)}</span>
                    {s.exact && <span className="text-pos text-xs"> · סכום מדויק</span>}
                  </div>
                  <div className="text-xs text-faint">{s.date} · {s.number || 'ללא מספר'}</div>
                </div>
                {isOwner && (
                  <Button
                    variant="ghost"
                    onClick={() => act(() => post(`/moonlight/supplier-payments/${payment.id}/docs`, { expense_id: s.id }))}
                  >
                    זו החשבונית
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {isOwner && (
          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            {waiting && (
              <button
                className="text-muted hover:underline"
                title="לסגירת תשלום שלעולם לא תגיע עליו חשבונית — אק״ום, קבלה שכבר קיימת ב־Morning בשם אחר"
                onClick={() => act(() => post(`/moonlight/supplier-payments/${payment.id}/resolve`, { resolution: 'not_required' }))}
              >
                לא נדרשת חשבונית
              </button>
            )}
            {!waiting && payment.doc_status !== 'documented' && (
              <button
                className="text-accent hover:underline"
                onClick={() => act(() => post(`/moonlight/supplier-payments/${payment.id}/resolve`, {}))}
              >
                החזרה להמתנה
              </button>
            )}
            <button
              className="text-neg hover:underline"
              title="מחיקת התשלום מחזירה את השורות שלו למצב «פתוח»"
              onClick={() => {
                if (!confirm('למחוק את התשלום? השורות שהוא סגר יחזרו להיות חוב פתוח.')) return;
                act(() => del(`/moonlight/supplier-payments/${payment.id}`));
              }}
            >
              מחיקת תשלום
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Recording one transfer: a supplier, then the shows it covers.
 *
 * The total is the sum of the lines ticked and is never typed. The fees differ from show to
 * show, and a figure entered by hand could only ever disagree with the lines it claims to
 * cover — at which point nobody could tell which of the two was the payment.
 */
export function PaySupplierModal({ open, suppliers, initialSupplierId, onClose, onSaved, onError }: {
  open: boolean;
  suppliers: any[];
  initialSupplierId?: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [supplierId, setSupplierId] = useState(initialSupplierId || '');
  const [lines, setLines] = useState<any[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierId(initialSupplierId || '');
    setDate(new Date().toISOString().slice(0, 10));
    setMethod('');
    setNotes('');
  }, [open, initialSupplierId]);

  useEffect(() => {
    if (!open || !supplierId) { setLines([]); setPicked(new Set()); return; }
    get(`/moonlight/suppliers/${supplierId}/open-lines`)
      .then((d) => {
        setLines(d.lines);
        // Shows already played are pre-ticked; a fee sitting on next month's gig is money the
        // band will owe rather than money it owes, so paying it is a deliberate extra click.
        setPicked(new Set(d.lines.filter((l: any) => !l.upcoming).map((l: any) => `${l.event_id}:${l.role}`)));
      })
      .catch((e) => onError(e.message));
  }, [open, supplierId]);

  const toggle = (key: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const total = lines
    .filter((l) => picked.has(`${l.event_id}:${l.role}`))
    .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosen = lines.filter((l) => picked.has(`${l.event_id}:${l.role}`));
    if (!chosen.length) return onError('לא נבחרו שורות לתשלום');
    setSaving(true);
    onError('');
    try {
      await post('/moonlight/supplier-payments', {
        supplier_id: supplierId, date, method: method || null, notes: notes || null,
        lines: chosen.map((l) => ({ event_id: l.event_id, role: l.role })),
      });
      onSaved();
    } catch (err: any) { onError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="תשלום לספק" open={open} onClose={onClose} size="lg">
      <form onSubmit={save} className="space-y-4">
        <label className="block">
          <span className="block text-[13px] text-muted mb-1.5">ספק *</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={fieldClass}
            required
          >
            <option value="">בחרו ספק…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {roleName(s.role)}</option>
            ))}
          </select>
        </label>

        {supplierId && lines.length === 0 && (
          <p className="text-sm text-muted">אין לספק הזה שורות פתוחות.</p>
        )}

        {lines.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[13px] text-muted">
              השורות שההעברה סוגרת — סמנו את כל ההופעות שאתם משלמים עליהן יחד
            </div>
            {lines.map((line) => {
              const key = `${line.event_id}:${line.role}`;
              return (
                <label
                  key={key}
                  className="flex items-center gap-3 text-sm border-b border-line pb-2 last:border-0 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={picked.has(key)}
                    onChange={() => toggle(key)}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium">{line.venue}</span>
                    <span className="text-xs text-faint block">
                      {line.date} · {roleName(line.role)}
                      {line.upcoming && ' · הופעה עתידית'}
                    </span>
                  </span>
                  <span className="num shrink-0">{nis(line.amount)}</span>
                </label>
              );
            })}
            <div className="flex items-center justify-between pt-2 font-bold">
              <span>סה״כ להעברה</span>
              <span className="num">{nisExact(total)}</span>
            </div>
            <p className="text-[12px] text-faint">
              הסכום הוא סכום השורות המסומנות בדיוק, ולכן אינו ניתן להקלדה.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input label="תאריך התשלום *" type="date" value={date} required
            onChange={(e) => setDate(e.target.value)} />
          <Input label="אמצעי תשלום" value={method} placeholder="העברה / מזומן / ביט"
            onChange={(e) => setMethod(e.target.value)} />
        </div>
        <Textarea label="הערות" value={notes} rows={2}
          onChange={(e) => setNotes(e.target.value)} />

        <Button type="submit" className="w-full" disabled={saving || !supplierId || total === 0}>
          {saving ? 'שומר…' : 'רישום התשלום'}
        </Button>
      </form>
    </Modal>
  );
}
