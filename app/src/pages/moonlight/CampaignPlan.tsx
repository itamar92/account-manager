import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Check, Copy } from 'lucide-react';
import { nis } from '../../api';
import { Button, Combobox, Tag, Textarea } from '../../ui';
import { eventLabel, type BandMember } from './shared';
import { TaskPicker } from './TaskPicker';
import { CopyButton, ddmm, when, Working, type AdvisorJob } from './advisorShared';

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
  savedDrafts: SavedDraft[];
  eventId: string;
  onEventChange: (eventId: string) => void;
  /** The newest plan of the chosen show, as stored. */
  report: any;
  brief: string;
  onBriefChange: (brief: string) => void;
  /** A plan being drafted right now, by this page or one reloaded while it ran. */
  job?: AdvisorJob;
  /** The agent is answering something else; it takes one request at a time. */
  agentBusy: boolean;
  onBuild: () => void;
  /** Keeps a headline or description chosen from the alternatives. */
  onChoose: (field: 'headline' | 'description', value: string) => void;
  members: BandMember[];
  taskShow: (eventId: string) => any;
  onTasksAdded: () => void;
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
        <span className="num grid place-items-center w-7 h-7 shrink-0 rounded-full bg-accent text-white text-sm font-bold">{n}</span>
        {!last && <span className="flex-1 w-px bg-line mt-1" />}
      </div>
      <div className={clsx('min-w-0 flex-1', !last && 'pb-6')}>
        <h3 className="text-sm font-bold text-ink leading-7 mb-2">{title}</h3>
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
      <span className="text-xs text-faint">{text}{extra}</span>
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
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 p-3">
        <span className="grid place-items-center w-9 h-9 rounded-full bg-accent text-white font-bold">M</span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">Moonlight</div>
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
 * Every plan is stored, and the tab opens on the one you were working on, so a plan never needs
 * making twice to be read again — or to add its tasks a day later. Nothing here reaches Meta.
 */
