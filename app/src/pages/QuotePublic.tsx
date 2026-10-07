import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, MessageCircle, Printer } from 'lucide-react';
import { get, post } from '../api';
import { Button, Empty, fieldClass } from '../ui';
import type { QuoteTotals } from '../../server/quoteMath';
import { whatsappUrl } from '../../server/quoteShare';
import { QuoteDocument, type QuoteDocumentQuote } from '../quotes/QuoteDocument';
import { SignaturePad, type SignaturePadHandle } from '../quotes/SignaturePad';
import { israelDateTime, quoteDate, type LogoPosition, type QuoteBranding } from './band/quotes';

/** What /api/public/quotes/:token answers — see server/quoteLink.ts. */
interface PublicView {
  state: 'open' | 'expired' | 'cancelled' | 'signed';
  quote: QuoteDocumentQuote;
  totals: QuoteTotals | null;
  branding: {
    brand_name: string; logo_url: string | null; logo_position?: LogoPosition;
    color_primary: string; color_accent: string;
    signature_url: string | null; signature_name: string;
  };
  version: string | null;
  signature: { signer_name: string; signed_at: string; png: string } | null;
}

const brandingOf = (b: PublicView['branding']): QuoteBranding => ({
  brandName: b.brand_name,
  logoUrl: b.logo_url,
  logoPosition: b.logo_position ?? 'center',
  primary: b.color_primary,
  accent: b.color_accent,
  signatureUrl: b.signature_url,
  signatureName: b.signature_name,
});

/**
 * The quote as the client gets it: the link from WhatsApp or an email, on their phone, with no
 * login. They read it, sign it with a finger, and keep a copy.
 *
 * Built for a phone first, since that is where a link from WhatsApp opens. The quote itself is
 * the same component the band previewed, so what they sign is what was checked before sending.
 */
