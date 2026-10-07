import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { post } from './api';
import { useAuth } from './AuthContext';
import { Button } from './ui';
import {
  SYNC_MISSING, SYNC_NAMES, refreshIntegrations, syncSummary, useIntegrations, type SyncService,
} from './sync';

/**
 * «סנכרון מ-X» wherever X's data is on screen.
 *
 * The settings page still lists every source with its figures, but nobody reading the invoice
 * list wants to walk over there to find out whether Morning has a newer document. The button
 * runs the same pull the settings page runs and reports the same one-line summary; the page
 * decides where that line is shown (`onDone`) and what to reload afterwards (`reload`).
 *
 * Owner-only, like the routes behind it: a band member never sees it, so the page need not ask.
 */
export function SyncButton({ service, onDone, onError, reload, label, className }: {
  service: SyncService;
  /** Where the summary goes once the pull has finished. */
  onDone?: (summary: string) => void;
  onError: (message: string) => void;
  /** What to fetch again now that the data has changed. */
  reload?: () => void;
  /** Overrides the default «סנכרון מ-X». */
  label?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const integrations = useIntegrations();
  const [busy, setBusy] = useState(false);
  if (user?.role !== 'owner') return null;

  const state = integrations?.[service];
  const configured = state ? state.configured : true;
  const lastSync = state?.last_sync
    ? `סנכרון אחרון: ${new Date(state.last_sync).toLocaleString('he-IL')}`
    : 'טרם סונכרן';

  const run = async () => {
    setBusy(true);
    onError('');
    try {
      const d = await post(`/integrations/${service}/sync`);
      onDone?.(syncSummary(service, d.result));
      reload?.();
      refreshIntegrations();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <span title={configured ? lastSync : SYNC_MISSING[service]}>
      <Button variant="ghost" onClick={run} disabled={!configured || busy} className={className}>
        <span className="inline-flex items-center gap-1.5">
          <RefreshCw size={14} className={clsx('shrink-0', busy && 'animate-spin')} />
          {busy ? 'מסנכרן…' : (label ?? `סנכרון מ-${SYNC_NAMES[service]}`)}
        </span>
      </Button>
    </span>
  );
}