export function CampaignPlan(props: Props) {
  const { events, isOwner, savedDrafts, eventId, report, job } = props;
  const [copiedAll, setCopiedAll] = useState(false);
  const plan = report?.response;
  const today = new Date().toISOString().slice(0, 10);
  const event = events.find((e) => e.id === eventId);
  const label = event ? eventLabel(event) : savedDrafts.find((d) => d.event_id === eventId)?.label ?? '';

  // Shows that are still ahead, plus any show with a saved plan, so choosing a plan from the list
  // above never leaves the picker blank.
  const choosable = events.filter((e) => e.date >= today || savedDrafts.some((d) => d.event_id === e.id));
  const runDays = days(plan?.schedule?.start, plan?.schedule?.end);
  const hasCreative = !!plan?.creative;
  const hasTasks = plan?.tasks?.length > 0;
  const hasNotes = plan?.notes?.length > 0;
  const drafting = job?.status === 'running';

  const copyAll = () => {
    navigator.clipboard.writeText(planText(plan)).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-faint">
        תוכנית לקמפיין להופעה שעוד לא הייתה, בנויה על מה שעבד בקמפיינים הקודמים. כל תוכנית נשמרת —
        אפשר לחזור אליה בכל זמן. שום דבר לא נוצר ב-Meta.
      </p>

      {savedDrafts.length > 0 && (
        <div>
          <div className="text-xs text-faint mb-1.5">תוכניות שמורות</div>
          <div className="flex flex-wrap gap-1.5">
            {savedDrafts.map((draft) => {
              const active = draft.event_id === eventId;
              return (
                <button key={draft.event_id} type="button" onClick={() => props.onEventChange(draft.event_id)}
                  aria-pressed={active}
                  className={clsx('rounded-full border px-3 py-1.5 text-sm transition-colors',
                    active ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink-2 hover:border-accent/50')}>
                  {draft.label}
                  <span className={clsx('ms-1.5 text-xs', active ? 'text-white/80' : 'text-faint')}>
                    · {draft.date < today ? 'עברה' : `נשמרה ${when(draft.created_at).split(',')[0]}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isOwner && (
        <div className="rounded-xl border border-line bg-soft p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-center">
            <Combobox
              value={eventId}
              onChange={props.onEventChange}
              placeholder="בחרו הופעה…"
              options={[
                { value: '', label: 'בחרו הופעה…' },
                ...choosable.map((e) => ({ value: e.id, label: eventLabel(e) })),
              ]}
            />
            {!drafting && (
              <Button variant={plan ? 'ghost' : 'primary'} onClick={props.onBuild} disabled={!eventId || props.agentBusy}>
                {plan ? 'בנייה מחדש' : 'בניית תוכנית'}
              </Button>
            )}
          </div>
          <Textarea
            label="משהו שחשוב שהסוכן ידע? (לא חובה)"
            value={props.brief}
            rows={2}
            disabled={drafting}
            placeholder="למשל: תקציב עד 800 ₪, הדגש על קהל צעיר מהמרכז"
            onChange={(e) => props.onBriefChange(e.target.value)}
          />
          {drafting && <Working text={`הסוכן בונה תוכנית${label ? ` ל${label}` : ''}`} since={job?.started_at} />}
          {!choosable.some((e) => e.date >= today) && (
            <p className="text-xs text-warn">אין הופעות עתידיות בטבלת ההכנסות</p>
          )}
        </div>
      )}

      {!plan && !drafting && eventId && (
        <p className="text-sm text-faint text-center py-4">
          {isOwner ? 'עוד אין תוכנית להופעה הזו — «בניית תוכנית» תבקש מהסוכן לבנות אחת' : 'עוד אין תוכנית להופעה הזו'}
        </p>
      )}

      {plan && (
        <article className="rounded-xl border border-line p-3 md:p-4">
          <header className="flex flex-wrap items-start justify-between gap-2 mb-5">
            <div className="min-w-0">
              <h3 className="ser text-lg text-ink">{label}</h3>
              <p className="text-xs text-faint">
                נשמרה ב-{when(report.created_at)}
                {report.duration_ms ? ` · ${Math.round(report.duration_ms / 1000)} שניות` : ''}
              </p>
              {report.request?.brief && (
                <p className="text-xs text-muted mt-1">ביקשתם: {report.request.brief}</p>
              )}
            </div>
            <Button variant="ghost" onClick={copyAll} className="!px-3 !py-2 inline-flex items-center gap-1.5">
              {copiedAll ? <Check className="w-4 h-4 text-pos" /> : <Copy className="w-4 h-4" />}
              {copiedAll ? 'הועתק' : 'העתקת הכל'}
            </Button>
          </header>

          <Step n={1} title="קמפיין">
            <Field label="מטרה" value={plan.objective} copy={plan.objective ?? ''} />
          </Step>

          <Step n={2} title="קבוצת מודעות" last={!hasCreative && !hasTasks && !hasNotes}>
            <div className="space-y-3">
              <Field label="קהל" value={plan.audience} copy={plan.audience ?? ''} />
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'תקציב כולל', value: nis(plan.budget_total), copy: String(plan.budget_total ?? '') },
                  { label: 'ליום', value: nis(plan.daily_budget), copy: String(plan.daily_budget ?? '') },
                  { label: 'ימים', value: runDays ?? '—' },
                ].map((stat) => (
                  // The copy button sits in the corner, so on a phone the figure keeps the tile's full width.
                  <div key={stat.label} className="relative rounded-lg bg-soft px-3 py-2 min-w-0">
                    <div className="text-xs text-faint pe-7">{stat.label}</div>
                    <div className="num text-base font-bold text-ink">{stat.value}</div>
                    {stat.copy !== undefined && (
                      <div className="absolute top-0.5 end-0.5"><CopyButton text={stat.copy} label={`העתקת ${stat.label}`} /></div>
                    )}
                  </div>
                ))}
              </div>
              <Field label="תאריכים">
                <span className="num">{ddmm(plan.schedule?.start)} – {ddmm(plan.schedule?.end)}</span>
                {event?.date && <span className="text-xs text-faint"> · ההופעה ב-{ddmm(event.date)}</span>}
              </Field>
              {plan.placements?.length > 0 && (
                <div>
                  <div className="text-xs text-faint mb-1">מיקומים</div>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.placements.map((p: string) => <Tag key={p}>{p}</Tag>)}
                  </div>
                </div>
              )}
            </div>
          </Step>

          {hasCreative && (
            <Step n={3} title="מודעה" last={!hasTasks && !hasNotes}>
              <div className="grid gap-4 lg:grid-cols-2 items-start">
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
                    <p className="text-xs text-faint leading-relaxed">מבוסס על: {plan.creative.based_on}</p>
                  )}
                </div>
              </div>
            </Step>
          )}

          {hasTasks && (
            <Step n={hasCreative ? 4 : 3} title="משימות מעקב" last={!hasNotes}>
              <p className="text-xs text-faint mb-2">כל משימה מסומנת תישלח כתזכורת במייל ביום היעד</p>
              <TaskPicker eventId={eventId} tasks={plan.tasks} sourceId={report.id}
                show={props.taskShow(eventId)} members={props.members} isOwner={isOwner}
                onAdded={props.onTasksAdded} onError={props.onError} />
            </Step>
          )}

          {hasNotes && (
            <Step n={(hasCreative ? 4 : 3) + (hasTasks ? 1 : 0)} title="הערות" last>
              <ul className="space-y-1.5 text-sm text-body leading-relaxed list-disc ps-4">
                {plan.notes.map((note: string, i: number) => <li key={i}>{note}</li>)}
              </ul>
            </Step>
          )}
        </article>
      )}
    </div>
  );
}
