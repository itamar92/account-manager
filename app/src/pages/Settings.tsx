import React, { useEffect, useState } from 'react';
import { get, post, del } from '../api';
import { Button, Card, Input, Modal, Empty } from '../ui';
import { CalendarRules } from './CalendarRules';

export function Settings() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState<any>(null);
  const [keyName, setKeyName] = useState('');
  const [userModal, setUserModal] = useState(false);
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'band' });
  const [vat, setVat] = useState('');
  const [syncing, setSyncing] = useState('');
  const [syncResult, setSyncResult] = useState('');

  const load = () =>
    get('/settings')
      .then((d) => {
        setData(d);
        setVat(String(d.settings.vat_percent));
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
          ? `Morning: ${r.fetched} מסמכים (${r.from} – ${r.to}) · ${r.created} חדשים · ${r.updated} עודכנו`
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

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post('/settings/users', userForm);
      setUserModal(false);
      setUserForm({ name: '', email: '', password: '', role: 'band' });
      load();
    } catch (err: any) { setError(err.message); }
  };

  const saveVat = async () => {
    try { await post('/settings', { vat_percent: parseFloat(vat) }); load(); } catch (err: any) { setError(err.message); }
  };

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
            detail={`${data.integrations.morning.synced_invoices} מסמכים מסונכרנים · טווח ${data.integrations.morning.sync_days} ימים`}
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

      <CalendarRules rules={data.calendar_rules} onChange={load} onError={setError} />

      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-bold">משתמשים</h2>
            <p className="text-xs text-slate-500">חברי להקה (role: band) רואים רק את אזור Moonlight</p>
          </div>
          <Button onClick={() => setUserModal(true)}>+ משתמש</Button>
        </div>
        <div className="divide-y divide-slate-800/60">
          {data.users.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <span className="font-medium">{u.name}</span>
                <span className="text-slate-500 mr-2" dir="ltr">{u.email}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={u.role === 'owner' ? 'text-indigo-400' : 'text-slate-400'}>
                  {u.role === 'owner' ? 'בעלים' : 'חבר להקה'}
                </span>
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

      <Modal title="משתמש חדש" open={userModal} onClose={() => setUserModal(false)}>
        <form onSubmit={addUser} className="space-y-3">
          <Input label="שם *" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} required />
          <Input label="אימייל *" type="email" dir="ltr" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
          <Input label="סיסמה *" type="password" dir="ltr" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} required />
          <label className="block">
            <span className="block text-sm text-slate-400 mb-1">תפקיד</span>
            <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm">
              <option value="band">חבר להקה (Moonlight בלבד)</option>
              <option value="owner">בעלים (גישה מלאה)</option>
            </select>
          </label>
          <Button type="submit" className="w-full">יצירה</Button>
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
