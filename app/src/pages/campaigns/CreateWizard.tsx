import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ImagePlus, Sparkles, X, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { get, post } from '../../api';
import { Button, fieldClass } from '../../ui';
import { ddmm } from '../band/advisorShared';
import { ChangeLine, israelToday, usePreview } from './studioShared';

/** What the wizard is opened with: a show, and whether to fill it from that show's AI plan. */
export interface WizardSeed {
  event_id?: string;
  fromPlan?: boolean;
}

type Goal = 'sales' | 'traffic' | 'awareness';
type Temperature = 'cold' | 'hot';

const TEMPERATURES: Array<{ value: Temperature; title: string; sub: string }> = [
  { value: 'cold', title: 'קהל קר', sub: 'אנשים שעוד לא מכירים את הלהקה. Meta מוצאת אותם לפי האזור, הגילאים והמודעה עצמה. כאן נבנה קהל חדש, בדרך כלל בשבועות הראשונים.' },
  { value: 'hot', title: 'קהל חם', sub: 'מי שכבר הראה עניין: ביקר בדף הכרטיסים, צפה בוידאו, התעניין בדף. קהל קטן וזול יותר לכרטיס, בדרך כלל בשבוע-עשרה ימים שלפני ההופעה.' },
];

/** Meta's audience kinds, as the wizard names them. */
const SUBTYPES: Record<string, string> = {
  WEBSITE: 'מבקרי אתר', ENGAGEMENT: 'מעורבות', VIDEO: 'צפיות בוידאו', IG_BUSINESS: 'אינסטגרם', PAGE: 'דף פייסבוק',
  CUSTOM: 'רשימת לקוחות', LOOKALIKE: 'דומים', OFFLINE_CONVERSION: 'רכישות מחוץ לאתר',
};
/**
 * An audience whose name says it is people who already bought — excluded from a new campaign by
 * default. A lookalike «of buyers» is new people, so it never matches.
 */
const BUYERS = /רכיש|רוכש|קנו|קונים|purchas|buyer/i;
const MIN_HOT = 1000;

const audienceSize = (a: any) => {
  if (a.size_upper == null) return 'גודל לא ידוע';
  const fmt = (n: number) => n.toLocaleString('he-IL');
  return a.size_lower != null && a.size_lower !== a.size_upper ? `${fmt(a.size_lower)}–${fmt(a.size_upper)} איש` : `${fmt(a.size_upper)} איש`;
};

const GOALS: Array<{ value: Goal; title: string; sub: string }> = [
  { value: 'sales', title: 'מכירת כרטיסים', sub: 'Meta מחפשת את מי שיקנה, לפי אירועי הרכישה בפיקסל של המועדון. צריך פיקסל שמותקן בדף הכרטיסים.' },
  { value: 'traffic', title: 'כניסות לדף הכרטיסים', sub: 'מביא אנשים לדף הכרטיסים. מתאים כשאין פיקסל, או כשהפיקסל עוד לא מדווח על רכישות.' },
  { value: 'awareness', title: 'חשיפה', sub: 'כמה שיותר אנשים באזור רואים את ההופעה. נשפט לפי עלות לאלף חשיפות, לא לפי קליקים.' },
];

const CTAS = [
  { value: 'BUY_TICKETS', label: 'לרכישת כרטיסים' },
  { value: 'BOOK_NOW', label: 'להזמנה' },
  { value: 'LEARN_MORE', label: 'מידע נוסף' },
  { value: 'GET_OFFER', label: 'לקבלת ההצעה' },
];

const STEPS = ['הופעה ומטרה', 'קהל ותקציב', 'המודעה', 'בדיקה ואישור'];

interface Form {
  event_id: string;
  name: string;
  goal: Goal;
  daily_budget: string;
  start_date: string;
  end_date: string;
  age_min: string;
  age_max: string;
  temperature: Temperature;
  audience_ids: string[];
  excluded_audience_ids: string[];
  page_id: string;
  pixel_id: string;
  link: string;
  primary_text: string;
  headline: string;
  description: string;
  cta: string;
  image: { id: string; url: string } | null;
}

const blank = (today: string): Form => ({
  event_id: '', name: '', goal: 'traffic', daily_budget: '', start_date: today, end_date: '',
  age_min: '21', age_max: '45', temperature: 'cold', audience_ids: [], excluded_audience_ids: [], page_id: '', pixel_id: '', link: '', primary_text: '', headline: '',
  description: '', cta: 'BUY_TICKETS', image: null,
});

