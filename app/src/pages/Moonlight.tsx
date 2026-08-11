import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { get, post, put, nis } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Input, Modal, usePeriodFilter } from '../ui';
import { IncomeTab } from './moonlight/IncomeTab';
import { EventExpensesTab } from './moonlight/EventExpensesTab';
import { GeneralExpensesTab } from './moonlight/GeneralExpensesTab';
import { SummaryTab } from './moonlight/SummaryTab';
import { AssignmentsTab } from './moonlight/AssignmentsTab';
import { AdsTab } from './moonlight/AdsTab';
import { CampaignAnalysisTab } from './moonlight/CampaignAnalysisTab';
import { DEFAULT_COMMISSION_PERCENT, MEMBERS, divisionSplitLabel } from './moonlight/shared';

type Tab = 'summary' | 'income' | 'assignments' | 'eventExpenses' | 'generalExpenses' | 'ads' | 'campaignAi';

const tabs: [Tab, string][] = [
  ['summary', 'סיכום'],
  ['income', 'הכנסות'],
  ['assignments', 'שיבוצים'],
  ['eventExpenses', 'הוצאות הופעות'],
  ['generalExpenses', 'הוצאות כלליות'],
  ['ads', 'פרסום'],
  // Next to פרסום, because it is the same money read a different way: that tab says what the
  // campaigns cost, this one says whether it was worth it.
  ['campaignAi', 'יועץ קמפיינים'],
];

