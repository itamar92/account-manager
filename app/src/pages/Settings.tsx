import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Bot, Building2, CalendarCheck, Key, Percent, Plug, Settings2, Users } from 'lucide-react';
import { get, post, put, del } from '../api';
import { Button, Card, Input, Modal, Empty, PageHeader } from '../ui';
import { CalendarRules } from './CalendarRules';
import { AgentSettings } from './AgentSettings';
import { CreditPointsCalculator } from './CreditPointsCalculator';

/** The drawers of the filing cabinet, in the order they are needed when setting the app up. */
const SECTIONS = [
  { key: 'general', label: 'כללי', icon: Settings2 },
  { key: 'business', label: 'פרטי העסק', icon: Building2 },
  { key: 'connections', label: 'חיבורים', icon: Plug },
  { key: 'agent', label: 'סוכן AI', icon: Bot },
  { key: 'calendar', label: 'כללי יומן', icon: CalendarCheck },
  { key: 'vat', label: 'מע"מ ומס', icon: Percent },
  { key: 'users', label: 'משתמשים', icon: Users },
  { key: 'api', label: 'מפתחות API', icon: Key },
] as const;

type Section = typeof SECTIONS[number]['key'];

const SECTION_TITLES: Record<Section, string> = {
  general: 'כללי', business: 'פרטי העסק', connections: 'חיבורים', agent: 'סוכן AI',
  calendar: 'כללי יומן', vat: 'מע"מ ומס', users: 'משתמשים והרשאות', api: 'מפתחות API',
};

const SECTION_SUBS: Record<Section, string> = {
  general: 'מע"מ וטווח הסנכרון מ-Morning',
  business: 'פרטי העוסק כפי שהם מופיעים על מסמכים',
  connections: 'מקורות הנתונים והסוכן — הרצה ידנית ובדיקת חיבור',
  agent: 'חיבור ה-SSH ליועץ הקמפיינים — שרת, משתמש ומפתח',
  calendar: 'כללים שקובעים אילו אירועים נמשכים, ולאן',
  vat: 'תדירות דיווח ומחשבון נקודות הזיכוי',
  users: 'מי נכנס לאפליקציה ומה הוא רואה',
  api: 'גישה לאפליקציות חיצוניות ולסוכני AI',
};

/**
 * A plain rounded number for the sync summary. Not `nis`: the Meta line reports the ad account's
 * own currency, which is not always shekels, so the symbol comes from the data beside it.
 */
const amount = (value: unknown) => Math.round(Number(value) || 0).toLocaleString('he-IL');

