import { db, uuid, getSetting, setSetting, getVatPercent } from './db.js';
import { computeTotals, type QuoteLineInput } from './quoteMath.js';

/**
 * The band's price quotes — see docs/QUOTES-DESIGN.md for the whole of it.
 *
 * Everything here is the owner's and the band's alike: a quote is how a show gets sold, and
 * selling shows is something every member does. That is why nothing in this module asks who
 * the caller is beyond recording it.
 *
 * A template is a quote row with `is_template = 1`. It carries the usual intro, lines and
 * terms, so the everyday quote is a copy of it with a client, a date and a price filled in.
 */

/** What a show can be, in the order the picker offers it. */
export const EVENT_TYPES = [
  'חתונה', 'בר/בת מצווה', 'אירוע פרטי', 'אירוע חברה', 'מועדון/הופעה', 'פסטיבל', 'אחר',
] as const;

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'cancelled';
/** `expired` is worked out from the date, never stored — see `displayStatus`. */
export type DisplayStatus = QuoteStatus | 'expired';

/** Carries the HTTP status the router answers with, the same way the other modules' errors do. */
export class QuoteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- dates ----------

/**
 * Today as the band lives it. A quote valid «until the 14th» is valid all of the 14th in
 * Israel; a UTC date would expire it three hours early for half the year.
 */
