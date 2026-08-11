import React, { useEffect, useState } from 'react';
import { get, post, put, del } from '../api';
import { Button, Card, Input, Modal, Empty } from '../ui';
import { CalendarRules } from './CalendarRules';

/**
 * A plain rounded number for the sync summary. Not `nis`: the Meta line reports the ad account's
 * own currency, which is not always shekels, so the symbol comes from the data beside it.
 */
const amount = (value: unknown) => Math.round(Number(value) || 0).toLocaleString('he-IL');

export function Settings() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">הגדרות</h1>
      {error && <div className="text-sm text-rose-400">{error}</div>}

      <Card>
        <h2 className="font-bold mb-1">כללי</h2>
        <p className="text-xs text-slate-500 mb-4">
          טווח הסנכרון קובע כמה אחורה כל משיכה מ-Morning מגיעה. סנכרון מרענן כל שורה שהוא מוצא במלואה,
          כך שהרחבת הטווח וסנכרון חוזר היא הדרך לתקן שורות ישנות שנמשכו בעבר.
        </p>
        {generalSaved && <div className="text-sm text-emerald-400 mb-3">{generalSaved}</div>}
        <div className="grid gap-3 md:grid-cols-3 items-end max-w-xl">
          <Input label='מע"מ (%)' type="number" step="0.1" value={vat} onChange={(e) => setVat(e.target.value)} />
          <Input label="טווח סנכרון מ-Morning (ימים)" type="number" min="1" max="1825" value={syncDays}
            onChange={(e) => setSyncDays(e.target.value)} />
          <Button variant="ghost" onClick={saveGeneral}>שמירה</Button>
        </div>
      </Card>

      {/* What the דוחות page needs to know that the books cannot tell it: how often מע"מ is
          filed, and how many נקודות זיכוי the income-tax estimate should credit. */}
      <Card>
        <h2 className="font-bold mb-1">דוחות מס</h2>
        <p className="text-xs text-slate-500 mb-4">
          משפיע על חלוקת תקופות הדיווח בדוח המע"מ ועל הערכת המס השנתית.
        </p>
        {reportsSaved && <div className="text-sm text-emerald-400 mb-3">{reportsSaved}</div>}
        <div className="grid gap-3 md:grid-cols-3 items-end max-w-xl">
          <label className="block">
            <span className="block text-sm text-slate-400 mb-1">תדירות דיווח מע"מ</span>
            <select value={vatFrequency} onChange={(e) => setVatFrequency(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
              <option value="bimonthly">דו-חודשי</option>
              <option value="monthly">חודשי</option>
            </select>
          </label>
          <Input label="נקודות זיכוי" type="number" step="0.25" min="0" value={creditPoints}
            onChange={(e) => setCreditPoints(e.target.value)} />
          <Button variant="ghost" onClick={saveReportSettings}>שמירה</Button>
        </div>
      </Card>

      {business && (
        <Card>
          <h2 className="font-bold mb-1">פרטי העסק</h2>
          <p className="text-xs text-slate-500 mb-4">
            הכותרת שמוצגת בתצוגה המקדימה לפני הנפקה ב-Morning. המסמך עצמו מונפק לפי תבנית העיצוב
            שמוגדרת ב-Morning — הפרטים כאן לא נשלחים אליו, אלא רק משלימים את התצוגה.
          </p>
          {businessSaved && <div className="text-sm text-emerald-400 mb-3">{businessSaved}</div>}
          <form onSubmit={saveBusiness} className="grid gap-3 md:grid-cols-2">
            <Input label="שם העסק" value={business.name || ''} onChange={(e) => setBusinessField('name', e.target.value)} />
            <label className="block">
              <span className="block text-sm text-slate-400 mb-1">סוג העסק</span>
              <select value={business.type || ''} onChange={(e) => setBusinessField('type', e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
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
              <p className="text-xs text-slate-500 mt-1">כתובת תמונה מלאה (https) — הלוגו עצמו נשאר מוגדר ב-Morning.</p>
            </div>
            <div className="md:col-span-2">
              <Button type="submit">שמירת פרטי העסק</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <h2 className="font-bold mb-1">חיבורים</h2>
        <p className="text-xs text-slate-500 mb-4">
          משיכת מסמכים מ-Morning ומשיכת הופעות מיומן Google. ההגדרה עצמה (מפתחות) נמצאת בקובץ <code dir="ltr" className="text-indigo-300">.env</code>
        </p>

        {syncResult && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-4 text-sm text-emerald-300 whitespace-pre-line">
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
            missingHint="חסרים AGENT_SSH_HOST / AGENT_SSH_USER / AGENT_SSH_KEY"
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
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-sm text-amber-300 mb-3">
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
            {metaSaved && <div className="text-sm text-emerald-400 mt-2">{metaSaved}</div>}
          </div>
        )}

        <p className="text-xs text-slate-500 mt-4">
          סנכרון Meta מושך את הקמפיינים וההוצאה היומית שלהם, ומזין את עמודת «קמפיין» של כל הופעה
          שקמפיין שויך אליה. השיוך עצמו נעשה ב-Moonlight → פרסום, ידנית: שם של קמפיין נכתב לבני
          אדם, וקמפיין שקידם כמה הופעות לא ניתן לפצל לפי שום כלל אוטומטי.
        </p>
      </Card>

      <CalendarRules onChange={load} onError={setError} />

      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-bold">משתמשים</h2>
            <p className="text-xs text-slate-500">חברי להקה (role: band) רואים רק את אזור Moonlight</p>
          </div>
          <Button onClick={openNewUser}>+ משתמש</Button>
        </div>
        <div className="divide-y divide-slate-800/60">
          {data.users.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{u.name}</span>
                <span className="text-slate-500 mr-2" dir="ltr">{u.email}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={u.role === 'owner' ? 'text-indigo-400' : 'text-slate-400'}>
                  {u.role === 'owner' ? 'בעלים' : 'חבר להקה'}
                </span>
                <button onClick={() => openEditUser(u)} className="text-xs text-indigo-400 hover:underline">עריכה</button>
                {u.role !== 'owner' && (
                  <button onClick={async () => { if (confirm('למחוק משתמש?')) { await del(`/settings/users/${u.id}`); load(); } }}
                    className="text-xs text-rose-400 hover:underline">מחיקה</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-bold mb-1">מפתחות API</h2>
        <p className="text-xs text-slate-500 mb-4">
          לחיבור אפליקציות חיצוניות (Morning / מערכת ניהול לקוחות). שליחת בקשות עם כותרת <code className="text-indigo-300" dir="ltr">X-API-Key</code> אל <code className="text-indigo-300" dir="ltr">/api/v1/*</code>
        </p>
        <form onSubmit={createKey} className="flex items-end gap-3 max-w-md mb-4">
          <Input label="שם המפתח" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="למשל: morning-app" required />
          <Button type="submit">יצירה</Button>
        </form>
        {newKey && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-4 text-sm">
            <div className="font-medium text-emerald-400 mb-1">המפתח נוצר — העתק אותו עכשיו, הוא לא יוצג שוב:</div>
            <code className="break-all select-all" dir="ltr">{newKey.key}</code>
          </div>
        )}
        <div className="divide-y divide-slate-800/60">
          {data.api_keys.map((k: any) => (
            <div key={k.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <span className="font-medium">{k.name}</span>
                <span className="text-slate-500 mr-2 font-mono" dir="ltr">{k.key_prefix}…</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                {k.last_used_at ? `שימוש אחרון: ${k.last_used_at}` : 'לא היה בשימוש'}
                <button onClick={async () => { if (confirm('לבטל את המפתח?')) { await del(`/settings/api-keys/${k.id}`); load(); } }}
                  className="text-rose-400 hover:underline">ביטול</button>
              </div>
            </div>
          ))}
        </div>
      </Card>

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
            <span className="block text-sm text-slate-400 mb-1">תפקיד</span>
            <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
              <option value="band">חבר להקה (Moonlight בלבד)</option>
              <option value="owner">בעלים (גישה מלאה)</option>
            </select>
          </label>
          {editUser && userForm.password && (
            <p className="text-xs text-slate-500">
              שינוי סיסמה מנתק את המשתמש מכל המכשירים שבהם הוא מחובר.
            </p>
          )}
          <Button type="submit" className="w-full">{editUser ? 'שמירה' : 'יצירה'}</Button>
        </form>
      </Modal>
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
    <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${configured ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            <span className="font-medium truncate">{title}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {configured ? detail : missingHint}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">
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
