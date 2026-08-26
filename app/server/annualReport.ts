/**
 * הדוח השנתי — what a full טופס 1301 assessment is shaping up to look like.
 *
 * The מס הכנסה report next door answers "what does this business owe on its profit". That is
 * not the question the annual return answers. A return is filed by a *person*, and the tax on
 * a business's profit depends entirely on what else that person earned: a profit of 115,000 is
 * taxed from the bottom bracket for someone with no other income, and at 35% for someone who
 * also draws a salary. The same profit, twice the tax, and the difference does not appear
 * anywhere in the books.
 *
 * So this report has two halves. The **computed** half comes from the books, the way every
 * other report here does. The **declared** half — salary, מילואים, deposits, what was already
 * withheld and paid — is entered once a year from טופס 106, the ביטוח לאומי certificate and
 * the קופות' annual statements, because no amount of reading the business's own documents can
 * discover it.
 *
 * The number the whole thing is built to produce is the last one: יתרה לתשלום. Not the total
 * liability, which is unactionable, but what will actually be owed once everything already
 * withheld and paid in advance is taken off — the figure that decides whether next June is a
 * quiet month or an expensive one.
 *
 * It is an estimate and not a return. Ceilings on the pension deductions and credits are the
 * part most likely to differ from an accountant's, so every one of them can be overridden with
 * the figure the assessment actually allowed, and says on screen whether it is showing an
 * estimate or an allowed figure.
 */
import { db, uuid } from './db.js';
import { getCreditPoints, monthlyPnl, pnlTotals, ratesFor, bracketTax, nationalInsurance, listFilings, type TaxFiling, type YearRates } from './reports.js';
import { creditBreakdown, getCreditStatus, type CreditBreakdown } from './creditPoints.js';
import { reconcile, type Reconciliation } from './taxAdjustments.js';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? round2(n) : 0;
};
/** An override that was left blank stays blank — it is "not stated", not zero. */
const optional = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : num(v);

// ---------------------------------------------------------------------------
// the declared side
// ---------------------------------------------------------------------------

export interface AnnualProfile {
  year: number;
  /** טופס 106: gross salary (field 158) and the tax withheld from it (field 042). */
  salary: number;
  salary_withheld: number;
  /** אישור ביטוח לאומי: תגמולי מילואים and the tax withheld from them (field 040). */
  miluim: number;
  miluim_withheld: number;
  /** Anything else — rent on the marginal track, interest, a second employer. */
  other_income: number;
  other_withheld: number;
  /**
   * The accountant's רווח מותאם, where it is known. Left blank the books' own profit is used,
   * which is the right figure until תיאומים and פחת are modelled.
   */
  business_income_override: number | null;
  /** קרן השתלמות לעצמאי — deposited, and (if the assessment said so) what was allowed. */
  keren_hishtalmut_paid: number;
  keren_hishtalmut_allowed: number | null;
  /** קופת גמל לקצבה כעמית עצמאי, s.47 — deposited, and what was allowed. */
  pension_atzmai_paid: number;
  pension_atzmai_allowed: number | null;
  /** ביטוח לאומי actually paid on the business income; 52% of it is deductible. */
  ni_paid: number;
  /** קופת גמל לקצבה כשכיר, the employee's own side — s.45A credit at 35%. */
  pension_sachir_paid: number;
  pension_sachir_allowed: number | null;
  /** ביטוח חיים / אובדן כושר עבודה premiums — s.45A credit at 25%. */
  life_insurance_paid: number;
  /** תרומות to a s.46-recognised institution. */
  donations_paid: number;
  /** מקדמות מס הכנסה paid over the year. */
  mikdamot_paid: number;
  /** Overrides the calculator, for a year whose assessment used a different number. */
  credit_points_override: number | null;
  /**
   * When the return is actually due, where it is known. Blank falls back to the online filing
   * date — a filer represented by a CPA has a later date from the מייצגים quota, which only the
   * CPA knows and this app should not guess.
   */
  file_by: string | null;
  /**
   * Whether to apply this app's own recognition rates on top of Morning's when reconciling.
   * Off leaves the profit exactly as the books have it; on brings it closer to what an
   * assessor will allow, which is the more useful default for a report about the future.
   */
  apply_recognition_rates: boolean;
  notes: string;
  updated_at: string | null;
}