const days = (from: string, to: string) =>
  from && to ? Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1 : 0;

/**
 * קמפיין חדש — a campaign, its ad set and its ad, built in four steps and created in Meta only from
 * the last one, after the preview has been read. Everything is created with the campaign paused,
 * so confirming builds it and spends nothing; switching it on is its own change, offered at the end.
 *
 * It opens on a full screen sheet rather than a dialog in the page: it is the one long task in the
 * studio, and the ad's preview needs the room beside the form.
 */
export function CreateWizard({ seed, events, onClose, onCreated }: {
  seed: WizardSeed;
  events: any[];
  onClose: () => void;
  onCreated: (campaignId: string) => void;
}) {
  const today = israelToday();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(() => ({ ...blank(today), event_id: seed.event_id ?? '' }));
  const [setup, setSetup] = useState<{ configured: boolean; pages: any[]; pixels: any[]; audiences?: any[]; audiences_error?: string | null } | null>(null);
  const [setupError, setSetupError] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [planApplied, setPlanApplied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState('');
  const [reading, setReading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const activation = usePreview(() => onCreated(created?.result?.campaign_id));

  const set = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setPreview(null); };
  const upcoming = events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const show = events.find((e) => e.id === form.event_id) ?? null;

  useEffect(() => {
    get('/band/meta/setup').then((d) => {
      setSetup(d);
      setForm((f) => ({
        ...f,
        page_id: f.page_id || d.pages[0]?.id || '',
        pixel_id: f.pixel_id || d.pixels[0]?.id || '',
        goal: d.pixels.length ? f.goal : f.goal === 'sales' ? 'traffic' : f.goal,
        // People who already bought are left out of a new campaign unless the owner says otherwise.
        excluded_audience_ids: f.excluded_audience_ids.length ? f.excluded_audience_ids
          : (d.audiences ?? []).filter((a: any) => a.subtype !== 'LOOKALIKE' && BUYERS.test(a.name ?? '')).map((a: any) => a.id),
      }));
    }).catch((e) => setSetupError(e.message));
  }, []);

  // A show brings its date and ticket page, and its plan if one was made.
  useEffect(() => {
    if (!show) { setPlan(null); return; }
    setForm((f) => ({
      ...f,
      name: f.name && !f.name.endsWith('— כרטיסים') ? f.name : `${show.venue} ${ddmm(show.date)} — כרטיסים`,
      end_date: show.date >= today ? show.date : f.end_date,
      link: f.link || show.ticket_url || '',
    }));
    setPlanApplied(false);
    let current = true;
    get(`/band/campaign-draft/${show.id}`).then((d) => { if (current) setPlan(d.report?.response ?? null); }).catch(() => setPlan(null));
    return () => { current = false; };
  }, [form.event_id]);

  const applyPlan = () => {
    if (!plan) return;
    const c = plan.creative ?? {};
    set({
      daily_budget: plan.daily_budget ? String(plan.daily_budget) : form.daily_budget,
      start_date: plan.schedule?.start && plan.schedule.start >= today ? plan.schedule.start : form.start_date,
      end_date: plan.schedule?.end || form.end_date,
      primary_text: c.primary_text || form.primary_text,
      headline: c.headline || form.headline,
      description: c.description || form.description,
      goal: /purchase|רכיש|מכיר/i.test(`${plan.objective} ${plan.tracking?.optimization ?? ''}`) && setup?.pixels.length ? 'sales' : form.goal,
    });
    setPlanApplied(true);
  };
  useEffect(() => { if (seed.fromPlan && plan && !planApplied) applyPlan(); }, [plan]);

  const upload = (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    if (!/^image\/(jpeg|png)$/.test(file.type)) { setUploadError('רק תמונות JPG או PNG'); return; }
    if (file.size > 8 * 1024 * 1024) { setUploadError('התמונה גדולה מ-8MB — כדאי להקטין אותה'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setUploading(true);
      try {
        const d = await post('/band/meta/images', { data: reader.result });
        set({ image: { id: d.image.id, url: d.image.url } });
      } catch (err: any) { setUploadError(err.message); }
      finally { setUploading(false); }
    };
    reader.readAsDataURL(file);
  };

  // What still stands between each step and the next, said on the button rather than discovered.
  const missing: string[][] = [
    [!form.name.trim() && 'שם לקמפיין', form.goal === 'sales' && !form.pixel_id && 'פיקסל למכירות'].filter(Boolean) as string[],
    [
      !(Number(form.daily_budget) > 0) && 'תקציב יומי',
      !form.start_date && 'תאריך התחלה',
      !form.end_date && 'תאריך סיום',
      form.end_date && form.start_date && form.end_date < form.start_date && 'תאריך סיום אחרי ההתחלה',
      form.temperature === 'hot' && !form.audience_ids.length && 'קהל שמור לקמפיין החם',
    ].filter(Boolean) as string[],
    [
      !form.page_id && 'דף פייסבוק',
      !form.image && 'תמונה',
      !form.primary_text.trim() && 'טקסט המודעה',
      !form.headline.trim() && 'כותרת',
      !/^https?:\/\//i.test(form.link) && 'קישור לכרטיסים',
    ].filter(Boolean) as string[],
    [],
  ];

  const spec = () => ({
    event_id: form.event_id || null,
    name: form.name.trim(),
    goal: form.goal,
    daily_budget: Number(form.daily_budget),
    start_date: form.start_date,
    end_date: form.end_date,
    age_min: Number(form.age_min),
    age_max: Number(form.age_max),
    temperature: form.temperature,
    audience_ids: form.temperature === 'hot' ? form.audience_ids : [],
    excluded_audience_ids: form.excluded_audience_ids.filter((id) => form.temperature !== 'hot' || !form.audience_ids.includes(id)),
    page_id: form.page_id,
    pixel_id: form.goal === 'sales' ? form.pixel_id : null,
    link: form.link.trim(),
    primary_text: form.primary_text.trim(),
    headline: form.headline.trim(),
    description: form.description.trim() || null,
    cta: form.cta,
    image_id: form.image?.id,
  });

  const readPreview = async () => {
    setReading(true);
    setPreviewError('');
    try {
      const d = await post('/band/meta-actions/preview', {
        action: { type: 'create_campaign', spec: spec(), reason: 'נבנה במרכז הקמפיינים' },
        source: 'studio', event_id: form.event_id || undefined,
      });
      setPreview(d.preview);
    } catch (err: any) { setPreviewError(err.message); }
    finally { setReading(false); }
  };

  const go = (next: number) => {
    setStep(next);
    sheetRef.current?.scrollTo({ top: 0 });
    if (next === 3) readPreview();
  };

  const execute = async () => {
    if (!preview) return;
    setExecuting(true);
    setPreviewError('');
    try {
      const d = await post(`/band/meta-actions/${preview.id}/execute`);
      setCreated(d.action);
    } catch (err: any) { setPreviewError(err.message); }
    finally { setExecuting(false); }
  };

  const close = () => {
    if (preview && !created && preview.status === 'previewed') post(`/band/meta-actions/${preview.id}/cancel`).catch(() => {});
    if (created) onCreated(created.result?.campaign_id);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !activation.modal) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const page = setup?.pages.find((p) => p.id === form.page_id);
  // Lookalikes are new people, which is prospecting: they are not offered as a hot audience.
  const hotAudiences = (setup?.audiences ?? []).filter((a: any) => a.subtype !== 'LOOKALIKE');
  const selectedHot = hotAudiences.filter((a: any) => form.audience_ids.includes(a.id));
  const hotSize = selectedHot.every((a: any) => a.size_upper != null) ? selectedHot.reduce((n: number, a: any) => n + a.size_upper, 0) : null;
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const runDays = days(form.start_date, form.end_date);
  const total = Number(form.daily_budget) > 0 && runDays > 0 ? Number(form.daily_budget) * runDays : null;
  const label = (text: string, hint?: string) => (
    <span className="block mb-1.5">
      <span className="text-[13px] font-semibold text-ink-2">{text}</span>
      {hint && <span className="block text-xs text-faint mt-0.5">{hint}</span>}
    </span>
  );

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex flex-col bg-canvas">
      {/* ---- the sheet's bar: what this is, where in it you are, and the way out */}
      <header className="shrink-0 bg-[var(--ws-ink)] text-white">
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-3 px-4 md:px-6 h-14">
          <h2 id={titleId} className="ser text-lg truncate">קמפיין חדש</h2>
          <button type="button" onClick={close} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-10 text-sm text-white/80 hover:text-white hover:bg-white/10">
            <X className="w-4 h-4" aria-hidden /> סגירה
          </button>
        </div>
        <ol className="mx-auto max-w-6xl flex gap-1 px-4 md:px-6 pb-3" aria-label="שלבים">
          {STEPS.map((title, i) => (
            <li key={title} className="flex-1 min-w-0">
              <button type="button" disabled={i > step || !!created} onClick={() => go(i)}
                aria-current={i === step ? 'step' : undefined}
                className="w-full text-start disabled:cursor-default">
                <span className={clsx('block h-1 rounded-full transition-colors', i <= step ? 'bg-[#b9a5f2]' : 'bg-white/15')} />
                <span className={clsx('mt-1.5 hidden sm:block text-xs truncate', i === step ? 'text-white font-semibold' : 'text-white/60')}>
                  {i < step && <Check className="inline w-3 h-3 me-1 -mt-0.5" aria-hidden />}{title}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className="sm:hidden mx-auto max-w-6xl px-4 pb-2 text-xs text-white/70">שלב {step + 1} מתוך 4 · {STEPS[step]}</p>
      </header>

      <div ref={sheetRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 md:px-6 py-6 md:py-8">
          {setupError && (
            <p className="mb-4 rounded-xl bg-neg-soft text-neg-ink px-4 py-3 text-sm">לא הצלחנו לקרוא את חשבון המודעות: {setupError}</p>
          )}
          {setup && !setup.configured && (
            <p className="mb-4 rounded-xl bg-warn-soft text-warn-ink px-4 py-3 text-sm">Meta לא מחוברת — צריך META_ACCESS_TOKEN ו-META_AD_ACCOUNT_ID כדי ליצור קמפיין.</p>
          )}

          {/* ---- 1: which show, and what the campaign is for */}
          {step === 0 && (
            <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
              <div className="space-y-6">
                <label className="block">
                  {label('הופעה', 'הקמפיין ישויך אליה, וההוצאה שלו תיכנס לספרים של ההופעה.')}
                  <select className={fieldClass} value={form.event_id} onChange={(e) => set({ event_id: e.target.value })}>
                    <option value="">בלי הופעה (פרסום כללי)</option>
                    {upcoming.map((e) => <option key={e.id} value={e.id}>{e.venue} · {ddmm(e.date)}</option>)}
                  </select>
                </label>
                {plan && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft px-4 py-3">
                    <p className="flex items-start gap-2 text-sm text-accent-ink">
                      <Sparkles className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                      {planApplied ? 'מולא מהתוכנית של הסוכן: תקציב, תאריכים ונוסח. אפשר לשנות כל שדה.' : 'להופעה הזו יש תוכנית מהסוכן.'}
                    </p>
                    {!planApplied && <Button variant="ghost" onClick={applyPlan}>מילוי מהתוכנית</Button>}
                  </div>
                )}
                <label className="block">
                  {label('שם הקמפיין', 'כך הוא יופיע ב-Ads Manager ובספרים.')}
                  <input className={fieldClass} value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} />
                </label>
                <fieldset>
                  <legend className="text-[13px] font-semibold text-ink-2 mb-2">מטרה</legend>
                  <div className="grid gap-2">
                    {GOALS.map((g) => {
                      const disabled = g.value === 'sales' && setup != null && setup.pixels.length === 0;
                      return (
                        <label key={g.value} className={clsx('flex gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors',
                          form.goal === g.value ? 'border-accent bg-accent-soft/60' : 'border-line bg-surface hover:bg-soft',
                          disabled && 'opacity-60 cursor-not-allowed')}>
                          <input type="radio" name="goal" className="accent-accent mt-1 w-4 h-4 shrink-0" checked={form.goal === g.value}
                            disabled={disabled} onChange={() => set({ goal: g.value })} />
                          <span>
                            <span className="block text-[15px] font-semibold text-ink">{g.title}</span>
                            <span className="block text-sm text-body leading-relaxed">{disabled ? 'אין פיקסל בחשבון המודעות — אפשר ליצור אחד במסך «פיקסל ויומן».' : g.sub}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {form.goal === 'sales' && setup && setup.pixels.length > 0 && (
                  <label className="block">
                    {label('פיקסל', 'הפיקסל שמותקן בדף הכרטיסים של המועדון.')}
                    <select className={fieldClass} value={form.pixel_id} onChange={(e) => set({ pixel_id: e.target.value })}>
                      {setup.pixels.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <aside className="text-sm text-body leading-relaxed space-y-2 lg:pt-7">
                <p className="font-semibold text-ink">מה ייווצר</p>
                <p>קמפיין, קבוצת מודעות אחת ומודעה אחת. הכל נוצר כשהקמפיין מושהה, אז שום כסף לא יוצא עד שמפעילים אותו.</p>
                <p>לפני היצירה תראו בדיוק מה יישלח ל-Meta, ורק אישור שלכם שולח.</p>
              </aside>
            </div>
          )}

          {/* ---- 2: who sees it, for how much, for how long */}
          {step === 1 && (
            <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
              <div className="space-y-6">
                <fieldset>
                  <legend className="text-[13px] font-semibold text-ink-2 mb-2">למי המודעה מיועדת</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TEMPERATURES.map((t) => {
                      const disabled = t.value === 'hot' && setup != null && hotAudiences.length === 0;
                      return (
                        <label key={t.value} className={clsx('flex gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors',
                          form.temperature === t.value ? 'border-accent bg-accent-soft/60' : 'border-line bg-surface hover:bg-soft',
                          disabled && 'opacity-60 cursor-not-allowed')}>
                          <input type="radio" name="temperature" className="accent-accent mt-1 w-4 h-4 shrink-0" checked={form.temperature === t.value}
                            disabled={disabled} onChange={() => set({ temperature: t.value })} />
                          <span>
                            <span className="block text-[15px] font-semibold text-ink">{t.title}</span>
                            <span className="block text-sm text-body leading-relaxed">
                              {disabled
                                ? (setup?.audiences_error
                                  ? `לא הצלחנו לקרוא את הקהלים מ-Meta: ${setup.audiences_error}`
                                  : 'אין בחשבון קהלים שמורים. יוצרים אותם ב-Ads Manager ← קהלים (למשל מבקרי דף הכרטיסים ב-30 יום, או מי שצפה בוידאו), והם יופיעו כאן.')
                                : t.sub}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {form.temperature === 'hot' && (
                  <fieldset className="space-y-2">
                    <legend className="text-[13px] font-semibold text-ink-2">הקהלים החמים</legend>
                    <p className="text-xs text-faint">המודעה תוצג רק למי שנמצא באחד מהקהלים שתסמנו.</p>
                    <AudienceList audiences={hotAudiences} selected={form.audience_ids}
                      disabledIds={form.excluded_audience_ids} disabledNote="מוחרג למטה"
                      onToggle={(id) => set({ audience_ids: toggle(form.audience_ids, id) })} />
                    {selectedHot.length > 0 && hotSize != null && hotSize < MIN_HOT && (
                      <p className="flex items-start gap-1.5 text-sm text-warn-ink"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                        יחד עד {hotSize.toLocaleString('he-IL')} איש. מתחת ל-{MIN_HOT.toLocaleString('he-IL')} Meta מתקשה להפיץ, ואותם אנשים יראו את המודעה שוב ושוב. כדאי תקציב יומי נמוך, או להוסיף קהל.
                      </p>
                    )}
                    {plan?.tracking?.retargeting && (
                      <p className="rounded-xl bg-soft px-4 py-3 text-sm text-body"><span className="font-semibold text-ink">לפי התוכנית: </span>{plan.tracking.retargeting}</p>
                    )}
                  </fieldset>
                )}

                {(setup?.audiences?.length ?? 0) > 0 && (
                  <details className="group rounded-xl border border-line bg-surface" open={form.excluded_audience_ids.length > 0 || undefined}>
                    <summary className="flex items-center justify-between gap-2 px-4 min-h-12 cursor-pointer text-sm">
                      <span className="font-semibold text-ink-2">לא להציג ל…</span>
                      <span className="text-xs text-muted">{form.excluded_audience_ids.length ? `${form.excluded_audience_ids.length} קהלים מוחרגים` : 'בלי החרגות'}</span>
                    </summary>
                    <div className="px-3 pb-3 space-y-2">
                      <p className="px-1 text-xs text-faint">בדרך כלל: מי שכבר קנה כרטיס, כדי לא לשלם על להראות לו את המודעה.</p>
                      <AudienceList audiences={setup?.audiences ?? []} selected={form.excluded_audience_ids}
                        disabledIds={form.temperature === 'hot' ? form.audience_ids : []} disabledNote="נבחר כקהל חם"
                        onToggle={(id) => set({ excluded_audience_ids: toggle(form.excluded_audience_ids, id) })} />
                    </div>
                  </details>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    {label('תאריך התחלה')}
                    <input type="date" className={fieldClass} value={form.start_date} min={today} onChange={(e) => set({ start_date: e.target.value })} />
                  </label>
                  <label className="block">
                    {label('תאריך סיום', show ? `ההופעה ב-${ddmm(show.date)}. הקמפיין רץ עד סוף היום הזה.` : 'הקמפיין רץ עד סוף היום הזה.')}
                    <input type="date" className={fieldClass} value={form.end_date} min={form.start_date || today} onChange={(e) => set({ end_date: e.target.value })} />
                  </label>
                </div>
                <label className="block max-w-xs">
                  {label('תקציב יומי (₪)')}
                  <input inputMode="decimal" className={clsx(fieldClass, 'num text-base')} value={form.daily_budget}
                    onChange={(e) => set({ daily_budget: e.target.value.replace(/[^\d.]/g, '') })} placeholder="80" />
                </label>
                <fieldset>
                  <legend className="text-[13px] font-semibold text-ink-2 mb-1.5">גילאים</legend>
                  <div className="flex items-center gap-2">
                    <input inputMode="numeric" aria-label="מגיל" className={clsx(fieldClass, 'num !w-20')} value={form.age_min}
                      onChange={(e) => set({ age_min: e.target.value.replace(/\D/g, '') })} />
                    <span className="text-muted">עד</span>
                    <input inputMode="numeric" aria-label="עד גיל" className={clsx(fieldClass, 'num !w-20')} value={form.age_max}
                      onChange={(e) => set({ age_max: e.target.value.replace(/\D/g, '') })} />
                  </div>
                  <p className="text-xs text-faint mt-1.5">
                    {form.temperature === 'hot'
                      ? 'מיקום: כל ישראל. הגילאים חלים גם על הקהלים החמים. 65 פירושו 65 ומעלה.'
                      : 'מיקום: כל ישראל. 65 פירושו 65 ומעלה. תחומי עניין ורדיוס סביב המועדון מגדירים אחר כך ב-Ads Manager, אם צריך.'}
                  </p>
                </fieldset>
                {plan?.audience && (
                  <p className="rounded-xl bg-soft px-4 py-3 text-sm text-body"><span className="font-semibold text-ink">הקהל לפי התוכנית: </span>{plan.audience}</p>
                )}
              </div>
              <aside className="rounded-2xl bg-surface border border-line p-4 h-fit space-y-1">
                <p className="text-xs text-faint">עד סוף הקמפיין</p>
                <p className="num ser text-3xl text-ink">{total != null ? `₪${Math.round(total).toLocaleString('he-IL')}` : '—'}</p>
                <p className="text-sm text-body">{runDays > 0 ? `${runDays} ימים × ₪${form.daily_budget || 0}` : 'בחרו תאריכים ותקציב'}</p>
                {show && form.end_date > show.date && (
                  <p className="flex items-start gap-1.5 text-sm text-warn-ink pt-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />ממשיך אחרי ההופעה.</p>
                )}
              </aside>
            </div>
          )}

          {/* ---- 3: the ad itself, with what it will look like beside it */}
          {step === 2 && (
            <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
              <div className="space-y-5">
                <label className="block">
                  {label('דף פייסבוק', 'המודעה מתפרסמת בשם הדף הזה, גם באינסטגרם.')}
                  <select className={fieldClass} value={form.page_id} onChange={(e) => set({ page_id: e.target.value })}>
                    {!setup?.pages.length && <option value="">אין דפים זמינים לחשבון</option>}
                    {setup?.pages.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id}</option>)}
                  </select>
                </label>
                <div>
                  {label('תמונה', 'JPG או PNG, עד 8MB. ריבוע (1080×1080) עובד בכל המיקומים. התמונה נשלחת ל-Meta רק כשמאשרים.')}
                  <label className={clsx('flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 cursor-pointer transition-colors',
                    uploading ? 'border-accent bg-accent-soft/50' : 'border-line-strong bg-surface hover:bg-soft')}>
                    <ImagePlus className="w-5 h-5 text-accent shrink-0" aria-hidden />
                    <span className="text-sm text-ink-2">{uploading ? 'מעלה…' : form.image ? 'החלפת התמונה' : 'בחירת תמונה'}</span>
                    <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
                  </label>
                  {uploadError && <p className="text-sm text-neg mt-1.5">{uploadError}</p>}
                </div>
                <label className="block">
                  {label('טקסט המודעה', 'מה שמופיע מעל התמונה. השורה הראשונה היא מה שרואים לפני «עוד».')}
                  <textarea className={clsx(fieldClass, 'min-h-28 leading-relaxed')} value={form.primary_text} maxLength={2000}
                    onChange={(e) => set({ primary_text: e.target.value })} />
                </label>
                {plan?.creative?.headline_options?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" aria-label="כותרות מהתוכנית">
                    {[plan.creative.headline, ...plan.creative.headline_options].filter(Boolean).map((h: string) => (
                      <button key={h} type="button" onClick={() => set({ headline: h })}
                        className={clsx('rounded-full px-3 min-h-9 text-sm border', form.headline === h ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-ink-2 hover:bg-soft')}>
                        {h}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    {label('כותרת')}
                    <input className={fieldClass} value={form.headline} maxLength={255} onChange={(e) => set({ headline: e.target.value })} />
                  </label>
                  <label className="block">
                    {label('תיאור (לא חובה)')}
                    <input className={fieldClass} value={form.description} maxLength={255} onChange={(e) => set({ description: e.target.value })} />
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
                  <label className="block">
                    {label('קישור לכרטיסים')}
                    <input dir="ltr" className={clsx(fieldClass, 'text-start')} value={form.link} placeholder="https://"
                      onChange={(e) => set({ link: e.target.value })} />
                  </label>
                  <label className="block">
                    {label('כפתור')}
                    <select className={fieldClass} value={form.cta} onChange={(e) => set({ cta: e.target.value })}>
                      {CTAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <AdMock page={page?.name ?? 'הדף'} text={form.primary_text} image={form.image?.url} headline={form.headline}
                description={form.description} link={form.link} cta={CTAS.find((c) => c.value === form.cta)?.label ?? ''} />
            </div>
          )}

          {/* ---- 4: the preview read from Meta, and the one button that sends */}
          {step === 3 && (
            <div className="max-w-2xl space-y-5">
              {created ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-2xl bg-pos-soft px-5 py-4">
                    <CheckCircle2 className="w-6 h-6 text-pos shrink-0" aria-hidden />
                    <div>
                      <p className="text-[15px] font-bold text-pos-ink">הקמפיין נוצר ב-Meta, מושהה</p>
                      <p className="text-sm text-body mt-0.5">המודעה עוברת עכשיו בדיקה של Meta. שום כסף לא יוצא עד שמפעילים את הקמפיין.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={activation.loading != null}
                      onClick={() => activation.open({ type: 'activate', level: 'campaign', id: created.result.campaign_id, name: form.name, reason: 'קמפיין חדש מוכן לעלות' }, 'activate', { event_id: form.event_id || undefined })}>
                      {activation.loading ? 'קורא מ-Meta…' : 'הפעלת הקמפיין…'}
                    </Button>
                    <Button variant="ghost" onClick={close}>לקמפיין, בלי להפעיל</Button>
                  </div>
                  {activation.problem && <p className="text-sm text-neg">{activation.problem.text}</p>}
                </div>
              ) : reading ? (
                <div className="space-y-3" aria-label="קורא את החשבון מ-Meta">
                  {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-surface border border-line animate-pulse motion-reduce:animate-none" />)}
                </div>
              ) : preview ? (
                <>
                  <div>
                    <p className="text-[15px] font-bold text-ink">{preview.title}</p>
                    <p className="text-sm text-body">נקרא עכשיו מחשבון המודעות. זה מה שיישלח, ולא יותר.</p>
                  </div>
                  <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                    {preview.changes.map((c: any, i: number) => (
                      <li key={i} className="px-4 py-3"><ChangeLine label={c.label} from={c.from} to={c.to} size="sm" /></li>
                    ))}
                  </ul>
                  {preview.warnings?.length > 0 && (
                    <ul className="rounded-xl bg-warn-soft px-4 py-3 space-y-1.5">
                      {preview.warnings.map((w: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-warn-ink"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />{w}</li>
                      ))}
                    </ul>
                  )}
                  {preview.blockers?.length > 0 && (
                    <ul className="rounded-xl bg-neg-soft px-4 py-3 space-y-1.5">
                      {preview.blockers.map((b: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-neg-ink"><XCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />{b}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
              {previewError && <p className="rounded-xl bg-neg-soft text-neg-ink px-4 py-3 text-sm">{previewError}</p>}
            </div>
          )}
        </div>
      </div>

      {/* ---- back / next, and what is missing before next */}
      {!created && (
        <footer className="shrink-0 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl flex items-center justify-between gap-3 px-4 md:px-6 py-3">
            <Button variant="ghost" onClick={() => (step === 0 ? close() : go(step - 1))}>{step === 0 ? 'ביטול' : 'הקודם'}</Button>
            <div className="flex items-center gap-3 min-w-0">
              {missing[step].length > 0 && <span className="hidden sm:block text-xs text-muted truncate">חסר: {missing[step].join(', ')}</span>}
              {step < 3 ? (
                <Button disabled={missing[step].length > 0 || (step === 2 && uploading)} title={missing[step].length ? `חסר: ${missing[step].join(', ')}` : undefined}
                  onClick={() => go(step + 1)}>
                  {step === 2 ? 'לבדיקה מול Meta' : 'הבא'}
                </Button>
              ) : preview?.can_execute ? (
                <Button onClick={execute} disabled={executing}>{executing ? 'יוצר ב-Meta…' : 'אישור ויצירה ב-Meta'}</Button>
              ) : (
                <Button variant="ghost" onClick={readPreview} disabled={reading}>קריאה מחדש</Button>
              )}
            </div>
          </div>
        </footer>
      )}
      {activation.modal}
    </div>
  );
}

/** Saved audiences as a checklist: name, kind, size, and whether Meta can use it yet. */
function AudienceList({ audiences, selected, disabledIds, disabledNote, onToggle }: {
  audiences: any[];
  selected: string[];
  disabledIds: string[];
  disabledNote: string;
  onToggle: (id: string) => void;
}) {
  if (!audiences.length) return <p className="text-sm text-body">אין קהלים מתאימים בחשבון.</p>;
  return (
    <ul className="rounded-xl border border-line bg-surface divide-y divide-line max-h-72 overflow-y-auto">
      {audiences.map((a) => {
        const disabled = disabledIds.includes(a.id);
        return (
          <li key={a.id}>
            <label className={clsx('flex items-center gap-3 px-3.5 min-h-12 py-2', disabled ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer hover:bg-soft')}>
              <input type="checkbox" className="accent-accent w-[18px] h-[18px] shrink-0" checked={selected.includes(a.id)}
                disabled={disabled} onChange={() => onToggle(a.id)} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink truncate">{a.name ?? a.id}</span>
                <span className="block text-xs text-muted">
                  {[SUBTYPES[a.subtype] ?? a.subtype, audienceSize(a), disabled ? disabledNote : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {!a.ready && <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn-ink">לא מוכן</span>}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** The ad as it will sit in a feed — built from what was typed, so a typo is seen before it is paid for. */
function AdMock({ page, text, image, headline, description, link, cta }: {
  page: string; text: string; image?: string; headline: string; description: string; link: string; cta: string;
}) {
  let domain = '';
  try { domain = link ? new URL(link).hostname.replace(/^www\./, '') : ''; } catch { domain = ''; }
  return (
    <figure className="lg:sticky lg:top-0 h-fit">
      <figcaption className="text-xs text-faint mb-2">כך תיראה המודעה בפיד</figcaption>
      <div className="rounded-2xl bg-surface shadow-[0_8px_28px_rgba(36,29,61,.12)] overflow-hidden">
        <div className="flex items-center gap-2.5 px-3.5 pt-3">
          <span className="w-9 h-9 rounded-full bg-[var(--ws-ink)] text-white grid place-items-center text-sm font-bold" aria-hidden>{page.slice(0, 1)}</span>
          <span>
            <span className="block text-sm font-semibold text-ink leading-tight">{page}</span>
            <span className="block text-xs text-faint">ממומן</span>
          </span>
        </div>
        <p className="px-3.5 py-2.5 text-sm text-ink-2 leading-relaxed whitespace-pre-line line-clamp-4">{text || 'טקסט המודעה יופיע כאן.'}</p>
        <div className="aspect-square bg-soft grid place-items-center">
          {image ? <img src={image} alt="תמונת המודעה" className="w-full h-full object-cover" /> : <ImagePlus className="w-8 h-8 text-ghost" aria-hidden />}
        </div>
        <div className="flex items-center justify-between gap-3 bg-soft px-3.5 py-2.5">
          <span className="min-w-0">
            {domain && <span dir="ltr" className="block text-[11px] text-faint uppercase truncate">{domain}</span>}
            <span className="block text-sm font-bold text-ink truncate">{headline || 'כותרת'}</span>
            {description && <span className="block text-xs text-muted truncate">{description}</span>}
          </span>
          <span className="shrink-0 rounded-md bg-line px-3 py-1.5 text-xs font-semibold text-ink-2">{cta}</span>
        </div>
      </div>
    </figure>
  );
}
