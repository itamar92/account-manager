/**
 * Reading the annual certificates — טופס 106, the ביטוח לאומי מילואים letter, and the קופות'
 * yearly statements — so the declared half of the annual report can be filled from the
 * documents rather than typed off them.
 *
 * **It reads codes, not Hebrew.** Every one of these forms is built around the Tax Authority's
 * own field numbers: 158 is gross salary on a 106 whoever printed it, 042 is the tax withheld,
 * 036 is a life-insurance premium. Matching those is enormously more robust than matching
 * labels, which differ between payroll systems, wrap differently in every layout, and arrive
 * in an RTL document where the reading order of a table is not the order of its columns.
 *
 * That last point is why this works on positions rather than on extracted text. Ask any text
 * extractor for this page and a table row comes back with its label, its amount and its code
 * on three separate lines in an order none of them were printed in — pdftotext on a real 106
 * hands back the code four lines away from the figure it belongs to. So the words are put back
 * onto the lines they were printed on, by their y coordinate, and a code is paired with the
 * amount that shares its line.
 *
 * Nothing here writes anything. It proposes, the review screen shows what it found beside what
 * is already stored, and a person decides — which is the only safe way to treat a number that
 * came out of a document scan and is about to become a tax figure.
 */
import type { AnnualProfile } from './annualReport.js';

/** Which certificate this is, which decides how its codes are read. */
export type FormKind = 'form106' | 'miluim' | 'keren_hishtalmut' | 'pension' | 'life_insurance' | 'unknown';

const KIND_LABELS: Record<FormKind, string> = {
  form106: 'טופס 106 — ריכוז שכר שנתי',
  miluim: 'אישור ביטוח לאומי — תגמולי מילואים',
  keren_hishtalmut: 'דוח שנתי — קרן השתלמות',
  pension: 'דוח שנתי — קופת גמל לקצבה',
  life_insurance: 'אישור מס — ביטוח חיים',
  unknown: 'מסמך לא מזוהה',
};

/** The profile fields a certificate can propose a value for. */
export type ProfileField = Extract<keyof AnnualProfile,
  'salary' | 'salary_withheld' | 'miluim' | 'miluim_withheld' | 'keren_hishtalmut_paid' |
  'pension_atzmai_paid' | 'pension_sachir_paid' | 'life_insurance_paid'>;

export interface ParsedField {
  field: ProfileField;
  label: string;
  amount: number;
  /** The ITA code the figure was read from, or null where a phrase found it. */
  code: string | null;
  note?: string;
}

export interface ParsedForm {
  kind: FormKind;
  kind_label: string;
  /** The tax year printed on the document, where it says one. */
  year: number | null;
  fields: ParsedField[];
  /** Things worth reading before accepting the numbers. */
  warnings: string[];
  /** Figures found but not mapped to a field — shown so nothing looks silently dropped. */
  extras: Array<{ code: string; label: string; amount: number }>;
}

export class ParseError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// text, put back on its lines
// ---------------------------------------------------------------------------

interface Token { text: string; x: number }
interface Line { page: number; y: number; tokens: Token[]; text: string }

/** Bidi control marks, which carry no meaning here and break every comparison they touch. */
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

/**
 * Every word of the document, grouped back onto the line it was printed on.
 *
 * pdfjs hands back each run of text with the matrix it was drawn with; the y translation is
 * the line. Runs within a couple of points of each other are the same line — a form's
 * baselines wobble slightly between fonts, and an exact comparison splits a row in two.
 */