const PROFILE_NUMBERS = [
  'salary', 'salary_withheld', 'miluim', 'miluim_withheld', 'other_income', 'other_withheld',
  'keren_hishtalmut_paid', 'pension_atzmai_paid', 'ni_paid', 'pension_sachir_paid',
  'life_insurance_paid', 'donations_paid', 'mikdamot_paid',
] as const;

const PROFILE_OPTIONALS = [
  'business_income_override', 'keren_hishtalmut_allowed', 'pension_atzmai_allowed',
  'pension_sachir_allowed', 'credit_points_override',
] as const;

export function emptyProfile(year: number): AnnualProfile {
  return {
    year,
    salary: 0, salary_withheld: 0, miluim: 0, miluim_withheld: 0, other_income: 0, other_withheld: 0,
    business_income_override: null,
    keren_hishtalmut_paid: 0, keren_hishtalmut_allowed: null,
    pension_atzmai_paid: 0, pension_atzmai_allowed: null,
    ni_paid: 0,
    pension_sachir_paid: 0, pension_sachir_allowed: null,
    life_insurance_paid: 0, donations_paid: 0, mikdamot_paid: 0,
    credit_points_override: null,
    file_by: null,
    apply_recognition_rates: true,
    notes: '', updated_at: null,
  };
}

export function getProfile(year: number): AnnualProfile {
  const row = db.prepare('SELECT * FROM annual_tax_profile WHERE year = ?').get(year) as any;
  if (!row) return emptyProfile(year);
  const profile = emptyProfile(year);
  for (const key of PROFILE_NUMBERS) profile[key] = num(row[key]);
  for (const key of PROFILE_OPTIONALS) profile[key] = optional(row[key]);
  profile.apply_recognition_rates = row.apply_recognition_rates !== 0;
  profile.file_by = row.file_by || null;
  profile.notes = row.notes ?? '';
  profile.updated_at = row.updated_at ?? null;
  return profile;
}

/**
 * Writes the declared figures for a year. Only the keys the caller sends are touched, so
 * filling in the מקדמות in November does not blank the salary typed in from טופס 106 in March.
 */
export function saveProfile(year: number, input: Record<string, unknown>): AnnualProfile {
  const current = getProfile(year);
  const next: AnnualProfile = { ...current, year };
  for (const key of PROFILE_NUMBERS) {
    if (input[key] !== undefined) next[key] = Math.max(0, num(input[key]));
  }
  for (const key of PROFILE_OPTIONALS) {
    if (input[key] !== undefined) {
      const value = optional(input[key]);
      next[key] = value === null ? null : Math.max(0, value);
    }
  }
  if (input.apply_recognition_rates !== undefined) {
    next.apply_recognition_rates = !!input.apply_recognition_rates;
  }
  if (input.file_by !== undefined) {
    const value = String(input.file_by ?? '').trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw Object.assign(new Error('מועד ההגשה חייב להיות תאריך תקין'), { status: 400 });
    }
    next.file_by = value || null;
  }
  if (input.notes !== undefined) next.notes = String(input.notes ?? '').trim();
  next.updated_at = new Date().toISOString().slice(0, 10);

  const columns = [
    ...PROFILE_NUMBERS, ...PROFILE_OPTIONALS,
    'apply_recognition_rates', 'file_by', 'notes', 'updated_at',
  ] as const;
  db.prepare(
    `INSERT INTO annual_tax_profile (id, year, ${columns.join(', ')})
     VALUES (?, ?, ${columns.map(() => '?').join(', ')})
     ON CONFLICT(year) DO UPDATE SET ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}`
  ).run(
    uuid(), year,
    ...columns.map((c) => {
      const value = next[c as keyof AnnualProfile];
      return typeof value === 'boolean' ? (value ? 1 : 0) : (value as any);
    })
  );

  return next;
}

// ---------------------------------------------------------------------------
// the ceilings
// ---------------------------------------------------------------------------

