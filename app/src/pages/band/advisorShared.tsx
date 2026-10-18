import React, { useEffect, useId, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, Check, Copy, MoreHorizontal } from 'lucide-react';
import { Button, Modal } from '../../ui';

/** A run the agent is working on — started by this page, or found running when the page loaded. */
export interface AdvisorJob {
  kind: 'analysis' | 'draft' | 'chat' | 'review' | 'tickets';
  status: 'running' | 'failed';
  started_at: string;
  error?: string;
  event_id?: string;
  brief?: string;
  message?: string;
}

/** What the agent is doing, as the run indicator says it, and what it says when it is done. */
export const JOB_TEXT: Record<AdvisorJob['kind'], { doing: string; done: string }> = {
  analysis: { doing: 'מנתח את הקמפיינים של התקופה', done: 'סיכום התקופה מוכן' },
  draft: { doing: 'בונה תוכנית קמפיין', done: 'התוכנית מוכנה' },
  review: { doing: 'בודק את מצב הקמפיין', done: 'בדיקת המצב מוכנה' },
  tickets: { doing: 'בודק כרטיסים באתר המועדון', done: 'בדיקת הכרטיסים מוכנה' },
  chat: { doing: 'עונה על השאלה', done: 'הסוכן ענה' },
};

/** 'YYYY-MM-DDTHH:MM:SSZ' (or SQLite's 'YYYY-MM-DD HH:MM:SS', which is UTC) as local time. */
export const when = (iso: string | null | undefined) => {
  if (!iso) return '';
  const utc = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
  return new Date(utc).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
};

/** 'YYYY-MM-DD' as 'DD/MM', the way a date reads inside a sentence here. */
export const ddmm = (date: string | null | undefined) => {
  const [, m, d] = String(date || '').split('-');
  return m && d ? `${d}/${m}` : String(date || '');
};

/** How far away a show is, in words: «היום», «מחר», «בעוד 12 ימים», «לפני 3 ימים». */
export const daysAway = (days: number) =>
  days === 0 ? 'היום' : days === 1 ? 'מחר' : days > 1 ? `בעוד ${days} ימים` : days === -1 ? 'אתמול' : `לפני ${-days} ימים`;

const elapsedText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * A run goes over SSH to another machine and can take a couple of minutes — long enough that a
 * spinner alone reads as a hang. The elapsed count is what says it is still working, and it counts
 * from when the run started, so a page reloaded half way through picks up the count rather than
 * starting again from zero.
 *
 * Only the sentence is announced to a screen reader; the count ticks every second and would
 * otherwise be read out every second.
 */
export function Working({ text, since, hint = true }: { text: string; since?: string; hint?: boolean }) {
  const start = since ? Date.parse(since) : Date.now();
  const elapsed = () => Math.max(0, Math.round((Date.now() - start) / 1000));
  const [seconds, setSeconds] = useState(elapsed);
  useEffect(() => {
    setSeconds(elapsed());
    const timer = setInterval(() => setSeconds(elapsed()), 1000);
    return () => clearInterval(timer);
  }, [start]);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
      <span className="inline-block w-3.5 h-3.5 shrink-0 rounded-full border-2 border-accent border-t-transparent animate-spin motion-reduce:animate-none" aria-hidden />
      <span role="status" className="text-ink-2 font-medium">{text}</span>
      <span className="num text-faint" aria-hidden>{elapsedText(seconds)}</span>
      {hint && <span className="text-faint">· בדרך כלל דקה עד שתיים</span>}
    </div>
  );
}

/**
 * Copies one value. Ads Manager has a field per setting, so a plan is pasted a piece at a time —
 * one block of text for all of it would have to be cut apart by hand.
 */
