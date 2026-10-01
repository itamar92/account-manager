import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ClipboardCheck, Copy, ExternalLink, Mail, MessageCircle, RefreshCw } from 'lucide-react';
import { Input, Modal, Textarea } from '../../ui';
import { gmailUrl, mailtoUrl, whatsappUrl } from '../../../server/quoteShare';
import { quoteEmailDocument, quoteEmailHtml } from '../../quotes/quoteEmail';
import type { Quote, ShareDetails } from './quotes';

/**
 * Puts the email on the clipboard as rich text, with the plain message beside it for whatever
 * pastes only text. Done synchronously, inside the click, so the compose window can open in the
 * same click without the browser calling it a popup; the asynchronous clipboard is the fallback.
 */
async function copyRich(html: string, text: string): Promise<boolean> {
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData('text/html', html);
    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
  };
  // Some browsers copy nothing unless something is selected, so a stand-in is.
  const stand = document.createElement('span');
  stand.textContent = ' ';
  stand.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
  document.body.appendChild(stand);
  const range = document.createRange();
  range.selectNodeContents(stand);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.addEventListener('copy', onCopy);
  let done = false;
  try { done = document.execCommand('copy'); } catch { done = false; }
  document.removeEventListener('copy', onCopy);
  selection?.removeAllRanges();
  stand.remove();
  if (done) return true;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The quote's link, and the ways to get it to the client.
 *
 * Nothing here is sent by the app. WhatsApp, the mail app and Gmail each open from the sender's
 * own account, so the client's answer comes back to a person. WhatsApp opens with the message
 * written in. An email is designed — the band's header, a card with the offer, a button to the
 * quote — and since a mail link carries only plain text, the designed email goes on the
 * clipboard and the compose window opens empty, addressed and with its subject, to paste it into.
 * The message can be changed first; the links and the email are rebuilt from whatever it says.
 */