/**
 * How much of a deposit or premium the return is likely to let through.
 *
 * These are simplified. The real ceilings under ss.17(5א), 47 and 45A turn on הכנסה מזכה,
 * which is itself capped, split between the salaried and self-employed sides, and reduced by
 * whatever an employer already deposited — enough moving parts that a faithful implementation
 * would be a small project of its own and a wrong one would be worse than an honest
 * approximation. So each of these is offered as a *suggestion*, marked as such on screen, and
 * is overridden the moment the assessment says what was actually allowed.
 */
export interface AllowedFigure {
  paid: number;
  allowed: number;
  /** true where `allowed` is this module's estimate rather than a figure entered from a שומה. */
  estimated: boolean;
  note: string;
}

const resolve = (paid: number, override: number | null, estimate: number, note: string): AllowedFigure =>
  override !== null
    ? { paid, allowed: Math.min(override, paid), estimated: false, note: 'לפי השומה' }
    : { paid, allowed: round2(Math.max(0, Math.min(paid, estimate))), estimated: true, note };

/** s.17(5א): a self-employed קרן השתלמות deduction of 4.5% of business income, within a ceiling. */
function kerenHishtalmut(profile: AnnualProfile, businessIncome: number): AllowedFigure {
  return resolve(
    profile.keren_hishtalmut_paid,
    profile.keren_hishtalmut_allowed,
    businessIncome * 0.045,
    'הערכה: 4.5% מההכנסה מהעסק',
  );
}

/** s.47: a self-employed pension deduction, taken here at the 11% of business income tier. */
function pensionDeduction(profile: AnnualProfile, businessIncome: number): AllowedFigure {
  return resolve(
    profile.pension_atzmai_paid,
    profile.pension_atzmai_allowed,
    businessIncome * 0.11,
    'הערכה: 11% מההכנסה מהעסק',
  );
}

/** s.45A: the employee's own pension side, credited at 35% of up to 7% of the salary. */
function pensionCredit(profile: AnnualProfile): AllowedFigure {
  return resolve(
    profile.pension_sachir_paid,
    profile.pension_sachir_allowed,
    profile.salary * 0.07,
    'הערכה: 7% מהמשכורת',
  );
}

// ---------------------------------------------------------------------------
// the ladder
// ---------------------------------------------------------------------------

export interface LadderLine {
  key: string;
  label: string;
  amount: number;
  /** Where the figure came from, which is the thing to know before trusting it. */
  origin: 'computed' | 'declared' | 'estimated';
  note?: string;
}

export type AnnualBasis = 'ytd' | 'projected';

export interface AnnualAssessment {
  year: number;
  rates_year: number;
  rates_note: string | null;
  basis: AnnualBasis;
  months_elapsed: number;

  income: LadderLine[];
  total_income: number;
  deductions: LadderLine[];
  total_deductions: number;
  taxable_income: number;

  gross_tax: number;
  credits: LadderLine[];
  total_credits: number;
  tax_due: number;

  payments: LadderLine[];
  total_payments: number;
  /** Positive is owed to the Tax Authority, negative is a refund. */
  balance: number;

  /** ביטוח לאומי on the business income, which the return itself does not compute. */
  national_insurance: number;
  ni_note: string;

  credit_points: number;
  credit_breakdown: CreditBreakdown | null;
  /** The marginal rate the next shekel of profit meets — the number worth acting on. */
  marginal_rate: number;
  business_income: number;
  /** How the books' profit became the profit the return is filed on. */
  reconciliation: Reconciliation;
  profile: AnnualProfile;
  filing: TaxFiling | null;
  deadline: AnnualDeadline;
}

/** The marginal rate at a given taxable income, read straight off the bands. */
function marginalRate(taxable: number, rates: YearRates): number {
  let previous = 0;
  for (const band of rates.brackets) {
    if (taxable <= band.upTo) return band.rate;
    previous = band.upTo;
  }
  return rates.brackets[rates.brackets.length - 1].rate;
}