export function QuotePublic() {
  const { token } = useParams();
  const [data, setData] = useState<PublicView | null>(null);
  const [error, setError] = useState('');
  const [justSigned, setJustSigned] = useState(false);
  const counted = useRef(false);

  // Outside the app's shell, so the page sets the band's palette itself.
  useEffect(() => { document.documentElement.dataset.ws = 'moon'; }, []);

  const load = () => get<PublicView>(`/public/quotes/${token}`)
    .then((d) => { setData(d); setError(''); })
    .catch((e) => setError(e.message));
  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    if (!data) return;
    document.title = `${data.quote.title || 'הצעת מחיר'} — ${data.branding.brand_name}`;
    // One visit, one count; the server ignores it when the band is the one looking.
    if (!counted.current && (data.state === 'open' || data.state === 'expired')) {
      counted.current = true;
      post(`/public/quotes/${token}/view`).catch(() => {});
    }
  }, [data]);

  if (error && !data) return <Notice title="הקישור אינו תקין" text={`${error}. לקבלת הקישור העדכני פנו למי ששלח לכם את ההצעה.`} />;
  if (!data) return <Empty text="טוען…" />;

  const { quote, state } = data;
  const contact = [quote.contact_name, quote.contact_phone].filter(Boolean).join(' · ');
  const contactWhatsapp = quote.contact_phone
    ? whatsappUrl(quote.contact_phone, `שלום, לגבי הצעת המחיר ${quote.quote_number ?? ''}`.trim())
    : null;

  if (state === 'cancelled') {
    return <Notice title="ההצעה אינה בתוקף" text={contact ? `לפרטים: ${contact}` : 'לפרטים פנו למי ששלח לכם את ההצעה.'} />;
  }

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <main className="max-w-2xl mx-auto px-3 py-5 md:py-10 space-y-4 print:p-0 print:max-w-none">
        {state === 'signed' && data.signature && (
          <div className="print:hidden bg-pos-soft text-pos rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 size={20} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">{justSigned ? 'תודה! ההצעה נחתמה' : 'ההצעה נחתמה'}</div>
                <div className="text-[13px] text-ink-2 mt-0.5">
                  ע״י {data.signature.signer_name}, <span className="num">{israelDateTime(data.signature.signed_at)}</span>.
                  {justSigned && ' עותק חתום נשמר אצלנו, ואפשר לשמור עותק גם כאן.'}
                </div>
              </div>
            </div>
            <Button variant="ghost" onClick={() => window.print()}>
              <span className="flex items-center gap-1.5"><Printer size={16} /> שמירה כ־PDF</span>
            </Button>
          </div>
        )}

        {state === 'expired' && (
          <div className="print:hidden bg-warn-soft text-warn-ink rounded-2xl px-5 py-4 text-[14px]">
            <div className="font-semibold">תוקף ההצעה פג{quote.valid_until && <> ב־<span className="num">{quoteDate(quote.valid_until)}</span></>}</div>
            <div className="mt-0.5 text-ink-2">לחידוש ההצעה {contact ? <>פנו אל {contact}</> : 'פנו אלינו'}.</div>
          </div>
        )}

        {data.totals && (
          <QuoteDocument
            quote={quote}
            totals={data.totals}
            branding={brandingOf(data.branding)}
            clientLine={state === 'signed'}
            clientSignature={data.signature && {
              name: data.signature.signer_name, signedAt: data.signature.signed_at, png: data.signature.png,
            }}
          />
        )}

        {state === 'open' && data.version && (
          <SignForm token={token!} version={data.version} onSigned={(d) => { setData(d); setJustSigned(true); }} onReload={load} />
        )}

        {contactWhatsapp && (
          <div className="print:hidden text-center pt-2 pb-6">
            <a href={contactWhatsapp} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
              <MessageCircle size={16} /> שאלה על ההצעה? כתבו ל{quote.contact_name || 'נו'} בוואטסאפ
            </a>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Name, signature, consent. The page checks each so the client is told what is missing before
 * anything is sent, and the server checks them all again, since the page is not what decides.
 */
function SignForm({ token, version, onSigned, onReload }: {
  token: string;
  version: string;
  onSigned: (data: PublicView) => void;
  onReload: () => void;
}) {
  const pad = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const png = pad.current?.toDataURL();
    if (!name.trim()) return setError('נא למלא שם מלא');
    if (!png) return setError('נא לחתום במסגרת');
    if (!consent) return setError('נא לסמן את האישור');
    setBusy(true);
    setError('');
    try {
      onSigned(await post<PublicView>(`/public/quotes/${token}/sign`, {
        signer_name: name.trim(), signature_png: png, consent: true, version,
      }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err.message);
      // The quote may have changed, or been signed from another tab: show what is true now.
      onReload();
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="print:hidden bg-surface border border-line rounded-2xl p-5 md:p-7 space-y-4">
      <div>
        <h2 className="ser text-xl">אישור ההצעה</h2>
        <p className="text-[13.5px] text-muted mt-1">כדי לאשר את ההצעה, כתבו את שמכם המלא וחתמו במסגרת.</p>
      </div>
      <label className="block">
        <span className="block text-[13px] text-muted mb-1.5">שם מלא</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={fieldClass} />
      </label>
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[13px] text-muted">חתימה</span>
          {hasInk && (
            <button type="button" onClick={() => pad.current?.clear()} className="text-[13px] text-accent hover:underline">
              ניקוי
            </button>
          )}
        </div>
        <SignaturePad ref={pad} onChange={setHasInk} />
        {!hasInk && <p className="text-[12px] text-faint mt-1.5">חתמו באצבע, או בעכבר במחשב.</p>}
      </div>
      <label className="flex items-start gap-2.5 text-[14px] text-ink-2 cursor-pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
          className="accent-accent w-4 h-4 mt-0.5 shrink-0" />
        קראתי את ההצעה ואת תנאיה, ואני מאשר/ת אותם.
      </label>
      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}
      <Button type="submit" className="w-full py-3 text-[15px]" disabled={busy}>
        {busy ? 'שולח…' : 'אישור וחתימה'}
      </Button>
    </form>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="bg-surface border border-line rounded-2xl px-6 py-8 max-w-sm text-center">
        <h1 className="ser text-xl">{title}</h1>
        <p className="text-[14px] text-muted mt-2">{text}</p>
      </div>
    </div>
  );
}
