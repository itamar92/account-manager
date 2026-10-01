import { randomBytes } from 'crypto';
import { db, getSetting, sha256 } from './db.js';
import { computeTotals, type QuoteTotals } from './quoteMath.js';
import { brandingImage, type BrandingKind } from './quoteFiles.js';
import { QuoteError, displayStatus, hebrewDate, quoteSettings, todayInIsrael } from './quotes.js';
import { fillMessage, whatsappNumber } from './quoteShare.js';
import { afterSigning } from './quoteShow.js';

/**
 * The client's side of a quote: the link it is sent as, what that link shows, and the signature
 * that closes it. See docs/QUOTES-DESIGN.md, «Lifecycle» and «Public routes».
 *
 * The link's token is the only thing that lets anyone in, so everything here is reached by it
 * and shows that one quote and nothing else — and only what the client is meant to read of it.
 * The internal note, who made the quote and the client's own details stay on the band's side.
 */

/** 32 random bytes: nobody finds a quote by guessing its link. */
const newToken = () => randomBytes(32).toString('base64url');

/** The moment as SQLite's datetime('now') writes it, so the snapshot and the row agree. */
const sqliteNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function rowById(id: string): any {
  const row = db.prepare('SELECT * FROM band_quotes WHERE id = ?').get(id) as any;
  if (!row) throw new QuoteError(404, 'ההצעה לא נמצאה');
  return row;
}

function rowByToken(token: string): any {
  const row = typeof token === 'string' && token.length >= 20
    ? db.prepare('SELECT * FROM band_quotes WHERE public_token = ? AND is_template = 0').get(token) as any
    : null;
  if (!row) throw new QuoteError(404, 'הקישור אינו תקין, או שהוחלף בקישור חדש');
  return row;
}

// ---------- sending ----------

export interface ShareDetails {
  url: string;
  message: string;
  subject: string;
  /** As WhatsApp addresses it, or null to let WhatsApp ask. */
  phone: string | null;
  email: string | null;
}

export const quoteUrl = (baseUrl: string, token: string) => `${baseUrl.replace(/\/+$/, '')}/q/${token}`;

function shareFor(row: any, url: string): ShareDetails {
  const settings = quoteSettings();
  const fields = {
    client_name: row.client_name || '',
    title: row.title || 'הצעת מחיר',
    event_date: hebrewDate(row.event_date),
    valid_until: hebrewDate(row.valid_until),
    link: url,
    contact_name: row.contact_name || settings.contact_name || '',
    quote_number: row.quote_number || '',
  };
  return {
    url,
    message: fillMessage(settings.message_template, fields),
    subject: fillMessage(settings.email_subject, fields),
    phone: whatsappNumber(row.client_phone),
    email: row.client_email || null,
  };
}

/** What a quote needs before a client can be asked to sign it, as the one sentence to fix. */
function readyToSend(row: any): string | null {
  if (!row.client_name?.trim()) return 'חסר שם לקוח';
  if (!row.event_date) return 'חסר תאריך אירוע';
  const lines = db.prepare('SELECT COUNT(*) AS n FROM band_quote_items WHERE quote_id = ?').get(row.id) as { n: number };
  if (!lines.n) return 'אין בהצעה אף שורה';
  if (!row.valid_until) return 'חסר תאריך «בתוקף עד»';
  if (todayInIsrael() > row.valid_until) return 'תוקף ההצעה עבר — עדכנו את «בתוקף עד» ושלחו שוב';
  return null;
}

/**
 * Gives the quote its link and marks it sent. Sending again only hands the link back: a quote
 * already with the client keeps its status and its link, and a signed one is sent as the signed
 * copy it now is.
 */
export function sendQuote(id: string, userId: string | null, baseUrl: string): ShareDetails {
  const row = rowById(id);
  if (row.is_template) throw new QuoteError(400, 'תבנית לא שולחים — צרו ממנה הצעה');
  if (row.status === 'cancelled') throw new QuoteError(409, 'ההצעה בוטלה — שכפלו אותה כדי לשלוח הצעה חדשה');
  if (row.status !== 'signed') {
    const problem = readyToSend(row);
    if (problem) throw new QuoteError(400, problem);
  }
  const token = row.public_token || newToken();
  // updated_at is the version the client signs against, and sending changes nothing they read.
  db.prepare(
    `UPDATE band_quotes SET public_token = ?,
       status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
       sent_at = COALESCE(sent_at, datetime('now')),
       updated_by = COALESCE(?, updated_by)
     WHERE id = ?`
  ).run(token, userId, id);
  return shareFor(rowById(id), quoteUrl(baseUrl, token));
}

