import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronDown, TrendingUp, XCircle } from 'lucide-react';
import { nis } from '../../api';
import { Button, PeriodSelect, Tag } from '../../ui';
import type { PeriodFilter } from '../../ui';
import { eventLabel } from './shared';
import { InlineError, OverflowMenu, when, Working, type AdvisorJob } from './advisorShared';
import { ActionButtons } from './MetaActions';

export const VERDICTS: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  good: { label: 'הפרסום עובד', tone: 'bg-pos-soft text-pos-ink', icon: CheckCircle2 },
  ok: { label: 'סביר, יש מה לשפר', tone: 'bg-warn-soft text-warn-ink', icon: AlertTriangle },
  poor: { label: 'הפרסום לא משתלם', tone: 'bg-neg-soft text-neg-ink', icon: XCircle },
};

/** Most severe first — the order findings are read in. */
export const SEVERITIES: Record<string, { label: string; order: number; tone: 'neg' | 'warn' | 'neutral' }> = {
  high: { label: 'קריטי', order: 0, tone: 'neg' },
  medium: { label: 'בינוני', order: 1, tone: 'warn' },
  low: { label: 'קל', order: 2, tone: 'neutral' },
};

const EFFORTS: Record<string, string> = { low: 'מאמץ קטן', medium: 'מאמץ בינוני', high: 'מאמץ גדול' };

const severityOf = (finding: any) => SEVERITIES[finding?.severity] ?? SEVERITIES.low;

/**
 * סיכום תקופה — what the agent concluded about a period's advertising, the four numbers it rests
 * on, what to do about it, and the findings that led there.
 *
 * What to do comes before the findings: the findings are the evidence, and each recommendation
 * already names the ones it answers, so the page reads «do this, because of that».
 */
