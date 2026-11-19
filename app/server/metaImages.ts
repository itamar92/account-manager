/**
 * The image a new ad is built around, held by the app until the owner confirms the campaign.
 *
 * Uploading straight to Meta's image library would be a change to the ad account made before
 * anyone saw a preview. So the wizard's upload lands here, in the data directory beside the
 * database, and only the confirmed «create campaign» action sends it to Meta (`metaActions.ts`).
 * Files are named by a generated id, never by what the browser called them.
 */
import fs from 'fs';
import path from 'path';
import { DATA_DIR, uuid } from './db.js';
import { AgentError } from './agentClient.js';

const DIR = path.join(DATA_DIR, 'meta-images');
/** Meta takes up to 30MB; a phone photo is 2–6MB, and the request carries it as base64. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const ID = /^[0-9a-f-]{36}$/;

export interface StoredImage {
  id: string;
  type: string;
  bytes: number;
}

/** Keeps an uploaded image. `data` is a data: URL or bare base64 with its type given. */
export function storeImage(data: unknown, declaredType?: unknown): StoredImage {
  if (typeof data !== 'string' || !data) throw new AgentError('לא התקבלה תמונה', 400);
  let type = typeof declaredType === 'string' ? declaredType : '';
  let base64 = data;
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(data);
  if (match) { type = match[1]; base64 = match[2]; }
  const ext = TYPES[type];
  if (!ext) throw new AgentError('רק תמונות JPG או PNG', 400);
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new AgentError('התמונה ריקה', 400);
  if (buffer.length > MAX_IMAGE_BYTES) throw new AgentError('התמונה גדולה מ-8MB — כדאי להקטין אותה', 413);
  fs.mkdirSync(DIR, { recursive: true });
  const id = uuid();
  fs.writeFileSync(path.join(DIR, `${id}.${ext}`), buffer);
  return { id, type, bytes: buffer.length };
}

/** The file behind an image id, or null when there is none. */
export function imagePath(id: unknown): { file: string; type: string } | null {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  for (const [type, ext] of Object.entries(TYPES)) {
    const file = path.join(DIR, `${id}.${ext}`);
    if (fs.existsSync(file)) return { file, type };
  }
  return null;
}

/** The image as Meta's `adimages` upload wants it. */
export function imageBase64(id: string): string {
  const found = imagePath(id);
  if (!found) throw new AgentError('התמונה של המודעה לא נמצאה — העלו אותה שוב', 404);
  return fs.readFileSync(found.file).toString('base64');
}