async function extractLines(data: Uint8Array): Promise<Line[]> {
  // The legacy build is the one that runs under Node without a DOM.
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

  let doc: any;
  try {
    doc = await pdfjs.getDocument({
      data,
      // The document is untrusted: it arrived from a browser upload. Nothing in it should be
      // able to run, and nothing in it should cause a fetch.
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;
  } catch (err) {
    throw new ParseError(`לא ניתן לקרוא את הקובץ כ-PDF: ${(err as Error).message}`);
  }

  const lines: Line[] = [];
  let characters = 0;
  const pages = Math.min(doc.numPages, 20);
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const buckets = new Map<number, Line>();
    for (const item of content.items as any[]) {
      const text = String(item.str ?? '').replace(BIDI, '').trim();
      if (!text) continue;
      characters += text.length;
      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      // Bucket to 2pt, then look either side, so a baseline that wobbles still lands together.
      const key = Math.round(y / 2);
      const line = buckets.get(key) ?? buckets.get(key - 1) ?? buckets.get(key + 1);
      if (line) line.tokens.push({ text, x });
      else buckets.set(key, { page: p, y, tokens: [{ text, x }], text: '' });
    }
    for (const line of buckets.values()) {
      // Right to left: a Hebrew row reads from the largest x to the smallest.
      line.tokens.sort((a, b) => b.x - a.x);
      line.text = line.tokens.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
      lines.push(line);
    }
  }
  await doc.destroy?.();

  // A scanned certificate is not empty — it usually carries a stamp, a page number or a date
  // in a real text layer over the image — so "no text at all" is the wrong test and lets a
  // scan through to fail later with a misleading "no fields found". What separates the two is
  // density: a page of a real 106 carries hundreds of characters, a scan a handful.
  if (characters < Math.max(150, pages * 40)) {
    throw new ParseError(
      'הקובץ נראה כמו סריקה ולא כמו PDF מקורי — יש בו תמונה של המסמך ולא טקסט שאפשר לקרוא. ' +
      'הורידו את המסמך המקורי מהמעסיק, מהביטוח הלאומי או מהקופה (קובץ שאפשר לסמן בו טקסט), ' +
      'או הזינו את הסכומים ידנית.',
      422
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// codes and amounts
// ---------------------------------------------------------------------------

/** A figure as these forms print one: 288,113 or 941.82. */
const AMOUNT = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;

const parseAmount = (text: string): number | null => {
  if (!AMOUNT.test(text)) return null;
  const value = parseFloat(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
};

/**
 * The codes worth reading, what each means, and whether repeats add up.
 *
 * `sum` is the difference between two pension funds on one 106 — 045 twice, for כלל and
 * מנורה, which together are the year's deposit — and a code printed twice on the same form
 * because it appears in two tables, which is one figure and not two.
 */
interface CodeSpec {
  label: string;
  field?: ProfileField;
  sum?: boolean;
  /** Only read this code on these kinds of document, where the same number means two things. */
  onlyOn?: FormKind[];
  note?: string;
}

const CODES: Record<string, CodeSpec> = {
  '158': { label: 'משכורת ברוטו', field: 'salary' },
  '042': { label: 'ניכוי מס במקור ממשכורת', field: 'salary_withheld' },
  // 045 on a 106 is the employee's own pension deduction, and a 106 can carry several funds.
  // The same number on a קופה's certificate means that one fund only, which would understate
  // the year — so it is read from a 106 and nowhere else.
  '045': { label: 'הפקדת עובד לקופת גמל לקצבה', field: 'pension_sachir_paid', sum: true, onlyOn: ['form106'] },
  '036': { label: 'פרמיות ביטוח חיים', field: 'life_insurance_paid' },
  '135': { label: 'הפקדה לקצבה — עמית עצמאי', field: 'pension_atzmai_paid', onlyOn: ['pension'] },
  '180': { label: 'הפקדה לקצבה — עמית עצמאי', field: 'pension_atzmai_paid', onlyOn: ['pension'] },
  '250': { label: 'תגמולי מילואים', field: 'miluim' },
  '040': { label: 'ניכוי מס במקור מתגמולים', field: 'miluim_withheld' },
  // Read but never mapped: they belong on the return, not in this app's declared figures.
  '244': { label: 'הכנסה מבוטחת' },
  '218': { label: 'שכר לקרן השתלמות' },
  '248': { label: 'הפקדות מעסיק לקצבה' },
  '011': {
    label: 'הפחתת דמי הבראה',
    note: 'מידע בלבד — הסכום כבר קוזז מהברוטו בשדה 158, והזנתו כניכוי סופרת את ההטבה פעמיים',
  },
};

/** A token is a code if it is one, allowing for the 036/081 pairs these forms print. */
function codesIn(text: string): string[] {
  return text
    .split('/')
    .map((part) => part.trim())
    .filter((part) => /^\d{3}$/.test(part) && CODES[part] !== undefined);
}

/** What kind of certificate this is, from the phrases only that kind carries. */
function detectKind(text: string): FormKind {
  if (/טופס\s*106|ריכוז שכר/.test(text)) return 'form106';
  if (/תגמולי מילואים/.test(text)) return 'miluim';
  if (/קרן השתלמות/.test(text)) return 'keren_hishtalmut';
  if (/קרן פנסיה|קופת גמל|לקצבה/.test(text)) return 'pension';
  if (/ביטוח חיים|אובדן כושר/.test(text)) return 'life_insurance';
  return 'unknown';
}

function detectYear(text: string): number | null {
  const match = text.match(/(?:לשנת מס|שנת מס|לשנת|בשנת)\s*(20\d{2})/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Amounts named by a phrase rather than a code.
 *
 * The ביטוח לאומי letter is the reason this exists: it is prose, carries no field numbers, and
 * is the only place the year's מילואים figures are stated. The קרן השתלמות statement is the
 * same — a table of deposits with a total and no code on it.
 */
const PHRASES: Array<{ kind: FormKind; pattern: RegExp; field: ProfileField; label: string }> = [
  {
    kind: 'miluim',
    pattern: /תגמולי מילואים ברוטו בסך[:\s]*([\d,]+(?:\.\d+)?)/,
    field: 'miluim',
    label: 'תגמולי מילואים ברוטו',
  },
  {
    kind: 'miluim',
    pattern: /נוכה מס הכנסה בסך[:\s]*([\d,]+(?:\.\d+)?)/,
    field: 'miluim_withheld',
    label: 'מס שנוכה מהתגמולים',
  },
  {
    kind: 'keren_hishtalmut',
    pattern: /סך הפקדות מוטבות\s*\*?\s*לקרן[:\s]*([\d,]+(?:\.\d+)?)/,
    field: 'keren_hishtalmut_paid',
    label: 'סך הפקדות מוטבות לקרן',
  },
];

// ---------------------------------------------------------------------------
// the parse
// ---------------------------------------------------------------------------

export async function parseCertificate(data: Uint8Array): Promise<ParsedForm> {
  const lines = await extractLines(data);
  const whole = lines.map((l) => l.text).join('\n');

  const kind = detectKind(whole);
  const warnings: string[] = [];

  // --- codes, paired with the amount printed on their own line -------------
  const found = new Map<string, number[]>();
  for (const line of lines) {
    const codeTokens: Array<{ code: string; x: number }> = [];
    const amounts: Array<{ value: number; x: number }> = [];

    for (const token of line.tokens) {
      const codes = codesIn(token.text);
      if (codes.length > 0) {
        for (const code of codes) codeTokens.push({ code, x: token.x });
        continue;  // a code is not also an amount, even though 158 parses as a number
      }
      const value = parseAmount(token.text);
      if (value !== null && value !== 0) amounts.push({ value, x: token.x });
    }
    if (codeTokens.length === 0 || amounts.length === 0) continue;

    for (const { code, x } of codeTokens) {
      // With more than one figure on the row, the code belongs to the nearest — which is what
      // a column layout means, and the only reading that survives a three-column table.
      const nearest = amounts.reduce((best, a) =>
        Math.abs(a.x - x) < Math.abs(best.x - x) ? a : best);
      const list = found.get(code) ?? [];
      list.push(nearest.value);
      found.set(code, list);
    }
  }

  const fields: ParsedField[] = [];
  const extras: ParsedForm['extras'] = [];

  for (const [code, values] of found) {
    const spec = CODES[code];
    if (!spec) continue;
    if (spec.onlyOn && !spec.onlyOn.includes(kind)) continue;

    let amount: number;
    if (spec.sum) {
      amount = values.reduce((a, b) => a + b, 0);
    } else {
      const distinct = [...new Set(values)];
      amount = distinct[0];
      if (distinct.length > 1) {
        warnings.push(
          `קוד ${code} (${spec.label}) הופיע במסמך עם יותר מסכום אחד — ` +
          `${distinct.map((v) => v.toLocaleString('he-IL')).join(', ')}. נבחר הראשון; כדאי לוודא.`
        );
      }
    }
    amount = Math.round(amount * 100) / 100;

    if (spec.note) warnings.push(`קוד ${code} — ${spec.note}.`);
    if (!spec.field) {
      extras.push({ code, label: spec.label, amount });
      continue;
    }

    // Some cells carry two codes for one figure — 135/180 for a self-employed pension deposit,
    // 036/081 for a premium — so the same field is reached twice from one row. That is one
    // number stated two ways, not two deposits, and it must not be listed (or applied) twice.
    const already = fields.find((f) => f.field === spec.field);
    if (!already) {
      fields.push({ field: spec.field, label: spec.label, amount, code, note: spec.note });
    } else if (Math.abs(already.amount - amount) < 0.01) {
      already.code = already.code ? `${already.code}/${code}` : code;
    } else {
      warnings.push(
        `שני קודים במסמך מצביעים על «${spec.label}» עם סכומים שונים — ` +
        `${already.code}: ${already.amount.toLocaleString('he-IL')}, ` +
        `${code}: ${amount.toLocaleString('he-IL')}. נבחר הראשון; כדאי לוודא.`
      );
    }
  }

  // --- phrases, for the forms that carry no codes ---------------------------
  for (const phrase of PHRASES) {
    if (phrase.kind !== kind) continue;
    if (fields.some((f) => f.field === phrase.field)) continue;
    const match = whole.match(phrase.pattern);
    if (!match) continue;
    const amount = parseAmount(match[1]);
    if (amount === null || amount === 0) continue;
    fields.push({ field: phrase.field, label: phrase.label, amount, code: null });
  }

  if (kind === 'unknown') {
    warnings.push(
      'סוג המסמך לא זוהה — נקראו רק שדות שסומנו בקוד. כדאי לעבור על כל שורה לפני האישור.'
    );
  }
  if (fields.length === 0) {
    warnings.push('לא נמצאו סכומים שניתן לשייך לשדה. ייתכן שזהו מסמך מסוג אחר.');
  }

  return {
    kind,
    kind_label: KIND_LABELS[kind],
    year: detectYear(whole),
    fields,
    warnings,
    extras,
  };
}
