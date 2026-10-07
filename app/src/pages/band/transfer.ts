import { get } from '../../api';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The provision rate to fall back on when the year's own estimate is not available yet. */
export const FALLBACK_TAX_RATE = 25;

/**
 * What a member hands back for their share, which is what decides how it is treated:
 * a tax invoice with מע"מ inside it, an exempt dealer's invoice with none, or nothing at all.
 */
export type InvoiceKind = 'vat' | 'exempt' | 'none';

/**
 * The two rates the transfer arithmetic runs on, each read from where it is decided rather
 * than assumed: the מע"מ rate from הגדרות, and the tax provision from the year's own projected
 * effective rate. Both fall back rather than fail — a transfer figure with a stale rate in it
 * is worth more than no figure at all.
 */
export async function fetchTransferRates(): Promise<{ vatPercent: number; taxRate: number }> {
  const [vatPercent, taxRate] = await Promise.all([
    get('/settings')
      .then((d) => Number(d.settings.vat_percent) || 18)
      .catch(() => 18),
    get(`/reports/income-tax?year=${new Date().getFullYear()}`)
      .then((d) => {
        const rate = d.report?.projection?.effective_rate ?? d.report?.estimate?.effective_rate;
        return Number(rate) > 0 ? Math.round(Number(rate) * 10) / 10 : FALLBACK_TAX_RATE;
      })
      .catch(() => FALLBACK_TAX_RATE),
  ]);
  return { vatPercent, taxRate };
}

/**
 * How a payment that landed in the private account divides.
 *
 * The identity worth knowing is that the leftover comes out the same whichever way you read it:
 * `transfer − payables` equals `profit − tax`. So the band account, after it has paid everyone
 * it owes, holds exactly the show's profit after tax — which is the sum that gets divided
 * between the members. If that number is negative the show did not pay for itself.
 *
 * The members' own invoices make that circular, and deliberately so: their share is a deductible
 * cost, so it lowers the tax, which raises the transfer, which raises the pool their share is a
 * slice of. Rather than approximate it, `distributionPool` solves the loop outright.
 */
export function splitTransfer({ received, lines, vat, taxRate, members = [] }: {
  received: number;
  lines: Array<{ amount: number; deductible: boolean }>;
  /** As a fraction — 0.18, not 18. */
  vat: number;
  /** As a fraction. */
  taxRate: number;
  /**
   * How what is left over is divided. `share` is a weight rather than a strict percentage —
   * they are normalised here, so a row entered as 30/30/20/20 and one as 3/3/2/2 mean the same.
   * An empty list means the leftover is simply reported, not divided.
   */
  members?: Array<{ share: number; invoice: InvoiceKind }>;
}) {
  const incomePreVat = received / (1 + vat);
  const outputVat = received - incomePreVat;

  let payables = 0;
  let inputVat = 0;
  let costPreVat = 0;
  for (const line of lines) {
    const gross = line.amount;
    // Without a tax invoice there is no VAT to reclaim, so the whole payment is the cost.
    const net = line.deductible ? gross / (1 + vat) : gross;
    payables += gross;
    inputVat += gross - net;
    costPreVat += net;
  }

  // The slices of the pool that come back as a bill — with reclaimable מע"מ inside, or without.
  // Everything else (the owner's own share, a member who hands back nothing) stays profit.
  const weight = members.reduce((sum, m) => sum + Math.max(0, m.share), 0);
  const sliceOf = (kind: InvoiceKind) => (weight <= 0 ? 0 : members.reduce(
    (sum, m) => sum + (m.invoice === kind ? Math.max(0, m.share) / weight : 0), 0
  ));
  const billedWithVat = sliceOf('vat');
  const billedExempt = sliceOf('exempt');

  const pool = distributionPool({
    incomePreVat, costPreVat, inputVat, payables, vat, taxRate, billedWithVat, billedExempt,
  });

  // Everything below is read back off the settled pool, so the panel and the arithmetic can
  // never disagree about which of the branches above was taken.
  const distributed = Math.max(0, pool);
  const memberGross = distributed * (billedWithVat + billedExempt);
  const memberPreVat = distributed * (billedWithVat / (1 + vat) + billedExempt);
  // Only the מס invoices carry any; an exempt dealer's does not, and is deductible in full.
  const memberInputVat = memberGross - memberPreVat;

  const vatDue = outputVat - inputVat - memberInputVat;
  const profit = incomePreVat - costPreVat - memberPreVat;
  const taxProvision = Math.max(0, profit) * taxRate;

  /**
   * What has to stay behind — and never less than nothing.
   *
   * A show that cost more than it earned has more מע"מ inside its costs than inside its income,
   * so `vatDue` comes out negative: the difference is money the state will refund, not money
   * that arrives with this show. Left as it is, it says to transfer more than actually landed
   * in the account, which is not a transfer anybody can make. The refund is real, but it is a
   * מע"מ period's business rather than this show's — so the answer here is the whole of what
   * came in, and the excess מע"מ is left to show up where it belongs, in the מע"מ report.
   */
  const keepBeforeFloor = vatDue + taxProvision;
  const keep = Math.max(0, keepBeforeFloor);
  const withheld = keep - keepBeforeFloor;

  return {
    incomePreVat: round2(incomePreVat),
    outputVat: round2(outputVat),
    inputVat: round2(inputVat + memberInputVat),
    supplierInputVat: round2(inputVat),
    memberInputVat: round2(memberInputVat),
    memberPreVat: round2(memberPreVat),
    memberGross: round2(memberGross),
    vatDue: round2(vatDue),
    profit: round2(profit),
    taxProvision: round2(taxProvision),
    keep: round2(keep),
    transfer: round2(received - keep),
    payables: round2(payables),
    // The pool follows the transfer that was actually made: capping the transfer at what came
    // in leaves the band account that much shorter of what it owes.
    leftover: round2(pool - withheld),
    /** True when the floor above bit — the מע"מ refund this show is owed but does not carry. */
    capped: round2(withheld) > 0,
    /** What each member is handed, in the order they were given. */
    shares: members.map((m) => round2(weight > 0 ? distributed * (Math.max(0, m.share) / weight) : 0)),
  };
}

