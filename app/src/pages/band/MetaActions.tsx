import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Eye, XCircle, Zap } from 'lucide-react';
import { get, post } from '../../api';
import { Button, Modal, Tag } from '../../ui';
import { clsx } from 'clsx';
import { InlineError, when } from './advisorShared';

/** An action as an advisor answer carries it — see server/metaActions.ts. */
export interface ProposedAction {
  type: 'pause' | 'activate' | 'set_daily_budget' | 'set_end_date' | 'create_pixel';
  level: 'campaign' | 'adset' | 'ad' | null;
  id: string | null;
  name: string | null;
  daily_budget: number | null;
  end_date: string | null;
  pixel_name?: string | null;
  reason: string | null;
}

const LEVELS: Record<string, string> = { campaign: 'קמפיין', adset: 'קבוצת מודעות', ad: 'מודעה' };

/** One line naming the change, before anything has been read from Meta. */
export function actionLabel(action: ProposedAction): string {
  const what = action.level ? `${LEVELS[action.level]} «${action.name ?? action.id}»` : '';
  switch (action.type) {
    case 'pause': return `השהיית ${what}`;
    case 'activate': return `הפעלת ${what}`;
    case 'set_daily_budget': return `תקציב יומי ₪${action.daily_budget} ל${what}`;
    case 'set_end_date': return `תאריך סיום ${action.end_date} ל${what}`;
    case 'create_pixel': return 'יצירת פיקסל Meta לחשבון';
  }
}

const STATUS: Record<string, { label: string; tone: 'neutral' | 'pos' | 'warn' | 'neg' | 'accent' }> = {
  previewed: { label: 'תצוגה מקדימה', tone: 'neutral' },
  executing: { label: 'בביצוע', tone: 'accent' },
  done: { label: 'בוצע', tone: 'pos' },
  failed: { label: 'נכשל', tone: 'neg' },
  cancelled: { label: 'לא בוצע', tone: 'neutral' },
};

/**
 * The preview of one change, and the only place it can be confirmed.
 *
 * Everything on it was read from Meta when it opened: the target's real name and status, the value
 * now and the value after. A blocker removes the confirm button; without the write token the
 * preview stays, as the instruction to follow in Ads Manager.
 */
