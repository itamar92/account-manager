/**
 * נקודות זיכוי — worked out from who you are, rather than typed in as a number.
 *
 * A credit point comes off the tax itself, not off the income, and the schedule that decides
 * how many you get is almost entirely a function of facts that do not change from year to
 * year: when your children were born, when you were discharged, when you made aliyah. What
 * changes is the tax year those facts are read against — a child worth 2.5 points in the year
 * it was born is worth 4.5 the year after — which is why this module stores the *status* and
 * computes the points per year, rather than storing a number that quietly goes stale.
 *
 * Every band here is from the Income Tax Ordinance; the section is named on each line so a
 * figure on screen can be traced back to the rule that produced it.
 */
import { getSetting, setSetting } from './db.js';

/** One child, as the schedule needs to see it. */
export interface CreditChild {
  /** Calendar year of birth — the age bands are read against the tax year, not a birthday. */
  birth_year: number;
  /**
   * Whether this filer is the parent entitled under s.66(ג)(4) — in practice the parent who
   * receives קצבת ילדים. It only matters from age 6, where that parent's entitlement is double
   * the other's, and it alone carries the half point in the year the child turns 18.
   */
  primary_parent: boolean;
  /** s.45(א): paralysed, blind, or with an intellectual-developmental disability. */
  disabled: boolean;
}

export interface CreditStatus {
  gender: 'male' | 'female';
  /** s.34 + s.36. A non-resident gets neither, and almost nothing else here applies either. */
  resident: boolean;
  children: CreditChild[];
  /** s.40(ב)(2) — הורה במשפחה חד-הורית. */
  single_parent: boolean;
  /** s.40(ב)(1ב) — הורה יחיד, where the other parent is not in the picture at all. */
  only_parent: boolean;
  /** s.40א — divorced, remarried, and paying מזונות to the former spouse. */
  divorced_paying_mezonot: boolean;
  /** s.37 — a spouse whose keep is on the filer, in the narrow cases the section allows. */
  supported_spouse: boolean;
  /** s.35, 'YYYY-MM-DD'. Empty for someone who is not an עולה. */
  aliya_date: string;
  /** s.39א, 'YYYY-MM-DD' of the end of שירות סדיר. Empty for someone who did not serve. */
  discharge_date: string;
  /** s.39א: 23+ full months for a man, 22+ for a woman, which doubles the rate. */
  full_service: boolean;
  /** s.39B — ימי מילואים לוחם in the year BEFORE the tax year. */
  reserve_days_prev_year: number;
  /** s.40ג — how many tax years the first degree took (capped at 3 by the section). */
  first_degree_years: number;
  /** s.40ג — how many tax years the second degree took (capped at 2). */
  second_degree_years: number;
  /** s.40ג — a תעודת מקצוע, claimed on a Form 119 declaration. */
  vocational_certificate: boolean;
  /** The tax year the studies (or the התמחות) ended — points start the year after. */
  studies_end_year: number | null;
  /** 100% נכות or permanently blind. */
  disability: boolean;
}

export const EMPTY_STATUS: CreditStatus = {
  gender: 'male',
  resident: true,
  children: [],
  single_parent: false,
  only_parent: false,
  divorced_paying_mezonot: false,
  supported_spouse: false,
  aliya_date: '',
  discharge_date: '',
  full_service: true,
  reserve_days_prev_year: 0,
  first_degree_years: 0,
  second_degree_years: 0,
  vocational_certificate: false,
  studies_end_year: null,
  disability: false,
};

/** One line of the answer: what was counted, how much it is worth, and under which section. */
export interface CreditLine {
  label: string;
  points: number;
  /** The Ordinance section, shown beside the line so a number can be checked against the law. */
  section: string;
  note?: string;
}