export function CopyButton({ text, label = 'העתקה' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {})}
      title={label}
      aria-label={copied ? 'הועתק' : label}
      className="shrink-0 inline-flex items-center justify-center w-10 h-10 -m-1 rounded-lg text-muted hover:text-accent hover:bg-accent-soft transition-colors"
    >
      {copied ? <Check className="w-4 h-4 text-pos" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

/**
 * Tabs that switch what one card shows. Real tabs to a screen reader and the arrow keys, and an
 * underline rather than a filled pill, so they never read as another row of filters.
 */
export function ViewTabs<T extends string>({ value, options, onChange, label, className }: {
  value: T;
  options: Array<{ value: T; label: string; badge?: React.ReactNode }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, step: number) => {
    const next = (from + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label}
      className={clsx('rail flex gap-1 overflow-x-auto border-b border-line', className)}>
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button key={option.value} ref={(el) => { refs.current[i] = el; }}
            type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            // In RTL the arrow pointing left is the next tab.
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); move(i, 1); }
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i, -1); }
            }}
            className={clsx('relative shrink-0 min-h-11 px-3 text-sm font-semibold whitespace-nowrap transition-colors inline-flex items-center gap-1.5',
              selected ? 'text-ink' : 'text-muted hover:text-ink-2')}>
            {option.label}
            {option.badge}
            <span aria-hidden className={clsx('absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-colors',
              selected ? 'bg-accent' : 'bg-transparent')} />
          </button>
        );
      })}
    </div>
  );
}

/** A failure said beside the button that caused it, with what to do next. */
export function InlineError({ text, onDismiss }: { text: string | null | undefined; onDismiss?: () => void }) {
  if (!text) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-neg-soft px-3 py-2 text-sm text-neg-ink">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
      <span className="flex-1 min-w-0 leading-relaxed">{text}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs font-semibold underline underline-offset-2">סגירה</button>
      )}
    </div>
  );
}

/**
 * The «⋯» beside a row: the rare actions (re-send, delete) that should be one tap away but not
 * sit next to the everyday one, where a thumb lands on them by mistake.
 */
export function OverflowMenu({ label, items, disabled }: {
  label: string;
  items: Array<{ label: string; onSelect: () => void; danger?: boolean; hidden?: boolean }>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const shown = items.filter((item) => !item.hidden);
  if (!shown.length) return null;
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
        disabled={disabled} onClick={() => setOpen((v) => !v)}
        className="grid place-items-center w-10 h-10 rounded-lg text-muted hover:text-ink hover:bg-soft disabled:opacity-40">
        <MoreHorizontal className="w-4 h-4" aria-hidden />
      </button>
      {open && (
        <div id={id} role="menu"
          className="settle-in absolute end-0 top-full z-30 mt-1 min-w-44 rounded-xl border border-line bg-surface p-1 shadow-[0_12px_32px_rgba(20,24,32,.14)]">
          {shown.map((item) => (
            <button key={item.label} type="button" role="menuitem"
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={clsx('w-full min-h-10 rounded-lg px-3 text-start text-sm hover:bg-soft',
                item.danger ? 'text-neg-ink' : 'text-ink-2')}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The app's own confirm, in place of the browser's: says what will be lost and names the action
 * on its button. `ask` resolves true only when that button is pressed.
 */
export function useConfirm() {
  const [pending, setPending] = useState<null | {
    title: string; body: React.ReactNode; action: string; resolve: (ok: boolean) => void;
  }>(null);
  const ask = (title: string, body: React.ReactNode, action: string) =>
    new Promise<boolean>((resolve) => setPending({ title, body, action, resolve }));
  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const dialog = pending && (
    <Modal title={pending.title} open onClose={() => finish(false)}>
      <div className="space-y-4">
        <div className="text-sm text-body leading-relaxed">{pending.body}</div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => finish(false)}>ביטול</Button>
          <Button variant="danger" onClick={() => finish(true)}>{pending.action}</Button>
        </div>
      </div>
    </Modal>
  );
  return { ask, dialog };
}

/**
 * Tickets sold against the hall, as a bar. The figure beside it is the point; the bar only says
 * at a glance how full that is.
 */
export function Meter({ value, max, tone = 'accent', className }: {
  value: number;
  max: number;
  tone?: 'accent' | 'light';
  className?: string;
}) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div aria-hidden className={clsx('h-1.5 rounded-full overflow-hidden',
      tone === 'light' ? 'bg-white/15' : 'bg-line', className)}>
      <div className={clsx('h-full rounded-full', tone === 'light' ? 'bg-white' : 'bg-accent')}
        style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}
