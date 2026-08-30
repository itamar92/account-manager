/**
 * What the band calls somebody, and what their invoices are headed with.
 *
 * These are almost never the same string. אבי is «אבי סאונד» in the diary and «א. כהן הפקות
 * בע"מ» on the document; the hall is booked by its stage name and invoices under the company
 * that owns it. A tax id settles it where there is one, but Morning does not always carry one
 * and nobody types it in for a supplier they pay by Bit.
 *
 * So the mapping is a thing a person maintains: said once, from the screen where its absence
 * was noticed, and used by every match afterwards. That is what makes an alias here stronger
 * than the resemblance between two spellings — the resemblance is a guess, and this is
 * somebody who knows having said so.
 */
import { db, uuid, getSetting, setSetting } from './db.js';
import {
  keyOf, listPayees, payeeColumns, payeeKey, payeeRef, type Payee, type PayeeKind,
} from './payees.js';

/**
 * Reduces a name to what two spellings of the same business have in common.
 *
 * Quotes, geresh, the legal suffix and the punctuation around it are all noise here: «א. כהן
 * הפקות בע"מ» and «א כהן הפקות» are one supplier.
 *
 * The suffix is matched between spaces rather than on a word boundary. \b is defined on Latin
 * word characters, so a Hebrew word never has one on either side and the בע"מ this function
 * claimed to drop was in fact left in every name it ever normalised — which is precisely how
 * the invoice spelling and the diary spelling failed to meet.
 */
