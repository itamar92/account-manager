import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { get, post, put, nis } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, Input, Modal, StatCard, Table, Empty } from '../ui';

type Tab = 'summary' | 'income' | 'eventExpenses' | 'generalExpenses';

export function Moonlight() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [tab, setTab] = useState<Tab>('summary');
  const [summary, setSummary] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [eventExpenses, setEventExpenses] = useState<any[]>([]);
  const [generalExpenses, setGeneralExpenses] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [eventModal, setEventModal] = useState<any | null>(null);
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ date: new Date().toISOString().slice(0, 10), description: '', event: 'כללי', paid_by: 'קופה', amount: '' });
  const [syncing, setSyncing] = useState(false);

  const load = () => {
    get('/moonlight/summary').then((d) => setSummary(d.summary)).catch((e) => setError(e.message));
    get('/moonlight/events').then((d) => setEvents(d.events));
    get('/moonlight/event-expenses').then((d) => setEventExpenses(d.expenses));
    get('/moonlight/general-expenses').then((d) => setGeneralExpenses(d.expenses));
  };
  useEffect(load, []);

  const syncCalendar = async () => {
    setSyncing(true);
    setError('');
    try {
      const d = await post('/integrations/calendar/sync');
      const r = d.result;
      if (r.created + r.updated + r.linked === 0) setError(`לא נמצאו הופעות חדשות (${r.matched} אירועים תואמים)`);
      load();
    } catch (err: any) { setError(err.message); }
    finally { setSyncing(false); }
  };

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

  const saveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post('/moonlight/general-expenses', { ...expenseForm, amount: parseFloat(expenseForm.amount) || 0 });
      setExpenseModal(false);
      load();
    } catch (err: any) { setError(err.message); }
  };

  const tabs: [Tab, string][] = [
    ['summary', 'סיכום'],
    ['income', 'הכנסות'],
    ['eventExpenses', 'הוצאות הופעות'],
    ['generalExpenses', 'הוצאות כלליות'],
  ];

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

      {tab === 'summary' && summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="סה״כ הכנסות (לפני מע״מ)" value={nis(summary.totalRevenue)} accent="text-emerald-400" />
            <StatCard label="סה״כ הוצאות" value={nis(summary.totalExpenses)} accent="text-rose-400" />
            <StatCard label="רווח מצטבר" value={nis(summary.totalProfit)} accent="text-indigo-400" />
            <StatCard label="הופעות קרובות" value={String(summary.upcomingEvents)} />
          </div>
          <Card>
            <h2 className="font-bold mb-4">חלוקה לחברי הלהקה</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[['אמיר', summary.amir], ['איתמר', summary.itamar], ['יובל', summary.yuval], ['גיא', summary.guy]].map(([name, amount]) => (
                <div key={name as string} className="bg-slate-800/50 rounded-xl p-4 text-center">
                  <div className="text-sm text-slate-400">{name}</div>
                  <div className="text-xl font-bold text-indigo-300">{nis(amount as number)}</div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {tab === 'income' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">הכנסות מהופעות</h2>
            {isOwner && (
              <div className="flex gap-2">
                <Button variant="ghost" disabled={syncing} onClick={syncCalendar}>
                  {syncing ? 'מסנכרן…' : 'משיכה מהיומן'}
                </Button>
                <Button onClick={() => setEventModal({ venue: '', date: '', tickets: 0, amount_pre_vat: 0, amount_with_vat: 0, expenses: 0, profit: 0, amir: 0, itamar: 0, yuval: 0, guy: 0 })}>+ הופעה</Button>
              </div>
            )}
          </div>
          {events.length === 0 ? <Empty text="אין נתונים" /> : (
            <Table headers={['מקום', 'תאריך', 'כרטיסים', 'לפני מע"מ', 'הוצאות', 'רווח', 'שולם לנגנים', isOwner ? '' : ' ']}>
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2.5 font-medium">
                    <div className="flex items-center gap-1.5">
                      {e.calendar_event_id && <span title="מסונכרן מהיומן" className="text-indigo-400 text-xs">◷</span>}
                      <span>{e.venue}</span>
                    </div>
                    {e.location && <div className="text-xs text-slate-500 truncate max-w-[16rem]">{e.location}</div>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{e.date}</td>
                  <td className="px-3 py-2.5">{e.tickets || '—'}</td>
                  <td className="px-3 py-2.5">{nis(e.amount_pre_vat)}</td>
                  <td className="px-3 py-2.5 text-rose-400">{nis(e.expenses)}</td>
                  <td className={clsx('px-3 py-2.5 font-medium', e.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{nis(e.profit)}</td>
                  <td className="px-3 py-2.5">{e.paid_to_musicians ? '✓' : '—'}</td>
                  <td className="px-3 py-2.5 text-left">
                    {isOwner && <button onClick={() => setEventModal({ ...e })} className="text-sm text-indigo-400 hover:underline">עריכה</button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'eventExpenses' && (
        <Card>
          <h2 className="font-bold mb-4">הוצאות הופעות</h2>
          {eventExpenses.length === 0 ? <Empty text="אין נתונים" /> : (
            <Table headers={['הופעה', 'קמפיין', 'אקו"ם', 'שכירות אולם', 'צמידים', 'תאורן', 'סאונדמן', 'זמר/ת', 'מע"מ']}>
              {eventExpenses.map((e) => (
                <tr key={e.id} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2.5 font-medium">{e.event}</td>
                  <td className="px-3 py-2.5">{nis(e.campaign)}</td>
                  <td className="px-3 py-2.5">{nis(e.akom)}{e.akom_paid ? ' ✓' : ''}</td>
                  <td className="px-3 py-2.5">{nis(e.hall_fee)}{e.hall_fee_paid ? ' ✓' : ''}</td>
                  <td className="px-3 py-2.5">{nis(e.bracelets)}{e.bracelets_paid ? ' ✓' : ''}</td>
                  <td className="px-3 py-2.5">{nis(e.lightman)}{e.lightman_paid ? ' ✓' : ''}</td>
                  <td className="px-3 py-2.5">{nis(e.soundman)}{e.soundman_paid ? ' ✓' : ''}</td>
                  <td className="px-3 py-2.5">{nis(e.singer)}{e.singer_paid ? ' ✓' : ''}</td>
                  <td className="px-3 py-2.5">{nis(e.vat_summary)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'generalExpenses' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">הוצאות כלליות</h2>
            {isOwner && <Button onClick={() => setExpenseModal(true)}>+ הוצאה</Button>}
          </div>
          {generalExpenses.length === 0 ? <Empty text="אין נתונים" /> : (
            <Table headers={['תאריך', 'פירוט', 'שיוך', 'שולם ע"י', 'סכום', 'קופה']}>
              {generalExpenses.map((g) => (
                <tr key={g.id} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2.5 whitespace-nowrap">{g.date}</td>
                  <td className="px-3 py-2.5 font-medium">{g.description}</td>
                  <td className="px-3 py-2.5 text-slate-400">{g.event}</td>
                  <td className="px-3 py-2.5">{g.paid_by}</td>
                  <td className="px-3 py-2.5 text-rose-400">{nis(g.amount)}</td>
                  <td className="px-3 py-2.5">{g.fund ? `${nis(g.fund)}${g.fund_returned === 'כן' ? ' ✓' : ''}` : '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Modal title={eventModal?.id ? 'עריכת הופעה' : 'הופעה חדשה'} open={!!eventModal} onClose={() => setEventModal(null)}>
        {eventModal && (
          <form onSubmit={saveEvent} className="space-y-3">
            <Input label="מקום *" value={eventModal.venue} onChange={(e) => setEventModal({ ...eventModal, venue: e.target.value })} required />
            <Input label="תאריך *" type="date" value={eventModal.date} onChange={(e) => setEventModal({ ...eventModal, date: e.target.value })} required />
            <div className="grid grid-cols-2 gap-3">
              <Input label="כרטיסים" type="number" value={eventModal.tickets} onChange={(e) => setEventModal({ ...eventModal, tickets: parseInt(e.target.value) || 0 })} />
              <Input label='לפני מע"מ' type="number" step="0.01" value={eventModal.amount_pre_vat} onChange={(e) => setEventModal({ ...eventModal, amount_pre_vat: parseFloat(e.target.value) || 0 })} />
              <Input label='כולל מע"מ' type="number" step="0.01" value={eventModal.amount_with_vat} onChange={(e) => setEventModal({ ...eventModal, amount_with_vat: parseFloat(e.target.value) || 0 })} />
              <Input label="הוצאות" type="number" step="0.01" value={eventModal.expenses} onChange={(e) => setEventModal({ ...eventModal, expenses: parseFloat(e.target.value) || 0 })} />
              <Input label="רווח" type="number" step="0.01" value={eventModal.profit} onChange={(e) => setEventModal({ ...eventModal, profit: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Input label="אמיר" type="number" step="0.01" value={eventModal.amir} onChange={(e) => setEventModal({ ...eventModal, amir: parseFloat(e.target.value) || 0 })} />
              <Input label="איתמר" type="number" step="0.01" value={eventModal.itamar} onChange={(e) => setEventModal({ ...eventModal, itamar: parseFloat(e.target.value) || 0 })} />
              <Input label="יובל" type="number" step="0.01" value={eventModal.yuval} onChange={(e) => setEventModal({ ...eventModal, yuval: parseFloat(e.target.value) || 0 })} />
              <Input label="גיא" type="number" step="0.01" value={eventModal.guy} onChange={(e) => setEventModal({ ...eventModal, guy: parseFloat(e.target.value) || 0 })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={!!eventModal.paid_to_musicians} onChange={(e) => setEventModal({ ...eventModal, paid_to_musicians: e.target.checked ? 1 : 0 })} className="accent-indigo-500" />
              שולם לנגנים
            </label>
            <Button type="submit" className="w-full">שמירה</Button>
          </form>
        )}
      </Modal>

      <Modal title="הוצאה כללית חדשה" open={expenseModal} onClose={() => setExpenseModal(false)}>
        <form onSubmit={saveExpense} className="space-y-3">
          <Input label="תאריך *" type="date" value={expenseForm.date} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} required />
          <Input label="פירוט *" value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} required />
          <Input label="שיוך (הופעה / כללי)" value={expenseForm.event} onChange={(e) => setExpenseForm({ ...expenseForm, event: e.target.value })} />
          <Input label='שולם ע"י' value={expenseForm.paid_by} onChange={(e) => setExpenseForm({ ...expenseForm, paid_by: e.target.value })} />
          <Input label="סכום *" type="number" step="0.01" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} required />
          <Button type="submit" className="w-full">הוספה</Button>
        </form>
      </Modal>
    </div>
  );
}
