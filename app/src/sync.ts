import React from 'react';
import { get } from './api';

/** The three sources the app pulls from, and the one key each is addressed by on the server. */
export type SyncService = 'morning' | 'calendar' | 'meta';

/** What each source is called where a button or a tooltip has room for one short name. */
export const SYNC_NAMES: Record<SyncService, string> = {
  morning: 'Morning',
  calendar: 'יומן Google',
  meta: 'Meta Ads',
};

/** The .env keys a source is missing when the server reports it unconfigured. */
export const SYNC_MISSING: Record<SyncService, string> = {
  morning: 'חסרים GREEN_INVOICE_ID / GREEN_INVOICE_SECRET',
  calendar: 'חסרים GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN',
  meta: 'חסרים META_ACCESS_TOKEN / META_AD_ACCOUNT_ID',
};

/**
 * A plain rounded number for the sync summary. Not `nis`: the Meta line reports the ad account's
 * own currency, which is not always shekels, so the symbol comes from the data beside it.
 */
const amount = (value: unknown) => Math.round(Number(value) || 0).toLocaleString('he-IL');

/**
 * What a sync did, in one line per source, read off the result the server returned.
 *
 * One function for every place a sync can be started from — the settings page and the pages that
 * show the synced data — so a pull reports itself the same way wherever the button was.
 */
export function syncSummary(which: SyncService, r: any): string {
  if (which === 'morning') {
    return `Morning: ${r.fetched} מסמכים (${r.from} – ${r.to}) · ${r.created} חדשים · ${r.updated} עודכנו` +
      (r.expenses?.error
        ? `\n· הוצאות: ${r.expenses.error}`
        : `\n· הוצאות: ${r.expenses.fetched} · ${r.expenses.created} חדשות · ${r.expenses.updated} עודכנו` +
          ` · ${r.expenses.reported} מסומנות כדווחו`);
  }
  if (which === 'meta') {
    return `Meta: ${r.campaigns} קמפיינים (${r.from} – ${r.to}) · ${amount(r.spend)} ${r.currency}` +
      `\n· ${r.applied.written} הופעות עודכנו · ${r.applied.unchanged} ללא שינוי` +
      (r.applied.locked ? ` · ${r.applied.locked} עם סכום ידני (לא נדרסו)` : '') +
      (r.applied.settled
        ? ` · ${r.applied.settled} שולמו לנגנים (מוקפאות${r.applied.settled_stale ? `, מתוכן ${r.applied.settled_stale} עם הוצאה שגדלה מאז` : ''})`
        : '') +
      (r.applied.unmapped_campaigns
        ? `\n· ${r.applied.unmapped_campaigns} קמפיינים ללא שיוך להופעה — ${amount(r.applied.unmapped_spend)} ₪ ממתינים לשיוך ב-הלהקה → פרסום`
        : '') +
      (r.warning ? `\n⚠ ${r.warning}` : '');
  }
  return `יומן: ${r.matched} תואמים · ${r.created} חדשים · ${r.updated} עודכנו · ${r.linked} שויכו` +
    (r.rules ?? []).map((x: any) => `\n· ${x.ruleName}: ${x.matched} תואמים${x.error ? ` — שגיאה: ${x.error}` : ''}`).join('');
}

/** The part of a source's status every sync button needs: whether it can run, and when it last did. */
export interface IntegrationState {
  configured: boolean;
  last_sync: string | null;
}

export type Integrations = Record<SyncService, IntegrationState>;

/**
 * The last status any screen fetched, kept module-wide so the buttons on a page do not each
 * ask the server the same question, and so a button rendered a moment after the first already
 * knows whether its source is configured.
 */
let integrationCache: Integrations | null = null;
const listeners = new Set<(value: Integrations) => void>();

/** Fetches the sources' status (owner-only on the server) and tells every mounted button. */
export function refreshIntegrations(): Promise<Integrations | null> {
  return get('/integrations')
    .then((d) => {
      integrationCache = { morning: d.morning, calendar: d.calendar, meta: d.meta };
      listeners.forEach((fn) => fn(integrationCache!));
      return integrationCache;
    })
    .catch(() => null);
}

/**
 * The sources' status for whichever buttons are on screen, shared across them. `null` until the
 * first fetch lands — a button renders enabled meanwhile rather than flashing disabled, because
 * the server rejects a run on an unconfigured source anyway.
 */
export function useIntegrations(): Integrations | null {
  const [state, setState] = React.useState<Integrations | null>(integrationCache);
  React.useEffect(() => {
    listeners.add(setState);
    if (!integrationCache) refreshIntegrations();
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}
