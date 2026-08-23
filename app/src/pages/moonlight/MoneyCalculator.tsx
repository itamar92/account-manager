import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Plus, X } from 'lucide-react';
import { get, nisExact } from '../../api';
import { FloatingWindow, MoneyInput, Segmented, fieldClass } from '../../ui';
import { useAuth } from '../../AuthContext';
import { FUND_TRANSFERRED, eventLabel, useBandMembers, type BandMember } from './shared';
import { FALLBACK_TAX_RATE, fetchTransferRates, splitTransfer, type InvoiceKind } from './transfer';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (raw: string) => {
  const value = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(value) ? value : 0;
};

type Mode = 'vat' | 'transfer';

/** One thing the band account has to pay. `deductible` means it comes with a tax invoice. */
interface CostLine {
  id: string;
  label: string;
  amount: string;
  deductible: boolean;
}

/** What a fresh transfer sheet starts with — the three things the band account always pays. */
const startingLines = (): CostLine[] => [
  { id: 'c1', label: 'ספקים ונגנים', amount: '', deductible: true },
  { id: 'c2', label: 'קמפיינים ופרסום', amount: '', deductible: true },
  { id: 'c3', label: 'אקו"ם ואחר', amount: '', deductible: true },
];

let lineSeq = 0;
const newLine = (): CostLine => ({ id: `n${++lineSeq}`, label: '', amount: '', deductible: true });

const INVOICE_KINDS: Array<{ value: InvoiceKind; label: string }> = [
  { value: 'vat', label: 'חשבונית מס' },
  { value: 'exempt', label: 'פטור' },
  { value: 'none', label: 'ללא' },
];

/**
 * Whose books these are. The owner does not invoice himself, so his share is simply profit —
 * used only until the roster arrives and says which member holds the עוסק these books belong to.
 */
const OWNER_KEY = 'itamar';

interface MemberSplit {
  key: string;
  name: string;
  /** A weight, not a strict percentage — `splitTransfer` normalises whatever is entered. */
  share: string;
  invoice: InvoiceKind;
}

/**
 * What a member's business type means for the invoice they hand back: an עוסק מורשה's carries
 * מע"מ that can be reclaimed, an עוסק פטור's is deductible in full but carries none, and a
 * member registered as nothing has nothing deductible to give.
 */
const INVOICE_FOR_BUSINESS: Record<string, InvoiceKind> = {
  morshe: 'vat',
  patur: 'exempt',
  none: 'none',
};

/** Nothing until the roster arrives — who is in the band is not something to guess at. */
const startingMembers = (): MemberSplit[] => [];

/**
 * The roster as the band actually records it. Each member's invoice starts from their business
 * type rather than from an assumption, and the owner's row is the member holding the עוסק the
 * money is received into, matched by email so it follows whoever is signed in.
 */
const membersFromRoster = (roster: BandMember[], ownerEmail?: string): MemberSplit[] => {
  const active = roster.filter((m) => m.active);
  const owner = active.find((m) => ownerEmail && m.email
    && m.email.toLowerCase() === ownerEmail.toLowerCase());
  const ownerKey = owner?.member_key ?? OWNER_KEY;
  const even = active.length > 0 ? Math.round((100 / active.length) * 10) / 10 : 0;
  return active.map((m) => ({
    key: m.member_key,
    name: m.name,
    share: String(even),
    invoice: m.member_key === ownerKey ? 'none' : (INVOICE_FOR_BUSINESS[m.business_type] ?? 'none'),
  }));
};

/**
 * The pocket calculator for the two sums that come up while reading these pages.
 *
 * The first is arithmetic: a price quoted one side of מע"מ, wanted on the other. The second is
 * the question this app exists for — the money lands in the private account, but only part of
 * it is the band's. See `splitTransfer` for what that part is.
 */
