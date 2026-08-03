import React, { useEffect, useState } from 'react';
import { get, post, put, del } from '../api';
import { Button, Card, Input, Modal, Empty } from '../ui';
import { CalendarRules } from './CalendarRules';

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
  const [syncing, setSyncing] = useState('');
  const [syncResult, setSyncResult] = useState('');
  const [business, setBusiness] = useState<any>(null);
  const [businessSaved, setBusinessSaved] = useState('');

  const load = () =>
    get('/settings')
      .then((d) => {
        setData(d);
        setVat(String(d.settings.vat_percent));
        setBusiness(d.business);
      })
      .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const runSync = async (which: 'morning' | 'calendar') => {
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
              : `\n· הוצאות: ${r.expenses.fetched} · ${r.expenses.created} חדשות · ${r.expenses.updated} עודכנו`)
          : `יומן: ${r.matched} תואמים · ${r.created} חדשים · ${r.updated} עודכנו · ${r.linked} שויכו` +
            (r.rules ?? []).map((x: any) => `\n· ${x.ruleName}: ${x.matched} תואמים${x.error ? ` — שגיאה: ${x.error}` : ''}`).join('')
      );
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

  const saveVat = async () => {
    try { await post('/settings', { vat_percent: parseFloat(vat) }); load(); } catch (err: any) { setError(err.message); }
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
        <h2 className="font-bold mb-3">כללי</h2>
        <div className="flex items-end gap-3 max-w-xs">
          <Input label='מע"מ (%)' type="number" step="0.1" value={vat} onChange={(e) => setVat(e.target.value)} />
          <Button variant="ghost" onClick={saveVat}>שמירה</Button>
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
        </div>

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

function IntegrationRow({
  title, configured, missingHint, lastSync, detail, busy, onSync,
}: {
  title: string;
  configured: boolean;
  missingHint: string;
  lastSync: string | null;
  detail: string;
  busy: boolean;
  onSync: () => void;
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
            {lastSync ? `סנכרון אחרון: ${new Date(lastSync).toLocaleString('he-IL')}` : 'טרם סונכרן'}
          </div>
        </div>
        <Button variant="ghost" onClick={onSync} disabled={!configured || busy}>
          {busy ? 'מסנכרן…' : 'סנכרון'}
        </Button>
      </div>
    </div>
  );
}
