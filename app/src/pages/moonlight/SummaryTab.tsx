import React, { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { get, post, put, nis } from '../../api';
import { PerShowChart } from '../../charts';
import { Button, Card, Empty, FilterBar, Input, Modal, MonthSelect, PageHeader, YearSelect } from '../../ui';
import { paymentStatusLabel, roleName, showHref, useSupplierRoles } from './shared';
import { DivisionTable } from './DivisionTable';
import { FundExplainer } from './FundExplainer';

const yearBounds = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/** Wide enough to hold every year the band has ever played, for «כל השנים». */
const ALL_YEARS = { from: '2000-01-01', to: '2099-12-31' };

/** The bounds of one month, for narrowing the summary to a single period. */
const monthBounds = (year: number, month: number) => {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${lastDay}` };
};

/** The shades the "money on its way" bar is segmented in, cycled per show. */
const SEGMENTS = ['#9A7CF0', '#BE9520', '#4A4170', '#6B45D6', '#C9A227'];

/**
 * Moonlight's own dashboard: what is still coming in, what each member is owed out of it, what
 * the float holds, and how the year's shows have gone.
 *
 * It keeps its own range rather than following the tables: the tables are for working on this
 * year, while the point of the summary is being able to look back over previous ones.
 */
export function SummaryTab({ onError, isOwner }: { onError: (message: string) => void; isOwner: boolean }) {
  const thisYear = new Date().getFullYear();
  // Mounted for the sake of the role names further down: they are the band's, not this file's.
  useSupplierRoles();
  const location = useLocation();
  // The range lives in the URL, so a show opened from one of the lists below and then closed
  // comes back to the year that was on screen rather than to the year the page opens on. The
  // keys are the summary's own: the tables' period selects share the page and must not collide.
  const [params, setParams] = useSearchParams();
  const rawYear = params.get('sumYear');
  const year: number | '' = rawYear === null ? thisYear
    : rawYear === 'all' ? ''
    : (parseInt(rawYear, 10) || '');
  const rawMonth = params.get('sumMonth');
  const month: number | '' = year === '' || rawMonth === null ? '' : (parseInt(rawMonth, 10) || '');
  const customFrom = params.get('sumFrom');
  const customTo = params.get('sumTo');
  const custom = !!(customFrom && customTo);
  const range = custom ? { from: customFrom as string, to: customTo as string }
    : year === '' ? ALL_YEARS
    : month === '' ? yearBounds(year)
    : monthBounds(year, month);
  const [summary, setSummary] = useState<any>(null);
  const [fund, setFund] = useState<any>(null);
  const [division, setDivision] = useState<any>(null);
  const [followUps, setFollowUps] = useState<any>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [fundDraft, setFundDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const loadRange = () => {
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    get(`/moonlight/summary?${qs}`)
      .then((d) => { setSummary(d.summary); setFund(d.fund); })
      .catch((e) => onError(e.message));
    get(`/moonlight/division?${qs}`).then((d) => setDivision(d.division)).catch((e) => onError(e.message));
  };
  useEffect(loadRange, [range.from, range.to]);

  // The follow-ups are not range-bound: an unpaid show is a loose end whatever year it is in.
  const loadFollowUps = () =>
    get('/moonlight/follow-ups').then((d) => setFollowUps(d.followUps)).catch((e) => onError(e.message));
  useEffect(() => { loadFollowUps(); }, []);

  // Which year the range is showing, or '' when it spans more than one.
  const selectedYear = custom ? '' : year;

  /**
   * One write for the whole range, whichever way it was chosen.
   *
   * A year and a custom range are two ways of saying the same thing, so they are set together:
   * writing them separately would leave a stale pair of dates in the URL long enough for the
   * summary to load the wrong range.
   */
  const writeRange = (next:
    | { custom: true; from: string; to: string }
    | { custom: false; year: number | ''; month: number | '' }) => {
    const p = new URLSearchParams(params);
    if (next.custom) {
      p.set('sumFrom', next.from);
      p.set('sumTo', next.to);
    } else {
      p.delete('sumFrom');
      p.delete('sumTo');
      p.set('sumYear', next.year === '' ? 'all' : String(next.year));
      if (next.year === '' || next.month === '') p.delete('sumMonth');
      else p.set('sumMonth', String(next.month));
    }
    setParams(p, { replace: true });
  };

  const setPeriod = (nextYear: number | '', nextMonth: number | '') =>
    writeRange({ custom: false, year: nextYear, month: nextYear === '' ? '' : nextMonth });

  /** Hands out every show whose money has arrived and whose profit has not been shared yet. */
  const payMembers = async () => {
    const shows = division?.shows ?? [];
    if (!shows.length) return;
    if (!confirm(`לסמן ${shows.length} הופעות כ«שולם לנגנים»? החלוקה תיסגר עליהן.`)) return;
    setBusy(true);
    onError('');
    try {
      for (const show of shows) await put(`/moonlight/events/${show.id}`, { paid_to_musicians: 1 });
      loadRange();
      loadFollowUps();
    } catch (err: any) { onError(err.message); }
    finally { setBusy(false); }
  };

  const saveFund = async () => {
    setBusy(true);
    onError('');
    try {
      const d = await post('/moonlight/fund', { actual: fundDraft.trim() === '' ? '' : Number(fundDraft) });
      setFund(d.fund);
      setFundOpen(false);
    } catch (err: any) { onError(err.message); }
    finally { setBusy(false); }
  };

  const awaiting = [...(followUps?.awaitingPayment ?? [])].sort((a: any, b: any) => b.amount - a.amount);
  const awaitingTotal = followUps?.awaitingPaymentTotal ?? 0;
  const payouts = division?.payout;
  // The roster comes back with the division rather than being imported, so a member who joined
  // or left shows up here the moment the summary is refetched.
  const divisionMembers: any[] = division?.members ?? [];
  const maxPayout = payouts
    ? Math.max(1, ...divisionMembers.map((m: any) => Math.abs(payouts[m.member_key] || 0)))
    : 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="סקירה כספית"
        sub={summary
          ? <><span className="num">{summary.eventCount}</span> הופעות בטווח · <span className="num">{summary.upcomingEvents}</span> קרובות</>
          : undefined}
      />

      <FilterBar>
        <YearSelect value={selectedYear} onChange={(next) => setPeriod(next, month)} />
        <MonthSelect
          value={selectedYear === '' ? '' : month}
          disabled={selectedYear === ''}
          onChange={(next) => setPeriod(selectedYear, next)}
        />
        <Button
          variant="ghost"
          onClick={() => (custom
            ? setPeriod(thisYear, '')
            : writeRange({ custom: true, from: range.from, to: range.to }))}
        >
          {custom ? 'לפי שנה' : 'טווח מותאם'}
        </Button>
        {custom && (
          <>
            <Input type="date" value={range.from}
              onChange={(e) => writeRange({ custom: true, from: e.target.value, to: range.to })} />
            <Input type="date" value={range.to}
              onChange={(e) => writeRange({ custom: true, from: range.from, to: e.target.value })} />
          </>
        )}
      </FilterBar>

      {!summary ? <Empty text="טוען…" /> : (
        <>
          <div className="grid gap-4 lg:grid-cols-2 items-start">
            {/* ---- money on its way ---- */}
            <div className="bg-ink text-white rounded-2xl p-5 md:p-6 flex flex-col gap-4">
              <div>
                <div className="text-sm text-white/60">כסף בדרך — טרם התקבל</div>
                <div className="num ser text-4xl md:text-[44px] leading-none mt-1.5">{nis(awaitingTotal)}</div>
              </div>

              {awaiting.length > 0 && (
                <>
                  <div className="flex h-2.5 rounded-full overflow-hidden bg-white/12">
                    {awaiting.slice(0, 5).map((row: any, i: number) => (
                      <div
                        key={row.id}
                        style={{
                          width: `${Math.max((row.amount / Math.max(awaitingTotal, 1)) * 100, 2)}%`,
                          background: SEGMENTS[i % SEGMENTS.length],
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {awaiting.slice(0, 5).map((row: any, i: number) => (
                      <Link
                        key={row.id}
                        to={showHref(row.id, location)}
                        className="flex items-center justify-between gap-3 text-[14.5px] hover:opacity-80"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <i className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SEGMENTS[i % SEGMENTS.length] }} />
                          <span className="truncate">{paymentStatusLabel(row.payment_status)} · {row.venue}</span>
                        </span>
                        <span className="num shrink-0">{nis(row.amount)}</span>
                      </Link>
                    ))}
                    {awaiting.length > 5 && (
                      <Link to="/moonlight/shows" className="text-[13px] text-white/60 hover:text-white">
                        ועוד {awaiting.length - 5} הופעות ←
                      </Link>
                    )}
                  </div>
                </>
              )}
              {awaiting.length === 0 && (
                <div className="text-sm text-white/60">כל ההופעות שהתקיימו שולמו.</div>
              )}

              <div className="border-t border-white/15 pt-3.5 flex items-center justify-between">
                <span className="text-sm text-white/60">חוב פתוח לספקים</span>
                <Link to="/moonlight/suppliers" className="num text-lg font-semibold text-[#EE9C8C] hover:underline">
                  {nis(followUps?.owedToSuppliersTotal ?? 0)}
                </Link>
              </div>

              {/* The mirror of the line above: that one is money the band still has to pay,
                  this one is money it has already paid and cannot yet deduct. */}
              <div className="border-t border-white/15 pt-3.5 flex items-center justify-between">
                <span className="text-sm text-white/60">
                  שולם וממתין לחשבונית
                  {followUps?.awaitingInvoiceVat > 0 && (
                    <span className="block text-[12px] text-white/40">
                      מע״מ שטרם ניתן להשבה {nis(followUps.awaitingInvoiceVat)}
                    </span>
                  )}
                </span>
                <Link to="/moonlight/supplierPayments" className="num text-lg font-semibold text-[#EFC27B] hover:underline">
                  {nis(followUps?.awaitingInvoiceTotal ?? 0)}
                </Link>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {/* ---- what each member is owed ---- */}
              <Card>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="ser text-lg">מגיע לכל חבר</h2>
                  <button
                    onClick={() => setHowOpen(true)}
                    className="text-[13px] font-semibold text-moon border border-line rounded-full px-3 py-1.5 hover:bg-soft"
                  >
                    איך זה מחושב?
                  </button>
                </div>
                <div className="flex flex-col gap-3">
                  {divisionMembers.map((m: any) => {
                    const due = payouts?.[m.member_key] ?? 0;
                    return (
                      <div key={m.member_key} className="flex items-center gap-3">
                        <span className="w-14 text-[14.5px] font-semibold shrink-0">{m.name}</span>
                        <span className="flex-1 h-6 bg-soft rounded-md overflow-hidden">
                          <span
                            className={clsx('block h-full rounded-md', due < 0 ? 'bg-neg/60' : 'bg-moon')}
                            style={{ width: `${Math.max((Math.abs(due) / maxPayout) * 100, 2)}%` }}
                          />
                        </span>
                        <span className={clsx('num w-20 text-start font-semibold', due < 0 && 'text-neg')}>
                          {nis(due)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {(division?.shows?.length ?? 0) > 0 ? (
                  isOwner && (
                    <Button className="w-full mt-4" disabled={busy} onClick={payMembers}>
                      לסמן תשלום לנגנים · {division.shows.length} הופעות
                    </Button>
                  )
                ) : (
                  <p className="text-[12.5px] text-faint mt-3">
                    אין מה לחלק — כל הופעה שהכסף בגינה התקבל כבר סומנה «שולם לנגנים».
                  </p>
                )}
              </Card>

              <div className="grid grid-cols-3 gap-3">
                <MiniStat label="הכנסות" value={nis(summary.totalRevenue)} />
                <MiniStat label="הוצאות" value={nis(summary.totalExpenses)} />
                <MiniStat label="רווח" value={nis(summary.totalProfit)} tone="text-moon" />
              </div>
            </div>
          </div>

          {/* ---- the float ---- */}
          {fund && (
            <div className="bg-surface border border-line rounded-2xl p-5 md:p-6 flex gap-6 flex-wrap">
              {/* Once somebody has said what the account actually holds, that is what the float
                  is — the computed figure drops to a line of the working beside the gap, so
                  updating the balance moves the number the band reads. */}
              <div className="flex-1 min-w-[17rem]">
                <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                  <h2 className="ser text-lg">קופת הלהקה</h2>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[12.5px] text-muted">
                      {fund.actual === null ? 'מחושב מהתקבולים והתשלומים' : 'לפי היתרה שנמסרה בחשבון'}
                    </span>
                    <button
                      onClick={() => setExplainOpen(true)}
                      className="text-[13px] font-semibold text-moon border border-line rounded-full px-3 py-1.5 hover:bg-soft"
                    >
                      איך זה מחושב?
                    </button>
                  </div>
                </div>
                <div className="num ser text-4xl text-moon leading-tight">
                  {nis(fund.actual === null ? fund.computed : fund.actual)}
                </div>
                {fund.actual !== null && (
                  <div className="num text-[12.5px] text-muted mt-1">
                    לפי החישוב {nis(fund.computed)}
                    {fund.gap !== 0 && <span className="text-neg"> · פער {nis(fund.gap)}</span>}
                  </div>
                )}
                <div className="grid gap-x-6 gap-y-2.5 mt-3.5 text-sm sm:grid-cols-2">
                  <FundLine label="תקבולים שהתקבלו" value={fund.received} tone="text-pos" sign="+" />
                  <FundLine label="תשלומים לספקים" value={-fund.toSuppliers} />
                  <FundLine label="חלוקות ששולמו" value={-fund.toMembers} />
                  <FundLine label="הוצאות מהקופה" value={-fund.fromFund} />
                </div>
              </div>

              <div className="w-full sm:w-60 bg-soft border border-line rounded-xl p-4 flex flex-col gap-2.5">
                <div className="text-[13px] text-muted">יתרה בפועל בחשבון</div>
                <div className="num text-2xl font-extrabold tracking-[-0.03em]">
                  {fund.actual === null ? '—' : nis(fund.actual)}
                </div>
                <button
                  onClick={() => setExplainOpen(true)}
                  className="flex items-center justify-between text-[13.5px] w-full text-start hover:text-ink"
                >
                  <span className="text-muted underline decoration-dotted underline-offset-4">פער מהחישוב</span>
                  <span className={clsx('num font-bold', fund.gap === null ? 'text-faint' : fund.gap === 0 ? 'text-pos' : 'text-neg')}>
                    {fund.gap === null ? 'לא נבדק' : nis(fund.gap)}
                  </span>
                </button>
                {isOwner && (
                  <Button
                    className="mt-auto"
                    onClick={() => { setFundDraft(fund.actual === null ? '' : String(fund.actual)); setFundOpen(true); }}
                  >
                    עדכון יתרת הקופה
                  </Button>
                )}
              </div>
            </div>
          )}

          <Card>
            <h2 className="ser text-lg mb-3">הכנסות, הוצאות ורווח לפי הופעה</h2>
            <PerShowChart rows={summary.perShow ?? []} />
          </Card>

          {/* ---- what is still unstaffed ---- */}
          {(followUps?.missingAssignments?.length ?? 0) > 0 && (
            <Card className="border-warn/40">
              <h2 className="ser text-lg text-warn mb-3">
                {followUps.missingAssignments.length} הופעות קרובות עם שיבוץ חסר
              </h2>
              <div className="flex flex-col gap-2">
                {followUps.missingAssignments.slice(0, 6).map((row: any) => (
                  <Link
                    key={row.id}
                    to={showHref(row.id, location)}
                    className="flex items-center justify-between gap-3 text-sm border-b border-soft pb-2 last:border-0 hover:text-moon"
                  >
                    <span>
                      <span className="font-medium">{row.venue}</span>
                      <span className="num text-xs text-faint mr-2">{row.date}</span>
                    </span>
                    <span className="text-warn text-xs">
                      חסר: {row.missing.map((r: string) => roleName(r)).join(', ')}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* The full step-by-step behind "מגיע לכל חבר" — the same table as before, now behind
          the question it answers rather than always on screen. */}
      <Modal title="איך חושב מה שמגיע לכל אחד" open={howOpen} onClose={() => setHowOpen(false)} size="xl">
        <DivisionTable division={division} />
      </Modal>

      {/* Why the number is what it is, and why the bank says something else. */}
      <FundExplainer open={explainOpen} onClose={() => setExplainOpen(false)} />

      <Modal title="עדכון יתרת הקופה" open={fundOpen} onClose={() => setFundOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            מה שהחשבון מראה עכשיו. הפער מול החישוב הוא תקבול או תשלום שלא נרשם — שווה לבדוק אותו
            בזמן שעוד זוכרים מה קרה.
          </p>
          <Input
            label="יתרה בפועל" type="number" step="0.01" dir="ltr" value={fundDraft}
            placeholder="ריק — לא נבדק"
            onChange={(e) => setFundDraft(e.target.value)}
          />
          <Button className="w-full" disabled={busy} onClick={saveFund}>שמירה</Button>
        </div>
      </Modal>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-surface border border-line rounded-xl px-3.5 py-3">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={clsx('num text-xl font-extrabold tracking-[-0.03em] mt-0.5', tone)}>{value}</div>
    </div>
  );
}

function FundLine({ label, value, tone, sign }: { label: string; value: number; tone?: string; sign?: string }) {
  return (
    <div className="flex justify-between border-b border-soft pb-2">
      <span className="text-body">{label}</span>
      {/* Left-to-right, so a leading «+» stays on the number rather than drifting to its end. */}
      <span dir="ltr" className={clsx('num font-semibold', tone)}>{sign}{nis(value)}</span>
    </div>
  );
}
