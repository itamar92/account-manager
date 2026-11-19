import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Briefcase, CalendarClock, FileBarChart, FileSignature, Moon, Music, Receipt } from 'lucide-react';
import { clsx } from 'clsx';
import { get, nis } from '../api';
import { Empty, InkPanel, PageHeader, Pill } from '../ui';
import { MiniBarChart } from '../charts';
import { useAuth } from '../AuthContext';

/** Which pile an item belongs to, for the filter row. */
type Kind = 'money' | 'tax' | 'data';

interface Item {
  key: string;
  kind: Kind;
  tone: string;
  icon: React.ElementType;
  title: string;
  sub: string;
  amount?: number;
  cta: string;
  to: string;
  /** Whether the button is the loud one — reserved for the item that costs money to ignore. */
  primary?: boolean;
}

const TABS: Array<[Kind | 'all', string]> = [
  ['all', 'הכל'],
  ['money', 'כסף'],
  ['tax', 'מיסים'],
  ['data', 'נתונים'],
];

/**
 * The landing page: not a summary of the year but a list of what is unfinished, worst first.
 *
 * Everything on it is derived — the server recomputes each item from the books on every load —
 * so an item disappears by being dealt with rather than by being dismissed.
 */
export function Inbox() {
  const navigate = useNavigate();
  const [inbox, setInbox] = useState<any>(null);
  const [dash, setDash] = useState<any>(null);
  const [tab, setTab] = useState<Kind | 'all'>('all');
  const [error, setError] = useState('');
  const year = new Date().getFullYear();
  const bandName = useAuth().branding.band_name;

  useEffect(() => {
    get('/inbox').then((d) => setInbox(d.inbox)).catch((e) => setError(e.message));
    get(`/dashboard?year=${year}`).then(setDash).catch((e) => setError(e.message));
  }, [year]);

  const items = useMemo<Item[]>(() => {
    if (!inbox) return [];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void bandName;
    const out: Item[] = [];
    const { overdueInvoices: od, unbilledWorks: uw, uncategorizedExpenses: ue, band } = inbox;

    if (od.count) {
      const oldest = od.oldest;
      out.push({
        key: 'overdue', kind: 'money', tone: 'neg', icon: AlertCircle, primary: true,
        title: `${od.count} חשבוניות באיחור תשלום`,
        sub: oldest
          ? `הוותיקה — ${oldest.client_name}, ${oldest.days_late} ימים · ${nis(oldest.total)}`
          : 'ממתינות לגבייה',
        amount: od.total, cta: 'לגבייה', to: '/invoices?status=issued',
      });
    }
    if (uw.count) {
      out.push({
        key: 'unbilled', kind: 'money', tone: 'accent', icon: Briefcase, primary: true,
        title: `${uw.count} עבודות שטרם חויבו`,
        sub: uw.topClient && uw.topClient.count > 1
          ? `${uw.topClient.count} מהן ל${uw.topClient.name} — אפשר חשבונית אחת`
          : 'ממתינות להפקת חשבונית',
        amount: uw.total, cta: 'להוציא חשבונית', to: '/works',
      });
    }
    if (ue.count) {
      out.push({
        key: 'uncat', kind: 'tax', tone: 'warn', icon: Receipt,
        title: `${ue.count} הוצאות ללא סיווג`,
        sub: 'מע"מ תשומות שלא ייכנס לדיווח כל עוד אין סיווג',
        amount: ue.vat, cta: 'לסווג עכשיו', to: '/expenses',
      });
    }
    if (band.awaitingPaymentCount) {
      out.push({
        key: 'band-money', kind: 'money', tone: 'moon', icon: Music,
        title: `${bandName} · ${band.awaitingPaymentCount} הופעות שהכסף בגינן טרם התקבל`,
        sub: band.owedToSuppliersTotal
          ? `במקביל, ${nis(band.owedToSuppliersTotal)} חוב פתוח לספקים`
          : 'הופעות שכבר היו וטרם שולמו',
        amount: band.awaitingPaymentTotal, cta: 'לרשימה', to: '/band/income',
      });
    }
    // A client signed: news first, since it is a show sold; then whatever the signature could
    // not settle on its own.
    const quotes = band.quotes;
    if (quotes?.newlySigned.length) {
      const one = quotes.newlySigned.length === 1 ? quotes.newlySigned[0] : null;
      out.push({
        key: 'band-signed', kind: 'money', tone: 'moon', icon: FileSignature, primary: true,
        title: one
          ? `${bandName} · ${one.client_name} חתמו על הצעת המחיר`
          : `${bandName} · ${quotes.newlySigned.length} הצעות מחיר נחתמו`,
        sub: quotes.newlySigned
          .slice(0, 3)
          .map((q: any) => `${q.client_name} ${q.event_date.slice(8, 10)}.${q.event_date.slice(5, 7)}`)
          .join(' · '),
        amount: quotes.newlySigned.reduce((s: number, q: any) => s + (Number(q.net_amount) || 0), 0),
        cta: 'לפתוח', to: one ? `/band/quotes/${one.id}` : '/band/summary',
      });
    }
    const unsettled = new Set([
      ...(quotes?.needsShow ?? []), ...(quotes?.amountMismatch ?? []), ...(quotes?.stillOption ?? []),
    ].map((q: any) => q.id)).size;
    if (unsettled) {
      out.push({
        key: 'band-quote-show', kind: 'data', tone: 'warn', icon: FileSignature,
        title: `${bandName} · ${unsettled} הצעות חתומות שצריכות טיפול`,
        sub: [
          quotes.stillOption?.length ? `${quotes.stillOption.length} עדיין «אופציה» ביומן` : '',
          quotes.needsShow.length ? `${quotes.needsShow.length} בלי הופעה` : '',
          quotes.amountMismatch.length ? `${quotes.amountMismatch.length} בסכום שונה מההופעה` : '',
        ].filter(Boolean).join(' · '),
        cta: 'לטפל', to: '/band/summary',
      });
    }

    // The closed year's return: a date, and a figure to pay with it.
    const filing = inbox.annualFiling;
    if (filing) {
      const late = filing.deadline.days_left < 0;
      const owed = filing.balance >= 0;
      out.push({
        key: 'annual-filing', kind: 'tax', tone: late ? 'neg' : 'warn', icon: FileBarChart,
        primary: late,
        title: `הדוח השנתי ל-${filing.year} טרם הוגש`,
        sub: `${late ? `באיחור ${-filing.deadline.days_left} ימים` : `להגשה בעוד ${filing.deadline.days_left} ימים`}`
          + ` · ${filing.deadline.file_by}`
          + (filing.deadline.stated ? '' : ' (מועד ברירת מחדל — ניתן לעדכן)')
          + ` · ${owed ? 'יתרה לתשלום' : 'צפוי החזר'}`,
        amount: Math.abs(filing.balance),
        cta: 'לדוח השנתי', to: `/reports?tab=annual&year=${filing.year}`,
      });
    }

    // The year still running: what it is heading towards, while there is still time to act.
    const shortfall = inbox.annualShortfall;
    if (shortfall) {
      out.push({
        key: 'annual-shortfall', kind: 'tax', tone: 'warn', icon: CalendarClock,
        title: `${shortfall.year} מתקדמת ליתרת מס של ${nis(shortfall.shortfall)}`,
        sub: shortfall.mikdamot_paid > 0
          ? `מעבר ל-${nis(shortfall.payments)} שכבר נוכו ושולמו, מהם ${nis(shortfall.mikdamot_paid)} מקדמות`
          : 'לא הוזנו מקדמות לשנה זו — כדאי לבדוק מול רואה החשבון אם צריך לשלם',
        amount: shortfall.shortfall,
        cta: 'לתחזית', to: `/reports?tab=annual&year=${shortfall.year}`,
      });
    }

    if (band.missingAssignments.length) {
      out.push({
        key: 'band-staff', kind: 'data', tone: 'moon', icon: Moon,
        title: `${bandName} · ${band.missingAssignments.length} הופעות ללא שיבוץ מלא`,
        sub: band.missingAssignments
          .slice(0, 2)
          .map((m: any) => `${m.venue} ${m.date.slice(8, 10)}.${m.date.slice(5, 7)}`)
          .join(' · '),
        cta: 'לשבץ', to: '/band/assignments',
      });
    }
    return out;
  }, [inbox]);

  if (error) return <Empty text={error} />;
  if (!inbox || !dash) return <Empty text="טוען…" />;

  const shown = tab === 'all' ? items : items.filter((i) => i.kind === tab);
  const counts = (k: Kind | 'all') => (k === 'all' ? items.length : items.filter((i) => i.kind === k).length);
  // What is hanging in the air: money the books say is owed but has not moved.
  const hanging = inbox.overdueInvoices.total + inbox.unbilledWorks.total + inbox.band.awaitingPaymentTotal;

  const totals = dash.yearTotals;
  const vat = inbox.vat;

  return (
    <div className="space-y-5">
      <PageHeader
        title="מה דורש טיפול"
        sub={
          items.length
            ? <>{items.length} דברים פתוחים · <span className="num">{nis(hanging)}</span> תלויים באוויר</>
            : 'אין משימות פתוחות — הכול מסודר'
        }
        actions={
          <div className="flex gap-2 flex-wrap">
            {TABS.filter(([k]) => k === 'all' || counts(k as Kind) > 0).map(([k, label]) => (
              <Pill key={k} active={tab === k} onClick={() => setTab(k as Kind | 'all')}>
                {label} {counts(k as Kind | 'all')}
              </Pill>
            ))}
          </div>
        }
      />

      {/* The one deadline with a date on it gets the dark slab — nothing else on the page
          stops being true if it is left another week. */}
      {vat && (
        <InkPanel className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-[rgba(201,138,22,.18)] text-[#E2A63A] flex items-center justify-center shrink-0">
              <CalendarClock size={22} />
            </div>
            <div>
              <div className="text-[13px] text-white/60">דיווח מע"מ · {vat.label}</div>
              <div className="ser text-lg md:text-[23px] mt-0.5">
                {vat.days_left >= 0
                  ? <>להגשה בעוד <span className="num">{vat.days_left}</span> ימים</>
                  : <>באיחור <span className="num">{-vat.days_left}</span> ימים</>}
                {' — '}
                {vat.vat_due >= 0 ? 'לתשלום' : 'להחזר'}{' '}
                <span className="num">{nis(Math.abs(vat.vat_due))}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            {!!vat.open_expenses && (
              <div className="text-center">
                <div className="num text-[15px] font-semibold text-[#A9BAF7]">{vat.open_expenses}</div>
                <div className="text-xs text-white/60">מסמכים פתוחים</div>
              </div>
            )}
            <button
              onClick={() => navigate('/reports')}
              className="bg-[#F4F5F7] text-ink rounded-[10px] px-4 py-2.5 text-sm font-bold whitespace-nowrap"
            >
              לדוח המע"מ
            </button>
          </div>
        </InkPanel>
      )}

      <div className="space-y-2.5">
        {shown.length === 0 && <Empty text="אין כאן משימות פתוחות" />}
        {shown.map((item) => <ItemCard key={item.key} item={item} />)}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <Figure
          label={`הכנסות ${year} · לפני מע"מ`}
          value={nis(totals.income)}
          note={`${dash.paidYtd.total ? `התקבל ${nis(dash.paidYtd.total)}` : ''}`}
        />
        <Figure
          label={`רווח ${year}`}
          value={nis(totals.profit)}
          note={`הוצאות ${nis(totals.expenses)}`}
        />
        <Figure
          label="בגבייה · ממתין להתקבל"
          value={nis(dash.openInvoices.total)}
          valueClass="text-warn"
          note={`${dash.openInvoices.count} חשבוניות פתוחות`}
        />
      </div>

      <div className="bg-surface border border-line rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="ser text-lg">הכנסות מול הוצאות · {year}</h2>
          <div className="flex items-center gap-3.5 text-[13px] text-muted">
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-accent" />הכנסות</span>
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-[#DDE0E6]" />הוצאות</span>
            <Link to="/overview" className="font-semibold text-accent">לסקירה המלאה ←</Link>
          </div>
        </div>
        <MiniBarChart rows={dash.monthly} />
      </div>
    </div>
  );
}

/** Tone → the colours a card wears. Kept as whole class names so Tailwind can see them. */
const TONES: Record<string, { bar: string; chip: string; amount: string }> = {
  neg: { bar: 'border-s-neg', chip: 'bg-neg-soft text-neg', amount: 'text-neg' },
  accent: { bar: 'border-s-accent', chip: 'bg-accent-soft text-accent-ink', amount: 'text-ink' },
  warn: { bar: 'border-s-warn', chip: 'bg-warn-soft text-warn-ink', amount: 'text-warn' },
  moon: { bar: 'border-s-moon', chip: 'bg-moon-soft text-moon', amount: 'text-ink' },
};

function ItemCard({ item }: { item: Item }) {
  const navigate = useNavigate();
  const tone = TONES[item.tone];
  const Icon = item.icon;
  return (
    <div
      className={clsx(
        'bg-surface border border-line border-s-[3px] rounded-2xl px-4 py-4 md:px-5',
        // On a phone the amount and the button drop to their own row rather than squeezing
        // the title into three lines beside them.
        'flex flex-col sm:flex-row sm:items-center gap-3 md:gap-4',
        tone.bar
      )}
    >
      <div className="flex items-center gap-3.5 flex-1 min-w-0">
        <div className={clsx('w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0', tone.chip)}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] md:text-base font-semibold">{item.title}</div>
          <div className="text-sm text-muted mt-0.5">{item.sub}</div>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
        {item.amount != null && (
          <div className={clsx('num ser text-lg md:text-xl', tone.amount)}>{nis(item.amount)}</div>
        )}
        <button
          onClick={() => navigate(item.to)}
          className={clsx(
            'rounded-[10px] px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition',
            item.primary
              ? 'bg-accent text-white hover:brightness-110'
              : 'bg-surface border border-line-strong text-ink-2 hover:bg-soft'
          )}
        >
          {item.cta}
        </button>
      </div>
    </div>
  );
}

function Figure({ label, value, note, valueClass }: {
  label: string;
  value: string;
  note?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-surface border border-line rounded-2xl px-4.5 py-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={clsx('num text-2xl font-extrabold tracking-[-0.03em] mt-1', valueClass || 'text-ink')}>{value}</div>
      {note && <div className="text-[13px] text-muted mt-1">{note}</div>}
    </div>
  );
}
