import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Check, Copy } from 'lucide-react';
import { nis } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Tag, Textarea } from '../../ui';
import { eventLabel, type BandMember } from './shared';
import { TaskPicker } from './TaskPicker';
import { CopyButton, ddmm, InlineError, OverflowMenu, when, Working, type AdvisorJob } from './advisorShared';

export interface SavedDraft {
  report_id: string;
  event_id: string;
  label: string;
  date: string;
  created_at: string;
}

interface Props {
  events: any[];
  isOwner: boolean;
  /** The show chosen in the strip above — the only show picker on the page. */
  eventId: string;
  /** The newest plan of the chosen show, as stored. */
  report: any;
  brief: string;
  onBriefChange: (brief: string) => void;
  /** A plan being drafted right now, by this page or one reloaded while it ran. */
  job?: AdvisorJob;
  /** The agent is answering something else; it takes one request at a time. */
  agentBusy: boolean;
  /** Why the last attempt to draft failed, said beside its button. */
  failure?: string;
  onDismissFailure: () => void;
  onBuild: () => void;
  /** Keeps a headline or description chosen from the alternatives. */
  onChoose: (field: 'headline' | 'description', value: string) => void;
  members: BandMember[];
  taskShow: (eventId: string) => any;
  onTasksAdded: () => void;
  /** Forgets every plan and review of the show, and with `withTasks` its tasks — to start over. */
  onReset: (withTasks: boolean) => Promise<void>;
  onError: (message: string) => void;
}

/** Days the campaign runs, both ends included — what the daily budget is multiplied by. */
const days = (start?: string, end?: string) => {
  const a = Date.parse(start ?? ''), b = Date.parse(end ?? '');
  return Number.isNaN(a) || Number.isNaN(b) || b < a ? null : Math.round((b - a) / 86_400_000) + 1;
};

/** The plan as one block of text, for pasting somewhere other than Ads Manager. */
const planText = (plan: any) => [
  `מטרה: ${plan.objective ?? ''}`,
  `קהל: ${plan.audience ?? ''}`,
  `תקציב: ${plan.budget_total} ₪ סה"כ · ${plan.daily_budget} ₪ ליום`,
  `תאריכים: ${plan.schedule?.start ?? ''} – ${plan.schedule?.end ?? ''}`,
  `מיקומים: ${(plan.placements || []).join(', ')}`,
  '',
  plan.creative?.primary_text || '',
  `כותרת: ${plan.creative?.headline || ''}`,
  `תיאור: ${plan.creative?.description || ''}`,
].join('\n');

