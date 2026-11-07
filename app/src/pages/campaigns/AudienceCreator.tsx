import React, { useEffect, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { get } from '../../api';
import { Button, fieldClass } from '../../ui';
import { InlineError } from '../band/advisorShared';
import { usePreview } from './studioShared';

/** Meta's audience kinds, as the studio names them. */
export const SUBTYPES: Record<string, string> = {
  WEBSITE: 'מבקרי אתר', ENGAGEMENT: 'מעורבות', VIDEO: 'צפיות בוידאו', IG_BUSINESS: 'אינסטגרם', PAGE: 'דף פייסבוק',
  CUSTOM: 'רשימת לקוחות', LOOKALIKE: 'דומים', OFFLINE_CONVERSION: 'רכישות מחוץ לאתר',
};

export const audienceSize = (a: any) => {
  if (a.size_upper == null) return 'גודל לא ידוע עדיין';
  const fmt = (n: number) => n.toLocaleString('he-IL');
  return a.size_lower != null && a.size_lower !== a.size_upper ? `${fmt(a.size_lower)}–${fmt(a.size_upper)} איש` : `${fmt(a.size_upper)} איש`;
};

/** Saved audiences as a list — a checklist when `onToggle` is given, a plain list otherwise. */
export function AudienceList({ audiences, selected = [], disabledIds = [], disabledNote, onToggle }: {
  audiences: any[];
  selected?: string[];
  disabledIds?: string[];
  disabledNote?: string;
  onToggle?: (id: string) => void;
}) {
  if (!audiences.length) return <p className="text-sm text-body">אין קהלים שמורים בחשבון.</p>;
  return (
    <ul className="rounded-xl border border-line bg-surface divide-y divide-line max-h-72 overflow-y-auto">
      {audiences.map((a) => {
        const disabled = disabledIds.includes(a.id);
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink truncate">{a.name ?? a.id}</span>
              <span className="block text-xs text-muted">
                {[SUBTYPES[a.subtype] ?? a.subtype, audienceSize(a), disabled ? disabledNote : null].filter(Boolean).join(' · ')}
              </span>
            </span>
            {!a.ready && <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn-ink">עוד לא מוכן</span>}
          </>
        );
        return (
          <li key={a.id}>
            {onToggle ? (
              <label className={clsx('flex items-center gap-3 px-3.5 min-h-12 py-2', disabled ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer hover:bg-soft')}>
                <input type="checkbox" className="accent-accent w-[18px] h-[18px] shrink-0" checked={selected.includes(a.id)}
                  disabled={disabled} onChange={() => onToggle(a.id)} />
                {body}
              </label>
            ) : (
              <div className="flex items-center gap-3 px-3.5 min-h-12 py-2">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Kind = 'website' | 'instagram' | 'page';
type Event = 'all' | 'ViewContent' | 'InitiateCheckout' | 'Purchase';

interface Preset {
  id: string;
  title: string;
  sub: string;
  kind: Kind;
  event: Event;
  days: number;
  exclude_buyers: boolean;
  /** Built to be left out of campaigns rather than targeted. */
  forExclusion?: boolean;
}

/** The audiences a band's hot campaign is usually built from, ready to create in one go. */
export const PRESETS: Preset[] = [
  { id: 'visitors', title: 'מבקרי דף הכרטיסים', sub: 'כל מי שהגיע לדף הכרטיסים, בלי מי שכבר קנה.', kind: 'website', event: 'all', days: 30, exclude_buyers: true },
  { id: 'checkout', title: 'התחילו לקנות ולא סיימו', sub: 'הכי קרובים לרכישה — קהל קטן וחם מאוד.', kind: 'website', event: 'InitiateCheckout', days: 30, exclude_buyers: true },
  { id: 'instagram', title: 'התעניינו באינסטגרם', sub: 'צפו בפרופיל, הגיבו, שמרו או שלחו הודעה.', kind: 'instagram', event: 'all', days: 180, exclude_buyers: false },
  { id: 'page', title: 'התעניינו בדף הפייסבוק', sub: 'לייק, תגובה, שיתוף או הודעה לדף.', kind: 'page', event: 'all', days: 180, exclude_buyers: false },
  { id: 'buyers', title: 'רוכשי כרטיסים', sub: 'להחרגה: כדי לא לשלם על להראות את המודעה למי שכבר קנה.', kind: 'website', event: 'Purchase', days: 90, exclude_buyers: false, forExclusion: true },
];

const SOURCE_LABEL: Record<Kind, string> = { website: 'פיקסל', instagram: 'חשבון אינסטגרם', page: 'דף פייסבוק' };
const MAX_DAYS: Record<Kind, number> = { website: 180, instagram: 365, page: 365 };

export interface AudienceSetup {
  pixels: any[];
  pages: any[];
  instagram_accounts?: any[];
}

const sourcesFor = (setup: AudienceSetup, kind: Kind) =>
  kind === 'website' ? setup.pixels.map((p) => ({ id: p.id, label: p.name ?? p.id }))
    : kind === 'instagram' ? (setup.instagram_accounts ?? []).map((a) => ({ id: a.id, label: a.username ? `@${a.username}` : a.id }))
    : setup.pages.map((p) => ({ id: p.id, label: p.name ?? p.id }));

const NO_SOURCE: Record<Kind, string> = {
  website: 'אין פיקסל בחשבון — יוצרים אחד במסך «פיקסל, קהלים ויומן».',
  instagram: 'אין חשבון אינסטגרם מחובר לחשבון המודעות.',
  page: 'אין דף פייסבוק זמין לחשבון המודעות.',
};

/**
 * יצירת קהל — one of the presets, adjusted if needed, created in Meta behind the same preview and
 * confirm as every other change. `onCreated` hears the new audience's id and whether it was meant
 * to be excluded, so the wizard can tick it in the right list.
 */
export function AudienceCreator({ setup, isOwner, onCreated, only, className }: {
  setup: AudienceSetup;
  isOwner: boolean;
  onCreated: (audienceId: string | null, forExclusion: boolean) => void;
  /** Offer only the presets for targeting, or only those for exclusion. */
  only?: 'target' | 'exclude';
  className?: string;
}) {
  const [preset, setPreset] = useState<Preset | null>(null);
  const [name, setName] = useState('');
  const [days, setDays] = useState('30');
  const [source, setSource] = useState('');
  const preview = usePreview((action) => {
    onCreated(action?.result?.audience_id ?? null, !!preset?.forExclusion);
    setPreset(null);
  });
  if (!isOwner) return null;

  const presets = PRESETS.filter((p) => !only || (only === 'exclude' ? p.forExclusion : !p.forExclusion));
  const choose = (p: Preset) => {
    const sources = sourcesFor(setup, p.kind);
    setPreset(p);
    setName(`${p.title} · ${p.days} יום`);
    setDays(String(p.days));
    setSource(sources[0]?.id ?? '');
  };
  const sources = preset ? sourcesFor(setup, preset.kind) : [];
  const n = Number(days);
  const ready = preset && name.trim() && source && n >= 1 && n <= MAX_DAYS[preset.kind];

  const open = () => {
    if (!preset || !ready) return;
    preview.open({
      type: 'create_audience',
      name: name.trim(),
      audience: { kind: preset.kind, name: name.trim(), source_id: source, days: n, event: preset.event, exclude_buyers: preset.exclude_buyers },
      reason: preset.sub,
    } as any, 'audience');
  };

  return (
    <div className={clsx('space-y-3', className)}>
      <div className="grid gap-2 sm:grid-cols-2">
        {presets.map((p) => {
          const missing = sourcesFor(setup, p.kind).length === 0;
          const active = preset?.id === p.id;
          return (
            <button key={p.id} type="button" disabled={missing} onClick={() => (active ? setPreset(null) : choose(p))} aria-pressed={active}
              className={clsx('text-start rounded-xl border px-3.5 py-3 transition-colors disabled:opacity-55 disabled:cursor-not-allowed',
                active ? 'border-accent bg-accent-soft/60' : 'border-line bg-surface hover:bg-soft')}>
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Plus className="w-4 h-4 text-accent shrink-0" aria-hidden />{p.title}
              </span>
              <span className="block text-xs text-body leading-relaxed mt-0.5 ps-6">{missing ? NO_SOURCE[p.kind] : p.sub}</span>
            </button>
          );
        })}
      </div>

      {preset && (
        <div className="settle-in rounded-xl bg-soft p-3.5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <label className="block">
              <span className="block text-xs text-muted mb-1">שם הקהל</span>
              <input className={clsx(fieldClass, 'bg-surface')} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-xs text-muted mb-1">ימים אחורה</span>
              <input inputMode="numeric" className={clsx(fieldClass, 'bg-surface num')} value={days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>
          {sources.length > 1 && (
            <label className="block">
              <span className="block text-xs text-muted mb-1">{SOURCE_LABEL[preset.kind]}</span>
              <select className={clsx(fieldClass, 'bg-surface')} value={source} onChange={(e) => setSource(e.target.value)}>
                {sources.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
          )}
          {n > MAX_DAYS[preset.kind] && <p className="text-sm text-neg-ink">Meta מאפשרת עד {MAX_DAYS[preset.kind]} ימים אחורה לקהל כזה.</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!ready || preview.loading != null} onClick={open}>{preview.loading ? 'קורא מ-Meta…' : 'תצוגה מקדימה'}</Button>
            <Button variant="ghost" onClick={() => setPreset(null)}>ביטול</Button>
          </div>
          {preview.problem && <InlineError text={preview.problem.text} onDismiss={preview.clearProblem} />}
        </div>
      )}
      {preview.modal}
    </div>
  );
}

/** קהלים שמורים — every saved audience on the account, and the presets to add one. */
export function AudiencesPanel({ isOwner, reloadKey, onChanged }: { isOwner: boolean; reloadKey: number; onChanged: () => void }) {
  const [setup, setSetup] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => {
    if (!isOwner) return;
    get('/band/meta/setup').then(setSetup).catch((e) => setError(e.message));
  };
  useEffect(load, [reloadKey, isOwner]);
  if (!isOwner) return <p className="text-sm text-body">הקהלים זמינים לבעלים בלבד.</p>;
  if (error) return <InlineError text={`לא הצלחנו לקרוא את הקהלים מ-Meta: ${error}`} onDismiss={() => setError('')} />;
  if (!setup) return <div className="h-24 rounded-xl bg-soft animate-pulse motion-reduce:animate-none" aria-label="קורא מ-Meta" />;
  if (!setup.configured) return <p className="text-sm text-body">Meta לא מחוברת.</p>;
  return (
    <div className="space-y-5">
      {setup.audiences_error
        ? <InlineError text={`לא הצלחנו לקרוא את הקהלים מ-Meta: ${setup.audiences_error}`} />
        : <AudienceList audiences={setup.audiences ?? []} />}
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-ink"><Users className="w-4 h-4 text-accent" aria-hidden />קהל חדש</h3>
        <AudienceCreator setup={setup} isOwner={isOwner} onCreated={() => { load(); onChanged(); }} />
      </div>
    </div>
  );
}
