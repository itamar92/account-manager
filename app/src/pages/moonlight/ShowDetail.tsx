import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { del, get, post, put, nis } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Empty, Input, Modal, MoneyInput, SelectCell, fieldClass } from '../../ui';
import {
  FUND_TRANSFERRED, PAYMENT_STATUSES, RETURN_PARAM, divisionSplitLabel, moneyReceived, roleName,
  showReturn, useBandMembers,
} from './shared';
import { fetchTransferRates, splitTransfer } from './transfer';

/**
 * Every cost line of a show, in the order the page lists them.
 *
 * `role` marks the four that somebody is staffed on — those get a supplier picker beside the
 * amount, because who did it and what they cost are one fact, not two. `settles` marks the
 * lines paid separately after the show; the rest are settled the moment they are entered.
 */
const COST_LINES: Array<{ key: string; label: string; role?: string; settles?: boolean }> = [
  { key: 'lightman', label: 'תאורן', role: 'lightman', settles: true },
  { key: 'soundman', label: 'סאונדמן', role: 'soundman', settles: true },
  { key: 'singer', label: 'זמר/ת', role: 'singer', settles: true },
  { key: 'sound_company', label: 'חברת הגברה', role: 'sound_company', settles: true },
  { key: 'hall_fee', label: 'שכירות אולם', settles: true },
  { key: 'bracelets', label: 'צמידים', settles: true },
  { key: 'akom', label: 'אקו"ם', settles: true },
  { key: 'campaign', label: 'קמפיין' },
  { key: 'refreshments', label: 'כיבוד' },
  { key: 'design', label: 'עיצוב' },
  { key: 'other', label: 'אחר' },
  { key: 'expense_amount', label: 'הוצאה נוספת' },
];

/**
 * The stations a show's money passes through, in order.
 *
 * «הכסף בקופה» is its own station because it is its own event: the venue pays into the private
 * account, and only a later transfer moves the band's part of it into the band's account.
 */
const TRACK = [
  'ההופעה התקיימה', 'חשבונית נשלחה', 'התקבל תשלום', 'הכסף בקופה', 'תשלום לספקים', 'חלוקה לחברים',
];

/**
 * One show, whole: what it earned, what it cost, who worked it, and how the profit divides.
 *
 * This page replaces the three tables the same show used to be spread across. Nothing here is
 * new arithmetic — the server still derives expenses, profit and the member shares exactly as
 * before — but a change to any of it is made where its consequence is visible, which is what
 * the old layout could not do.
 */
