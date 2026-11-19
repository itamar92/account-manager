import React, { useState } from 'react';
import { post } from '../../api';
import { Button, Modal, fieldClass } from '../../ui';
import { InlineError, when } from './advisorShared';
import type { ShowSummary } from './ShowStrip';

/**
 * עדכון כרטיסים — tickets sold so far, typed by hand: from the club's report, the ticketing
 * system's dashboard, a phone call. It becomes the show's newest count (the card, the status
 * review and the advisor read it) and its tickets figure in the books, which cost per ticket uses.
 */
export function TicketsEditor({ show, onClose, onSaved }: {
  show: ShowSummary;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [sold, setSold] = useState(show.tickets?.sold != null ? String(show.tickets.sold) : '');
  const [capacity, setCapacity] = useState(
    show.tickets?.capacity != null ? String(show.tickets.capacity) : show.capacity ? String(show.capacity) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const n = sold === '' ? null : Number(sold);
  const cap = capacity === '' ? null : Number(capacity);
  const over = n != null && cap != null && n > cap;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (n == null || over) return;
    setBusy(true);
    setProblem('');
    try {
      await post('/band/tickets', { event_id: show.event_id, sold: n, capacity: cap, note });
      onSaved(`עודכן: ${n} כרטיסים נמכרו ל${show.label}${cap ? ` מתוך ${cap}` : ''}`);
      onClose();
    } catch (err: any) { setProblem(err.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="עדכון כרטיסים" open onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-body leading-relaxed">
          {show.label}.{' '}
          {show.tickets
            ? `הספירה האחרונה: ${show.tickets.sold ?? '—'} כרטיסים, ${show.tickets.source === 'manual' ? 'עודכנה ידנית' : 'מאתר המועדון'} ${when(show.tickets.created_at)}.`
            : 'עוד אין ספירה של כרטיסים להופעה הזו.'}
        </p>
        <div className="grid gap-3 grid-cols-2">
          <label className="block">
            <span className="block text-[13px] font-semibold text-ink-2 mb-1.5">נמכרו עד עכשיו</span>
            <input autoFocus inputMode="numeric" className={`${fieldClass} num text-base`} value={sold}
              onChange={(e) => setSold(e.target.value.replace(/\D/g, ''))} placeholder="0" />
          </label>
          <label className="block">
            <span className="block text-[13px] font-semibold text-ink-2 mb-1.5">מקומות באולם</span>
            <input inputMode="numeric" className={`${fieldClass} num text-base`} value={capacity}
              onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} placeholder="לא חובה" />
          </label>
        </div>
        {over && <p className="text-sm text-neg-ink">יותר כרטיסים ממקומות — בדקו את המספרים.</p>}
        <label className="block">
          <span className="block text-[13px] font-semibold text-ink-2 mb-1.5">מאיפה המספר (לא חובה)</span>
          <input className={fieldClass} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)}
            placeholder="למשל: דוח מהמועדון, מערכת הכרטיסים" />
        </label>
        <p className="text-xs text-faint">המספר נשמר כספירה העדכנית של ההופעה, וגם כמספר הכרטיסים בספרים — ממנו מחושבת העלות לכרטיס.</p>
        {problem && <InlineError text={problem} onDismiss={() => setProblem('')} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>ביטול</Button>
          <Button type="submit" disabled={busy || n == null || over}>{busy ? 'שומר…' : 'שמירה'}</Button>
        </div>
      </form>
    </Modal>
  );
}
