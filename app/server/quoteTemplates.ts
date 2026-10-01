/**
 * The template the system comes with: Moonlight's own quote, as it was sent for years from a
 * Google Doc («Template הצעת מחיר — להקת המחווה לקולדפליי»), moved into the quote's sections.
 *
 * Where each part of the Doc went:
 * - {{DATE}}, {{תאריך האירוע}}, {{שם המקום}}, {{זמן מופע}} — the quote's own fields: the date it
 *   was made, the event's date, its place and the show's length, shown as the header's chips.
 * - {{שם האירוע}} — the client and the event type («עבור …», «חתונה»).
 * - {{AMPLIFICATION_TEXT}}, which was the price paragraph — «X ₪ + מע״מ, כולל חברת ההגברה
 *   והתאורה» — is now the lines and the totals: the show, priced per quote, and sound and
 *   lighting as a line of its own that reads «כלול» until it is priced or removed.
 * - The rest of the Doc — the band's line-up, the timings, what the production provides, payment,
 *   deposit, cancellation and force majeure — is the line's description and the terms, grouped
 *   under headings so a client on a phone can find each one.
 *
 * The wording is the Doc's, tightened where it was loose rather than changed: «כ־30 אחוז» is 30%,
 * «כחודש מראש» is a month, and the deposit's «עד לשבוע מיום האירוע» is spelled out as no later
 * than a week before the event, with the balance due שוטף + 30 as the Doc had it.
 *
 * The overtime line (400 ₪ + מע״מ an hour after 23:00) is from the quotes actually sent, where it
 * went with the price paragraph. It belongs to sound being included, so it goes with that line.
 */
export const BUILTIN_TEMPLATE = {
  template_name: 'מונלייט — הופעה מלאה',
  title: 'הופעת מונלייט — להקת המחווה לקולדפליי',
  intro: [
    'תודה שפניתם אלינו!',
    'שמחים להציע לכם הופעה של מונלייט — להקת המחווה לקולדפליי — ב־{event_date}. כאן תמצאו את ההרכב, המחיר ואת מה שצריך להכין לקראת ההופעה.',
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
    '• מקדמה של 7,000 ₪ תשולם לאחר אישור ההצעה, ולא יאוחר משבוע לפני האירוע.',
    '• יתרת הסכום תשולם עד שוטף + 30 מיום האירוע, בהעברה בנקאית או בצ׳ק.',
    '• מהשעה 23:00, כל שעה נוספת של הגברה — 400 ₪ + מע״מ.',
    '',
    'ביטול:',
    '• על ביטול יש להודיע לפחות חודש לפני האירוע. ביטול בהתראה קצרה יותר מחייב תשלום של 30% ממחיר ההופעה.',
    '• כוח עליון שאינו מאפשר את קיום האירוע אינו ביטול: ההופעה תידחה למועד חלופי שיתואם בין הצדדים, בלי דמי ביטול.',
  ].join('\n'),
  // The Doc quoted «X ₪ פלוס מע״מ».
  prices_include_vat: 0,
  items: [
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
  ],
};
