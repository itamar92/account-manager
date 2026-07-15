/**
 * ENI Mobile Invoice Parser
 * Vendor: אני מובייל בעמ
 * Email Pattern: Weezmo
 */

function parseEniMobileInvoice(text, emailId, threadId) {
  // --- Extract Date (dd/mm/yy format) ---
  const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{2})/);
  let date = "";
  let year = "";

  if (dateMatch) {
    const [_, day, month, yy] = dateMatch;
    // Normalize year to 20xx
    const fullYear = "20" + yy;
    year = fullYear;
    date = `${fullYear}-${month}-${day}`;
  }

  // --- Extract Total (look for amount patterns) ---
  // The total appears multiple times, look for "סה"כ לתשלום" or similar patterns
  let total = "0";
  const totalMatch = text.match(/(\d+[.,]\d{2})\s*ש"ח/);
  if (totalMatch) {
    total = totalMatch[1].replace(',', '.');
  }

  // --- Static Values ---
  const invoiceType = "חשבונית מס קבלה";
  const merchant = "אני מובייל בעמ";
  const category = "רכב - דלק";
  const description = "תדלוק";

  // --- Build final name (without / or \) ---
  const finalName = `${date}_${invoiceType}_${merchant}_${description}_${total}_שח.pdf`;

  // Output format
  return {
    date,
    year,
    invoiceType,
    merchant,
    category,
    description,
    total: parseFloat(total),
    finalName,
    id: emailId || null,
    threadId: threadId || null,
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseEniMobileInvoice;
}