export function MoneyCalculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('vat');
  const [vatPercent, setVatPercent] = useState('18');

  // --- מע"מ tab ---
  const [amount, setAmount] = useState('');
  const [side, setSide] = useState<'pre' | 'gross'>('pre');

  // --- transfer tab ---
  const [received, setReceived] = useState('');
  const [lines, setLines] = useState<CostLine[]>(startingLines);
  const [taxRate, setTaxRate] = useState(String(FALLBACK_TAX_RATE));
  const [members, setMembers] = useState<MemberSplit[]>(startingMembers);
  const [ownerKey, setOwnerKey] = useState(OWNER_KEY);
  // Off by default: the ordinary transfer is one figure moved into the band account, and what
  // each member ends up with is settled later, from the whole period rather than one show.
  const [splitToMembers, setSplitToMembers] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [showExplainer, setShowExplainer] = useState(false);

  // The rate comes from settings rather than a constant here, so one change in הגדרות moves
  // every number in the app at once — and the tax provision starts from the year's own
  // projected effective rate rather than from a guess.
  useEffect(() => {
    if (!open) return;
    fetchTransferRates().then(({ vatPercent, taxRate }) => {
      setVatPercent(String(vatPercent));
      setTaxRate(String(taxRate));
    });
    // Only the shows still to be transferred: once a show's money has moved into the band
    // account there is nothing left here to work out for it, and a list of every show the band
    // has ever played is a list you have to remember your way through.
    get('/moonlight/events')
      .then((d) => setEvents((d.events || []).filter((e: any) => e.payment_status !== FUND_TRANSFERRED)))
      .catch(() => {});
  }, [open]);

  // The roster decides who is in the split, what each one's invoice is worth, and which row is
  // yours. It is adopted whenever it changes rather than merged into what is on screen: the
  // shares here are a starting point for one sheet, and a member's business type changing is a
  // fact about the band, not an edit to be preserved against it.
  const { user } = useAuth();
  const { members: roster } = useBandMembers();
  useEffect(() => {
    if (roster.length === 0) return;
    setMembers(membersFromRoster(roster, user?.email));
    const owner = roster.find((m) => user?.email && m.email
      && m.email.toLowerCase() === user.email.toLowerCase());
    setOwnerKey(owner?.member_key ?? OWNER_KEY);
  }, [roster, user?.email]);

  const vat = Math.max(0, num(vatPercent)) / 100;

  const converted = useMemo(() => {
    const value = num(amount);
    const pre = side === 'pre' ? value : value / (1 + vat);
    return { pre: round2(pre), vat: round2(pre * vat), gross: round2(pre * (1 + vat)) };
  }, [amount, side, vat]);

  const split = useMemo(
    () => splitTransfer({
      received: num(received),
      lines: lines.map((l) => ({ amount: num(l.amount), deductible: l.deductible })),
      vat,
      taxRate: Math.max(0, num(taxRate)) / 100,
      members: splitToMembers
        ? members.map((m) => ({ share: num(m.share), invoice: m.invoice }))
        : [],
    }),
    [received, lines, vat, taxRate, members, splitToMembers]
  );

  // The weights are normalised before they are used, so a row that does not add to 100 still
  // produces coherent numbers — but it is almost always a typo, so it is worth saying.
  const shareTotal = members.reduce((sum, m) => sum + num(m.share), 0);

  // What is left once the invoices are paid is the owner's profit after tax — but it is his
  // alone only when nobody else is sitting in the same untaxed pile.
  const ownerAlone = members.every((m) => m.key === ownerKey || m.invoice !== 'none');

  const setLine = (id: string, patch: Partial<CostLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const setMember = (key: string, patch: Partial<MemberSplit>) =>
    setMembers((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  /**
   * Filling the sheet from a show, which is where most of these transfers come from: its fee
   * is what landed in the private account, and its costs are what the band account owes.
   */
  const fillFromEvent = (id: string) => {
    const event = events.find((e) => String(e.id) === id);
    if (!event) return;
    setReceived(String(event.amount_with_vat || 0));
    setLines([
      { id: 'e1', label: `הוצאות ${event.venue}`, amount: String(event.expenses || 0), deductible: true },
    ]);
    // The show already knows how it divides — a producer fee makes that 30/30/20/20 rather
    // than an even four ways — so the split follows it instead of being re-entered by hand.
    // Read off the rows on screen rather than the built-in four, so an inactive member is not
    // handed a share of a show they had no part in.
    setMembers((prev) => {
      const total = prev.reduce((sum, m) => sum + (Number(event.shares?.[m.key]) || 0), 0);
      if (total <= 0) return prev;
      return prev.map((m) => ({
        ...m,
        share: String(Math.round(((Number(event.shares?.[m.key]) || 0) / total) * 1000) / 10),
      }));
    });
  };

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="מחשבון"
      icon={<Calculator size={16} />}
      storageKey="moonlight.calculator.pos"
      width={460}
    >
      <Segmented
        className="w-full mb-4"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'vat', label: 'מע"מ' },
          { value: 'transfer', label: 'העברה ללהקה' },
        ]}
      />

      {mode === 'vat' && (
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <label className="block flex-1">
              <span className="block text-[13px] text-muted mb-1.5">סכום</span>
              <input
                type="number" step="0.01" inputMode="decimal" autoFocus
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" className={fieldClass}
              />
            </label>
            <label className="block w-24">
              <span className="block text-[13px] text-muted mb-1.5">מע"מ %</span>
              <input
                type="number" step="0.1" inputMode="decimal"
                value={vatPercent} onChange={(e) => setVatPercent(e.target.value)}
                className={fieldClass}
              />
            </label>
          </div>

          <Segmented
            className="w-full"
            value={side}
            onChange={setSide}
            options={[
              { value: 'pre', label: 'הסכום לפני מע"מ' },
              { value: 'gross', label: 'הסכום כולל מע"מ' },
            ]}
          />

          {/* Both directions are the same three numbers, so the answer to either question is
              already on screen — you pick which one you typed, not which one you want. */}
          <div className="bg-soft rounded-xl p-3 space-y-1.5">
            <Result label='לפני מע"מ' value={converted.pre} muted={side === 'pre'} />
            <Result label={`מע"מ ${num(vatPercent)}%`} value={converted.vat} />
            <Result label='כולל מע"מ' value={converted.gross} muted={side === 'gross'} strong />
          </div>
        </div>
      )}

      {mode === 'transfer' && (
        <div className="space-y-3.5">
          <div>
            <label className="block">
              <span className="block text-[13px] text-muted mb-1.5">
                התקבל לחשבון הפרטי (כולל מע"מ)
              </span>
              <MoneyInput value={received} onChange={setReceived} placeholder="0.00" />
            </label>
            {events.length > 0 && (
              <select
                value=""
                onChange={(e) => { fillFromEvent(e.target.value); e.target.value = ''; }}
                className={`${fieldClass} mt-1.5 text-[13px] text-muted`}
              >
                <option value="">מילוי מהופעה…</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>{eventLabel(e)}</option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted">תשלומים שיוצאים מחשבון הלהקה</span>
              <button
                type="button" onClick={() => setLines((p) => [...p, newLine()])}
                className="flex items-center gap-1 text-[13px] text-accent font-semibold"
              >
                <Plus size={13} /> שורה
              </button>
            </div>
            {/* Each field is wrapped rather than sized directly: `fieldClass` carries `w-full`,
                which as a flex item would make every input claim the whole row. */}
            {lines.map((line) => (
              <div key={line.id} className="flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  <input
                    value={line.label} placeholder="תיאור"
                    onChange={(e) => setLine(line.id, { label: e.target.value })}
                    className={`${fieldClass} text-[13px]`}
                  />
                </div>
                {/* Wide enough for a five-figure cost with its separators — a hall fee scrolled
                    out of its own box reads as a plausible smaller number, silently. */}
                <div className="w-[104px] shrink-0">
                  <MoneyInput
                    value={line.amount} placeholder="0"
                    onChange={(value) => setLine(line.id, { amount: value })}
                    className="text-[13px] px-2"
                  />
                </div>
                {/* Whether the VAT inside this line can be reclaimed — which is what decides
                    both how much has to stay behind for מע"מ and what the line really cost. */}
                <button
                  type="button"
                  onClick={() => setLine(line.id, { deductible: !line.deductible })}
                  title={line.deductible
                    ? 'יש חשבונית מס — המע"מ בשורה זו מתקזז'
                    : 'ללא חשבונית מס — אין מה לקזז'}
                  className={`shrink-0 w-11 py-2 rounded-lg text-[12px] font-semibold border transition-colors ${
                    line.deductible
                      ? 'bg-accent-soft border-accent-soft text-accent-ink'
                      : 'bg-soft border-line text-ghost'
                  }`}
                >
                  מע"מ
                </button>
                <button
                  type="button" onClick={() => setLines((p) => p.filter((l) => l.id !== line.id))}
                  className="shrink-0 text-faint hover:text-neg p-0.5"
                  title="מחיקת שורה"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-muted">הפרשה למס והפרשות (%)</span>
            <span className="w-[76px] shrink-0">
              <input
                type="number" step="0.1" inputMode="decimal"
                value={taxRate} onChange={(e) => setTaxRate(e.target.value)}
                className={`${fieldClass} text-center px-2`}
              />
            </span>
          </label>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox" checked={splitToMembers} className="accent-accent"
                onChange={(e) => setSplitToMembers(e.target.checked)}
              />
              חלוקה לחברים, והחשבוניות שלהם
            </label>
            {splitToMembers && (
              <>
                {members.map((m) => (
                  <div key={m.key} className="flex items-center gap-1.5">
                    <span className="flex-1 min-w-0 text-[13px] text-ink-2 truncate">{m.name}</span>
                    <div className="w-[58px] shrink-0">
                      <input
                        type="number" step="0.1" inputMode="decimal"
                        value={m.share} onChange={(e) => setMember(m.key, { share: e.target.value })}
                        className={`${fieldClass} text-[13px] text-center px-1`}
                      />
                    </div>
                    <span className="text-[12px] text-faint shrink-0">%</span>
                    {/* The owner is the עוסק these books belong to; he cannot invoice himself,
                        so his share is simply the profit that is left once the others have. */}
                    {m.key === ownerKey ? (
                      <span className="w-[124px] shrink-0 text-[12px] text-faint text-center">
                        החלק שלך
                      </span>
                    ) : (
                      <div className="w-[124px] shrink-0">
                        <select
                          value={m.invoice}
                          onChange={(e) => setMember(m.key, { invoice: e.target.value as InvoiceKind })}
                          className={`${fieldClass} text-[12px] px-1.5`}
                        >
                          {INVOICE_KINDS.map((k) => (
                            <option key={k.value} value={k.value}>{k.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
                {Math.abs(shareTotal - 100) > 0.5 && (
                  <p className="text-[12px] text-warn">
                    החלקים מסתכמים ב־{Math.round(shareTotal * 10) / 10}% — הם מחולקים ביחס
                    ביניהם, אך כנראה נפלה טעות.
                  </p>
                )}
              </>
            )}
          </div>

          {/* The answer, and then the two piles it was made of. */}
          <div className="bg-ink text-white rounded-xl p-3.5">
            <div className="text-[13px] text-white/70">להעביר לחשבון הלהקה</div>
            <div className="num text-2xl font-extrabold tracking-[-0.03em] mt-0.5">
              {nisExact(split.transfer)}
            </div>
            <div className="text-[13px] text-white/70 mt-1.5">
              להשאיר בחשבון הפרטי {nisExact(split.keep)}
            </div>
          </div>

          <div className="bg-soft rounded-xl p-3 space-y-1.5">
            <div className="text-[12.5px] font-semibold text-muted">מה נשאר בפרטי, ולמה</div>
            <Result label='מע"מ לתשלום' value={split.vatDue} />
            <div className="text-[12px] text-faint -mt-1">
              עסקאות {nisExact(split.outputVat)} פחות תשומות {nisExact(split.inputVat)}
              {split.memberInputVat > 0 && ` (מתוכן ${nisExact(split.memberInputVat)} מהחברים)`}
            </div>
            <Result label={`מס והפרשות (על רווח ${nisExact(split.profit)})`} value={split.taxProvision} />
          </div>

          <div className="bg-soft rounded-xl p-3 space-y-1.5">
            <div className="text-[12.5px] font-semibold text-muted">ומה קורה בחשבון הלהקה</div>
            <Result label="תשלומים לספקים, פרסום ואחר" value={split.payables} />
            <Result label="יתרה לחלוקה בין החברים" value={split.leftover} strong />
            {splitToMembers && split.leftover > 0 && (
              <>
                <div className="grid grid-cols-4 gap-2 pt-1.5">
                  {members.map((m, i) => (
                    <div key={m.key} className="text-center">
                      <div className="text-[12px] text-faint">{m.name}</div>
                      <div className="num text-[13.5px] font-medium text-accent">
                        {nisExact(split.shares[i] ?? 0)}
                      </div>
                      <div className="text-[11px] text-ghost">
                        {m.key === ownerKey ? 'שלך' :
                          INVOICE_KINDS.find((k) => k.value === m.invoice)?.label}
                      </div>
                    </div>
                  ))}
                </div>
                {split.memberGross > 0 && (
                  <p className="text-[12px] text-faint pt-1">
                    מתוך זה {nisExact(split.memberGross)} חוזר אליך כחשבוניות — הוצאה מוכרת
                    שכבר נלקחה בחשבון במס ובמע"מ שלמעלה. מה שנשאר אחריהן הוא בדיוק הרווח שלך אחרי מס
                    {ownerAlone ? '' : ', יחד עם חלקם של מי שלא הוציא חשבונית'}.
                  </p>
                )}
              </>
            )}
          </div>

          {/* The floor in `splitTransfer` bit: saying so is the whole point of it, otherwise the
              answer silently stops being «received minus what stays behind». */}
          {split.capped && (
            <p className="text-[13px] text-body bg-soft rounded-xl px-3 py-2">
              העלויות גדולות מההכנסה, ולכן המע"מ שבהן גדול מהמע"מ שנגבה. מועבר כל מה שהתקבל,
              {' '}{nisExact(num(received))}, ולא יותר — עודף המע"מ חוזר בדוח המע"מ התקופתי,
              ולא מההופעה הזו.
            </p>
          )}

          {split.leftover < 0 && (
            <p className="text-[13px] text-neg bg-neg-soft rounded-xl px-3 py-2">
              ההעברה קטנה מהתשלומים ב־{nisExact(-split.leftover)} — ההופעה הזו לא מכסה את
              עלויותיה, או שחלק מהתשלומים שייכים להכנסה שטרם התקבלה.
            </p>
          )}

          <button
            type="button" onClick={() => setShowExplainer((v) => !v)}
            className="text-[13px] text-accent font-semibold"
          >
            {showExplainer ? 'הסתרת ההסבר' : 'איך זה מחושב?'}
          </button>
          {showExplainer && (
            <div className="text-[12.5px] text-body leading-relaxed bg-surface border border-line rounded-xl p-3 space-y-2">
              <p>
                הכסף שנכנס לחשבון הפרטי אינו כולו של הלהקה: חלק ממנו הוא מע"מ שגבית עבור המדינה,
                וחלק הוא המס על הרווח. שניהם משולמים מהחשבון הפרטי, ולכן נשארים בו.
              </p>
              <p>
                <b>מע"מ לתשלום</b> = המע"מ שבתוך הסכום שהתקבל, פחות המע"מ שבתוך התשלומים שיש להם
                חשבונית מס. תשלום ללא חשבונית אינו מקטין את המע"מ, ולכן מסומן כך בשורה שלו.
              </p>
              <p>
                <b>מס והפרשות</b> = האחוז שלמעלה כפול הרווח, כשהרווח הוא ההכנסה ללא מע"מ פחות
                העלויות ללא מע"מ. האחוז נטען מהתחזית השנתית שבדוחות, וניתן לשנותו.
              </p>
              <p>
                מה שנשאר עובר ללהקה, משלם את הספקים והקמפיינים, והיתרה מתחלקת בין החברים.
              </p>
              <p>
                כשההופעה הפסידה, המע"מ שבעלויות גדול מזה שבהכנסה, ו«מה שנשאר» יוצא שלילי —
                כלומר יש להעביר יותר ממה שהתקבל. אי אפשר להעביר כסף שלא נכנס, ולכן במקרה הזה
                מועבר הסכום שהתקבל במלואו. ההפרש אינו אובד: הוא מתקזז בדוח המע"מ של התקופה.
              </p>
              <p>
                <b>חשבוניות החברים</b> נכנסות לחישוב עצמו. חלקו של חבר שמוציא לך חשבונית הוא
                הוצאה מוכרת: הוא מקטין את המס, ואם זו חשבונית מס — גם את המע"מ. זה מגדיל את
                הסכום שאפשר להעביר, שמגדיל את היתרה, שמגדילה שוב את החשבוניות. המחשבון פותר את
                המעגל הזה במלואו ולא בקירוב, ולכן החלק שלך יוצא תמיד בדיוק הרווח שלך אחרי מס.
              </p>
              <p>
                «פטור» הוא חבר שהוא עוסק פטור: החשבונית שלו מוכרת במלואה אך אין בה מע"מ לקזז.
                «ללא» הוא חבר שלא מוציא כלום — חלקו אינו הוצאה מוכרת, ולכן אתה משלם עליו מס.
              </p>
            </div>
          )}
        </div>
      )}
    </FloatingWindow>
  );
}

/** One figure with its name, and a click that copies the bare number for pasting elsewhere. */
function Result({ label, value, strong, muted }: {
  label: string;
  value: number;
  strong?: boolean;
  /** The side you typed: shown, but not as an answer. */
  muted?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value.toFixed(2)).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1200); },
      () => {}
    );
  };
  return (
    <button type="button" onClick={copy} title="העתקה" className="flex justify-between w-full gap-3 group">
      <span className="text-[13px] text-muted text-start">{label}</span>
      <span className={`num text-[14.5px] whitespace-nowrap ${
        muted ? 'text-muted' : strong ? 'font-bold text-accent' : 'font-medium text-ink'
      }`}>
        {copied ? 'הועתק' : nisExact(value)}
      </span>
    </button>
  );
}
