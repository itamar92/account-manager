/**
 * The message that takes a quote's link to the client, and the links that open it in WhatsApp
 * or in an email.
 *
 * No imports, like quoteMath.ts: the server builds the message when a quote is sent, and the
 * share dialog imports this same file to rebuild the links when somebody edits the message
 * before sending it. The app itself sends nothing — every one of these opens the sender's own
 * WhatsApp or mail, so the client's reply comes back to a person rather than to a server.
 */

export const DEFAULT_MESSAGE = [
  'שלום {client_name},',
  'מצורפת הצעת המחיר שלנו לאירוע ב־{event_date}.',
  'לצפייה ולאישור בחתימה: {link}',
  'ההצעה בתוקף עד {valid_until}.',
  'תודה, {contact_name}',
].join('\n');

export const DEFAULT_SUBJECT = 'הצעת מחיר {quote_number} — {title}';

/** The placeholders a message can use, each already written as the client should read it. */
export interface MessageFields {
  client_name: string;
  title: string;
  event_date: string;
  valid_until: string;
  link: string;
  contact_name: string;
  quote_number: string;
}

export const MESSAGE_PLACEHOLDERS: Array<keyof MessageFields> = [
  'client_name', 'title', 'event_date', 'valid_until', 'link', 'contact_name', 'quote_number',
];

/**
 * The template with its placeholders filled in. A placeholder at the end of a line with nothing
 * to fill would leave «תודה, » behind, so that line loses its trailing comma; a line that was
 * nothing but such a placeholder goes, and so do the blank lines that leaves at the end. A comma
 * somebody wrote on purpose, as in «שלום דנה,», stays.
 */
export function fillMessage(template: string, fields: MessageFields): string {
  const fill = (line: string) =>
    MESSAGE_PLACEHOLDERS.reduce((out, key) => out.replaceAll(`{${key}}`, fields[key] ?? ''), line);
  const endsEmpty = (line: string) =>
    MESSAGE_PLACEHOLDERS.some((key) => !fields[key] && line.trimEnd().endsWith(`{${key}}`));
  return template
    .split('\n')
    .map((line) => (endsEmpty(line) ? fill(line).replace(/[ \t,]+$/, '') : fill(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A phone number as WhatsApp addresses it: digits only, with the country code. An Israeli
 * number is written however it was typed — 050-1234567, +972 50 123 4567, 0501234567 — and a
 * foreign one counts only when it was typed with its +. Anything else is no number at all, and
 * WhatsApp then asks who to send to.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length >= 11 && digits.length <= 12) return digits;
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 10) return `972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('5')) return `972${digits}`;
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}

export const whatsappUrl = (phone: string | null | undefined, text: string) => {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`;
};

/** Only an address that is plainly one goes into the link; anything else is left for the mail app. */
const plainEmail = (email: string | null | undefined) => {
  const s = String(email ?? '').trim();
  return /^[^\s@,;?&]+@[^\s@,;?&]+\.[^\s@,;?&]+$/.test(s) ? s : '';
};

/** Opens the device's own mail app. Line breaks are CRLF, which is what mail clients expect in a mailto body. */
export const mailtoUrl = (email: string | null | undefined, subject: string, body: string) =>
  `mailto:${plainEmail(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`;

/** Gmail's compose window, for whoever reads mail in the browser rather than in an app. */
export const gmailUrl = (email: string | null | undefined, subject: string, body: string) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(plainEmail(email))}`
  + `&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
