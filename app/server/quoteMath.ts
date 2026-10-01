/**
 * A quote's arithmetic, and nothing else.
 *
 * It has no imports on purpose: the server runs it on every save, and the editor imports this
 * same file for its live preview. One function means the figure the preview shows is the figure
 * that gets saved, and later signed — two copies of it would sooner or later disagree by an
 * agora, on the one document where that matters.
 */

export interface QuoteLineInput {
  name: string;
  description?: string | null;
  quantity: number;
  unit_price: number;
}

export interface QuoteLine extends QuoteLineInput {
  total: number;
}

export interface QuoteTotals {
  lines: QuoteLine[];
  subtotal: number;
  /** The discount actually applied — never more than the subtotal. */
  discount: number;
  /** Before VAT, after the discount. What a show's `amount_pre_vat` is. */
  net_amount: number;
  vat_amount: number;
  /** What the client pays. What a show's `amount_with_vat` is. */
  total: number;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** A number out of a form field: anything unreadable or negative counts as nothing. */
const amount = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Prices are either before VAT, which is then added on top, or already include it, which is
 * then taken back out of the total. A private client is usually quoted the second way and a
 * business the first; the quote says which, so the same four lines add up correctly either way.
 *
 * The discount is a sum of shekels taken off the lines before VAT is worked out — in the same
 * terms the lines are priced in, so a discount on a VAT-inclusive quote comes off the price the
 * client sees.
 */
export function computeTotals(
  input: QuoteLineInput[],
  discount: unknown,
  vatPercent: number,
  pricesIncludeVat: boolean
): QuoteTotals {
  const lines = input.map((line) => {
    const quantity = amount(line.quantity);
    const unit_price = round2(amount(line.unit_price));
    return { ...line, quantity, unit_price, total: round2(quantity * unit_price) };
  });
  const subtotal = round2(lines.reduce((sum, l) => sum + l.total, 0));
  const applied = round2(Math.min(amount(discount), subtotal));
  const after = round2(subtotal - applied);
  const rate = Math.max(0, Number(vatPercent) || 0) / 100;

  if (pricesIncludeVat) {
    const net = round2(after / (1 + rate));
    return { lines, subtotal, discount: applied, net_amount: net, vat_amount: round2(after - net), total: after };
  }
  const vat = round2(after * rate);
  return { lines, subtotal, discount: applied, net_amount: after, vat_amount: vat, total: round2(after + vat) };
}
