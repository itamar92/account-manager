import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, EyeOff, MessageCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { get, post, put } from '../../api';
import { Button, Card, Input, Switch, Tag, Textarea } from '../../ui';
import { fullDate, type Place } from '../boards/boardShared';

interface Logistics { call_time: string | null; soundcheck_time: string | null; stage_time: string | null; parking: string | null }
interface Override {
  public_title: string | null; ticket_url: string | null; hidden: boolean;
  call_time: string | null; soundcheck_time: string | null; parking: string | null; notes: string | null;
  region: string | null;
  act: string | null;
}
interface Item {
  key: string; source: 'band' | 'work'; source_label: string; date: string; time: string | null;
  name: string; auto_title: string; title: string; place: Place | null; ticket_url: string | null;
  auto_region: string | null; region: string | null;
  auto_act: string | null; act: string | null;
  is_private: boolean; is_option: boolean; hidden: boolean; on_public: boolean; off_reason: string | null;
  override: Override; parsed: Logistics | null;
}
interface Reminder { keywords: string; text: string }
interface Settings {
  public_title: string; crew_title: string; include_band: boolean;
  excluded_clients: string[]; reminders: Reminder[];
  acts: Array<{ name: string; keywords: string }>;
}
interface Admin {
  tokens: { public: string; crew: string };
  settings: Settings;
  band_name: string;
  regions: string[];
  clients: Array<{ id: string; name: string; upcoming: number }>;
  items: Item[];
}

const linkFor = (kind: 'public' | 'crew', token: string) =>
  `${window.location.origin}/${kind === 'public' ? 'board' : 'crew'}/${token}`;

/**
 * The owner's screen for the two show boards: the friends' link and the band's link, what goes
 * on them, and per show the corrections the calendar cannot make — a nicer name, a ticket link,
 * hiding it, or the night's logistics typed by hand.
 */
