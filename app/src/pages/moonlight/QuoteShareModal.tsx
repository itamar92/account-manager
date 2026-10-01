import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Mail, MessageCircle, RefreshCw } from 'lucide-react';
import { Input, Modal, Textarea } from '../../ui';
import { gmailUrl, mailtoUrl, whatsappUrl } from '../../../server/quoteShare';
import type { Quote, ShareDetails } from './quotes';

/**
 * The quote's link, and the ways to get it to the client.
 *
 * Nothing here is sent by the app. WhatsApp, the mail app and Gmail each open with the message
 * already written, from the sender's own account, so the client's answer comes back to a person.
 * The message can be changed first; the links are rebuilt from whatever it says.
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

  useEffect(() => {
    if (share) { setMessage(share.message); setSubject(share.subject); setCopied(false); }
  }, [share]);

  if (!share) return null;
  const signed = quote.status === 'signed';

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
          <ShareLink href={mailtoUrl(share.email, subject, message)} icon={Mail} label="אימייל"
            sub={share.email ?? 'כתובת תוקלד במייל'} external={false} />
          <ShareLink href={gmailUrl(share.email, subject, message)} icon={Mail} label="Gmail"
            sub="בדפדפן" />
        </div>
        {(!share.phone || !share.email) && (
          <p className="text-[12px] text-faint -mt-2">
            {!share.phone && !share.email ? 'אין בהצעה טלפון ואימייל של הלקוח' : !share.phone ? 'אין בהצעה טלפון של הלקוח' : 'אין בהצעה אימייל של הלקוח'}
            {' '}— אפשר להוסיף בפרטי הלקוח, או לבחור את הנמען אחרי הפתיחה.
          </p>
        )}

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

function ShareLink({ href, icon: Icon, label, sub, primary, external = true }: {
  href: string;
  icon: React.ElementType;
  label: string;
  sub: string;
  primary?: boolean;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={primary
        ? 'flex items-center gap-2.5 rounded-xl px-4 py-3 bg-accent text-white hover:brightness-110'
        : 'flex items-center gap-2.5 rounded-xl px-4 py-3 bg-surface border border-line-strong text-ink-2 hover:bg-soft'}
    >
      <Icon size={18} className="shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className={`block text-[12px] truncate ${primary ? 'opacity-80' : 'text-faint'}`} dir="auto">{sub}</span>
      </span>
    </a>
  );
}
