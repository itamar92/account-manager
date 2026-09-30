import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, X } from 'lucide-react';
import { del, get, post, put } from '../../api';
import { Button, Card, Empty, Input, Modal, MoneyInput, Segmented, Textarea, fieldClass } from '../../ui';
import { QuoteDocument } from '../../quotes/QuoteDocument';
import { QuoteStatusBadge } from './QuotesTab';
import { VAT_MODES } from './QuoteModals';
import {
  computeTotals, quoteDate, usePackages, useQuoteSettings,
  type Quote, type QuoteItem,
} from './quotes';

/** A line as the editor holds it: figures as typed, and a key that survives reordering. */
type EditLine = Omit<QuoteItem, 'quantity' | 'unit_price'> & { key: string; quantity: string; unit_price: string };

/** The fields the server accepts; the payload is built from these and nothing else. */
const FIELDS = [
  'template_name', 'client_name', 'client_phone', 'client_email', 'client_tax_id', 'event_type',
  'event_date', 'event_location', 'guest_count', 'title', 'intro', 'terms', 'valid_until',
  'contact_name', 'contact_phone', 'internal_note', 'prices_include_vat', 'discount',
] as const;

let lineSeq = 0;
const toLine = (item: Partial<QuoteItem>): EditLine => ({
  key: `l${++lineSeq}`,
  name: item.name ?? '',
  description: item.description ?? '',
  quantity: String(item.quantity ?? 1),
  unit_price: String(item.unit_price ?? ''),
  package_id: item.package_id ?? null,
});

const payloadOf = (form: Record<string, any>, lines: EditLine[]) => ({
  ...Object.fromEntries(FIELDS.map((f) => [f, form[f] ?? null])),
  items: lines.map(({ name, description, quantity, unit_price, package_id }) =>
    ({ name, description, quantity, unit_price, package_id })),
});

/** What a template's placeholders read as in its own preview, so the layout can be judged. */
const SAMPLE = { client_name: 'שם הלקוח', event_date: 'תאריך האירוע' };
const fillSample = (value: string | null) =>
  value?.replaceAll('{client_name}', SAMPLE.client_name).replaceAll('{event_date}', SAMPLE.event_date) ?? null;

/**
 * One quote — or one template — with the client's view of it beside the form.
 *
 * The preview is the same component the client will be shown, fed the same arithmetic the
 * server saves with, so nothing about the figures is a guess until the save.
 */
