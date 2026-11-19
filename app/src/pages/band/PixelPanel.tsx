import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, Mail, RefreshCw } from 'lucide-react';
import { get, put } from '../../api';
import { gmailUrl, mailtoUrl } from '../../../server/quoteShare';
import { Button, Input, LabeledSelect, Modal, Tag, Textarea } from '../../ui';
import { CopyButton, ddmm, when } from './advisorShared';
import { ActionButtons } from './MetaActions';

const CLUB_STATUSES = [
  { value: 'none', label: 'עוד לא ביקשנו' },
  { value: 'requested', label: 'ביקשנו מהמועדון' },
  { value: 'installed', label: 'המועדון אמר שהותקן' },
  { value: 'declined', label: 'המועדון סירב' },
] as const;

/** The events a ticket site sends, in the order a buyer passes them. */
const FUNNEL = ['PageView', 'ViewContent', 'InitiateCheckout', 'Purchase'];

/**
 * פיקסל ומעקב מכירות — the band's pixel, and every club whose ticket site should carry it.
 *
 * Whether a club «has the pixel» is shown two ways, kept apart on purpose: what the club said
 * (typed here), and whether the pixel actually received events on the club's ticket site (read
 * from Meta). Only the second makes a campaign optimised for purchases worth running.
 */
export function PixelPanel({ isOwner, onError, onChanged }: {
  isOwner: boolean;
  onError: (message: string) => void;
  /** Something changed in Meta (a pixel was created), so the actions log should re-read. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [emailVenue, setEmailVenue] = useState<string | null>(null);

  const load = (refresh = false) => {
    if (!isOwner) return;
    if (refresh) setRefreshing(true);
    get(`/band/pixel${refresh ? '?refresh=1' : ''}`)
      .then((d) => { setData(d); if (d.error) onError(`קריאת הפיקסל מ-Meta נכשלה: ${d.error}`); })
      .catch((e) => onError(e.message))
      .finally(() => setRefreshing(false));
  };
  // The first open reads Meta if the pixel was never read; after that the snapshot is enough.
  useEffect(() => {
    if (!isOwner) return;
    get('/band/pixel').then((d) => (d.snapshot || !d.meta_configured ? setData(d) : load(true))).catch((e) => onError(e.message));
  }, [isOwner]);

  if (!isOwner) return <p className="text-sm text-faint">מצב הפיקסל זמין לבעלים בלבד.</p>;
  if (!data) return <p className="text-sm text-faint">טוען…</p>;
  if (!data.meta_configured) return <p className="text-sm text-faint">Meta לא מוגדר — אין חשבון מודעות לקרוא ממנו את הפיקסל.</p>;

  const pixel = data.pixel;
  const saveVenue = async (venue: string, patch: Record<string, unknown>) => {
    try {
      const d = await put('/band/pixel/venue', { venue, ...patch });
      setData((cur: any) => ({ ...cur, venues: cur.venues.map((v: any) => (v.venue === venue ? d.venue : v)) }));
      return true;
    } catch (err: any) {
      onError(err.message);
      return false;
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-faint leading-relaxed">
        הכרטיסים נמכרים באתר של המועדון, אז Meta יודעת מי קנה רק אם מערכת הכרטיסים שלו מריצה את הפיקסל שלכם.
        עם פיקסל באתר — קמפיין מכירות שלומד ממי שקונה, ורימרקטינג למי שפתח את עמוד ההופעה ולא קנה.
      </p>

      {/* ---- the pixel itself */}
      <div className="rounded-xl border border-line p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-ink">הפיקסל של החשבון</h3>
          <div className="flex items-center gap-2">
            {data.snapshot && <span className="text-xs text-faint">נקרא {when(data.snapshot.read_at)}</span>}
            <button type="button" onClick={() => load(true)} disabled={refreshing}
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden /> רענון מ-Meta
            </button>
          </div>
        </div>
        {pixel ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink">{pixel.name ?? 'פיקסל'}</span>
              <span className="num text-muted" dir="ltr">{pixel.id}</span>
              <CopyButton text={pixel.id} label="העתקת מזהה הפיקסל" />
              <span className="text-xs text-faint">
                {pixel.last_fired_time ? `אירוע אחרון ${when(pixel.last_fired_time)}` : 'עוד לא קיבל אירועים'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FUNNEL.map((name) => (
                <Tag key={name} tone={pixel.events?.[name] ? 'pos' : 'neutral'}>
                  {name} · {pixel.events?.[name] ?? 0}
                </Tag>
              ))}
              <span className="text-xs text-faint self-center">ב-{data.snapshot?.days ?? 28} הימים האחרונים</span>
            </div>
            {pixel.stats_error && <p className="text-xs text-warn-ink">לא הצלחנו לקרוא את הספירות: {pixel.stats_error}</p>}
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted">{data.snapshot ? 'אין פיקסל בחשבון המודעות.' : 'הפיקסל עוד לא נקרא מ-Meta.'}</p>
            {data.snapshot && (
              <ActionButtons isOwner={isOwner} source="pixel" onError={onError}
                title="צריך פיקסל אחד שכל המועדונים יתקינו"
                actions={[{ type: 'create_pixel', level: null, id: null, name: null, daily_budget: null, end_date: null, reason: 'כדי שמועדונים יוכלו להתקין אותו במערכת הכרטיסים' }]}
                onDone={() => { load(true); onChanged(); }} />
            )}
          </div>
        )}
      </div>

      {/* ---- the clubs */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-ink">מועדונים עם הופעות קרובות</h3>
        {data.venues.length === 0 && <p className="text-sm text-faint">אין הופעות קרובות.</p>}
        <ul className="space-y-2">
          {data.venues.map((venue: any) => (
            <VenueRow key={venue.venue} venue={venue} read={!!data.snapshot}
              onSave={(patch) => saveVenue(venue.venue, patch)} onEmail={() => setEmailVenue(venue.venue)} />
          ))}
        </ul>
      </div>

      {emailVenue && (
        <PixelEmailModal venue={data.venues.find((v: any) => v.venue === emailVenue)} onClose={() => setEmailVenue(null)}
          onError={onError} onSent={(to) => saveVenue(emailVenue, {
            ...(to ? { contact_email: to } : {}),
            ...(data.venues.find((v: any) => v.venue === emailVenue)?.status === 'none' ? { status: 'requested' } : {}),
          })} />
      )}
    </div>
  );
}

