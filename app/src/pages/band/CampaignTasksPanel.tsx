import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { del, get, post, put } from '../../api';
import { Button, Combobox, fieldClass } from '../../ui';
import { eventLabel, useBandMembers } from './shared';
import { OverflowMenu, useConfirm } from './advisorShared';

interface Props {
  events: any[];
  isOwner: boolean;
  onError: (message: string) => void;
  /** Bumped by the tab when a draft's tasks were just added, so the list re-reads. */
  reloadKey: number;
  /** One show's tasks only — the show workspace. Without it, every show's. */
  eventId?: string;
  /** Told when a task was ticked or changed here, so the page's counts follow. */
  onChanged?: () => void;
}

/** Today in Israel as YYYY-MM-DD — what a due date means, wherever the browser is. */
export const israelToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

/** A due date edited in place — smaller than a form field, so a task stays one line. */
const DATE_CELL = 'bg-surface border border-line rounded-lg px-2 min-h-9 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

const ddmm = (date: string) => {
  const [, m, d] = String(date || '').split('-');
  return m && d ? `${d}/${m}` : date;
};

/**
 * משימות קמפיין — what the advisor's plans said to do later, with a date and a person.
 *
 * Each show's tasks are reminded by email to the one band member who owns that show's campaign,
 * on the due date and every two days after until somebody ticks it. Everybody can tick a task
 * done; only the owner adds, re-dates, re-assigns or deletes — and the rarer of those (a reminder
 * sent now, a delete) wait behind the row's «⋯», away from the checkbox a thumb is aiming at.
 */
