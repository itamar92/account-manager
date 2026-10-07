import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post, nis, nisExact } from '../../api';
import { SyncButton } from '../../SyncButton';
import {
  Button, DataTable, Input, Modal, PageHeader, SearchInput, Segmented, StatCard, Textarea,
  fieldClass,
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

/**
 * Why a document is being offered. Said on the row, because «של אותו ספק» and «אותו סכום, ספק
 * לא מזוהה» are two very different things to be asked to confirm — and only the second one
 * needs the person to look at the invoice itself before pressing anything.
 */
const SUGGESTION_REASON: Record<string, { label: string; className: string }> = {
  supplier: { label: 'מזוהה כשלו', className: 'text-pos' },
  amount: { label: 'סכום זהה · לא מזוהה למי שייך', className: 'text-warn' },
  similar: { label: 'שם דומה', className: 'text-muted' },
};

type Filter = 'waiting' | 'all' | 'closed';

export function SupplierPaymentsTab({ isOwner, onError, onNotice }: TabProps) {
  const [payments, setPayments] = useState<any[]>([]);
  const [queue, setQueue] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [filter, setFilter] = useState<Filter>('waiting');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payFor, setPayFor] = useState<any | null>(null);
  const [pickFor, setPickFor] = useState<any | null>(null);
  const [matching, setMatching] = useState(false);

  const load = () => {
    get('/band/supplier-payments')
      .then((d) => { setPayments(d.payments); setQueue(d.queue); })
      .catch((e) => onError(e.message));
    get('/band/suppliers').then((d) => setSuppliers(d.suppliers)).catch(() => {});
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
      const d = await post('/band/supplier-payments/match');
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
        title="תשלומים לספקים ולחברים"
        sub="כל העברה והשורות שהיא סגרה — וכל מה שעדיין לא חזרה עליו חשבונית"
        actions={isOwner && (
          <>
            {/* The pull first, then the match: a document that has not arrived cannot answer
                for anything. The pull runs the match on its own once it lands. */}
            <SyncButton service="morning" onError={onError} onDone={onNotice} reload={load} />
            <span title="משווה הוצאות מ־Morning לתשלומים שממתינים לחשבונית">
              <Button variant="ghost" disabled={matching} onClick={runMatch}>
                {matching ? 'מתאים…' : 'התאמה מ־Morning'}
              </Button>
            </span>
            <Button onClick={() => setPayFor({ supplier_id: '' })}>+ תשלום</Button>
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
        שורות שאין להן ספק משובץ לא מגיעות לרשימה — אין ממי לבקש; כדי שיגיעו, הגדירו למי משלמים
        אותן בסוגי הספקים. גם חלקי החברים כאן: חבר שהוא עוסק חייב חשבונית על חלקו, וחבר שאינו
        רשום מסומן כמי שלא תגיע ממנו.
        פתיחת שורה מציגה את ההצעות, ואפשר תמיד לבחור חשבונית ידנית — גם כזו שהמערכת לא קישרה
        לספק. כדי שלא תצטרכו לעשות זאת פעמיים לאותו ספק, רשמו את השם שעל החשבונית שלו
        ב<Link to="/band/supplierNames" className="text-accent hover:underline">שמות בחשבוניות</Link>.
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
          <PaymentDetail payment={p} isOwner={isOwner} act={act} onPick={() => setPickFor(p)} />
        )}
        columns={[
          {
            key: 'supplier', header: 'מקבל התשלום', mobile: 'title',
            sortValue: (p: any) => p.supplier_name,
            className: 'font-medium',
            render: (p: any) => (
              <span className="flex items-center gap-2 whitespace-nowrap">
                {p.supplier_name}
                {p.payee_kind === 'member' && (
                  <span className="bg-accent-soft text-accent-ink text-[11.5px] font-semibold px-2 py-0.5 rounded-full">
                    חבר
                  </span>
                )}
              </span>
            ),
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

      <PickDocumentModal
        payment={pickFor}
        onClose={() => setPickFor(null)}
        onSaved={() => { setPickFor(null); load(); }}
        onError={onError}
      />
    </div>
  );
}

/** One payment opened up: what it settled, what answers for it, and what to do about it. */
function PaymentDetail({ payment, isOwner, act, onPick }: {
  payment: any;
  isOwner: boolean;
  act: (fn: () => Promise<any>) => Promise<void>;
  onPick: () => void;
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
              <div className="text-xs text-faint">{line.date} · {line.label}</div>
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
                {doc.date} · מכסה {nis(doc.allocated_amount)} מתוך {nis(doc.total)}
                {doc.matched_by === 'auto' && ' · שויך אוטומטית'}
                {/* An invoice that covered two gigs is not spent when it answers for one of
                    them, and the screen has to say so or the rest of it looks gone. */}
                {doc.remaining > 0.5 && (
                  <span className="text-accent"> · נותרו {nis(doc.remaining)} לשיוך לתשלום אחר</span>
                )}
              </div>
            </div>
            {isOwner && (
              <button
                className="text-xs text-neg hover:underline shrink-0"
                onClick={() => act(() => del(`/band/supplier-payments/${payment.id}/docs/${doc.id}`))}
              >
                ניתוק
              </button>
            )}
          </div>
        ))}

        {waiting && payment.suggestions?.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-[13px] text-muted">
              הצעות — מסמכים מ־Morning בטווח התאריכים של ההעברה
            </div>
            {payment.suggestions.map((s: any) => {
              const reason = SUGGESTION_REASON[s.reason] ?? { label: '', className: '' };
              return (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm bg-soft rounded-lg px-2.5 py-2">
                  <div className="min-w-0">
                    <div className="truncate">
                      {s.supplier_name} · <span className="num">{nisExact(s.available)}</span>
                      {s.exact && <span className="text-pos text-xs"> · סכום מדויק</span>}
                    </div>
                    <div className="text-xs text-faint">
                      {s.date} · {s.number || 'ללא מספר'}
                      {reason.label && <> · <span className={reason.className}>{reason.label}</span></>}
                    </div>
                  </div>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      onClick={() => act(() => post(`/band/supplier-payments/${payment.id}/docs`, {
                        expense_id: s.id,
                        // A document the app could not place is one it will fail to place again
                        // next month, so confirming it here is also where the name is learned.
                        remember_alias: !s.alias_known,
                      }))}
                    >
                      זו החשבונית
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Offered whether or not anything was suggested — the case this exists for is the one
            where nothing was, and a screen that only offers what it already guessed leaves the
            person with a red row and no way to close it. */}
        {isOwner && waiting && (
          <button className="text-sm text-accent hover:underline" onClick={onPick}>
            {payment.suggestions?.length ? 'בחירת חשבונית אחרת…' : 'בחירת חשבונית ידנית…'}
          </button>
        )}

        {isOwner && (
          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            {waiting && (
              <button
                className="text-muted hover:underline"
                title="לסגירת תשלום שלעולם לא תגיע עליו חשבונית — אק״ום, קבלה שכבר קיימת ב־Morning בשם אחר"
                onClick={() => act(() => post(`/band/supplier-payments/${payment.id}/resolve`, { resolution: 'not_required' }))}
              >
                לא נדרשת חשבונית
              </button>
            )}
            {!waiting && payment.doc_status !== 'documented' && (
              <button
                className="text-accent hover:underline"
                onClick={() => act(() => post(`/band/supplier-payments/${payment.id}/resolve`, {}))}
              >
                החזרה להמתנה
              </button>
            )}
            <button
              className="text-neg hover:underline"
              title="מחיקת התשלום מחזירה את השורות שלו למצב «פתוח»"
              onClick={() => {
                if (!confirm('למחוק את התשלום? השורות שהוא סגר יחזרו להיות חוב פתוח.')) return;
                act(() => del(`/band/supplier-payments/${payment.id}`));
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
 * Picking the invoice for a payment by hand — the way out of every case a rule cannot reach.
 *
 * The rules are good at the ordinary shape: same supplier, same money, same fortnight. What
 * they cannot do is know that «א. כהן הפקות בע"מ» is אבי, that the invoice was issued in
 * October for a July gig, or that one document covers two transfers. The person looking at the
 * payment knows all three, so this offers everything Morning holds that still has value to
 * give, searchable by name, by document number and by amount, and lets them say which it is.
 *
 * The checkbox is what stops it being a chore repeated monthly: confirming an invoice also
 * records the name it arrived under, and from then on that supplier's documents match on their
 * own — which is the whole difference between a manual escape hatch and a system that learns.
 */
function PickDocumentModal({ payment, onClose, onSaved, onError }: {
  payment: any | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);
  const [linking, setLinking] = useState('');

  useEffect(() => {
    if (!payment) { setQuery(''); setDocs([]); setRemember(true); }
  }, [payment?.id]);

  useEffect(() => {
    if (!payment) return;
    setLoading(true);
    // Typing is a filter over the same list, so each keystroke waits a moment for the next one
    // rather than sending a request nobody will read.
    const timer = setTimeout(() => {
      get(`/band/supplier-payments/${payment.id}/documents?q=${encodeURIComponent(query)}`)
        .then((d) => setDocs(d.documents))
        .catch((e) => onError(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [payment?.id, query]);

  const link = async (doc: any) => {
    setLinking(doc.id);
    onError('');
    try {
      const d = await post(`/band/supplier-payments/${payment.id}/docs`, {
        expense_id: doc.id,
        remember_alias: remember && !doc.alias_known,
      });
      // The link stands either way; a name that could not be recorded is said out loud rather
      // than left to look as though it had been.
      if (d.alias?.error) onError(d.alias.error);
      onSaved();
    } catch (err: any) { onError(err.message); }
    finally { setLinking(''); }
  };

  return (
    <Modal
      title={payment ? `בחירת חשבונית — ${payment.supplier_name}` : ''}
      open={!!payment}
      onClose={onClose}
      size="lg"
    >
      {payment && (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">
            ההעברה מ־{payment.date} על <span className="num">{nisExact(payment.amount)}</span>, חסר
            תיעוד <span className="num text-neg">{nisExact(payment.missing)}</span>. חפשו לפי שם,
            מספר מסמך או סכום — הרשימה כוללת כל מסמך שנותר בו סכום לשייך, גם כזה שהמערכת לא זיהתה
            למי הוא שייך.
          </p>

          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="שם על החשבונית / מספר מסמך / סכום"
          />

          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              className="accent-accent mt-0.5"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              לזכור שהשם על החשבונית שייך ל«{payment.supplier_name}»
              <span className="block text-[12px] text-faint">
                כך המסמך הבא שיגיע באותו שם ישויך לבד, בלי לחפש אותו שוב.
              </span>
            </span>
          </label>

          {loading && <div className="text-sm text-faint">מחפש…</div>}
          {!loading && docs.length === 0 && (
            <div className="text-sm text-faint">
              אין מסמכים מתאימים. אם החשבונית עדיין לא נמשכה מ־Morning, סנכרנו אותה ונסו שוב.
            </div>
          )}

          <div className="space-y-1.5 max-h-[45vh] overflow-y-auto">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-2 text-sm bg-soft rounded-lg px-2.5 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate">
                    {doc.supplier_name || 'ללא שם'} · <span className="num">{nisExact(doc.available)}</span>
                    {doc.available !== doc.total && (
                      <span className="text-xs text-faint"> (מתוך {nisExact(doc.total)})</span>
                    )}
                  </div>
                  <div className="text-xs text-faint truncate">
                    {doc.date} · {doc.number || 'ללא מספר'}
                    {doc.exact && <span className="text-pos"> · סכום זהה לחסר</span>}
                    {doc.mine && <span className="text-pos"> · מזוהה כספק הזה</span>}
                    {!doc.mine && doc.resolved_supplier_name && (
                      <span className="text-warn"> · מזוהה כרגע כ«{doc.resolved_supplier_name}»</span>
                    )}
                  </div>
                </div>
                <Button variant="ghost" disabled={!!linking} onClick={() => link(doc)}>
                  {linking === doc.id ? 'משייך…' : 'זו החשבונית'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Recording one transfer: who was paid, then the shows it covers.
 *
 * The payee is a supplier or a member of the band, because both are people the band pays for a
 * show and both owe it a document back. A member's line is their share of the show; a
 * supplier's is the cost line they are staffed on.
 *
 * The total is the sum of the lines ticked and is never typed. The fees differ from show to
 * show, and a figure entered by hand could only ever disagree with the lines it claims to
 * cover — at which point nobody could tell which of the two was the payment.
 */
export function PaySupplierModal({ open, suppliers, initialSupplierId, onClose, onSaved, onError }: {
  open: boolean;
  /** Ignored when the payee list loads; kept so callers can pass what they already have. */
  suppliers?: any[];
  initialSupplierId?: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [payees, setPayees] = useState<any[]>([]);
  const [payeeKey, setPayeeKey] = useState('');
  const [lines, setLines] = useState<any[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const lineKey = (line: any) => `${line.event_id}:${line.role || 'share'}`;

  useEffect(() => {
    if (!open) return;
    setPayeeKey(initialSupplierId ? `s:${initialSupplierId}` : '');
    setDate(new Date().toISOString().slice(0, 10));
    setMethod('');
    setNotes('');
    get('/band/payees').then((d) => setPayees(d.payees)).catch((e) => onError(e.message));
  }, [open, initialSupplierId]);

  useEffect(() => {
    if (!open || !payeeKey) { setLines([]); setPicked(new Set()); return; }
    const [kind, id] = [payeeKey.startsWith('m:') ? 'member' : 'supplier', payeeKey.slice(2)];
    get(`/band/payees/${kind}/${encodeURIComponent(id)}/open-lines`)
      .then((d) => {
        setLines(d.lines);
        // Shows already played are pre-ticked; a fee sitting on next month's gig is money the
        // band will owe rather than money it owes, so paying it is a deliberate extra click.
        setPicked(new Set(d.lines.filter((l: any) => !l.upcoming).map(lineKey)));
      })
      .catch((e) => onError(e.message));
  }, [open, payeeKey]);

  const toggle = (key: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const chosen = lines.filter((l) => picked.has(lineKey(l)));
  const total = chosen.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const payee = payees.find((p) => p.key === payeeKey);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen.length) return onError('לא נבחרו שורות לתשלום');
    setSaving(true);
    onError('');
    try {
      await post('/band/supplier-payments', {
        payee_kind: payee?.kind, payee_id: payee?.id,
        date, method: method || null, notes: notes || null,
        lines: chosen.map((l) => ({ event_id: l.event_id, role: l.role })),
      });
      onSaved();
    } catch (err: any) { onError(err.message); }
    finally { setSaving(false); }
  };

  const suppliersList = payees.filter((p) => p.kind === 'supplier');
  const membersList = payees.filter((p) => p.kind === 'member' && p.active);

  return (
    <Modal title="תשלום" open={open} onClose={onClose} size="lg">
      <form onSubmit={save} className="space-y-4">
        <label className="block">
          <span className="block text-[13px] text-muted mb-1.5">למי משלמים *</span>
          <select
            value={payeeKey}
            onChange={(e) => setPayeeKey(e.target.value)}
            className={fieldClass}
            required
          >
            <option value="">בחרו…</option>
            <optgroup label="ספקים">
              {suppliersList.map((p) => (
                <option key={p.key} value={p.key}>{p.name} — {p.role_name || roleName(p.role)}</option>
              ))}
            </optgroup>
            {/* Members are here because a share is a payment like any other, and the invoice
                owed back for it is the band's deduction. */}
            <optgroup label="חברי הלהקה">
              {membersList.map((p) => (
                <option key={p.key} value={p.key}>{p.name} — חלוקת רווח</option>
              ))}
            </optgroup>
          </select>
        </label>

        {payee?.kind === 'member' && !payee.expects_invoice && (
          <p className="text-[13px] bg-soft text-muted rounded-xl px-3 py-2">
            {payee.name} רשום כ«לא רשום» — התשלום יירשם, אך לא תיווצר עליו המתנה לחשבונית, כי
            אין חשבונית שאפשר לקזז.
          </p>
        )}

        {payeeKey && lines.length === 0 && (
          <p className="text-sm text-muted">אין שורות פתוחות.</p>
        )}

        {lines.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[13px] text-muted">
              השורות שההעברה סוגרת — סמנו את כל ההופעות שאתם משלמים עליהן יחד
            </div>
            {lines.map((line) => {
              const key = lineKey(line);
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
                      {line.date} · {line.label}
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

        <Button type="submit" className="w-full" disabled={saving || !payeeKey || total === 0}>
          {saving ? 'שומר…' : 'רישום התשלום'}
        </Button>
      </form>
    </Modal>
  );
}
