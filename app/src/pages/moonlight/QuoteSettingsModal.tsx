import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Check, ImageUp, Trash2 } from 'lucide-react';
import { del, postFile, put } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Input, Modal, Segmented, Switch, Textarea } from '../../ui';
import { PALETTES, readableOnWhite, textOn } from '../../quotes/colors';
import { prepareSignature } from '../../quotes/signatureImage';
import { VAT_MODES } from './QuoteModals';
import type { QuoteSettings } from './quotes';

type SettingsData = { settings: QuoteSettings; event_types: string[]; vat_percent: number } | null;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = 'image/png,image/jpeg,image/webp';

/** The paper a transparent signature is shown on, so you can see that it is transparent. */
const CHECKERBOARD: React.CSSProperties = {
  backgroundImage: 'repeating-conic-gradient(#ececf2 0% 25%, #ffffff 0% 50%)',
  backgroundSize: '14px 14px',
};

/** A signature photo on its way in: what was picked, and the two versions of it on offer. */
interface SignatureDraft {
  original: File;
  cleaned: Blob | null;
  plain: Blob | null;
  removeBackground: boolean;
  url: string | null;
}

/**
 * Who the quotes come from and what they look like.
 *
 * The two images are saved the moment they are uploaded, each on its own; everything else is a
 * form saved with the button. The images are read from the settings as the server last sent
 * them rather than from the form, so uploading a logo never throws away a name half-typed.
 *
 * The signature is the owner's: a band member sees it here, and on every quote, but the controls
 * to change it are the owner's alone — the server refuses anyone else.
 */
