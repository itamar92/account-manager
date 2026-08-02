import React, { useEffect, useState } from 'react';
import { get, post, nisExact } from '../api';
import { Button, Input, Modal, Textarea } from '../ui';

interface DraftLine {
  id: string;
  date: string;
  description: string;
  amount: number;
  vatAmount: number;
  total: number;
}

interface Business {
  name: string;
  type: string;
  typeLabel: string;
  taxId: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  logoUrl: string;
  configured: boolean;
}

interface Draft {
  invoiceId: string;
  number: string;
  configured: boolean;
  business: Business;
  docType: number;
  docTypes: Array<{ value: number; label: string }>;
  date: string;
  dueDate: string;
  paymentTermsDays: number;
  description: string;
  remarks: string;
  client: { id: string; name: string; email: string; taxId: string; phone: string };
  lines: DraftLine[];
  subtotal: number;
  vatAmount: number;
  total: number;
  vatPercent: number;
}

interface Form {
  doc_type: number;
  date: string;
  due_date: string;
  description: string;
  remarks: string;
  client_email: string;
  send_email: boolean;
}

/**
 * "שוטף + N" — mirrors `computeDueDate` on the server so the field can follow the document
 * date as it is edited, instead of waiting for a round trip.
 */
function computeDueDate(date: string, termsDays: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return date;
  const endOfMonth = Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0);
  return new Date(endOfMonth + Math.max(0, termsDays) * 86400_000).toISOString().slice(0, 10);
}

const he = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('he-IL', { timeZone: 'UTC' });
};

/**
 * The two steps between "הנפקה ב-Morning" and a real document: the document's own fields,
 * then a preview of what issuing them will produce. Nothing reaches Morning until the
 * final button on the preview.
 */
