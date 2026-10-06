import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { del, get, post, put } from '../../api';
import { Button, Card, Combobox, Empty, fieldClass } from '../../ui';
import { eventLabel, useBandMembers } from './shared';

interface Props {
  events: any[];
  isOwner: boolean;
  onError: (message: string) => void;
  /** Bumped by the tab when a draft's tasks were just added, so the list re-reads. */
  reloadKey: number;
}

/** Today in Israel as YYYY-MM-DD — what a due date means, wherever the browser is. */
export const israelToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

/** A due date edited in place — smaller than a form field, so a task stays one line. */
const DATE_CELL = 'bg-surface border border-line rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-accent';

const ddmm = (date: string) => {
  const [, m, d] = String(date || '').split('-');
  return m && d ? `${d}/${m}` : date;
};

/**
 * משימות קמפיין — what the advisor's plans said to do later, with a date and a person.
 *
 * Each show's tasks are reminded by email to the one band member who owns that show's campaign,
 * on the due date and every two days after until somebody ticks it. Everybody can tick a task
 * done; only the owner adds, re-dates, re-assigns or deletes.
 */
export function CampaignTasksPanel({ events, isOwner, onError, reloadKey }: Props) {
  const { members } = useBandMembers();
  const [shows, setShows] = useState<any[]>([]);
  const [mail, setMail] = useState<{ configured: boolean; from: string | null } | null>(null);
  const [doneLinks, setDoneLinks] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState('');

  const [newEvent, setNewEvent] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');

  const load = () => {
    get('/moonlight/campaign-tasks')
      .then((d) => { setShows(d.shows); setMail(d.mail); setDoneLinks(d.done_links); })
      .catch((e) => onError(e.message));
  };
  useEffect(load, [reloadKey]);

  const today = israelToday();
  const active = members.filter((m) => m.active);
  const memberName = (key: string | null) => members.find((m) => m.member_key === key)?.name ?? null;
  const upcoming = events.filter((e) => e.date >= today);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    onError('');
    try {
      await fn();
      load();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(''); }
  };

  const toggle = (task: any) => act(task.id, () => put(`/moonlight/campaign-tasks/${task.id}`, { done: !task.done_at }));
  const redate = (task: any, due: string) => due && due !== task.due_date
    && act(task.id, () => put(`/moonlight/campaign-tasks/${task.id}`, { due_date: due }));
  const remove = (task: any) => confirm(`למחוק את «${task.title}»?`)
    && act(task.id, () => del(`/moonlight/campaign-tasks/${task.id}`));
  const setOwner = (eventId: string, key: string) =>
    act(`owner:${eventId}`, () => put(`/moonlight/campaign-tasks/owner/${eventId}`, { member_key: key || null }));

  const remind = async (task: any) => {
    setBusy(task.id);
    onError('');
    try {
      const d = await post(`/moonlight/campaign-tasks/${task.id}/remind`);
      alert(`נשלחה תזכורת ל-${d.to}`);
      load();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(''); }
  };

  const addTask = () => act('new', async () => {
    await post('/moonlight/campaign-tasks', { event_id: newEvent, title: newTitle, due_date: newDue });
    setNewTitle('');
    setNewDue('');
  });

  const memberOptions = [
    { value: '', label: 'ללא אחראי' },
    ...active.map((m) => ({ value: m.member_key, label: m.email ? m.name : `${m.name} (אין מייל)` })),
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="ser text-lg">משימות קמפיין</h2>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className="accent-accent" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          להציג משימות שבוצעו
        </label>
      </div>
      <p className="text-xs text-faint mb-3">
        לכל הופעה יש אחראי אחד מהלהקה. ביום היעד, מ-9:00, הוא מקבל מייל — ושוב כל יומיים עד שהמשימה מסומנת כבוצעה.
      </p>

      {mail && !mail.configured && (
        <p className="text-xs text-warn bg-warn-soft border border-warn/25 rounded-lg px-3 py-2 mb-3">
          שליחת מיילים כבויה — יש להגדיר SMTP_USER ו-SMTP_PASS (סיסמת אפליקציה של Gmail) בקובץ ה-.env של השרת.
          המשימות נשמרות בכל מקרה.
        </p>
      )}
      {mail?.configured && !doneLinks && isOwner && (
        <p className="text-xs text-faint mb-3">
          כדי שבמייל יופיע כפתור «סימון כבוצע», יש להגדיר PUBLIC_BASE_URL בשרת.
        </p>
      )}

      {shows.length === 0 && <Empty text="אין עדיין משימות. אפשר להוסיף אותן מתוכנית קמפיין או ידנית למטה." />}

      <div className="space-y-3">
        {shows.map((show) => {
          const tasks = show.tasks.filter((t: any) => showDone || !t.done_at);
          const owner = members.find((m) => m.member_key === show.owner);
          return (
            <div key={show.event_id} className="bg-soft border border-line rounded-xl p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="font-medium">{show.label}</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-faint">אחראי:</span>
                  {isOwner ? (
                    <Combobox
                      className="min-w-36"
                      value={show.owner ?? ''}
                      onChange={(key) => setOwner(show.event_id, key)}
                      placeholder="בחרו…"
                      options={memberOptions}
                    />
                  ) : (
                    <span>{memberName(show.owner) ?? '—'}</span>
                  )}
                </div>
              </div>
              {!show.owner && show.open > 0 && (
                <p className="text-xs text-warn mb-2">לא נבחר אחראי — התזכורות להופעה הזו לא יישלחו</p>
              )}
              {owner && !owner.email && (
                <p className="text-xs text-warn mb-2">ל{owner.name} אין כתובת מייל בהגדרות הלהקה — התזכורות לא יישלחו</p>
              )}

              {tasks.length === 0 ? (
                <p className="text-xs text-faint">{show.tasks.length ? 'כל המשימות בוצעו ✓' : 'אין משימות'}</p>
              ) : (
                <ul className="space-y-1.5">
                  {tasks.map((task: any) => {
                    const overdue = !task.done_at && task.due_date < today;
                    const dueToday = !task.done_at && task.due_date === today;
                    return (
                      <li key={task.id} className="flex flex-wrap sm:flex-nowrap items-start gap-x-2 gap-y-1 text-sm">
                        <input type="checkbox" className="accent-accent mt-1 shrink-0" checked={!!task.done_at}
                          disabled={busy === task.id} onChange={() => toggle(task)} />
                        <div className="min-w-0 flex-1">
                          <div className={clsx(task.done_at && 'line-through text-faint')}>
                            {task.title}
                            {task.source === 'ai' && <span className="text-[11px] text-faint"> · מהיועץ</span>}
                          </div>
                          {task.detail && !task.done_at && (
                            <div className="text-xs text-muted leading-relaxed whitespace-pre-wrap">{task.detail}</div>
                          )}
                        </div>
                        {/* Under the text on a phone, where beside it would leave the title a word wide. */}
                        <div className="flex items-center gap-2 shrink-0 text-xs w-full sm:w-auto ps-6 sm:ps-0">
                          {isOwner && !task.done_at ? (
                            <input type="date" defaultValue={task.due_date} key={task.due_date}
                              className={clsx(DATE_CELL, overdue ? 'text-neg' : 'text-ink')}
                              onBlur={(e) => redate(task, e.target.value)} />
                          ) : (
                            <span className={clsx(overdue ? 'text-neg' : 'text-faint')}>{ddmm(task.due_date)}</span>
                          )}
                          {overdue && <span className="text-neg">באיחור</span>}
                          {dueToday && <span className="text-accent">היום</span>}
                          {isOwner && !task.done_at && (
                            <button onClick={() => remind(task)} disabled={!!busy}
                              title={task.reminders_sent ? `נשלחו ${task.reminders_sent} תזכורות` : 'שליחת תזכורת עכשיו'}
                              className="text-accent hover:underline disabled:opacity-50">
                              תזכורת{task.reminders_sent ? ` (${task.reminders_sent})` : ''}
                            </button>
                          )}
                          {isOwner && (
                            <button onClick={() => remove(task)} disabled={!!busy}
                              className="text-neg hover:underline disabled:opacity-50">מחיקה</button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {isOwner && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="text-xs text-faint mb-2">משימה חדשה</div>
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto] items-center">
            <Combobox
              value={newEvent}
              onChange={setNewEvent}
              placeholder="הופעה…"
              options={[{ value: '', label: 'הופעה…' }, ...upcoming.map((e) => ({ value: e.id, label: eventLabel(e) }))]}
            />
            <input className={fieldClass} value={newTitle} placeholder="מה לעשות"
              onChange={(e) => setNewTitle(e.target.value)} />
            <input type="date" className={fieldClass} value={newDue} min={today}
              onChange={(e) => setNewDue(e.target.value)} />
            <Button onClick={addTask} disabled={!newEvent || !newTitle.trim() || !newDue || !!busy}>הוספה</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
