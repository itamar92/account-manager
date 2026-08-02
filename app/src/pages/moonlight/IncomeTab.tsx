import React, { useState } from 'react';
import { clsx } from 'clsx';
import { del, post, put, nis } from '../../api';
import { Button, Card, EditableCell, Empty, SelectCell, Table, YearSelect } from '../../ui';
import { MEMBERS, PAYMENT_STATUSES, PAYMENT_STATUS_STYLES, type TabProps } from './shared';

interface Props extends TabProps {
  events: any[];
  year: number | '';
  onYearChange: (year: number | '') => void;
  onNewEvent: () => void;
  onEditEvent: (event: any) => void;
}

/**
 * The income table: what each show brought in, what it cost, and how the profit is shared.
 *
 * Only the tickets, the pre-VAT income and the two paid flags are typed here. Expenses come
 * from the show's row in the expenses tab and the profit is income minus those, so both are
 * shown as results rather than fields.
 */
export function IncomeTab({
  events, year, onYearChange, isOwner, onError, reload, onNewEvent, onEditEvent,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [excludeCalendar, setExcludeCalendar] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const saveField = async (id: string, patch: Record<string, any>) => {
    try {
      await put(`/moonlight/events/${id}`, patch);
      reload();
    } catch (err: any) { onError(err.message); }
  };

  const syncCalendar = async () => {
    setSyncing(true);
    onError('');
    try {
      const d = await post('/integrations/calendar/sync');
      const r = d.result;
      if (r.created + r.updated + r.linked === 0) onError(`לא נמצאו הופעות חדשות (${r.matched} אירועים תואמים)`);
      reload();
    } catch (err: any) { onError(err.message); }
    finally { setSyncing(false); }
  };

  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  };

  const selectedEvents = events.filter((e) => selected.has(e.id));
  const selectedFromCalendar = selectedEvents.filter((e) => e.calendar_event_id).length;

  const removeEvent = async (event: any) => {
    const suffix = event.calendar_event_id
      ? ' האירוע גם יסומן כלא-הופעה כדי שלא יימשך שוב מהיומן.'
      : '';
    if (!confirm(`למחוק את «${event.venue}»?${suffix}`)) return;
    onError('');
    try {
      await del(`/moonlight/events/${event.id}?exclude_from_calendar=1`);
      setSelected(new Set());
      reload();
    } catch (err: any) { onError(err.message); }
  };

  const removeSelected = async () => {
    const suffix = excludeCalendar && selectedFromCalendar
      ? ` ולסמן ${selectedFromCalendar} אירועים שלא יימשכו שוב מהיומן?`
      : '?';
    if (!confirm(`למחוק ${selected.size} הופעות${suffix}`)) return;
    onError('');
    try {
      await post('/moonlight/events/bulk-delete', { ids: [...selected], exclude_from_calendar: excludeCalendar });
      setSelected(new Set());
      reload();
    } catch (err: any) { onError(err.message); }
  };

  return (
    <div className="space-y-3">
      {isOwner && selected.size > 0 && (
        <Card className="sticky top-2 z-30 border-indigo-500/40 bg-slate-900/95 backdrop-blur shadow-xl shadow-black/40 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">נבחרו <b>{selected.size}</b> הופעות</div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelected(new Set())}>ביטול בחירה</Button>
              <Button variant="danger" onClick={removeSelected}>מחיקה</Button>
            </div>
          </div>
          {selectedFromCalendar > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={excludeCalendar} onChange={(e) => setExcludeCalendar(e.target.checked)}
                className="accent-indigo-500" />
              מחיקה תסמן גם את {selectedFromCalendar} האירועים מהיומן כ«לא הופעה»
            </label>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-bold">הכנסות מהופעות</h2>
            <YearSelect value={year} onChange={onYearChange} />
          </div>
          {isOwner && (
            <div className="flex gap-2">
              <Button variant="ghost" disabled={syncing} onClick={syncCalendar}>
                {syncing ? 'מסנכרן…' : 'משיכה מהיומן'}
              </Button>
              <Button onClick={onNewEvent}>+ הופעה</Button>
            </div>
          )}
        </div>

        {events.length === 0 ? <Empty text="אין הופעות בטווח הזה" /> : (
          <Table headers={[
            isOwner ? (
              <input type="checkbox" aria-label="בחירת הכל" className="accent-indigo-500"
                checked={selected.size > 0 && selected.size === events.length}
                onChange={() => setSelected(selected.size === events.length ? new Set() : new Set(events.map((e) => e.id)))} />
            ) : '',
            '', 'מקום', 'תאריך', 'כרטיסים', 'לפני מע"מ', 'הוצאות', 'רווח', 'סטטוס תשלום', 'דמי הפקה', 'שולם לנגנים',
            isOwner ? '' : ' ',
          ]}>
            {events.map((e) => {
              const isOpen = expanded.has(e.id);
              return (
                <React.Fragment key={e.id}>
                  <tr className="hover:bg-slate-800/40">
                    <td className="px-3 py-2.5">
                      {isOwner && (
                        <input type="checkbox" checked={selected.has(e.id)} className="accent-indigo-500"
                          aria-label={`בחירת ${e.venue}`}
                          onChange={() => setSelected(toggleIn(selected, e.id))} />
                      )}
                    </td>
                    <td className="px-1 py-2.5">
                      <button onClick={() => setExpanded(toggleIn(expanded, e.id))}
                        title="חלוקה בין החברים"
                        className="text-slate-400 hover:text-slate-200 text-xs w-5">
                        {isOpen ? '▾' : '◂'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 font-medium">
                      <div className="flex items-center gap-1.5">
                        {e.calendar_event_id && <span title="מסונכרן מהיומן" className="text-indigo-400 text-xs">◷</span>}
                        <EditableCell value={e.venue} disabled={!isOwner}
                          onSave={(v) => saveField(e.id, { venue: v })} />
                        {/* A name typed by hand stops following the calendar; this hands it back. */}
                        {e.calendar_event_id && !!e.venue_locked && (
                          <button
                            onClick={() => isOwner && saveField(e.id, { venue_locked: 0 })}
                            disabled={!isOwner}
                            title={isOwner
                              ? 'השם נערך ידנית וסנכרון מהיומן לא ישנה אותו — לחצו כדי להחזיר אותו לשם שביומן'
                              : 'השם נערך ידנית וסנכרון מהיומן לא ישנה אותו'}
                            className="text-amber-400 text-xs disabled:cursor-default"
                          >
                            ✎
                          </button>
                        )}
                      </div>
                      {e.location && <div className="text-xs text-slate-500 truncate max-w-[16rem]">{e.location}</div>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <EditableCell type="date" value={e.date} disabled={!isOwner}
                        onSave={(v) => saveField(e.id, { date: v })} />
                    </td>
                    <td className="px-3 py-2.5">
                      <EditableCell type="number" value={e.tickets} display={e.tickets || '—'} disabled={!isOwner}
                        onSave={(v) => saveField(e.id, { tickets: v })} />
                    </td>
                    <td className="px-3 py-2.5">
                      <EditableCell type="number" value={e.amount_pre_vat} display={nis(e.amount_pre_vat)}
                        disabled={!isOwner} onSave={(v) => saveField(e.id, { amount_pre_vat: v })} />
                    </td>
                    {/* Computed from the show's row in the expenses tab. */}
                    <td className="px-3 py-2.5 text-rose-400" title="מחושב מהוצאות ההופעה">{nis(e.expenses)}</td>
                    <td className={clsx('px-3 py-2.5 font-medium', e.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}
                      title="הכנסה פחות הוצאות">
                      {nis(e.profit)}
                    </td>
                    <td className="px-3 py-2.5">
                      <SelectCell value={e.payment_status || 'waiting_report'} options={PAYMENT_STATUSES}
                        disabled={!isOwner} className={PAYMENT_STATUS_STYLES[e.payment_status]}
                        onSave={(v) => saveField(e.id, { payment_status: v })} />
                    </td>
                    <td className="px-3 py-2.5">
                      <EditableCell type="checkbox" value={e.has_commission} disabled={!isOwner}
                        onSave={(v) => saveField(e.id, { has_commission: v })} />
                    </td>
                    <td className="px-3 py-2.5">
                      <EditableCell type="checkbox" value={e.paid_to_musicians} disabled={!isOwner}
                        onSave={(v) => saveField(e.id, { paid_to_musicians: v })} />
                    </td>
                    <td className="px-3 py-2.5 text-left whitespace-nowrap">
                      {isOwner && (
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => onEditEvent({ ...e })} className="text-sm text-indigo-400 hover:underline">עריכה</button>
                          <button onClick={() => removeEvent(e)} className="text-sm text-rose-400 hover:underline">מחיקה</button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-800/20">
                      <td colSpan={12} className="px-4 py-3">
                        <DivisionPanel event={e} isOwner={isOwner} onSave={saveField} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

/**
 * The share each member takes from one show.
 *
 * The numbers follow the profit on their own; typing over one switches the show to manual and
 * freezes all four, which is the escape hatch for a gig that was split by some other agreement.
 */
function DivisionPanel({ event, isOwner, onSave }: {
  event: any;
  isOwner: boolean;
  onSave: (id: string, patch: Record<string, any>) => void;
}) {
  const manual = event.division_mode === 'manual';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">חלוקה בין החברים</span>
        <span className={clsx('text-xs px-2 py-0.5 rounded-full border',
          manual ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-slate-500/15 text-slate-400 border-slate-500/30')}>
          {manual ? 'ידני' : 'אוטומטי'}
        </span>
        <span className="text-xs text-slate-500">
          {event.has_commission
            ? 'עם דמי הפקה — 40% ראשונים לאיתמר ואמיר (20% כל אחד), והשאר בחלוקה שווה'
            : 'ללא דמי הפקה — 25% לכל אחד'}
        </span>
        {isOwner && manual && (
          <button onClick={() => onSave(event.id, { division_mode: 'auto' })}
            className="text-xs text-indigo-400 hover:underline">חזרה לחישוב אוטומטי</button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {MEMBERS.map((m) => (
          <div key={m.key} className="bg-slate-800/50 rounded-xl px-3 py-2">
            <div className="text-xs text-slate-400">{m.name}</div>
            <div className="text-base font-bold text-indigo-300">
              <EditableCell type="number" value={event[m.key]} display={nis(event[m.key])} disabled={!isOwner}
                onSave={(v) => onSave(event.id, { [m.key]: v })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
