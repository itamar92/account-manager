/**
 * Outgoing email — the one place the app sends anything itself.
 *
 * Everything else that reaches a person (a quote, a payment reminder) opens in the sender's own
 * mail app, because those are messages somebody should read before they go. A campaign task
 * reminder is different: it is the app keeping a date nobody wants to keep in their head, and
 * it has to go out on that date whether anyone has the app open or not.
 *
 * Gmail over SMTP with an app password (Google Account → Security → App passwords), so the
 * reminders come from an address the band already knows and there is no mail service to sign
 * up for. `SMTP_HOST`/`SMTP_PORT` point it elsewhere if that ever changes.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { getBandName } from './db.js';
import { credential } from './credentials.js';

export class MailError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function isMailConfigured(): boolean {
  return Boolean(credential('SMTP_USER') && credential('SMTP_PASS'));
}

let transport: Transporter | null = null;

function transporter(): Transporter {
  if (!isMailConfigured()) throw new MailError('שליחת מייל לא מוגדרת — הזינו כתובת Gmail וסיסמת אפליקציה בהגדרות → חיבורים', 503);
  if (transport) return transport;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
    port,
    // 465 is TLS from the first byte; 587 starts plain and upgrades, which nodemailer does itself.
    secure: port === 465,
    auth: {
      user: credential('SMTP_USER'),
      // Google shows an app password in groups of four; the spaces are not part of it.
      pass: credential('SMTP_PASS').replace(/\s+/g, ''),
    },
  });
  return transport;
}

/**
 * Logs in to the mail server without sending anything — the settings form's «בדיקת חיבור». A fresh
 * connection, so a password just replaced is the one tested.
 */
export async function verifyMail(): Promise<void> {
  transport = null;
  try {
    await transporter().verify();
  } catch (err) {
    if (err instanceof MailError) throw err;
    throw new MailError(`השרת דחה את פרטי המייל: ${(err as Error).message}`);
  }
}

/** Replaces the SMTP connection — for tests, which send through nodemailer's JSON transport. */
export function useTransport(replacement: Transporter | null): void {
  transport = replacement;
}

export function mailFrom(): string {
  return process.env.SMTP_FROM?.trim() || `${getBandName()} <${credential('SMTP_USER')}>`;
}

export async function sendMail(message: { to: string; subject: string; html: string; text: string }): Promise<void> {
  try {
    await transporter().sendMail({ from: mailFrom(), ...message });
  } catch (err) {
    if (err instanceof MailError) throw err;
    // An SMTP failure names the server's reason ("535 Username and Password not accepted"),
    // which is the part that says what to fix. Credentials are never in it.
    throw new MailError(`שליחת המייל נכשלה: ${(err as Error).message}`);
  }
}

export function mailStatus() {
  return {
    configured: isMailConfigured(),
    from: isMailConfigured() ? mailFrom() : null,
  };
}