export function QuoteSettingsModal({ open, onClose, settingsData, onSaved, onImagesChanged }: {
  open: boolean;
  onClose: () => void;
  settingsData: SettingsData;
  onSaved: () => void;
  onImagesChanged: () => void;
}) {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [form, setForm] = useState<QuoteSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'logo' | 'signature' | 'save' | null>(null);
  const [draft, setDraft] = useState<SignatureDraft | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const signatureInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setForm(null); setDraft(null); setError(''); return; }
    if (!form && settingsData) setForm({ ...settingsData.settings });
  }, [open, settingsData]);

  // An object URL holds the image in memory until it is let go.
  useEffect(() => () => { if (draft?.url) URL.revokeObjectURL(draft.url); }, [draft?.url]);

  if (!form || !settingsData) {
    return <Modal title="הגדרות הצעות מחיר" open={open} onClose={onClose} size="lg">{null}</Modal>;
  }
  const saved = settingsData.settings;
  const set = (patch: Partial<QuoteSettings>) => setForm({ ...form, ...patch });

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (file.size > MAX_IMAGE_BYTES) return setError('התמונה גדולה מ־5MB');
    setBusy('logo');
    try { await postFile('/moonlight/quotes/branding/logo', file); onImagesChanged(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  const removeImage = async (kind: 'logo' | 'signature') => {
    if (!confirm(kind === 'logo' ? 'להסיר את הלוגו?' : 'להסיר את החתימה מכל ההצעות?')) return;
    setError('');
    try { await del(`/moonlight/quotes/branding/${kind}`); onImagesChanged(); }
    catch (err: any) { setError(err.message); }
  };

  /** Prepares both versions up front, so switching between them is instant. */
  const pickSignature = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setBusy('signature');
    try {
      const plain = await prepareSignature(file, false);
      const cleaned = await prepareSignature(file, true).catch((err) => {
        setError(err.message);
        return null;
      });
      const shown = cleaned ?? plain;
      setDraft({ original: file, cleaned, plain, removeBackground: !!cleaned, url: URL.createObjectURL(shown) });
    } catch {
      setError('לא הצלחנו לקרוא את התמונה — נסו קובץ JPG או PNG');
    } finally { setBusy(null); }
  };

  const toggleBackground = (removeBackground: boolean) => {
    if (!draft) return;
    const blob = removeBackground ? draft.cleaned : draft.plain;
    if (!blob) return;
    setDraft({ ...draft, removeBackground, url: URL.createObjectURL(blob) });
  };

  const saveSignature = async () => {
    const blob = draft && (draft.removeBackground ? draft.cleaned : draft.plain);
    if (!blob) return;
    if (blob.size > MAX_IMAGE_BYTES) return setError('התמונה גדולה מ־5MB');
    setBusy('signature');
    setError('');
    try {
      await postFile('/moonlight/quotes/branding/signature', new File([blob], 'signature.png', { type: 'image/png' }));
      setDraft(null);
      onImagesChanged();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError('');
    try { await put('/moonlight/quotes/settings', form); onSaved(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  const headerStyle = { backgroundColor: form.color_primary, color: textOn(form.color_primary) };
  const activePalette = PALETTES.find((p) => p.primary === form.color_primary && p.accent === form.color_accent);

  return (
    <Modal title="הגדרות הצעות מחיר" open={open} onClose={onClose} size="lg">
      <form onSubmit={save} className="space-y-6">
        {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}

        {/* ---- branding ---- */}
        <section className="space-y-4">
          <h3 className="font-semibold">מיתוג</h3>

          {/* What the top of every quote will look like, with the choices below applied. */}
          <div className="rounded-xl overflow-hidden border border-line">
            <div style={headerStyle} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                {saved.logo_url
                  ? <img src={saved.logo_url} alt={form.brand_name} className="h-11 w-auto max-w-[160px] object-contain object-right" />
                  : <div className="ser text-xl tracking-wide">{form.brand_name || 'Moonlight'}</div>}
                <div className="text-[11px] opacity-65 text-end">הצעת מחיר<div dir="ltr">ML-2026-001</div></div>
              </div>
              <div className="ser text-lg mt-3">הופעה בחתונה של דנה ורון</div>
            </div>
            <div className="bg-surface px-5 py-3 flex items-baseline justify-between">
              <span className="text-[13px] font-semibold">סה"כ לתשלום</span>
              <span className="num text-lg font-extrabold" style={{ color: readableOnWhite(form.color_accent) }}>₪14,160</span>
            </div>
          </div>

          <Input label="השם בראש ההצעה" value={form.brand_name}
            onChange={(e) => set({ brand_name: e.target.value })} />

          <div>
            <span className="block text-[13px] text-muted mb-1.5">לוגו</span>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={logoInput} type="file" accept={IMAGE_TYPES} className="hidden"
                onChange={(e) => { uploadLogo(e.target.files?.[0]); e.target.value = ''; }} />
              <Button variant="ghost" onClick={() => logoInput.current?.click()} disabled={busy === 'logo'}>
                <span className="flex items-center gap-1.5"><ImageUp size={16} />{busy === 'logo' ? 'מעלה…' : saved.logo_url ? 'החלפת לוגו' : 'העלאת לוגו'}</span>
              </Button>
              {saved.logo_url && (
                <Button variant="ghost" onClick={() => removeImage('logo')}>
                  <span className="flex items-center gap-1.5"><Trash2 size={15} />הסרה</span>
                </Button>
              )}
            </div>
            <p className="text-[12px] text-faint mt-1.5">
              PNG עם רקע שקוף נראה הכי טוב, עד 5MB. הלוגו מחליף את השם בראש ההצעה — ודאו שהוא בולט על צבע הכותרת.
            </p>
          </div>

          <div>
            <span className="block text-[13px] text-muted mb-2">צבעים</span>
            <div className="flex flex-wrap gap-2">
              {PALETTES.map((p) => {
                const active = activePalette?.name === p.name;
                return (
                  <button
                    key={p.name} type="button" title={p.name}
                    onClick={() => set({ color_primary: p.primary, color_accent: p.accent })}
                    className={clsx(
                      'flex items-center gap-2 rounded-full border ps-1 pe-3 py-1 text-[12.5px] transition-colors',
                      active ? 'border-accent bg-accent-soft text-accent-ink font-semibold' : 'border-line hover:border-line-strong'
                    )}
                  >
                    <span className="relative w-6 h-6 rounded-full overflow-hidden border border-black/10 shrink-0">
                      <span className="absolute inset-0" style={{ backgroundColor: p.primary }} />
                      <span className="absolute inset-y-0 start-1/2 end-0" style={{ backgroundColor: p.accent }} />
                      {active && <Check size={12} className="absolute inset-0 m-auto text-white drop-shadow" />}
                    </span>
                    {p.name}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <ColorField label="צבע הכותרת" value={form.color_primary} onChange={(color_primary) => set({ color_primary })} />
              <ColorField label="צבע הדגשה (כותרות וסכום)" value={form.color_accent} onChange={(color_accent) => set({ color_accent })} />
            </div>
            <p className="text-[12px] text-faint mt-1.5">
              צבע הטקסט נבחר לבד כך שיהיה קריא, וצבע הדגשה בהיר מוכהה מספיק כדי להיקרא על לבן.
            </p>
          </div>
        </section>

        {/* ---- signature ---- */}
        <section className="space-y-3 border-t border-line pt-5">
          <h3 className="font-semibold">חתימה</h3>
          <p className="text-[13px] text-muted">
            מופיעה בתחתית כל הצעה, בשם {form.brand_name || 'הלהקה'}.
            {!isOwner && ' את החתימה מעלה ומחליף רק בעל החשבון.'}
          </p>

          {draft ? (
            <div className="space-y-3 bg-soft rounded-xl p-4">
              <div style={CHECKERBOARD} className="rounded-lg border border-line h-36 flex items-center justify-center p-3">
                {draft.url && <img src={draft.url} alt="החתימה שנבחרה" className="max-h-full max-w-full object-contain" />}
              </div>
              {draft.cleaned && (
                <Switch label="הסרת רקע הדף" checked={draft.removeBackground} onChange={toggleBackground} />
              )}
              <div className="flex gap-2">
                <Button onClick={saveSignature} disabled={busy === 'signature'}>
                  {busy === 'signature' ? 'שומר…' : 'שמירת החתימה'}
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)}>ביטול</Button>
              </div>
            </div>
          ) : saved.signature_url ? (
            <div style={CHECKERBOARD} className="rounded-lg border border-line h-28 flex items-center justify-center p-3">
              <img src={saved.signature_url} alt="החתימה" className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <p className="text-sm text-faint">עדיין אין חתימה.</p>
          )}

          {isOwner && !draft && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={signatureInput} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { pickSignature(e.target.files?.[0]); e.target.value = ''; }} />
                <Button variant="ghost" onClick={() => signatureInput.current?.click()} disabled={busy === 'signature'}>
                  <span className="flex items-center gap-1.5"><ImageUp size={16} />
                    {busy === 'signature' ? 'מעבד…' : saved.signature_url ? 'החלפת חתימה' : 'העלאת תמונה של החתימה'}
                  </span>
                </Button>
                {saved.signature_url && (
                  <Button variant="ghost" onClick={() => removeImage('signature')}>
                    <span className="flex items-center gap-1.5"><Trash2 size={15} />הסרה</span>
                  </Button>
                )}
              </div>
              <p className="text-[12px] text-faint">
                חתמו בעט כהה על דף לבן וצלמו באור טוב, מלמעלה. הרקע מוסר לבד — אפשר לבטל את זה לפני השמירה.
              </p>
            </>
          )}

          {isOwner && (
            <Input label="השם מתחת לחתימה" placeholder="לדוגמה: איתמר מירון" value={form.signature_name}
              onChange={(e) => set({ signature_name: e.target.value })} />
          )}
        </section>

        {/* ---- defaults ---- */}
        <section className="space-y-3 border-t border-line pt-5">
          <h3 className="font-semibold">ברירות מחדל</h3>
          <div className="grid grid-cols-2 gap-3">
            <Input label="איש קשר" value={form.contact_name}
              onChange={(e) => set({ contact_name: e.target.value })} />
            <Input label="טלפון" type="tel" dir="ltr" value={form.contact_phone}
              onChange={(e) => set({ contact_phone: e.target.value })} />
          </div>
          <p className="text-[12px] text-faint -mt-1">
            מופיעים בתחתית כל הצעה חדשה. אפשר לשנות אותם בכל הצעה לחוד, או לקבוע אחרים בתבנית.
          </p>
          <Input label="תוקף הצעה חדשה (ימים)" type="number" min={1} max={365} value={form.validity_days}
            onChange={(e) => set({ validity_days: parseInt(e.target.value, 10) || 0 })} />
          <div>
            <span className="block text-[13px] text-muted mb-1.5">מחירים בהצעה ריקה ובתבנית חדשה</span>
            <Segmented value={form.prices_include_vat ? 'incl' : 'excl'} options={VAT_MODES}
              onChange={(v) => set({ prices_include_vat: v === 'incl' })} />
          </div>
        </section>

        {/* ---- sending ---- */}
        <section className="space-y-3 border-t border-line pt-5">
          <h3 className="font-semibold">שליחה ללקוח</h3>
          <p className="text-[12.5px] text-muted -mt-1">
            ההודעה שנפתחת בוואטסאפ ובמייל עם הקישור להצעה. אפשר לשנות אותה גם לפני כל שליחה.
          </p>
          <Textarea label="ההודעה" rows={6} value={form.message_template}
            onChange={(e) => set({ message_template: e.target.value })} />
          <Input label="נושא האימייל" value={form.email_subject}
            onChange={(e) => set({ email_subject: e.target.value })} />
          <p className="text-[12px] text-faint" dir="rtl">
            מתמלאים בכל הצעה:{' '}
            {['client_name', 'title', 'event_date', 'valid_until', 'link', 'contact_name', 'quote_number'].map((k, i) => (
              <React.Fragment key={k}>{i > 0 && ' '}<code dir="ltr" className="bg-soft rounded px-1">{`{${k}}`}</code></React.Fragment>
            ))}
            . ריק = ההודעה הרגילה.
          </p>
        </section>

        <Button type="submit" className="w-full" disabled={busy === 'save'}>
          {busy === 'save' ? 'שומר…' : 'שמירה'}
        </Button>
      </form>
    </Modal>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[13px] text-muted mb-1.5">{label}</span>
      <span className="flex items-center gap-2 bg-soft border border-line rounded-lg px-2 py-1.5">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-8 h-7 rounded cursor-pointer bg-transparent border-0 p-0" />
        <span dir="ltr" className="num text-sm text-ink-2 uppercase">{value}</span>
      </span>
    </label>
  );
}
