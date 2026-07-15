/**
 * Delek (OCR) Invoice Parser
 * Vendor: מנטה קמעונאות דרכים בעמ (Delek)
 * Email Pattern: Weezmo
 */

function parseDelekOCRInvoice(text, emailId, threadId) {
  // --- Extract Total (robust around 'סה"כ לתשלום') ---
  function extractTotalAroundLabel(text) {
    // Normalize spaces but keep line breaks
    const norm = text.replace(/[ \t]+/g, ' ').trim();

    const lines = norm.split('\n');

    // Find line index that contains the label
    const labelIndex = lines.findIndex(l => l.includes('סה"כ לתשלום'));
    if (labelIndex === -1) return '';

    // Usually the amount is on the line just above the label
    const candidateLines = [];
    if (labelIndex > 0) candidateLines.push(lines[labelIndex - 1]);
    if (labelIndex + 1 < lines.length) candidateLines.push(lines[labelIndex + 1]);

    // Regex: first number with optional , or . between decimals
    const amountRegex = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)/;

    for (const line of candidateLines) {
      const m = line.match(amountRegex);
      if (m) {
        // Normalize to dot-decimal (e.g. 2,345.67 -> 2345.67 or 263,43 -> 263.43)
        const raw = m[1];
        // If both , and . exist: assume , = thousands, . = decimal
        if (raw.includes('.') && raw.includes(',')) {
          return raw.replace(/,/g, '');
        }
        // If only comma exists: treat comma as decimal separator
        if (raw.includes(',') && !raw.includes('.')) {
          return raw.replace(',', '.');
        }
        // Only dot or plain digits
        return raw;
      }
    }

    return '';
  }

  // --- Extract Date (dd/mm/yy or dd/mm/yyyy) ---
  const dateMatch = text.match(/תאריך\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  let date = "";
  let year = "";

  if (dateMatch) {
    date = dateMatch[1];
    const parts = date.split("/");
    let yy = parts[2];

    // Normalize year (20xx)
    if (yy.length === 2) yy = "20" + yy;

    year = yy;
  }

  // --- Extract Total ---
  const total = extractTotalAroundLabel(text);

  // --- Static Values ---
  const invoiceType = "חשבונית מס קבלה";
  const merchant = "מנטה קמעונאות דרכים בעמ";
  const category = "דלק";
  const description = "תדלוק";

  // --- Build final name ---
  const finalName = `${date}_${invoiceType}_${merchant}_${description}_${total}_שח.pdf`;

  // Output format
  return {
    date,
    year,
    invoiceType,
    merchant,
    category,
    description,
    total,
    finalName,
    id: emailId,
    threadId,
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseDelekOCRInvoice;
}
