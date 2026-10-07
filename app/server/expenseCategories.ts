/**
 * The cost lines of a show, as the band defines them.
 *
 * A show's expense row is one column per cost line (band_event_expenses). The app ships with
 * twelve; this module is how the band renames one, switches one off, adds one of its own or
 * deletes one it added. A line is a column, so adding one adds a column — `<key>` for the
 * amount and `<key>_paid` for whether it has been settled — which keeps every reader of the
 * expense row (totals, supplier payments, the Meta sync, the MCP tools) working unchanged.
 *
 * Every line is also a supplier role in waiting: band_supplier_roles gets a row for it, switched
 * off, so the band can decide later that it hires somebody for that line.
 */
import { db, uuid } from './db.js';

export interface ExpenseCategory {
  key: string;
  name: string;
  /** Paid to somebody after the show, so it carries an open/paid state. */
  settles: number;
  active: number;
  builtin: number;
  sort_order: number;
}

export const allCategories = (): ExpenseCategory[] =>
  db.prepare('SELECT * FROM band_expense_categories ORDER BY sort_order, key').all() as ExpenseCategory[];

export const activeCategories = (): ExpenseCategory[] => allCategories().filter((c) => c.active);

/**
 * Every cost column, active or not. Totals read all of them: a line the band switched off
 * last month still carries the amounts typed into it on last year's shows.
 */
export const expenseFields = (): string[] => allCategories().map((c) => c.key);

/** The lines settled separately after the show, by the category's own flag. */
export const settlingFields = (): string[] => allCategories().filter((c) => c.settles).map((c) => c.key);

export function categoryByKey(key: string): ExpenseCategory | undefined {
  return db.prepare('SELECT * FROM band_expense_categories WHERE key = ?').get(key) as ExpenseCategory | undefined;
}

const columnsOf = (table: string): Set<string> =>
  new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));

/**
 * Makes sure every category has its columns. Runs at boot, so a category row that exists
 * without its columns — an interrupted create — is completed rather than left to throw on
 * the first expense read.
 */
export function ensureCategoryColumns(): void {
  const have = columnsOf('band_event_expenses');
  for (const { key } of allCategories()) {
    if (!have.has(key)) db.exec(`ALTER TABLE band_event_expenses ADD COLUMN "${key}" REAL NOT NULL DEFAULT 0`);
    if (!have.has(`${key}_paid`)) db.exec(`ALTER TABLE band_event_expenses ADD COLUMN "${key}_paid" INTEGER NOT NULL DEFAULT 0`);
  }
}

const cleanName = (value: unknown): string => {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw Object.assign(new Error('שם שורת העלות חובה'), { status: 400 });
  if (name.length > 40) throw Object.assign(new Error('שם שורת העלות ארוך מדי (עד 40 תווים)'), { status: 400 });
  return name;
};

const assertNameFree = (name: string, exceptKey?: string) => {
  const clash = db
    .prepare('SELECT key FROM band_expense_categories WHERE name = ? AND key != ?')
    .get(name, exceptKey ?? '') as { key: string } | undefined;
  if (clash) throw Object.assign(new Error(`כבר קיימת שורת עלות בשם «${name}»`), { status: 409 });
};

/**
 * Adds a cost line. The key is minted here and never shown, so the column name stays a valid
 * SQL identifier whatever the line is called on screen.
 */
export const createCategory = db.transaction((input: { name?: unknown; settles?: unknown }): ExpenseCategory => {
  const name = cleanName(input.name);
  assertNameFree(name);
  const key = `x_${uuid().replace(/-/g, '').slice(0, 10)}`;
  const order = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM band_expense_categories')
    .get() as { n: number }).n + 1;
  db.prepare(
    'INSERT INTO band_expense_categories (key, name, settles, active, builtin, sort_order) VALUES (?, ?, ?, 1, 0, ?)'
  ).run(key, name, input.settles ? 1 : 0, order);
  db.exec(`ALTER TABLE band_event_expenses ADD COLUMN "${key}" REAL NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE band_event_expenses ADD COLUMN "${key}_paid" INTEGER NOT NULL DEFAULT 0`);
  // A role for it, off until the band says it hires somebody for this line.
  db.prepare(
    'INSERT OR IGNORE INTO band_supplier_roles (key, name, required, active, sort_order) VALUES (?, ?, 0, 0, ?)'
  ).run(key, name, order);
  return categoryByKey(key)!;
});