export function todayInIsrael(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' as the client reads it. */
export const hebrewDate = (date: string | null | undefined) =>
  date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '';

/**
 * Where a quote stands, as the list should show it. A quote out with a client whose last day
 * has passed is expired without anybody having to mark it, and moving its date on reopens it.
 */
export function displayStatus(
  quote: { status: QuoteStatus; valid_until: string | null },
  today = todayInIsrael()
): DisplayStatus {
  if ((quote.status === 'sent' || quote.status === 'viewed') && quote.valid_until && today > quote.valid_until) {
    return 'expired';
  }
  return quote.status;
}

// ---------- settings ----------

export interface QuoteSettings {
  brand_name: string;
  contact_name: string;
  contact_phone: string;
  validity_days: number;
  prices_include_vat: boolean;
  default_template_id: string | null;
}

const clampDays = (value: unknown) => {
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : 14;
};

/**
 * The template «הצעה חדשה» starts from. The one chosen, while it still exists; otherwise the
 * oldest, so deleting the default never leaves the button with nothing to open.
 */
export function defaultTemplateId(): string | null {
  const chosen = getSetting('quote_default_template_id', '');
  if (chosen && db.prepare('SELECT 1 FROM band_quotes WHERE id = ? AND is_template = 1').get(chosen)) {
    return chosen;
  }
  const first = db
    .prepare('SELECT id FROM band_quotes WHERE is_template = 1 ORDER BY created_at, rowid LIMIT 1')
    .get() as { id: string } | undefined;
  return first?.id ?? null;
}

export function quoteSettings(): QuoteSettings {
  return {
    brand_name: getSetting('quote_brand_name', 'Moonlight'),
    contact_name: getSetting('quote_contact_name', ''),
    contact_phone: getSetting('quote_contact_phone', ''),
    validity_days: clampDays(getSetting('quote_validity_days', '14')),
    prices_include_vat: getSetting('quote_prices_include_vat', '0') === '1',
    default_template_id: defaultTemplateId(),
  };
}

export function saveQuoteSettings(patch: Partial<Record<keyof QuoteSettings, unknown>>): QuoteSettings {
  if (patch.brand_name !== undefined) {
    setSetting('quote_brand_name', String(patch.brand_name ?? '').trim() || 'Moonlight');
  }
  if (patch.contact_name !== undefined) setSetting('quote_contact_name', String(patch.contact_name ?? '').trim());
  if (patch.contact_phone !== undefined) setSetting('quote_contact_phone', String(patch.contact_phone ?? '').trim());
  if (patch.validity_days !== undefined) setSetting('quote_validity_days', String(clampDays(patch.validity_days)));
  if (patch.prices_include_vat !== undefined) setSetting('quote_prices_include_vat', patch.prices_include_vat ? '1' : '0');
  if (patch.default_template_id !== undefined) {
    const id = String(patch.default_template_id ?? '');
    if (id && !db.prepare('SELECT 1 FROM band_quotes WHERE id = ? AND is_template = 1').get(id)) {
      throw new QuoteError(400, 'התבנית לא נמצאה');
    }
    setSetting('quote_default_template_id', id);
  }
  return quoteSettings();
}

// ---------- reading ----------

/** The columns a list needs — not the signature image, which is most of a signed row's bytes. */
const LIST_COLUMNS = `
  q.id, q.is_template, q.template_name, q.quote_number, q.status, q.client_name, q.client_phone,
  q.event_type, q.event_date, q.event_location, q.title, q.valid_until, q.prices_include_vat,
  q.net_amount, q.vat_amount, q.total, q.show_id, q.sent_at, q.signed_at, q.created_at,
  q.updated_at, u.name AS created_by_name`;

const withStatus = <T extends { status: QuoteStatus; valid_until: string | null }>(row: T) =>
  ({ ...row, display_status: displayStatus(row) });

export function listQuotes() {
  const rows = db.prepare(
    `SELECT ${LIST_COLUMNS} FROM band_quotes q LEFT JOIN users u ON u.id = q.created_by
     WHERE q.is_template = 0 ORDER BY q.created_at DESC, q.rowid DESC`
  ).all() as any[];
  return rows.map(withStatus);
}

/** Each template with the line its price goes into, which is what the quick form asks about. */
export function listTemplates() {
  const rows = db.prepare(
    `SELECT ${LIST_COLUMNS},
       (SELECT name FROM band_quote_items i WHERE i.quote_id = q.id ORDER BY sort_order LIMIT 1) AS first_line_name,
       (SELECT unit_price FROM band_quote_items i WHERE i.quote_id = q.id ORDER BY sort_order LIMIT 1) AS first_line_price
     FROM band_quotes q LEFT JOIN users u ON u.id = q.created_by
     WHERE q.is_template = 1 ORDER BY q.created_at, q.rowid`
  ).all() as any[];
  const defaultId = defaultTemplateId();
  return rows.map((r) => ({ ...r, is_default: r.id === defaultId }));
}

function quoteRow(id: string): any {
  const row = db.prepare('SELECT * FROM band_quotes WHERE id = ?').get(id) as any;
  if (!row) throw new QuoteError(404, 'ההצעה לא נמצאה');
  return row;
}

function itemsOf(quoteId: string): any[] {
  return db.prepare('SELECT * FROM band_quote_items WHERE quote_id = ? ORDER BY sort_order').all(quoteId) as any[];
}

export function getQuote(id: string) {
  const row = quoteRow(id);
  const names = db.prepare(
    `SELECT (SELECT name FROM users WHERE id = ?) AS created_by_name,
            (SELECT name FROM users WHERE id = ?) AS updated_by_name`
  ).get(row.created_by, row.updated_by) as any;
  return {
    quote: { ...withStatus(row), ...names, is_default: !!row.is_template && row.id === defaultTemplateId() },
    items: itemsOf(id),
  };
}

// ---------- writing ----------

/** The fields a person edits. Everything else is set by what happens to the quote. */
const CONTENT_FIELDS = [
  'template_name', 'client_name', 'client_phone', 'client_email', 'client_tax_id',
  'event_type', 'event_date', 'event_location', 'guest_count', 'title', 'intro', 'terms',
  'valid_until', 'contact_name', 'contact_phone', 'internal_note', 'prices_include_vat', 'discount',
] as const;

type Content = Record<(typeof CONTENT_FIELDS)[number], any>;

/** How long each free-text field may run. A generous cap, but a cap: this ends up on a phone. */
const TEXT_LIMITS: Record<string, number> = {
  template_name: 120, client_name: 200, client_phone: 40, client_email: 200, client_tax_id: 20,
  event_location: 300, title: 200, intro: 5000, terms: 10000, contact_name: 120,
  contact_phone: 40, internal_note: 2000,
};

const FIELD_LABELS: Record<string, string> = {
  template_name: 'שם התבנית', client_name: 'שם הלקוח', client_phone: 'טלפון', client_email: 'אימייל',
  client_tax_id: 'ח.פ./ת.ז.', event_location: 'מקום', title: 'כותרת', intro: 'מלל פתיחה',
  terms: 'תנאים', contact_name: 'איש קשר', contact_phone: 'טלפון איש קשר', internal_note: 'הערה פנימית',
  event_date: 'תאריך האירוע', valid_until: 'תוקף ההצעה',
};

function text(field: string, value: unknown): string | null {
  const s = String(value ?? '').trim();
  const limit = TEXT_LIMITS[field];
  if (limit && s.length > limit) throw new QuoteError(400, `${FIELD_LABELS[field] ?? field} ארוך מדי`);
  return s || null;
}

function isoDate(field: string, value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  if (!valid) throw new QuoteError(400, `${FIELD_LABELS[field] ?? field} אינו תאריך תקין`);
  return s;
}

/** A form's worth of fields, cleaned: unknown keys dropped, text trimmed, dates checked. */
function cleanContent(input: Partial<Content>): Partial<Content> {
  const out: Partial<Content> = {};
  for (const field of CONTENT_FIELDS) {
    if (!(field in input)) continue;
    const value = (input as any)[field];
    if (field === 'event_date' || field === 'valid_until') out[field] = isoDate(field, value);
    else if (field === 'event_type') {
      const s = String(value ?? '').trim();
      if (s && !(EVENT_TYPES as readonly string[]).includes(s)) throw new QuoteError(400, 'סוג אירוע לא מוכר');
      out[field] = s || null;
    } else if (field === 'guest_count') {
      const n = parseInt(String(value ?? ''), 10);
      out[field] = Number.isFinite(n) && n > 0 ? n : null;
    } else if (field === 'client_name' || field === 'title') {
      // NOT NULL columns: a template has no client, and an emptied title is still a title.
      out[field] = text(field, value) ?? '';
    } else if (field === 'prices_include_vat') out[field] = value ? 1 : 0;
    else if (field === 'discount') {
      const n = Number(value);
      out[field] = Number.isFinite(n) && n > 0 ? n : 0;
    } else out[field] = text(field, value);
  }
  return out;
}

type Line = QuoteLineInput & { package_id: string | null };

const MAX_LINES = 100;

/**
 * The lines as the editor sent them. A line with neither a name nor a price is one somebody
 * added and never filled in, so it is dropped rather than refused; a priced line with no name
 * is refused, because the client would be asked to pay for something the quote does not name.
 */
function cleanLines(raw: unknown): Line[] {
  if (!Array.isArray(raw)) throw new QuoteError(400, 'שורות ההצעה חסרות');
  const lines = raw
    .map((r: any) => ({
      name: String(r?.name ?? '').trim(),
      description: String(r?.description ?? '').trim() || null,
      quantity: r?.quantity === undefined || r?.quantity === '' ? 1 : Number(r.quantity),
      unit_price: Number(r?.unit_price) || 0,
      package_id: String(r?.package_id ?? '').trim() || null,
    }))
    .filter((l) => l.name || l.unit_price);
  if (lines.length > MAX_LINES) throw new QuoteError(400, `אפשר עד ${MAX_LINES} שורות בהצעה`);
  if (lines.some((l) => !l.name)) throw new QuoteError(400, 'לכל שורה עם מחיר צריך שם');
  if (lines.some((l) => l.name.length > 200 || (l.description?.length ?? 0) > 1000)) {
    throw new QuoteError(400, 'שם או תיאור של שורה ארוך מדי');
  }
  return lines;
}

/** Signed is a record and cancelled is closed; either is changed by copying it, not editing it. */
const isEditable = (row: any) =>
  !!row.is_template || row.status === 'draft' || row.status === 'sent' || row.status === 'viewed';

/** Fills in the quote's number from the year's own sequence: ML-2026-001, ML-2026-002, … */
function nextQuoteNumber(today = todayInIsrael()): string {
  const year = today.slice(0, 4);
  const key = `quote_seq_${year}`;
  const next = (parseInt(getSetting(key, '0'), 10) || 0) + 1;
  setSetting(key, String(next));
  return `ML-${year}-${String(next).padStart(3, '0')}`;
}

const COLUMNS = [
  'is_template', ...CONTENT_FIELDS, 'quote_number', 'vat_percent', 'subtotal', 'net_amount',
  'vat_amount', 'total', 'created_by', 'updated_by',
] as const;

/** Writes the lines and the totals they add up to, in one go with the row they belong to. */
function writeLines(quoteId: string, lines: Line[]) {
  db.prepare('DELETE FROM band_quote_items WHERE quote_id = ?').run(quoteId);
  const insert = db.prepare(
    `INSERT INTO band_quote_items (id, quote_id, sort_order, name, description, quantity, unit_price, total, package_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const { lines: priced } = computeTotals(lines, 0, 0, false);
  priced.forEach((l, i) => {
    insert.run(uuid(), quoteId, i, l.name, l.description ?? null, l.quantity, l.unit_price, l.total, lines[i].package_id);
  });
}

function totalsFor(lines: Line[], content: { discount?: unknown; prices_include_vat?: unknown }, vatPercent: number) {
  const t = computeTotals(lines, content.discount, vatPercent, !!content.prices_include_vat);
  return { discount: t.discount, subtotal: t.subtotal, net_amount: t.net_amount, vat_amount: t.vat_amount, total: t.total };
}

/** Inserts a quote or template with its lines. Used by every way a quote comes into being. */
function insertQuote(content: Partial<Content> & { is_template: 0 | 1 }, lines: Line[], userId: string | null): string {
  const id = uuid();
  const vatPercent = getVatPercent();
  db.transaction(() => {
    const row: Record<string, unknown> = {
      ...content,
      quote_number: content.is_template ? null : nextQuoteNumber(),
      vat_percent: vatPercent,
      ...totalsFor(lines, content, vatPercent),
      created_by: userId,
      updated_by: userId,
    };
    const cols = COLUMNS.filter((c) => row[c] !== undefined);
    db.prepare(
      `INSERT INTO band_quotes (id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
    ).run(id, ...cols.map((c) => row[c] as any));
    writeLines(id, lines);
  })();
  return id;
}

