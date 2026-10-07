import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** A run the agent is working on — started by this page, or found running when the page loaded. */
export interface AdvisorJob {
  kind: 'analysis' | 'draft' | 'chat';
  status: 'running' | 'failed';
  started_at: string;
  error?: string;
  event_id?: string;
  brief?: string;
  message?: string;
}

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

/**
 * A run goes over SSH to another machine and can take a couple of minutes — long enough that a
 * spinner alone reads as a hang. The elapsed count is what says it is still working, and it counts
 * from when the run started, so a page reloaded half way through picks up the count rather than
 * starting again from zero.
 */
export function Working({ text, since }: { text: string; since?: string }) {
  const start = since ? Date.parse(since) : Date.now();
  const elapsed = () => Math.max(0, Math.round((Date.now() - start) / 1000));
  const [seconds, setSeconds] = useState(elapsed);
  useEffect(() => {
    setSeconds(elapsed());
    const timer = setInterval(() => setSeconds(elapsed()), 1000);
    return () => clearInterval(timer);
  }, [start]);
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      {text} · {seconds} שניות
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
      aria-label={label}
      className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-accent hover:bg-accent-soft transition-colors"
    >
      {copied ? <Check className="w-4 h-4 text-pos" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

const SECTIONS_KEY = 'moonlight.campaignAi.sections';

/**
 * Which of the tab's sections are open.
 *
 * `defaults` say what deserves attention right now (a critical finding, a late task); a section
 * the reader opened or closed by hand stays that way across reloads. Browser storage only holds
 * that preference — it may be missing or refuse a write, and the page is the same without it.
 */
export function useOpenSections(defaults: Record<string, boolean>) {
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}') || {};
    } catch {
      return {};
    }
  });
  const save = (next: Record<string, boolean>) => {
    setChosen(next);
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
    } catch { /* the choice just will not outlive this page */ }
  };
  const isOpen = (id: string) => chosen[id] ?? defaults[id] ?? false;
  const set = (id: string, open: boolean) => save({ ...chosen, [id]: open });
  return {
    isOpen,
    set,
    toggle: (id: string) => set(id, !isOpen(id)),
    allOpen: Object.keys(defaults).every(isOpen),
    setAll: (open: boolean) => save(Object.fromEntries(Object.keys(defaults).map((id) => [id, open]))),
  };
}