export function annualAssessment(year: number, basis: AnnualBasis = 'projected'): AnnualAssessment {
  const rates = ratesFor(year);
  const profile = getProfile(year);
  const filing = listFilings('income_tax', year).get(String(year)) ?? null;

  // How much of the year the books have actually seen. A year still running is projected from
  // the months that closed, the same way the מס הכנסה report does it — otherwise a report
  // opened in March reads as if the year earned two months' worth and stopped.
  const now = new Date();
  const elapsed = now.getFullYear() > year ? 12 : now.getFullYear() < year ? 0 : now.getMonth() + 1;
  const totals = pnlTotals(monthlyPnl(`${year}-01-01`, `${year}-12-31`));
  const useProjection = basis === 'projected' && elapsed > 0 && elapsed < 12;
  const bookProfit = useProjection ? round2((totals.profit / elapsed) * 12) : totals.profit;

  // Books → return. Depreciation and the add-back are actual figures for the year whichever
  // basis is in use: a purchase happened or it did not, and projecting it would invent
  // equipment. Only the profit they are applied to is run-rated.
  const reconciliation = reconcile(year, bookProfit, profile.apply_recognition_rates);
  const businessIncome = Math.max(0, profile.business_income_override ?? reconciliation.adjusted_profit);

  // --- א. הכנסות ---------------------------------------------------------
  const income: LadderLine[] = [
    {
      key: 'business',
      label: 'עסק/משלח יד',
      amount: businessIncome,
      origin: profile.business_income_override !== null ? 'declared' : 'computed',
      note: profile.business_income_override !== null
        ? 'רווח מותאם שהוזן ידנית'
        : reconciliation.lines.length > 0
        ? `רווח מותאם${useProjection ? ` · תחזית לפי ${elapsed} חודשים` : ''} — ראו את התיאום למטה`
        : useProjection
        ? `תחזית שנתית לפי ${elapsed} חודשים`
        : 'מהספרים',
    },
  ];
  if (profile.salary > 0) {
    income.push({ key: 'salary', label: 'משכורת', amount: profile.salary, origin: 'declared', note: 'טופס 106' });
  }
  if (profile.miluim > 0) {
    income.push({ key: 'miluim', label: 'תגמולי מילואים', amount: profile.miluim, origin: 'declared', note: 'אישור ביטוח לאומי' });
  }
  if (profile.other_income > 0) {
    income.push({ key: 'other', label: 'הכנסות אחרות', amount: profile.other_income, origin: 'declared' });
  }
  const totalIncome = round2(income.reduce((s, l) => s + l.amount, 0));

  // --- ב. ניכויים --------------------------------------------------------
  const keren = kerenHishtalmut(profile, businessIncome);
  const pension = pensionDeduction(profile, businessIncome);
  const niDeduction = round2(profile.ni_paid * rates.niDeductibleShare);

  const deductions: LadderLine[] = [];
  if (keren.paid > 0) {
    deductions.push({
      key: 'keren', label: 'קרן השתלמות לעצמאי', amount: keren.allowed,
      origin: keren.estimated ? 'estimated' : 'declared',
      note: `הופקדו ${Math.round(keren.paid).toLocaleString('he-IL')} · ${keren.note}`,
    });
  }
  if (pension.paid > 0) {
    deductions.push({
      key: 'pension', label: 'קופת גמל לקצבה — עמית עצמאי', amount: pension.allowed,
      origin: pension.estimated ? 'estimated' : 'declared',
      note: `הופקדו ${Math.round(pension.paid).toLocaleString('he-IL')} · ${pension.note} (סעיף 47)`,
    });
  }
  if (niDeduction > 0) {
    deductions.push({
      key: 'ni', label: 'ניכוי 52% מביטוח לאומי', amount: niDeduction, origin: 'declared',
      note: `מתוך ${Math.round(profile.ni_paid).toLocaleString('he-IL')} ששולמו כעצמאי`,
    });
  }
  const totalDeductions = round2(deductions.reduce((s, l) => s + l.amount, 0));
  const taxable = Math.max(0, round2(totalIncome - totalDeductions));

  // --- ג-ד. מס וזיכויים ---------------------------------------------------
  const grossTax = bracketTax(taxable, rates);

  const points = profile.credit_points_override ?? getCreditPoints(year);
  const status = getCreditStatus();
  const breakdown = status && profile.credit_points_override === null
    ? creditBreakdown(status, year)
    : null;

  const credits: LadderLine[] = [{
    key: 'points',
    label: `נקודות זיכוי (${points})`,
    amount: round2(points * rates.creditPointValue),
    origin: profile.credit_points_override !== null ? 'declared' : 'computed',
    note: breakdown ? 'לפי מחשבון נקודות הזיכוי בהגדרות' : undefined,
  }];

  const sachir = pensionCredit(profile);
  if (sachir.paid > 0) {
    credits.push({
      key: 'pension_sachir', label: 'זיכוי קופת גמל לקצבה — שכיר', amount: round2(sachir.allowed * 0.35),
      origin: sachir.estimated ? 'estimated' : 'declared',
      note: `35% מתוך ${Math.round(sachir.allowed).toLocaleString('he-IL')} מוכרים · ${sachir.note} (סעיף 45א)`,
    });
  }
  if (profile.life_insurance_paid > 0) {
    credits.push({
      key: 'life', label: 'זיכוי ביטוח חיים', amount: round2(profile.life_insurance_paid * 0.25),
      origin: 'declared', note: '25% מהפרמיה (סעיף 45א)',
    });
  }
  if (profile.donations_paid > 0) {
    // s.46: nothing below the annual floor counts, and the credit is capped at 30% of taxable
    // income. The floor applies to the year's donations together, not to each one.
    const floor = 207;
    const eligible = profile.donations_paid >= floor
      ? Math.min(profile.donations_paid, taxable * 0.3)
      : 0;
    credits.push({
      key: 'donations', label: 'זיכוי תרומות', amount: round2(eligible * 0.35),
      origin: 'estimated',
      note: eligible > 0
        ? `35% מתוך ${Math.round(eligible).toLocaleString('he-IL')} · מוסד מוכר לפי סעיף 46 בלבד`
        : `מתחת לרף המינימלי של ${floor} ₪ לשנה`,
    });
  }
  const totalCredits = round2(credits.reduce((s, l) => s + l.amount, 0));
  // Credit points cannot take the liability below zero — they reduce tax, they do not refund it.
  const taxDue = Math.max(0, round2(grossTax - totalCredits));

  // --- ה. תשלומים --------------------------------------------------------
  const payments: LadderLine[] = [];
  if (profile.salary_withheld > 0) {
    payments.push({ key: 'salary_withheld', label: 'ניכוי במקור ממשכורת', amount: profile.salary_withheld, origin: 'declared', note: 'טופס 106' });
  }
  if (profile.miluim_withheld > 0) {
    payments.push({ key: 'miluim_withheld', label: 'ניכוי במקור ממילואים', amount: profile.miluim_withheld, origin: 'declared' });
  }
  if (profile.other_withheld > 0) {
    payments.push({ key: 'other_withheld', label: 'ניכוי במקור אחר', amount: profile.other_withheld, origin: 'declared' });
  }
  if (profile.mikdamot_paid > 0) {
    payments.push({ key: 'mikdamot', label: 'מקדמות מס הכנסה', amount: profile.mikdamot_paid, origin: 'declared' });
  }
  const totalPayments = round2(payments.reduce((s, l) => s + l.amount, 0));

  // --- ו. ביטוח לאומי ------------------------------------------------------
  // Charged on the business income alone, and only on what the salary has not already insured.
  const ni = nationalInsurance(businessIncome, rates, profile.salary);

  return {
    year,
    rates_year: rates.rates_year,
    rates_note: rates.provisional ?? null,
    basis: useProjection ? 'projected' : 'ytd',
    months_elapsed: elapsed,
    income,
    total_income: totalIncome,
    deductions,
    total_deductions: totalDeductions,
    taxable_income: taxable,
    gross_tax: grossTax,
    credits,
    total_credits: totalCredits,
    tax_due: taxDue,
    payments,
    total_payments: totalPayments,
    balance: round2(taxDue - totalPayments),
    national_insurance: ni,
    ni_note: profile.salary > 0
      ? 'מחושב על ההכנסה מהעסק בלבד, אחרי שהמשכורת ניצלה את המדרגה המופחתת ואת התקרה'
      : 'מחושב על ההכנסה מהעסק',
    credit_points: points,
    credit_breakdown: breakdown,
    marginal_rate: marginalRate(taxable, rates),
    business_income: businessIncome,
    reconciliation,
    profile,
    filing,
    deadline: annualDeadline(year, profile, filing),
  };
}