/** What a new quote starts with before anything is typed into it. */
function freshQuoteDefaults(settings = quoteSettings()) {
  return {
    valid_until: addDays(todayInIsrael(), settings.validity_days),
    contact_name: settings.contact_name || null,
    contact_phone: settings.contact_phone || null,
    prices_include_vat: settings.prices_include_vat ? 1 : 0,
  };
}

export function createBlankQuote(input: Record<string, unknown>, userId: string | null): string {
  const content = cleanContent(input as Partial<Content>);
  const lines = input.items !== undefined ? cleanLines(input.items) : [];
  return insertQuote({ title: 'הצעת מחיר', ...freshQuoteDefaults(), ...content, is_template: 0 }, lines, userId);
}

/**
 * A new template starts with one line, because the quick form puts its price into the first
 * line and a template without one would have nowhere for it to go.
 */
export function createTemplate(input: Record<string, unknown>, userId: string | null): string {
  const settings = quoteSettings();
  const content = cleanContent(input as Partial<Content>);
  const firstTemplate = !settings.default_template_id;
  const id = insertQuote({
    template_name: 'תבנית רגילה',
    title: `הצעת מחיר להופעת ${settings.brand_name} — {client_name}`,
    prices_include_vat: settings.prices_include_vat ? 1 : 0,
    ...content,
    is_template: 1,
  }, input.items !== undefined
    ? cleanLines(input.items)
    : [{ name: `הופעת ${settings.brand_name}`, description: null, quantity: 1, unit_price: 0, package_id: null }],
  userId);
  if (firstTemplate) setSetting('quote_default_template_id', id);
  return id;
}

