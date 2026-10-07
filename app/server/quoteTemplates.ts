/**
 * The templates the system comes with: a standard show quote, and two versions of it for a show
 * far from home (one where the band drives, one where it flies). They are examples written for a
 * live band in Israel — the line-up, the stage, the timings, the payment and cancellation terms —
 * and every word of them is editable once a copy is in the database. The band's name is read
 * from the settings when a copy is made, so renaming the band renames nothing already saved.
 *
 * How the parts fit:
 * - The quote's own fields hold the date it was made, the event's date, its place and the show's
 *   length, shown as the header's chips.
 * - The price goes into the first line (the show itself); sound and lighting is a line of its own
 *   that reads «כלול» until it is priced or removed.
 * - The terms are the rest — the line-up, the timings, what the production provides, payment,
 *   deposit, cancellation and force majeure — grouped under headings so a client on a phone can
 *   find each one. The deposit is a share of the price, {deposit}, so it follows the price.
 */
import { getBandName } from './db.js';

export interface BuiltinTemplate {
  template_name: string;
  title: string;
  intro: string;
  terms: string;
  prices_include_vat: number;
  deposit_percent: number;
  event_location?: string;
  show_duration?: string;
  items: Array<{ name: string; description: string; quantity: number; unit_price: number }>;
}

const SHOW_ITEMS = [
  {
    // The quick form's price goes into this line, so it is the show itself.
    name: 'הופעה חיה — הרכב מלא',
    description: 'חמישה נגנים: מתופף, בסיסט, גיטריסט, קלידן וזמר · סאונדמן ותאורן של הלהקה',
    quantity: 1,
    unit_price: 0,
  },
  {
    name: 'הגברה ותאורה',
    description: 'חברת הגברה ותאורה מקצועית, כולל הקמה ופירוק',
    quantity: 1,
    unit_price: 0,
  },
];

export function standardTemplate(): BuiltinTemplate {
  const band = getBandName();
  return {
    template_name: `${band} — הופעה מלאה`,
    title: `הופעת ${band}`,
    intro: [
      'תודה שפניתם אלינו!',
      `שמחים להציע לכם הופעה של ${band} ב־{event_date}. כאן תמצאו את ההרכב, המחיר ואת מה שצריך להכין לקראת ההופעה.`,
    ].join('\n'),
    terms: [
      'לוח הזמנים ביום האירוע:',
      '• חברת ההגברה מגיעה כ־4 שעות לפני תחילת האירוע, להקמת הציוד על הבמה.',
      '• הלהקה מגיעה כשעתיים וחצי לפני תחילת האירוע, לבדיקות סאונד (באלאנס).',
      '',
      'מה נדרש מההפקה:',
      '• במה בגודל 5 על 3 מטרים לפחות, עם גב במה שחור.',
      '• באירוע בחוץ: הצללה מעל הבמה ומעל עמדת הסאונדמן, עד סיום הבאלאנס.',
      '• בקבוקי מים אישיים לחברי הלהקה לזמן ההופעה.',
      '• חדר מנוחה (״חדר אמנים״) מסיום הבאלאנס ועד תחילת האירוע, עם כיבוד קל ושתייה.',
      '',
      'תשלום:',
      '• מקדמה של {deposit} תשולם לאחר אישור ההצעה, ולא יאוחר משבוע לפני האירוע.',
      '• יתרת הסכום תשולם עד שוטף + 30 מיום האירוע, בהעברה בנקאית או בצ׳ק.',
      '• מהשעה 23:00, כל שעה נוספת של הגברה — 400 ₪ + מע״מ.',
      '',
      'ביטול:',
      '• על ביטול יש להודיע לפחות חודש לפני האירוע. ביטול בהתראה קצרה יותר מחייב תשלום של 30% ממחיר ההופעה.',
      '• כוח עליון שאינו מאפשר את קיום האירוע אינו ביטול: ההופעה תידחה למועד חלופי שיתואם בין הצדדים, בלי דמי ביטול.',
    ].join('\n'),
    // Quoted as «X ₪ פלוס מע״מ».
    prices_include_vat: 0,
    deposit_percent: 30,
    items: SHOW_ITEMS.map((item) => ({ ...item })),
  };
}

/**
 * A show far from home — Eilat, as the example — where the band cannot play and drive back the
 * same night. Either the band drives and is paid back for the road, or it flies and the
 * production books the flights. Those are two different offers to a client, so they are two
 * templates rather than one with both written in.
 *
 * What the band costs is the same show as anywhere; what distance adds is the travel (a line of
 * its own by car, so it is priced with VAT like everything else; nothing by plane, since the
 * production books and pays), the hotel, dinner and breakfast, what happens when the event is
 * cancelled with the band already on the road, and a flight that is late or cancelled.
 */