export function QuoteShareModal({ open, onClose, share, quote, onRegenerate }: {
  open: boolean;
  onClose: () => void;
  share: ShareDetails | null;
  quote: Quote;
  onRegenerate: () => void;
}) {
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [copied, setCopied] = useState(false);
  /** What became of the last email opened: pasted from the clipboard, or plain text in its place. */
  const [emailState, setEmailState] = useState<'copied' | 'plain' | null>(null);

  useEffect(() => {
    if (share) { setMessage(share.message); setSubject(share.subject); setCopied(false); setEmailState(null); }
  }, [share]);

  const emailHtml = useMemo(
    () => (share ? quoteEmailHtml({ card: share.card, message, link: share.url }) : ''),
    [share, message],
  );
  const emailPage = useMemo(
    () => (share ? quoteEmailDocument({ card: share.card, message, link: share.url }) : ''),
    [share, message],
  );

  if (!share) return null;
  const signed = quote.status === 'signed';

  /**
   * Copies the designed email and opens the compose window for it — empty, so pasting fills it.
   * Should the copy fail, the window opens with the plain message instead, as it always did.
   */
  const openEmail = async (kind: 'mail' | 'gmail') => {
    const pasted = await copyRich(emailHtml, message);
    setEmailState(pasted ? 'copied' : 'plain');
    const body = pasted ? '' : message;
    if (kind === 'mail') window.location.href = mailtoUrl(share.email, subject, body);
    else window.open(gmailUrl(share.email, subject, body), '_blank', 'noopener,noreferrer');
  };

  const copyEmailAgain = async () => setEmailState((await copyRich(emailHtml, message)) ? 'copied' : 'plain');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the link is on screen to copy by hand */ }
  };

  const regenerate = () => {
    if (confirm('ליצור קישור חדש? הקישור הקודם יפסיק לעבוד מיד, וצריך יהיה לשלוח ללקוח את החדש.')) onRegenerate();
  };

  return (
    <Modal title={signed ? 'העותק החתום' : 'שליחה ללקוח'} open={open} onClose={onClose} size="lg">
      <div className="space-y-5">
        <div>
          <div className="text-[13px] text-muted mb-1.5">
            {signed ? 'הקישור מציג ללקוח את ההצעה כפי שנחתמה.' : 'הלקוח פותח את הקישור, קורא את ההצעה וחותם עליה — בלי הרשמה.'}
          </div>
          <div className="flex items-stretch gap-2">
            <input readOnly value={share.url} dir="ltr" onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 bg-soft border border-line rounded-lg px-3 py-2 text-[13px] text-ink-2 num" />
            <button type="button" onClick={copy}
              className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg border border-line-strong text-sm font-semibold text-ink-2 hover:bg-soft">
              {copied ? <><Check size={15} className="text-pos" /> הועתק</> : <><Copy size={15} /> העתקה</>}
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-2">
          <ShareLink href={whatsappUrl(share.phone, message)} icon={MessageCircle} label="וואטסאפ"
            sub={share.phone ? quote.client_phone ?? '' : 'בחירת איש קשר'} primary />
          <ShareLink onClick={() => openEmail('mail')} icon={Mail} label="אימייל"
            sub={share.email ?? 'כתובת תוקלד במייל'} />
          <ShareLink onClick={() => openEmail('gmail')} icon={Mail} label="Gmail"
            sub="בדפדפן" />
        </div>
        {emailState === 'copied' && (
          <div className="flex items-start gap-2.5 bg-pos-soft text-pos rounded-xl px-4 py-3 -mt-2 text-[13px]">
            <ClipboardCheck size={17} className="shrink-0 mt-px" />
            <div className="min-w-0">
              <div className="font-semibold">המייל המעוצב הועתק — הדביקו אותו בגוף ההודעה</div>
              <div className="opacity-85 mt-0.5">
                במחשב <span dir="ltr" className="num">⌘V</span> או <span dir="ltr" className="num">Ctrl+V</span>, בטלפון לחיצה ארוכה ← הדבקה.{' '}
                <button type="button" onClick={copyEmailAgain} className="underline font-semibold">העתקה שוב</button>
              </div>
            </div>
          </div>
        )}
        {emailState === 'plain' && (
          <div className="flex items-start gap-2.5 bg-warn-soft text-warn-ink rounded-xl px-4 py-3 -mt-2 text-[13px]">
            <AlertCircle size={17} className="shrink-0 mt-px" />
            <div>
              הדפדפן לא אפשר להעתיק את המייל המעוצב, אז הוא נפתח עם ההודעה כטקסט רגיל.{' '}
              <button type="button" onClick={copyEmailAgain} className="underline font-semibold">לנסות להעתיק שוב</button>
            </div>
          </div>
        )}
        {(!share.phone || !share.email) && (
          <p className="text-[12px] text-faint -mt-2">
            {!share.phone && !share.email ? 'אין בהצעה טלפון ואימייל של הלקוח' : !share.phone ? 'אין בהצעה טלפון של הלקוח' : 'אין בהצעה אימייל של הלקוח'}
            {' '}— אפשר להוסיף בפרטי הלקוח, או לבחור את הנמען אחרי הפתיחה.
          </p>
        )}

        <details className="group">
          <summary className="cursor-pointer text-[13px] font-semibold text-accent select-none">איך המייל ייראה</summary>
          {/* Never a script: the email is only looked at here. Same-origin only so its images load,
              as a sandbox with no origin at all is refused them. */}
          <iframe title="תצוגת המייל" srcDoc={emailPage} sandbox="allow-same-origin"
            className="mt-3 w-full h-[560px] rounded-xl border border-line bg-[#f1f0f5]" />
        </details>

        <details className="group">
          <summary className="cursor-pointer text-[13px] font-semibold text-accent select-none">עריכת ההודעה</summary>
          <div className="mt-3 space-y-3">
            <Textarea label="ההודעה (וואטסאפ ואימייל)" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
            <Input label="נושא האימייל" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <p className="text-[12px] text-faint">השינוי כאן הוא להודעה הזו בלבד. ההודעה הקבועה נמצאת בהגדרות.</p>
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-[13px]">
          <a href={share.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-accent hover:underline">
            <ExternalLink size={14} /> פתיחת הקישור, כמו שהלקוח יראה
          </a>
          {!signed && (
            <button type="button" onClick={regenerate} className="flex items-center gap-1.5 text-muted hover:text-ink-2">
              <RefreshCw size={14} /> קישור חדש במקום הזה
            </button>
          )}
        </div>
        <p className="text-[12px] text-faint -mt-3">פתיחה שלכם, כשאתם מחוברים, לא נספרת כצפייה של הלקוח.</p>
      </div>
    </Modal>
  );
}

/** A link that opens in a new tab, or — given `onClick` instead — a button that does its own opening. */
function ShareLink({ href, onClick, icon: Icon, label, sub, primary }: {
  href?: string;
  onClick?: () => void;
  icon: React.ElementType;
  label: string;
  sub: string;
  primary?: boolean;
}) {
  const className = primary
    ? 'flex items-center gap-2.5 rounded-xl px-4 py-3 bg-accent text-white hover:brightness-110 text-start'
    : 'flex items-center gap-2.5 rounded-xl px-4 py-3 bg-surface border border-line-strong text-ink-2 hover:bg-soft text-start';
  const content = (
    <>
      <Icon size={18} className="shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className={`block text-[12px] truncate ${primary ? 'opacity-80' : 'text-faint'}`} dir="auto">{sub}</span>
      </span>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={className}>{content}</button>
    : <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{content}</a>;
}
