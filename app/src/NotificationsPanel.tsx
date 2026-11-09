import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Share, PlusSquare, Send, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';
import { get, post, put } from './api';
import { Button, Modal, Switch } from './ui';
import {
  currentSubscription, disablePush, enablePush, needsHomeScreen, pushSupported,
} from './push';

interface Category {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  parent?: string;
}

interface Pending {
  key: string;
  category: string;
  title: string;
  body: string;
  url: string;
  sent: boolean;
}

interface State {
  publicKey: string;
  categories: Category[];
  devices: number;
  window: { from: number; until: number };
  pending: Pending[];
  history: Array<{ key: string; title: string; body: string; url: string; sent_on: string }>;
}

const ddmm = (date: string) => date.split('-').reverse().slice(0, 2).join('/');

/**
 * The bell in the header: turns push on for this device, chooses what to hear about, and shows
 * what is due right now — so the panel is useful even on a device that never says yes.
 */
export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (pushSupported() && Notification.permission === 'granted') {
      currentSubscription().then((s) => setOn(!!s)).catch(() => {});
    }
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="התראות"
        aria-label="התראות"
        className="relative p-2 rounded-lg text-faint hover:text-ink-2 hover:bg-soft transition-colors"
      >
        {on ? <Bell size={18} /> : <BellOff size={18} />}
      </button>
      <Modal title="התראות" open={open} onClose={() => setOpen(false)}>
        {open && <NotificationsPanel onChange={setOn} />}
      </Modal>
    </>
  );
}

function NotificationsPanel({ onChange }: { onChange: (on: boolean) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    get<State>('/notifications').then(setState).catch((e) => setMessage({ ok: false, text: e.message }));
    currentSubscription().then((s) => { setSubscribed(!!s); onChange(!!s); }).catch(() => {});
  }, [onChange]);

  useEffect(load, [load]);

  const act = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ ok: true, text });
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy('');
    }
  };

  const toggle = (key: string, value: boolean) => {
    if (!state) return;
    setState({ ...state, categories: state.categories.map((c) => (c.key === key ? { ...c, enabled: value } : c)) });
    put('/notifications/prefs', { prefs: { [key]: value } })
      .then(() => get<State>('/notifications').then(setState))
      .catch((e) => setMessage({ ok: false, text: e.message }));
  };

  if (!state) return <p className="text-sm text-faint">טוען…</p>;

  const owed = state.pending.filter((p) => !p.sent);
  const parents = state.categories.filter((c) => !c.parent);
  const childrenOf = (key: string) => state.categories.filter((c) => c.parent === key);

  return (
    <div className="space-y-5 text-sm">
      {/* ---- this device ---- */}
      <section className="rounded-xl border border-line p-4 space-y-3">
        {!pushSupported() && !needsHomeScreen() ? (
          <p className="text-muted">הדפדפן הזה לא תומך בהתראות. אפשר עדיין לראות כאן מה ממתין.</p>
        ) : needsHomeScreen() ? (
          <div className="space-y-2">
            <p className="font-semibold text-ink">באייפון, התראות מגיעות רק לאפליקציה שעל מסך הבית</p>
            <ol className="text-muted space-y-1.5 list-decimal ps-5">
              <li>בספארי, לוחצים על <Share size={14} className="inline -mt-0.5" /> שיתוף</li>
              <li>בוחרים <PlusSquare size={14} className="inline -mt-0.5" /> «הוסף למסך הבית»</li>
              <li>פותחים את האפליקציה מהאייקון החדש, נכנסים שוב לכאן ומפעילים</li>
            </ol>
            <p className="text-faint text-xs">דורש iOS 16.4 ומעלה.</p>
          </div>
        ) : subscribed ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-pos-ink font-medium">
              <CheckCircle2 size={18} /> ההתראות פעילות במכשיר הזה
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={!!busy} onClick={() => act('test', async () => {
                await post('/notifications/test');
                return 'נשלחה התראת בדיקה';
              })}>
                {busy === 'test' ? 'שולח…' : 'שליחת בדיקה'}
              </Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => act('off', async () => {
                await disablePush();
                return 'ההתראות כובו במכשיר הזה';
              })}>
                כיבוי
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted">
              קבלת תזכורות למכשיר הזה, גם כשהאפליקציה סגורה.
              {state.devices > 0 && <span className="text-faint"> (פעיל כבר ב-{state.devices} מכשירים אחרים)</span>}
            </p>
            <Button disabled={!!busy} onClick={() => act('on', async () => {
              await enablePush(state.publicKey);
              return 'ההתראות הופעלו';
            })}>
              <span className="inline-flex items-center gap-2"><Bell size={16} />{busy === 'on' ? 'מפעיל…' : 'הפעלת התראות'}</span>
            </Button>
          </div>
        )}
        {message && (
          <p className={clsx('text-[13px]', message.ok ? 'text-pos-ink' : 'text-neg-ink')}>{message.text}</p>
        )}
      </section>

      {/* ---- what is due now ---- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-ink">ממתין עכשיו</h3>
          {subscribed && owed.length > 0 && (
            <button
              className="inline-flex items-center gap-1.5 text-[13px] text-accent-ink hover:underline disabled:opacity-50"
              disabled={!!busy}
              onClick={() => act('run', async () => {
                const r = await post<{ notifications: number }>('/notifications/run');
                return r.notifications ? `נשלחו ${r.notifications} התראות` : 'לא נשלח דבר';
              })}
            >
              <Send size={14} /> לשלוח עכשיו
            </button>
          )}
        </div>
        {state.pending.length === 0 ? (
          <p className="text-faint">אין כרגע שום דבר שמחכה לך.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {state.pending.map((p) => (
              <li key={p.key}>
                <a href={p.url} className="block px-3 py-2.5 hover:bg-soft">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-medium text-ink-2">{p.title}</span>
                    {p.sent && <span className="text-[11px] text-faint shrink-0 mt-0.5">נשלח</span>}
                  </span>
                  <span className="block text-[13px] text-muted">{p.body}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-faint">
          נשלח בין {state.window.from}:00 ל-{state.window.until}:00 (שעון ישראל). כמה התראות מאותו סוג מתאחדות להתראה אחת.
        </p>
      </section>

      {/* ---- what to hear about ---- */}
      <section className="space-y-2">
        <h3 className="font-semibold text-ink">על מה להתריע</h3>
        <ul className="space-y-3">
          {parents.map((c) => (
            <li key={c.key} className="space-y-2">
              <CategoryRow category={c} onToggle={toggle} />
              {c.enabled && childrenOf(c.key).map((child) => (
                <div key={child.key} className="ps-5 border-s-2 border-line">
                  <CategoryRow category={child} onToggle={toggle} />
                </div>
              ))}
            </li>
          ))}
        </ul>
      </section>

      {state.history.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer font-semibold text-ink">נשלחו לאחרונה</summary>
          <ul className="mt-2 space-y-1.5">
            {state.history.map((h, i) => (
              <li key={`${h.key}-${i}`} className="flex gap-3 text-[13px]">
                <span className="text-faint shrink-0 tabular-nums">{ddmm(h.sent_on)}</span>
                <a href={h.url} className="text-ink-2 hover:underline">{h.title}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CategoryRow({ category, onToggle }: { category: Category; onToggle: (key: string, value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium text-ink-2">{category.label}</p>
        <p className="text-[12px] text-faint">{category.description}</p>
      </div>
      <div className="shrink-0 pt-0.5">
        <Switch checked={category.enabled} onChange={(v) => onToggle(category.key, v)} label="" />
      </div>
    </div>
  );
}