// ---------------------------------------------------------------------------
// when it is due, and what that means before it is
// ---------------------------------------------------------------------------

/**
 * The default filing date for a tax year: 30 June of the year after, moved off Shabbat.
 *
 * That is the online-filing date, which is the one an עוסק מורשה actually files by. It is
 * deliberately only a fallback — the statutory date is earlier, a filer represented by a CPA
 * gets a later one from the מייצגים quota, and neither is something this app can know. Whoever
 * does know types it into the year's `file_by`, and from then on the report tracks that.
 */
export function defaultFileBy(year: number): string {
  const date = new Date(Date.UTC(year + 1, 5, 30));
  if (date.getUTCDay() === 6) date.setUTCDate(31);
  return date.toISOString().slice(0, 10);
}

export interface AnnualDeadline {
  file_by: string;
  /** Whether `file_by` was stated for this year or fell back to the default. */
  stated: boolean;
  days_left: number;
  /**
   * `collecting` — the tax year has not ended, so there is nothing to file yet.
   * `due` / `overdue` — it has, and the date is ahead or behind.
   * `filed` / `paid` — the tick on the year says so.
   */
  status: 'collecting' | 'due' | 'overdue' | 'filed' | 'paid';
}

function annualDeadline(year: number, profile: AnnualProfile, filing: TaxFiling | null): AnnualDeadline {
  const fileBy = profile.file_by ?? defaultFileBy(year);
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round(
    (Date.parse(`${fileBy}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
  );
  const status: AnnualDeadline['status'] =
    filing?.paid_at ? 'paid'
    : filing?.filed_at ? 'filed'
    // A year still running cannot be late for its own return.
    : today <= `${year}-12-31` ? 'collecting'
    : days >= 0 ? 'due'
    : 'overdue';
  return { file_by: fileBy, stated: profile.file_by !== null, days_left: days, status };
}

/**
 * The two questions the deadline calendar and the tax agent actually ask, for one year.
 *
 * The first is backward-looking and simple: a closed year has a return to file, a date to file
 * it by, and a balance to pay with it. The second is the one worth having a report for at all —
 * a year still running is heading towards a balance, and the מקדמות paid into it so far are
 * either keeping up or they are not. A gap found in August is a conversation with the
 * accountant; the same gap found in June is a lump sum.
 */
export interface AnnualOutlook {
  year: number;
  /** Whether anyone has filled the declared side in. Nothing below means much until they have. */
  configured: boolean;
  /** True while the tax year is still running, which makes every figure a projection. */
  in_progress: boolean;
  balance: number;
  tax_due: number;
  payments: number;
  /** מקדמות alone, the part that can still be changed during the year. */
  mikdamot_paid: number;
  /** What is owed beyond what has been withheld and advanced — the gap to close. */
  shortfall: number;
  national_insurance: number;
  deadline: AnnualDeadline;
  filing: TaxFiling | null;
}

export function annualOutlook(year: number): AnnualOutlook {
  const assessment = annualAssessment(year, 'projected');
  const now = new Date().toISOString().slice(0, 10);
  return {
    year,
    configured: assessment.profile.updated_at !== null,
    in_progress: now <= `${year}-12-31`,
    balance: assessment.balance,
    tax_due: assessment.tax_due,
    payments: assessment.total_payments,
    mikdamot_paid: assessment.profile.mikdamot_paid,
    shortfall: Math.max(0, assessment.balance),
    national_insurance: assessment.national_insurance,
    deadline: assessment.deadline,
    filing: assessment.filing,
  };
}

export interface AnnualReport {
  current: AnnualAssessment;
  /** Last year's assessment, so this year's is read against something real. */
  previous: AnnualAssessment | null;
}

export function annualReport(year: number, basis: AnnualBasis = 'projected'): AnnualReport {
  const previous = db
    .prepare('SELECT 1 FROM annual_tax_profile WHERE year = ?')
    .get(year - 1)
    ? annualAssessment(year - 1, 'ytd')
    : null;
  return { current: annualAssessment(year, basis), previous };
}