export function normalizeName(value: unknown): string {
  return String(value || '')
    .replace(/["'״׳`.,\-–—()]/g, ' ')
    .replace(/(^|\s)(בע\s*מ|בעמ|ltd|llc|inc)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Words long enough to say something. A one-letter initial matches half the phone book. */
const tokensOf = (normalized: string): string[] =>
  normalized.split(' ').filter((t) => t.length >= 2);

/**
 * How much two names look like each other, 0…1 — a hint for ordering suggestions, never a
 * reason to link anything on its own.
 *
 * Containment scores high because that is the shape the difference usually takes: the invoice
 * name is the diary name with a company wrapped around it. Below that it is the proportion of
 * the shorter name's words that appear in the longer one, so «אבי כהן» and «א. כהן הפקות»
 * still find each other on the surname they share.
 */
export function nameSimilarity(a: unknown, b: unknown): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return 0.9;
  const ax = tokensOf(x);
  const bx = tokensOf(y);
  if (!ax.length || !bx.length) return 0;
  const shared = ax.filter((t) => bx.includes(t)).length;
  return shared / Math.min(ax.length, bx.length);
}

/** Similar enough to be worth offering. Deliberately generous: a person confirms every one. */
export const SIMILAR_ENOUGH = 0.45;

export type AliasSource = 'manual' | 'link' | 'migration';

export interface SupplierAlias {
  id: string;
  supplier_id: string | null;
  member_key: string | null;
  alias: string;
  normalized: string;
  source: AliasSource;
  created_at: string;
}

export const aliasesFor = (kind: PayeeKind, id: string): SupplierAlias[] =>
  db
    .prepare(
      `SELECT * FROM band_supplier_aliases
        WHERE ${kind === 'member' ? 'member_key' : 'supplier_id'} = ? ORDER BY alias`
    )
    .all(id) as SupplierAlias[];

export const aliasesForPayee = (payee: { kind: PayeeKind; id: string }): SupplierAlias[] =>
  aliasesFor(payee.kind, payee.id);

export const allAliases = (): SupplierAlias[] =>
  db.prepare('SELECT * FROM band_supplier_aliases ORDER BY alias').all() as SupplierAlias[];

/** Normalized invoice name → payee key. One pass, for the loops that resolve many documents. */
export function aliasMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of allAliases()) {
    const ref = payeeRef(row);
    if (ref) map.set(row.normalized, payeeKey(ref.kind, ref.id));
  }
  return map;
}

/** Payee key → the names they answer to. One pass, for loops that ask about many documents. */
export function aliasNamesByPayee(): Map<string, string[]> {
  const byPayee = new Map<string, string[]>();
  for (const row of allAliases()) {
    const ref = payeeRef(row);
    if (!ref) continue;
    const key = payeeKey(ref.kind, ref.id);
    byPayee.set(key, [...(byPayee.get(key) || []), row.alias]);
  }
  return byPayee;
}

/** The alias list of each supplier as one editable line — what the supplier dialog shows. */
export function aliasTextBySupplier(): Map<string, string> {
  const bySupplier = new Map<string, string[]>();
  for (const row of allAliases()) {
    if (!row.supplier_id) continue;
    bySupplier.set(row.supplier_id, [...(bySupplier.get(row.supplier_id) || []), row.alias]);
  }
  return new Map([...bySupplier].map(([id, names]) => [id, names.join(', ')]));
}

/**
 * Ties one invoice name to one supplier.
 *
 * A name already tied to somebody else is refused rather than moved: the two suppliers cannot
 * both be right, and silently re-pointing it would change what every past match meant without
 * anybody being told. Re-adding a name the supplier already has is a no-op, so the same
 * document can be confirmed twice without complaint.
 */
export function addAlias(
  payee: { kind: PayeeKind; id: string },
  alias: string,
  source: AliasSource = 'manual'
): SupplierAlias {
  const text = String(alias || '').trim();
  const normalized = normalizeName(text);
  if (!normalized) throw Object.assign(new Error('שם חלופי ריק'), { status: 400 });

  const owner = listPayees().find((p) => p.kind === payee.kind && p.id === payee.id);
  if (!owner) throw Object.assign(new Error('payee not found'), { status: 404 });

  const existing = db
    .prepare('SELECT * FROM band_supplier_aliases WHERE normalized = ?')
    .get(normalized) as SupplierAlias | undefined;
  if (existing) {
    const ref = payeeRef(existing);
    if (ref && ref.kind === payee.kind && ref.id === payee.id) return existing;
    const taken = ref && listPayees().find((p) => p.kind === ref.kind && p.id === ref.id);
    throw Object.assign(
      new Error(`השם «${text}» כבר משויך ל«${taken?.name ?? '?'}»`),
      { status: 409 }
    );
  }

  const id = uuid();
  const columns = payeeColumns(payee);
  db.prepare(
    `INSERT INTO band_supplier_aliases (id, supplier_id, member_key, alias, normalized, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, columns.supplier_id, columns.member_key, text, normalized, source);
  return db.prepare('SELECT * FROM band_supplier_aliases WHERE id = ?').get(id) as SupplierAlias;
}

export function removeAlias(id: string): void {
  const result = db.prepare('DELETE FROM band_supplier_aliases WHERE id = ?').run(id);
  if (!result.changes) throw Object.assign(new Error('alias not found'), { status: 404 });
}

/**
 * Replaces a supplier's names with the ones on a comma- or newline-separated line.
 *
 * The supplier dialog edits them as text, which is the fastest way to fix a typo in one of
 * three names. Rows whose normalized value survives the edit are kept rather than rewritten,
 * so an alias learned from a document does not lose how it came to be there because somebody
 * corrected the spelling of a different one.
 */
export const setAliasesFromText = db.transaction((
  payee: { kind: PayeeKind; id: string },
  text: unknown
): void => {
  const wanted = String(text ?? '')
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const keep = new Set<string>();
  for (const alias of wanted) {
    const normalized = normalizeName(alias);
    if (!normalized || keep.has(normalized)) continue;
    keep.add(normalized);
    addAlias(payee, alias, 'manual');
  }

  for (const row of aliasesFor(payee.kind, payee.id)) {
    if (!keep.has(row.normalized)) removeAlias(row.id);
  }
});

/**
 * Every invoice name Morning has sent that nobody answers to — the queue of this screen.
 *
 * A document nobody can place is the reason a payment sits waiting with no suggestion under
 * it, so the fix belongs here beside the mapping rather than only inside one payment: naming
 * the payee once places every document that name has ever arrived on, and every one still to
 * come. Members are offered alongside suppliers, because a member who invoices the band for
 * their share is a name on a document exactly like anybody else.
 *
 * Names are grouped by their normalized form so three spellings of one business are three
 * rows only if they really do differ; what is shown is the spelling that arrived most
 * recently, because that is the one the next document will most likely carry.
 */
export function unknownInvoiceNames(payees: Payee[]): Array<{
  name: string;
  normalized: string;
  docs: number;
  total: number;
  last_date: string;
  suggestion: { kind: PayeeKind; id: string; name: string; score: number } | null;
}> {
  const known = aliasMap();
  const byIdentity = new Map<string, Payee>();
  for (const payee of payees) {
    const morningId = String(payee.morning_supplier_id || '').trim();
    if (morningId) byIdentity.set(`m:${morningId}`, payee);
    const taxId = String(payee.tax_id || '').replace(/\D/g, '');
    if (taxId) byIdentity.set(`t:${taxId}`, payee);
    byIdentity.set(`n:${normalizeName(payee.name)}`, payee);
  }

  const rows = db
    .prepare(
      `SELECT supplier_name, supplier_tax_id, external_supplier_id, date, total
         FROM expenses
        WHERE supplier_name IS NOT NULL AND supplier_name != ''
        ORDER BY date`
    )
    .all() as any[];

  const groups = new Map<string, { name: string; normalized: string; docs: number; total: number; last_date: string }>();
  for (const row of rows) {
    const normalized = normalizeName(row.supplier_name);
    if (!normalized) continue;
    // Anything already placed — by an identity, by its own name, or by a mapping made here —
    // is not a gap. Only what nothing at all answers to belongs on this list.
    if (known.has(normalized)) continue;
    if (byIdentity.has(`n:${normalized}`)) continue;
    const morningId = String(row.external_supplier_id || '').trim();
    if (morningId && byIdentity.has(`m:${morningId}`)) continue;
    const taxId = String(row.supplier_tax_id || '').replace(/\D/g, '');
    if (taxId && byIdentity.has(`t:${taxId}`)) continue;

    const entry = groups.get(normalized) || {
      name: row.supplier_name, normalized, docs: 0, total: 0, last_date: '',
    };
    entry.docs += 1;
    entry.total = Math.round((entry.total + (Number(row.total) || 0)) * 100) / 100;
    // Rows arrive oldest first, so the last one to be seen is the newest spelling.
    entry.name = row.supplier_name;
    entry.last_date = String(row.date || '');
    groups.set(normalized, entry);
  }

  const names = aliasNamesByPayee();
  return [...groups.values()]
    .map((entry) => {
      let best: { kind: PayeeKind; id: string; name: string; score: number } | null = null;
      for (const payee of payees) {
        const score = Math.max(
          nameSimilarity(entry.name, payee.name),
          ...(names.get(keyOf(payee)) || []).map((alias) => nameSimilarity(entry.name, alias)),
          0
        );
        if (score >= SIMILAR_ENOUGH && (!best || score > best.score)) {
          best = { kind: payee.kind, id: payee.id, name: payee.name, score: Math.round(score * 100) / 100 };
        }
      }
      return { ...entry, suggestion: best };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Carries the old `aliases` column into the table that replaced it.
 *
 * The column held the same idea as free text on the supplier — one line, comma-separated,
 * editable only inside the supplier dialog and invisible everywhere a document failed to be
 * recognised. Nothing is lost in the move: each name becomes a row, and a name the column had
 * given to two suppliers is kept for the first and reported, because the table will not hold
 * both and a silent drop is how a mapping disappears without anybody noticing.
 */
export function backfillSupplierAliases(): number {
  if (getSetting('moonlight_supplier_aliases_v1', '') === 'done') return 0;

  const created = db.transaction((): number => {
    const suppliers = db
      .prepare("SELECT id, aliases FROM band_suppliers WHERE aliases IS NOT NULL AND aliases != ''")
      .all() as any[];
    let n = 0;
    for (const supplier of suppliers) {
      for (const raw of String(supplier.aliases).split(/[\n,]/)) {
        const alias = raw.trim();
        if (!alias) continue;
        try {
          addAlias({ kind: 'supplier', id: supplier.id }, alias, 'migration');
          n++;
        } catch (err: any) {
          console.warn(`[aliases] ${err.message}`);
        }
      }
    }
    setSetting('moonlight_supplier_aliases_v1', 'done');
    return n;
  })();

  return created;
}
