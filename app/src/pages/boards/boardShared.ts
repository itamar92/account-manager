/** What the boards' API sends for a place — see server/showBoard.ts `splitLocation`. */
export interface Place {
  name: string;
  address: string | null;
  maps_url: string;
  waze_url: string;
}

/** A YYYY-MM-DD as a local date, so a show on the 1st is not shown on the 31st west of UTC. */
export const localDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const dayNumber = (iso: string) => String(localDate(iso).getDate());
export const monthShort = (iso: string) => localDate(iso).toLocaleDateString('he-IL', { month: 'short' });
export const weekday = (iso: string) => localDate(iso).toLocaleDateString('he-IL', { weekday: 'long' });
export const fullDate = (iso: string) =>
  localDate(iso).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
export const monthHeading = (iso: string) =>
  localDate(iso).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

/** Today, tomorrow, or nothing — the two days worth saying in words. */
export function relativeDay(iso: string): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((localDate(iso).getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  return null;
}

/** Groups items by the month they fall in, keeping their order. */
export function byMonth<T extends { date: string }>(items: T[]): Array<{ month: string; items: T[] }> {
  const groups: Array<{ month: string; items: T[] }> = [];
  for (const item of items) {
    const month = item.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}
