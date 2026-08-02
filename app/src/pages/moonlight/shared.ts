/** The band, in the order the tables and the summary show them. */
export const MEMBERS = [
  { key: 'amir', name: 'אמיר' },
  { key: 'itamar', name: 'איתמר' },
  { key: 'yuval', name: 'יובל' },
  { key: 'guy', name: 'גיא' },
] as const;

/** Who a general expense can have been paid by: any member, or the band's own float. */
export const PAYERS = [...MEMBERS.map((m) => m.name), 'קופה'];

/** Mirrors eventLabel on the server, for labelling shows in dropdowns before a save. */
export function eventLabel(event: { venue: string; date: string }): string {
  const [y, m, d] = String(event.date || '').split('-');
  return y && m && d ? `${event.venue} - ${d}/${m}/${y}` : event.venue;
}

export interface TabProps {
  isOwner: boolean;
  onError: (message: string) => void;
  reload: () => void;
}