export function farAwayTemplate(by: 'car' | 'plane'): BuiltinTemplate {
  const band = getBandName();
  const car = by === 'car';
  return {
    template_name: car ? `${band} — אילת, ברכב` : `${band} — אילת, בטיסה`,
    title: `הופעת ${band} באילת`,
    event_location: 'אילת',
    show_duration: 'כשעה וחצי',
    intro: [
      'תודה שפניתם אלינו!',
      `שמחים להציע לכם הופעה של ${band} באילת, ב־{event_date}. כאן תמצאו את ההרכב, המחיר ומה שצריך להכין לקראת ההופעה. אילת רחוקה מהמרכז, ולכן ההצעה מפרטת גם את הנסיעה ואת הלינה של הלהקה.`,
    ].join('\n'),
    terms: [
      'לוח הזמנים ביום האירוע:',
      '• חברת ההגברה מגיעה כ־4 שעות לפני תחילת האירוע, להקמת הציוד על הבמה.',
      '• הלהקה מגיעה כשעתיים וחצי לפני תחילת האירוע, לבדיקות סאונד (באלאנס).',
      '',
      ...(car ? [
        'נסיעה:',
        '• הלהקה מגיעה לאילת ברכבים שלה, עם הכלים והציוד. החזר הוצאות הנסיעה מופיע בהצעה כשורה נפרדת.',
        '• חנייה לרכבי הלהקה ולרכב ההגברה סמוך לבמה, לפריקת הציוד ולהעמסתו, וחנייה במלון.',
      ] : [
        'טיסות והסעות:',
        '• ההפקה מזמינה ומממנת טיסות הלוך ושוב מנתב״ג לנמל התעופה רמון לצוות הלהקה — 7 אנשים.',
        '• מועדי הטיסות יתואמו מראש עם הלהקה: בהלוך, נחיתה לפחות 4 שעות לפני תחילת האירוע; החזור ביום שלמחרת.',
        '• הכבודה כוללת את כלי הנגינה והציוד של הלהקה. תשלום על כבודה עודפת או מיוחדת חל על ההפקה.',
        '• הסעה מנמל התעופה למלון ולמקום האירוע, ובחזרה לנמל התעופה ביום שלמחרת, ברכב עם מקום לכלים ולציוד.',
        '• לצורך הזמנת הטיסות הלהקה תעביר את שמות הנוסעים ומספרי תעודות הזהות שלהם.',
        '• עיכוב או ביטול של טיסה על ידי חברת התעופה אינו הפרה מצד הלהקה: ההפקה תדאג, על חשבונה, לטיסה חלופית או להסעה לאילת.',
      ]),
      '',
      'לינה:',
      '• ההפקה מזמינה ומממנת לילה אחד במלון באילת, כולל ארוחת בוקר, לצוות הלהקה — 7 אנשים: חמשת הנגנים, הסאונדמן והתאורן, עד שניים בחדר.',
      '• החדרים זמינים מהגעת הלהקה לאילת, ועד 12:00 לפחות ביום שלמחרת.',
      ...(car ? ['• מטעמי בטיחות, הלהקה לא נוסעת חזרה בלילה שאחרי ההופעה.'] : []),
      `• אישורי ההזמנה ${car ? 'של המלון' : 'של המלון ושל הטיסות'} יישלחו ללהקה עד שבוע לפני האירוע.`,
      '',
      'מה נדרש מההפקה:',
      '• במה בגודל 5 על 3 מטרים לפחות, עם גב במה שחור.',
      '• באירוע בחוץ: הצללה מעל הבמה ומעל עמדת הסאונדמן, עד סיום הבאלאנס.',
      ...(car ? [] : ['• חנייה לרכב ההגברה סמוך לבמה, לפריקת הציוד ולהעמסתו.']),
      '• בקבוקי מים אישיים לחברי הלהקה לזמן ההופעה.',
      '• חדר מנוחה (״חדר אמנים״) מסיום הבאלאנס ועד תחילת האירוע, עם כיבוד קל ושתייה.',
      '• ארוחת ערב חמה ומלאה לצוות הלהקה ביום ההופעה.',
      '',
      'תשלום:',
      '• מקדמה של {deposit} תשולם לאחר אישור ההצעה, ולא יאוחר משבוע לפני האירוע.',
      `• יתרת הסכום${car ? ', כולל החזר הנסיעה,' : ''} תשולם עד שוטף + 30 מיום האירוע, בהעברה בנקאית או בצ׳ק.`,
      '• מהשעה 23:00, כל שעה נוספת של הגברה — 400 ₪ + מע״מ.',
      '',
      'ביטול:',
      '• על ביטול יש להודיע לפחות חודש לפני האירוע. ביטול בהתראה קצרה יותר מחייב תשלום של 30% ממחיר ההופעה.',
      `• ביטול ${car ? 'המלון' : 'המלון והטיסות'} נעשה על ידי ההפקה ועל חשבונה.`,
      car
        ? '• ביטול אחרי שהלהקה כבר יצאה לאילת, מכל סיבה שהיא, מחייב את החזר הוצאות הנסיעה במלואו.'
        : '• ביטול אחרי שהלהקה כבר יצאה לאילת, מכל סיבה שהיא: ההפקה תדאג, על חשבונה, להחזרת הלהקה למרכז.',
      '• כוח עליון שאינו מאפשר את קיום האירוע, לרבות הנחיות פיקוד העורף, אינו ביטול: ההופעה תידחה למועד חלופי שיתואם בין הצדדים, בלי דמי ביטול.',
    ].join('\n'),
    prices_include_vat: 0,
    deposit_percent: 30,
    items: [
      // An example price, so a quote from here needs no price typed unless the client's differs.
      { ...SHOW_ITEMS[0], unit_price: 30000 },
      { ...SHOW_ITEMS[1] },
      ...(car ? [{
        name: 'החזר הוצאות נסיעה',
        description: 'נסיעת הלהקה והציוד מהמרכז לאילת וחזרה, כ־700 ק״מ',
        quantity: 1,
        unit_price: 2500,
      }] : []),
    ],
  };
}

/**
 * Every template the system comes with, by the key that adds a copy of one. Each is put in place
 * once (see seedBuiltinTemplates), in this order, so on a new install the standard one comes
 * first and is the default. They are functions because the band's name is read when the copy
 * is made.
 */
export const BUILTIN_TEMPLATES: Record<'standard' | 'eilat_car' | 'eilat_plane', () => BuiltinTemplate> = {
  standard: standardTemplate,
  eilat_car: () => farAwayTemplate('car'),
  eilat_plane: () => farAwayTemplate('plane'),
};
