export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `שגיאה (${res.status})`);
  return data as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const put = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

/**
 * The sign is placed before the ₪ rather than between it and the digits: a loss-making month
 * reads as ־₪1,000 instead of the ₪־1,000 that a bidirectional line turns into nonsense.
 */
const shekels = (n: number | null | undefined, options: Intl.NumberFormatOptions) => {
  const value = Number(n) || 0;
  return `${value < 0 ? '-' : ''}₪${Math.abs(value).toLocaleString('he-IL', options)}`;
};

export const nis = (n: number | null | undefined) => shekels(n, { maximumFractionDigits: 0 });

/** Agorot included — for anything that has to match the document itself. */
export const nisExact = (n: number | null | undefined) =>
  shekels(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SHORT_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

/** 'YYYY-MM' as a chart axis label — the year is on the axis title, not on every tick. */
export const monthLabel = (month: string) => SHORT_MONTHS[parseInt(month.slice(5, 7), 10) - 1] ?? month;

/** 'YYYY-MM' spelled out, for a card that has to say which month it is talking about. */
export const monthName = (month: string) =>
  `${SHORT_MONTHS[parseInt(month.slice(5, 7), 10) - 1] ?? month} ${month.slice(0, 4)}`;
