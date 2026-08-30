/**
 * What the band calls a supplier, and what that supplier's invoices are headed with.
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
  supplier_id: string;
  alias: string;
  normalized: string;
  source: AliasSource;
  created_at: string;
}

export const aliasesFor = (supplierId: string): SupplierAlias[] =>
  db
    .prepare('SELECT * FROM band_supplier_aliases WHERE supplier_id = ? ORDER BY alias')
    .all(supplierId) as SupplierAlias[];

export const allAliases = (): SupplierAlias[] =>
  db.prepare('SELECT * FROM band_supplier_aliases ORDER BY alias').all() as SupplierAlias[];

/** Normalized invoice name → supplier id. One pass, for the loops that resolve many documents. */
export function aliasMap(): Map<string, string> {
  return new Map(allAliases().map((row) => [row.normalized, row.supplier_id]));
}

/** Supplier id → the names it answers to. One pass, for loops that ask about many documents. */
export function aliasNamesBySupplier(): Map<string, string[]> {
  const bySupplier = new Map<string, string[]>();
  for (const row of allAliases()) {
    bySupplier.set(row.supplier_id, [...(bySupplier.get(row.supplier_id) || []), row.alias]);
  }
  return bySupplier;
}

/** The alias list of each supplier as one editable line — what the supplier dialog shows. */
export function aliasTextBySupplier(): Map<string, string> {
  const bySupplier = new Map<string, string[]>();
  for (const row of allAliases()) {
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
export function addAlias(supplierId: string, alias: string, source: AliasSource = 'manual'): SupplierAlias {
  const text = String(alias || '').trim();
  const normalized = normalizeName(text);
  if (!normalized) throw Object.assign(new Error('שם חלופי ריק'), { status: 400 });

  const supplier = db.prepare('SELECT * FROM band_suppliers WHERE id = ?').get(supplierId) as any;
  if (!supplier) throw Object.assign(new Error('supplier not found'), { status: 404 });

  const existing = db
    .prepare('SELECT * FROM band_supplier_aliases WHERE normalized = ?')
    .get(normalized) as SupplierAlias | undefined;
  if (existing) {
    if (existing.supplier_id === supplierId) return existing;
    const owner = db.prepare('SELECT name FROM band_suppliers WHERE id = ?')
      .get(existing.supplier_id) as any;
    throw Object.assign(
      new Error(`השם «${text}» כבר משויך לספק «${owner?.name ?? '?'}»`),
      { status: 409 }
    );
  }

  const id = uuid();
  db.prepare(
    'INSERT INTO band_supplier_aliases (id, supplier_id, alias, normalized, source) VALUES (?, ?, ?, ?, ?)'
  ).run(id, supplierId, text, normalized, source);
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
export const setAliasesFromText = db.transaction((supplierId: string, text: unknown): void => {
  const wanted = String(text ?? '')
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const keep = new Set<string>();
  for (const alias of wanted) {
    const normalized = normalizeName(alias);
    if (!normalized || keep.has(normalized)) continue;
    keep.add(normalized);
    addAlias(supplierId, alias, 'manual');
  }

  for (const row of aliasesFor(supplierId)) {
    if (!keep.has(row.normalized)) removeAlias(row.id);
  }
});

/**
 * Every invoice name Morning has sent that no supplier answers to — the queue of this screen.
 *
 * A document nobody can place is the reason a payment sits waiting with no suggestion under
 * it, so the fix belongs here beside the mapping rather than only inside one payment: naming
 * the supplier once places every document that name has ever arrived on, and every one still
 * to come.
 *
 * Names are grouped by their normalized form so three spellings of one business are three
 * rows only if they really do differ; what is shown is the spelling that arrived most
 * recently, because that is the one the next document will most likely carry.
 */
export function unknownInvoiceNames(suppliers: any[]): Array<{
  name: string;
  normalized: string;
  docs: number;
  total: number;
  last_date: string;
  suggestion: { supplier_id: string; name: string; score: number } | null;
}> {
  const known = aliasMap();
  const byId = new Map<string, any>();
  for (const supplier of suppliers) {
    const morningId = String(supplier.morning_supplier_id || '').trim();
    if (morningId) byId.set(`m:${morningId}`, supplier);
    const taxId = String(supplier.tax_id || '').replace(/\D/g, '');
    if (taxId) byId.set(`t:${taxId}`, supplier);
    byId.set(`n:${normalizeName(supplier.name)}`, supplier);
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
    if (byId.has(`n:${normalized}`)) continue;
    const morningId = String(row.external_supplier_id || '').trim();
    if (morningId && byId.has(`m:${morningId}`)) continue;
    const taxId = String(row.supplier_tax_id || '').replace(/\D/g, '');
    if (taxId && byId.has(`t:${taxId}`)) continue;

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

  const names = aliasNamesBySupplier();
  return [...groups.values()]
    .map((entry) => {
      let best: { supplier_id: string; name: string; score: number } | null = null;
      for (const supplier of suppliers) {
        const score = Math.max(
          nameSimilarity(entry.name, supplier.name),
          ...(names.get(supplier.id) || []).map((alias) => nameSimilarity(entry.name, alias)),
          0
        );
        if (score >= SIMILAR_ENOUGH && (!best || score > best.score)) {
          best = { supplier_id: supplier.id, name: supplier.name, score: Math.round(score * 100) / 100 };
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
          addAlias(supplier.id, alias, 'migration');
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
