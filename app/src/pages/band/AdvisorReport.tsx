import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, TrendingUp, XCircle } from 'lucide-react';
import { nis } from '../../api';
import { Tag } from '../../ui';
import { eventLabel } from './shared';
import { when } from './advisorShared';

export const VERDICTS: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  good: { label: 'הפרסום עובד', tone: 'bg-pos-soft border-pos/20 text-pos', icon: CheckCircle2 },
  ok: { label: 'סביר, יש מה לשפר', tone: 'bg-warn-soft border-warn/25 text-warn-ink', icon: AlertTriangle },
  poor: { label: 'הפרסום לא משתלם', tone: 'bg-neg-soft border-neg/20 text-neg', icon: XCircle },
};

/** Most severe first — the order findings are read in, and the colour of the bar beside each. */
export const SEVERITIES: Record<string, { label: string; order: number; tone: 'neg' | 'warn' | 'neutral'; bar: string }> = {
  high: { label: 'קריטי', order: 0, tone: 'neg', bar: 'border-s-neg' },
  medium: { label: 'בינוני', order: 1, tone: 'warn', bar: 'border-s-warn' },
  low: { label: 'קל', order: 2, tone: 'neutral', bar: 'border-s-line-strong' },
};

const EFFORTS: Record<string, string> = { low: 'מאמץ קטן', medium: 'מאמץ בינוני', high: 'מאמץ גדול' };

const severityOf = (finding: any) => SEVERITIES[finding?.severity] ?? SEVERITIES.low;

/** How many findings of each severity, as the tags a closed «ממצאים» heading shows. */
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

/**
 * The top of the tab: what the agent concluded, the four numbers it rests on, and the first thing
 * to do about it. Everything below folds away; this does not, because it is the answer.
 */
