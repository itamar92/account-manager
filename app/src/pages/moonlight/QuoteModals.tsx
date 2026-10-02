import React, { useEffect, useState } from 'react';
import { del, post, put, nis } from '../../api';
import { Button, Input, Modal, MoneyInput, Textarea, fieldClass } from '../../ui';
import { usePackages, type BuiltinTemplate, type Quote, type QuotePackage, type QuoteSettings } from './quotes';

type SettingsData = { settings: QuoteSettings; event_types: string[]; vat_percent: number; calendar_ready?: boolean } | null;

export const VAT_MODES = [
  { value: 'excl' as const, label: 'המחיר + מע"מ' },
  { value: 'incl' as const, label: 'המחיר כולל מע"מ' },
];

/** What the quick form starts with: blank, but for what the template already says — its price too. */
const quickForm = (template?: Quote) => ({
  template_id: template?.id ?? '', client_name: '', client_phone: '', event_date: '',
  price: Number(template?.first_line_price) ? String(template!.first_line_price) : '',
  event_location: template?.event_location ?? '', show_duration: template?.show_duration ?? '',
});

/**
 * «הצעה חדשה»: pick the template, type the things that change, and the rest of the quote is
 * already written. The new quote opens in the editor, where anything else can still change.
 *
 * The client and the date are asked for; the price, the place and the show's length are there
 * too, because they were the other blanks every quote filled in. Each starts as the template has
 * it, so a template that already has its price and says «כשעה» needs nothing more typed. Only a
 * template priced per quote asks for a price.
 */
export function QuickCreateModal({
  open, onClose, templates, settingsData, onCreated, onBlank, onNewTemplate, onNewBuiltin, onError,
}: {
  open: boolean;
  onClose: () => void;
  templates: Quote[];
  settingsData: SettingsData;
  /** `holdDate`: open the new quote with its calendar dialog, to hold the date as «אופציה». */
  onCreated: (id: string, holdDate: boolean) => void;
  onBlank: () => void;
  onNewTemplate: () => void;
  onNewBuiltin: () => void;
  onError: (message: string) => void;
}) {
  const defaultId = settingsData?.settings.default_template_id ?? templates[0]?.id ?? '';
  const [form, setForm] = useState(quickForm());
  const [busy, setBusy] = useState(false);
  const calendarReady = !!settingsData?.calendar_ready;
  const [holdDate, setHoldDate] = useState(true);

  useEffect(() => {
    if (open) setForm(quickForm(templates.find((t) => t.id === defaultId) ?? templates[0]));
  }, [open, defaultId, templates]);

  const template = templates.find((t) => t.id === form.template_id);
  const vatNote = template?.prices_include_vat ? 'כולל מע"מ' : 'לפני מע"מ';
  const templatePriced = !!Number(template?.first_line_price);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await post('/moonlight/quotes', form);
      onClose();
      onCreated(d.quote.id, calendarReady && holdDate);
    } catch (err: any) { onError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="הצעת מחיר חדשה" open={open} onClose={onClose}>
      {templates.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-body">
            עדיין אין תבנית. תבנית היא ההצעה הרגילה שלכם — הפתיח, השורות והתנאים — וממנה כל הצעה
            חדשה היא רק שם הלקוח, תאריך ומחיר.
          </p>
          <p className="text-[13px] text-muted">
            התבנית המוכנה היא הצעת המחיר של מונלייט: ההרכב, לוח הזמנים, מה נדרש מההפקה, תשלום וביטול.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { onClose(); onNewBuiltin(); }}>התבנית המוכנה</Button>
            <Button variant="ghost" onClick={() => { onClose(); onNewTemplate(); }}>תבנית ריקה</Button>
            <Button variant="ghost" onClick={() => { onClose(); onBlank(); }}>הצעה ריקה</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {templates.length > 1 && (
            <label className="block">
              <span className="block text-[13px] text-muted mb-1.5">תבנית</span>
              <select value={form.template_id} className={fieldClass}
                onChange={(e) => {
                  const next = quickForm(templates.find((t) => t.id === e.target.value));
                  // What was typed about the client stays; what came from the old template goes.
                  setForm({ ...form, template_id: next.template_id, price: next.price, event_location: next.event_location, show_duration: next.show_duration });
                }}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.template_name || 'תבנית'}{t.is_default ? ' (ברירת מחדל)' : ''}</option>
                ))}
              </select>
            </label>
          )}
          <Input label="שם הלקוח *" value={form.client_name} required autoFocus
            onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="תאריך האירוע *" type="date" value={form.event_date} required
              onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
            <Input label="טלפון" type="tel" dir="ltr" value={form.client_phone}
              onChange={(e) => setForm({ ...form, client_phone: e.target.value })} />
            <Input label="מקום" value={form.event_location}
              onChange={(e) => setForm({ ...form, event_location: e.target.value })} />
            <Input label="משך ההופעה" placeholder="למשל: כשעה" value={form.show_duration}
              onChange={(e) => setForm({ ...form, show_duration: e.target.value })} />
          </div>
          <label className="block">
            <span className="block text-[13px] text-muted mb-1.5">מחיר{templatePriced ? '' : ' *'} ({vatNote})</span>
            <MoneyInput value={form.price} required={!templatePriced} onChange={(price) => setForm({ ...form, price })}
              placeholder={templatePriced ? 'המחיר מהתבנית' : undefined} />
            {template?.first_line_name && (
              <span className="block text-[12px] text-faint mt-1.5">
                {templatePriced
                  ? <>המחיר מהתבנית, בשורה «{template.first_line_name}». אפשר לשנות אותו להצעה הזו.</>
                  : <>המחיר נכנס לשורה «{template.first_line_name}». שאר התבנית נשארת כמו שהיא.</>}
              </span>
            )}
          </label>
          {calendarReady && (
            <label className="flex items-start gap-2.5 text-[13.5px] text-ink-2 cursor-pointer">
              <input type="checkbox" checked={holdDate} onChange={(e) => setHoldDate(e.target.checked)}
                className="accent-accent w-4 h-4 mt-0.5 shrink-0" />
              <span>
                שריון ביומן כאופציה
                <span className="block text-[12px] text-faint">אחרי היצירה ייפתח האירוע לעריכה: כותרת, שעות, מיקום ומי מוזמן.</span>
              </span>
            </label>
          )}
          <Button type="submit" className="w-full" disabled={busy || !form.template_id}>
            {busy ? 'יוצר…' : 'יצירת הצעה'}
          </Button>
          <p className="text-center text-[13px] text-muted">
            משהו חריג?{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => { onClose(); onBlank(); }}>
              הצעה ריקה
            </button>
          </p>
        </form>
      )}
    </Modal>
  );
}