export function MorningIssueModal({ invoiceId, open, onClose, onIssued }: {
  invoiceId: string | null;
  open: boolean;
  onClose: () => void;
  onIssued: (invoice: any, result: any) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [dueTouched, setDueTouched] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !invoiceId) return;
    setDraft(null);
    setForm(null);
    setStep('form');
    setDueTouched(false);
    setError('');
    get(`/invoices/${invoiceId}/morning-draft`)
      .then((d) => {
        const dr: Draft = d.draft;
        setDraft(dr);
        setForm({
          doc_type: dr.docType,
          date: dr.date,
          due_date: dr.dueDate,
          description: dr.description,
          remarks: dr.remarks,
          client_email: dr.client.email,
          send_email: false,
        });
      })
      .catch((e) => setError(e.message));
  }, [open, invoiceId]);

  if (!open) return null;

  const setField = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  /** The due date trails the document date until it is set by hand. */
  const setDate = (date: string) =>
    setForm((f) =>
      f ? { ...f, date, due_date: dueTouched ? f.due_date : computeDueDate(date, draft?.paymentTermsDays ?? 30) } : f
    );

  const issue = async () => {
    if (!invoiceId || !form) return;
    setSending(true);
    setError('');
    try {
      const d = await post(`/invoices/${invoiceId}/push-to-morning`, form);
      onIssued(d.invoice, d.result);
    } catch (err: any) {
      setError(err.message);
      setStep('form');
    } finally {
      setSending(false);
    }
  };

  const docTypeLabel = draft?.docTypes.find((t) => t.value === form?.doc_type)?.label || '';

  return (
    <Modal
      title={step === 'form' ? 'הנפקת מסמך ב-Morning' : 'תצוגה מקדימה — לפני הנפקה'}
      open={open}
      onClose={onClose}
      size={step === 'form' ? 'lg' : 'xl'}
    >
      {error && <div className="text-sm text-rose-400 mb-3">{error}</div>}
      {!draft || !form ? (
        <div className="text-center text-slate-500 py-10">טוען…</div>
      ) : step === 'form' ? (
        <IssueForm
          draft={draft}
          form={form}
          setField={setField}
          setDate={setDate}
          onDueChange={(v) => { setDueTouched(true); setField('due_date', v); }}
          onResetDue={() => { setDueTouched(false); setField('due_date', computeDueDate(form.date, draft.paymentTermsDays)); }}
          onContinue={() => { setError(''); setStep('preview'); }}
        />
      ) : (
        <div className="space-y-4">
          <DocumentPreview draft={draft} form={form} docTypeLabel={docTypeLabel} />
          {!draft.configured && (
            <div className="text-sm text-amber-400">
              Morning לא מוגדר — חסרים GREEN_INVOICE_ID / GREEN_INVOICE_SECRET
            </div>
          )}
          <p className="text-xs text-slate-500">
            הנפקה יוצרת מסמך אמיתי ב-Morning עם מספר רץ. אי אפשר למחוק מסמך שהונפק — רק להוציא לו זיכוי.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep('form')} disabled={sending}>חזרה לעריכה</Button>
            <Button onClick={issue} disabled={sending || !draft.configured} className="flex-1">
              {sending ? 'מנפיק…' : `הנפקת ${docTypeLabel} ב-Morning`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The document's fields, in the order they sit on the document itself. */
function IssueForm({ draft, form, setField, setDate, onDueChange, onResetDue, onContinue }: {
  draft: Draft;
  form: Form;
  setField: <K extends keyof Form>(key: K, value: Form[K]) => void;
  setDate: (date: string) => void;
  onDueChange: (value: string) => void;
  onResetDue: () => void;
  onContinue: () => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => { e.preventDefault(); onContinue(); }}
    >
      <label className="block">
        <span className="block text-sm text-slate-400 mb-1">סוג מסמך *</span>
        <select
          value={form.doc_type}
          onChange={(e) => setField('doc_type', parseInt(e.target.value, 10))}
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm"
        >
          {draft.docTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>

      <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3 space-y-3">
        <div>
          <div className="text-sm text-slate-400 mb-1">לקוח</div>
          <div className="font-medium">{draft.client.name}</div>
          <div className="text-xs text-slate-500">
            {draft.client.taxId ? <span dir="ltr">ח.פ / ע.מ {draft.client.taxId}</span> : 'ללא ח.פ / ע.מ בכרטיס הלקוח'}
          </div>
        </div>
        <Input
          label="מייל הלקוח" type="email" dir="ltr" placeholder="client@example.com"
          value={form.client_email}
          onChange={(e) => setField('client_email', e.target.value)}
        />
        {!draft.client.email && form.client_email && (
          <p className="text-xs text-slate-500">המייל יישמר גם בכרטיס הלקוח למסמכים הבאים.</p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Input label="תאריך המסמך *" type="date" value={form.date} onChange={(e) => setDate(e.target.value)} required />
        <div>
          <Input label="לתשלום עד *" type="date" value={form.due_date} onChange={(e) => onDueChange(e.target.value)} required />
          <button type="button" onClick={onResetDue} className="text-xs text-indigo-400 hover:underline mt-1">
            איפוס לשוטף + {draft.paymentTermsDays}
          </button>
        </div>
      </div>

      <Input
        label="שם המסמך (פרטים) *"
        value={form.description}
        onChange={(e) => setField('description', e.target.value)}
        placeholder="מה מופיע בראש המסמך"
        required
      />

      <div>
        <div className="text-sm text-slate-400 mb-1">שורות המסמך ({draft.lines.length})</div>
        <div className="border border-slate-800 rounded-xl divide-y divide-slate-800 max-h-48 overflow-y-auto">
          {draft.lines.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate">{l.description}</div>
                <div className="text-xs text-slate-500">{he(l.date)}</div>
              </div>
              <span className="whitespace-nowrap" dir="ltr">{nisExact(l.amount)}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          לשינוי השורות יש לבטל את החשבונית ולבחור את העבודות מחדש.
        </p>
      </div>

      <Textarea
        label="הערות שיופיעו במסמך"
        value={form.remarks}
        onChange={(e) => setField('remarks', e.target.value)}
        placeholder="לדוגמה: פרטי חשבון להעברה בנקאית"
      />

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox" className="w-4 h-4 accent-indigo-500"
          checked={form.send_email}
          disabled={!form.client_email}
          onChange={(e) => setField('send_email', e.target.checked)}
        />
        <span>
          שליחת המסמך במייל ללקוח עם ההנפקה
          {!form.client_email && <span className="text-slate-500"> (דורש מייל לקוח)</span>}
        </span>
      </label>

      <Button type="submit" className="w-full">תצוגה מקדימה ←</Button>
    </form>
  );
}

/**
 * Who is issuing the document. Filled in from Settings → פרטי העסק; until that is filled
 * in, the preview says so rather than leaving the top of the page unexplained.
 */
function Letterhead({ business }: { business: Business }) {
  if (!business.configured) {
    return (
      <div className="text-[11px] text-slate-400 border-b border-dashed border-slate-300 pb-2 mb-4">
        פרטי העסק לא הוגדרו — אפשר למלא אותם בהגדרות ← פרטי העסק כדי שהכותרת תופיע גם כאן.
      </div>
    );
  }
  const line = [business.typeLabel, business.taxId].filter(Boolean).join(' ');
  const address = [business.address, business.city].filter(Boolean).join(', ');
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap border-b border-slate-200 pb-4 mb-4">
      <div className="flex items-center gap-3 min-w-0">
        {business.logoUrl && (
          <img src={business.logoUrl} alt="" className="h-12 w-auto max-w-[120px] object-contain shrink-0" />
        )}
        <div className="min-w-0">
          <div className="font-bold text-lg leading-tight">{business.name}</div>
          {line && <div className="text-xs text-slate-500" dir="ltr">{line}</div>}
        </div>
      </div>
      <div className="text-xs text-slate-500 text-left space-y-0.5">
        {address && <div>{address}</div>}
        {business.phone && <div dir="ltr">{business.phone}</div>}
        {business.email && <div dir="ltr">{business.email}</div>}
        {business.website && <div dir="ltr">{business.website}</div>}
      </div>
    </div>
  );
}

/** What the issued document will look like. Rendered light, like the document itself. */
function DocumentPreview({ draft, form, docTypeLabel }: { draft: Draft; form: Form; docTypeLabel: string }) {
  return (
    <div className="bg-white text-slate-900 rounded-xl p-5 md:p-7 shadow-lg" dir="rtl">
      <Letterhead business={draft.business} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-xl font-bold">{docTypeLabel}</h3>
          <div className="text-xs text-slate-500 mt-0.5">מספר המסמך יוקצה על ידי Morning בהנפקה</div>
        </div>
        <div className="text-sm text-left">
          <div><span className="text-slate-500">תאריך: </span>{he(form.date)}</div>
          <div><span className="text-slate-500">לתשלום עד: </span>{he(form.due_date)}</div>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-slate-200">
        <div className="text-xs text-slate-500">לכבוד</div>
        <div className="font-semibold">{draft.client.name}</div>
        {draft.client.taxId && <div className="text-sm text-slate-600" dir="ltr">ח.פ / ע.מ {draft.client.taxId}</div>}
        {form.client_email && <div className="text-sm text-slate-600" dir="ltr">{form.client_email}</div>}
        {draft.client.phone && <div className="text-sm text-slate-600" dir="ltr">{draft.client.phone}</div>}
      </div>

      {form.description && (
        <div className="mt-4 text-sm">
          <span className="text-slate-500">הנדון: </span>
          <span className="font-medium">{form.description}</span>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-right">
              <th className="px-3 py-2 font-medium">תיאור</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">תאריך</th>
              <th className="px-3 py-2 font-medium">כמות</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">מחיר</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">סה"כ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {draft.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2">{l.description}</td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">{he(l.date)}</td>
                <td className="px-3 py-2">1</td>
                <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{nisExact(l.amount)}</td>
                <td className="px-3 py-2 whitespace-nowrap" dir="ltr">{nisExact(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-start">
        <div className="w-full md:w-64 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">סה"כ לפני מע"מ</span>
            <span dir="ltr">{nisExact(draft.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">מע"מ {draft.vatPercent}%</span>
            <span dir="ltr">{nisExact(draft.vatAmount)}</span>
          </div>
          <div className="flex justify-between font-bold text-base border-t border-slate-300 pt-1">
            <span>סה"כ לתשלום</span>
            <span dir="ltr">{nisExact(draft.total)}</span>
          </div>
        </div>
      </div>

      {form.remarks && (
        <div className="mt-5 pt-3 border-t border-slate-200 text-sm whitespace-pre-line">
          <div className="text-xs text-slate-500 mb-1">הערות</div>
          {form.remarks}
        </div>
      )}

      <div className="mt-5 text-[11px] text-slate-400 space-y-0.5">
        <div>
          {form.send_email && form.client_email
            ? <>המסמך יישלח במייל אל <span dir="ltr">{form.client_email}</span> עם ההנפקה.</>
            : 'המסמך לא יישלח במייל — אפשר לשלוח אותו מ-Morning בכל שלב.'}
        </div>
        <div>התוכן הוא מה שיישלח להנפקה; העיצוב הסופי נקבע לפי תבנית המסמכים ב-Morning.</div>
      </div>
    </div>
  );
}
