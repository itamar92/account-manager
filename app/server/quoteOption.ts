/**
 * «אופציה»: how the band's calendar says a date is held but not yet sold.
 *
 * No imports, like quoteMath.ts and quoteShare.ts, so the editor reads a title exactly the way
 * the server does when it decides a signed quote's event still needs renaming.
 */

export const OPTION_PREFIX = 'אופציה';

/** Whether a calendar title still says the date is only held: «אופציה - הופעה …». */
export const isOptionTitle = (title: string | null | undefined) =>
  (title ?? '').trim().startsWith(OPTION_PREFIX);

/** The title with «אופציה» and the dash after it taken off, for when the client has signed. */
export const withoutOption = (title: string) =>
  title.trim().replace(new RegExp(`^${OPTION_PREFIX}\\s*[-–—:|]?\\s*`), '').trim();