/** The templates, which one «הצעה חדשה» opens with, and the way into each. */
export function TemplatesModal({ open, onClose, templates, builtins, onOpen, onNew, onNewBuiltin, onChanged, onError }: {
  open: boolean;
  onClose: () => void;
  templates: Quote[];
  builtins: BuiltinTemplate[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onNewBuiltin: (key: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const makeDefault = async (t: Quote) => {
    try { await put('/moonlight/quotes/settings', { default_template_id: t.id }); onChanged(); }
    catch (err: any) { onError(err.message); }
  };

  const duplicate = async (t: Quote) => {
    try { await post(`/moonlight/quotes/${t.id}/duplicate`); onChanged(); }
    catch (err: any) { onError(err.message); }
  };

  const remove = async (t: Quote) => {
    if (!confirm(`למחוק את התבנית «${t.template_name}»? הצעות שכבר נוצרו ממנה לא ישתנו.`)) return;
    try { await del(`/moonlight/quotes/${t.id}`); onChanged(); }
    catch (err: any) { onError(err.message); }
  };

  return (
    <Modal title="תבניות" open={open} onClose={onClose} size="lg">
      <div className="space-y-4">
        <p className="text-[13px] text-muted">
          «הצעה חדשה» מתחילה מתבנית ברירת המחדל. בכותרת ובפתיח אפשר לכתוב{' '}
          <code dir="ltr" className="bg-soft rounded px-1">{'{client_name}'}</code> ו־
          <code dir="ltr" className="bg-soft rounded px-1">{'{event_date}'}</code>, והם יתמלאו בכל הצעה.
        </p>
        {templates.length === 0 && <p className="text-sm text-faint py-4 text-center">עדיין אין תבניות</p>}
        <ul className="divide-y divide-line border-y border-line">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{t.template_name || 'תבנית'}</span>
                  {t.is_default && (
                    <span className="text-[11.5px] font-semibold bg-accent-soft text-accent-ink rounded-full px-2 py-0.5">ברירת מחדל</span>
                  )}
                </div>
                <div className="text-[12.5px] text-faint mt-0.5">
                  {t.first_line_name
                    ? <>«{t.first_line_name}» · {Number(t.first_line_price) ? <span className="num">{nis(t.first_line_price)}</span> : 'המחיר נקבע בכל הצעה'}</>
                    : 'אין שורות'}
                </div>
              </div>
              <div className="flex gap-3 text-sm">
                <button onClick={() => { onClose(); onOpen(t.id); }} className="text-accent hover:underline">עריכה</button>
                {!t.is_default && <button onClick={() => makeDefault(t)} className="text-accent hover:underline">ברירת מחדל</button>}
                <button onClick={() => duplicate(t)} className="text-accent hover:underline">שכפול</button>
                <button onClick={() => remove(t)} className="text-neg hover:underline">מחיקה</button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => { onClose(); onNew(); }}>+ תבנית חדשה</Button>
        </div>
        {/* A ready-made one is a fresh copy every time, so one deleted or edited past saving is a click away. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">תבנית מוכנה:</span>
          {builtins.map((b) => (
            <Button key={b.key} variant="ghost" onClick={() => { onClose(); onNewBuiltin(b.key); }}>+ {b.template_name}</Button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

const EMPTY_PACKAGE = { id: '', name: '', description: '', unit_price: '', active: true };

/**
 * The price list. A line added from a package is a copy of it, so changing a price here reprices
 * the next quote and leaves every quote already made alone.
 */
export function PackagesModal({ open, onClose, onError }: {
  open: boolean;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const { packages, reload } = usePackages(onError);
  const [form, setForm] = useState<typeof EMPTY_PACKAGE | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    try {
      if (form.id) await put(`/moonlight/quotes/packages/${form.id}`, form);
      else await post('/moonlight/quotes/packages', form);
      setForm(null);
      reload();
    } catch (err: any) { onError(err.message); }
  };

  const remove = async (p: QuotePackage) => {
    if (!confirm(`למחוק את «${p.name}» ממחירון החבילות?`)) return;
    try { await del(`/moonlight/quotes/packages/${p.id}`); reload(); }
    catch (err: any) { onError(err.message); }
  };

  return (
    <Modal title="חבילות" open={open} onClose={() => { setForm(null); onClose(); }} size="lg">
      <div className="space-y-4">
        <p className="text-[13px] text-muted">
          שורות קבועות שבוחרים מהן בעריכת הצעה — הרכב מלא, סט אקוסטי, הגברה ותאורה.
        </p>
        {packages.length === 0 && !form && <p className="text-sm text-faint py-4 text-center">עדיין אין חבילות</p>}
        <ul className="divide-y divide-line">
          {packages.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className={p.active ? 'font-medium' : 'font-medium text-faint'}>
                  {p.name}{!p.active && ' (לא פעילה)'}
                </div>
                {p.description && <div className="text-[12.5px] text-faint truncate">{p.description}</div>}
              </div>
              <div className="flex items-center gap-3 text-sm shrink-0">
                <span className="num font-medium">{nis(p.unit_price)}</span>
                <button className="text-accent hover:underline"
                  onClick={() => setForm({ id: p.id, name: p.name, description: p.description ?? '', unit_price: String(p.unit_price), active: !!p.active })}>
                  עריכה
                </button>
                <button className="text-neg hover:underline" onClick={() => remove(p)}>מחיקה</button>
              </div>
            </li>
          ))}
        </ul>

        {form ? (
          <form onSubmit={save} className="bg-soft rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
              <Input label="שם *" value={form.name} required autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <label className="block">
                <span className="block text-[13px] text-muted mb-1.5">מחיר</span>
                <MoneyInput value={form.unit_price} onChange={(unit_price) => setForm({ ...form, unit_price })} />
              </label>
            </div>
            <Textarea label="תיאור" rows={2} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" className="accent-accent" checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              פעילה — מופיעה בבחירת שורות
            </label>
            <div className="flex gap-2">
              <Button type="submit">{form.id ? 'שמירה' : 'הוספה'}</Button>
              <Button variant="ghost" onClick={() => setForm(null)}>ביטול</Button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" onClick={() => setForm({ ...EMPTY_PACKAGE })}>+ חבילה</Button>
        )}
      </div>
    </Modal>
  );
}
