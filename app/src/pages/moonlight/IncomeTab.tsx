import React, { useState } from 'react';
import { clsx } from 'clsx';
import { del, post, put, nis } from '../../api';
import { Button, Card, DataTable, EditableCell, PageHeader, PeriodSelect, SearchInput, SelectCell, textMatch } from '../../ui';
import { MEMBERS, PAYMENT_STATUSES, PAYMENT_STATUS_STYLES, divisionSplitLabel, type PeriodTabProps } from './shared';

interface Props extends PeriodTabProps {
  events: any[];
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
  events, period, isOwner, onError, reload, onNewEvent, onEditEvent,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [excludeCalendar, setExcludeCalendar] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

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

  const visible = events.filter((e) =>
    textMatch(search, e.venue, e.location) &&
    (!statusFilter || (e.payment_status || 'waiting_report') === statusFilter));

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
        <Card className="sticky top-2 z-30 border-accent/25 bg-surface backdrop-blur shadow-xl shadow-black/40 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">נבחרו <b>{selected.size}</b> הופעות</div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelected(new Set())}>ביטול בחירה</Button>
              <Button variant="danger" onClick={removeSelected}>מחיקה</Button>
            </div>
          </div>
          {selectedFromCalendar > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={excludeCalendar} onChange={(e) => setExcludeCalendar(e.target.checked)}
                className="accent-accent" />
              מחיקה תסמן גם את {selectedFromCalendar} האירועים מהיומן כ«לא הופעה»
            </label>
          )}
        </Card>
      )}

      <PageHeader
        title="הכנסות מהופעות"
        actions={isOwner && (
          <>
            <Button variant="ghost" disabled={syncing} onClick={syncCalendar}>
              {syncing ? 'מסנכרן…' : 'משיכה מהיומן'}
            </Button>
            <Button onClick={onNewEvent}>+ הופעה</Button>
          </>
        )}
      />

      <div className="flex flex-wrap gap-2">
        <PeriodSelect year={period.year} month={period.month}
          onYearChange={period.setYear} onMonthChange={period.setMonth} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink-2 font-medium focus:outline-none focus:border-accent">
          <option value="">כל סטטוסי התשלום</option>
          {PAYMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי מקום…" className="flex-1 min-w-[10rem] sm:max-w-xs" />
      </div>

      <div>
          <DataTable
            empty="אין הופעות בטווח הזה"
            rows={visible}
            rowKey={(e) => e.id}
            rowClassName={() => 'hover:bg-soft'}
            isExpanded={(e) => expanded.has(e.id)}
            renderExpanded={(e) => <DivisionPanel event={e} isOwner={isOwner} onSave={saveField} />}
            columns={[
              isOwner && {
                key: 'select',
                mobile: 'lead' as const,
                header: (
                  <input type="checkbox" aria-label="בחירת הכל" className="accent-accent"
                    checked={selected.size > 0 && selected.size === visible.length}
                    onChange={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map((e) => e.id)))} />
                ),
                render: (e: any) => (
                  <input type="checkbox" checked={selected.has(e.id)} className="accent-accent"
                    aria-label={`בחירת ${e.venue}`}
                    onChange={() => setSelected(toggleIn(selected, e.id))} />
                ),
              },
              {
                key: 'expand', header: '', label: '', mobile: 'actions', className: 'px-1',
                render: (e) => (
                  <button onClick={() => setExpanded(toggleIn(expanded, e.id))}
                    title="חלוקה בין החברים"
                    className="text-muted hover:text-ink text-xs md:w-5">
                    <span className="md:hidden ml-1">חלוקה בין החברים</span>
                    {expanded.has(e.id) ? '▾' : '◂'}
                  </button>
                ),
              },
              {
                key: 'venue', header: 'מקום', mobile: 'title', sortValue: (e) => e.venue, className: 'font-medium',
                render: (e) => (
                  <>
                    <div className="flex items-center gap-1.5">
                      {e.calendar_event_id && <span title="מסונכרן מהיומן" className="text-accent text-xs">◷</span>}
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
                          className="text-warn text-xs disabled:cursor-default"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                    {e.location && <div className="text-xs text-faint truncate max-w-[16rem] font-normal">{e.location}</div>}
                  </>
                ),
              },
              {
                key: 'date', header: 'תאריך', sortValue: (e) => e.date, className: 'whitespace-nowrap',
                render: (e) => (
                  <EditableCell type="date" value={e.date} disabled={!isOwner}
                    onSave={(v) => saveField(e.id, { date: v })} />
                ),
              },
              {
                key: 'tickets', header: 'כרטיסים', sortValue: (e) => Number(e.tickets) || 0,
                render: (e) => (
                  <EditableCell type="number" value={e.tickets} display={e.tickets || '—'} disabled={!isOwner}
                    onSave={(v) => saveField(e.id, { tickets: v })} />
                ),
              },
              {
                key: 'amount', header: 'לפני מע"מ', sortValue: (e) => Number(e.amount_pre_vat) || 0,
                render: (e) => (
                  <EditableCell type="number" value={e.amount_pre_vat} display={nis(e.amount_pre_vat)}
                    disabled={!isOwner} onSave={(v) => saveField(e.id, { amount_pre_vat: v })} />
                ),
              },
              {
                // Computed from the show's row in the expenses tab.
                key: 'expenses', header: 'הוצאות', sortValue: (e) => Number(e.expenses) || 0, className: 'text-neg',
                render: (e) => <span className="text-neg" title="מחושב מהוצאות ההופעה">{nis(e.expenses)}</span>,
              },
              {
                key: 'profit', header: 'רווח', sortValue: (e) => Number(e.profit) || 0, className: 'font-medium',
                render: (e) => (
                  <span className={clsx('font-medium', e.profit >= 0 ? 'text-pos' : 'text-neg')}
                    title="הכנסה פחות הוצאות">
                    {nis(e.profit)}
                  </span>
                ),
              },
              {
                key: 'status', header: 'סטטוס תשלום', sortValue: (e) => e.payment_status || 'waiting_report',
                render: (e) => (
                  <SelectCell value={e.payment_status || 'waiting_report'} options={PAYMENT_STATUSES}
                    disabled={!isOwner} className={PAYMENT_STATUS_STYLES[e.payment_status]}
                    onSave={(v) => saveField(e.id, { payment_status: v })} />
                ),
              },
              {
                // The tick and what it is worth, together: a fee with no percentage beside it
                // says nothing about how the show was actually split.
                key: 'commission', header: 'דמי הפקה', label: 'דמי הפקה',
                render: (e) => (
                  <div className="flex items-center gap-2">
                    <EditableCell type="checkbox" value={e.has_commission} disabled={!isOwner}
                      onSave={(v) => saveField(e.id, { has_commission: v })} />
                    {e.has_commission ? (
                      <span className="text-xs text-muted whitespace-nowrap">
                        <EditableCell
                          type="number"
                          value={e.commission_percent}
                          display={`${e.commission_percent}%`}
                          disabled={!isOwner}
                          onSave={(v) => saveField(e.id, { commission_percent: v })}
                        />
                      </span>
                    ) : <span className="text-xs text-ghost">—</span>}
                  </div>
                ),
              },
              {
                key: 'paid', header: 'שולם לנגנים',
                render: (e) => (
                  <EditableCell type="checkbox" value={e.paid_to_musicians} disabled={!isOwner}
                    onSave={(v) => saveField(e.id, { paid_to_musicians: v })} />
                ),
              },
              isOwner && {
                key: 'actions', mobile: 'actions' as const, className: 'text-left whitespace-nowrap',
                render: (e: any) => (
                  <div className="flex gap-3 md:gap-2 justify-end">
                    <button onClick={() => onEditEvent({ ...e })} className="text-sm text-accent hover:underline">עריכה</button>
                    <button onClick={() => removeEvent(e)} className="text-sm text-neg hover:underline">מחיקה</button>
                  </div>
                ),
              },
            ]}
          />
      </div>
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
          manual ? 'bg-warn-soft text-warn border-warn/25' : 'bg-soft text-muted border-line')}>
          {manual ? 'ידני' : 'אוטומטי'}
        </span>
        {/* Spelled out with this show's own percentage, so the shares below can be checked
            against the rule that produced them. */}
        <span className="text-xs text-faint">
          {event.has_commission
            ? `עם דמי הפקה — ${event.commission_percent}% מהרווח לאיתמר ולאמיר בחלקים שווים `
              + `(${divisionSplitLabel(event.commission_percent)}), והשאר בחלוקה שווה בין כולם`
            : 'ללא דמי הפקה — 25% לכל אחד'}
        </span>
        {isOwner && manual && (
          <button onClick={() => onSave(event.id, { division_mode: 'auto' })}
            className="text-xs text-accent hover:underline">חזרה לחישוב אוטומטי</button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {MEMBERS.map((m) => (
          <div key={m.key} className="bg-soft rounded-xl px-3 py-2">
            <div className="text-xs text-muted">{m.name}</div>
            <div className="text-base font-bold text-accent">
              <EditableCell type="number" value={event[m.key]} display={nis(event[m.key])} disabled={!isOwner}
                onSave={(v) => onSave(event.id, { [m.key]: v })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
