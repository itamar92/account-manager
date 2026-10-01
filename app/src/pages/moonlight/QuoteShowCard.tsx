import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarCheck2, CalendarDays, ExternalLink } from 'lucide-react';
import { get, nis, post } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card } from '../../ui';
import {
  isOptionTitle, quoteDate, type Quote, type QuoteItem, type QuoteShow, type ShowCandidate,
} from './quotes';

type QuoteResponse = { quote: Quote; items: QuoteItem[]; show: QuoteShow | null };

/** Mirrors AMOUNT_TOLERANCE in server/quoteShow.ts: a shekel is rounding, not a disagreement. */
const disagree = (a: number, b: number) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 1;

/**
 * The quote's date on the calendar, and the show that came of it.
 *
 * Shows come from the calendar only. So the card's first job is the quote's event — the date
 * held as «אופציה», then renamed when the client signs — and the show below is whatever the sync
 * made of that event, or a show already on the date. What signing could not settle on its own
 * is finished here: several shows on the date, a price that differs, a title still «אופציה».
 */
export function QuoteShowCard({ quote, show, calendarReady, saveFirst, onChange, onError, onOpenCalendar }: {
  quote: Quote;
  show: QuoteShow | null;
  calendarReady: boolean;
  saveFirst: () => Promise<boolean>;
  onChange: (data: QuoteResponse) => void;
  onError: (message: string) => void;
  onOpenCalendar: () => void;
}) {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [candidates, setCandidates] = useState<ShowCandidate[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const signed = quote.status === 'signed';
  const date = quote.event_date;
  const hasEvent = !!quote.calendar_event_id;
  const stillOption = signed && hasEvent && isOptionTitle(quote.calendar_event_title);
  const looking = !show || picking;

  useEffect(() => {
    if (!looking || !date) { setCandidates(null); return; }
    get(`/moonlight/quotes/show-candidates?date=${date}&quote_id=${quote.id}`)
      .then((d) => setCandidates((d.shows as ShowCandidate[]).filter((s) => s.id !== show?.id)))
      .catch(() => setCandidates([]));
  }, [looking, date, show?.id, quote.id]);

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      if (!(await saveFirst())) return;
      onChange(await post(`/moonlight/quotes/${quote.id}/${path}`, body));
      setPicking(false);
    } catch (err: any) { onError(err.message); }
    finally { setBusy(false); }
  };
  const link = (target: string | null) => act('link-show', { show_id: target });

  const mismatch = signed && show && !quote.show_amount_ok && disagree(show.amount_pre_vat, quote.net_amount);

  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">יומן והופעה</h2>

      {/* ---- the calendar event ---- */}
      {hasEvent ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex items-start gap-1.5">
              <CalendarDays size={16} className="shrink-0 mt-0.5 text-muted" />
              <div className="min-w-0">
                <div className="font-medium text-sm">{quote.calendar_event_title || 'אירוע ביומן'}</div>
                {quote.calendar_event_link && (
                  <a href={quote.calendar_event_link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
                    פתיחה ביומן Google <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
            {!stillOption && (
              <Button variant="ghost" disabled={busy || !calendarReady} onClick={onOpenCalendar}>עריכת האירוע</Button>
            )}
          </div>
          {stillOption && (
            <div className="bg-warn-soft rounded-xl px-4 py-3 space-y-2.5">
              <p className="flex items-start gap-2 text-[13.5px] text-ink-2">
                <AlertTriangle size={16} className="text-warn-ink shrink-0 mt-0.5" />
                הלקוח חתם, והאירוע ביומן עדיין מסומן «אופציה».
              </p>
              <Button disabled={!calendarReady} onClick={onOpenCalendar}>עדכון האירוע והסרת «אופציה»</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] text-muted">
            {signed
              ? 'הלקוח חתם, ואין להצעה אירוע ביומן. ההופעה נוצרת מהיומן — צרו את האירוע כאן או ביומן עצמו.'
              : 'שריון התאריך ביומן כ«אופציה», עם הזמנה ללהקה ולספקים. ההופעה נוצרת מהאירוע, כמו מכל אירוע ביומן.'}
          </p>
          {calendarReady
            ? <Button variant="ghost" disabled={!date} onClick={onOpenCalendar}>{signed ? 'יצירת אירוע ביומן' : 'שריון ביומן כאופציה'}</Button>
            : <p className="text-[12.5px] text-faint">היומן לא מחובר לאפליקציה — את האירוע יוצרים ישירות ב־Google Calendar.</p>}
          {!date && calendarReady && <p className="text-[12px] text-faint">צריך קודם תאריך אירוע.</p>}
        </div>
      )}

      {/* ---- the show ---- */}
      <div className="border-t border-line pt-3.5 space-y-3">
        {show ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link to={`/moonlight/shows/${show.id}`} className="flex items-center gap-1.5 font-semibold text-accent hover:underline">
                <CalendarCheck2 size={16} className="shrink-0" />
                <span className="truncate">{show.venue}</span>
                <span className="num font-normal text-muted">· {quoteDate(show.date)}</span>
              </Link>
              <p className="text-[12.5px] text-muted mt-1">
                {signed
                  ? 'ההצעה החתומה משויכת להופעה הזו.'
                  : 'כשהלקוח יחתום, סכום ההצעה ייכנס להופעה הזו — אם עוד אין בה סכום.'}
              </p>
            </div>
            {!picking && (
              <button type="button" disabled={busy} onClick={() => (signed ? setPicking(true) : link(null))}
                className="text-[13px] text-muted hover:text-ink-2 shrink-0">
                {signed ? 'זו לא ההופעה הנכונה' : 'ביטול השיוך'}
              </button>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            {hasEvent
              ? 'ההופעה תופיע כאן ברגע שהסנכרון ייצור אותה מהאירוע.'
              : signed
                ? quote.show_link_status === 'choose'
                  ? 'יש כמה הופעות בתאריך הזה — בחרו לאיזו ההצעה שייכת.'
                  : 'עוד אין הופעה להצעה.'
                : 'עוד אין הופעה להצעה.'}
          </p>
        )}

        {mismatch && (
          <div className="bg-warn-soft rounded-xl px-4 py-3 space-y-2.5">
            <p className="flex items-start gap-2 text-[13.5px] text-ink-2">
              <AlertTriangle size={16} className="text-warn-ink shrink-0 mt-0.5" />
              <span>
                בהופעה רשום <span className="num font-semibold">{nis(show!.amount_pre_vat)}</span> לפני מע״מ,
                ובהצעה החתומה <span className="num font-semibold">{nis(quote.net_amount)}</span>.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {isOwner && (
                <Button disabled={busy} onClick={() => act('show-amount', { use: 'quote' })}>עדכון ההופעה לסכום ההצעה</Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => act('show-amount', { use: 'show' })}>הסכום בהופעה נכון</Button>
            </div>
            {!isOwner && <p className="text-[12px] text-muted">את סכום ההופעה משנה בעל החשבון.</p>}
          </div>
        )}

        {/* Shows already on the date — from the calendar, or typed in — the quote could be for. */}
        {looking && date && candidates && candidates.length > 0 && (
          <div className="space-y-2">
            <p className="text-[13px] text-muted">
              {candidates.length === 1 ? 'יש הופעה בתאריך הזה — לשייך?' : `יש ${candidates.length} הופעות בתאריך הזה — לאיזו?`}
            </p>
            <ul className="divide-y divide-line border-y border-line">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium truncate">{c.venue}</div>
                    <div className="text-[12px] text-faint">
                      {c.location && <>{c.location} · </>}
                      {Number(c.amount_pre_vat) ? <span className="num">{nis(c.amount_pre_vat)}</span> : 'בלי סכום'}
                      {c.taken_by && <> · של הצעה אחרת (<span className="num">{c.taken_by}</span>)</>}
                    </div>
                  </div>
                  <Button variant="ghost" disabled={busy || !!c.taken_by} onClick={() => link(c.id)}>שיוך</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {picking && (
          <div className="space-y-1.5">
            {candidates?.length === 0 && <p className="text-[13px] text-faint">אין עוד הופעות בתאריך הזה.</p>}
            <Button variant="ghost" onClick={() => setPicking(false)}>ביטול</Button>
            <p className="text-[12px] text-faint">אם סכום ההצעה כבר נכנס להופעה הנוכחית, הוא נשאר בה — עדכנו אותו שם אם צריך.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
