import React from 'react';
import { CalendarDays, MapPin, PartyPopper, Users } from 'lucide-react';
import { nis, nisExact } from '../api';
import type { QuoteTotals } from '../../server/quoteMath';
import { quoteDate, type Quote } from '../pages/moonlight/quotes';

/** Whole shekels where the figure is whole, agorot where it is not — a quote never rounds a sum it states. */
const money = (n: number) => (Math.round(n * 100) % 100 === 0 ? nis(n) : nisExact(n));

export type QuoteDocumentQuote = Pick<Quote,
  'quote_number' | 'title' | 'client_name' | 'event_type' | 'event_date' | 'event_location'
  | 'guest_count' | 'intro' | 'terms' | 'valid_until' | 'contact_name' | 'contact_phone'
  | 'prices_include_vat' | 'vat_percent'>;

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
 */
export function QuoteDocument({ quote, totals, brandName }: {
  quote: QuoteDocumentQuote;
  totals: QuoteTotals;
  brandName: string;
}) {
  const vatPercent = Number(quote.vat_percent) || 0;
  const includesVat = !!quote.prices_include_vat;
  const lines = totals.lines.filter((l) => l.name || l.total);
  const chips = [
    quote.event_type && { icon: PartyPopper, text: quote.event_type },
    quote.event_date && { icon: CalendarDays, text: quoteDate(quote.event_date) },
    quote.event_location && { icon: MapPin, text: quote.event_location },
    quote.guest_count && { icon: Users, text: `${quote.guest_count} אורחים` },
  ].filter(Boolean) as Array<{ icon: React.ElementType; text: string }>;

  return (
    <article className="@container bg-surface border border-line rounded-2xl overflow-hidden text-ink shadow-[0_1px_2px_rgba(20,24,32,.04)]">
      <header className="bg-ink text-white px-5 py-6 @xl:px-8 @xl:py-7">
        <div className="flex items-start justify-between gap-4">
          <div className="ser text-[22px] @xl:text-2xl tracking-wide">{brandName}</div>
          <div className="text-end text-[12px] leading-5 text-white/65">
            <div>הצעת מחיר</div>
            {quote.quote_number && <div className="num" dir="ltr">{quote.quote_number}</div>}
          </div>
        </div>
        <h1 className="ser text-[21px] @xl:text-[26px] leading-snug mt-6">{quote.title || 'הצעת מחיר'}</h1>
        {quote.client_name && <p className="mt-1.5 text-[15px] text-white/80">עבור {quote.client_name}</p>}
        {chips.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {chips.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1 text-[12.5px]">
                <Icon size={13} className="shrink-0 text-white/70" /> {text}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="px-5 py-6 @xl:px-8 @xl:py-7 space-y-7">
        {quote.intro && (
          <p className="whitespace-pre-line text-[15px] leading-7 text-body">{quote.intro}</p>
        )}

        <section>
          <h2 className="text-[12px] font-semibold tracking-[.08em] text-faint mb-2">פירוט ההצעה</h2>
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
                    <div className="num font-semibold">{money(line.total)}</div>
                    {line.quantity !== 1 && (
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
              <dd className="num text-xl font-extrabold tracking-[-0.02em]">{money(totals.total)}</dd>
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
            <h2 className="text-[12px] font-semibold tracking-[.08em] text-faint mb-2">תנאי ההצעה</h2>
            <p className="whitespace-pre-line text-[13.5px] leading-6 text-body">{quote.terms}</p>
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

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={`num ${className ?? ''}`}>{value}</dd>
    </div>
  );
}
