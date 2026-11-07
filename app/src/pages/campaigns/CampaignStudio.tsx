import React, { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, Inbox, Megaphone, Music, Sparkles, ListChecks, Receipt, Radar, MoreHorizontal, Plus, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { get } from '../../api';
import { useAuth } from '../../AuthContext';
import { SyncButton } from '../../SyncButton';
import { PeriodSelect, useUrlPeriodFilter } from '../../ui';
import { AdsTab } from '../band/AdsTab';
import { CampaignAnalysisTab } from '../band/CampaignAnalysisTab';
import { CampaignTasksPanel } from '../band/CampaignTasksPanel';
import { ActionsLog } from '../band/MetaActions';
import { PixelPanel } from '../band/PixelPanel';
import { CampaignsSection } from './CampaignsSection';
import { CreateWizard, type WizardSeed } from './CreateWizard';
import { DecisionFeed } from './DecisionFeed';
import { SectionHead } from './studioShared';
import { AudiencesPanel } from './AudienceCreator';

type Section = 'decide' | 'campaigns' | 'shows' | 'advisor' | 'tasks' | 'spend' | 'tracking';

const SECTIONS: Array<{ id: Section; label: string; short?: string; icon: React.ElementType; mobile?: boolean }> = [
  { id: 'decide', label: 'החלטות', icon: Inbox, mobile: true },
  { id: 'campaigns', label: 'קמפיינים', icon: Megaphone, mobile: true },
  { id: 'shows', label: 'הופעות ותוכניות', short: 'הופעות', icon: Music, mobile: true },
  { id: 'advisor', label: 'יועץ AI', short: 'יועץ', icon: Sparkles, mobile: true },
  { id: 'tasks', label: 'משימות', icon: ListChecks },
  { id: 'spend', label: 'הוצאות וחיובים', icon: Receipt },
  { id: 'tracking', label: 'פיקסל, קהלים ויומן', icon: Radar },
];

const isSection = (v: string | undefined): v is Section => SECTIONS.some((s) => s.id === v);
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const path = (id: Section) => (id === 'decide' ? '/campaigns' : `/campaigns/${id}`);

/**
 * מרכז קמפיינים — the band's campaigns, run from one place, as an app of its own.
 *
 * It leaves the accounting shell on purpose: the ink rail (a bottom tab bar on a phone) is the
 * studio's only navigation, so creating, editing, reading the advisor and checking a show's tasks
 * are a tap apart and nothing about invoices is in the way. «חזרה לספרים» is the door back.
 *
 * The first screen is the decision feed; everything else is the place a decision leads to. Any
 * change in Meta — from the feed, a campaign's panel or the create wizard — goes through the same
 * preview and confirm (server/metaActions.ts).
 */
export function CampaignStudio() {
  const { user, branding, loading } = useAuth();
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const section: Section = isSection(params.section) ? params.section : 'decide';
  const period = useUrlPeriodFilter();
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [wizard, setWizard] = useState<WizardSeed | null>(null);
  const isOwner = user?.role === 'owner';

  useEffect(() => { document.documentElement.dataset.ws = 'moon'; }, []);
  useEffect(() => { setMoreOpen(false); window.scrollTo({ top: 0 }); }, [section]);

  const loadEvents = () => { get('/band/events').then((d) => setEvents(d.events)).catch((e) => setError(e.message)); };
  useEffect(() => { if (user) loadEvents(); }, [user?.id]);
  const changed = () => setReloadKey((k) => k + 1);

  // `?new=1` (with `show=`) opens the wizard from a link, and is dropped so a reload does not reopen it.
  useEffect(() => {
    if (searchParams.get('new') !== '1' || !isOwner) return;
    setWizard({ event_id: searchParams.get('show') ?? undefined, fromPlan: searchParams.get('plan') === '1' });
    const next = new URLSearchParams(searchParams);
    next.delete('new'); next.delete('plan');
    setSearchParams(next, { replace: true });
  }, [searchParams, isOwner]);

  useEffect(() => {
    if (params.section !== undefined && !isSection(params.section)) navigate('/campaigns', { replace: true });
  }, [params.section]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-faint">טוען…</div>;
  if (!user) return <Navigate to="/login" replace />;

  const showError = (m: string) => { setError(m); if (m) setNotice(''); };
  const showNotice = (m: string) => { setNotice(m); if (m) setError(''); };
  const tabProps = { isOwner, onError: showError, onNotice: showNotice, reload: () => { loadEvents(); changed(); } };
  const periodLabel = period.year === '' ? 'כל השנים' : period.month === '' ? `${period.year}` : `${MONTHS[Number(period.month) - 1]} ${period.year}`;

  const go = (id: string, query = '') => navigate(`${path(id as Section)}${query}`);
  const openCampaign = (id: string) => go('campaigns', `?c=${id}`);
  const openShow = (eventId: string) => go('shows', `?show=${eventId}`);
  const create = (eventId?: string, fromPlan?: boolean) => setWizard({ event_id: eventId, fromPlan });
  const selectedCampaign = section === 'campaigns' ? searchParams.get('c') : null;
  const current = SECTIONS.find((s) => s.id === section)!;
  const periodPicker = ['decide', 'advisor', 'spend'].includes(section) && (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodSelect year={period.year} month={period.month} onYearChange={period.setYear} onMonthChange={period.setMonth} />
    </div>
  );

  const railLink = (s: (typeof SECTIONS)[number]) => (
    <NavLink key={s.id} to={path(s.id)} end={s.id === 'decide'}
      className={({ isActive }) => clsx('flex items-center gap-3 rounded-[10px] px-3 min-h-11 text-[15px] transition-colors',
        isActive ? 'bg-white/12 text-white font-semibold' : 'text-white/72 hover:bg-white/6 hover:text-white')}>
      {({ isActive }) => (
        <>
          <s.icon className={clsx('w-[18px] h-[18px] shrink-0', isActive ? 'text-[#c9b8ff]' : 'text-white/55')} aria-hidden />
          {s.label}
        </>
      )}
    </NavLink>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr] bg-canvas">
      {/* ---- the rail: the studio's own navigation, on the reading side */}
      <aside className="hidden lg:block bg-[var(--ws-ink)] text-white">
        <div className="sticky top-0 h-screen flex flex-col px-3 py-5">
        <div className="px-3 pb-5">
          <p className="text-xs text-white/55 truncate">{branding.band_name}</p>
          <p className="ser text-xl leading-tight">מרכז קמפיינים</p>
        </div>
        {isOwner && (
          <button type="button" onClick={() => create()}
            className="mx-1 mb-4 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 min-h-11 text-sm font-semibold text-white hover:brightness-110 active:scale-[0.98] transition">
            <Plus className="w-4 h-4" aria-hidden />קמפיין חדש
          </button>
        )}
        <nav aria-label="מרכז קמפיינים" className="flex flex-col gap-0.5">{SECTIONS.map(railLink)}</nav>
        <div className="mt-auto space-y-2 px-1 pt-4">
          <SyncButton service="meta" onError={showError} onDone={(m) => { showNotice(m); changed(); }} reload={loadEvents}
            className="w-full !bg-white/8 !text-white !border-white/15 hover:!bg-white/14" />
          <Link to="/band/summary" className="flex items-center gap-2 rounded-[10px] px-3 min-h-10 text-sm text-white/65 hover:text-white hover:bg-white/6">
            <ArrowRight className="w-4 h-4" aria-hidden />חזרה לספרים
          </Link>
        </div>
        </div>
      </aside>

      <div className="min-w-0 flex flex-col">
        {/* ---- a phone's bar: where you are, and the one thing always worth a tap */}
        <header className="lg:hidden sticky top-0 z-30 bg-[var(--ws-ink)] text-white">
          <div className="flex items-center justify-between gap-3 px-4 h-14">
            <div className="min-w-0">
              <p className="text-[11px] text-white/55 leading-none">מרכז קמפיינים</p>
              <p className="ser text-[17px] leading-tight truncate">{current.label}</p>
            </div>
            {isOwner && (
              <button type="button" onClick={() => create()} aria-label="קמפיין חדש"
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 h-10 text-sm font-semibold">
                <Plus className="w-4 h-4" aria-hidden />חדש
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 w-full max-w-[84rem] mx-auto px-4 md:px-8 pt-5 md:pt-8 pb-28 lg:pb-12 space-y-5">
          {!isOwner && <p className="text-sm text-muted">תצוגה בלבד — שינויים בקמפיינים זמינים לבעלים בלבד. אפשר לסמן משימות שלכם כבוצעו.</p>}
          {error && <div role="alert" className="text-sm text-neg-ink bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}
          {notice && <div role="status" className="text-sm text-pos-ink bg-pos-soft rounded-xl px-4 py-2.5 whitespace-pre-line">{notice}</div>}

          <div key={section} className="settle-in">
            {section === 'decide' && (
              <DecisionFeed events={events} isOwner={isOwner} period={period} periodLabel={periodLabel} reloadKey={reloadKey} toolbar={periodPicker}
                onChanged={changed} onOpenCampaign={openCampaign} onOpenShow={openShow} onCreate={create} onOpenSection={(s) => go(s)} />
            )}
            {section === 'campaigns' && (
              <CampaignsSection events={events} isOwner={isOwner} selected={selectedCampaign} reloadKey={reloadKey} onChanged={changed}
                onSelect={(id) => setSearchParams(id ? { c: id } : {}, { replace: true })} onCreate={create} />
            )}
            {section === 'shows' && (
              <div className="space-y-5">
                <SectionHead title="הופעות ותוכניות" sub="בחרו הופעה כדי לראות איך הקמפיין שלה מתקדם, לבנות לה תוכנית עם הסוכן, או ליצור ממנה קמפיין." />
                <CampaignAnalysisTab {...tabProps} events={events} period={period} only="shows"
                  onOpenTasks={() => go('tasks')} onCreateFromPlan={(id) => create(id, true)} />
              </div>
            )}
            {section === 'advisor' && (
              <div className="space-y-5">
                <SectionHead title="יועץ AI" sub="סיכום של התקופה ושאלות פתוחות לסוכן. כל שינוי שהוא מציע נפתח בתצוגה מקדימה, ומתבצע רק באישור שלכם." actions={periodPicker} />
                <CampaignAnalysisTab {...tabProps} events={events} period={period} only="advisor" />
              </div>
            )}
            {section === 'tasks' && (
              <div className="space-y-5">
                <SectionHead title="משימות" sub="מה צריך לעשות לפני כל הופעה, ומי אחראי. תזכורות יוצאות במייל לפי התאריך." />
                <div className="rounded-2xl bg-surface border border-line p-4 md:p-6">
                  <CampaignTasksPanel events={events} isOwner={isOwner} onError={showError} reloadKey={reloadKey} onChanged={changed} />
                </div>
              </div>
            )}
            {section === 'spend' && (
              <div className="space-y-5">
                <SectionHead title="הוצאות וחיובים" sub="מה עלה הפרסום של כל הופעה, החיוב החודשי מ-Meta, ואיזה קמפיין שילם על איזו הופעה." />
                <AdsTab {...tabProps} events={events} period={period} />
              </div>
            )}
            {section === 'tracking' && (
              <div className="space-y-8">
                <SectionHead title="פיקסל, קהלים ויומן" sub="האם דפי הכרטיסים של המועדונים מדווחים מכירות, הקהלים השמורים, וכל מה שהאפליקציה שינתה ב-Meta." />
                <section aria-labelledby="audiences-heading" className="rounded-2xl bg-surface border border-line p-4 md:p-6">
                  <h2 id="audiences-heading" className="text-[17px] font-bold text-ink mb-1">קהלים שמורים</h2>
                  <p className="text-sm text-body mb-3">הקהלים שקמפיין חם פונה אליהם, ומי שמחריגים מכל קמפיין. קהל חדש נבנה מהימים שכבר עברו, ומתמלא תוך כחצי שעה.</p>
                  <AudiencesPanel isOwner={isOwner} reloadKey={reloadKey} onChanged={changed} />
                </section>
                <section aria-labelledby="pixel-heading" className="rounded-2xl bg-surface border border-line p-4 md:p-6">
                  <h2 id="pixel-heading" className="text-[17px] font-bold text-ink mb-3">פיקסל ומעקב מכירות</h2>
                  <PixelPanel isOwner={isOwner} onError={showError} onChanged={changed} />
                </section>
                <section aria-labelledby="log-heading" className="rounded-2xl bg-surface border border-line p-4 md:p-6">
                  <h2 id="log-heading" className="text-[17px] font-bold text-ink mb-3">שינויים שנעשו ב-Meta</h2>
                  <ActionsLog reloadKey={reloadKey} />
                </section>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ---- a phone's tab bar: the four places a visit is about, and the rest behind «עוד» */}
      <nav aria-label="מרכז קמפיינים" className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-5">
          {SECTIONS.filter((s) => s.mobile).map((s) => (
            <li key={s.id}>
              <NavLink to={path(s.id)} end={s.id === 'decide'}
                className={({ isActive }) => clsx('flex flex-col items-center justify-center gap-0.5 h-16 text-[11px]', isActive ? 'text-accent-ink font-semibold' : 'text-muted')}>
                <s.icon className="w-[22px] h-[22px]" aria-hidden />{s.short ?? s.label}
              </NavLink>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen}
              className={clsx('w-full flex flex-col items-center justify-center gap-0.5 h-16 text-[11px]',
                ['tasks', 'spend', 'tracking'].includes(section) ? 'text-accent-ink font-semibold' : 'text-muted')}>
              <MoreHorizontal className="w-[22px] h-[22px]" aria-hidden />עוד
            </button>
          </li>
        </ul>
      </nav>
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-[rgba(26,22,45,.45)]" onClick={() => setMoreOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="עוד" onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-12px_40px_rgba(36,29,61,.25)]">
            <div className="flex items-center justify-between px-2 pb-2">
              <p className="ser text-lg">עוד</p>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="סגירה" className="w-10 h-10 grid place-items-center rounded-lg text-muted hover:bg-soft"><X className="w-5 h-5" aria-hidden /></button>
            </div>
            <ul className="space-y-0.5">
              {SECTIONS.filter((s) => !s.mobile).map((s) => (
                <li key={s.id}>
                  <NavLink to={path(s.id)} className={({ isActive }) => clsx('flex items-center gap-3 rounded-xl px-3 min-h-12 text-[15px]', isActive ? 'bg-accent-soft text-accent-ink font-semibold' : 'text-ink-2 hover:bg-soft')}>
                    <s.icon className="w-5 h-5" aria-hidden />{s.label}
                  </NavLink>
                </li>
              ))}
              <li className="pt-2 px-1">
                <SyncButton service="meta" onError={showError} onDone={(m) => { showNotice(m); changed(); setMoreOpen(false); }} reload={loadEvents} className="w-full" />
              </li>
              <li>
                <Link to="/band/summary" className="flex items-center gap-3 rounded-xl px-3 min-h-12 text-[15px] text-muted hover:bg-soft">
                  <ArrowRight className="w-5 h-5" aria-hidden />חזרה לספרים
                </Link>
              </li>
            </ul>
          </div>
        </div>
      )}

      {wizard && (
        <CreateWizard seed={wizard} events={events} onClose={() => setWizard(null)}
          onCreated={(id) => { setWizard(null); changed(); if (id) openCampaign(id); }} />
      )}
    </div>
  );
}
