import React from 'react';
import { clsx } from 'clsx';
import { CalendarDays, MapPin, PartyPopper, Timer, Users } from 'lucide-react';
import { nis, nisExact } from '../api';
import type { QuoteTotals } from '../../server/quoteMath';
import {
  israelDateTime, issuedOn, quoteDate, type ClientSignature, type LogoPosition, type Quote, type QuoteBranding,
} from '../pages/moonlight/quotes';
import { readableOnWhite, textOn } from './colors';

/** Whole shekels where the figure is whole, agorot where it is not — a quote never rounds a sum it states. */
const money = (n: number) => (Math.round(n * 100) % 100 === 0 ? nis(n) : nisExact(n));

export type QuoteDocumentQuote = Pick<Quote,
  'quote_number' | 'title' | 'client_name' | 'event_type' | 'event_date' | 'event_location'
  | 'guest_count' | 'show_duration' | 'intro' | 'terms' | 'valid_until' | 'contact_name'
  | 'contact_phone' | 'prices_include_vat' | 'vat_percent'>
  & Partial<Pick<Quote, 'is_template' | 'created_at'>>;

/**
 * A quote as the client reads it.
 *
 * This is the only place a quote is drawn: the editor's preview renders it, and the client's
 * page will render the very same component, so what the band looks at before sending is what
 * the client sees and signs. Text is only ever rendered as text — nothing a person typed into a
 * quote is interpreted as markup.
 *
 * Narrow by design: most clients open a quote from WhatsApp, on a phone, so the lines are a
 * list rather than a four-column table. It sizes itself by its own width (a container query),
 * not the screen's, so the phone frame of the preview and the editor's side panel lay it out
 * exactly as a phone would.
 *
 * The band's colours come in through `branding`. The header's text picks whichever of light or
 * dark reads on the colour chosen, and the accent is darkened as far as it needs to be to read
 * on white, so no choice in the settings can make a quote illegible.
 */