export interface CreditBreakdown {
  year: number;
  total: number;
  lines: CreditLine[];
  /** Set when the status has nothing in it — the caller then falls back to the typed number. */
  empty: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A child's points for one tax year, by the age it reaches in that year.
 *
 * Six bands, not three. Up to age 5 both parents get the same; from 6 the s.66(ג)(4) parent
 * gets double, and the half point in the year of majority is that parent's alone.
 */
export function childPoints(birthYear: number, taxYear: number, primaryParent: boolean): number {
  const age = taxYear - birthYear;
  if (age < 0) return 0;
  if (age === 0) return 2.5;
  if (age <= 2) return 4.5;
  if (age === 3) return 3.5;
  if (age <= 5) return 2.5;
  if (age <= 17) return primaryParent ? 2.0 : 1.0;
  if (age === 18) return primaryParent ? 0.5 : 0;
  return 0;
}

/**
 * s.35 עולה חדש: 8.5 points spread over a 54-month window that runs from the aliyah date, so
 * a tax year is credited with whatever share of the window falls inside it. The statute grants
 * the credit per month, which is why this counts months rather than years.
 */
function oliaPoints(aliyaDate: string, taxYear: number): number {
  const start = new Date(`${aliyaDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return 0;
  // Month index of the aliyah, and of each month of the tax year, on one absolute scale.
  const aliyaMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
  let points = 0;
  for (let m = 0; m < 12; m++) {
    // Month 1 of the window is the month of the aliyah itself.
    const elapsed = (taxYear * 12 + m) - aliyaMonth + 1;
    if (elapsed < 1 || elapsed > 54) continue;
    if (elapsed <= 12) points += 1 / 12;        // s.35(א)(1)  — 1.0 over the year
    else if (elapsed <= 30) points += 1 / 4;    // s.35(א)(1א) — 3.0 over 18 months
    else if (elapsed <= 42) points += 1 / 6;    // s.35(א)(2)  — 2.0 over 12 months
    else points += 1 / 12;                      // s.35(א)(3)  — 1.0 over 12 months
  }
  return round2(points);
}

/**
 * s.39א חייל משוחרר: a fraction of a point for each of the 36 months following the month
 * regular service ended — 1/6 for a full service, 1/12 for a short one.
 */
function dischargePoints(dischargeDate: string, taxYear: number, fullService: boolean): number {
  const end = new Date(`${dischargeDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return 0;
  const endMonth = end.getUTCFullYear() * 12 + end.getUTCMonth();
  const perMonth = fullService ? 1 / 6 : 1 / 12;
  let months = 0;
  for (let m = 0; m < 12; m++) {
    const elapsed = (taxYear * 12 + m) - endMonth;  // the month after discharge is 1
    if (elapsed >= 1 && elapsed <= 36) months++;
  }
  return round2(months * perMonth);
}

/**
 * s.39B מילואים לוחם, on the PREVIOUS year's days — which is the part most summaries get
 * wrong. Two tables: a הוראת שעה for 2026-2027, and the permanent rule from 2028. The section
 * came into force on 1.1.2026, so an earlier tax year gets nothing.
 */
function reservePoints(days: number, taxYear: number): number {
  if (!Number.isFinite(days) || days <= 0 || taxYear < 2026) return 0;
  if (taxYear <= 2027) {
    if (days < 30) return 0;
    // 0.5 at 30-39, 0.75 at 40-49, 1.0 at 50-54, then a further 0.25 per 5 days, capped at 4.
    if (days < 40) return 0.5;
    if (days < 50) return 0.75;
    return Math.min(4, 1 + Math.floor((days - 50) / 5) * 0.25);
  }
  // From 2028: 0.75 from 20 days, a further 0.25 per 5 days, capped at 4.
  if (days < 20) return 0;
  return Math.min(4, 0.75 + Math.floor((days - 20) / 5) * 0.25);
}

/**
 * s.40ג degrees: the points run for as many tax years as the studies took, capped by the
 * section, and start the tax year AFTER studies ended.
 */
function studyPoints(status: CreditStatus, taxYear: number): CreditLine[] {
  const lines: CreditLine[] = [];
  const endYear = status.studies_end_year;
  if (!endYear) return lines;
  const first = Math.min(3, Math.max(0, Math.floor(status.first_degree_years)));
  const second = Math.min(2, Math.max(0, Math.floor(status.second_degree_years)));
  // Year 1 of entitlement is the tax year after studies ended.
  const nth = taxYear - endYear;
  if (nth >= 1 && nth <= first) {
    lines.push({ label: 'תואר ראשון', points: 1, section: 's.40ג', note: `שנה ${nth} מתוך ${first}` });
  }
  // A second degree's years follow the first's, which is how consecutive degrees are credited.
  const secondFrom = first + 1;
  if (second > 0 && nth >= secondFrom && nth < secondFrom + second) {
    lines.push({
      label: 'תואר שני', points: 0.5, section: 's.40ג',
      note: `שנה ${nth - first} מתוך ${second}`,
    });
  }
  if (status.vocational_certificate && nth >= 1 && nth <= 1) {
    lines.push({
      label: 'תעודת מקצוע', points: 1, section: 's.40ג',
      note: 'נדרשת הצהרה בטופס 119 — לאמת את מספר השנים מול רשות המסים',
    });
  }
  return lines;
}

/** Every line the status earns for one tax year, with the sections that grant them. */
export function creditBreakdown(status: CreditStatus, year: number): CreditBreakdown {
  const lines: CreditLine[] = [];

  if (status.resident) {
    lines.push({ label: 'תושב ישראל', points: 2.25, section: 's.34 + s.36' });
    if (status.gender === 'female') {
      lines.push({ label: 'אישה', points: 0.5, section: 's.36א' });
    }
  }

  for (const child of status.children) {
    const points = childPoints(child.birth_year, year, child.primary_parent);
    const age = year - child.birth_year;
    if (points > 0) {
      lines.push({
        label: `ילד/ה ילידת ${child.birth_year}`,
        points,
        section: child.primary_parent ? 's.66(ג)(4)' : 's.66(ג)(5)',
        note: age === 0 ? 'שנת הלידה' : `גיל ${age} בשנת המס`,
      });
    }
    // s.45(א) rides on top of the age band, and lasts as long as the child is a child.
    if (child.disabled && age >= 0 && age <= 18) {
      lines.push({ label: `ילד/ה נטול/ת יכולת (${child.birth_year})`, points: 2, section: 's.45(א)' });
    }
  }

  if (status.single_parent) lines.push({ label: 'הורה במשפחה חד-הורית', points: 1, section: 's.40(ב)(2)' });
  if (status.only_parent) lines.push({ label: 'הורה יחיד', points: 1, section: 's.40(ב)(1ב)' });
  if (status.divorced_paying_mezonot) lines.push({ label: 'גרוש/ה שנישא/ה ומשלם/ת מזונות', points: 1, section: 's.40א' });
  if (status.supported_spouse) lines.push({ label: 'בן/בת זוג שפרנסתו/ה על הנישום', points: 1, section: 's.37' });

  if (status.aliya_date) {
    const points = oliaPoints(status.aliya_date, year);
    if (points > 0) lines.push({ label: 'עולה חדש', points, section: 's.35', note: 'לפי החלק מחלון 54 החודשים שנופל בשנת המס' });
  }

  if (status.discharge_date) {
    const points = dischargePoints(status.discharge_date, year, status.full_service);
    if (points > 0) {
      lines.push({
        label: 'חייל/ת משוחרר/ת', points, section: 's.39א',
        note: `${status.full_service ? '1/6' : '1/12'} נקודה לחודש, 36 חודשים מהשחרור`,
      });
    }
  }

  const reserve = reservePoints(status.reserve_days_prev_year, year);
  if (reserve > 0) {
    lines.push({
      label: 'מילואים לוחם', points: reserve, section: 's.39B',
      note: `${status.reserve_days_prev_year} ימים בשנת ${year - 1} — נדרש אישור צה"ל`,
    });
  }

  lines.push(...studyPoints(status, year));

  if (status.disability) lines.push({ label: 'נכות 100% או עיוורון', points: 2, section: 'טופס 101 סעיף 2א' });

  return {
    year,
    total: round2(lines.reduce((sum, l) => sum + l.points, 0)),
    lines,
    empty: lines.length === 0,
  };
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

const STATUS_KEY = 'tax_credit_status';

/** The saved status, or null where the calculator has never been filled in. */
export function getCreditStatus(): CreditStatus | null {
  const raw = getSetting(STATUS_KEY, '');
  if (!raw) return null;
  try {
    return normalizeStatus(JSON.parse(raw));
  } catch {
    return null;
  }
}

const bool = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
const int = (v: unknown, fallback = 0) => {
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
/** A date is stored only if it is one; anything else becomes "not stated". */
const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

export function normalizeStatus(input: any): CreditStatus {
  const raw = input ?? {};
  const children = Array.isArray(raw.children) ? raw.children : [];
  return {
    gender: raw.gender === 'female' ? 'female' : 'male',
    resident: raw.resident === undefined ? true : bool(raw.resident),
    children: children
      .map((c: any) => ({
        birth_year: int(c?.birth_year),
        primary_parent: bool(c?.primary_parent),
        disabled: bool(c?.disabled),
      }))
      // A child with no plausible birth year would silently distort the total, so it is dropped
      // rather than counted as a newborn.
      .filter((c: CreditChild) => c.birth_year >= 1900 && c.birth_year <= 2200)
      .slice(0, 20),
    single_parent: bool(raw.single_parent),
    only_parent: bool(raw.only_parent),
    divorced_paying_mezonot: bool(raw.divorced_paying_mezonot),
    supported_spouse: bool(raw.supported_spouse),
    aliya_date: isoDate(raw.aliya_date),
    discharge_date: isoDate(raw.discharge_date),
    full_service: raw.full_service === undefined ? true : bool(raw.full_service),
    reserve_days_prev_year: Math.max(0, Math.min(400, int(raw.reserve_days_prev_year))),
    first_degree_years: Math.max(0, Math.min(3, int(raw.first_degree_years))),
    second_degree_years: Math.max(0, Math.min(2, int(raw.second_degree_years))),
    vocational_certificate: bool(raw.vocational_certificate),
    studies_end_year: raw.studies_end_year ? int(raw.studies_end_year) || null : null,
    disability: bool(raw.disability),
  };
}

export function saveCreditStatus(input: any): CreditStatus {
  const status = normalizeStatus(input);
  setSetting(STATUS_KEY, JSON.stringify(status));
  return status;
}

export function clearCreditStatus() {
  setSetting(STATUS_KEY, '');
}
