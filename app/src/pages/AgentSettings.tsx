import React, { useEffect, useState } from 'react';
import { get, post } from '../api';
import { Button, Card, Empty, Input, Textarea } from '../ui';

/** What the server is willing to say about the stored configuration — never the key itself. */
interface AgentView {
  host: string;
  port: number;
  user: string;
  host_key: string;
  host_key_pinned: boolean;
  command: string;
  timeout_ms: number;
  key_set: boolean;
  key_type: string;
  key_fingerprint: string;
  key_comment: string;
  key_error: string;
  passphrase_set: boolean;
  configured: boolean;
  sources: Record<string, 'ui' | 'env' | 'default'>;
  uses_env: boolean;
  defaults: { port: number; command: string; timeout_ms: number };
}

/** Said once, beside the field it applies to: this value is still the one from `.env`. */
function FromEnv({ source }: { source?: string }) {
  if (source !== 'env') return null;
  return <span className="text-[11px] text-warn mr-1.5">· מגיע מ-.env</span>;
}

/**
 * The agent's connection details, as a form.
 *
 * They used to live only in `AGENT_SSH_*`, which meant that moving the agent to another machine
 * took a shell on the server and a restart. Everything here can still be set in the environment
 * and a deployment that does so keeps working — what is saved on this page simply takes
 * precedence, and every field says when the value shown is coming from the environment instead.
 *
 * The private key is the reason the page is careful: it goes up, never comes back down, and is
 * identified afterwards only by its fingerprint.
 */