/** `{client_name}` and `{event_date}`, written out once, when a quote is made from a template. */
export function fillPlaceholders(value: string | null, fields: { client_name: string; event_date: string }): string | null {
  if (!value) return value;
  return value
    .replaceAll('{client_name}', fields.client_name)
    .replaceAll('{event_date}', hebrewDate(fields.event_date));
}

/** The content a copy of a quote takes with it. Never its number, link, status or signature. */
function copyableContent(row: any): Partial<Content> {
  const out: Partial<Content> = {};
  for (const field of CONTENT_FIELDS) (out as any)[field] = row[field];
  return out;
}

const linesOf = (quoteId: string): Line[] =>
  itemsOf(quoteId).map((i) => ({
    name: i.name, description: i.description, quantity: i.quantity, unit_price: i.unit_price,
    package_id: i.package_id,
  }));

/**
 * The everyday quote: the template's content, with the three things that change every time.
 *
 * The price goes into the template's first line — the show itself — and every other line keeps
 * the price the template gives it. What is taken fresh rather than copied is whatever depends on
 * today: the VAT rate, how long the quote is valid for, and who the client should call.
 */
export function createFromTemplate(
  templateId: string,
  input: { client_name?: unknown; client_phone?: unknown; event_date?: unknown; price?: unknown },
  userId: string | null
): string {
  const template = quoteRow(templateId);
  if (!template.is_template) throw new QuoteError(400, 'זו לא תבנית');
  const clientName = text('client_name', input.client_name);
  if (!clientName) throw new QuoteError(400, 'שם הלקוח חובה');
  const eventDate = isoDate('event_date', input.event_date);
  if (!eventDate) throw new QuoteError(400, 'תאריך האירוע חובה');
  const price = Number(input.price);
  if (input.price === undefined || input.price === '' || !Number.isFinite(price) || price < 0) {
    throw new QuoteError(400, 'מחיר חובה');
  }

  const settings = quoteSettings();
  const lines = linesOf(templateId);
  if (lines.length) lines[0] = { ...lines[0], unit_price: price };
  else lines.push({ name: `הופעת ${settings.brand_name}`, description: null, quantity: 1, unit_price: price, package_id: null });

  const fields = { client_name: clientName, event_date: eventDate };
  const defaults = freshQuoteDefaults(settings);
  return insertQuote({
    ...copyableContent(template),
    template_name: null,
    title: fillPlaceholders(template.title, fields) || 'הצעת מחיר',
    intro: fillPlaceholders(template.intro, fields),
    client_name: clientName,
    client_phone: text('client_phone', input.client_phone),
    event_date: eventDate,
    valid_until: defaults.valid_until,
    // The template's own contact wins where it has one; the settings are the fallback.
    contact_name: template.contact_name || defaults.contact_name,
    contact_phone: template.contact_phone || defaults.contact_phone,
    // A note about the template is not a note about this client's quote.
    internal_note: null,
    is_template: 0,
  }, lines, userId);
}

