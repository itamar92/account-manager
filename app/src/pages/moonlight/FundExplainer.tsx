import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { get, nis, nisExact } from '../../api';
import { Empty, Modal } from '../../ui';
import { showHref } from './shared';

/**
 * Why the קופה figure is what it is — and why the bank disagrees with it.
 *
 * The number on the summary is one subtraction, and on its own it is unarguable in the worst
 * way: when it comes out thousands away from what the account actually holds there is nowhere
 * to look. So this says the sum out loud, hands over every row behind each of its four lines,
 * and then does the part that actually answers the question — prices the four things that
 * routinely make the books and the bank diverge, and reports what is left after them, which is
 * the only part that is really a missing entry.
 */

/** The four causes, in the order they are worth reading — biggest and most common first. */
const SUSPECTS: Record<string, { title: string; why: string }> = {
  awaitingTransfer: {
    title: 'הופעות שהתקבלו — אבל הכסף עוד לא הועבר לקופה',
    why: 'החישוב סופר את ההכנסה של כל הופעה שסומנה «התקבל». התשלום נחת בחשבון הפרטי, '
      + 'וההעברה לחשבון הלהקה עוד לא נעשתה — אז הסכום הזה קיים בחישוב ולא בבנק. '
      + 'ברגע שמסמנים «הכסף הועבר לקופת הלהקה» ורושמים את הסכום שהועבר, הפער הזה נסגר.',
  },
  withheld: {
    title: 'מע"מ והפרשה למס שנשארו מאחור בהעברה',
    why: 'ההעברה לקופה אף פעם לא שווה להכנסה של ההופעה: המע"מ שייך למדינה, וההפרשה למס הכנסה '
      + 'נשארת בחשבון הפרטי. החישוב סופר את ההכנסה המלאה לפני מע"מ, ואילו לקופה נכנס רק מה שהועבר '
      + 'בפועל. ההפרש רשום לכל הופעה, אז זה חשבון ולא הערכה.',
  },
  memberPaidCosts: {
    title: 'עלויות ששולמו מכיס של חבר ולא מהקופה',
    why: 'החישוב מוריד מהקופה כל עלות שסומנה כשולמה לספק — גם כשמי ששילם היה חבר בלהקה. '
      + 'הכסף הזה מעולם לא יצא מהקופה, ולכן כאן החישוב נמוך ממה שבבנק.',
  },
  refundedToMembers: {
    title: 'החזרים לחברים על הוצאות שהם שילמו',
    why: 'הוצאה כללית שחבר שילם וכבר הוחזרה לו — הכסף יצא מהקופה. החישוב מוריד רק הוצאות '
      + 'שהקופה שילמה ישירות, אז ההחזר הזה עדיין נספר כאילו הוא בקופה.',
  },
};

const ORDER = ['awaitingTransfer', 'withheld', 'memberPaidCosts', 'refundedToMembers'];

const rowCount = (n: number) => (n === 1 ? 'שורה אחת' : `${n} שורות`);

export function FundExplainer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  // Fetched when the dialog opens rather than with the summary: it is a long answer to a
  // question most visits never ask, and every row of it is already on the server.
  useEffect(() => {
    if (!open) return;
    setData(null);
    setError('');
    get('/moonlight/fund/explain').then((d) => setData(d.explain)).catch((e) => setError(e.message));
  }, [open]);

  return (
    <Modal title="איך מחושבת קופת הלהקה" open={open} onClose={onClose} size="xl">
      {error ? <Empty text={error} />
        : !data ? <Empty text="טוען…" />
        : <Explanation data={data} />}
    </Modal>
  );
}

