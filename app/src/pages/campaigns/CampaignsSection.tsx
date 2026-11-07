import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarX, ExternalLink, Pause, Pencil, Play, Search, Archive, Wallet, X } from 'lucide-react';
import { clsx } from 'clsx';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { del, get, nis, post } from '../../api';
import { Button, Combobox, fieldClass } from '../../ui';
import { ddmm, InlineError } from '../band/advisorShared';
import { CAMPAIGN_STATUS, ChangeLine, OBJECTIVE_LABELS, SectionHead, StatusDot, israelToday, usePreview } from './studioShared';

type Filter = 'live' | 'active' | 'paused' | 'unmapped' | 'archived';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'live', label: 'הכל' },
  { value: 'active', label: 'פעילים' },
  { value: 'paused', label: 'מושהים' },
  { value: 'unmapped', label: 'לא משויכים' },
  { value: 'archived', label: 'ארכיון' },
];

const archived = (c: any) => c.status === 'ARCHIVED' || c.status === 'DELETED';

/**
 * קמפיינים — every campaign on the account, and one campaign's workspace beside the list.
 *
 * The list is the synced one (status, spend, the shows it is tied to); the workspace reads the
 * campaign live from Meta when it opens — its budget, its ad sets and its ads — because those are
 * what an edit is made against. Every edit opens a preview first (`usePreview`); mapping to a show
 * is the app's own bookkeeping, so it applies straight away.
 */