export function Moonlight() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [tab, setTab] = useState<Tab>('summary');
  // The tables show the period you are working in; the summary keeps its own, wider range.
  const period = usePeriodFilter();
  const [events, setEvents] = useState<any[]>([]);
  const [eventExpenses, setEventExpenses] = useState<any[]>([]);
  const [generalExpenses, setGeneralExpenses] = useState<any[]>([]);
  const [allEvents, setAllEvents] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [eventModal, setEventModal] = useState<any | null>(null);

  const load = () => {
    const query = period.params().toString();
    const qs = query ? `?${query}` : '';
    get(`/moonlight/events${qs}`).then((d) => setEvents(d.events)).catch((e) => setError(e.message));
    get(`/moonlight/event-expenses${qs}`).then((d) => setEventExpenses(d.expenses)).catch((e) => setError(e.message));
    get(`/moonlight/general-expenses${qs}`).then((d) => setGeneralExpenses(d.expenses)).catch((e) => setError(e.message));
    // Unfiltered, so an expense can still be assigned to a show from another year.
    get('/moonlight/events').then((d) => setAllEvents(d.events)).catch(() => {});
  };
  useEffect(load, [period.year, period.month]);

  const saveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const b = eventModal;
    try {
      if (b.id) await put(`/moonlight/events/${b.id}`, b);
      else await post('/moonlight/events', b);
      setEventModal(null);
      load();
    } catch (err: any) { setError(err.message); }
  };

  const tabProps = { isOwner, onError: setError, reload: load };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🌙 Moonlight Finance</h1>
          {!isOwner && <p className="text-sm text-slate-500">תצוגה בלבד — עריכה זמינה למנהל בלבד</p>}
        </div>
      </div>
      {error && <div className="text-sm text-rose-400">{error}</div>}

      <div className="flex gap-1 overflow-x-auto bg-slate-900 border border-slate-800 rounded-2xl p-1 w-fit max-w-full">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx('px-4 py-2 rounded-xl text-sm whitespace-nowrap transition-colors',
              tab === key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' && <SummaryTab onError={setError} />}

      {tab === 'income' && (
        <IncomeTab
          {...tabProps}
          events={events}
          period={period}
          onNewEvent={() => setEventModal({ venue: '', date: new Date().toISOString().slice(0, 10), tickets: 0, amount_pre_vat: 0, amount_with_vat: 0, has_commission: 1, commission_percent: DEFAULT_COMMISSION_PERCENT })}
          onEditEvent={setEventModal}
        />
      )}

      {tab === 'assignments' && (
        <AssignmentsTab {...tabProps} period={period} />
      )}

      {tab === 'eventExpenses' && (
        <EventExpensesTab {...tabProps} expenses={eventExpenses} events={allEvents} period={period} />
      )}

      {tab === 'generalExpenses' && (
        <GeneralExpensesTab {...tabProps} expenses={generalExpenses} events={allEvents} period={period} />
      )}

      {tab === 'ads' && (
        <AdsTab {...tabProps} events={allEvents} period={period} />
      )}

      {tab === 'campaignAi' && (
        <CampaignAnalysisTab {...tabProps} events={allEvents} period={period} />
      )}

      <Modal title={eventModal?.id ? 'עריכת הופעה' : 'הופעה חדשה'} open={!!eventModal} onClose={() => setEventModal(null)}>
        {eventModal && (
          <form onSubmit={saveEvent} className="space-y-3">
            <Input label="מקום *" value={eventModal.venue} required
              onChange={(e) => setEventModal({ ...eventModal, venue: e.target.value })} />
            <Input label="תאריך *" type="date" value={eventModal.date} required
              onChange={(e) => setEventModal({ ...eventModal, date: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="כרטיסים" type="number" value={eventModal.tickets}
                onChange={(e) => setEventModal({ ...eventModal, tickets: parseInt(e.target.value) || 0 })} />
              <Input label='לפני מע"מ' type="number" step="0.01" value={eventModal.amount_pre_vat}
                onChange={(e) => setEventModal({ ...eventModal, amount_pre_vat: parseFloat(e.target.value) || 0 })} />
              <Input label='כולל מע"מ' type="number" step="0.01" value={eventModal.amount_with_vat}
                onChange={(e) => setEventModal({ ...eventModal, amount_with_vat: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={!!eventModal.has_commission} className="accent-indigo-500"
                  onChange={(e) => setEventModal({ ...eventModal, has_commission: e.target.checked ? 1 : 0 })} />
                דמי הפקה — לאיתמר ולאמיר בחלקים שווים, והשאר בחלוקה שווה בין כולם
              </label>
              {/* The percentage only means anything with the fee on, so it appears with it. */}
              {!!eventModal.has_commission && (
                <div className="flex items-end gap-3 pr-6">
                  <Input label="אחוז דמי הפקה" type="number" step="1" min="0" max="100"
                    value={eventModal.commission_percent}
                    onChange={(e) => setEventModal({ ...eventModal, commission_percent: e.target.value })} />
                  <span className="text-xs text-slate-500 pb-2.5 whitespace-nowrap">
                    יוצא {divisionSplitLabel(eventModal.commission_percent)}
                  </span>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={!!eventModal.paid_to_musicians} className="accent-indigo-500"
                onChange={(e) => setEventModal({ ...eventModal, paid_to_musicians: e.target.checked ? 1 : 0 })} />
              שולם לנגנים
            </label>

            {/* Results, not fields: expenses come from the show's expenses row and the
                division follows the profit unless it was taken over by hand. */}
            {eventModal.id && (
              <div className="bg-slate-800/40 rounded-xl p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">הוצאות (מחושב)</span>
                  <span className="text-rose-400">{nis(eventModal.expenses)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">רווח (מחושב)</span>
                  <span className="text-emerald-400">{nis(eventModal.profit)}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {MEMBERS.map((m) => (
                    <div key={m.key} className="text-center">
                      <div className="text-xs text-slate-500">{m.name}</div>
                      <div className="text-sm font-medium text-indigo-300">{nis(eventModal[m.key])}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  לעריכת ההוצאות עברו ללשונית «הוצאות הופעות»; לעריכת החלוקה פתחו את השורה בטבלת ההכנסות.
                </p>
              </div>
            )}
            <Button type="submit" className="w-full">שמירה</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