/**
 * Renames a line, changes whether it settles separately, or switches it on or off. Switching
 * off hides the line from shows that carry nothing on it; a show with an amount keeps showing
 * it, since the money is real. The supplier role of the same key follows the name.
 */
export const updateCategory = db.transaction((
  key: string,
  patch: { name?: unknown; settles?: unknown; active?: unknown }
): ExpenseCategory => {
  const existing = categoryByKey(key);
  if (!existing) throw Object.assign(new Error('שורת עלות לא נמצאה'), { status: 404 });
  const name = patch.name === undefined ? existing.name : cleanName(patch.name);
  if (name !== existing.name) assertNameFree(name, key);
  const settles = patch.settles === undefined ? existing.settles : (patch.settles ? 1 : 0);
  const active = patch.active === undefined ? existing.active : (patch.active ? 1 : 0);
  db.prepare('UPDATE band_expense_categories SET name = ?, settles = ?, active = ? WHERE key = ?')
    .run(name, settles, active, key);
  if (name !== existing.name) {
    db.prepare('UPDATE band_supplier_roles SET name = ? WHERE key = ?').run(name, key);
  }
  // A line nobody can type into cannot be hired for either.
  if (!active) {
    db.prepare('UPDATE band_supplier_roles SET active = 0, required = 0 WHERE key = ?').run(key);
  }
  return categoryByKey(key)!;
});

/** How many shows carry money on a line — what a screen shows before deleting it. */
export function categoryUsage(key: string): { shows: number; suppliers: number } {
  if (!categoryByKey(key)) return { shows: 0, suppliers: 0 };
  const shows = db.prepare(`SELECT COUNT(*) AS n FROM band_event_expenses WHERE "${key}" != 0`).get() as { n: number };
  const suppliers = db.prepare('SELECT COUNT(*) AS n FROM band_suppliers WHERE role = ?').get(key) as { n: number };
  return { shows: shows.n, suppliers: suppliers.n };
}

/**
 * Removes a line the band added, while nothing stands on it. A built-in line is switched off
 * instead; a line with an amount on any show, or a supplier hired for it, is history and stays.
 */
export const deleteCategory = db.transaction((key: string): void => {
  const existing = categoryByKey(key);
  if (!existing) throw Object.assign(new Error('שורת עלות לא נמצאה'), { status: 404 });
  if (existing.builtin) {
    throw Object.assign(new Error('שורת עלות מובנית אי אפשר למחוק — אפשר לכבות אותה'), { status: 409 });
  }
  const usage = categoryUsage(key);
  if (usage.shows > 0) {
    throw Object.assign(new Error(`לא ניתן למחוק — ${usage.shows} הופעות נושאות סכום בשורה הזו. כבו אותה במקום.`), { status: 409 });
  }
  if (usage.suppliers > 0) {
    throw Object.assign(new Error(`לא ניתן למחוק — ${usage.suppliers} ספקים רשומים בסוג הזה. כבו אותה במקום.`), { status: 409 });
  }
  db.prepare('DELETE FROM band_event_assignments WHERE role = ?').run(key);
  db.prepare('DELETE FROM band_supplier_roles WHERE key = ?').run(key);
  db.prepare('DELETE FROM band_expense_categories WHERE key = ?').run(key);
  // The columns go too where SQLite allows it; an older build keeps two empty columns, which
  // nothing reads once the category row is gone.
  try {
    db.exec(`ALTER TABLE band_event_expenses DROP COLUMN "${key}_paid"`);
    db.exec(`ALTER TABLE band_event_expenses DROP COLUMN "${key}"`);
  } catch (err) {
    console.warn(`[expense categories] could not drop columns for ${key}:`, (err as Error).message);
  }
});