/**
 * Saves an edit. Lines, when sent, replace the quote's lines as a whole — the editor always
 * sends every line in its order, so there is nothing to merge. The totals are always worked
 * out again here; whatever totals the caller sent are ignored.
 */
export function updateQuote(id: string, input: Record<string, unknown>, userId: string | null) {
  const existing = quoteRow(id);
  if (!isEditable(existing)) {
    throw new QuoteError(409, existing.status === 'signed'
      ? 'הצעה חתומה אינה ניתנת לעריכה — שכפלו אותה כדי להציע מחדש'
      : 'הצעה שבוטלה אינה ניתנת לעריכה — שכפלו אותה כדי להציע מחדש');
  }
  const content = cleanContent(input as Partial<Content>);
  // A template has no validity of its own; one only starts when a quote is made from it.
  if (existing.is_template) delete content.valid_until;
  else delete content.template_name;
  const merged = { ...existing, ...content };
  const lines = input.items !== undefined ? cleanLines(input.items) : linesOf(id);
  const totals = totalsFor(lines, merged, existing.vat_percent);

  db.transaction(() => {
    const row: Record<string, unknown> = { ...content, ...totals, updated_by: userId };
    const cols = Object.keys(row);
    db.prepare(
      `UPDATE band_quotes SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
    ).run(...cols.map((c) => row[c] as any), id);
    if (input.items !== undefined) writeLines(id, lines);
  })();
  return getQuote(id);
}

/**
 * A new draft with the same content. A copy of a quote is usually the same client asked again
 * with a different price, so the client stays; what depends on today is taken fresh, exactly as
 * for a quote made from a template. A copy of a template is another template.
 */
export function duplicateQuote(id: string, userId: string | null): string {
  const source = quoteRow(id);
  const content = copyableContent(source);
  if (source.is_template) {
    return insertQuote({ ...content, template_name: `${source.template_name || 'תבנית'} (עותק)`, is_template: 1 }, linesOf(id), userId);
  }
  const defaults = freshQuoteDefaults();
  return insertQuote({ ...content, valid_until: defaults.valid_until, is_template: 0 }, linesOf(id), userId);
}

/**
 * Keeps a quote that came out right as the starting point for the next ones. The client and the
 * date belong to this one quote and stay behind.
 */
export function saveAsTemplate(id: string, name: unknown, userId: string | null): string {
  const source = quoteRow(id);
  if (source.is_template) throw new QuoteError(400, 'זו כבר תבנית');
  const templateName = text('template_name', name);
  if (!templateName) throw new QuoteError(400, 'שם התבנית חובה');
  const firstTemplate = !defaultTemplateId();
  const newId = insertQuote({
    ...copyableContent(source),
    template_name: templateName,
    client_name: '', client_phone: null, client_email: null, client_tax_id: null,
    event_date: null, event_location: null, guest_count: null, valid_until: null,
    internal_note: null,
    is_template: 1,
  }, linesOf(id), userId);
  if (firstTemplate) setSetting('quote_default_template_id', newId);
  return newId;
}

export function cancelQuote(id: string, userId: string | null) {
  const row = quoteRow(id);
  if (row.is_template) throw new QuoteError(400, 'תבנית לא מבטלים — מוחקים');
  if (row.status === 'signed') throw new QuoteError(409, 'הצעה חתומה אינה ניתנת לביטול');
  if (row.status === 'cancelled') return getQuote(id);
  db.prepare(
    `UPDATE band_quotes SET status = 'cancelled', cancelled_at = datetime('now'), updated_by = ?,
       updated_at = datetime('now') WHERE id = ?`
  ).run(userId, id);
  return getQuote(id);
}

/**
 * A draft nobody was sent, a cancelled quote and a template can go. A quote a client may be
 * holding is cancelled rather than deleted, so its link says so instead of saying nothing.
 */
export function deleteQuote(id: string) {
  const row = quoteRow(id);
  if (!row.is_template && row.status !== 'draft' && row.status !== 'cancelled') {
    throw new QuoteError(409, 'אפשר למחוק רק טיוטה או הצעה שבוטלה — בטלו אותה קודם');
  }
  db.prepare('DELETE FROM band_quotes WHERE id = ?').run(id);
}

// ---------- packages ----------

export function listPackages() {
  return db.prepare('SELECT * FROM band_quote_packages ORDER BY active DESC, sort_order, name').all();
}

function cleanPackage(input: any, existing?: any) {
  const b = { ...(existing ?? {}), ...(input ?? {}) };
  const name = String(b.name ?? '').trim();
  if (!name) throw new QuoteError(400, 'שם החבילה חובה');
  if (name.length > 200) throw new QuoteError(400, 'שם החבילה ארוך מדי');
  const description = String(b.description ?? '').trim();
  if (description.length > 1000) throw new QuoteError(400, 'תיאור החבילה ארוך מדי');
  const price = Number(b.unit_price);
  return {
    name,
    description: description || null,
    unit_price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : 0,
    active: b.active === undefined || b.active ? 1 : 0,
    sort_order: parseInt(String(b.sort_order ?? 0), 10) || 0,
  };
}

export function createPackage(input: unknown) {
  const p = cleanPackage(input);
  const id = uuid();
  db.prepare(
    'INSERT INTO band_quote_packages (id, name, description, unit_price, active, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, p.name, p.description, p.unit_price, p.active, p.sort_order);
  return db.prepare('SELECT * FROM band_quote_packages WHERE id = ?').get(id);
}

export function updatePackage(id: string, input: unknown) {
  const existing = db.prepare('SELECT * FROM band_quote_packages WHERE id = ?').get(id);
  if (!existing) throw new QuoteError(404, 'החבילה לא נמצאה');
  const p = cleanPackage(input, existing);
  db.prepare(
    'UPDATE band_quote_packages SET name = ?, description = ?, unit_price = ?, active = ?, sort_order = ? WHERE id = ?'
  ).run(p.name, p.description, p.unit_price, p.active, p.sort_order, id);
  return db.prepare('SELECT * FROM band_quote_packages WHERE id = ?').get(id);
}

/** Lines already copied from the package keep what they copied; only the price list loses it. */
export function deletePackage(id: string) {
  db.prepare('DELETE FROM band_quote_packages WHERE id = ?').run(id);
}
