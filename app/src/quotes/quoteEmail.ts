import { nis, nisExact } from '../api';
import { readableOnWhite, textOn } from './colors';
import type { EmailCard } from '../pages/moonlight/quotes';

/**
 * The email a quote's link goes out in, as HTML a mailbox will show: the band's header, the
 * message, a card with what is being offered, and one button to the quote.
 *
 * The app sends nothing itself (see server/quoteShare.ts), and neither a `mailto:` link nor
 * Gmail's compose window can carry HTML. So the share dialog puts this on the clipboard as rich
 * text and opens the compose window empty; pasting it in gives the client the designed email,
 * from the sender's own mailbox.
 *
 * Written for mail clients, not browsers: tables for layout, every style inline, no stylesheet
 * and no script, and images only by absolute address. Everything a person typed is escaped, so a
 * client name can only ever be text.
 */

const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const INK = '#14161a';
const MUTED = '#5f6470';
const FAINT = '#8a8f99';
const LINE = '#e8e6ef';
const SOFT = '#f7f6fb';
const PAGE = '#f1f0f5';

const DEFAULT_BUTTON = 'לצפייה בהצעה ולחתימה';
/** Longer than this, the line the link was on reads as a sentence rather than as a button. */
const MAX_BUTTON_CHARS = 40;

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Only a web address becomes a link; anything else stays text. */
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : '');

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g;

/** A line of the message as HTML: escaped, with any web address in it made a link. */
function lineHtml(line: string, accent: string): string {
  let out = '';
  let last = 0;
  for (const match of line.matchAll(URL_IN_TEXT)) {
    out += escapeHtml(line.slice(last, match.index));
    const url = match[0];
    out += `<a href="${escapeHtml(url)}" style="color:${accent};text-decoration:underline;word-break:break-all;">${escapeHtml(url)}</a>`;
    last = (match.index ?? 0) + url.length;
  }
  return out + escapeHtml(line.slice(last));
}

/** Lines into paragraphs: a blank line between them, and a single break kept as one. */
function paragraphs(lines: string[], accent: string): string {
  const blocks: string[][] = [[]];
  for (const line of lines) {
    if (line.trim()) blocks[blocks.length - 1].push(line);
    else if (blocks[blocks.length - 1].length) blocks.push([]);
  }
  return blocks
    .filter((b) => b.length)
    .map((b) => `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">${b.map((l) => lineHtml(l, accent)).join('<br>')}</p>`)
    .join('');
}

/**
 * The message, split where its link is. The line the link sits on — «לצפייה ולאישור בחתימה:
 * {link}» in the default message — becomes the button, worded as that line was, so the message
 * in the settings stays the one thing to edit. A message without the link still gets the button,
 * at its end.
 */
export function splitMessage(message: string, link: string) {
  const lines = message.replace(/\r\n?/g, '\n').split('\n');
  const at = link ? lines.findIndex((l) => l.includes(link)) : -1;
  if (at < 0) return { before: lines, label: DEFAULT_BUTTON, after: [] as string[] };
  const words = lines[at].replace(link, ' ').replace(/^[\s:\-–—]+|[\s:\-–—]+$/g, '').replace(/\s{2,}/g, ' ');
  const asButton = words.length > 0 && words.length <= MAX_BUTTON_CHARS;
  return {
    before: asButton || !words ? lines.slice(0, at) : [...lines.slice(0, at), words],
    label: asButton ? words : DEFAULT_BUTTON,
    after: lines.slice(at + 1),
  };
}

/** As the quote writes it: whole shekels where the sum is whole, agorot where it is not. */
const money = (n: number) => (Math.round(n * 100) % 100 === 0 ? nis(n) : nisExact(n));