export function PeriodAnalysis({ report, events, period, isOwner, job, agentBusy, failure, onDismissFailure, onAnalyze, onClear, onActionDone }: {
  report: any;
  events: any[];
  period: PeriodFilter;
  isOwner: boolean;
  job?: AdvisorJob;
  agentBusy: boolean;
  failure?: string;
  onDismissFailure: () => void;
  onAnalyze: () => void;
  onClear: () => void;
  onActionDone: () => void;
}) {
  const answer = report?.response;
  const verdict = VERDICTS[answer?.verdict] ?? null;
  const VerdictIcon = verdict?.icon;
  const eventById = (id: string) => events.find((e) => e.id === id);
  const best = eventById(answer?.benchmarks?.best_event_id);
  const worst = eventById(answer?.benchmarks?.worst_event_id);
  const findings: any[] = answer?.findings ?? [];
  const suggestions: any[] = answer?.suggestions ?? [];
  const busyElsewhere = agentBusy && !job;

  const stats = answer?.benchmarks ? [
    { label: 'עלות לכרטיס', value: answer.benchmarks.cost_per_ticket == null ? '—' : nis(answer.benchmarks.cost_per_ticket), sub: 'ממוצע בתקופה' },
    { label: 'פרסום מתוך ההכנסה', value: answer.benchmarks.spend_share_of_revenue == null ? '—' : `${answer.benchmarks.spend_share_of_revenue}%`, sub: 'ממוצע בתקופה' },
    { label: 'ההופעה המשתלמת', value: best?.venue ?? '—', sub: best ? eventLabel(best).split(' - ')[1] : '', tone: 'text-pos-ink' },
    { label: 'ההופעה היקרה', value: worst?.venue ?? '—', sub: worst ? eventLabel(worst).split(' - ')[1] : '' },
  ] : [];

  const ordered = findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => severityOf(a.finding).order - severityOf(b.finding).order || a.index - b.index);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelect year={period.year} month={period.month}
            onYearChange={period.setYear} onMonthChange={period.setMonth} />
        </div>
        {isOwner && !job && (
          <div className="flex items-center gap-1">
            <Button variant={report ? 'ghost' : 'primary'} onClick={onAnalyze} disabled={busyElsewhere}
              title={busyElsewhere ? 'הסוכן עונה על בקשה אחרת. אפשר לבקש כשיסיים.' : undefined}>
              {report ? 'ניתוח מחדש' : 'ניתוח התקופה'}
            </Button>
            {report && (
              <OverflowMenu label="עוד פעולות על הסיכום"
                items={[{ label: 'מחיקת הסיכום של התקופה', onSelect: onClear, danger: true }]} />
            )}
          </div>
        )}
      </div>

      {job && <Working text="הסוכן מנתח את הקמפיינים של התקופה" since={job.started_at} />}
      <InlineError text={failure} onDismiss={onDismissFailure} />

      {!report && !job && (
        <div className="max-w-2xl">
          <h3 className="text-base font-bold text-ink">עוד אין סיכום לתקופה הזו</h3>
          <p className="text-sm text-body leading-relaxed mt-1">
            {isOwner
              ? 'הסוכן עובר על כל הקמפיינים של התקופה מול ההכנסות מההופעות, ואומר אם הפרסום השתלם, מה עבד ומה לשנות.'
              : 'כשבעל העסק יבקש ניתוח לתקופה, הוא יופיע כאן.'}
          </p>
        </div>
      )}

      {verdict && VerdictIcon && (
        <div className={clsx('flex items-start gap-3 rounded-2xl px-4 py-4 md:px-5', verdict.tone)}>
          <VerdictIcon className="w-6 h-6 shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-bold">{verdict.label}</div>
            {answer?.headline && <p className="text-base md:text-[17px] text-ink leading-relaxed mt-1 max-w-[70ch]">{answer.headline}</p>}
          </div>
        </div>
      )}
      {!verdict && answer?.headline && <p className="text-base text-ink leading-relaxed max-w-[70ch]">{answer.headline}</p>}

      {stats.length > 0 && (
        <dl className="grid gap-x-6 gap-y-4 grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0 border-s border-line ps-3">
              <dt className="text-xs text-muted">{stat.label}</dt>
              <dd className={clsx('num text-lg md:text-xl font-extrabold tracking-[-0.02em] truncate mt-0.5', stat.tone || 'text-ink')}>
                {stat.value}
              </dd>
              {stat.sub && <dd className="text-xs text-muted">{stat.sub}</dd>}
            </div>
          ))}
        </dl>
      )}

      {suggestions.length > 0 && (
        <section aria-labelledby="advisor-todo">
          <h3 id="advisor-todo" className="text-[15px] font-bold text-ink mb-3">מה לעשות, מהחשוב ביותר</h3>
          <ol className="space-y-4">
            {suggestions.map((suggestion, i) => (
              <li key={i} id={`advisor-suggestion-${i}`} className="flex gap-3 scroll-mt-24">
                <span className={clsx('num shrink-0 grid place-items-center w-7 h-7 rounded-full text-sm font-bold',
                  i === 0 ? 'bg-accent text-white' : 'bg-accent-soft text-accent-ink')}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-semibold text-ink leading-snug">{suggestion.title}</div>
                  {suggestion.detail && <p className="text-sm text-body leading-relaxed max-w-[70ch]">{suggestion.detail}</p>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {suggestion.expected_impact && (
                      <span className="inline-flex items-center gap-1 text-pos-ink"><TrendingUp className="w-3.5 h-3.5" aria-hidden />{suggestion.expected_impact}</span>
                    )}
                    {suggestion.effort && <span className="text-muted">{EFFORTS[suggestion.effort] ?? suggestion.effort}</span>}
                  </div>
                  {(suggestion.addresses ?? []).some((n: number) => findings[n]) && (
                    <p className="text-xs text-muted">
                      עונה על: {(suggestion.addresses ?? []).map((n: number) => findings[n]?.title).filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {answer?.actions?.length > 0 && (
            <div className="mt-4">
              <ActionButtons actions={answer.actions} source="analysis" sourceId={report?.id}
                isOwner={isOwner} onDone={onActionDone} />
            </div>
          )}
        </section>
      )}

      {ordered.length > 0 && (
        <section aria-labelledby="advisor-findings">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 id="advisor-findings" className="text-[15px] font-bold text-ink">ממצאים</h3>
            <FindingCounts findings={findings} />
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {ordered.map(({ finding, index }) => {
              const severity = severityOf(finding);
              const event = finding.event_id ? events.find((e) => e.id === finding.event_id) : null;
              return (
                <li key={index}>
                  <details open={finding.severity === 'high'} className="group">
                    <summary className="flex cursor-pointer list-none items-start gap-2 py-3 min-h-11 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Tag tone={severity.tone}>{severity.label}</Tag>
                        <span className="font-medium text-ink">{finding.title}</span>
                        {event && <span className="text-xs text-muted">{eventLabel(event)}</span>}
                      </div>
                      <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <p className="pb-3 text-sm text-body leading-relaxed max-w-[70ch]">{finding.detail}</p>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {report && (
        <p className="text-xs text-muted">
          נותח ב-{when(report.created_at)}
          {report.duration_ms ? ` · ${Math.round(report.duration_ms / 1000)} שניות` : ''}
          {' · '}הנתונים עצמם בלשונית «קמפיינים»
        </p>
      )}
    </div>
  );
}

/** How many findings of each severity, as tags. */
export function FindingCounts({ findings }: { findings: any[] }) {
  return (
    <>
      {Object.entries(SEVERITIES).map(([key, severity]) => {
        const count = findings.filter((f) => (SEVERITIES[f?.severity] ? f.severity : 'low') === key).length;
        return count > 0 && <Tag key={key} tone={severity.tone}>{count} {severity.label}</Tag>;
      })}
    </>
  );
}
