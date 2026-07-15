/**
 * Cloudflare Invoice Parser
 * Vendor: Cloudflare
 * Email Pattern: billing@cloudflare.com
 * Category: תוכנה
 */

function parseCloudflareInvoice(text, id, threadId) {
  // Extract invoice number
  const invoiceNumberMatch = text.match(/Invoice number\s+([A-Z]+-\d+)/i);
  const invoiceNumber = invoiceNumberMatch ? invoiceNumberMatch[1] : null;

  // Extract date - looking for "Date of issue"
  const dateMatch = text.match(/Date of issue\s+(\w+ \d{1,2}, \d{4})/i);
  let date = null;
  let year = null;

  if (dateMatch) {
    const dateStr = dateMatch[1];
    const parsedDate = new Date(dateStr);
    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const day = String(parsedDate.getDate()).padStart(2, '0');
    year = parsedDate.getFullYear();
    date = `${year}-${month}-${day}`;
  }

  // Extract total amount - looking for "Amount due $X.XX USD"
  const totalMatch = text.match(/Amount due\s+\$?([\d.]+)\s*USD/i);
  const total = totalMatch ? parseFloat(totalMatch[1]) : 0;

  // Extract description - looking for service description
  let description = "שירותי Cloudflare";

  // Check for domain registration
  const domainMatch = text.match(/Registrar Registration Fee - ([^\s\n]+)/);
  if (domainMatch) {
    const domain = domainMatch[1];
    description = `רישום דומיין ${domain}`;
  }

  // Check for service period
  const periodMatch = text.match(/(\w+ \d{1,2}, \d{4})–(\w+ \d{1,2}, \d{4})/);
  if (periodMatch) {
    const startDate = new Date(periodMatch[1]);
    const endDate = new Date(periodMatch[2]);
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    const years = endYear - startYear;

    if (years > 0 && domainMatch) {
      description = `רישום דומיין ${domainMatch[1]} ל-${years} ${years === 1 ? 'שנה' : 'שנים'}`;
    }
  }

  // Merchant name
  const merchant = "Cloudflare";

  // Invoice type - always "חשבונית" for English invoices
  const invoiceType = "חשבונית";

  // Category
  const category = "תוכנה";

  // Currency - USD
  const currency = "דולר";

  // Build final filename without slashes or backslashes
  const finalName = `${date}_${invoiceType}_${merchant}_${description}_${total}_${currency}.pdf`
    .replace(/[\/\\]/g, '-');

  return {
    finalName,
    date,
    year: String(year),
    invoiceType,
    merchant,
    category,
    description,
    total,
    currency,
    invoiceNumber,
    id: id || null,
    threadId: threadId || null
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseCloudflareInvoice;
}