function cardRow(label: string, value: string, strong = '') {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
    <td align="left" style="padding:6px 0 6px 0;font-size:${strong ? '20px' : '14px'};font-weight:${strong ? '800' : '600'};color:${strong || INK};text-align:left;">${value}</td>
  </tr>`;
}

/** The email itself — the part that goes on the clipboard and into the compose window. */
export function quoteEmailHtml({ card, message, link }: { card: EmailCard; message: string; link: string }): string {
  const header = { bg: card.color_primary, fg: textOn(card.color_primary) };
  const accent = readableOnWhite(card.color_accent);
  const align = card.logo_position;
  const url = safeUrl(link);
  const { before, label, after } = splitMessage(message, link);

  const mark = card.logo_url && safeUrl(card.logo_url)
    ? `<img src="${escapeHtml(card.logo_url)}" alt="${escapeHtml(card.brand_name)}" height="52" style="display:inline-block;height:52px;width:auto;max-width:220px;border:0;outline:none;text-decoration:none;">`
    : `<span style="font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:32px;letter-spacing:.5px;color:${header.fg};">${escapeHtml(card.brand_name)}</span>`;
  const quoteLine = ['הצעת מחיר', card.quote_number].filter(Boolean).map(escapeHtml).join(' · ');

  const rows = [
    card.event_date && cardRow('תאריך האירוע', `<span dir="ltr">${escapeHtml(card.event_date)}</span>`),
    card.event_location && cardRow('מקום', escapeHtml(card.event_location)),
    cardRow('סה״כ לתשלום', `<span dir="ltr">${money(card.total)}</span>`, accent),
  ].filter(Boolean).join('');
  const vatNote = card.vat_percent > 0 ? `כולל מע״מ ${card.vat_percent}%` : '';

  const button = url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:22px auto 8px;">
        <tr><td align="center" bgcolor="${accent}" style="border-radius:12px;background:${accent};">
          <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 18px;text-align:center;font-size:12px;line-height:18px;color:${FAINT};">
        או בקישור: <a href="${escapeHtml(url)}" style="color:${FAINT};text-decoration:underline;word-break:break-all;">${escapeHtml(url)}</a>
      </p>`
    : '';

  const contact = [
    card.contact_name && escapeHtml(card.contact_name),
    card.contact_phone && `<a href="tel:${escapeHtml(card.contact_phone.replace(/[^\d+]/g, ''))}" style="color:${MUTED};text-decoration:none;" dir="ltr">${escapeHtml(card.contact_phone)}</a>`,
  ].filter(Boolean).join(' · ');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;background:${PAGE};font-family:${FONT};direction:rtl;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
      <tr><td align="${align}" bgcolor="${header.bg}" style="background:${header.bg};padding:26px 28px 22px;text-align:${align};color:${header.fg};">
        ${mark}
        <div style="margin-top:10px;font-size:12px;line-height:16px;letter-spacing:.3px;color:${header.fg};opacity:.7;">${quoteLine}</div>
      </td></tr>
      <tr><td style="padding:28px 28px 8px;text-align:right;">
        ${paragraphs(before, accent)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${SOFT}" style="width:100%;background:${SOFT};border:1px solid ${LINE};border-radius:12px;margin:8px 0 4px;">
          <tr><td style="padding:18px 20px 12px;">
            <div style="font-size:17px;line-height:24px;font-weight:700;color:${INK};margin-bottom:6px;">${escapeHtml(card.title)}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">${rows}</table>
            ${vatNote ? `<div style="font-size:12px;line-height:16px;color:${FAINT};text-align:left;">${vatNote}</div>` : ''}
          </td></tr>
        </table>
        ${button}
        ${paragraphs(after, accent)}
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid ${LINE};background:${SOFT};font-size:13px;line-height:20px;color:${MUTED};text-align:right;">
        ${contact ? `${contact}<br>` : ''}<span style="color:${FAINT};">${escapeHtml(card.brand_name)}</span>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

/** The same email as a page of its own, for the dialog's preview. */
export const quoteEmailDocument = (args: { card: EmailCard; message: string; link: string }) =>
  `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
  + `<style>body{margin:0;background:${PAGE};}</style></head><body>${quoteEmailHtml(args)}</body></html>`;
