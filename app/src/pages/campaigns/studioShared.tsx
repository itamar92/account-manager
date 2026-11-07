import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { post } from '../../api';
import { ActionPreviewModal, type ProposedAction } from '../band/MetaActions';

/**
 * «עכשיו → אחרי» — the one way the studio says what a change in Meta will do. The value now is
 * struck through, the value after is in the accent, and the same line appears in the decision
 * feed, the campaign panel, the preview and the wizard's last step, so a change reads the same
 * wherever it is met.
 */
export function ChangeLine({ label, from, to, size = 'md', className }: {
  label?: string;
  from: React.ReactNode;
  to: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={clsx('min-w-0', className)}>
      {label && <div className="text-xs text-faint mb-0.5">{label}</div>}
      <div className={clsx('flex flex-wrap items-center gap-x-2 gap-y-0.5', size === 'sm' ? 'text-sm' : 'text-[15px]')}>
        <span className="num text-muted line-through decoration-[1.5px] decoration-ghost">{from}</span>
        <ArrowLeft className="w-4 h-4 shrink-0 text-accent" aria-label="יהפוך ל" />
        <span className="num font-bold text-accent-ink">{to}</span>
      </div>
    </div>
  );
}

/** Meta's campaign statuses, as the studio says them. */
export const CAMPAIGN_STATUS: Record<string, { label: string; dot: string; text: string }> = {
  ACTIVE: { label: 'פעיל', dot: 'bg-pos', text: 'text-pos-ink' },
  PAUSED: { label: 'מושהה', dot: 'bg-ghost', text: 'text-muted' },
  ARCHIVED: { label: 'בארכיון', dot: 'bg-line-strong', text: 'text-faint' },
  DELETED: { label: 'נמחק', dot: 'bg-line-strong', text: 'text-faint' },
  CAMPAIGN_PAUSED: { label: 'הקמפיין מושהה', dot: 'bg-ghost', text: 'text-muted' },
  ADSET_PAUSED: { label: 'קבוצת המודעות מושהית', dot: 'bg-ghost', text: 'text-muted' },
  PENDING_REVIEW: { label: 'בבדיקה של Meta', dot: 'bg-warn', text: 'text-warn-ink' },
  IN_PROCESS: { label: 'בעיבוד', dot: 'bg-warn', text: 'text-warn-ink' },
  WITH_ISSUES: { label: 'עם בעיות', dot: 'bg-neg', text: 'text-neg-ink' },
  DISAPPROVED: { label: 'נדחה', dot: 'bg-neg', text: 'text-neg-ink' },
};

export function StatusDot({ status, className }: { status: string | null | undefined; className?: string }) {
  const s = CAMPAIGN_STATUS[status ?? ''] ?? { label: status || 'לא ידוע', dot: 'bg-line-strong', text: 'text-muted' };
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap', s.text, className)}>
      <span className={clsx('w-2 h-2 rounded-full shrink-0', s.dot)} aria-hidden />{s.label}
    </span>
  );
}

export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: 'מכירות',
  OUTCOME_TRAFFIC: 'תנועה',
  OUTCOME_AWARENESS: 'חשיפה',
  OUTCOME_ENGAGEMENT: 'מעורבות',
  OUTCOME_LEADS: 'לידים',
  OUTCOME_APP_PROMOTION: 'אפליקציה',
  LINK_CLICKS: 'קליקים',
  REACH: 'חשיפה',
  POST_ENGAGEMENT: 'מעורבות',
  CONVERSIONS: 'המרות',
};

export const israelToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

/**
 * Opens a change's preview: reads the target live from Meta, then shows the one dialog where it can
 * be confirmed. Every edit in the studio goes through here, whoever thought of it.
 */
export function usePreview(onDone?: (action: any) => void) {
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const [finished, setFinished] = useState<any>(null);

  const open = async (action: Partial<ProposedAction> & Record<string, unknown>, key = 'default', origin: Record<string, unknown> = {}) => {
    setLoading(key);
    setProblem(null);
    try {
      const d = await post('/band/meta-actions/preview', { action, source: 'studio', ...origin });
      setPreview(d.preview);
    } catch (err: any) {
      setProblem({ key, text: `לא הצלחנו לקרוא את המצב הנוכחי מ-Meta: ${err.message}` });
    } finally { setLoading(null); }
  };

  const close = () => {
    setPreview(null);
    if (finished) onDone?.(finished);
    setFinished(null);
  };

  const modal = preview ? <ActionPreviewModal preview={preview} onClose={close} onDone={setFinished} /> : null;
  return { open, modal, loading, problem, clearProblem: () => setProblem(null) };
}

/** A section's heading line: the title, what it is for, and what can be done there. */
export function SectionHead({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="ser text-2xl md:text-[28px] leading-tight text-balance">{title}</h1>
        {sub && <p className="mt-1 text-sm md:text-[15px] text-body max-w-[68ch]">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