/** One numbered step of the sheet, joined to the next by a line — the order Ads Manager asks in. */
function Step({ n, title, last, children }: { n: number; title: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="num grid place-items-center w-7 h-7 shrink-0 rounded-full bg-accent-soft text-accent-ink text-sm font-bold">{n}</span>
        {!last && <span className="flex-1 w-px bg-line mt-1" />}
      </div>
      <div className={clsx('min-w-0 flex-1', !last && 'pb-6')}>
        <h3 className="text-[15px] font-bold text-ink leading-7 mb-2">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** A setting as it is typed into Ads Manager: what it is called, its value, and a copy button. */
function Field({ label, value, copy, children }: { label: string; value?: React.ReactNode; copy?: string; children?: React.ReactNode }) {
  return (
    <div>
      <Label text={label} copy={copy} />
      <div className="text-sm text-ink leading-relaxed">{value ?? children}</div>
    </div>
  );
}

/** A setting's name with its copy button right beside it, where the eye already is. */
function Label({ text, copy, extra }: { text: string; copy?: string; extra?: string }) {
  return (
    <div className="flex items-center gap-1 min-h-8">
      <span className="text-xs font-medium text-muted">{text}{extra}</span>
      {copy !== undefined && <CopyButton text={copy} label={`העתקת ${text}`} />}
    </div>
  );
}

/**
 * The wordings the advisor offered for a headline or a description, as a choice of one. The
 * chosen one is what the preview shows and what is copied, and it is kept with the plan.
 */
function Wordings({ label, options, current, editable, onChoose }: {
  label: string;
  options?: string[];
  current?: string;
  editable: boolean;
  onChoose: (value: string) => void;
}) {
  const list = options?.length ? options : current ? [current] : [];
  if (!list.length) return null;
  return (
    <div>
      <Label text={label} copy={current ?? ''} extra={list.length > 1 && editable ? ' · בחרו נוסח' : ''} />
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={label}>
        {list.map((option) => {
          const chosen = option === current;
          return (
            <button key={option} type="button" role="radio" aria-checked={chosen}
              disabled={!editable || chosen}
              onClick={() => onChoose(option)}
              className={clsx('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-start transition-colors',
                chosen ? 'border-accent bg-accent-soft text-ink font-medium' : 'border-line text-body',
                editable && !chosen && 'hover:border-accent/50 hover:text-ink',
                !editable && !chosen && 'opacity-70')}>
              <span className={clsx('mt-0.5 grid place-items-center w-4 h-4 shrink-0 rounded-full border',
                chosen ? 'border-accent bg-accent text-white' : 'border-line-strong')}>
                {chosen && <Check className="w-3 h-3" aria-hidden />}
              </span>
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Roughly how the ad will look in a feed — to read the wording in place, not a pixel preview. */
function AdPreview({ creative }: { creative: any }) {
  const bandName = useAuth().branding.band_name;
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 p-3">
        <span className="grid place-items-center w-9 h-9 rounded-full bg-accent text-white font-bold">
          {bandName.slice(0, 1)}
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">{bandName}</div>
          <div className="text-[11px] text-faint">ממומן</div>
        </div>
      </div>
      {creative.primary_text && <p className="px-3 pb-3 text-sm text-ink whitespace-pre-wrap leading-relaxed">{creative.primary_text}</p>}
      <div className="h-28 grid place-items-center bg-gradient-to-br from-accent-soft to-soft text-xs text-faint">
        התמונה או הווידאו של המודעה
      </div>
      <div className="flex items-center gap-3 border-t border-line bg-soft px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink truncate">{creative.headline}</div>
          {creative.description && <div className="text-xs text-muted truncate">{creative.description}</div>}
        </div>
        <span className="shrink-0 rounded-md bg-line px-3 py-1.5 text-xs font-semibold text-ink-2">לרכישה</span>
      </div>
    </div>
  );
}

/**
 * תוכנית קמפיין — a campaign for a show that has not happened yet, laid out in the order it is
 * entered in Ads Manager, each setting with its own copy button.
 *
 * Every plan is stored, and the page opens on the show you were working on, so a plan never needs
 * making twice to be read again — or to add its tasks a day later. Nothing here reaches Meta.
 */
export function CampaignPlan(props: Props) {
  const { events, isOwner, eventId, report, job } = props;
  const [copiedAll, setCopiedAll] = useState(false);
  const [resetting, setResetting] = useState<null | 'ask' | 'busy'>(null);
  const [resetTasks, setResetTasks] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const plan = report?.response;
  const event = events.find((e) => e.id === eventId);
  const label = event ? eventLabel(event) : '';
  const runDays = days(plan?.schedule?.start, plan?.schedule?.end);
  const drafting = job?.status === 'running';
  const showTasks: any[] = props.taskShow(eventId)?.tasks ?? [];
  const busyElsewhere = props.agentBusy && !drafting;

  const reset = async () => {
    setResetting('busy');
    try {
      await props.onReset(resetTasks);
    } finally {
      setResetting(null);
      setResetTasks(false);
    }
  };

  const copyAll = () => {
    navigator.clipboard.writeText(planText(plan)).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    }).catch(() => {});
  };

  const build = () => {
    setRebuilding(false);
    props.onBuild();
  };

  // The brief and the button that spends a run on it, shown when there is no plan yet or the
  // owner asked to build it again.
  const askForm = isOwner && (!plan || rebuilding || drafting) && (
    <div className="space-y-3">
      <Textarea
        label="משהו שחשוב שהסוכן ידע? (לא חובה)"
        value={props.brief}
        rows={2}
        disabled={drafting}
        placeholder="למשל: תקציב עד 800 ₪, הדגש על קהל צעיר מהמרכז"
        onChange={(e) => props.onBriefChange(e.target.value)}
      />
      {drafting ? (
        <Working text={`הסוכן בונה תוכנית ל${label || 'הופעה'}`} since={job?.started_at} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={build} disabled={busyElsewhere}
            title={busyElsewhere ? 'הסוכן עונה על בקשה אחרת. אפשר לבקש כשיסיים.' : undefined}>
            {plan ? 'בנייה מחדש' : 'בניית תוכנית'}
          </Button>
          {rebuilding && <Button variant="ghost" onClick={() => setRebuilding(false)}>ביטול</Button>}
          {busyElsewhere && <span className="text-xs text-muted">הסוכן עסוק בבקשה אחרת</span>}
        </div>
      )}
      <InlineError text={props.failure} onDismiss={props.onDismissFailure} />
    </div>
  );

  if (!plan) {
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h3 className="text-base font-bold text-ink">עוד אין תוכנית קמפיין להופעה הזו</h3>
          <p className="text-sm text-body leading-relaxed mt-1">
            {isOwner
              ? 'הסוכן בונה קמפיין לפי מה שעבד בהופעות הקודמות: קהל, תקציב, תאריכים ונוסח מודעה, בסדר שבו Ads Manager שואל. שום דבר לא נוצר ב-Meta.'
              : 'כשבעל העסק יבנה תוכנית, היא תופיע כאן.'}
          </p>
        </div>
        {askForm}
      </div>
    );
  }

  const hasCreative = !!plan.creative;
  const hasTasks = plan.tasks?.length > 0;
  const hasTracking = !!plan.tracking;
  const hasNotes = plan.notes?.length > 0;
  let step = 2;
  const nextStep = () => ++step;

  return (
    <article className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            נבנתה ב-{when(report.created_at)}
            {report.duration_ms ? ` · ${Math.round(report.duration_ms / 1000)} שניות` : ''}
          </p>
          {report.request?.brief && <p className="text-sm text-body mt-0.5">ביקשתם: {report.request.brief}</p>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={copyAll} className="!px-3 inline-flex items-center gap-1.5">
            {copiedAll ? <Check className="w-4 h-4 text-pos" /> : <Copy className="w-4 h-4" />}
            {copiedAll ? 'הועתק' : 'העתקת הכל'}
          </Button>
          {isOwner && (
            <OverflowMenu label="עוד פעולות על התוכנית" disabled={drafting || !!resetting}
              items={[
                { label: 'בנייה מחדש עם הנחיה חדשה', onSelect: () => setRebuilding(true) },
                { label: 'מחיקה והתחלה מחדש', onSelect: () => setResetting('ask'), danger: true },
              ]} />
          )}
        </div>
      </header>

      {askForm && <div className="rounded-xl bg-soft p-3 md:p-4">{askForm}</div>}

      {resetting && (
        <div className="rounded-xl border border-neg/25 bg-neg-soft p-3 space-y-3" role="alertdialog" aria-label="התחלה מחדש">
          <p className="text-sm text-ink leading-relaxed">
            למחוק את התוכנית ואת בדיקות המצב של {label} (כל הגרסאות) ולהתחיל מאפס?
            בדיקות הכרטיסים והקישורים לאתר המועדון נשמרים.
          </p>
          {showTasks.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-body min-h-10">
              <input type="checkbox" className="accent-accent w-4 h-4" checked={resetTasks}
                onChange={(e) => setResetTasks(e.target.checked)} disabled={resetting === 'busy'} />
              למחוק גם את {showTasks.length} משימות ההופעה
              {showTasks.some((t) => t.done_at) && ' (כולל אלה שבוצעו)'}
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="danger" onClick={reset} disabled={resetting === 'busy'}>
              {resetting === 'busy' ? 'מוחק…' : 'מחיקה והתחלה מחדש'}
            </Button>
            <Button variant="ghost" onClick={() => { setResetting(null); setResetTasks(false); }} disabled={resetting === 'busy'}>
              ביטול
            </Button>
          </div>
        </div>
      )}

      <div>
        <Step n={1} title="קמפיין">
          <Field label="מטרה" value={plan.objective} copy={plan.objective ?? ''} />
        </Step>

        <Step n={2} title="קבוצת מודעות" last={!hasCreative && !hasTasks && !hasTracking && !hasNotes}>
          <div className="space-y-4">
            <Field label="קהל" value={plan.audience} copy={plan.audience ?? ''} />
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'תקציב כולל', value: nis(plan.budget_total), copy: String(plan.budget_total ?? '') },
                { label: 'ליום', value: nis(plan.daily_budget), copy: String(plan.daily_budget ?? '') },
                { label: 'ימים', value: runDays ?? '—' },
              ].map((stat) => (
                // The copy button sits in the corner, so on a phone the figure keeps the tile's full width.
                <div key={stat.label} className="relative rounded-xl bg-soft px-3 py-2.5 min-w-0">
                  <div className="text-xs text-muted pe-8">{stat.label}</div>
                  <div className="num text-lg font-bold text-ink tracking-[-0.02em]">{stat.value}</div>
                  {stat.copy !== undefined && (
                    <div className="absolute top-1.5 end-1.5"><CopyButton text={stat.copy} label={`העתקת ${stat.label}`} /></div>
                  )}
                </div>
              ))}
            </div>
            <Field label="תאריכים">
              <span className="num">{ddmm(plan.schedule?.start)} – {ddmm(plan.schedule?.end)}</span>
              {event?.date && <span className="text-sm text-muted"> · ההופעה ב-{ddmm(event.date)}</span>}
            </Field>
            {plan.placements?.length > 0 && (
              <div>
                <div className="text-xs text-muted mb-1.5">מיקומים</div>
                <div className="flex flex-wrap gap-1.5">
                  {plan.placements.map((p: string) => <Tag key={p}>{p}</Tag>)}
                </div>
              </div>
            )}
          </div>
        </Step>

        {hasCreative && (
          <Step n={nextStep()} title="מודעה" last={!hasTasks && !hasTracking && !hasNotes}>
            <div className="grid gap-5 lg:grid-cols-2 items-start">
              <AdPreview creative={plan.creative} />
              <div className="space-y-4">
                {/* The full text is in the preview beside this; here it only needs to be copied. */}
                <div>
                  <Label text="טקסט ראשי" copy={plan.creative.primary_text ?? ''} />
                  <p className="text-sm text-muted line-clamp-2 leading-relaxed">{plan.creative.primary_text}</p>
                </div>
                <Wordings label="כותרת" options={plan.creative.headline_options} current={plan.creative.headline}
                  editable={isOwner} onChoose={(v) => props.onChoose('headline', v)} />
                <Wordings label="תיאור" options={plan.creative.description_options} current={plan.creative.description}
                  editable={isOwner} onChoose={(v) => props.onChoose('description', v)} />
                {plan.creative.based_on && (
                  <p className="text-xs text-muted leading-relaxed">מבוסס על: {plan.creative.based_on}</p>
                )}
              </div>
            </div>
          </Step>
        )}

        {hasTracking && (
          <Step n={nextStep()} title="מעקב מכירות" last={!hasTasks && !hasNotes}>
            <div className="space-y-2 text-sm">
              <Tag tone={plan.tracking.pixel_ready ? 'pos' : 'warn'}>
                {plan.tracking.pixel_ready ? 'הפיקסל באתר הכרטיסים' : 'אין פיקסל באתר הכרטיסים'}
              </Tag>
              {plan.tracking.optimization && <p className="text-body leading-relaxed"><span className="text-muted">אופטימיזציה: </span>{plan.tracking.optimization}</p>}
              {plan.tracking.retargeting && <p className="text-body leading-relaxed"><span className="text-muted">רימרקטינג: </span>{plan.tracking.retargeting}</p>}
              {plan.tracking.club_request && (
                <p className="text-body leading-relaxed">
                  <span className="text-muted">לבקש מהמועדון: </span>{plan.tracking.club_request}.
                  {' '}<span className="text-muted">מייל מוכן למועדון נמצא ב«פיקסל ו-Meta» למטה.</span>
                </p>
              )}
            </div>
          </Step>
        )}

        {hasTasks && (
          <Step n={nextStep()} title="משימות מעקב" last={!hasNotes}>
            <p className="text-sm text-muted mb-2">כל משימה מסומנת נשלחת כתזכורת במייל ביום היעד.</p>
            <TaskPicker eventId={eventId} tasks={plan.tasks} sourceId={report.id}
              show={props.taskShow(eventId)} members={props.members} isOwner={isOwner}
              onAdded={props.onTasksAdded} onError={props.onError} />
          </Step>
        )}

        {hasNotes && (
          <Step n={nextStep()} title="הערות" last>
            <ul className="space-y-1.5 text-sm text-body leading-relaxed list-disc ps-4">
              {plan.notes.map((note: string, i: number) => <li key={i}>{note}</li>)}
            </ul>
          </Step>
        )}
      </div>
    </article>
  );
}
