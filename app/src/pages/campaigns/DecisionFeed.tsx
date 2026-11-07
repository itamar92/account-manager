import React, { useEffect, useState } from 'react';
import { CalendarPlus, CheckCircle2, Link2, Ticket, ListChecks, PauseCircle, PlayCircle, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { get, nis, post, put } from '../../api';
import { Button } from '../../ui';
import { daysAway, ddmm, InlineError } from '../band/advisorShared';
import { actionLabel } from '../band/MetaActions';
import { ShowStrip, type ShowSummary } from '../band/ShowStrip';
import { TicketsEditor } from '../band/TicketsEditor';
import { ChangeLine, SectionHead, israelToday, usePreview } from './studioShared';

type Tone = 'neg' | 'warn' | 'accent' | 'neutral';

interface Item {
  key: string;
  tone: Tone;
  icon: React.ElementType;
  title: string;
  reason?: string;
  change?: { from: string; to: string };
  /** Ordering: lower comes first. Money already going out wrong outranks a reminder. */
  rank: number;
  render: () => React.ReactNode;
}

const TONE: Record<Tone, string> = {
  neg: 'bg-neg-soft text-neg',
  warn: 'bg-warn-soft text-warn',
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-soft text-muted',
};

/** How close a show has to be before having no campaign is worth a line here. */
const NO_CAMPAIGN_DAYS = 30;

/**
 * החלטות — the studio's first screen: everything waiting for the owner's yes, in one list, each
 * line with the one thing to do about it.
 *
 * Nothing here is new information; it is what the rest of the studio already knows, gathered so it
 * does not have to be gone looking for. A campaign still spending after its show, a paused one
 * whose show is close, the agent's proposed changes, tasks that are due, shows with no campaign,
 * spend no show claims. A change in Meta opens its preview; a mapping or a ticked task applies on
 * the spot, because neither touches the ad account.
 */
export function DecisionFeed({ isOwner, period, periodLabel, reloadKey, onChanged, onOpenCampaign, onOpenShow, onCreate, onOpenSection, toolbar }: {
  events?: any[];
  isOwner: boolean;
  period: { params: () => URLSearchParams };
  periodLabel: string;
  reloadKey: number;
  onChanged: () => void;
  onOpenCampaign: (id: string) => void;
  onOpenShow: (eventId: string) => void;
  onCreate: (eventId?: string, fromPlan?: boolean) => void;
  onOpenSection: (section: string) => void;
  /** The period the figures cover, chosen at the head of the screen. */
  toolbar?: React.ReactNode;
}) {
  const [campaigns, setCampaigns] = useState<any[] | null>(isOwner ? null : []);
  const [shows, setShows] = useState<ShowSummary[] | null>(null);
  const [taskShows, setTaskShows] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [totals, setTotals] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [ticketsFor, setTicketsFor] = useState<ShowSummary | null>(null);
  const [saved, setSaved] = useState('');
  const today = israelToday();
  const qs = period.params().toString();

  const load = () => {
    if (isOwner) get('/integrations/meta/campaigns').then((d) => setCampaigns(d.campaigns)).catch(() => setCampaigns([]));
    get('/band/campaign-shows').then((d) => setShows(d.shows)).catch(() => setShows([]));
    get('/band/campaign-tasks?all=1').then((d) => setTaskShows(d.shows)).catch(() => {});
    get(`/band/campaign-analysis${qs ? `?${qs}` : ''}`).then((d) => setReport(d.report)).catch(() => {});
    get(`/band/ad-analysis${qs ? `?${qs}` : ''}`).then((d) => setTotals(d.totals)).catch(() => {});
  };
  useEffect(load, [reloadKey, qs]);
  const changed = () => { load(); onChanged(); };
  const preview = usePreview(changed);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setProblem('');
    try { await fn(); changed(); } catch (err: any) { setProblem(err.message); } finally { setBusy(''); }
  };

  const items: Item[] = [];
  const live = (campaigns ?? []).filter((c) => c.status !== 'ARCHIVED' && c.status !== 'DELETED');
  const showById = new Map((shows ?? []).map((s) => [s.event_id, s]));

  const previewButton = (key: string, label: string, action: Record<string, unknown>, primary = true) => isOwner && (
    <Button variant={primary ? 'primary' : 'ghost'} disabled={preview.loading != null} onClick={() => preview.open(action, key)}>
      {preview.loading === key ? 'קורא מ-Meta…' : label}
    </Button>
  );

  for (const c of live) {
    const dates = c.events.map((e: any) => e.date).sort();
    const last = dates[dates.length - 1];
    const next = dates.find((d: string) => d >= today);
    // Money going out for a night that is over.
    if (c.status === 'ACTIVE' && last && last < today) {
      items.push({
        key: `after-${c.id}`, tone: 'neg', icon: PauseCircle, rank: 0,
        title: `«${c.name}» עדיין רץ אחרי ההופעה`,
        reason: `ההופעה האחרונה שלו הייתה ב-${ddmm(last)}. כל יום שהוא פעיל הוא הוצאה בלי הופעה.`,
        change: { from: 'פעיל', to: 'מושהה' },
        render: () => previewButton(`after-${c.id}`, 'תצוגה מקדימה', { type: 'pause', level: 'campaign', id: c.id, name: c.name, reason: 'ההופעה כבר הייתה' }),
      });
    }
    // A campaign built and left paused while its show comes closer.
    if (c.status === 'PAUSED' && next) {
      const left = Math.round((Date.parse(next) - Date.parse(today)) / 86_400_000);
      if (left <= 21) {
        items.push({
          key: `paused-${c.id}`, tone: 'warn', icon: PlayCircle, rank: 2,
          title: `«${c.name}» מושהה, וההופעה ${daysAway(left)}`,
          reason: 'אם הוא מוכן, הפעלה מתחילה להוציא מיד. אם לא — אפשר לפתוח אותו ולבדוק את המודעות.',
          change: { from: 'מושהה', to: 'פעיל' },
          render: () => (
            <>
              {previewButton(`paused-${c.id}`, 'תצוגה מקדימה', { type: 'activate', level: 'campaign', id: c.id, name: c.name })}
              <Button variant="ghost" onClick={() => onOpenCampaign(c.id)}>פתיחה</Button>
            </>
          ),
        });
      }
    }
    // Spend that lands on no show's books.
    if (c.events.length === 0 && c.spend > 0) {
      const top = c.suggestions?.[0];
      items.push({
        key: `unmapped-${c.id}`, tone: 'neutral', icon: Link2, rank: 5,
        title: `«${c.name}» לא משויך להופעה`,
        reason: top ? `${nis(c.spend)} שלא נכנסים לספרים של אף הופעה. נראה שזה ${top.label} (${top.reason}).` : `${nis(c.spend)} שלא נכנסים לספרים של אף הופעה.`,
        render: () => (
          <>
            {top && (
              <Button disabled={busy === c.id} onClick={() => run(c.id, () => post(`/integrations/meta/campaigns/${c.id}/mappings`, { event_id: top.event_id }))}>
                {busy === c.id ? 'משייך…' : `שיוך ל${top.label}`}
              </Button>
            )}
            <Button variant="ghost" onClick={() => onOpenCampaign(c.id)}>{top ? 'הופעה אחרת' : 'שיוך'}</Button>
          </>
        ),
      });
    }
  }

  // What the agent said to change, as clicks.
  const advised = (report?.response?.actions ?? []) as any[];
  advised.forEach((a, i) => {
    items.push({
      key: `agent-${i}`, tone: 'accent', icon: Sparkles, rank: 1,
      title: actionLabel(a),
      reason: a.reason ? `הסוכן: ${a.reason}` : 'הצעה מסיכום התקופה של הסוכן.',
      render: () => previewButton(`agent-${i}`, 'תצוגה מקדימה', a),
    });
  });

  // Tasks that are due.
  const openTasks = taskShows.flatMap((s) => (s.tasks ?? []).map((t: any) => ({ ...t, show_label: s.label, event_id: t.event_id ?? s.event_id })))
    .filter((t: any) => !t.done_at && t.due_date <= today)
    .sort((a: any, b: any) => a.due_date.localeCompare(b.due_date));
  openTasks.slice(0, 6).forEach((t: any) => {
    const late = t.due_date < today;
    const daysLate = Math.round((Date.parse(today) - Date.parse(t.due_date)) / 86_400_000);
    items.push({
      key: `task-${t.id}`, tone: late ? 'warn' : 'neutral', icon: ListChecks, rank: late ? 3 : 6,
      title: t.title,
      reason: `${t.show_label} · ${late ? `באיחור ${daysLate === 1 ? 'של יום' : `של ${daysLate} ימים`}` : 'להיום'}`,
      render: () => (
        <>
          <Button variant="ghost" disabled={busy === t.id} onClick={() => run(t.id, () => put(`/band/campaign-tasks/${t.id}`, { done: true }))}>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" aria-hidden />{busy === t.id ? 'מסמן…' : 'בוצע'}</span>
          </Button>
          <Button variant="ghost" onClick={() => onOpenShow(t.event_id)}>להופעה</Button>
        </>
      ),
    });
  });

  // Shows coming up with nothing promoting them yet.
  if (campaigns) {
    for (const s of shows ?? []) {
      if (s.days_left < 0 || s.days_left > NO_CAMPAIGN_DAYS) continue;
      const covered = campaigns.some((c) => c.events.some((e: any) => e.event_id === s.event_id)) || (s.spend ?? 0) > 0;
      if (covered) continue;
      items.push({
        key: `none-${s.event_id}`, tone: s.days_left <= 10 ? 'warn' : 'neutral', icon: CalendarPlus, rank: 4,
        title: `אין קמפיין ל${s.label}`,
        reason: `ההופעה ${daysAway(s.days_left)}.${s.plan ? ' יש לה תוכנית מהסוכן, אז אפשר למלא את הקמפיין ממנה.' : ''}`,
        render: () => isOwner && (
          <>
            <Button onClick={() => onCreate(s.event_id, !!s.plan)}>{s.plan ? 'קמפיין מהתוכנית' : 'קמפיין חדש'}</Button>
            {!s.plan && <Button variant="ghost" onClick={() => onOpenShow(s.event_id)}>תוכנית מהסוכן</Button>}
          </>
        ),
      });
    }
  }

  // Shows close enough that the ticket count steers the money, with no recent count to steer by.
  if (isOwner) {
    for (const s of shows ?? []) {
      if (s.days_left < 0 || s.days_left > 14) continue;
      const age = s.tickets ? Math.round((Date.now() - Date.parse(s.tickets.created_at.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s.tickets.created_at) ? '' : 'Z'))) / 86_400_000) : null;
      if (age != null && age < 7) continue;
      items.push({
        key: `tickets-${s.event_id}`, tone: 'neutral', icon: Ticket, rank: 7,
        title: `כמה כרטיסים נמכרו ל${s.label}?`,
        reason: age == null
          ? `ההופעה ${daysAway(s.days_left)}, ועוד אין ספירה של כרטיסים. בלי הספירה אי אפשר לדעת אם הקמפיין עובד.`
          : `הספירה האחרונה (${s.tickets!.sold ?? '—'} כרטיסים) היא מלפני ${age} ימים, וההופעה ${daysAway(s.days_left)}.`,
        render: () => <Button variant="ghost" onClick={() => setTicketsFor(s)}>עדכון כרטיסים</Button>,
      });
    }
  }

  items.sort((a, b) => a.rank - b.rank);
  const loading = campaigns === null || shows === null;
  const active = live.filter((c) => c.status === 'ACTIVE').length;
  const ahead = (shows ?? []).filter((s) => s.days_left >= 0);
  const lateByShow = (eventId: string) => taskShows.find((s) => s.event_id === eventId)?.tasks?.filter((t: any) => !t.done_at && t.due_date < today).length ?? 0;

  return (
    <div className="space-y-6">
      <SectionHead title="מה מחכה להחלטה"
        sub={loading ? 'אוסף את מה שדורש תשומת לב…' : items.length ? `${items.length} ${items.length === 1 ? 'דבר' : 'דברים'} — הדחוף למעלה.` : undefined}
        actions={toolbar} />

      {/* ---- the period in four figures, each a way into where it comes from */}
      <dl className="grid grid-cols-2 md:grid-cols-4 rounded-2xl bg-surface border border-line divide-x divide-x-reverse divide-line overflow-hidden">
        {[
          { k: `הוצאה · ${periodLabel}`, v: totals ? nis(totals.ad_spend) : '…', to: 'spend' },
          { k: 'קמפיינים פעילים', v: campaigns ? String(active) : '…', to: 'campaigns' },
          { k: 'עלות לכרטיס', v: totals ? (totals.cost_per_ticket == null ? '—' : nis(totals.cost_per_ticket)) : '…', to: 'spend' },
          { k: 'לא משויך', v: totals ? nis(totals.unmapped_spend) : '…', to: 'spend', warn: totals?.unmapped_spend > 0 },
        ].map((f, i) => (
          <div key={f.k} className={clsx(i >= 2 && 'border-t md:border-t-0 border-line')}>
            <button type="button" onClick={() => onOpenSection(f.to)} className="w-full h-full text-start px-4 py-3 hover:bg-soft transition-colors">
              <dt className="text-xs text-faint truncate">{f.k}</dt>
              <dd className={clsx('num ser text-xl md:text-2xl mt-0.5', f.warn ? 'text-warn-ink' : 'text-ink')}>{f.v}</dd>
            </button>
          </div>
        ))}
      </dl>

      {problem && <InlineError text={problem} onDismiss={() => setProblem('')} />}
      {saved && <p role="status" className="text-sm text-pos-ink bg-pos-soft rounded-xl px-4 py-2.5">{saved}</p>}
      {preview.problem && <InlineError text={preview.problem.text} onDismiss={preview.clearProblem} />}

      {/* ---- the feed */}
      <section aria-label="החלטות">
        {loading ? (
          <div className="rounded-2xl bg-surface border border-line divide-y divide-line" aria-label="טוען">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3 px-4 py-4">
                <div className="w-9 h-9 rounded-full bg-soft animate-pulse motion-reduce:animate-none" />
                <div className="flex-1 space-y-2"><div className="h-4 w-1/2 rounded bg-soft animate-pulse motion-reduce:animate-none" /><div className="h-3 w-3/4 rounded bg-soft animate-pulse motion-reduce:animate-none" /></div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl bg-surface border border-line px-5 py-8 flex flex-col items-center text-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-pos" aria-hidden />
            <p className="text-[15px] font-semibold text-ink">אין כרגע שום דבר שמחכה להחלטה</p>
            <p className="text-sm text-body max-w-md">
              אין קמפיין שרץ אחרי ההופעה שלו, אין משימה באיחור ואין הוצאה לא משויכת.
              {ahead[0] ? ` ההופעה הבאה: ${ahead[0].label}, ${daysAway(ahead[0].days_left)}.` : ''}
            </p>
          </div>
        ) : (
          <ul className="rounded-2xl bg-surface border border-line divide-y divide-line">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.key} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className={clsx('w-9 h-9 rounded-full grid place-items-center shrink-0', TONE[item.tone])}><Icon className="w-[18px] h-[18px]" aria-hidden /></span>
                    <div className="min-w-0 space-y-1">
                      <p className="text-[15px] font-semibold text-ink leading-snug">{item.title}</p>
                      {item.reason && <p className="text-sm text-body leading-relaxed">{item.reason}</p>}
                      {item.change && <ChangeLine from={item.change.from} to={item.change.to} size="sm" />}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 ps-12 sm:ps-0 shrink-0">{item.render()}</div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- what is coming, as the way into each show */}
      <section aria-labelledby="ahead-heading" className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 id="ahead-heading" className="text-[15px] font-bold text-ink">ההופעות הקרובות</h2>
          <button type="button" onClick={() => onOpenSection('shows')} className="text-sm text-accent-ink hover:underline min-h-10">כל ההופעות</button>
        </div>
        {shows === null
          ? <div className="h-[9.5rem] rounded-2xl bg-surface border border-line animate-pulse motion-reduce:animate-none" />
          : <ShowStrip shows={shows} selected="" onSelect={onOpenShow} lateByShow={lateByShow} />}
      </section>
      {preview.modal}
      {ticketsFor && (
        <TicketsEditor show={ticketsFor} onClose={() => setTicketsFor(null)} onSaved={(m) => { setSaved(m); changed(); }} />
      )}
    </div>
  );
}