export function AdvisorSummary({ report, events, header, onFirstStep }: {
  report: any;
  events: any[];
  /** Title, period and the refresh button — owned by the tab. */
  header: React.ReactNode;
  /** Opens the recommendations, from the «first step» line. */
  onFirstStep: () => void;
}) {
  const answer = report?.response;
  const verdict = VERDICTS[answer?.verdict] ?? null;
  const VerdictIcon = verdict?.icon;
  const eventById = (id: string) => events.find((e) => e.id === id);
  const best = eventById(answer?.benchmarks?.best_event_id);
  const worst = eventById(answer?.benchmarks?.worst_event_id);
  const first = answer?.suggestions?.[0];

  const stats = answer?.benchmarks ? [
    { label: 'עלות לכרטיס', value: answer.benchmarks.cost_per_ticket == null ? '—' : nis(answer.benchmarks.cost_per_ticket), sub: 'לפי הסוכן' },
    { label: 'פרסום מתוך ההכנסה', value: answer.benchmarks.spend_share_of_revenue == null ? '—' : `${answer.benchmarks.spend_share_of_revenue}%`, sub: 'ממוצע בתקופה' },
    { label: 'ההופעה המשתלמת', value: best?.venue ?? '—', sub: best?.date ?? '', accent: 'text-pos' },
    { label: 'ההופעה היקרה', value: worst?.venue ?? '—', sub: worst?.date ?? '', accent: 'text-neg' },
  ] : [];

  return (
    <div className="bg-surface border border-line rounded-2xl p-4 md:p-5 space-y-4">
      {header}

      {verdict && VerdictIcon && (
        <div className={clsx('flex items-start gap-3 rounded-xl border px-4 py-3.5', verdict.tone)}>
          <VerdictIcon className="w-6 h-6 shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-bold">{verdict.label}</div>
            {answer?.headline && <p className="text-[15px] md:text-base text-ink leading-relaxed mt-0.5">{answer.headline}</p>}
          </div>
        </div>
      )}
      {!verdict && answer?.headline && <p className="text-base text-ink leading-relaxed">{answer.headline}</p>}

      {stats.length > 0 && (
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-soft rounded-xl px-3 py-2.5 min-w-0">
              <div className="text-xs text-muted">{stat.label}</div>
              <div className={clsx('num text-lg md:text-xl font-extrabold tracking-[-0.02em] truncate', stat.accent || 'text-ink')}>
                {stat.value}
              </div>
              {stat.sub && <div className="text-xs text-faint">{stat.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {first && (
        <button type="button" onClick={onFirstStep}
          className="w-full flex items-center gap-3 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 text-start hover:border-accent/50 transition-colors">
          <span className="shrink-0 text-xs font-bold text-accent-ink">הצעד הראשון</span>
          <span className="flex-1 min-w-0 text-sm font-medium text-ink">{first.title}</span>
          <ArrowLeft className="w-4 h-4 shrink-0 text-accent" aria-hidden />
        </button>
      )}

      {report && (
        <p className="text-xs text-faint">
          נותח ב-{when(report.created_at)}
          {report.duration_ms ? ` · ${Math.round(report.duration_ms / 1000)} שניות` : ''}
          {' · '}הנתונים עצמם נמצאים בלשונית «פרסום»
        </p>
      )}
    </div>
  );
}

/**
 * The findings, most severe first. Each opens to its detail — critical ones arrive open — and
 * names the recommendation that answers it, so the problem and the fix read as one thought rather
 * than the same sentence twice in two lists.
 */
export function FindingsList({ findings, suggestions, events, onShowSuggestion }: {
  findings: any[];
  suggestions: any[];
  events: any[];
  onShowSuggestion: (index: number) => void;
}) {
  const ordered = findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => severityOf(a.finding).order - severityOf(b.finding).order || a.index - b.index);

  return (
    <ul className="space-y-2">
      {ordered.map(({ finding, index }) => {
        const severity = severityOf(finding);
        const event = finding.event_id ? events.find((e) => e.id === finding.event_id) : null;
        const fixes = suggestions
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => Array.isArray(s?.addresses) && s.addresses.includes(index));
        return (
          <li key={index}>
            <details open={finding.severity === 'high'}
              className={clsx('group rounded-xl border border-line border-s-4 bg-soft', severity.bar)}>
              <summary className="flex cursor-pointer list-none items-start gap-2 p-3 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Tag tone={severity.tone}>{severity.label}</Tag>
                  <span className="font-semibold text-ink">{finding.title}</span>
                  {event && <Tag>{eventLabel(event)}</Tag>}
                </div>
                <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="px-3 pb-3 space-y-2">
                <p className="text-sm text-body leading-relaxed">{finding.detail}</p>
                {fixes.map(({ s, i }) => (
                  <button key={i} type="button" onClick={() => onShowSuggestion(i)}
                    className="flex items-center gap-1.5 text-xs font-medium text-accent hover:underline text-start">
                    <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    מה לעשות: המלצה {i + 1} · {s.title}
                  </button>
                ))}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/** The recommendations, in the agent's order of importance — the first one is the one to do today. */
export function SuggestionsList({ suggestions, findings }: { suggestions: any[]; findings: any[] }) {
  return (
    <>
      <p className="text-xs text-faint mb-3">
        מדורגות מהחשובה לפחות חשובה. הסוכן לא משנה דבר ב-Meta — כל שינוי נעשה ידנית ב-Ads Manager.
      </p>
      <ol className="space-y-2">
        {suggestions.map((suggestion, i) => (
          <li key={i} id={`advisor-suggestion-${i}`}
            className={clsx('flex gap-3 rounded-xl border p-3 md:p-4 scroll-mt-24',
              i === 0 ? 'border-accent/30 bg-accent-soft/40' : 'border-line bg-surface')}>
            <span className="num shrink-0 grid place-items-center w-8 h-8 rounded-full bg-accent-soft text-accent-ink font-bold text-sm">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="font-semibold text-ink leading-snug">{suggestion.title}</div>
              {suggestion.detail && <p className="text-sm text-body leading-relaxed">{suggestion.detail}</p>}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {suggestion.expected_impact && (
                  <Tag tone="pos"><TrendingUp className="w-3.5 h-3.5" aria-hidden />{suggestion.expected_impact}</Tag>
                )}
                {suggestion.effort && <Tag>{EFFORTS[suggestion.effort] ?? suggestion.effort}</Tag>}
                {(suggestion.addresses ?? []).map((n: number) => findings[n] && (
                  <Tag key={n} tone={severityOf(findings[n]).tone}>פותרת: {findings[n].title}</Tag>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