export function Settings() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [sec, setSec] = useState<Section>('general');
  const [newKey, setNewKey] = useState<any>(null);
  const [keyName, setKeyName] = useState('');
  const [userModal, setUserModal] = useState(false);
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'band' });
  // Set while editing an existing member; null means the modal is creating a new one.
  const [editUser, setEditUser] = useState<any | null>(null);
  const [vat, setVat] = useState('');
  const [syncDays, setSyncDays] = useState('90');
  const [generalSaved, setGeneralSaved] = useState('');
  const [vatFrequency, setVatFrequency] = useState('bimonthly');
  const [creditPoints, setCreditPoints] = useState('2.25');
  const [reportsSaved, setReportsSaved] = useState('');
  const [syncing, setSyncing] = useState('');
  const [syncResult, setSyncResult] = useState('');
  const [business, setBusiness] = useState<any>(null);
  const [businessSaved, setBusinessSaved] = useState('');
  const [metaRate, setMetaRate] = useState('1');
  const [metaSaved, setMetaSaved] = useState('');

  const load = () =>
    get('/settings')
      .then((d) => {
        setData(d);
        setVat(String(d.settings.vat_percent));
        setSyncDays(String(d.settings.morning_sync_days));
        setVatFrequency(d.settings.vat_report_frequency);
        setCreditPoints(String(d.settings.tax_credit_points));
        setMetaRate(String(d.settings.meta_currency_rate));
        setBusiness(d.business);
      })
      .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const runSync = async (which: 'morning' | 'calendar' | 'meta') => {
    setSyncing(which);
    setError('');
    setSyncResult('');
    try {
      const d = await post(`/integrations/${which}/sync`);
      const r = d.result;
      setSyncResult(
        which === 'morning'
          ? `Morning: ${r.fetched} מסמכים (${r.from} – ${r.to}) · ${r.created} חדשים · ${r.updated} עודכנו` +
            (r.expenses?.error
              ? `\n· הוצאות: ${r.expenses.error}`
              : `\n· הוצאות: ${r.expenses.fetched} · ${r.expenses.created} חדשות · ${r.expenses.updated} עודכנו` +
                ` · ${r.expenses.reported} מסומנות כדווחו`)
          : which === 'meta'
          ? `Meta: ${r.campaigns} קמפיינים (${r.from} – ${r.to}) · ${amount(r.spend)} ${r.currency}` +
            `\n· ${r.applied.written} הופעות עודכנו · ${r.applied.unchanged} ללא שינוי` +
            (r.applied.locked ? ` · ${r.applied.locked} עם סכום ידני (לא נדרסו)` : '') +
            (r.applied.settled
              ? ` · ${r.applied.settled} שולמו לנגנים (מוקפאות${r.applied.settled_stale ? `, מתוכן ${r.applied.settled_stale} עם הוצאה שגדלה מאז` : ''})`
              : '') +
            (r.applied.unmapped_campaigns
              ? `\n· ${r.applied.unmapped_campaigns} קמפיינים ללא שיוך להופעה — ${amount(r.applied.unmapped_spend)} ₪ ממתינים לשיוך ב-Moonlight → פרסום`
              : '') +
            (r.warning ? `\n⚠ ${r.warning}` : '')
          : `יומן: ${r.matched} תואמים · ${r.created} חדשים · ${r.updated} עודכנו · ${r.linked} שויכו` +
            (r.rules ?? []).map((x: any) => `\n· ${x.ruleName}: ${x.matched} תואמים${x.error ? ` — שגיאה: ${x.error}` : ''}`).join('')
      );
      load();
    } catch (err: any) { setError(err.message); }
    finally { setSyncing(''); }
  };

  /**
   * Opens the SSH session and asks the agent its version. Reported in the same box the syncs use,
   * because "did it work" is the same question whichever connection was tested.
   */
  const pingAgent = async () => {
    setSyncing('agent');
    setError('');
    setSyncResult('');
    try {
      const d = await post('/integrations/agent/ping');
      setSyncResult(`הסוכן ענה תוך ${Math.round(d.result.duration_ms / 1000)} שניות · ${d.result.version}`);
      load();
    } catch (err: any) { setError(err.message); }
    finally { setSyncing(''); }
  };

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const d = await post('/settings/api-keys', { name: keyName });
      setNewKey(d);
      setKeyName('');
      load();
    } catch (err: any) { setError(err.message); }
  };

  const openNewUser = () => {
    setEditUser(null);
    setUserForm({ name: '', email: '', password: '', role: 'band' });
    setUserModal(true);
  };

  const openEditUser = (user: any) => {
    setEditUser(user);
    // Password starts empty and is only sent when filled in, so details can be corrected
    // without resetting anyone's access.
    setUserForm({ name: user.name, email: user.email, password: '', role: user.role });
    setUserModal(true);
  };

  const saveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editUser) {
        const { password, ...rest } = userForm;
        await put(`/settings/users/${editUser.id}`, password ? userForm : rest);
      } else {
        await post('/settings/users', userForm);
      }
      setUserModal(false);
      setEditUser(null);
      setUserForm({ name: '', email: '', password: '', role: 'band' });
      load();
    } catch (err: any) { setError(err.message); }
  };

  const saveGeneral = async () => {
    setError('');
    setGeneralSaved('');
    try {
      await post('/settings', { vat_percent: parseFloat(vat), morning_sync_days: parseInt(syncDays, 10) });
      setGeneralSaved('ההגדרות נשמרו');
      load();
    } catch (err: any) { setError(err.message); }
  };

  const saveReportSettings = async () => {
    setError('');
    setReportsSaved('');
    try {
      await post('/settings', { vat_report_frequency: vatFrequency, tax_credit_points: parseFloat(creditPoints) });
      setReportsSaved('הגדרות הדוחות נשמרו');
      load();
    } catch (err: any) { setError(err.message); }
  };

  /**
   * The rate every attributed campaign figure is multiplied by. Saving it rewrites the shows on
   * the server, so the קמפיין column and the ads analysis move together with it.
   */
  const saveMetaSettings = async () => {
    setError('');
    setMetaSaved('');
    try {
      await post('/settings', { meta_currency_rate: parseFloat(metaRate) });
      setMetaSaved('שער ההמרה נשמר — סכומי הקמפיינים חושבו מחדש');
      load();
    } catch (err: any) { setError(err.message); }
  };

  const saveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusinessSaved('');
    try {
      const d = await post('/settings/business', business);
      setBusiness(d.business);
      setBusinessSaved('פרטי העסק נשמרו');
    } catch (err: any) { setError(err.message); }
  };

  const setBusinessField = (key: string, value: string) =>
    setBusiness((b: any) => ({ ...b, [key]: value }));

  if (!data) return <Empty text="טוען…" />;

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start">
      {/* The rail. Settings is a filing cabinet, not a page: showing one drawer at a time is
          what keeps the section you came for from being eight screens down. */}
      <div className="w-full md:w-52 md:shrink-0 md:sticky md:top-[73px]">
        <h1 className="ser text-2xl mb-3 hidden md:block">הגדרות</h1>
        <div className="flex md:flex-col gap-1 overflow-x-auto pb-1">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSec(key)}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-sm whitespace-nowrap transition-colors',
                sec === key ? 'bg-accent-soft text-accent-ink font-semibold' : 'text-ink-2 hover:bg-soft'
              )}
            >
              <Icon size={17} className="shrink-0" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-4">
      <PageHeader title={SECTION_TITLES[sec]} sub={SECTION_SUBS[sec]} />
      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}

      {sec === 'general' && (
      <Card>
        <p className="text-xs text-faint mb-4">
          טווח הסנכרון קובע כמה אחורה כל משיכה מ-Morning מגיעה. סנכרון מרענן כל שורה שהוא מוצא במלואה,
          כך שהרחבת הטווח וסנכרון חוזר היא הדרך לתקן שורות ישנות שנמשכו בעבר.
        </p>
        {generalSaved && <div className="text-sm text-pos mb-3">{generalSaved}</div>}
        <div className="grid gap-3 md:grid-cols-3 items-end max-w-xl">
          <Input label='מע"מ (%)' type="number" step="0.1" value={vat} onChange={(e) => setVat(e.target.value)} />
          <Input label="טווח סנכרון מ-Morning (ימים)" type="number" min="1" max="1825" value={syncDays}
            onChange={(e) => setSyncDays(e.target.value)} />
          <Button variant="ghost" onClick={saveGeneral}>שמירה</Button>
        </div>
      </Card>
      )}

      {/* What the דוחות page needs to know that the books cannot tell it: how often מע"מ is
          filed, and how many נקודות זיכוי the income-tax estimate should credit. */}
      {sec === 'vat' && (
      <div className="space-y-4">
        <Card>
          <p className="text-xs text-faint mb-4">
            משפיע על חלוקת תקופות הדיווח בדוח המע"מ ועל הערכת המס השנתית.
          </p>
          {reportsSaved && <div className="text-sm text-pos mb-3">{reportsSaved}</div>}
          <div className="grid gap-3 md:grid-cols-3 items-end max-w-xl">
            <label className="block">
              <span className="block text-sm text-muted mb-1">תדירות דיווח מע"מ</span>
              <select value={vatFrequency} onChange={(e) => setVatFrequency(e.target.value)}
                className="w-full bg-soft border border-line rounded-xl px-3 py-2 text-sm">
                <option value="bimonthly">דו-חודשי</option>
                <option value="monthly">חודשי</option>
              </select>
            </label>
            <Input label="נקודות זיכוי" type="number" step="0.25" min="0" value={creditPoints}
              onChange={(e) => setCreditPoints(e.target.value)} />
            <Button variant="ghost" onClick={saveReportSettings}>שמירה</Button>
          </div>
          <p className="text-xs text-faint mt-3">
            השדה הזה הוא הנפילה־אחורה. כשהמחשבון שלמטה מלא, הוא זה שקובע — ומחשב את המספר
            מחדש לכל שנת מס.
          </p>
        </Card>

        <Card>
          <h3 className="ser text-lg mb-3">מחשבון נקודות זיכוי</h3>
          {/* Reloading the settings after a save keeps the plain field above in step with the
              number the calculator just wrote into it. */}
          <CreditPointsCalculator year={new Date().getFullYear()} onSaved={load} />
        </Card>
      </div>
      )}

      {sec === 'business' && business && (
        <Card>
            <p className="text-xs text-faint mb-4">
            הכותרת שמוצגת בתצוגה המקדימה לפני הנפקה ב-Morning. המסמך עצמו מונפק לפי תבנית העיצוב
            שמוגדרת ב-Morning — הפרטים כאן לא נשלחים אליו, אלא רק משלימים את התצוגה.
          </p>
          {businessSaved && <div className="text-sm text-pos mb-3">{businessSaved}</div>}
          <form onSubmit={saveBusiness} className="grid gap-3 md:grid-cols-2">
            <Input label="שם העסק" value={business.name || ''} onChange={(e) => setBusinessField('name', e.target.value)} />
            <label className="block">
              <span className="block text-sm text-muted mb-1">סוג העסק</span>
              <select value={business.type || ''} onChange={(e) => setBusinessField('type', e.target.value)}
                className="w-full bg-soft border border-line rounded-xl px-3 py-2 text-sm">
                <option value="">ללא</option>
                {data.business_types.map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <Input label="ח.פ / ע.מ" dir="ltr" value={business.taxId || ''} onChange={(e) => setBusinessField('taxId', e.target.value)} />
            <Input label="טלפון" dir="ltr" value={business.phone || ''} onChange={(e) => setBusinessField('phone', e.target.value)} />
            <Input label="כתובת" value={business.address || ''} onChange={(e) => setBusinessField('address', e.target.value)} />
            <Input label="עיר" value={business.city || ''} onChange={(e) => setBusinessField('city', e.target.value)} />
            <Input label="אימייל" type="email" dir="ltr" value={business.email || ''} onChange={(e) => setBusinessField('email', e.target.value)} />
            <Input label="אתר" dir="ltr" value={business.website || ''} onChange={(e) => setBusinessField('website', e.target.value)} />
            <div className="md:col-span-2">
              <Input label="קישור ללוגו" dir="ltr" placeholder="https://…"
                value={business.logoUrl || ''} onChange={(e) => setBusinessField('logoUrl', e.target.value)} />
              <p className="text-xs text-faint mt-1">כתובת תמונה מלאה (https) — הלוגו עצמו נשאר מוגדר ב-Morning.</p>
            </div>
            <div className="md:col-span-2">
              <Button type="submit">שמירת פרטי העסק</Button>
            </div>
          </form>
        </Card>
      )}

      {sec === 'connections' && (
      <Card>
        <p className="text-xs text-faint mb-4">
          משיכת מסמכים מ-Morning ומשיכת הופעות מיומן Google. המפתחות של שלושת המקורות האלה נמצאים בקובץ{' '}
          <code dir="ltr" className="text-accent">.env</code>; פרטי החיבור של סוכן ה-AI נמצאים בלשונית «סוכן AI».
        </p>

        {syncResult && (
          <div className="bg-pos-soft border border-pos/25 rounded-xl p-3 mb-4 text-sm text-pos whitespace-pre-line">
            {syncResult}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <IntegrationRow
            title="Morning (חשבונית ירוקה)"
            configured={data.integrations.morning.configured}
            missingHint="חסרים GREEN_INVOICE_ID / GREEN_INVOICE_SECRET"
            lastSync={data.integrations.morning.last_sync}
            detail={`${data.integrations.morning.synced_invoices} מסמכים · ${data.integrations.morning.synced_expenses} הוצאות · טווח ${data.integrations.morning.sync_days} ימים`}
            busy={syncing === 'morning'}
            onSync={() => runSync('morning')}
          />
          <IntegrationRow
            title="Google Calendar — הופעות"
            configured={data.integrations.calendar.configured}
            missingHint="חסרים GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN"
            lastSync={data.integrations.calendar.last_sync}
            detail={`${data.integrations.calendar.rules_enabled}/${data.integrations.calendar.rules_total} כללים פעילים · ${data.integrations.calendar.synced_events} הופעות · ${data.integrations.calendar.synced_works} עבודות`}
            busy={syncing === 'calendar'}
            onSync={() => runSync('calendar')}
          />
          <IntegrationRow
            title="Meta Ads — קמפיינים"
            configured={data.integrations.meta.configured}
            missingHint="חסרים META_ACCESS_TOKEN / META_AD_ACCOUNT_ID"
            lastSync={data.integrations.meta.last_sync}
            detail={
              `${data.integrations.meta.campaigns} קמפיינים · ${data.integrations.meta.mapped_campaigns} משויכים` +
              ` · טווח ${data.integrations.meta.sync_days} ימים` +
              (data.integrations.meta.unmapped_campaigns
                ? ` · ${data.integrations.meta.unmapped_campaigns} ללא שיוך (${amount(data.integrations.meta.unmapped_spend)} ₪)`
                : '')
            }
            busy={syncing === 'meta'}
            onSync={() => runSync('meta')}
          />
          {/* Not a sync: nothing is pulled from the agent on a schedule. The button opens the SSH
              session and asks the agent its version, which is the cheapest way to find out which
              half of the connection is broken. */}
          <IntegrationRow
            title="סוכן AI — יועץ קמפיינים (SSH)"
            configured={data.integrations.agent.configured}
            missingHint="חסרים פרטי חיבור — הגדרות → סוכן AI"
            lastSync={data.integrations.agent.last_run}
            detail={
              `${data.integrations.agent.host} · ${data.integrations.agent.command}` +
              (data.integrations.agent.host_key_pinned ? ' · מפתח מארח מוצמד' : ' · ⚠ מפתח המארח לא מוצמד') +
              (data.integrations.agent.last_error ? `\n⚠ ${data.integrations.agent.last_error}` : '')
            }
            busy={syncing === 'agent'}
            onSync={pingAgent}
            actionLabel="בדיקת חיבור"
            busyLabel="בודק…"
            lastLabel="ריצה אחרונה"
            neverLabel="טרם רץ"
          />
        </div>

        {/* Only worth showing once there is an account to talk about, and only a problem when
            that account is billed in something other than shekels. */}
        {data.integrations.meta.configured && data.integrations.meta.currency !== 'ILS' && (
          <div className="mt-4 max-w-xl">
            <div className="bg-warn-soft border border-warn/25 rounded-xl p-3 text-sm text-warn mb-3">
              חשבון הפרסום מחויב ב-{data.integrations.meta.currency}. עמודת «קמפיין» בהוצאות ההופעות
              היא בשקלים, ולכן נדרש שער המרה — בלעדיו הסנכרון לא כותב סכומים בכלל.
            </div>
            <div className="grid gap-3 md:grid-cols-3 items-end">
              <Input
                label={`שקלים ל-1 ${data.integrations.meta.currency}`}
                type="number" step="0.01" min="0.01" dir="ltr"
                value={metaRate} onChange={(e) => setMetaRate(e.target.value)}
              />
              <Button variant="ghost" onClick={saveMetaSettings}>שמירה</Button>
            </div>
            {metaSaved && <div className="text-sm text-pos mt-2">{metaSaved}</div>}
          </div>
        )}

        <p className="text-xs text-faint mt-4">
          סנכרון Meta מושך את הקמפיינים וההוצאה היומית שלהם, ומזין את עמודת «קמפיין» של כל הופעה
          שקמפיין שויך אליה. השיוך עצמו נעשה ב-Moonlight → פרסום, ידנית: שם של קמפיין נכתב לבני
          אדם, וקמפיין שקידם כמה הופעות לא ניתן לפצל לפי שום כלל אוטומטי.
        </p>
      </Card>
      )}

      {sec === 'agent' && <AgentSettings onSaved={load} onError={setError} />}

      {sec === 'calendar' && <CalendarRules onChange={load} onError={setError} />}

      {sec === 'users' && (
      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-faint">חברי להקה (role: band) רואים רק את אזור Moonlight</p>
          <Button onClick={openNewUser}>+ משתמש</Button>
        </div>
        <div className="divide-y divide-line">
          {data.users.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{u.name}</span>
                <span className="text-faint mr-2" dir="ltr">{u.email}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={u.role === 'owner' ? 'text-accent' : 'text-muted'}>
                  {u.role === 'owner' ? 'בעלים' : 'חבר להקה'}
                </span>
                <button onClick={() => openEditUser(u)} className="text-xs text-accent hover:underline">עריכה</button>
                {u.role !== 'owner' && (
                  <button onClick={async () => { if (confirm('למחוק משתמש?')) { await del(`/settings/users/${u.id}`); load(); } }}
                    className="text-xs text-neg hover:underline">מחיקה</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
      )}

      {sec === 'api' && (
      <Card>
        <p className="text-xs text-faint mb-4">
          לחיבור אפליקציות חיצוניות (Morning / מערכת ניהול לקוחות). שליחת בקשות עם כותרת <code className="text-accent" dir="ltr">X-API-Key</code> אל <code className="text-accent" dir="ltr">/api/v1/*</code>
        </p>
        <form onSubmit={createKey} className="flex items-end gap-3 max-w-md mb-4">
          <Input label="שם המפתח" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="למשל: morning-app" required />
          <Button type="submit">יצירה</Button>
        </form>
        {newKey && (
          <div className="bg-pos-soft border border-pos/25 rounded-xl p-3 mb-4 text-sm">
            <div className="font-medium text-pos mb-1">המפתח נוצר — העתק אותו עכשיו, הוא לא יוצג שוב:</div>
            <code className="break-all select-all" dir="ltr">{newKey.key}</code>
          </div>
        )}
        <div className="divide-y divide-line">
          {data.api_keys.map((k: any) => (
            <div key={k.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <span className="font-medium">{k.name}</span>
                <span className="text-faint mr-2 font-mono" dir="ltr">{k.key_prefix}…</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-faint">
                {k.last_used_at ? `שימוש אחרון: ${k.last_used_at}` : 'לא היה בשימוש'}
                <button onClick={async () => { if (confirm('לבטל את המפתח?')) { await del(`/settings/api-keys/${k.id}`); load(); } }}
                  className="text-neg hover:underline">ביטול</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      )}

      <Modal
        title={editUser ? `עריכת ${editUser.name}` : 'משתמש חדש'}
        open={userModal}
        onClose={() => { setUserModal(false); setEditUser(null); }}
      >
        <form onSubmit={saveUser} className="space-y-3">
          <Input label="שם *" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} required />
          <Input label="אימייל *" type="email" dir="ltr" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
          <Input
            label={editUser ? 'סיסמה חדשה (רק אם רוצים לאפס)' : 'סיסמה *'}
            type="password" dir="ltr" autoComplete="new-password"
            placeholder={editUser ? 'ללא שינוי' : undefined}
            value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
            required={!editUser}
          />
          <label className="block">
            <span className="block text-sm text-muted mb-1">תפקיד</span>
            <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
              className="w-full bg-soft border border-line rounded-xl px-3 py-2 text-sm">
              <option value="band">חבר להקה (Moonlight בלבד)</option>
              <option value="owner">בעלים (גישה מלאה)</option>
            </select>
          </label>
          {editUser && userForm.password && (
            <p className="text-xs text-faint">
              שינוי סיסמה מנתק את המשתמש מכל המכשירים שבהם הוא מחובר.
            </p>
          )}
          <Button type="submit" className="w-full">{editUser ? 'שמירה' : 'יצירה'}</Button>
        </form>
      </Modal>
      </div>
    </div>
  );
}

/**
 * The labels are overridable because not every connection is a sync: the AI agent is *tested*,
 * not pulled from, and a button reading «סנכרון» on it would promise data movement that never
 * happens.
 */
function IntegrationRow({
  title, configured, missingHint, lastSync, detail, busy, onSync,
  actionLabel = 'סנכרון', busyLabel = 'מסנכרן…', lastLabel = 'סנכרון אחרון', neverLabel = 'טרם סונכרן',
}: {
  title: string;
  configured: boolean;
  missingHint: string;
  lastSync: string | null;
  detail: string;
  busy: boolean;
  onSync: () => void;
  actionLabel?: string;
  busyLabel?: string;
  lastLabel?: string;
  neverLabel?: string;
}) {
  return (
    <div className="bg-soft border border-line rounded-xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${configured ? 'bg-pos' : 'bg-line-strong'}`} />
            <span className="font-medium truncate">{title}</span>
          </div>
          <div className="text-xs text-faint mt-1">
            {configured ? detail : missingHint}
          </div>
          <div className="text-xs text-ghost mt-0.5">
            {lastSync ? `${lastLabel}: ${new Date(lastSync).toLocaleString('he-IL')}` : neverLabel}
          </div>
        </div>
        <Button variant="ghost" onClick={onSync} disabled={!configured || busy}>
          {busy ? busyLabel : actionLabel}
        </Button>
      </div>
    </div>
  );
}
