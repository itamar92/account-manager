/**
 * Turns a photo of a signature on paper into the signature alone.
 *
 * A phone photo of a signature is mostly paper — grey, a little shadowed, never quite white — and
 * pasted onto a quote it reads as a grey rectangle with a scrawl in it. This keeps the ink and
 * makes the paper transparent, then crops to the ink, so the signature sits on the quote the way
 * a pen would have put it there.
 *
 * The paper's shade is read from the photo itself rather than assumed: most of the frame is
 * paper, so a high percentile of the brightness is what the paper looks like under that light.
 * Ink is anything clearly darker than that, with a soft edge between the two so the strokes
 * keep their anti-aliasing instead of turning jagged.
 */

const MAX_SIDE = 1200;
const PADDING = 12;

/**
 * The signature as a PNG, with the paper taken out unless asked not to. Either way it is drawn
 * through a canvas, which is also what turns an iPhone's HEIC photo into something the server
 * accepts.
 */
export async function prepareSignature(file: Blob, removeBackground = true): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  if (!removeBackground) return toPng(canvas);

  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const lum = new Float32Array(w * h);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    // An already-transparent pixel is paper, whatever colour it nominally has.
    const l = px[o + 3] < 16 ? 255 : 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    lum[i] = l;
    histogram[Math.min(255, Math.round(l))]++;
  }

  const paper = percentile(histogram, w * h, 0.6);
  const clear = paper - 25; // as light as this or lighter: paper
  const solid = Math.max(0, paper - 110); // as dark as this or darker: ink

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const ink = Math.min(1, Math.max(0, (clear - lum[i]) / Math.max(1, clear - solid)));
      px[o + 3] = Math.round(ink * px[o + 3]);
      if (px[o + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('לא נמצאה חתימה בתמונה — נסו תמונה עם דיו כהה על דף בהיר');
  ctx.putImageData(image, 0, 0);

  const x0 = Math.max(0, minX - PADDING);
  const y0 = Math.max(0, minY - PADDING);
  const cw = Math.min(w, maxX + PADDING + 1) - x0;
  const ch = Math.min(h, maxY + PADDING + 1) - y0;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')!.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return toPng(out);
}

const toPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('עיבוד החתימה נכשל'))), 'image/png'));

function percentile(histogram: Uint32Array, total: number, share: number): number {
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen >= total * share) return v;
  }
  return 255;
}