export function ShowDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  // The list this show was opened from, filters and all. Absent — a bookmark, a link somebody
  // was sent — the shows list is the sensible place to be put down.
  const back = showReturn(searchParams.get(RETURN_PARAM));
  const isOwner = user?.role === 'owner';

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  // Empty while the rates are still on their way — the field is filled in from the same
  // arithmetic the calculator runs, so the figure offered here is the one it would give.
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferDraft, setTransferDraft] = useState('');
  const { members } = useBandMembers();

  const load = () =>
    get(`/moonlight/events/${id}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { setData(null); load(); }, [id]);

  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="טוען…" />;

  const { event, expenses, assignments, suppliers, outstanding, missing } = data;
  const income = Number(event.amount_pre_vat) || 0;
  const gross = Number(event.amount_with_vat) || 0;
  const spent = Number(event.expenses) || 0;
  const profit = Number(event.profit) || 0;
  // The band as it is now, plus anybody who has a share of *this* show and has since left —
  // their money is still on the row, so hiding them would make it uneditable and unexplained.
  const divisionRows = [
    ...members.filter((m) => m.active),
    ...members.filter((m) => !m.active && Number(event.shares?.[m.member_key])),
  ];
  const sold = Number(event.tickets) || 0;
  const capacity = Number(event.capacity) || 0;
  const manual = event.division_mode === 'manual';
  // Hand-entered shares do not follow the profit, so they can quietly stop adding up to it —
  // typically after a cost was corrected later. Saying so is the whole reason to show it.
  const sharesTotal = Object.values(event.shares ?? {})
    .reduce((sum: number, v) => sum + (Number(v) || 0), 0);
  const shareGap = manual && Math.abs(sharesTotal - profit) > 1;

  const saveEvent = async (patch: Record<string, any>) => {
    setError('');
    try {
      await put(`/moonlight/events/${event.id}`, patch);
      await load();
    } catch (err: any) { setError(err.message); }
  };

  const saveCost = async (patch: Record<string, any>) => {
    setError('');
    try {
      await put(`/moonlight/event-expenses/${expenses.id}`, patch);
      await load();
    } catch (err: any) { setError(err.message); }
  };

  const assign = async (role: string, value: string) => {
    setError('');
    try {
      await put(`/moonlight/events/${event.id}/assignments`, {
        role,
        supplier_id: value === '' || value === 'none' ? null : value,
        not_needed: value === 'none',
      });
      await load();
    } catch (err: any) { setError(err.message); }
  };

  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError('');
    try { await fn(); await load(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };

  /**
   * What to transfer into the band's account, worked out rather than asked for: the show's
   * income as it landed, less the מע"מ and the tax provision that have to stay behind. It is
   * offered as a draft rather than imposed — the sum that actually moved is whatever the bank
   * says moved, and that is what the balance has to follow.
   */
  const openTransfer = async () => {
    setTransferDraft('');
    setTransferOpen(true);
    const { vatPercent, taxRate } = await fetchTransferRates();
    const vat = Math.max(0, vatPercent) / 100;
    const split = splitTransfer({
      // A show whose gross was never typed still has its income, so it is grossed up rather
      // than read as nothing to transfer.
      received: gross || income * (1 + vat),
      lines: [{ amount: spent, deductible: true }],
      vat,
      taxRate: Math.max(0, taxRate) / 100,
    });
    setTransferDraft(String(split.transfer));
  };

  const removeShow = async () => {
    const suffix = event.calendar_event_id
      ? ' האירוע גם יסומן כלא-הופעה כדי שלא יימשך שוב מהיומן.'
      : '';
    if (!confirm(`למחוק את «${event.venue}»?${suffix}`)) return;
    try {
      await del(`/moonlight/events/${event.id}?exclude_from_calendar=1`);
      navigate(back.to);
    } catch (err: any) { setError(err.message); }
  };

  // Where the money has got to. Each station is either behind us or ahead of us; the first one
  // is simply whether the date has passed.
  const done = [
    event.date <= new Date().toISOString().slice(0, 10),
    event.payment_status === 'invoice_sent' || moneyReceived(event.payment_status),
    moneyReceived(event.payment_status),
    event.payment_status === FUND_TRANSFERRED,
    spent > 0 && outstanding === 0,
    !!event.paid_to_musicians,
  ];

  const vatNote = gross > income ? `מע"מ ${nis(gross - income)}` : 'טרם הוזן סכום כולל מע"מ';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[13.5px] text-muted">
        <Link to={back.to} className="hover:text-ink">{back.label}</Link>
        <span>›</span>
        <span className="text-ink font-semibold">{event.venue}</span>
      </div>

      {error && <div className="text-sm text-neg bg-neg-soft rounded-xl px-4 py-2.5">{error}</div>}

      {/* ---- the headline: everything the show is worth, in one slab ---- */}
      <div className="bg-ink text-white rounded-2xl p-5 md:p-6 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="ser text-2xl md:text-[29px]">{event.venue}</h1>
            {event.calendar_event_id && (
              <span className="text-xs font-semibold bg-white/15 text-white/85 rounded-full px-2.5 py-1">מהיומן</span>
            )}
          </div>
          <div className="num text-sm text-white/60 mt-1.5">
            {event.date}{event.location ? ` · ${event.location}` : ''}
          </div>
          {missing.length > 0 && (
            <div className="text-[13px] text-[#E2A63A] mt-2">
              חסר שיבוץ: {missing.map(roleName).join(', ')}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-x-7 gap-y-4 text-start">
          <HeroField label="כרטיסים">
            <div className="flex items-center gap-2">
              {isOwner && (
                <button
                  onClick={() => saveEvent({ tickets: Math.max(0, sold - 10) })}
                  className="w-6 h-6 rounded-lg bg-white/15 text-white font-bold leading-none">−</button>
              )}
              <HeroNumber
                value={sold}
                disabled={!isOwner}
                onSave={(v) => saveEvent({ tickets: v })}
                width="w-16"
              />
              {isOwner && (
                <button
                  onClick={() => saveEvent({ tickets: sold + 10 })}
                  className="w-6 h-6 rounded-lg bg-white/15 text-white font-bold leading-none">+</button>
              )}
            </div>
            <div className="num text-xs text-white/55 mt-1">
              {capacity ? `מתוך ${capacity.toLocaleString('he-IL')} · ${Math.round((sold / capacity) * 100)}% תפוסה` : 'לא הוגדרה קיבולת'}
            </div>
          </HeroField>

          <HeroField label='הכנסה · לפני מע"מ'>
            <HeroNumber value={income} disabled={!isOwner} onSave={(v) => saveEvent({ amount_pre_vat: v })} />
          </HeroField>

          <HeroField label='הכנסה · כולל מע"מ'>
            <HeroNumber value={gross} disabled={!isOwner} onSave={(v) => saveEvent({ amount_with_vat: v })} />
            <div className="num text-xs text-white/55 mt-1">{vatNote}</div>
          </HeroField>

          <HeroField label="הוצאות">
            <div className="num text-[21px] font-extrabold tracking-[-0.03em] text-[#EE9C8C]">{nis(spent)}</div>
            {outstanding > 0 && <div className="num text-xs text-white/55 mt-1">{nis(outstanding)} טרם שולם</div>}
          </HeroField>

          <HeroField label="רווח">
            <div className="num text-[21px] font-extrabold tracking-[-0.03em] text-[#9B85F5]">{nis(profit)}</div>
          </HeroField>
        </div>
      </div>

      {/* ---- money track ---- */}
      <div className="bg-surface border border-line rounded-2xl p-4 md:p-5">
        <div className="text-[13px] text-muted mb-3.5">מסלול הכסף</div>
        <div className="flex gap-2.5 md:gap-3.5">
          {TRACK.map((label, i) => (
            <div key={label} className="flex-1 flex flex-col gap-2 min-w-0">
              <div className={clsx('h-1.5 rounded-full', done[i] ? 'bg-moon' : 'bg-soft')} />
              <div className={clsx('text-[12.5px] leading-tight', done[i] ? 'text-ink font-semibold' : 'text-faint')}>
                {label}
              </div>
            </div>
          ))}
        </div>
        {event.payment_status === FUND_TRANSFERRED && (
          <div className="text-[12.5px] text-muted mt-3.5 pt-3 border-t border-line">
            {event.fund_transfer_amount == null
              ? 'הכסף של ההופעה הזו כבר בקופת הלהקה.'
              : <>הועבר לקופת הלהקה{' '}
                  <span className="num font-semibold text-ink">
                    {nis(Number(event.fund_transfer_amount))}
                  </span>
                  {' '}— והיתרה שנרשמה לקופה גדלה בסכום הזה.
                </>}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {/* ---- team & costs ---- */}
        <div className="bg-surface border border-line rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="ser text-lg">צוות ועלויות</h2>
            <span className="text-[12.5px] text-faint">כל שינוי נשמר מיד</span>
          </div>

          <div className="flex flex-col divide-y divide-soft text-sm">
            {COST_LINES.map((line) => {
              const amount = Number(expenses[line.key]) || 0;
              const paid = !!expenses[`${line.key}_paid`];
              const staffed = line.role ? assignments[line.role] : undefined;
              return (
                <div key={line.key} className="flex items-center gap-2.5 py-2.5 flex-wrap">
                  <span className="text-muted w-[5.5rem] shrink-0">{line.label}</span>

                  {line.role ? (
                    <SelectCell
                      value={staffed?.not_needed ? 'none' : staffed?.supplier_id || ''}
                      disabled={!isOwner}
                      className="w-[9.5rem] font-medium"
                      onSave={(v) => assign(line.role!, v)}
                      options={[
                        { value: '', label: 'לא נבחר' },
                        { value: 'none', label: 'לא נדרש' },
                        ...suppliers
                          .filter((s: any) => s.role === line.role)
                          .map((s: any) => ({ value: s.id, label: s.name })),
                      ]}
                    />
                  ) : <span className="w-[9.5rem] shrink-0" />}

                  {line.settles && amount > 0 && (
                    <button
                      disabled={!isOwner}
                      onClick={() => saveCost({ [`${line.key}_paid`]: paid ? 0 : 1 })}
                      className={clsx(
                        'text-[12.5px] font-bold rounded-full px-2.5 py-1 border whitespace-nowrap disabled:cursor-default',
                        paid ? 'bg-pos-soft text-pos border-pos/30' : 'bg-neg-soft text-neg border-neg/30'
                      )}
                    >
                      {paid ? 'שולם' : 'פתוח'}
                    </button>
                  )}

                  <div className="ms-auto">
                    <CostAmount
                      value={amount}
                      disabled={!isOwner}
                      settled={!line.settles || paid}
                      onSave={(v) => saveCost({ [line.key]: v })}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between font-bold pt-3 mt-1 border-t border-line">
            <span>סה"כ הוצאות</span>
            <span className="num">{nis(spent)}</span>
          </div>
        </div>

        {/* ---- the division ---- */}
        <div className="bg-surface border border-line rounded-2xl p-4 md:p-5">
          <div className="flex items-center justify-between gap-3 mb-3.5">
            <h2 className="ser text-lg">חלוקה בין החברים</h2>
            <Link to="/moonlight/suppliers" className="text-[12.5px] font-semibold text-moon hover:underline">
              מי מנהל? ←
            </Link>
          </div>

          <div className="flex items-center gap-3.5 bg-soft rounded-xl px-3.5 py-3 flex-wrap">
            <div className="flex-1 min-w-[9rem]">
              <div className="text-sm font-semibold">דמי הפקה</div>
              <div className="text-[12.5px] text-muted mt-0.5">
                {!event.has_commission
                  ? 'כבויים — הרווח מתחלק שווה בשווה'
                  : `יוצא ${divisionSplitLabel(event.commission_percent, members)} · ${nis(event.commission_amount)}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={!isOwner}
                onClick={() => saveEvent({
                  has_commission: 1,
                  commission_percent: Math.max(0, (Number(event.commission_percent) || 0) - 5),
                })}
                className="w-7 h-7 rounded-lg border border-line bg-surface text-moon font-bold leading-none disabled:opacity-40"
              >−</button>
              <span className="num text-[22px] font-extrabold tracking-[-0.03em] w-14 text-center text-moon">
                {event.has_commission ? `${Math.round(Number(event.commission_percent) || 0)}%` : '—'}
              </span>
              <button
                disabled={!isOwner}
                onClick={() => saveEvent({
                  has_commission: 1,
                  commission_percent: Math.min(100, (Number(event.commission_percent) || 0) + 5),
                })}
                className="w-7 h-7 rounded-lg border border-line bg-surface text-moon font-bold leading-none disabled:opacity-40"
              >+</button>
            </div>
          </div>

          {isOwner && (
            <label className="flex items-center gap-2 text-[13px] text-muted mt-2.5">
              <input
                type="checkbox"
                className="accent-accent"
                checked={!!event.has_commission}
                onChange={(e) => saveEvent({ has_commission: e.target.checked ? 1 : 0 })}
              />
              דמי הפקה פעילים בהופעה הזו
            </label>
          )}

          <div className="grid grid-cols-2 gap-2.5 mt-3">
            {divisionRows.map((m) => {
              const share = Number(event.shares?.[m.member_key]) || 0;
              const pct = profit ? Math.round((share / profit) * 1000) / 10 : 0;
              return (
                <div key={m.member_key} className="bg-soft rounded-xl p-3 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] text-muted">{m.name}</span>
                    <span className="num text-[13px] font-bold">{pct}%</span>
                    {!m.active && <span className="text-[11px] text-faint">לשעבר</span>}
                  </div>
                  <div className="mt-1">
                    <InlineAmount
                      value={share}
                      disabled={!isOwner}
                      className="num text-xl font-extrabold tracking-[-0.03em] text-moon"
                      onSave={(v) => saveEvent({ shares: { [m.member_key]: v } })}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className={clsx('text-[12.5px] mt-3', shareGap ? 'text-warn-ink' : 'text-faint')}>
            {!manual
              ? 'החלוקה נגזרת מהרווח — כל שינוי בהכנסה או בעלויות מעדכן אותה.'
              : shareGap
                ? <>החלוקה הוזנה ידנית ומסתכמת ב־<span className="num">{nis(sharesTotal)}</span> מתוך רווח של <span className="num">{nis(profit)}</span>.</>
                : 'החלוקה הוזנה ידנית ואינה עוקבת אחרי הרווח.'}
            {manual && isOwner && (
              <button onClick={() => saveEvent({ division_mode: 'auto' })} className="text-accent font-semibold hover:underline ms-1.5">
                החזרה לחישוב אוטומטי
              </button>
            )}
          </p>
        </div>
      </div>

      {/* ---- where the show goes next ---- */}
      {isOwner && (
        <div className="flex flex-wrap gap-2.5">
          {!moneyReceived(event.payment_status) && (
            <button
              disabled={busy}
              onClick={() => act(() => put(`/moonlight/events/${event.id}`, { payment_status: nextStatus(event.payment_status) }))}
              className="flex-1 min-w-[14rem] bg-moon text-white rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
            >
              {event.payment_status === 'waiting_report'
                ? 'סימון «חשבונית נשלחה»'
                : `סימון «התקבל» · ${nis(income)}`}
            </button>
          )}
          {/* The money is in the private account and has not moved on yet — the one step that
              changes a figure outside this show, so it asks how much before it does. */}
          {event.payment_status === 'received' && (
            <button
              disabled={busy}
              onClick={openTransfer}
              className="flex-1 min-w-[14rem] bg-moon text-white rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
            >
              סימון «הכסף הועבר לקופת הלהקה»
            </button>
          )}
          {outstanding > 0 && (
            <button
              disabled={busy}
              onClick={() => act(() => post(`/moonlight/events/${event.id}/pay-suppliers`))}
              className="bg-surface border border-line-strong text-ink-2 rounded-xl px-5 py-3.5 text-[15px] font-semibold hover:bg-soft disabled:opacity-60"
            >
              תשלום לספקים · {nis(outstanding)}
            </button>
          )}
          {moneyReceived(event.payment_status) && !event.paid_to_musicians && (
            <button
              disabled={busy}
              onClick={() => act(() => put(`/moonlight/events/${event.id}`, { paid_to_musicians: 1 }))}
              className="bg-surface border border-line-strong text-ink-2 rounded-xl px-5 py-3.5 text-[15px] font-semibold hover:bg-soft disabled:opacity-60"
            >
              סימון «שולם לנגנים»
            </button>
          )}
          <button
            onClick={() => { setForm({ ...event }); setEditOpen(true); }}
            className="bg-surface border border-line-strong text-ink-2 rounded-xl px-5 py-3.5 text-[15px] font-semibold hover:bg-soft"
          >
            פרטי ההופעה
          </button>
        </div>
      )}

      {/* How much actually left the private account. It is a draft of the calculator's answer,
          because what the balance has to follow is the transfer that was really made. */}
      <Modal title="הכסף הועבר לקופת הלהקה" open={transferOpen} onClose={() => setTransferOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            הסכום המוצע הוא מה שנשאר מההכנסה אחרי המע"מ וההפרשה למס — אותו חישוב שבמחשבון.
            אם הועבר סכום אחר, זה הסכום לרשום: היתרה שנרשמה לקופת הלהקה תגדל בדיוק בו.
          </p>
          <label className="block">
            <span className="block text-[13px] text-muted mb-1.5">הסכום שהועבר</span>
            <MoneyInput
              value={transferDraft}
              onChange={setTransferDraft}
              placeholder={transferDraft === '' ? 'מחשב…' : '0.00'}
            />
          </label>
          <Button
            className="w-full"
            disabled={busy || transferDraft === ''}
            onClick={async () => {
              await act(() => put(`/moonlight/events/${event.id}`, {
                payment_status: FUND_TRANSFERRED,
                fund_transfer_amount: parseFloat(transferDraft) || 0,
              }));
              setTransferOpen(false);
            }}
          >
            סימון כהועבר
          </Button>
        </div>
      </Modal>

      {/* Name, date, room size and payment stage — the facts about the show that are not money. */}
      <Modal title="פרטי ההופעה" open={editOpen} onClose={() => setEditOpen(false)}>
        {form && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await saveEvent({
                venue: form.venue, date: form.date, location: form.location,
                capacity: form.capacity, payment_status: form.payment_status,
                paid_to_musicians: form.paid_to_musicians ? 1 : 0,
              });
              setEditOpen(false);
            }}
          >
            <Input label="מקום *" value={form.venue} required
              onChange={(e) => setForm({ ...form, venue: e.target.value })} />
            <Input label="תאריך *" type="date" value={form.date} required
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Input label="כתובת" value={form.location || ''}
              onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <Input label="קיבולת האולם" type="number" min="0" dir="ltr" value={form.capacity ?? 0}
              onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value) || 0 })} />
            <label className="block">
              <span className="block text-[13px] text-muted mb-1.5">סטטוס תשלום</span>
              <select
                value={form.payment_status}
                onChange={(e) => setForm({ ...form, payment_status: e.target.value })}
                className={fieldClass}
              >
                {PAYMENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" className="accent-accent" checked={!!form.paid_to_musicians}
                onChange={(e) => setForm({ ...form, paid_to_musicians: e.target.checked ? 1 : 0 })} />
              שולם לנגנים
            </label>
            <div className="flex gap-2.5 pt-1">
              <Button type="submit" className="flex-1">שמירה</Button>
              <Button variant="danger" onClick={removeShow}>מחיקת ההופעה</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/** The next station on the money track — the button always does the one thing that comes next. */
/** The next station the one-click button advances to. The fund transfer is not among them:
 *  it asks for its amount first, so it has a button of its own. */
const nextStatus = (current: string) =>
  current === 'waiting_report' ? 'invoice_sent' : 'received';

function HeroField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[13px] text-white/60">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * A figure on the dark slab you can type straight into. It commits on blur and on Enter, so
 * the show's profit moves as soon as you look away from the field that changed it.
 */
function HeroNumber({ value, onSave, disabled, width = 'w-[6.5rem]' }: {
  value: number;
  onSave: (value: number) => void;
  disabled?: boolean;
  width?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Math.round(value));

  if (disabled) {
    return <div className="num text-[21px] font-extrabold tracking-[-0.03em]">{nis(value)}</div>;
  }

  const commit = () => {
    const next = Math.max(0, parseInt(String(shown).replace(/[^0-9]/g, ''), 10) || 0);
    setDraft(null);
    if (next !== Math.round(value)) onSave(next);
  };

  return (
    <input
      dir="ltr"
      inputMode="numeric"
      value={shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      }}
      className={clsx(
        width,
        'bg-transparent border-0 border-b-2 border-white/30 rounded-none px-1 pb-1 text-center',
        'num text-[21px] font-extrabold tracking-[-0.03em] text-white',
        'focus:outline-none focus:border-white/70'
      )}
    />
  );
}

/** One cost line's amount: green once settled, red while somebody is still owed it. */
function CostAmount({ value, onSave, disabled, settled }: {
  value: number;
  onSave: (value: number) => void;
  disabled?: boolean;
  settled: boolean;
}) {
  const tone = value === 0 ? 'text-faint' : settled ? 'text-pos' : 'text-neg';
  return (
    <InlineAmount value={value} onSave={onSave} disabled={disabled} className={clsx('num font-semibold', tone)} />
  );
}

/**
 * A figure you correct by clicking it. Used for both the cost lines and the member shares —
 * in both places the number is the thing on screen, and an edit dialog to change it would be
 * a detour around what you are already looking at.
 */
function InlineAmount({ value, onSave, disabled, className }: {
  value: number;
  onSave: (value: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (disabled) return <span className={className}>{value ? nis(value) : '—'}</span>;
  if (draft === null) {
    return (
      <button
        onClick={() => setDraft(String(Math.round(value)))}
        title="לחיצה לעריכה"
        className={clsx('rounded px-1.5 py-0.5 -mx-1.5 hover:bg-soft text-start', className)}
      >
        {value ? nis(value) : '—'}
      </button>
    );
  }

  const commit = () => {
    const next = Math.max(0, Math.round(Number(String(draft).replace(/[^0-9.]/g, '')) || 0));
    setDraft(null);
    if (next !== Math.round(value)) onSave(next);
  };

  return (
    <input
      autoFocus
      dir="ltr"
      inputMode="numeric"
      value={draft}
      // The old value is there to be corrected or replaced; selecting it lets you do either.
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      }}
      className="num w-24 bg-surface border border-accent rounded px-1.5 py-0.5 text-sm text-left focus:outline-none"
    />
  );
}