export function CampaignTasksPanel({ events, isOwner, onError, reloadKey, eventId, onChanged }: Props) {
  const { members } = useBandMembers();
  const [shows, setShows] = useState<any[]>([]);
  const [mail, setMail] = useState<{ configured: boolean; from: string | null } | null>(null);
  const [doneLinks, setDoneLinks] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const { ask, dialog } = useConfirm();

  const [newEvent, setNewEvent] = useState(eventId ?? '');
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  useEffect(() => { if (eventId) setNewEvent(eventId); }, [eventId]);

  const load = () => {
    get('/band/campaign-tasks')
      .then((d) => { setShows(d.shows); setMail(d.mail); setDoneLinks(d.done_links); })
      .catch((e) => onError(e.message));
  };
  useEffect(load, [reloadKey]);

  const today = israelToday();
  const active = members.filter((m) => m.active);
  const memberName = (key: string | null) => members.find((m) => m.member_key === key)?.name ?? null;
  const upcoming = events.filter((e) => e.date >= today);
  const listed = eventId ? shows.filter((s) => s.event_id === eventId) : shows;

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    onError('');
    setNotice('');
    try {
      await fn();
      load();
      onChanged?.();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(''); }
  };

  const toggle = (task: any) => act(task.id, () => put(`/band/campaign-tasks/${task.id}`, { done: !task.done_at }));
  const redate = (task: any, due: string) => due && due !== task.due_date
    && act(task.id, () => put(`/band/campaign-tasks/${task.id}`, { due_date: due }));
  const remove = async (task: any) => {
    if (await ask('מחיקת משימה', <>למחוק את «{task.title}»? אי אפשר לשחזר אותה.</>, 'מחיקה')) {
      act(task.id, () => del(`/band/campaign-tasks/${task.id}`));
    }
  };
  /** Clears one show's list to start it again. Open tasks only, unless the done ones are on screen too. */
  const clearShow = async (show: any) => {
    const open = show.tasks.filter((t: any) => !t.done_at).length;
    const all = showDone || open === 0;
    const count = all ? show.tasks.length : open;
    if (!count) return;
    const ok = await ask('מחיקת משימות', <>למחוק {all ? 'את כל' : 'את'} {count} המשימות{all ? '' : ' הפתוחות'} של {show.label}?</>, 'מחיקה');
    if (ok) act(`clear:${show.event_id}`, () => del(`/band/campaign-tasks/show/${show.event_id}${all ? '' : '?open=1'}`));
  };
  const setOwner = (id: string, key: string) =>
    act(`owner:${id}`, () => put(`/band/campaign-tasks/owner/${id}`, { member_key: key || null }));

  const remind = async (task: any) => {
    setBusy(task.id);
    onError('');
    try {
      const d = await post(`/band/campaign-tasks/${task.id}/remind`);
      setNotice(`נשלחה תזכורת ל-${d.to}`);
      load();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(''); }
  };

  const addTask = () => act('new', async () => {
    await post('/band/campaign-tasks', { event_id: newEvent, title: newTitle, due_date: newDue });
    setNewTitle('');
    setNewDue('');
  });

  const memberOptions = [
    { value: '', label: 'ללא אחראי' },
    ...active.map((m) => ({ value: m.member_key, label: m.email ? m.name : `${m.name} (אין מייל)` })),
  ];
  const doneCount = listed.reduce((n, s) => n + s.tasks.filter((t: any) => t.done_at).length, 0);

  return (
    <div className="space-y-4">
      {mail && !mail.configured && (
        <div className="rounded-xl bg-warn-soft px-3 py-2.5 text-sm text-warn-ink leading-relaxed">
          תזכורות במייל כבויות: השרת עוד לא מחובר לתיבת מייל. המשימות נשמרות, אבל אף אחד לא יקבל עליהן מייל.
          {isOwner && <span className="block text-xs mt-0.5 opacity-90">להפעלה: להגדיר בשרת SMTP_USER ו-SMTP_PASS (סיסמת אפליקציה של Gmail).</span>}
        </div>
      )}
      {mail?.configured && !doneLinks && isOwner && (
        <p className="text-sm text-muted">כדי שבמייל יופיע כפתור «סימון כבוצע», יש להגדיר PUBLIC_BASE_URL בשרת.</p>
      )}
      {notice && <p role="status" className="text-sm text-pos-ink">{notice}</p>}

      {listed.length === 0 && (
        <p className="text-sm text-body">
          {eventId ? 'אין עדיין משימות להופעה הזו. משימות מהתוכנית או מבדיקת המצב יופיעו כאן אחרי שתוסיפו אותן.' : 'אין עדיין משימות. אפשר להוסיף אותן מתוכנית קמפיין או ידנית למטה.'}
        </p>
      )}

      <div className="space-y-5">
        {listed.map((show) => {
          const tasks = show.tasks.filter((t: any) => showDone || !t.done_at);
          const owner = members.find((m) => m.member_key === show.owner);
          return (
            <section key={show.event_id} aria-label={show.label}>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-line">
                {!eventId ? <h3 className="font-semibold text-ink">{show.label}</h3> : <span className="text-sm font-medium text-muted">אחראי על התזכורות</span>}
                <div className="flex items-center gap-1.5 text-sm">
                  {!eventId && <span className="text-muted">אחראי:</span>}
                  {isOwner ? (
                    <Combobox
                      className="min-w-40"
                      value={show.owner ?? ''}
                      onChange={(key) => setOwner(show.event_id, key)}
                      placeholder="בחרו…"
                      options={memberOptions}
                    />
                  ) : (
                    <span className="text-ink">{memberName(show.owner) ?? 'לא נבחר'}</span>
                  )}
                  {isOwner && show.tasks.length > 0 && (
                    <OverflowMenu label={`עוד פעולות על המשימות של ${show.label}`} disabled={!!busy}
                      items={[{ label: showDone || show.open === 0 ? 'מחיקת כל המשימות' : 'מחיקת המשימות הפתוחות', onSelect: () => clearShow(show), danger: true }]} />
                  )}
                </div>
              </div>
              {!show.owner && show.open > 0 && (
                <p className="text-sm text-warn-ink mt-2">לא נבחר אחראי, אז לא יישלחו תזכורות על ההופעה הזו.</p>
              )}
              {owner && !owner.email && (
                <p className="text-sm text-warn-ink mt-2">ל{owner.name} אין כתובת מייל בהגדרות הלהקה, אז התזכורות לא יגיעו.</p>
              )}

              {tasks.length === 0 ? (
                <p className="text-sm text-muted py-3">{show.tasks.length ? 'כל המשימות בוצעו.' : 'אין משימות.'}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {tasks.map((task: any) => {
                    const overdue = !task.done_at && task.due_date < today;
                    const dueToday = !task.done_at && task.due_date === today;
                    return (
                      <li key={task.id} className="flex flex-wrap sm:flex-nowrap items-start gap-x-3 gap-y-1 py-2.5">
                        {/* The label is the whole row's start, so the box is easy to hit on a phone. */}
                        <label className="flex flex-1 min-w-0 items-start gap-3 cursor-pointer min-h-10">
                          <input type="checkbox" className="accent-accent w-[18px] h-[18px] mt-0.5 shrink-0" checked={!!task.done_at}
                            disabled={busy === task.id} onChange={() => toggle(task)} />
                          <span className="min-w-0">
                            <span className={clsx('block text-[15px] leading-snug', task.done_at ? 'line-through text-muted' : 'text-ink')}>
                              {task.title}
                            </span>
                            {task.detail && !task.done_at && (
                              <span className="block text-sm text-muted leading-relaxed whitespace-pre-wrap mt-0.5">{task.detail}</span>
                            )}
                            {task.source === 'ai' && <span className="block text-xs text-muted mt-0.5">הצעה של היועץ</span>}
                          </span>
                        </label>
                        {/* Under the text on a phone, where beside it would leave the title a word wide. */}
                        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto ps-[30px] sm:ps-0">
                          {overdue && <span className="text-xs font-semibold text-neg-ink">באיחור</span>}
                          {dueToday && <span className="text-xs font-semibold text-accent-ink">היום</span>}
                          {isOwner && !task.done_at ? (
                            <input type="date" defaultValue={task.due_date} key={task.due_date}
                              aria-label={`תאריך יעד: ${task.title}`}
                              className={clsx(DATE_CELL, overdue ? 'text-neg-ink' : 'text-ink')}
                              onBlur={(e) => redate(task, e.target.value)} />
                          ) : (
                            <span className={clsx('num text-sm', overdue ? 'text-neg-ink' : 'text-muted')}>{ddmm(task.due_date)}</span>
                          )}
                          {isOwner && (
                            <OverflowMenu label={`עוד פעולות על «${task.title}»`} disabled={!!busy}
                              items={[
                                {
                                  label: task.reminders_sent ? `שליחת תזכורת עכשיו (נשלחו ${task.reminders_sent})` : 'שליחת תזכורת עכשיו',
                                  onSelect: () => remind(task), hidden: !!task.done_at,
                                },
                                { label: 'מחיקה', onSelect: () => remove(task), danger: true },
                              ]} />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {doneCount > 0 && (
        <label className="inline-flex items-center gap-2 text-sm text-muted min-h-10 cursor-pointer">
          <input type="checkbox" className="accent-accent w-4 h-4" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          להציג גם {doneCount === 1 ? 'משימה אחת שבוצעה' : `${doneCount} משימות שבוצעו`}
        </label>
      )}

      {isOwner && (
        <div className="rounded-xl bg-soft p-3">
          <div className="text-sm font-semibold text-ink-2 mb-2">משימה חדשה</div>
          <div className={clsx('grid gap-2 items-center', eventId ? 'sm:grid-cols-[2fr_auto_auto]' : 'sm:grid-cols-[1fr_2fr_auto_auto]')}>
            {!eventId && (
              <Combobox
                value={newEvent}
                onChange={setNewEvent}
                placeholder="הופעה…"
                options={[{ value: '', label: 'הופעה…' }, ...upcoming.map((e) => ({ value: e.id, label: eventLabel(e) }))]}
              />
            )}
            <input className={fieldClass} value={newTitle} placeholder="מה לעשות" aria-label="מה לעשות"
              onChange={(e) => setNewTitle(e.target.value)} />
            <input type="date" className={fieldClass} value={newDue} min={today} aria-label="תאריך יעד"
              onChange={(e) => setNewDue(e.target.value)} />
            <Button onClick={addTask} disabled={!newEvent || !newTitle.trim() || !newDue || !!busy}>הוספה</Button>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}
