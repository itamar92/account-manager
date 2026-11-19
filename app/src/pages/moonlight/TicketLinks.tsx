import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Ticket, X } from 'lucide-react';
import { post, put } from '../../api';
import { Button, Input, Modal } from '../../ui';
import { hostOf, type TicketLink } from './TicketSourcesModal';

const AVAILABILITY: Record<string, string> = { sold_out: 'אזל', limited: 'כרטיסים אחרונים' };

/**
 * Where the show's tickets are sold, on the show's dark slab.
 *
 * A link the finder was sure of is simply there, to open or copy into a post. One it was not
 * sure of — the date matched but the hall did not say — waits for a ✓ or ✗. A link pasted by
 * hand is the band's word and goes straight in.
 */
export function TicketLinks({ eventId, links, isOwner, onChange, onError }: {
  eventId: string;
  links: TicketLink[];
  isOwner: boolean;
  onChange: () => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const visible = isOwner ? links : links.filter((l) => l.status === 'confirmed');

  const decide = async (link: TicketLink, status: 'confirmed' | 'rejected') => {
    onError('');
    try { await put(`/moonlight/ticket-links/${link.id}`, { status }); onChange(); }
    catch (e: any) { onError(e.message); }
  };

  const copy = async (link: TicketLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.id);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* a browser that refuses the clipboard still has the link to open */ }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      await post(`/moonlight/events/${eventId}/ticket-links`, { url });
      setAdding(false);
      setUrl('');
      onChange();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(false); }
  };

  if (!visible.length && !isOwner) return null;

  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      {visible.map((l) => {
        const suggested = l.status === 'suggested';
        const where = l.source_name || hostOf(l.url);
        return (
          <div key={l.id} className="flex items-center gap-2 flex-wrap text-[13px]">
            <a href={l.url} target="_blank" rel="noopener noreferrer"
              title={l.title || l.url}
              className="inline-flex items-center gap-1.5 text-white/80 hover:text-white">
              <Ticket size={14} />
              <span>כרטיסים · {where}</span>
              {l.price != null && <span className="num">· ₪{l.price}</span>}
              <ExternalLink size={12} className="text-white/45" />
            </a>
            {l.availability && AVAILABILITY[l.availability] && (
              <span className="text-[11.5px] font-semibold rounded-full px-2 py-0.5 bg-[#E2A63A]/20 text-[#E2A63A]">
                {AVAILABILITY[l.availability]}
              </span>
            )}
            {suggested ? (
              <>
                <span className="text-[#E2A63A]">
                  נמצא באתר{l.event_time ? <> · <span className="num">{l.event_time}</span></> : ''} — זו ההופעה?
                </span>
                <IconButton label="כן, זו ההופעה" onClick={() => decide(l, 'confirmed')}><Check size={13} /></IconButton>
                <IconButton label="לא, להסיר" onClick={() => decide(l, 'rejected')}><X size={13} /></IconButton>
              </>
            ) : (
              <>
                <IconButton label={copied === l.id ? 'הועתק' : 'העתקת הקישור'} onClick={() => copy(l)}>
                  {copied === l.id ? <Check size={13} /> : <Copy size={13} />}
                </IconButton>
                {isOwner && (
                  <IconButton label="הסרת הקישור" onClick={() => decide(l, 'rejected')}><X size={13} /></IconButton>
                )}
              </>
            )}
          </div>
        );
      })}

      {isOwner && (
        <button onClick={() => setAdding(true)}
          className="self-start text-[12.5px] text-white/55 hover:text-white/85">
          + {visible.length ? 'קישור נוסף לכרטיסים' : 'קישור לכרטיסים'}
        </button>
      )}

      <Modal title="קישור לכרטיסים" open={adding} onClose={() => setAdding(false)}>
        <form className="space-y-3" onSubmit={save}>
          <p className="text-sm text-muted">
            הדף שבו קונים כרטיסים להופעה הזו. המחיר והמלאי נקראים ממנו כשאפשר.
          </p>
          <Input label="כתובת" dir="ltr" required autoFocus placeholder="https://…"
            value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" className="w-full" disabled={busy || !url.trim()}>
            {busy ? 'קורא את הדף…' : 'שמירה'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="w-6 h-6 rounded-md bg-white/10 hover:bg-white/20 text-white/80 hover:text-white inline-flex items-center justify-center">
      {children}
    </button>
  );
}