export function QuoteDocument({ quote, totals, branding, clientSignature, clientLine = true }: {
  quote: QuoteDocumentQuote;
  totals: QuoteTotals;
  branding: QuoteBranding;
  /** Once the client has signed. */
  clientSignature?: ClientSignature | null;
  /**
   * The empty line the client will sign on, so the band sees where it goes. The client's own
   * page turns it off: the box they sign in is right below the quote.
   */
  clientLine?: boolean;
}) {
  const { brandName, logoUrl, logoPosition, signatureUrl, signatureName } = branding;
  // A logo in the middle heads the page like a letterhead, and the title under it follows.
  const centered = logoPosition === 'center';
  const header = { backgroundColor: branding.primary, color: textOn(branding.primary) };
  const accent = { color: readableOnWhite(branding.accent) };
  const vatPercent = Number(quote.vat_percent) || 0;
  const includesVat = !!quote.prices_include_vat;
  const lines = totals.lines.filter((l) => l.name || l.total);
  // A template has no date of its own; a quote is dated the day it was made, as the Doc was.
  const issued = quote.quote_number ? issuedOn(quote.created_at) : '';
  const chips = [
    quote.event_type && { icon: PartyPopper, text: quote.event_type, label: 'סוג האירוע' },
    quote.event_date && { icon: CalendarDays, text: quoteDate(quote.event_date), label: 'תאריך האירוע' },
    quote.event_location && { icon: MapPin, text: quote.event_location, label: 'מקום' },
    quote.show_duration && { icon: Timer, text: quote.show_duration, label: 'משך ההופעה' },
    quote.guest_count && { icon: Users, text: `${quote.guest_count} אורחים`, label: 'מספר אורחים' },
  ].filter(Boolean) as Array<{ icon: React.ElementType; text: string; label: string }>;

  return (
    <article className="quote-doc @container bg-surface border border-line rounded-2xl overflow-hidden text-ink shadow-[0_1px_2px_rgba(20,24,32,.04)]">
      <header style={header} className={clsx('px-5 py-6 @xl:px-8 @xl:py-7', centered && 'text-center')}>
        <QuoteMasthead brandName={brandName} logoUrl={logoUrl} position={logoPosition} lines={[
          'הצעת מחיר',
          quote.quote_number && <span className="num" dir="ltr">{quote.quote_number}</span>,
          issued && <span className="num">{issued}</span>,
        ]} />
        <h1 className="ser text-[21px] @xl:text-[26px] leading-snug mt-6">{quote.title || 'הצעת מחיר'}</h1>
        {quote.client_name && <p className="mt-1.5 text-[15px] opacity-80">עבור {quote.client_name}</p>}
        {chips.length > 0 && (
          <ul className={clsx('mt-4 flex flex-wrap gap-2', centered && 'justify-center')}>
            {chips.map(({ icon: Icon, text, label }) => (
              <li key={label} title={label} className="flex items-center gap-1.5 bg-current/10 rounded-full px-3 py-1 text-[12.5px]">
                <Icon size={13} className="shrink-0 opacity-70" /> {text}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="px-5 py-6 @xl:px-8 @xl:py-7 space-y-7">
        {quote.intro && <QuoteText text={quote.intro} className="text-[15px] leading-7 text-body" />}

        <section>
          <h2 style={accent} className="text-[12px] font-semibold tracking-[.08em] mb-2">פירוט ההצעה</h2>
          {lines.length === 0 ? (
            <p className="text-sm text-faint py-3">עדיין אין שורות בהצעה</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {lines.map((line, i) => (
                <li key={i} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[15px]">{line.name}</div>
                    {line.description && (
                      <div className="text-[13px] text-muted whitespace-pre-line mt-0.5">{line.description}</div>
                    )}
                  </div>
                  <div className="text-end shrink-0">
                    {/* A template's first line is priced in each quote made from it; any other
                        line at no charge is part of the price, which is what the client should read. */}
                    {quote.is_template && i === 0 && !line.total
                      ? <div className="text-[13px] text-faint">נקבע בכל הצעה</div>
                      : !line.total
                        ? <div className="font-semibold text-muted">כלול</div>
                        : <div className="num font-semibold">{money(line.total)}</div>}
                    {line.quantity !== 1 && line.total !== 0 && (
                      <div className="num text-[12px] text-faint" dir="ltr">
                        {line.quantity} × {money(line.unit_price)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <dl className="mt-4 ms-auto max-w-xs space-y-1.5 text-[14px]">
            {totals.discount > 0 && (
              <>
                <Row label="סכום ביניים" value={money(totals.subtotal)} />
                <Row label="הנחה" value={`−${money(totals.discount)}`} className="text-pos" />
              </>
            )}
            {!includesVat && (
              <>
                <Row label='סה"כ לפני מע"מ' value={money(totals.net_amount)} />
                <Row label={`מע"מ ${vatPercent}%`} value={money(totals.vat_amount)} />
              </>
            )}
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2.5 mt-2.5">
              <dt className="font-semibold">סה"כ לתשלום</dt>
              <dd style={accent} className="num text-xl font-extrabold tracking-[-0.02em]">{money(totals.total)}</dd>
            </div>
            <p className="text-[12px] text-faint text-end">
              {includesVat
                ? `המחיר כולל מע"מ ${vatPercent}% (${money(totals.vat_amount)})`
                : `המחירים אינם כוללים מע"מ`}
            </p>
          </dl>
        </section>

        {quote.terms && (
          <section>
            <h2 style={accent} className="text-[12px] font-semibold tracking-[.08em] mb-2">תנאי ההצעה</h2>
            <QuoteText text={quote.terms} className="text-[13.5px] leading-6 text-body" />
          </section>
        )}

        {/* The two sides of the agreement: the client's at the near side, the band's — signed in
            advance — at the far one. */}
        {(signatureUrl || clientSignature || clientLine) && (
          <section className="grid grid-cols-2 gap-6 @xl:gap-12 items-end pt-2 break-inside-avoid">
            <div className="text-center min-w-0">
              {clientSignature
                ? <img src={clientSignature.png} alt={`חתימה — ${clientSignature.name}`}
                    className="h-16 w-auto max-w-full mx-auto object-contain" />
                : clientLine && <div className="h-16" />}
              {(clientSignature || clientLine) && (
                <div className="border-t border-line-strong mt-1 pt-1.5 text-[13px]">
                  <div className="font-semibold truncate">{clientSignature?.name || quote.client_name || 'המזמין'}</div>
                  <div className="text-[12px] text-muted">
                    {clientSignature
                      ? <>נחתם ב־<span className="num">{israelDateTime(clientSignature.signedAt)}</span></>
                      : 'חתימת המזמין'}
                  </div>
                </div>
              )}
            </div>
            <div className="text-center min-w-0">
              {signatureUrl
                ? <img src={signatureUrl} alt={`חתימה — ${signatureName || brandName}`}
                    className="h-16 w-auto max-w-full mx-auto object-contain" />
                : <div className="h-16" />}
              <div className="border-t border-line-strong mt-1 pt-1.5 text-[13px]">
                {signatureName && <div className="font-semibold truncate">{signatureName}</div>}
                <div className="text-[12px] text-muted">בשם {brandName}</div>
              </div>
            </div>
          </section>
        )}
      </div>

      {(quote.valid_until || quote.contact_name || quote.contact_phone) && (
        <footer className="border-t border-line bg-soft px-5 py-4 @xl:px-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-muted">
          <span>{quote.valid_until && <>ההצעה בתוקף עד <span className="num">{quoteDate(quote.valid_until)}</span></>}</span>
          {(quote.contact_name || quote.contact_phone) && (
            <span>
              {quote.contact_name}
              {quote.contact_name && quote.contact_phone && ' · '}
              {quote.contact_phone && <span dir="ltr" className="num">{quote.contact_phone}</span>}
            </span>
          )}
        </footer>
      )}
    </article>
  );
}

/**
 * The top of a quote's header: the logo where the settings put it, and the small print of the
 * quote — its number and date. Beside a logo at the right or the left, the small print takes the
 * corner across from it. Under a logo in the middle, it is one line centred beneath, letterhead
 * fashion, which also leaves the logo the whole width of a phone rather than a third of it.
 *
 * The settings draw their preview with this same piece, so the choice there is the quote's.
 */
export function QuoteMasthead({ brandName, logoUrl, position, lines, size = 'document' }: {
  brandName: string;
  logoUrl: string | null;
  position: LogoPosition;
  /** The small print, a line each; an empty one is left out. */
  lines: React.ReactNode[];
  size?: 'document' | 'preview';
}) {
  const preview = size === 'preview';
  const shown = lines.filter(Boolean);
  // A logo usually spells the name already, so it stands in for it rather than beside it.
  const mark = logoUrl
    ? <img src={logoUrl} alt={brandName} className={clsx(
        'w-auto object-contain',
        preview ? 'h-11 max-w-[160px]' : 'h-12 @xl:h-14 max-w-[180px]',
        { right: 'object-right', center: 'object-center', left: 'object-left' }[position],
      )} />
    : <div className={clsx('ser tracking-wide', preview ? 'text-xl' : 'text-[22px] @xl:text-2xl')}>{brandName}</div>;
  const small = clsx('opacity-65', preview ? 'text-[11px] leading-4' : 'text-[12px] leading-5');

  if (position === 'center') {
    return (
      <div className="flex flex-col items-center">
        {mark}
        <div className={clsx(small, 'mt-2 flex flex-wrap justify-center gap-x-1.5')}>
          {shown.map((line, i) => (
            <React.Fragment key={i}>{i > 0 && <span aria-hidden>·</span>}<span>{line}</span></React.Fragment>
          ))}
        </div>
      </div>
    );
  }
  // The page reads right to left, so «right» is where it starts.
  return (
    <div className={clsx('flex items-start justify-between gap-4', position === 'left' && 'flex-row-reverse')}>
      {mark}
      <div className={clsx(small, position === 'left' ? 'text-start' : 'text-end')}>
        {shown.map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
}

/** A list item's mark at the start of a line: «• », «- » or «* ». */
const BULLET = /^\s*[•\-*]\s+/;

/** A short line ending in a colon, and not itself a list item, heads what comes under it. */
const isHeading = (line: string) => !BULLET.test(line) && /:\s*$/.test(line) && line.trim().length <= 60;

/**
 * Text as somebody typed it into the intro or the terms, laid out as a document: a line ending in
 * a colon is a heading, lines starting with «•» or «-» are a list, and everything else is a
 * paragraph that keeps its line breaks. Nothing is read as markup — every piece is still a text
 * node — so the worst a stray colon can do is bold a line.
 */
export function QuoteText({ text, className }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length} className="whitespace-pre-line">{paragraph.join('\n')}</p>);
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc ps-5 space-y-1 marker:text-ghost">
          {list.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      );
    }
    paragraph = [];
    list = [];
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) flush();
    else if (BULLET.test(line)) {
      if (paragraph.length) flush();
      list.push(line.replace(BULLET, ''));
    } else if (isHeading(line)) {
      flush();
      blocks.push(<h3 key={blocks.length} className="font-semibold text-ink pt-2 first:pt-0">{line.trim()}</h3>);
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return <div className={`space-y-2 ${className ?? ''}`}>{blocks}</div>;
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={`num ${className ?? ''}`}>{value}</dd>
    </div>
  );
}