export function CampaignsSection({ events, isOwner, selected, onSelect, onCreate, reloadKey, onChanged }: {
  events: any[];
  isOwner: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (eventId?: string) => void;
  reloadKey: number;
  onChanged: () => void;
}) {
  const [campaigns, setCampaigns] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('live');
  const [query, setQuery] = useState('');

  const load = () => {
    if (!isOwner) { setCampaigns([]); return; }
    get('/integrations/meta/campaigns').then((d) => setCampaigns(d.campaigns)).catch((e) => { setError(e.message); setCampaigns([]); });
  };
  useEffect(load, [reloadKey, isOwner]);

  const counts = useMemo(() => {
    const list = campaigns ?? [];
    return {
      live: list.filter((c) => !archived(c)).length,
      active: list.filter((c) => c.status === 'ACTIVE').length,
      paused: list.filter((c) => c.status === 'PAUSED').length,
      unmapped: list.filter((c) => !archived(c) && c.events.length === 0).length,
      archived: list.filter(archived).length,
    } as Record<Filter, number>;
  }, [campaigns]);

  const shown = (campaigns ?? []).filter((c) => {
    if (filter === 'live' && archived(c)) return false;
    if (filter === 'active' && c.status !== 'ACTIVE') return false;
    if (filter === 'paused' && c.status !== 'PAUSED') return false;
    if (filter === 'unmapped' && (archived(c) || c.events.length > 0)) return false;
    if (filter === 'archived' && !archived(c)) return false;
    const q = query.trim();
    return !q || c.name.includes(q) || c.events.some((e: any) => e.label.includes(q));
  });
  const current = campaigns?.find((c) => c.id === selected) ?? null;
  const changed = () => { load(); onChanged(); };

  if (!isOwner) {
    return (
      <div className="space-y-4">
        <SectionHead title="קמפיינים" />
        <p className="text-sm text-body">רשימת הקמפיינים והעריכה שלהם זמינות לבעלים בלבד. מה שכל הופעה עלתה בפרסום מופיע במסך «הופעות».</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className={clsx(current && 'hidden lg:block')}>
        <SectionHead title="קמפיינים" sub="כל הקמפיינים בחשבון. בחרו קמפיין כדי לערוך אותו, את קבוצות המודעות ואת המודעות שבו." />
      </div>
      {error && <InlineError text={error} onDismiss={() => setError('')} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(20rem,26rem)_1fr] items-start">
        {/* ---- the list: on a phone it gives way to the workspace once one is chosen */}
        <section aria-label="רשימת הקמפיינים" className={clsx('rounded-2xl bg-surface border border-line overflow-hidden', current && 'hidden lg:block')}>
          <div className="p-3 space-y-2.5 border-b border-line">
            <label className="relative block">
              <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-ghost" aria-hidden />
              <input className={clsx(fieldClass, 'ps-9')} placeholder="חיפוש לפי שם או הופעה" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div role="tablist" aria-label="סינון" className="flex gap-1 overflow-x-auto rail -mx-1 px-1">
              {FILTERS.map((f) => (
                <button key={f.value} role="tab" aria-selected={filter === f.value} type="button" onClick={() => setFilter(f.value)}
                  className={clsx('shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 min-h-9 text-[13px] font-semibold transition-colors',
                    filter === f.value ? 'bg-[var(--ws-ink)] text-white' : 'text-muted hover:bg-soft hover:text-ink-2')}>
                  {f.label}<span className={clsx('num text-[11px]', filter === f.value ? 'text-white/70' : 'text-faint')}>{counts[f.value]}</span>
                </button>
              ))}
            </div>
          </div>
          {campaigns === null ? (
            <div className="p-3 space-y-2" aria-label="טוען קמפיינים">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-soft animate-pulse motion-reduce:animate-none" />)}
            </div>
          ) : shown.length === 0 ? (
            <div className="px-4 py-8 text-center space-y-2">
              <p className="text-sm text-body">
                {campaigns.length === 0 ? 'עוד אין קמפיינים מסונכרנים. סנכרון מ-Meta מביא אותם, או שאפשר ליצור אחד כאן.' : 'אין קמפיינים שמתאימים לסינון.'}
              </p>
              {campaigns.length === 0 && <Button variant="ghost" onClick={() => onCreate()}>קמפיין חדש</Button>}
            </div>
          ) : (
            <ul className="divide-y divide-line max-h-[70vh] overflow-y-auto">
              {shown.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onSelect(c.id)} aria-current={c.id === selected ? 'true' : undefined}
                    className={clsx('w-full text-start px-4 py-3 transition-colors', c.id === selected ? 'bg-accent-soft' : 'hover:bg-soft')}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-ink truncate">{c.name}</span>
                        <span className="block text-xs text-muted truncate mt-0.5">
                          {c.events.length ? c.events.map((e: any) => e.label).join(' · ') : <span className="text-warn-ink">לא משויך להופעה</span>}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="num block text-sm font-semibold text-ink">{nis(c.spend)}</span>
                        <StatusDot status={c.status} />
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {current ? (
          <CampaignPanel key={current.id} campaign={current} events={events} onBack={() => onSelect(null)} onChanged={changed} />
        ) : (
          <div className="hidden lg:flex rounded-2xl border border-dashed border-line-strong min-h-64 items-center justify-center p-8 text-center">
            <p className="text-sm text-body max-w-xs">בחרו קמפיין מהרשימה כדי לראות את קבוצות המודעות והמודעות שבו, לשנות תקציב, לעצור או להעביר לארכיון.</p>
          </div>
        )}
      </div>
    </div>
  );
}

type Edit = { kind: 'budget' | 'end' | 'rename'; level: 'campaign' | 'adset'; id: string; name: string; value: string } | null;

/** One campaign: what it is, what it spent, what is under it, and every change that can be made to it. */
function CampaignPanel({ campaign, events, onBack, onChanged }: {
  campaign: any;
  events: any[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [structure, setStructure] = useState<any>(null);
  const [structureError, setStructureError] = useState('');
  const [daily, setDaily] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<Edit>(null);
  const [mapping, setMapping] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const today = israelToday();

  const loadStructure = () => {
    setStructureError('');
    get(`/band/meta/campaigns/${campaign.id}/structure`).then(setStructure).catch((e) => setStructureError(e.message));
  };
  useEffect(() => {
    loadStructure();
    get(`/integrations/meta/campaigns/${campaign.id}/daily`).then((d) => setDaily(d.daily)).catch(() => setDaily([]));
  }, [campaign.id]);

  const preview = usePreview(() => { setEdit(null); loadStructure(); onChanged(); });
  const live = structure?.campaign;
  const status = live?.status ?? campaign.status;
  const isArchived = status === 'ARCHIVED' || status === 'DELETED';
  const end = String(live?.stop_time ?? '').slice(0, 10);
  const lastShow = [...campaign.events].sort((a: any, b: any) => b.date.localeCompare(a.date))[0];
  const ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : null;
  const action = (a: Record<string, unknown>, key: string) => preview.open({ name: campaign.name, ...a }, key);

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    if (edit.kind === 'budget') action({ type: 'set_daily_budget', level: edit.level, id: edit.id, name: edit.name, daily_budget: Number(edit.value) }, 'edit');
    if (edit.kind === 'end') action({ type: 'set_end_date', level: edit.level, id: edit.id, name: edit.name, end_date: edit.value }, 'edit');
    if (edit.kind === 'rename') action({ type: 'rename', level: edit.level, id: edit.id, name: edit.name, new_name: edit.value.trim() }, 'edit');
  };

  const mapTo = async (eventId: string) => {
    if (!eventId) return;
    setBusy(true); setProblem('');
    try { await post(`/integrations/meta/campaigns/${campaign.id}/mappings`, { event_id: eventId }); setMapping(''); onChanged(); }
    catch (err: any) { setProblem(err.message); }
    finally { setBusy(false); }
  };
  const unmap = async (eventId: string) => {
    setBusy(true); setProblem('');
    try { await del(`/integrations/meta/campaigns/${campaign.id}/mappings/${eventId}`); onChanged(); }
    catch (err: any) { setProblem(err.message); }
    finally { setBusy(false); }
  };

  const editor = (target: NonNullable<Edit>) => edit && edit.id === target.id && edit.kind === target.kind && (
    <form onSubmit={submitEdit} className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-soft p-3">
      <label className="block flex-1 min-w-[10rem]">
        <span className="block text-xs text-muted mb-1">{edit.kind === 'budget' ? 'תקציב יומי חדש (₪)' : edit.kind === 'end' ? 'היום האחרון שהוא רץ' : 'שם חדש'}</span>
        <input autoFocus className={clsx(fieldClass, 'bg-surface', edit.kind === 'budget' && 'num')}
          type={edit.kind === 'end' ? 'date' : 'text'} inputMode={edit.kind === 'budget' ? 'decimal' : undefined}
          min={edit.kind === 'end' ? today : undefined} value={edit.value}
          onChange={(e) => setEdit({ ...edit, value: edit.kind === 'budget' ? e.target.value.replace(/[^\d.]/g, '') : e.target.value })} />
      </label>
      <Button type="submit" disabled={!edit.value.trim() || preview.loading != null}>{preview.loading === 'edit' ? 'קורא מ-Meta…' : 'תצוגה מקדימה'}</Button>
      <Button variant="ghost" onClick={() => setEdit(null)}>ביטול</Button>
    </form>
  );

  const unmappedEvents = events.filter((e) => !campaign.events.some((m: any) => m.event_id === e.id))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section aria-label={campaign.name} className="settle-in rounded-2xl bg-surface border border-line overflow-hidden">
      {/* ---- what it is */}
      <header className="px-4 md:px-6 pt-4 pb-5 border-b border-line">
        <button type="button" onClick={onBack} className="lg:hidden inline-flex items-center gap-1 text-sm text-accent-ink min-h-10 -mt-1 mb-1">
          <ArrowRight className="w-4 h-4" aria-hidden />כל הקמפיינים
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusDot status={status} />
              {live?.effective_status && live.effective_status !== live.status && CAMPAIGN_STATUS[live.effective_status] && (
                <span className="text-xs text-muted">בפועל: {CAMPAIGN_STATUS[live.effective_status].label}</span>
              )}
              {campaign.objective && <span className="text-xs text-muted">מטרה: {OBJECTIVE_LABELS[campaign.objective] ?? campaign.objective}</span>}
            </div>
            <h2 className="ser text-xl md:text-2xl mt-1 break-words">{live?.name ?? campaign.name}</h2>
          </div>
          {!isArchived && (
            <button type="button" onClick={() => setEdit({ kind: 'rename', level: 'campaign', id: campaign.id, name: campaign.name, value: live?.name ?? campaign.name })}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 min-h-10 text-sm text-ink-2 hover:bg-soft">
              <Pencil className="w-4 h-4" aria-hidden />שינוי שם
            </button>
          )}
        </div>
        {editor({ kind: 'rename', level: 'campaign', id: campaign.id, name: '', value: '' })}

        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          {[
            ['הוצאה', nis(campaign.spend)],
            ['תקציב יומי', live ? (live.daily_budget != null ? nis(live.daily_budget) : live.lifetime_budget != null ? `${nis(live.lifetime_budget)} כולל` : 'ברמת קבוצת המודעות') : '…'],
            ['קליקים', campaign.clicks ? `${campaign.clicks.toLocaleString('he-IL')}${ctr != null ? ` · ${ctr.toFixed(1)}%` : ''}` : '—'],
            ['טווח הגעה', campaign.reach ? campaign.reach.toLocaleString('he-IL') : '—'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-faint">{k}</dt>
              <dd className="num text-[15px] font-semibold text-ink mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="divide-y divide-line">
        {/* ---- the changes that can be made to the campaign itself */}
        {!isArchived && (
          <div className="px-4 md:px-6 py-4 space-y-3">
            {status === 'ACTIVE' && lastShow && lastShow.date < today && (
              <div className="rounded-xl bg-warn-soft px-4 py-3 space-y-1.5">
                <p className="text-sm font-semibold text-warn-ink">ההופעה האחרונה שלו ({lastShow.label}) כבר הייתה, והוא עדיין פעיל.</p>
                <ChangeLine from="פעיל" to="מושהה" size="sm" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {status === 'ACTIVE' ? (
                <Button variant={lastShow && lastShow.date < today ? 'primary' : 'ghost'} disabled={preview.loading != null}
                  onClick={() => action({ type: 'pause', level: 'campaign', id: campaign.id }, 'pause')}>
                  <span className="inline-flex items-center gap-1.5"><Pause className="w-4 h-4" aria-hidden />{preview.loading === 'pause' ? 'קורא מ-Meta…' : 'השהיה'}</span>
                </Button>
              ) : (
                <Button disabled={preview.loading != null} onClick={() => action({ type: 'activate', level: 'campaign', id: campaign.id }, 'activate')}>
                  <span className="inline-flex items-center gap-1.5"><Play className="w-4 h-4" aria-hidden />{preview.loading === 'activate' ? 'קורא מ-Meta…' : 'הפעלה'}</span>
                </Button>
              )}
              {live?.daily_budget != null && (
                <Button variant="ghost" onClick={() => setEdit({ kind: 'budget', level: 'campaign', id: campaign.id, name: campaign.name, value: String(live.daily_budget) })}>
                  <span className="inline-flex items-center gap-1.5"><Wallet className="w-4 h-4" aria-hidden />תקציב יומי</span>
                </Button>
              )}
              <Button variant="ghost" onClick={() => setEdit({ kind: 'end', level: 'campaign', id: campaign.id, name: campaign.name, value: end || lastShow?.date || today })}>
                <span className="inline-flex items-center gap-1.5"><CalendarX className="w-4 h-4" aria-hidden />{end ? `סיום ${ddmm(end)}` : 'תאריך סיום'}</span>
              </Button>
              <Button variant="ghost" disabled={preview.loading != null} onClick={() => action({ type: 'archive', level: 'campaign', id: campaign.id }, 'archive')}>
                <span className="inline-flex items-center gap-1.5 text-neg-ink"><Archive className="w-4 h-4" aria-hidden />{preview.loading === 'archive' ? 'קורא מ-Meta…' : 'העברה לארכיון'}</span>
              </Button>
            </div>
            {editor({ kind: 'budget', level: 'campaign', id: campaign.id, name: '', value: '' })}
            {editor({ kind: 'end', level: 'campaign', id: campaign.id, name: '', value: '' })}
            {preview.problem && <InlineError text={preview.problem.text} onDismiss={preview.clearProblem} />}
          </div>
        )}

        {/* ---- under it: ad sets and ads, read live */}
        <div className="px-4 md:px-6 py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-bold text-ink">קבוצות מודעות</h3>
            <a href={`https://adsmanager.facebook.com/adsmanager/manage/adsets?selected_campaign_ids=${campaign.id}`} target="_blank" rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-sm text-accent-ink hover:underline"><ExternalLink className="w-3.5 h-3.5" aria-hidden />Ads Manager</a>
          </div>
          {structureError ? <InlineError text={`לא הצלחנו לקרוא מ-Meta: ${structureError}`} onDismiss={() => setStructureError('')} />
            : !structure ? <div className="h-16 rounded-xl bg-soft animate-pulse motion-reduce:animate-none" aria-label="קורא מ-Meta" />
            : structure.adsets.length === 0 ? <p className="text-sm text-body">אין קבוצות מודעות בקמפיין הזה.</p>
            : (
              <ul className="space-y-2">
                {structure.adsets.map((s: any) => {
                  const ads = structure.ads.filter((a: any) => a.adset_id === s.id);
                  const t = s.targeting ?? {};
                  return (
                    <li key={s.id} className="rounded-xl border border-line">
                      <div className="flex flex-wrap items-start justify-between gap-2 px-3.5 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-ink break-words">{s.name}</div>
                          <div className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-2">
                            <StatusDot status={s.status} />
                            {s.daily_budget != null && <span className="num">{nis(s.daily_budget)} ליום</span>}
                            {t.age_min && <span className="num">גילאי {t.age_min}–{t.age_max ?? '65'}</span>}
                            {s.end_time && <span className="num">עד {ddmm(String(s.end_time).slice(0, 10))}</span>}
                          </div>
                        </div>
                        {!isArchived && (
                          <div className="flex gap-1">
                            {s.daily_budget != null && (
                              <button type="button" onClick={() => setEdit({ kind: 'budget', level: 'adset', id: s.id, name: s.name, value: String(s.daily_budget) })}
                                className="rounded-lg px-2.5 min-h-9 text-sm text-ink-2 hover:bg-soft">תקציב</button>
                            )}
                            <button type="button" disabled={preview.loading != null}
                              onClick={() => preview.open({ type: s.status === 'ACTIVE' ? 'pause' : 'activate', level: 'adset', id: s.id, name: s.name }, s.id)}
                              className="rounded-lg px-2.5 min-h-9 text-sm text-ink-2 hover:bg-soft">
                              {preview.loading === s.id ? 'קורא…' : s.status === 'ACTIVE' ? 'השהיה' : 'הפעלה'}
                            </button>
                          </div>
                        )}
                      </div>
                      {editor({ kind: 'budget', level: 'adset', id: s.id, name: '', value: '' }) && (
                        <div className="px-3.5 pb-3">{editor({ kind: 'budget', level: 'adset', id: s.id, name: '', value: '' })}</div>
                      )}
                      {ads.length > 0 && (
                        <ul className="border-t border-line divide-y divide-line">
                          {ads.map((a: any) => (
                            <li key={a.id} className="flex items-center gap-3 px-3.5 py-2.5">
                              {a.creative?.thumbnail_url || a.creative?.image_url
                                ? <img src={a.creative.thumbnail_url ?? a.creative.image_url} alt="" className="w-11 h-11 rounded-lg object-cover bg-soft shrink-0" loading="lazy" />
                                : <span className="w-11 h-11 rounded-lg bg-soft shrink-0" aria-hidden />}
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm text-ink truncate">{a.creative?.title || a.name}</span>
                                {a.creative?.body && <span className="block text-xs text-muted truncate">{a.creative.body}</span>}
                              </span>
                              <StatusDot status={a.effective_status ?? a.status} className="hidden sm:inline-flex" />
                              {!isArchived && (
                                <button type="button" disabled={preview.loading != null}
                                  onClick={() => preview.open({ type: a.status === 'ACTIVE' ? 'pause' : 'activate', level: 'ad', id: a.id, name: a.name }, a.id)}
                                  className="shrink-0 rounded-lg px-2.5 min-h-9 text-sm text-ink-2 hover:bg-soft">
                                  {preview.loading === a.id ? 'קורא…' : a.status === 'ACTIVE' ? 'השהיה' : 'הפעלה'}
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
        {/* ---- the shows it paid for */}
        <div className="px-4 md:px-6 py-4 space-y-2.5">
          <h3 className="text-[15px] font-bold text-ink">הופעות</h3>
          {campaign.events.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {campaign.events.map((e: any) => (
                <li key={e.event_id} className="inline-flex items-center gap-1 rounded-full bg-soft ps-3 pe-1 min-h-9 text-sm text-ink-2">
                  {e.label}{campaign.events.length > 1 && <span className="num text-xs text-muted ms-1">{Math.round(e.share * 100)}%</span>}
                  <button type="button" disabled={busy} onClick={() => unmap(e.event_id)} aria-label={`ביטול השיוך ל${e.label}`}
                    className="w-7 h-7 grid place-items-center rounded-full text-muted hover:bg-line hover:text-ink"><X className="w-3.5 h-3.5" aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-warn-ink">לא משויך להופעה, אז ההוצאה שלו נספרת כפרסום לא משויך.</p>
          )}
          {campaign.suggestions?.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">אולי:</span>
              {campaign.suggestions.slice(0, 3).map((s: any) => (
                <button key={s.event_id} type="button" disabled={busy} onClick={() => mapTo(s.event_id)} title={s.reason}
                  className="rounded-full border border-accent/30 px-3 min-h-9 text-sm text-accent-ink hover:bg-accent-soft">+ {s.label}</button>
              ))}
            </div>
          )}
          <div className="max-w-sm">
            <Combobox value={mapping} placeholder="שיוך להופעה…" disabled={busy}
              options={unmappedEvents.map((e) => ({ value: e.id, label: `${e.venue} · ${e.date}` }))}
              onChange={(v) => { setMapping(v); mapTo(v); }} />
          </div>
          {problem && <InlineError text={problem} onDismiss={() => setProblem('')} />}
        </div>

        {/* ---- what it spent, day by day */}
        {daily && daily.length > 0 && (
          <div className="px-4 md:px-6 py-4">
            <h3 className="text-[15px] font-bold text-ink mb-2">הוצאה יומית</h3>
            <div className="h-40" dir="ltr" role="img" aria-label={`הוצאה יומית, ${daily.length} ימים, סה״כ ${nis(campaign.spend)}`}>
              <ResponsiveContainer>
                <BarChart data={daily} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <XAxis dataKey="date" tickFormatter={(d: string) => ddmm(d)} fontSize={11} stroke="#80868f" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis fontSize={11} stroke="#80868f" width={48} tickLine={false} axisLine={false} tickFormatter={(v: number) => nis(v)} />
                  <Tooltip cursor={{ fill: 'rgba(107,69,214,.06)' }} formatter={(v: any) => [nis(v), 'הוצאה']} labelFormatter={(d: any) => ddmm(String(d))}
                    contentStyle={{ borderRadius: 10, border: '1px solid #e4e2f2', fontSize: 12 }} />
                  <Bar dataKey="spend" fill="#6b45d6" radius={[4, 4, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

      </div>
      {preview.modal}
    </section>
  );
}
