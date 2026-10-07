import { db, uuid, getSetting, setSetting } from './db.js';

/**
 * The images a quote is dressed in: the band's logo, and the owner's signature that signs every
 * quote on the band's behalf.
 *
 * Each is one row of band_quote_files with no quote, pointed at by a setting. Replacing one
 * writes the new row and drops the old in the same transaction, so there is never a moment with
 * two logos, or with a setting pointing at nothing.
 */

export type BrandingKind = 'logo' | 'signature';

export const isBrandingKind = (value: unknown): value is BrandingKind =>
  value === 'logo' || value === 'signature';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class FileError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const settingKey = (kind: BrandingKind) => `quote_${kind}_file_id`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * What an upload actually is, read from its first bytes rather than from what the browser said.
 *
 * Only raster formats: an SVG is a document that can carry script, and the logo is served from
 * this app's own origin, so one would be a way to run code on a logged-in member's session.
 */
export function sniffImage(data: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG)) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function saveBrandingImage(kind: BrandingKind, body: unknown, userId: string | null): string {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new FileError(415, 'יש להעלות תמונה מסוג PNG, JPG או WebP');
  }
  if (body.length > MAX_IMAGE_BYTES) throw new FileError(413, 'התמונה גדולה מ־5MB');
  const mime = sniffImage(body);
  if (!mime) throw new FileError(415, 'יש להעלות תמונה מסוג PNG, JPG או WebP');

  const id = uuid();
  db.transaction(() => {
    const previous = getSetting(settingKey(kind), '');
    db.prepare(
      `INSERT INTO band_quote_files (id, quote_id, kind, mime, size, data, uploaded_by)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`
    ).run(id, kind, mime, body.length, body, userId);
    setSetting(settingKey(kind), id);
    if (previous) db.prepare('DELETE FROM band_quote_files WHERE id = ? AND quote_id IS NULL').run(previous);
  })();
  return id;
}

export function removeBrandingImage(kind: BrandingKind) {
  db.transaction(() => {
    const current = getSetting(settingKey(kind), '');
    if (current) db.prepare('DELETE FROM band_quote_files WHERE id = ? AND quote_id IS NULL').run(current);
    setSetting(settingKey(kind), '');
  })();
}

export function brandingImage(kind: BrandingKind): { id: string; mime: string; data: Buffer } | null {
  const id = getSetting(settingKey(kind), '');
  if (!id) return null;
  return (db.prepare('SELECT id, mime, data FROM band_quote_files WHERE id = ? AND kind = ?').get(id, kind) as any) ?? null;
}

/**
 * Where the screens load the image from. The file's id rides along so a replaced logo is a new
 * address, and the old one can be cached for ever without ever being shown stale.
 */
export function brandingUrl(kind: BrandingKind): string | null {
  const id = getSetting(settingKey(kind), '');
  if (!id || !db.prepare('SELECT 1 FROM band_quote_files WHERE id = ?').get(id)) return null;
  return `/api/band/quotes/branding/${kind}?v=${id}`;
}
