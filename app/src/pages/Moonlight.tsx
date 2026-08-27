import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, put, nis } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Input, Modal, useUrlPeriodFilter } from '../ui';
import { ShowsTab } from './moonlight/ShowsTab';
import { GeneralExpensesTab } from './moonlight/GeneralExpensesTab';
import { SummaryTab } from './moonlight/SummaryTab';
import { SuppliersTab } from './moonlight/SuppliersTab';
import { SupplierPaymentsTab } from './moonlight/SupplierPaymentsTab';
import { AdsTab } from './moonlight/AdsTab';
import { CampaignAnalysisTab } from './moonlight/CampaignAnalysisTab';
import { DEFAULT_COMMISSION_PERCENT, divisionSplitLabel, useBandMembers } from './moonlight/shared';

/**
 * The band's areas, each its own route so the sidebar can link straight to it.
 *
 * There is no longer a tab per table. A show's income, its costs and who worked it were three
 * lists you had to hold side by side to answer one question about one gig; they are now one
 * page per show, reached from `shows`. What is left here is the work that genuinely spans
 * shows: the summary, the supplier ledger, costs belonging to no show, and the ad spend.
 *
 * `campaignAi` sits next to `ads` because it is the same money read a different way: that one
 * says what the campaigns cost, this one says whether it was worth it.
 */
type Tab = 'summary' | 'shows' | 'suppliers' | 'supplierPayments' | 'generalExpenses' | 'ads' | 'campaignAi';

const TABS: Tab[] = [
  'summary', 'shows', 'suppliers', 'supplierPayments', 'generalExpenses', 'ads', 'campaignAi',
];

/** Where the retired tabs now live, so an old bookmark still lands somewhere sensible. */
const MOVED: Record<string, Tab> = {
  income: 'shows', eventExpenses: 'shows', assignments: 'suppliers',
};

const isTab = (value: string | undefined): value is Tab => !!value && (TABS as string[]).includes(value);

export function Moonlight() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = isTab(params.tab) ? params.tab : 'summary';
  // The tables show the period you are working in; the summary keeps its own, wider range.
  // It lives in the URL so that opening a show out of a list and coming back lands on the
  // list as it was, rather than on the year the page opens on by default.
  const period = useUrlPeriodFilter();
  const [events, setEvents] = useState<any[]>([]);
  const [generalExpenses, setGeneralExpenses] = useState<any[]>([]);
  const [allEvents, setAllEvents] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [eventModal, setEventModal] = useState<any | null>(null);
  // The rate the two income fields convert between. Fetched rather than assumed, so a change
  // in Morning's settings does not leave this dialog doing last year's arithmetic.
  const [vatPercent, setVatPercent] = useState(18);
  // Who the profit is divided between, and how many ways — read rather than assumed, so the
  // dialog follows the roster the moment somebody joins or leaves.
  const { members } = useBandMembers();

  useEffect(() => {
    if (!isOwner) return;
    get('/settings').then((d) => setVatPercent(Number(d.settings.vat_percent) || 18)).catch(() => {});
  }, [isOwner]);

  const load = () => {
    const query = period.params().toString();
    const qs = query ? `?${query}` : '';
    get(`/moonlight/events${qs}`).then((d) => setEvents(d.events)).catch((e) => setError(e.message));
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

  /**
   * The two income fields are one number said twice, so filling in either fills in the other.
   * Whichever side is typed leads; the server derives the same way for an edit that touches
   * only one of them, so the pair can never drift apart.
   */
  const setIncome = (side: 'pre' | 'gross', raw: string) => {
    const value = parseFloat(raw) || 0;
    const rate = 1 + vatPercent / 100;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    setEventModal({
      ...eventModal,
      amount_pre_vat: side === 'pre' ? value : round2(value / rate),
      amount_with_vat: side === 'gross' ? value : round2(value * rate),
    });
  };

  const newEvent = () => setEventModal({
    venue: '', date: new Date().toISOString().slice(0, 10), tickets: 0,
    amount_pre_vat: 0, amount_with_vat: 0, has_commission: 1,
    commission_percent: DEFAULT_COMMISSION_PERCENT,
  });

  // `?new=1` is how the header's quick action reaches in here; the parameter is dropped again
  // so a reload does not reopen a dialog the user already closed.
  useEffect(() => {
    if (!isOwner || searchParams.get('new') !== '1') return;
    newEvent();
    searchParams.delete('new');
    setSearchParams(searchParams, { replace: true });
  }, [isOwner, searchParams]);

  // An unknown tab in the URL is a typo or a stale bookmark, not a blank page.
  useEffect(() => {
    if (params.tab === undefined || isTab(params.tab)) return;
    navigate(`/moonlight/${MOVED[params.tab] ?? 'summary'}`, { replace: true });
  }, [params.tab]);

  const tabProps = { isOwner, onError: setError, reload: load };

  return (
    <div className="space-y-5">
      {!isOwner && (
        <p className="text-sm text-muted">תצוגה בלבד — עריכה זמינה למנהל בלבד</p>
      )}
      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}

      {tab === 'summary' && <SummaryTab onError={setError} isOwner={isOwner} />}

      {tab === 'shows' && (
        <ShowsTab {...tabProps} events={events} period={period} onNewEvent={newEvent} />
      )}

      {tab === 'suppliers' && <SuppliersTab {...tabProps} />}

      {tab === 'supplierPayments' && <SupplierPaymentsTab {...tabProps} />}

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
                onChange={(e) => setIncome('pre', e.target.value)} />
              <Input label={`כולל מע"מ (${vatPercent}%)`} type="number" step="0.01" value={eventModal.amount_with_vat}
                onChange={(e) => setIncome('gross', e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={!!eventModal.has_commission} className="accent-accent"
                  onChange={(e) => setEventModal({ ...eventModal, has_commission: e.target.checked ? 1 : 0 })} />
                דמי הפקה — לאיתמר ולאמיר בחלקים שווים, והשאר בחלוקה שווה בין כולם
              </label>
              {/* The percentage only means anything with the fee on, so it appears with it. */}
              {!!eventModal.has_commission && (
                <div className="flex items-end gap-3 pr-6">
                  <Input label="אחוז דמי הפקה" type="number" step="1" min="0" max="100"
                    value={eventModal.commission_percent}
                    onChange={(e) => setEventModal({ ...eventModal, commission_percent: e.target.value })} />
                  <span className="text-xs text-faint pb-2.5 whitespace-nowrap">
                    יוצא {divisionSplitLabel(eventModal.commission_percent, members)}
                  </span>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={!!eventModal.paid_to_musicians} className="accent-accent"
                onChange={(e) => setEventModal({ ...eventModal, paid_to_musicians: e.target.checked ? 1 : 0 })} />
              שולם לנגנים
            </label>

            {/* Results, not fields: expenses come from the show's expenses row and the
                division follows the profit unless it was taken over by hand. */}
            {eventModal.id && (
              <div className="bg-soft rounded-xl p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">הוצאות (מחושב)</span>
                  <span className="text-neg">{nis(eventModal.expenses)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">רווח (מחושב)</span>
                  <span className="text-pos">{nis(eventModal.profit)}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {members.filter((m) => m.active).map((m) => (
                    <div key={m.member_key} className="text-center">
                      <div className="text-xs text-faint">{m.name}</div>
                      <div className="text-sm font-medium text-accent">
                        {nis(eventModal.shares?.[m.member_key])}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-faint">
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