function VenueRow({ venue, read, onSave, onEmail }: {
  venue: any;
  read: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
  onEmail: () => void;
}) {
  const [contact, setContact] = useState(venue.contact_email ?? '');
  const [platform, setPlatform] = useState(venue.platform ?? '');
  useEffect(() => { setContact(venue.contact_email ?? ''); setPlatform(venue.platform ?? ''); }, [venue.contact_email, venue.platform]);

  const blur = (field: 'contact_email' | 'platform', value: string, current: string | null) => {
    if (value.trim() !== (current ?? '')) onSave({ [field]: value.trim() });
  };

  return (
    <li className="rounded-xl border border-line p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{venue.venue}</span>
          <span className="text-xs text-muted">{venue.shows.map((s: any) => ddmm(s.date)).join(', ')}</span>
          {!read ? null : venue.verified ? (
            <Tag tone="pos"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden />הפיקסל נקלט באתר · {venue.events_on_site}</Tag>
          ) : venue.hosts.length ? (
            <Tag><CircleDashed className="w-3.5 h-3.5" aria-hidden />לא נקלט ב-{venue.hosts.join(', ')}</Tag>
          ) : (
            <Tag tone="warn">אין קישור לעמוד הכרטיסים. מוסיפים אותו ב«מצב הקמפיין» של ההופעה</Tag>
          )}
          {venue.status === 'requested' && venue.requested_at && <span className="text-xs text-faint">ביקשנו {when(venue.requested_at)}</span>}
        </div>
        <Button variant="ghost" className="!px-3 !py-1.5" onClick={onEmail}>
          <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" aria-hidden />מייל למועדון</span>
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <LabeledSelect label="מה המועדון אמר" value={venue.status} options={[...CLUB_STATUSES]}
          onChange={(status) => onSave({ status })} />
        <Input label="מייל של המועדון" dir="ltr" type="email" placeholder="tickets@…" value={contact}
          onChange={(e) => setContact(e.target.value)} onBlur={() => blur('contact_email', contact, venue.contact_email)} />
        <Input label="מערכת הכרטיסים" placeholder="למשל: אתר המועדון, מערכת כרטיסים חיצונית…" value={platform}
          onChange={(e) => setPlatform(e.target.value)} onBlur={() => blur('platform', platform, venue.platform)} />
      </div>
    </li>
  );
}

/**
 * The request to the club, opened in the owner's own mail app. Composed by the server from the pixel
 * id, the shows and the ticket pages, and editable here first; nothing is sent by the app itself.
 */
function PixelEmailModal({ venue, onClose, onError, onSent }: {
  venue: any;
  onClose: () => void;
  onError: (message: string) => void;
  onSent: (to: string) => void;
}) {
  const [email, setEmail] = useState<{ to: string; subject: string; body: string; warnings: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    get(`/band/pixel/email?venue=${encodeURIComponent(venue.venue)}`)
      .then((d) => setEmail({ ...d.email, to: d.email.to ?? '' }))
      .catch((e) => { onError(e.message); onClose(); });
  }, [venue.venue]);

  const open = (kind: 'gmail' | 'mail') => {
    if (!email) return;
    if (kind === 'gmail') window.open(gmailUrl(email.to, email.subject, email.body), '_blank', 'noopener');
    else window.location.href = mailtoUrl(email.to, email.subject, email.body);
    onSent(email.to.trim());
  };
  const copy = () => {
    if (!email) return;
    navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`).then(() => setCopied(true)).catch(() => {});
  };

  return (
    <Modal title={`מייל ל${venue.venue} — פיקסל בעמוד הכרטיסים`} open onClose={onClose} size="lg">
      {!email ? <p className="text-sm text-faint">מכין…</p> : (
        <div className="space-y-3">
          {email.warnings.length > 0 && (
            <ul className="rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn-ink list-disc ps-6 space-y-1">
              {email.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <Input label="אל" dir="ltr" type="email" value={email.to} placeholder="tickets@…"
            onChange={(e) => setEmail({ ...email, to: e.target.value })} />
          <Input label="נושא" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} />
          <Textarea label="ההודעה — אפשר לערוך לפני הפתיחה" rows={16} value={email.body}
            onChange={(e) => setEmail({ ...email, body: e.target.value })} />
          <p className="text-xs text-faint">
            המייל נפתח בתיבת הדואר שלכם, ושם שולחים אותו. המועדון יסומן «ביקשנו מהמועדון», והכתובת תישמר לפעם הבאה.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={copy}>{copied ? 'הועתק' : 'העתקת הטקסט'}</Button>
            <Button variant="ghost" onClick={() => open('mail')}>אפליקציית המייל</Button>
            <Button onClick={() => open('gmail')}>פתיחה ב-Gmail</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