/**
 * A new link in place of the old one, which stops working at once — for a link that reached
 * someone it should not have. A signed quote keeps its link: it is the client's copy of what
 * they signed.
 */
export function regenerateLink(id: string, baseUrl: string): ShareDetails {
  const row = rowById(id);
  if (!row.public_token) throw new QuoteError(400, 'ההצעה עוד לא נשלחה');
  if (row.status === 'signed') throw new QuoteError(409, 'להצעה חתומה נשאר הקישור שלה — זה העותק החתום של הלקוח');
  const token = newToken();
  db.prepare('UPDATE band_quotes SET public_token = ? WHERE id = ?').run(token, id);
  return shareFor(rowById(id), quoteUrl(baseUrl, token));
}

// ---------- what the client sees ----------

/** What of a quote the client reads. Nothing else of the row leaves the server by its link. */
const CLIENT_FIELDS = [
  'quote_number', 'title', 'client_name', 'event_type', 'event_date', 'event_location',
  'guest_count', 'show_duration', 'intro', 'terms', 'valid_until', 'contact_name',
  'contact_phone', 'prices_include_vat', 'vat_percent', 'discount', 'created_at',
] as const;

export interface PublicBranding {
  brand_name: string;
  logo_url: string | null;
  color_primary: string;
  color_accent: string;
  signature_url: string | null;
  signature_name: string;
}

export type PublicState = 'open' | 'expired' | 'cancelled' | 'signed';

export interface PublicQuote {
  state: PublicState;
  quote: Record<(typeof CLIENT_FIELDS)[number], any> | null;
  totals: QuoteTotals | null;
  branding: PublicBranding;
  /** The `updated_at` the page shows; signing a different one is refused. */
  version: string | null;
  signature: { signer_name: string; signed_at: string; png: string } | null;
}

const fileId = (kind: BrandingKind) => getSetting(`quote_${kind}_file_id`, '');

/** The images by the link itself, so the client never needs the band's login to see them. */
const publicImageUrl = (token: string, kind: BrandingKind) => {
  const id = fileId(kind);
  return id && brandingImage(kind) ? `/api/public/quotes/${token}/branding/${kind}?v=${id}` : null;
};

function liveBranding(token: string): PublicBranding {
  const s = quoteSettings();
  return {
    brand_name: s.brand_name,
    logo_url: publicImageUrl(token, 'logo'),
    color_primary: s.color_primary,
    color_accent: s.color_accent,
    signature_url: publicImageUrl(token, 'signature'),
    signature_name: s.signature_name,
  };
}

function documentOf(row: any) {
  const quote = Object.fromEntries(CLIENT_FIELDS.map((f) => [f, row[f] ?? null])) as PublicQuote['quote'];
  const items = db.prepare(
    'SELECT name, description, quantity, unit_price FROM band_quote_items WHERE quote_id = ? ORDER BY sort_order'
  ).all(row.id) as any[];
  return { quote, totals: computeTotals(items, row.discount, row.vat_percent, !!row.prices_include_vat) };
}

/**
 * The quote as its link shows it. A signed quote is shown from its snapshot — exactly what was
 * signed, whatever has changed in the settings since — and a cancelled one shows nothing of
 * itself but who to call.
 */
export function publicQuote(token: string): PublicQuote {
  const row = rowByToken(token);
  if (row.status === 'signed' && row.signed_snapshot) {
    const snapshot = JSON.parse(row.signed_snapshot);
    return {
      state: 'signed',
      quote: snapshot.quote,
      totals: snapshot.totals,
      // The logo is the band's look, which may change; the band's signature is part of the record.
      branding: { ...snapshot.branding, logo_url: publicImageUrl(token, 'logo') },
      version: null,
      signature: { signer_name: row.signer_name, signed_at: row.signed_at, png: row.signature_png },
    };
  }
  const branding = liveBranding(token);
  if (row.status === 'cancelled') {
    return {
      state: 'cancelled',
      quote: { ...Object.fromEntries(CLIENT_FIELDS.map((f) => [f, null])), contact_name: row.contact_name, contact_phone: row.contact_phone } as any,
      totals: null, branding, version: null, signature: null,
    };
  }
  const { quote, totals } = documentOf(row);
  return {
    state: displayStatus(row) === 'expired' ? 'expired' : 'open',
    quote, totals, branding, version: row.updated_at, signature: null,
  };
}