export function AgentSettings({ onSaved, onError }: { onSaved?: () => void; onError: (message: string) => void }) {
  const [view, setView] = useState<AgentView | null>(null);
  const [form, setForm] = useState({ host: '', port: '', user: '', host_key: '', command: '', timeout_ms: '' });
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [saved, setSaved] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    get('/settings/agent')
      .then((d) => {
        setView(d.agent);
        setForm({
          host: d.agent.host,
          port: String(d.agent.port),
          user: d.agent.user,
          host_key: d.agent.host_key,
          command: d.agent.command,
          timeout_ms: String(d.agent.timeout_ms),
        });
        setPrivateKey('');
        setPassphrase('');
      })
      .catch((e) => onError(e.message));
  useEffect(() => { load(); }, []);

  const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    onError('');
    setSaved('');
    setTestResult('');
    setBusy(true);
    try {
      // The two secrets are sent only when something was typed: an empty box means "leave the
      // stored one alone", the same as it does on the password field one section over.
      const body: Record<string, unknown> = { ...form };
      if (privateKey.trim()) body.private_key = privateKey;
      if (passphrase) body.passphrase = passphrase;
      const d = await post('/settings/agent', body);
      setView(d.agent);
      setPrivateKey('');
      setPassphrase('');
      setSaved('הגדרות הסוכן נשמרו');
      onSaved?.();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(false); }
  };

  const clearKey = async () => {
    if (!confirm('למחוק את המפתח הפרטי השמור?')) return;
    onError('');
    setSaved('');
    try {
      const d = await post('/settings/agent', { clear_private_key: true });
      setView(d.agent);
      setSaved('המפתח נמחק');
      onSaved?.();
    } catch (err: any) { onError(err.message); }
  };

  /** Opens the session and asks the agent its version — the cheapest proof the whole chain works. */
  const test = async () => {
    onError('');
    setTestResult('');
    setTesting(true);
    try {
      const d = await post('/integrations/agent/ping');
      setTestResult(`הסוכן ענה תוך ${Math.round(d.result.duration_ms / 1000)} שניות · ${d.result.version}`);
      onSaved?.();
    } catch (err: any) { onError(err.message); }
    finally { setTesting(false); }
  };

  if (!view) return <Empty text="טוען…" />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2 h-2 rounded-full shrink-0 ${view.configured ? 'bg-pos' : 'bg-line-strong'}`} />
          <span className="text-sm font-medium">
            {view.configured ? 'הסוכן מוגדר' : 'הסוכן אינו מוגדר — חסרים שרת, משתמש או מפתח'}
          </span>
        </div>
        <p className="text-xs text-faint leading-relaxed">
          יועץ הקמפיינים אינו API אלא כלי שורת פקודה שרץ על מכונה אחרת, שכבר מחוברת לחשבון ה-AI.
          האפליקציה פותחת אליה חיבור SSH, כותבת את השאלה ל-stdin של פקודה אחת קבועה וקוראת את
          התשובה — ולכן אין כאן מפתח API של ספק ה-AI, אלא רק מפתח שפותח פקודה אחת.
        </p>
        <ol className="text-xs text-faint mt-3 space-y-1 list-decimal ps-5 leading-relaxed">
          <li>על שרת הסוכן: צרו משתמש ייעודי והתקינו את הכלי, מחוברים כמו שאתם.</li>
          <li>
            במחשב שלכם: <code dir="ltr" className="text-accent">ssh-keygen -t ed25519 -f ~/.ssh/am-agent -N ''</code>
          </li>
          <li>
            הוסיפו את החצי הציבורי ל-<code dir="ltr" className="text-accent">~/.ssh/authorized_keys</code> של אותו
            משתמש, מוגבל לפקודה אחת:{' '}
            <code dir="ltr" className="text-accent break-all">
              command="claude -p --output-format json",no-port-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA…
            </code>
          </li>
          <li>
            <code dir="ltr" className="text-accent">ssh-keyscan -t ed25519 &lt;שרת&gt;</code> — הדביקו את הפלט לשדה
            «מפתח המארח» כאן.
          </li>
          <li>הדביקו את החצי הפרטי (הקובץ ללא הסיומת .pub) בשדה «מפתח פרטי», ושמרו.</li>
        </ol>
        {view.uses_env && (
          <p className="text-xs text-warn mt-3">
            חלק מהערכים עדיין מגיעים מקובץ <code dir="ltr">.env</code>. מה שנשמר כאן גובר עליהם; שדה שיישאר ריק
            ימשיך לקחת את הערך מהקובץ.
          </p>
        )}
      </Card>

      <Card>
        {saved && <div className="text-sm text-pos mb-3">{saved}</div>}
        {testResult && (
          <div className="bg-pos-soft border border-pos/25 rounded-xl p-3 mb-4 text-sm text-pos whitespace-pre-line">
            {testResult}
          </div>
        )}
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Input label="שרת (host)" dir="ltr" placeholder="host.docker.internal"
                value={form.host} onChange={field('host')} />
              <FromEnv source={view.sources.host} />
            </div>
            <div>
              <Input label="משתמש" dir="ltr" placeholder="am-agent" value={form.user} onChange={field('user')} />
              <FromEnv source={view.sources.user} />
            </div>
            <div>
              <Input label="פורט" type="number" min="1" max="65535" dir="ltr"
                placeholder={String(view.defaults.port)} value={form.port} onChange={field('port')} />
              <FromEnv source={view.sources.port} />
            </div>
          </div>

          <div>
            <Textarea
              label="מפתח פרטי (SSH)"
              dir="ltr"
              rows={5}
              className="font-mono text-xs"
              placeholder={view.key_set
                ? 'מפתח שמור — השאירו ריק כדי לא לשנות אותו'
                : '-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
              {view.key_error ? (
                <span className="text-xs text-neg">{view.key_error}</span>
              ) : view.key_set ? (
                <span className="text-xs text-pos" dir="ltr">
                  {view.key_type} · {view.key_fingerprint}
                  {view.key_comment ? ` · ${view.key_comment}` : ''}
                </span>
              ) : (
                <span className="text-xs text-faint">אין מפתח שמור — הדביקו את תוכן הקובץ הפרטי במלואו.</span>
              )}
              <FromEnv source={view.sources.privateKey} />
              {view.key_set && view.sources.privateKey === 'ui' && (
                <button type="button" onClick={clearKey} className="text-xs text-neg hover:underline">
                  מחיקת המפתח
                </button>
              )}
            </div>
            <p className="text-xs text-faint mt-1">
              המפתח נשמר מוצפן ואינו נשלח חזרה לדפדפן — לאחר השמירה מוצגת רק טביעת האצבע שלו.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Input
                label="סיסמת המפתח (אם קיימת)"
                type="password" dir="ltr" autoComplete="new-password"
                placeholder={view.passphrase_set ? 'שמורה — השאירו ריק כדי לא לשנות' : 'ללא'}
                value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
              />
              <FromEnv source={view.sources.passphrase} />
            </div>
          </div>

          <div>
            <Textarea
              label="מפתח המארח (ssh-keyscan)"
              dir="ltr"
              rows={3}
              className="font-mono text-xs"
              placeholder="agent-host ssh-ed25519 AAAAC3NzaC1lZDI1NTE5…"
              value={form.host_key}
              onChange={field('host_key')}
            />
            <div className="flex flex-wrap items-center gap-x-3 mt-1.5">
              <span className={`text-xs ${view.host_key_pinned ? 'text-pos' : 'text-warn'}`}>
                {view.host_key_pinned ? 'מפתח המארח מוצמד' : '⚠ מפתח המארח לא מוצמד — בייצור החיבור ייחסם'}
              </span>
              <FromEnv source={view.sources.hostKey} />
            </div>
            <p className="text-xs text-faint mt-1">
              בלי הצמדה, מי שיענה לכתובת יקבל את המפתח הפרטי. ניתן להדביק את פלט ssh-keyscan כמו שהוא,
              כולל שם המארח בתחילת השורה, וגם כמה שורות יחד.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Input label="הפקודה שתרוץ על שרת הסוכן" dir="ltr"
                placeholder={view.defaults.command} value={form.command} onChange={field('command')} />
              <FromEnv source={view.sources.command} />
              <p className="text-xs text-faint mt-1">
                השאלה נכתבת ל-stdin של הפקודה ולעולם לא לשורת הפקודה עצמה.
              </p>
            </div>
            <div>
              <Input label="זמן קצוב לתשובה (מילישניות)" type="number" min="1000" max="600000" step="1000" dir="ltr"
                placeholder={String(view.defaults.timeout_ms)} value={form.timeout_ms} onChange={field('timeout_ms')} />
              <FromEnv source={view.sources.timeoutMs} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'שומר…' : 'שמירת הגדרות הסוכן'}</Button>
            <Button variant="ghost" onClick={test} disabled={!view.configured || testing}>
              {testing ? 'בודק…' : 'בדיקת חיבור'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