export function ShowBoardTab({ onError }: { onError: (message: string) => void }) {
  const [data, setData] = useState<Admin | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedNote, setSavedNote] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = () => get<Admin>('/show-board').then((d) => { setData(d); setSettings(d.settings); }).catch((e) => onError(e.message));
  useEffect(() => { load(); }, []);

  const setLink = async (kind: 'public' | 'crew', enabled: boolean) => {
    if (!enabled && !confirm('לכבות את הלוח? הקישור הנוכחי יפסיק לעבוד.')) return;
    try {
      await post(`/show-board/${kind}/link`, { enabled });
      load();
    } catch (e: any) { onError(e.message); }
  };

  const rotate = async (kind: 'public' | 'crew') => {
    if (!confirm('ליצור קישור חדש? הקישור הישן יפסיק לעבוד אצל כל מי שקיבל אותו.')) return;
    await setLink(kind, true);
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      const d = await put('/show-board/settings', settings);
      setSettings(d.settings);
      setSavedNote('נשמר');
      setTimeout(() => setSavedNote(''), 2000);
      load();
    } catch (e: any) { onError(e.message); }
  };

  const saveItem = async (key: string, patch: Partial<Override>) => {
    try {
      await put(`/show-board/items/${encodeURIComponent(key)}`, patch);
      load();
    } catch (e: any) { onError(e.message); }
  };

  if (!data || !settings) return <div className="text-faint py-10 text-center">טוען…</div>;

  const clientShown = (id: string) => !settings.excluded_clients.includes(id);
  const toggleClient = (id: string, on: boolean) => setSettings({
    ...settings,
    excluded_clients: on ? settings.excluded_clients.filter((c) => c !== id) : [...settings.excluded_clients, id],
  });
  const setReminder = (i: number, patch: Partial<Reminder>) =>
    setSettings({ ...settings, reminders: settings.reminders.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="ser text-2xl md:text-3xl">לוחות הופעות</h1>
        <p className="mt-1.5 text-sm text-body">
          שני קישורים שנפתחים בלי התחברות, מתעדכנים לבד מהיומן: אחד לחברים ואחד ללהקה.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <LinkCard
          kind="public" title="לוח ציבורי — לחברים"
          description="כל ההופעות הקרובות עם שם מסודר, מקום וקישור לכרטיסים. אירועים פרטיים לא מוצגים."
          token={data.tokens.public} onToggle={setLink} onRotate={rotate}
        />
        <LinkCard
          kind="crew" title="לוח פנימי — ללהקה"
          description={`הופעות ${data.band_name} (כולל פרטיות): מי מנגן, חברת הגברה, הגעה, בלאנס, חניה ותזכורות.`}
          token={data.tokens.crew} onToggle={setLink} onRotate={rotate}
        />
      </div>

      <Card className="space-y-5">
        <div className="grid md:grid-cols-2 gap-3">
          <Input label="כותרת הלוח הציבורי" placeholder="ההופעות הקרובות" value={settings.public_title}
            onChange={(e) => setSettings({ ...settings, public_title: e.target.value })} />
          <Input label="כותרת הלוח הפנימי" placeholder={`${data.band_name} — לוח הופעות לצוות`} value={settings.crew_title}
            onChange={(e) => setSettings({ ...settings, crew_title: e.target.value })} />
        </div>

        <div>
          <div className="text-[13px] text-muted mb-2">מה נכנס ללוח הציבורי</div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Switch label={`הופעות ${data.band_name}`} checked={settings.include_band}
              onChange={(v) => setSettings({ ...settings, include_band: v })} />
            {data.clients.map((c) => (
              <Switch key={c.id} label={`${c.name} (${c.upcoming})`} checked={clientShown(c.id)}
                onChange={(v) => toggleClient(c.id, v)} />
            ))}
          </div>
          <p className="text-[12px] text-faint mt-1.5">
            העבודות הקרובות שלך לפי לקוח — מהיומן וגם אלה שהוזנו ידנית. כבו לקוח שהעבודות שלו אינן הופעות.
          </p>
        </div>

        <div>
          <div className="text-[13px] text-muted mb-1">הרכבים — התגיות לסינון בלוח הציבורי</div>
          <p className="text-[12px] text-faint mb-2">
            נוצרות לבד ממילות המפתח של כללי היומן. כאן אפשר לתת שם יפה ולהוסיף מילים שמזהות אותו בכותרת האירוע.
          </p>
          <div className="space-y-2">
            {settings.acts.map((a, i) => (
              <div key={i} className="flex flex-wrap md:flex-nowrap items-center gap-2">
                <input className="w-48 bg-soft border border-line rounded-lg px-3 py-2 text-sm" placeholder="שם ההרכב: Disco Train"
                  value={a.name} onChange={(e) => setSettings({ ...settings, acts: settings.acts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <input className="flex-1 min-w-40 bg-soft border border-line rounded-lg px-3 py-2 text-sm" placeholder="מילים בכותרת: דיסקו טריין, דיסקו"
                  value={a.keywords} onChange={(e) => setSettings({ ...settings, acts: settings.acts.map((x, j) => (j === i ? { ...x, keywords: e.target.value } : x)) })} />
                <button className="p-2 text-muted hover:text-neg" title="מחיקה"
                  onClick={() => setSettings({ ...settings, acts: settings.acts.filter((_, j) => j !== i) })}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button className="inline-flex items-center gap-1.5 text-sm text-accent font-semibold"
              onClick={() => setSettings({ ...settings, acts: [...settings.acts, { name: '', keywords: '' }] })}>
              <Plus size={15} /> הרכב
            </button>
          </div>
        </div>

        <div>
          <div className="text-[13px] text-muted mb-2">תזכורות לפי מקום (בלוח הפנימי)</div>
          <div className="space-y-2">
            {settings.reminders.map((r, i) => (
              <div key={i} className="flex flex-wrap md:flex-nowrap items-center gap-2">
                <input className="flex-1 min-w-40 bg-soft border border-line rounded-lg px-3 py-2 text-sm"
                  placeholder="מילים במקום, מופרדות בפסיק: זאפה, גריי" value={r.keywords}
                  onChange={(e) => setReminder(i, { keywords: e.target.value })} />
                <span className="text-muted text-sm">←</span>
                <input className="flex-1 min-w-40 bg-soft border border-line rounded-lg px-3 py-2 text-sm"
                  placeholder="להביא מיקרופון אלחוטי" value={r.text}
                  onChange={(e) => setReminder(i, { text: e.target.value })} />
                <button className="p-2 text-muted hover:text-neg" title="מחיקה"
                  onClick={() => setSettings({ ...settings, reminders: settings.reminders.filter((_, j) => j !== i) })}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button className="inline-flex items-center gap-1.5 text-sm text-accent font-semibold"
              onClick={() => setSettings({ ...settings, reminders: [...settings.reminders, { keywords: '', text: '' }] })}>
              <Plus size={15} /> תזכורת
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={saveSettings}>שמירה</Button>
          {savedNote && <span className="text-sm text-pos">{savedNote}</span>}
        </div>
      </Card>

      <Card>
        <h2 className="ser text-lg mb-1">ההופעות הקרובות</h2>
        <p className="text-[13px] text-muted mb-3">
          הגעה, בלאנס וחניה נקראים מתיאור האירוע ביומן (למשל «הגעה 17:30», «בלאנס 18:00», «חניה: …»). אפשר לתקן כאן.
        </p>
        {!data.items.length && <div className="text-center text-faint py-8">אין הופעות קרובות ביומן.</div>}
        <ul className="divide-y divide-line">
          {data.items.map((item) => (
            <ItemRow key={item.key} item={item} regions={data.regions}
              acts={[...new Set(data.items.map((i) => i.act).filter((a): a is string => !!a))]} open={open === item.key}
              onToggle={() => setOpen(open === item.key ? null : item.key)} onSave={(p) => saveItem(item.key, p)} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function LinkCard({ kind, title, description, token, onToggle, onRotate }: {
  kind: 'public' | 'crew'; title: string; description: string; token: string;
  onToggle: (kind: 'public' | 'crew', enabled: boolean) => void;
  onRotate: (kind: 'public' | 'crew') => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = token ? linkFor(kind, token) : '';
  const copy = async () => {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-ink">{title}</h2>
          <p className="text-[13px] text-muted mt-0.5">{description}</p>
        </div>
        <Switch label={token ? 'פעיל' : 'כבוי'} checked={!!token} onChange={(v) => onToggle(kind, v)} />
      </div>
      {token && (
        <>
          <div dir="ltr" className="text-xs bg-soft border border-line rounded-lg px-3 py-2 truncate text-ink-2">{url}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={copy}><span className="inline-flex items-center gap-1.5"><Copy size={14} /> {copied ? 'הועתק' : 'העתקה'}</span></Button>
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-surface text-ink-2 border border-line-strong hover:bg-soft inline-flex items-center gap-1.5">
              <ExternalLink size={14} /> פתיחה
            </a>
            <a href={`https://wa.me/?text=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-surface text-ink-2 border border-line-strong hover:bg-soft inline-flex items-center gap-1.5">
              <MessageCircle size={14} /> וואטסאפ
            </a>
            <Button variant="ghost" onClick={() => onRotate(kind)}>
              <span className="inline-flex items-center gap-1.5"><RefreshCw size={14} /> קישור חדש</span>
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function ItemRow({ item, regions, acts, open, onToggle, onSave }: {
  item: Item; regions: string[]; acts: string[]; open: boolean; onToggle: () => void; onSave: (patch: Partial<Override>) => void;
}) {
  const [form, setForm] = useState({
    public_title: item.override.public_title ?? '',
    ticket_url: item.ticket_url ?? '',
    act: item.override.act ?? '',
    call_time: item.override.call_time ?? '',
    soundcheck_time: item.override.soundcheck_time ?? '',
    parking: item.override.parking ?? '',
    notes: item.override.notes ?? '',
  });
  useEffect(() => {
    setForm({
      public_title: item.override.public_title ?? '',
      ticket_url: item.ticket_url ?? '',
      act: item.override.act ?? '',
      call_time: item.override.call_time ?? '',
      soundcheck_time: item.override.soundcheck_time ?? '',
      parking: item.override.parking ?? '',
      notes: item.override.notes ?? '',
    });
  }, [item]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const p = item.parsed;

  return (
    <li className="py-3">
      <button type="button" onClick={onToggle} className="w-full text-start flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] text-muted w-36 shrink-0">{fullDate(item.date)}{item.time && <span dir="ltr"> · {item.time}</span>}</span>
        <span className="font-semibold text-ink flex-1 min-w-40">{item.title}</span>
        <Tag tone={item.source === 'band' ? 'accent' : 'neutral'}>{item.source_label}</Tag>
        {item.on_public
          ? <Tag tone="pos">בלוח הציבורי</Tag>
          : <Tag tone={item.is_private || item.is_option ? 'warn' : 'neutral'}><EyeOff size={11} /> {item.off_reason}</Tag>}
        {item.act && <Tag tone="accent">{item.act}</Tag>}
        {item.region && <Tag>{item.region}</Tag>}
        {item.ticket_url && <Tag>כרטיסים ✓</Tag>}
      </button>

      {open && (
        <div className="mt-3 space-y-3 bg-soft/60 rounded-xl p-3">
          <div className="text-[13px] text-muted">
            ביומן: <span className="text-ink-2">{item.name}</span>
            {item.place && <> · {item.place.name}</>}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Input label="שם בלוח הציבורי" placeholder={item.auto_title} value={form.public_title} onChange={set('public_title')} />
            <Input label="קישור לכרטיסים" dir="ltr" placeholder="https://" value={form.ticket_url} onChange={set('ticket_url')} />
            <Input label="הרכב (תגית)" placeholder={item.auto_act ?? 'לא זוהה'} value={form.act} onChange={set('act')}
              list={`acts-${item.key}`} />
            <datalist id={`acts-${item.key}`}>{acts.map((a) => <option key={a} value={a} />)}</datalist>
            <label className="block">
              <span className="block text-[13px] text-muted mb-1.5">אזור (לסינון בלוח הציבורי)</span>
              <select className="w-full bg-soft border border-line rounded-lg px-3 py-2 text-sm"
                value={item.override.region ?? ''} onChange={(e) => onSave({ region: e.target.value || null })}>
                <option value="">{item.auto_region ? `אוטומטי — ${item.auto_region}` : 'אוטומטי — לא זוהה'}</option>
                {regions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
          {item.source === 'band' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Input label="הגעה" placeholder={p?.call_time ?? 'למשל 17:30'} value={form.call_time} onChange={set('call_time')} />
                <Input label="בלאנס" placeholder={p?.soundcheck_time ?? 'למשל 18:30'} value={form.soundcheck_time} onChange={set('soundcheck_time')} />
                <div className="col-span-2">
                  <Input label="חניה" placeholder={p?.parking ?? 'איפה חונים'} value={form.parking} onChange={set('parking')} />
                </div>
              </div>
              <Textarea label="הוראות מיוחדות ללהקה" rows={2} value={form.notes} onChange={set('notes')} />
            </>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => onSave(item.source === 'band' ? form : { public_title: form.public_title, ticket_url: form.ticket_url, act: form.act })}>שמירה</Button>
            {!item.is_private && !item.is_option && (
              <Switch label="הסתרה מהלוח הציבורי" checked={item.hidden} onChange={(v) => onSave({ hidden: v })} />
            )}
          </div>
        </div>
      )}
    </li>
  );
}
