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
 * The Doc's deposit was 7,000 ₪ whatever the show cost. It is a share of the price now, 30%, and
 * the terms say it through {deposit}, which the quote shows as the percentage and the sum it
 * comes to, so the deposit follows the price with nobody retyping it.
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
    '• מקדמה של {deposit} תשולם לאחר אישור ההצעה, ולא יאוחר משבוע לפני האירוע.',
    '• יתרת הסכום תשולם עד שוטף + 30 מיום האירוע, בהעברה בנקאית או בצ׳ק.',
    '• מהשעה 23:00, כל שעה נוספת של הגברה — 400 ₪ + מע״מ.',
    '',
    'ביטול:',
    '• על ביטול יש להודיע לפחות חודש לפני האירוע. ביטול בהתראה קצרה יותר מחייב תשלום של 30% ממחיר ההופעה.',
    '• כוח עליון שאינו מאפשר את קיום האירוע אינו ביטול: ההופעה תידחה למועד חלופי שיתואם בין הצדדים, בלי דמי ביטול.',
  ].join('\n'),
  // The Doc quoted «X ₪ פלוס מע״מ».
  prices_include_vat: 0,
  deposit_percent: 30,
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

/**
 * A show in Eilat, from the quote sent to מייד פיננסים for Isla 42 Play (November 2025), with
 * what that quote left open written in.
 *
 * Eilat is too far to play and drive home the same night, so the band either drives down and is
 * paid back for the road, or flies and the production books the flights. Those are two different
 * offers to a client, so they are two templates rather than one with both written in.
 *
 * What the band costs is the same show as anywhere: the lines, the timings, the stage and the
 * payment are the standard template's, with that quote's 30,000 ₪ as the show's price. What
 * Eilat adds:
 * - The travel. By car, it is a line of its own (2,500 ₪ in that quote, for about 700 km there
 *   and back), so it is priced in the totals with VAT like everything else, where the quote's
 *   «בסה״כ 2,500 ש״ח» left that unsaid. By plane, the production books and pays, as it does the
 *   hotel, so there is no line: a line at no charge would read «כלול», as if the band paid.
 * - The hotel, which that quote asked for «עבור חברי הלהקה» without saying for how many, when,
 *   or by when the band would know it was booked.
 * - Dinner on the day and breakfast the next morning, which that quote had. Breakfast now comes
 *   with the room.
 * - What happens when the event is cancelled with the band already on the road, and a flight
 *   that is late or cancelled, which nothing in that quote covered.
 * - הנחיות פיקוד העורף as force majeure by name, in place of the quote's COVID-era «סגר».
 *
 * Cancellation is the standard template's 30% of the show's price, not the 25% that one quote
 * gave, and the travel line is outside it: a fee for cancelling is not a fee on petrol.
 */
function eilatTemplate(by: 'car' | 'plane') {
  const car = by === 'car';
  return {
    template_name: car ? 'מונלייט — אילת, ברכב' : 'מונלייט — אילת, בטיסה',
    title: 'הופעת מונלייט באילת — להקת המחווה לקולדפליי',
    event_location: 'אילת',
    show_duration: 'כשעה וחצי',
    intro: [
      'תודה שפניתם אלינו!',
      'שמחים להציע לכם הופעה של מונלייט — להקת המחווה לקולדפליי — באילת, ב־{event_date}. כאן תמצאו את ההרכב, המחיר ומה שצריך להכין לקראת ההופעה. אילת רחוקה מהמרכז, ולכן ההצעה מפרטת גם את הנסיעה ואת הלינה של הלהקה.',
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
      // That quote's price, so a quote from here needs no price typed unless the client's differs.
      { ...BUILTIN_TEMPLATE.items[0], unit_price: 30000 },
      BUILTIN_TEMPLATE.items[1],
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
 * once (see seedBuiltinTemplates), in this order, so on a new install Moonlight's own comes first
 * and is the default.
 */
export const BUILTIN_TEMPLATES = {
  moonlight: BUILTIN_TEMPLATE,
  eilat_car: eilatTemplate('car'),
  eilat_plane: eilatTemplate('plane'),
};