export function ActionPreviewModal({ preview, onClose, onDone }: {
  preview: any;
  onClose: () => void;
  onDone: (action: any) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [problem, setProblem] = useState('');

  const execute = async () => {
    setBusy(true);
    setProblem('');
    try {
      const d = await post(`/band/meta-actions/${preview.id}/execute`);
      setDone(d.action);
      onDone(d.action);
    } catch (err: any) {
      setProblem(err.message);
    } finally { setBusy(false); }
  };

  const close = () => {
    if (!done && preview.status === 'previewed') post(`/band/meta-actions/${preview.id}/cancel`).catch(() => {});
    onClose();
  };

  return (
    <Modal title="תצוגה מקדימה — לפני שינוי ב-Meta" open onClose={close} size="lg">
      <div className="space-y-4">
        <div>
          <div className="text-[15px] font-bold text-ink">{preview.title}</div>
          {preview.action.reason && <p className="text-sm text-muted leading-relaxed mt-1">למה: {preview.action.reason}</p>}
        </div>

        <ul className="divide-y divide-line rounded-xl border border-line">
          {preview.changes.map((change: any, i: number) => (
            <li key={i} className="px-3 py-2.5 text-sm">
              <div className="text-xs text-faint mb-1">{change.label}</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted line-through decoration-faint">{change.from}</span>
                <ArrowLeft className="w-4 h-4 text-faint" aria-label="יהפוך ל" />
                <span className="font-bold text-ink">{change.to}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {preview.target?.id && <Tag>מזהה {preview.target.id}</Tag>}
          {preview.target?.effective_status && preview.target.effective_status !== preview.target.status && (
            <Tag>בפועל: {preview.target.effective_status}</Tag>
          )}
          {preview.shows?.map((s: any) => <Tag key={s.event_id}>{s.label}</Tag>)}
          {preview.target?.ads_manager_url && (
            <a href={preview.target.ads_manager_url} target="_blank" rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-accent hover:underline">
              <ExternalLink className="w-3.5 h-3.5" aria-hidden /> פתיחה ב-Meta
            </a>
          )}
        </div>

        {preview.warnings?.length > 0 && (
          <ul className="rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 space-y-1">
            {preview.warnings.map((w: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-warn-ink">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /><span>{w}</span>
              </li>
            ))}
          </ul>
        )}

        {preview.blockers?.length > 0 && (
          <ul className="rounded-xl border border-neg/25 bg-neg-soft px-3 py-2 space-y-1">
            {preview.blockers.map((b: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-neg">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /><span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {problem && <p className="text-sm text-neg">{problem}</p>}

        {done ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-pos/30 bg-pos-soft px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-pos">
              <CheckCircle2 className="w-4 h-4" aria-hidden /> בוצע ב-Meta
            </span>
            <Button variant="ghost" onClick={onClose}>סגירה</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-xs text-faint">
              {preview.can_execute
                ? `נקרא מ-Meta ${when(preview.created_at)}. האישור תקף ל-15 דקות, ורק אם שום דבר לא השתנה בינתיים.`
                : 'אי אפשר לבצע מכאן — אפשר לעשות את השינוי ידנית ב-Ads Manager לפי מה שמוצג כאן.'}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={close} disabled={busy}>ביטול</Button>
              {preview.can_execute && (
                <Button onClick={execute} disabled={busy}>{busy ? 'מבצע…' : 'אישור וביצוע ב-Meta'}</Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * The changes an advisor answer proposes, each behind a preview. A band member sees what was
 * proposed; only the owner can open a preview, since opening one reads Meta and confirming writes.
 */
export function ActionButtons({ actions, source, sourceId, eventId, isOwner, onDone, title, prominent }: {
  actions: ProposedAction[] | undefined;
  source: 'review' | 'analysis' | 'chat' | 'pixel';
  sourceId?: string;
  eventId?: string;
  isOwner: boolean;
  /** Kept for callers; a failed preview is now said beside its own button instead. */
  onError?: (message: string) => void;
  onDone?: (action: any) => void;
  title?: string;
  /** The change is the recommended decision itself, so its button is the primary one. */
  prominent?: boolean;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [finished, setFinished] = useState<any>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [problem, setProblem] = useState<{ index: number; text: string } | null>(null);
  if (!actions?.length) return null;

  // The parent hears of a change only once its preview is closed: re-reading on the spot can
  // replace this list (a created pixel removes the button that made it) and the «done» with it.
  const closePreview = () => {
    setPreview(null);
    if (finished) onDone?.(finished);
    setFinished(null);
  };

  const open = async (action: ProposedAction, i: number) => {
    setLoading(i);
    setProblem(null);
    try {
      const d = await post('/band/meta-actions/preview', { action, source, source_id: sourceId, event_id: eventId });
      setPreview(d.preview);
    } catch (err: any) {
      setProblem({ index: i, text: `לא הצלחנו לקרוא את המצב הנוכחי מ-Meta: ${err.message}. אפשר לנסות שוב, או לעשות את השינוי ידנית ב-Ads Manager.` });
    } finally { setLoading(null); }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-body">{title ?? 'שינוי שאפשר לעשות ב-Meta. הוא נפתח קודם בתצוגה מקדימה, ומתבצע רק באישור שלכם.'}</div>
      <ul className="space-y-2">
        {actions.map((action, i) => (
          <li key={i} className="space-y-2">
            <div className={clsx('flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5',
              prominent ? 'bg-surface' : 'border border-line bg-surface')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Zap className="w-3.5 h-3.5 text-accent shrink-0" aria-hidden />{actionLabel(action)}
                </div>
                {action.reason && <div className="text-sm text-muted leading-relaxed">{action.reason}</div>}
              </div>
              {isOwner && (
                <Button variant={prominent ? 'primary' : 'ghost'} className="!px-3.5" disabled={loading != null} onClick={() => open(action, i)}>
                  <span className="inline-flex items-center gap-1.5"><Eye className="w-4 h-4" aria-hidden />{loading === i ? 'קורא מ-Meta…' : 'תצוגה מקדימה'}</span>
                </Button>
              )}
            </div>
            {problem?.index === i && <InlineError text={problem.text} onDismiss={() => setProblem(null)} />}
          </li>
        ))}
      </ul>
      {preview && (
        <ActionPreviewModal preview={preview} onClose={closePreview} onDone={setFinished} />
      )}
    </div>
  );
}

/** What the app did in Meta, and what it was asked to and did not — newest first. */
export function ActionsLog({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<{ actions: any[] } | null>(null);
  useEffect(() => {
    get('/band/meta-actions').then(setData).catch(() => {});
  }, [reloadKey]);
  if (!data) return null;
  const shown = data.actions.filter((a) => a.status !== 'previewed' || Date.parse(a.preview.expires_at) > Date.now());
  return (
    <div className="space-y-2">
      {shown.length === 0 ? <p className="text-sm text-muted">עוד לא נעשה שום שינוי ב-Meta מהאפליקציה. שינוי שהסוכן מציע יופיע כאן אחרי שתאשרו אותו.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {shown.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="text-ink">{a.preview.title}</div>
                <div className="text-xs text-muted">
                  {a.preview.changes.map((c: any) => `${c.label}: ${c.from} ← ${c.to}`).join(' · ')}
                  {a.error && <span className="text-neg"> · {a.error}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Tag tone={STATUS[a.status]?.tone ?? 'neutral'}>{STATUS[a.status]?.label ?? a.status}</Tag>
                <span className="text-xs text-faint">{when(a.executed_at ?? a.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
