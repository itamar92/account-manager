import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Plus, X } from 'lucide-react';
import { get, nisExact } from '../../api';
import { FloatingWindow, Segmented, fieldClass } from '../../ui';
import { eventLabel } from './shared';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (raw: string) => {
  const value = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(value) ? value : 0;
};

/** The provision rate to fall back on when the year's own estimate is not available yet. */
const FALLBACK_TAX_RATE = 25;

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
  const [events, setEvents] = useState<any[]>([]);
  const [showExplainer, setShowExplainer] = useState(false);

  // The rate comes from settings rather than a constant here, so one change in הגדרות moves
  // every number in the app at once — and the tax provision starts from the year's own
  // projected effective rate rather than from a guess.
  useEffect(() => {
    if (!open) return;
    get('/settings')
      .then((d) => setVatPercent(String(Number(d.settings.vat_percent) || 18)))
      .catch(() => {});
    get(`/reports/income-tax?year=${new Date().getFullYear()}`)
      .then((d) => {
        const rate = d.report?.projection?.effective_rate ?? d.report?.estimate?.effective_rate;
        if (Number(rate) > 0) setTaxRate(String(Math.round(Number(rate) * 10) / 10));
      })
      .catch(() => {});
    get('/moonlight/events').then((d) => setEvents(d.events || [])).catch(() => {});
  }, [open]);

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
    }),
    [received, lines, vat, taxRate]
  );

  const setLine = (id: string, patch: Partial<CostLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

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
  };

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="מחשבון"
      icon={<Calculator size={16} />}
      storageKey="moonlight.calculator.pos"
      width={430}
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
              <input
                type="number" step="0.01" inputMode="decimal"
                value={received} onChange={(e) => setReceived(e.target.value)}
                placeholder="0.00" className={fieldClass}
              />
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
                <div className="w-[82px] shrink-0">
                  <input
                    type="number" step="0.01" inputMode="decimal" placeholder="0"
                    value={line.amount} onChange={(e) => setLine(line.id, { amount: e.target.value })}
                    className={`${fieldClass} text-[13px] px-2`}
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
            </div>
            <Result label={`מס והפרשות (על רווח ${nisExact(split.profit)})`} value={split.taxProvision} />
          </div>

          <div className="bg-soft rounded-xl p-3 space-y-1.5">
            <div className="text-[12.5px] font-semibold text-muted">ומה קורה בחשבון הלהקה</div>
            <Result label="תשלומים לספקים, פרסום ואחר" value={split.payables} />
            <Result label="יתרה לחלוקה בין החברים" value={split.leftover} strong />
          </div>

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
                מה שנשאר עובר ללהקה, משלם את הספקים והקמפיינים, והיתרה היא הרווח שמתחלק בין
                החברים. אם החברים מוציאים לך חשבונית על חלקם — הוסף אותה כשורה, כי גם היא הוצאה
                מוכרת שמקטינה את המס.
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

/**
 * How a payment that landed in the private account divides.
 *
 * The identity worth knowing is that the leftover comes out the same whichever way you read it:
 * `transfer − payables` equals `profit − tax`. So the band account, after it has paid everyone
 * it owes, holds exactly the show's profit after tax — which is the sum that gets divided
 * between the members. If that number is negative the show did not pay for itself.
 */
export function splitTransfer({ received, lines, vat, taxRate }: {
  received: number;
  lines: Array<{ amount: number; deductible: boolean }>;
  /** As a fraction — 0.18, not 18. */
  vat: number;
  /** As a fraction. */
  taxRate: number;
}) {
  const incomePreVat = received / (1 + vat);
  const outputVat = received - incomePreVat;

  let payables = 0;
  let inputVat = 0;
  let costPreVat = 0;
  for (const line of lines) {
    const gross = line.amount;
    // Without a tax invoice there is no VAT to reclaim, so the whole payment is the cost.
    const net = line.deductible ? gross / (1 + vat) : gross;
    payables += gross;
    inputVat += gross - net;
    costPreVat += net;
  }

  const vatDue = outputVat - inputVat;
  const profit = incomePreVat - costPreVat;
  const taxProvision = Math.max(0, profit) * taxRate;
  const keep = vatDue + taxProvision;

  return {
    incomePreVat: round2(incomePreVat),
    outputVat: round2(outputVat),
    inputVat: round2(inputVat),
    vatDue: round2(vatDue),
    profit: round2(profit),
    taxProvision: round2(taxProvision),
    keep: round2(keep),
    transfer: round2(received - keep),
    payables: round2(payables),
    leftover: round2(received - keep - payables),
  };
}