/**
 * Counts a visit by the client. The band opening the link — to check what the client sees —
 * is not the client reading it, so a visitor with a session is left out; the router decides that.
 */
export function markViewed(token: string) {
  db.prepare(
    `UPDATE band_quotes SET
       view_count = view_count + 1,
       first_viewed_at = COALESCE(first_viewed_at, datetime('now')),
       last_viewed_at = datetime('now'),
       status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END
     WHERE public_token = ? AND is_template = 0 AND status IN ('sent', 'viewed')`
  ).run(token);
}

/** The band's signature as it was when the client signed, kept inside the record itself. */
function bandSignatureDataUrl(): string | null {
  const image = brandingImage('signature');
  return image ? `data:${image.mime};base64,${Buffer.from(image.data).toString('base64')}` : null;
}

const MAX_SIGNATURE_CHARS = 300 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';

/**
 * The client signs. Every check is here, not on the page: the quote must still be open, the
 * client must have signed the version on their screen, and the signature must be a PNG of a
 * reasonable size. The row is then closed in one conditional update, so two taps on «אישור»
 * cannot sign it twice and an edit saved a moment earlier cannot be signed unseen.
 */
export function signQuote(
  token: string,
  input: { signer_name?: unknown; signature_png?: unknown; consent?: unknown; version?: unknown },
  meta: { ip: string; userAgent: string }
): PublicQuote {
  const row = rowByToken(token);
  if (row.status === 'signed') throw new QuoteError(409, 'ההצעה כבר נחתמה');
  if (row.status === 'cancelled') throw new QuoteError(409, 'ההצעה בוטלה ואינה ניתנת לחתימה');
  if (displayStatus(row) === 'expired') throw new QuoteError(409, 'תוקף ההצעה עבר — פנו אלינו לחידוש');
  if (row.status !== 'sent' && row.status !== 'viewed') throw new QuoteError(409, 'ההצעה אינה פתוחה לחתימה');
  if (input.version !== row.updated_at) {
    throw new QuoteError(409, 'ההצעה עודכנה בזמן שקראתם אותה. עברו עליה שוב, ואז חתמו.');
  }

  const signerName = String(input.signer_name ?? '').trim();
  if (!signerName) throw new QuoteError(400, 'נא למלא שם מלא');
  if (signerName.length > 120) throw new QuoteError(400, 'השם ארוך מדי');
  if (input.consent !== true) throw new QuoteError(400, 'יש לאשר את ההצעה ואת תנאיה');
  const png = String(input.signature_png ?? '');
  if (!png.startsWith(PNG_PREFIX) || png.length > MAX_SIGNATURE_CHARS) throw new QuoteError(400, 'החתימה אינה תקינה');
  const bytes = Buffer.from(png.slice(PNG_PREFIX.length), 'base64');
  if (bytes.length < 100 || bytes.subarray(0, 4).toString('hex') !== '89504e47') throw new QuoteError(400, 'החתימה אינה תקינה');

  const signedAt = sqliteNow();
  const { quote, totals } = documentOf(row);
  const live = liveBranding(token);
  const snapshot = JSON.stringify({
    version: 1,
    quote,
    totals,
    branding: {
      brand_name: live.brand_name,
      color_primary: live.color_primary,
      color_accent: live.color_accent,
      signature_name: live.signature_name,
      signature_url: bandSignatureDataUrl(),
    },
    signer: { name: signerName, signed_at: signedAt },
  });

  const result = db.prepare(
    `UPDATE band_quotes SET status = 'signed', signed_at = ?, signer_name = ?, signature_png = ?,
       signer_ip = ?, signer_user_agent = ?, signed_snapshot = ?, signed_snapshot_sha256 = ?,
       updated_at = datetime('now')
     WHERE id = ? AND status IN ('sent', 'viewed') AND updated_at = ?`
  ).run(signedAt, signerName, png, meta.ip.slice(0, 64), meta.userAgent.slice(0, 500),
    snapshot, sha256(snapshot), row.id, row.updated_at);
  if (result.changes !== 1) throw new QuoteError(409, 'ההצעה השתנתה רגע לפני החתימה. טענו אותה מחדש.');
  // The signature is in. Making it a show comes after, and cannot take the signature back.
  afterSigning(row.id);
  return publicQuote(token);
}