/**
 * The pool left in the band account once the suppliers are paid — the sum the members divide.
 *
 * Writing the loop out: the pool `D` pays the members, a `k` of which comes back as deductible
 * cost and reclaimable מע"מ, and that reduction lands right back in the pool. So
 * `D = base + k·D`, which settles at `base / (1 − k)` rather than needing to be iterated.
 *
 * Two things about the real world make it piecewise rather than one formula. A tax provision is
 * only charged on a profit, so a loss-making show is solved again with the rate at zero; and
 * there is nothing to bill for when there is nothing to divide, so a pool that comes out at or
 * below zero is solved again as though nobody invoiced. Neither branch can bounce back: both
 * re-solves move the pool the same way they were entered from.
 */
function distributionPool({
  incomePreVat, costPreVat, inputVat, payables, vat, taxRate, billedWithVat, billedExempt,
}: {
  incomePreVat: number; costPreVat: number; inputVat: number; payables: number;
  vat: number; taxRate: number; billedWithVat: number; billedExempt: number;
}): number {
  const solve = (rate: number, billed: boolean) => {
    const withVat = billed ? billedWithVat : 0;
    const exempt = billed ? billedExempt : 0;
    const k = withVat * vat / (1 + vat) + rate * (withVat / (1 + vat) + exempt);
    const base = incomePreVat + inputVat - rate * (incomePreVat - costPreVat) - payables;
    // k stays under 1 for any real rate; the floor keeps a nonsense input finite rather than
    // letting it divide by zero.
    return base / Math.max(0.01, 1 - k);
  };

  const billing = billedWithVat + billedExempt > 0;
  let billed = billing;
  let pool = solve(taxRate, billed);
  if (pool <= 0 && billed) { billed = false; pool = solve(taxRate, false); }

  const memberPreVat = billed ? Math.max(0, pool) * (billedWithVat / (1 + vat) + billedExempt) : 0;
  if (incomePreVat - costPreVat - memberPreVat < 0) {
    pool = solve(0, billed);
    if (pool <= 0 && billed) pool = solve(0, false);
  }
  return pool;
}
