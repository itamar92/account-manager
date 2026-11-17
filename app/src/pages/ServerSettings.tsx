import React, { useEffect, useRef, useState } from 'react';
import { get, post } from '../api';
import { Button, Card, Empty } from '../ui';

interface Identity { version: string; started_at: string; configured: boolean }
interface HostStatus {
  running: boolean;
  action: string;
  started: string;
  finished: string;
  exit: number | null;
  commit: string;
  branch: string;
  subject: string;
  log: string;
}

const ACTION_LABEL: Record<string, string> = { restart: 'הפעלה מחדש', redeploy: 'עדכון ופריסה מחדש' };

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/**
 * Settings → שרת: restart the app container, or pull the latest code and rebuild it, without an
 * SSH session to the VM. The server side is opsClient.ts and deploy/ops.sh.
 *
 * Both actions stop the process serving this page, so after pressing one the page polls: first
 * the host (is the job still running?), then this app (has a new process started?). Requests that
 * fail while the container is down are expected and are not shown as errors.
 */
export function ServerSettings({ onError }: { onError: (message: string) => void }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [phase, setPhase] = useState<'' | 'starting' | 'job' | 'waiting'>('');
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState('');
  const timer = useRef<number | null>(null);

  const stopPolling = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopPolling, []);

  const loadStatus = () =>
    get('/admin/server/status')
      .then((d) => { setStatus(d.status); setStatusError(''); return d.status as HostStatus; })
      .catch((e) => { setStatusError(e.message); return null; });

  const load = () =>
    get('/admin/server/identity')
      .then((d: Identity) => {
        setIdentity(d);
        if (d.configured) loadStatus();
      })
      .catch((e) => onError(e.message));
  useEffect(() => { load(); }, []);

  /** Polls until a process with a different start time answers — the new container is up. */
  const waitForNewProcess = (previousStart: string, deadline: number) => {
    setPhase('waiting');
    const tick = () => {
      get('/admin/server/identity')
        .then((d: Identity) => {
          if (d.started_at !== previousStart) {
            setIdentity(d);
            setPhase('');
            setMessage(`השרת עלה מחדש${d.version ? ` · גרסה ${d.version}` : ''}`);
            loadStatus();
            return;
          }
          throw new Error('same process');
        })
        .catch(() => {
          if (Date.now() > deadline) {
            setPhase('');
            setMessage('');
            onError('השרת לא חזר תוך הזמן הצפוי — בדקו את היומן למטה');
            loadStatus();
            return;
          }
          timer.current = window.setTimeout(tick, 3000);
        });
    };
    timer.current = window.setTimeout(tick, 3000);
  };

  /** Redeploy: the build runs for minutes while the old container keeps serving; follow the job. */
  const followJob = (previousStart: string, deadline: number) => {
    setPhase('job');
    const tick = () => {
      get('/admin/server/status')
        .then((d) => {
          const s = d.status as HostStatus;
          setStatus(s);
          if (d.started_at !== previousStart) {
            // Already swapped to the new container.
            setIdentity((prev) => (prev ? { ...prev, version: d.version, started_at: d.started_at } : prev));
            setPhase('');
            setMessage(`הפריסה הושלמה${d.version ? ` · גרסה ${d.version}` : ''}`);
            return;
          }
          if (!s.running && s.finished) {
            if (s.exit) {
              setPhase('');
              onError(`${ACTION_LABEL[s.action] || s.action} נכשל (קוד ${s.exit}) — ראו את היומן למטה`);
              return;
            }
            return waitForNewProcess(previousStart, deadline);
          }
          timer.current = window.setTimeout(tick, 4000);
        })
        // The container being swapped answers nothing for a few seconds.
        .catch(() => {
          if (Date.now() > deadline) return waitForNewProcess(previousStart, deadline);
          timer.current = window.setTimeout(tick, 4000);
        });
    };
    timer.current = window.setTimeout(tick, 4000);
  };

  const run = async (action: 'restart' | 'redeploy') => {
    const text = action === 'restart'
      ? 'להפעיל מחדש את האפליקציה? היא לא תהיה זמינה לכמה שניות.'
      : 'לפרוס את הגרסה העדכנית של master מ-GitHub? הבנייה לוקחת כמה דקות, והאפליקציה תהיה לא זמינה לכמה שניות בסופה.';
    if (!confirm(text)) return;
    onError('');
    setMessage('');
    setLogs('');
    stopPolling();
    setPhase('starting');
    const previousStart = identity?.started_at || '';
    try {
      await post(`/admin/server/${action}`);
      setMessage(`${ACTION_LABEL[action]} התחילה…`);
      if (action === 'restart') waitForNewProcess(previousStart, Date.now() + 3 * 60_000);
      else followJob(previousStart, Date.now() + 20 * 60_000);
    } catch (err: any) {
      setPhase('');
      onError(err.message);
      loadStatus();
    }
  };

  const showLogs = async () => {
    onError('');
    try {
      const d = await get('/admin/server/logs');
      setLogs(d.logs || '(ריק)');
    } catch (err: any) { onError(err.message); }
  };

  if (!identity) return <Empty text="טוען…" />;

  const busy = phase !== '' || Boolean(status?.running);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2 h-2 rounded-full shrink-0 ${identity.configured ? 'bg-pos' : 'bg-line-strong'}`} />
          <span className="text-sm font-medium">
            {identity.configured ? 'ניהול השרת מוגדר' : 'ניהול השרת אינו מוגדר'}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-faint">גרסה רצה</dt>
          <dd dir="ltr" className="text-right font-mono text-xs">{identity.version || 'לא ידוע'}</dd>
          <dt className="text-faint">עלתה ב-</dt>
          <dd>{when(identity.started_at)}</dd>
          {status && (
            <>
              <dt className="text-faint">קוד בשרת</dt>
              <dd className="text-xs">
                <span dir="ltr" className="font-mono">{status.branch} @ {status.commit}</span>
                {status.subject && <span className="text-faint"> · {status.subject}</span>}
              </dd>
              <dt className="text-faint">פעולה אחרונה</dt>
              <dd className="text-xs">
                {status.action
                  ? `${ACTION_LABEL[status.action] || status.action} · ${when(status.started)} · ${
                      status.running ? 'רצה עכשיו…' : status.exit === 0 ? 'הצליחה' : `נכשלה (קוד ${status.exit})`
                    }`
                  : 'אין עדיין'}
              </dd>
            </>
          )}
        </dl>

        {!identity.configured && (
          <div className="mt-4 text-xs text-faint leading-relaxed space-y-2">
            <p>
              כדי להפעיל מחדש או לפרוס מכאן, צריך פעם אחת להתחבר לשרת ולהריץ שתי פקודות. הן יוצרות משתמש
              ייעודי שהמפתח שלו פותח פקודה אחת בלבד (הפעלה מחדש / עדכון), ושומרות את המפתח בתיקייה שהאפליקציה
              קוראת — בלי להדביק כלום כאן.
            </p>
            <pre dir="ltr" className="bg-soft rounded-lg p-3 text-left text-[11px] overflow-x-auto">{
`cd /opt/account-manager && git pull
sudo deploy/setup-ops.sh
cd deploy && docker compose up -d --build`
            }</pre>
          </div>
        )}
        {statusError && identity.configured && <p className="text-xs text-warn mt-3">{statusError}</p>}
      </Card>

      {identity.configured && (
        <Card>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => run('restart')}>הפעלה מחדש</Button>
            <Button disabled={busy} onClick={() => run('redeploy')}>עדכון ופריסה מחדש</Button>
            <Button variant="ghost" onClick={showLogs} className="ms-auto">יומן האפליקציה</Button>
          </div>
          <p className="text-xs text-faint mt-3 leading-relaxed">
            <b>הפעלה מחדש</b> — מפעילה מחדש את הקונטיינר, כמה שניות. <b>עדכון ופריסה מחדש</b> — מביאה את
            master העדכני מ-GitHub, בונה מחדש ומחליפה את הקונטיינר — כמו הפריסה האוטומטית. בזמן הבנייה הגרסה
            הנוכחית ממשיכה לעבוד, ואם הבנייה נכשלת היא נשארת.
          </p>

          {(phase || message) && (
            <div className="bg-accent-soft border border-accent/25 rounded-xl p-3 mt-4 text-sm">
              {phase === 'starting' && 'שולח…'}
              {phase === 'job' && 'בונה ופורס… (אפשר להשאיר את הדף פתוח)'}
              {phase === 'waiting' && 'ממתין שהשרת יעלה מחדש…'}
              {!phase && message}
            </div>
          )}

          {status?.log && (
            <details className="mt-4" open={phase === 'job'}>
              <summary className="text-xs text-faint cursor-pointer">פלט הפעולה האחרונה</summary>
              <pre dir="ltr" className="bg-soft rounded-lg p-3 mt-2 text-[11px] text-left max-h-80 overflow-auto whitespace-pre-wrap">{status.log}</pre>
            </details>
          )}
          {logs && (
            <pre dir="ltr" className="bg-soft rounded-lg p-3 mt-4 text-[11px] text-left max-h-96 overflow-auto whitespace-pre-wrap">{logs}</pre>
          )}
        </Card>
      )}
    </div>
  );
}
