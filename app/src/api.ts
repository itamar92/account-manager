/**
 * The words for a failure the app itself never answered.
 *
 * The server always explains its own errors in a JSON `error`. A response without one came
 * from something in front of the app — the Cloudflare tunnel's HTML error page, most often —
 * and a bare "שגיאה (502)" made a server that was down or restarting look like Morning (or
 * Meta, or Google) refusing the request. These say where the failure actually was.
 */
export function gatewayErrorMessage(status: number): string {
  // Cloudflare's 524 (and a plain 504): the app was reached but did not answer in time. The
  // work may well have finished on the server after the browser stopped waiting.
  if (status === 504 || status === 524)
    return `השרת לא סיים לענות בזמן (שגיאה ${status}). ייתכן שהפעולה הסתיימה ברקע — רעננו בעוד דקה ובדקו אם הנתונים התעדכנו.`;
  // 502/503 and Cloudflare's 520–523/530: the tunnel could not get any answer from the app.
  if (status === 502 || status === 503 || (status >= 520 && status <= 523) || status === 530)
    return `השרת לא זמין כרגע (שגיאה ${status}) — האפליקציה לא ענתה, כנראה הופעלה מחדש או קרסה. נסו שוב בעוד דקה; אם זה חוזר, בדקו את הלוג של השרת.`;
  return `שגיאה (${status})`;
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    });
  } catch {
    // fetch only throws when no response arrived at all: offline, DNS, a dropped connection.
    throw new Error('אין חיבור לשרת — בדקו את החיבור לאינטרנט ונסו שוב.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || gatewayErrorMessage(res.status));
  return data as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const put = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

/**
 * Sends a file as the request body rather than as JSON.
 *
 * The Content-Type is the file's own, which is what the route matches on, and it overrides the
 * application/json every other call here sends — a PDF posted as JSON is rejected by the body
 * parser before the route ever sees it.
 */
export const postFile = <T = any>(path: string, file: File) =>
  api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });

/**
 * The sign is placed before the ₪ rather than between it and the digits: a loss-making month
 * reads as ־₪1,000 instead of the ₪־1,000 that a bidirectional line turns into nonsense.
 *
 * The whole thing is wrapped in an LRI/PDI pair (U+2066/U+2069) so it renders left-to-right as
 * one block wherever it lands — inside a right-to-left page, an unwrapped "-₪1,000" gets its
 * minus sign reordered to the far side by the bidi algorithm and reads as "1,000-".
 */
const shekels = (n: number | null | undefined, options: Intl.NumberFormatOptions) => {
  const value = Number(n) || 0;
  const sign = value < 0 ? '-' : '';
  return `⁦${sign}₪${Math.abs(value).toLocaleString('he-IL', options)}⁩`;
};

export const nis = (n: number | null | undefined) => shekels(n, { maximumFractionDigits: 0 });

/** Agorot included — for anything that has to match the document itself. */
export const nisExact = (n: number | null | undefined) =>
  shekels(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SHORT_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

/** 'YYYY-MM' as a chart axis label — the year is on the axis title, not on every tick. */
export const monthLabel = (month: string) => SHORT_MONTHS[parseInt(month.slice(5, 7), 10) - 1] ?? month;

/** 'YYYY-MM' as 'MM/YY' — the compact tick for a chart whose axis carries many months. */
export const monthSlash = (month: string) => `${month.slice(5, 7)}/${month.slice(2, 4)}`;

/** 'YYYY-MM-DD' as 'DD/MM/YY', the way a period's two ends are written on a report's subtitle. */
export const dayShort = (date: string) =>
  `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(2, 4)}`;

/** A bare figure for a chart axis — the ₪ is on the legend, not repeated down the side. */
export const plain = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 });

/** A share as a signed percentage, for the badge that compares a period with the one before it. */
export const signedPercent = (share: number) =>
  `${share > 0 ? '+' : ''}${Math.round(share * 100)}%`;

/** 'YYYY-MM' spelled out, for a card that has to say which month it is talking about. */
export const monthName = (month: string) =>
  `${SHORT_MONTHS[parseInt(month.slice(5, 7), 10) - 1] ?? month} ${month.slice(0, 4)}`;