function Explanation({ data }: { data: any }) {
  const { fund, lines, suspects, explained, unexplained, owedToSuppliers } = data;
  // A show opened from here is being opened to be fixed, so the way back is to the summary the
  // dialog was read on rather than to the shows list.
  const location = useLocation();
  const ordered = [...suspects].sort((a: any, b: any) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

  return (
    <div className="space-y-5">
      {/* ---- the sum itself ---- */}
      <section>
        <h3 className="ser text-base mb-1">החישוב</h3>
        <p className="text-[13px] text-muted mb-3">
          מה שאמור להיות בקופה לפי מה שרשום באפליקציה — כל התקבולים שנכנסו, פחות כל מה שיצא.
          כל שורה נפתחת ומראה בדיוק אילו הופעות והוצאות נספרו בה.
        </p>
        <div className="border border-line rounded-xl overflow-hidden">
          <Line sign="+" label="תקבולים שהתקבלו" tone="text-pos" line={lines.received} from={location} />
          <Line sign="−" label="תשלומים לספקים" line={lines.toSuppliers} from={location} />
          <Line sign="−" label="חלוקות ששולמו לחברים" line={lines.toMembers} from={location} />
          <Line sign="−" label="הוצאות ששולמו מהקופה" line={lines.fromFund} from={location} />
          <div className="flex items-center justify-between gap-3 px-3.5 py-3 bg-soft">
            <span className="font-semibold">= לפי החישוב</span>
            <span dir="ltr" className="num ser text-lg">{nisExact(fund.computed)}</span>
          </div>
        </div>
      </section>

      {/* ---- and where it disagrees with the bank ---- */}
      <section>
        <h3 className="ser text-base mb-1">הפער מול הבנק</h3>
        {fund.actual === null ? (
          <p className="text-[13px] text-muted">
            עוד לא נמסרה יתרה בפועל, אז אין מול מה להשוות. מזינים אותה ב«עדכון יתרת הקופה»,
            והפער יפורק כאן לגורמים.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2.5 mb-3">
              <Figure label="בפועל בחשבון" value={fund.actual} />
              <Figure label="לפי החישוב" value={fund.computed} />
              <Figure label="פער" value={fund.gap} tone={fund.gap === 0 ? 'text-pos' : 'text-neg'} />
            </div>
            <p className="text-[13px] text-muted mb-3">
              הפער הוא כמעט תמיד סכום של כמה דברים ידועים, ולא טעות. אלה הם, כל אחד עם מה
              שהוא מסביר מתוך הפער:
            </p>
          </>
        )}

        <div className="flex flex-col gap-2.5">
          {ordered.length === 0 && (
            <p className="text-[13px] text-muted">
              אין כרגע אף אחד מהגורמים המוכרים לפער — כל הופעה שהתקבלה הועברה לקופה, וכל הוצאה
              נרשמה על מי ששילם אותה.
            </p>
          )}
          {ordered.map((s: any) => <Suspect key={s.key} suspect={s} from={location} />)}
        </div>

        {fund.actual !== null && ordered.length > 0 && (
          <div className="mt-3 border-t border-line pt-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">סך הכל מוסבר</span>
              <span dir="ltr" className="num font-semibold">{nisExact(explained)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold">נשאר בלי הסבר</span>
              <span dir="ltr" className={clsx('num font-bold', Math.abs(unexplained) < 1 ? 'text-pos' : 'text-neg')}>
                {nisExact(unexplained)}
              </span>
            </div>
            <p className="text-[12.5px] text-faint">
              {Math.abs(unexplained) < 1
                ? 'הפער מוסבר במלואו — אין תנועה חסרה בספרים.'
                : 'זה מה שנשאר אחרי כל הגורמים המוכרים: תקבול או תשלום שלא נרשם באפליקציה. '
                  + 'שווה להשוות מול דף החשבון בזמן שעוד זוכרים מה קרה.'}
            </p>
          </div>
        )}
      </section>

      {owedToSuppliers > 0 && (
        <p className="text-[12.5px] text-faint border-t border-line pt-3">
          שימו לב: מתוך מה שבקופה, <span className="num">{nis(owedToSuppliers)}</span> עוד חייבים
          לספקים. זה לא פער — הכסף באמת שם — אבל הוא כבר מובטח לצאת.
        </p>
      )}
    </div>
  );
}

/** One line of the sum, openable onto the rows it adds up. */
function Line({ sign, label, line, tone, from }: {
  sign: string; label: string; tone?: string; from: { pathname: string; search: string };
  line: { rows: any[]; total: number; count: number };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-start hover:bg-soft transition"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-faint text-xs w-3 shrink-0">{open ? '▾' : '▸'}</span>
          <span className="text-sm">{label}</span>
          <span className="text-[12px] text-faint shrink-0">{line.count}</span>
        </span>
        <span dir="ltr" className={clsx('num font-semibold shrink-0', tone)}>{sign}{nisExact(line.total)}</span>
      </button>
      {open && <Rows rows={line.rows} from={from} />}
    </div>
  );
}

/** One cause of the gap, with what it accounts for and the rows it comes from. */
function Suspect({ suspect, from }: { suspect: any; from: { pathname: string; search: string } }) {
  const [open, setOpen] = useState(false);
  const copy = SUSPECTS[suspect.key];
  if (!copy) return null;
  return (
    <div className="border border-line rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-start justify-between gap-3 px-3.5 py-3 text-start hover:bg-soft transition"
      >
        <span className="min-w-0">
          <span className="text-sm font-semibold flex items-center gap-2">
            <span className="text-faint text-xs w-3 shrink-0">{open ? '▾' : '▸'}</span>
            {copy.title}
          </span>
          <span className="block text-[12.5px] text-faint mt-0.5 pe-5">{rowCount(suspect.count)}</span>
        </span>
        <span dir="ltr" className={clsx('num font-bold shrink-0', suspect.effect < 0 ? 'text-neg' : 'text-pos')}>
          {suspect.effect > 0 ? '+' : ''}{nisExact(suspect.effect)}
        </span>
      </button>
      {open && (
        <>
          <p className="text-[13px] text-body bg-soft px-3.5 py-2.5 border-t border-line">{copy.why}</p>
          <Rows rows={suspect.rows} from={from} />
        </>
      )}
    </div>
  );
}

/**
 * The rows behind a figure. A show is a link into the show itself, because the reason a row is
 * here is nearly always something to fix on that page — a status not yet moved on, a transfer
 * amount never entered.
 */
function Rows({ rows, from }: { rows: any[]; from: { pathname: string; search: string } }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-soft border-t border-line divide-y divide-line/60">
      {rows.map((row) => {
        const label = row.venue ?? row.description ?? '—';
        const body = (
          <>
            <span className="min-w-0 truncate">
              {label}
              {row.paid_by && <span className="text-faint"> · {row.paid_by}</span>}
            </span>
            <span className="flex items-center gap-3 shrink-0">
              {row.transferred !== undefined && (
                <span className="num text-[12px] text-faint">
                  {nis(row.income)} ← {nis(row.transferred)}
                </span>
              )}
              <span className="num text-[12px] text-faint w-[5.5rem] text-start hidden sm:block">{row.date}</span>
              <span dir="ltr" className="num font-medium w-[5.5rem] text-start">{nisExact(row.amount)}</span>
            </span>
          </>
        );
        return row.venue ? (
          <Link
            key={row.id}
            to={showHref(row.id, from)}
            className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px] hover:text-moon"
          >
            {body}
          </Link>
        ) : (
          <div key={row.id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px]">
            {body}
          </div>
        );
      })}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-soft border border-line rounded-xl px-3 py-2.5">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className={clsx('num text-lg font-extrabold tracking-[-0.03em] mt-0.5', tone)}>{nis(value)}</div>
    </div>
  );
}