export function QuoteEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<Quote | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [templateName, setTemplateName] = useState<string | null>(null);
  const { data: settingsData } = useQuoteSettings(setError);
  const { packages } = usePackages(setError);

  const accept = (d: { quote: Quote; items: QuoteItem[] }) => {
    const nextLines = d.items.map(toLine);
    setForm(d.quote);
    setLines(nextLines);
    setSaved(JSON.stringify(payloadOf(d.quote, nextLines)));
  };

  useEffect(() => {
    setForm(null);
    setError('');
    get(`/moonlight/quotes/${id}`).then(accept).catch((e) => setError(e.message));
  }, [id]);

  const payload = form ? payloadOf(form, lines) : null;
  const dirty = !!payload && JSON.stringify(payload) !== saved;

  // Leaving the page with unsaved changes is the one way to lose a quote's worth of typing.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const totals = useMemo(() => computeTotals(
    lines.map((l) => ({ name: l.name, description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
    form?.discount, Number(form?.vat_percent) || 0, !!form?.prices_include_vat
  ), [lines, form?.discount, form?.vat_percent, form?.prices_include_vat]);

  if (!form) return error ? <Empty text={error} /> : <Empty text="טוען…" />;

  const isTemplate = !!form.is_template;
  const editable = isTemplate || ['draft', 'sent', 'viewed'].includes(form.status);
  const set = (patch: Partial<Quote>) => setForm({ ...form, ...patch });
  const setLine = (key: string, patch: Partial<EditLine>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const moveLine = (index: number, by: -1 | 1) => {
    const next = [...lines];
    const [line] = next.splice(index, 1);
    next.splice(index + by, 0, line);
    setLines(next);
  };

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      accept(await put(`/moonlight/quotes/${form.id}`, payload));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally { setBusy(false); }
  };

  /** Copies work from what is saved, so unsaved typing is saved first rather than left behind. */
  const saveFirst = async () => !dirty || !editable || save();

  const run = async (action: () => Promise<void>) => {
    setError('');
    try { await action(); } catch (err: any) { setError(err.message); }
  };

  const duplicate = () => run(async () => {
    if (!(await saveFirst())) return;
    navigate(`/moonlight/quotes/${(await post(`/moonlight/quotes/${form.id}/duplicate`)).quote.id}`);
  });

  const saveAsTemplate = (name: string) => run(async () => {
    if (!(await saveFirst())) return;
    const d = await post(`/moonlight/quotes/${form.id}/save-as-template`, { template_name: name });
    setTemplateName(null);
    navigate(`/moonlight/quotes/${d.quote.id}`);
  });

  const makeDefault = () => run(async () => {
    await put('/moonlight/quotes/settings', { default_template_id: form.id });
    set({ is_default: true });
  });

  const cancel = () => run(async () => {
    if (!confirm('לבטל את ההצעה? לא יהיה אפשר לערוך אותה אחר כך, רק לשכפל.')) return;
    accept(await post(`/moonlight/quotes/${form.id}/cancel`));
  });

  const remove = () => run(async () => {
    const what = isTemplate ? `את התבנית «${form.template_name}»` : `את ההצעה ${form.quote_number}`;
    if (!confirm(`למחוק ${what}?`)) return;
    await del(`/moonlight/quotes/${form.id}`);
    navigate('/moonlight/quotes');
  });

  const leave = (e: React.MouseEvent) => {
    if (dirty && !confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) e.preventDefault();
  };

  const addPackage = (packageId: string) => {
    const p = packages.find((x) => x.id === packageId);
    if (p) setLines([...lines, toLine({ name: p.name, description: p.description, quantity: 1, unit_price: p.unit_price, package_id: p.id })]);
  };

  const brandName = settingsData?.settings.brand_name || 'Moonlight';
  const eventTypes = settingsData?.event_types ?? [];
  const activePackages = packages.filter((p) => p.active);
  const deletable = isTemplate || form.status === 'draft' || form.status === 'cancelled';
  const title = isTemplate
    ? form.template_name || 'תבנית'
    : form.client_name || 'הצעה ללא שם לקוח';

  const preview = (
    <QuoteDocument
      brandName={brandName}
      totals={totals}
      quote={isTemplate
        ? { ...form, client_name: SAMPLE.client_name, title: fillSample(form.title) ?? '', intro: fillSample(form.intro) }
        : form}
    />
  );

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1 text-[13px] text-muted">
        <Link to="/moonlight/quotes" onClick={leave} className="hover:text-accent">הצעות מחיר</Link>
        <ChevronLeft size={14} className="text-ghost" />
        <span className="text-ink-2">{isTemplate ? 'תבנית' : form.quote_number}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="ser text-2xl md:text-3xl">{title}</h1>
            {isTemplate
              ? <span className="text-[12.5px] font-semibold bg-accent-soft text-accent-ink rounded-full px-2.5 py-1">
                  {form.is_default ? 'תבנית ברירת מחדל' : 'תבנית'}
                </span>
              : <QuoteStatusBadge status={form.display_status} />}
          </div>
          <p className="mt-1.5 text-[13px] text-muted">
            {form.created_by_name && <>נוצרה ע״י {form.created_by_name}</>}
            {form.updated_by_name && form.updated_by_name !== form.created_by_name && <> · עודכנה ע״י {form.updated_by_name}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isTemplate && !form.is_default && <Button variant="ghost" onClick={makeDefault}>הפיכה לברירת מחדל</Button>}
          <Button variant="ghost" onClick={duplicate}>שכפול</Button>
          {!isTemplate && <Button variant="ghost" onClick={() => setTemplateName(form.title || '')}>שמירה כתבנית</Button>}
          {!isTemplate && form.status !== 'signed' && form.status !== 'cancelled' && (
            <Button variant="ghost" onClick={cancel}>ביטול הצעה</Button>
          )}
          {deletable && <Button variant="ghost" onClick={remove}>מחיקה</Button>}
          {editable && (
            <Button onClick={save} disabled={!dirty || busy}>{busy ? 'שומר…' : dirty ? 'שמירה' : 'נשמר'}</Button>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}

      {!editable && (
        <div className="text-[13.5px] bg-soft border border-line rounded-xl px-4 py-2.5 text-ink-2">
          {form.status === 'signed'
            ? `ההצעה נחתמה${form.signer_name ? ` ע״י ${form.signer_name}` : ''} — היא נשמרת כפי שנחתמה. לשינוי, שכפלו אותה.`
            : 'ההצעה בוטלה. לשינוי, שכפלו אותה להצעה חדשה.'}
        </div>
      )}

      {isTemplate && (
        <p className="text-[13.5px] text-ink-2 bg-accent-soft rounded-xl px-4 py-2.5">
          זו תבנית: מה שכתוב כאן נכנס לכל הצעה שנוצרת ממנה. שם הלקוח, התאריך והמחיר נכתבים בכל הצעה
          מחדש — המחיר נכנס לשורה הראשונה.
        </p>
      )}

      <Segmented
        className="lg:hidden w-fit"
        value={view}
        onChange={setView}
        options={[{ value: 'edit', label: 'עריכה' }, { value: 'preview', label: 'תצוגה מקדימה' }]}
      />

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <fieldset disabled={!editable} className={`space-y-4 min-w-0 ${view === 'preview' ? 'hidden lg:block' : ''}`}>
          {isTemplate && (
            <Card>
              <Input label="שם התבנית" value={form.template_name ?? ''}
                onChange={(e) => set({ template_name: e.target.value })} />
            </Card>
          )}

          <Card className="space-y-3">
            <h2 className="font-semibold">{isTemplate ? 'אירוע' : 'לקוח ואירוע'}</h2>
            {!isTemplate && (
              <>
                <Input label="שם הלקוח" value={form.client_name}
                  onChange={(e) => set({ client_name: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="טלפון" type="tel" dir="ltr" value={form.client_phone ?? ''}
                    onChange={(e) => set({ client_phone: e.target.value })} />
                  <Input label="אימייל" type="email" dir="ltr" value={form.client_email ?? ''}
                    onChange={(e) => set({ client_email: e.target.value })} />
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[13px] text-muted mb-1.5">סוג אירוע</span>
                <select value={form.event_type ?? ''} className={fieldClass}
                  onChange={(e) => set({ event_type: e.target.value || null })}>
                  <option value="">—</option>
                  {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              {!isTemplate && (
                <Input label="תאריך האירוע" type="date" value={form.event_date ?? ''}
                  onChange={(e) => set({ event_date: e.target.value || null })} />
              )}
              <Input label="מקום" value={form.event_location ?? ''}
                onChange={(e) => set({ event_location: e.target.value })} />
              <Input label="מספר אורחים" type="number" min={0} value={form.guest_count ?? ''}
                onChange={(e) => set({ guest_count: e.target.value ? parseInt(e.target.value, 10) : null })} />
            </div>
            {!isTemplate && (
              <Input label="ח.פ. / ת.ז. (לחשבונית)" dir="ltr" value={form.client_tax_id ?? ''}
                onChange={(e) => set({ client_tax_id: e.target.value })} />
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold">פתיח</h2>
            <Input label="כותרת" value={form.title}
              onChange={(e) => set({ title: e.target.value })} />
            <Textarea label="מלל פתיחה" rows={4} value={form.intro ?? ''}
              onChange={(e) => set({ intro: e.target.value })} />
            {isTemplate && (
              <p className="text-[12px] text-faint">
                <code dir="ltr">{'{client_name}'}</code> ו־<code dir="ltr">{'{event_date}'}</code> יתמלאו בשם הלקוח ובתאריך בכל הצעה.
              </p>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold">שורות</h2>
            {lines.length === 0 && <p className="text-sm text-faint">עדיין אין שורות</p>}
            <ol className="space-y-2.5">
              {lines.map((line, i) => (
                <li key={line.key} className="bg-soft border border-line rounded-xl p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      aria-label="שם השורה" placeholder="שם השורה" value={line.name}
                      onChange={(e) => setLine(line.key, { name: e.target.value })}
                      className={`${fieldClass} bg-surface font-medium`}
                    />
                    <div className="flex shrink-0">
                      <IconButton label="למעלה" disabled={i === 0} onClick={() => moveLine(i, -1)}><ArrowUp size={15} /></IconButton>
                      <IconButton label="למטה" disabled={i === lines.length - 1} onClick={() => moveLine(i, 1)}><ArrowDown size={15} /></IconButton>
                      <IconButton label="הסרה" onClick={() => setLines(lines.filter((l) => l.key !== line.key))}><X size={15} /></IconButton>
                    </div>
                  </div>
                  <input
                    aria-label="תיאור" placeholder="תיאור (לא חובה)" value={line.description ?? ''}
                    onChange={(e) => setLine(line.key, { description: e.target.value })}
                    className={`${fieldClass} bg-surface`}
                  />
                  <div className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2">
                    <input
                      aria-label="כמות" type="number" min={0} step="any" value={line.quantity}
                      onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                      className={`${fieldClass} bg-surface num text-center`}
                    />
                    <MoneyInput aria-label="מחיר ליחידה" placeholder="מחיר" value={line.unit_price}
                      onChange={(unit_price) => setLine(line.key, { unit_price })} className="bg-surface" />
                    <span className="num text-sm text-muted min-w-20 text-end">
                      {(totals.lines[i]?.total ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })} ₪
                    </span>
                  </div>
                  {isTemplate && i === 0 && (
                    <p className="text-[12px] text-faint">המחיר בשורה הזו נקבע בכל הצעה מחדש.</p>
                  )}
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setLines([...lines, toLine({})])}>+ שורה</Button>
              {activePackages.length > 0 && (
                <select
                  aria-label="הוספה מחבילה" value="" className={`${fieldClass} w-auto`}
                  onChange={(e) => addPackage(e.target.value)}
                >
                  <option value="">+ מחבילה…</option>
                  {activePackages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold">מחיר</h2>
            <Segmented value={form.prices_include_vat ? 'incl' : 'excl'} options={VAT_MODES}
              onChange={(v) => set({ prices_include_vat: v === 'incl' ? 1 : 0 })} />
            <label className="block max-w-48">
              <span className="block text-[13px] text-muted mb-1.5">הנחה (₪)</span>
              <MoneyInput value={String(form.discount ?? '')} onChange={(v) => set({ discount: v as any })} />
            </label>
            <p className="text-[12.5px] text-muted">
              סה"כ לתשלום <span className="num font-semibold text-ink">{totals.total.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ₪</span>
              {' '}· מע"מ {form.vat_percent}% · לפני מע"מ <span className="num">{totals.net_amount.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ₪</span>
            </p>
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold">תנאים</h2>
            <Textarea label="תנאי ההצעה" rows={6} value={form.terms ?? ''}
              placeholder="מקדמה, ביטולים, מה ההופעה כוללת, מה נדרש מהמקום…"
              onChange={(e) => set({ terms: e.target.value })} />
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold">פרטים נוספים</h2>
            {!isTemplate && (
              <Input label="בתוקף עד" type="date" value={form.valid_until ?? ''}
                onChange={(e) => set({ valid_until: e.target.value || null })} />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="איש קשר" value={form.contact_name ?? ''}
                onChange={(e) => set({ contact_name: e.target.value })} />
              <Input label="טלפון איש קשר" type="tel" dir="ltr" value={form.contact_phone ?? ''}
                onChange={(e) => set({ contact_phone: e.target.value })} />
            </div>
            {isTemplate && (
              <p className="text-[12px] text-faint -mt-1">ריק = איש הקשר מההגדרות.</p>
            )}
            <Textarea label="הערה פנימית (הלקוח לא רואה)" rows={2} value={form.internal_note ?? ''}
              onChange={(e) => set({ internal_note: e.target.value })} />
          </Card>
        </fieldset>

        <div className={`lg:sticky lg:top-[80px] min-w-0 ${view === 'edit' ? 'hidden lg:block' : ''}`}>
          <div className="text-[12px] text-faint mb-2">
            {isTemplate ? 'כך תיראה הצעה מהתבנית' : `כך הלקוח יראה את ההצעה${form.valid_until ? ` · בתוקף עד ${quoteDate(form.valid_until)}` : ''}`}
          </div>
          {preview}
        </div>
      </div>

      <Modal title="שמירה כתבנית" open={templateName !== null} onClose={() => setTemplateName(null)}>
        <form
          onSubmit={(e) => { e.preventDefault(); if (templateName?.trim()) saveAsTemplate(templateName.trim()); }}
          className="space-y-3"
        >
          <p className="text-[13px] text-muted">
            התבנית לוקחת את הפתיח, השורות והתנאים של ההצעה הזו — בלי הלקוח ובלי התאריך.
          </p>
          <Input label="שם התבנית" value={templateName ?? ''} required autoFocus
            onChange={(e) => setTemplateName(e.target.value)} />
          <Button type="submit" className="w-full">שמירה כתבנית</Button>
        </form>
      </Modal>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-faint hover:text-ink-2 hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
