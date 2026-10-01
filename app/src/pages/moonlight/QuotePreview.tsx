import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { get } from '../../api';
import { useAuth } from '../../AuthContext';
import { Empty, Segmented } from '../../ui';
import { QuoteDocument } from '../../quotes/QuoteDocument';
import { brandingOf, computeTotals, previewOf, useQuoteSettings, type Quote, type QuoteItem } from './quotes';

type Frame = 'phone' | 'desktop';

const FRAMES: Array<{ value: Frame; label: string }> = [
  { value: 'phone', label: 'טלפון' },
  { value: 'desktop', label: 'מחשב' },
];

/**
 * A quote the way the client will get it, before anybody sends it.
 *
 * It is outside the app's shell on purpose: no sidebar, no menus, just the quote on its own
 * canvas, which is what the client's link opens. On a computer it starts in a phone's width,
 * because that is where most clients will read it — straight out of WhatsApp — and the switch
 * beside it shows the wide version. It shows what is saved; the editor saves before coming here.
 */
export function QuotePreview() {
  const { id } = useParams();
  const { user, loading } = useAuth();
  const [data, setData] = useState<{ quote: Quote; items: QuoteItem[] } | null>(null);
  const [error, setError] = useState('');
  const [frame, setFrame] = useState<Frame>('phone');
  const { data: settingsData } = useQuoteSettings();

  // The shell is what normally sets the Moonlight palette, and this page is outside it.
  useEffect(() => { document.documentElement.dataset.ws = 'moon'; }, []);

  useEffect(() => {
    if (!user) return;
    get(`/moonlight/quotes/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id, user]);

  const totals = useMemo(() => data && computeTotals(
    data.items.map((i) => ({
      name: i.name, description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price),
    })),
    data.quote.discount, Number(data.quote.vat_percent) || 0, !!data.quote.prices_include_vat
  ), [data]);

  if (loading) return <Empty text="טוען…" />;
  if (!user) return <Navigate to="/login" replace />;

  const isTemplate = !!data?.quote.is_template;
  const doc = data && totals && (
    <QuoteDocument
      quote={previewOf(data.quote)}
      totals={totals}
      branding={brandingOf(settingsData?.settings)}
    />
  );

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 bg-surface border-b border-line">
        <div className="max-w-5xl mx-auto px-4 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <Link
            to={`/moonlight/quotes/${id}`}
            className="justify-self-start flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline whitespace-nowrap"
          >
            <ArrowRight size={16} /> חזרה לעריכה
          </Link>
          <div className="text-center min-w-0">
            <div className="font-semibold text-[14px]">תצוגה מקדימה</div>
            <div className="text-[12px] text-muted truncate">
              {isTemplate ? 'הצעה מהתבנית, עם לקוח לדוגמה' : 'כך הלקוח יראה את ההצעה'}
            </div>
          </div>
          <Segmented className="hidden md:flex justify-self-end" value={frame} options={FRAMES} onChange={setFrame} />
        </div>
      </header>

      <main className="px-3 py-5 md:py-8">
        {error ? <Empty text={error} /> : !doc ? <Empty text="טוען…" /> : frame === 'phone' ? (
          // The frame only exists on a wide screen; on an actual phone the quote simply is the page.
          <div className="mx-auto md:w-[410px] md:rounded-[2.5rem] md:border-[10px] md:border-ink md:bg-canvas md:p-2.5 md:shadow-[0_24px_60px_rgba(20,24,32,.22)]">
            {doc}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">{doc}</div>
        )}
      </main>
    </div>
  );
}
