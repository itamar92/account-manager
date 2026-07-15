/**
 * Kvish 6 Invoice Parser
 * Vendor: דרך ארץ חיוגים (1997) בע"מ - כביש 6
 * Email Pattern: www.kvish6.co.il
 * Tax ID: 302236799
 */

function parseKvish6Invoice(text, id, threadId) {
  // --- Extract Date (format dd/mm/yyyy like 21/01/2026) ---
  const dateMatch = text.match(/תאריך הפקת החשבונית\s+(\d{2})\/(\d{2})\/(\d{4})/);
  let date = null;
  let year = null;
  if (dateMatch) {
    const [, day, month, yyyy] = dateMatch;
    date = `${yyyy}-${month}-${day}`;
    year = `${yyyy}`;
  }

  // --- Extract total amount (סה"כ כולל מע"מ) ---
  const totalMatch = text.match(/סה["']כ כולל מע["']מ \(ש["']ח\)\s+(\d+\.\d{2})/);
  const total = totalMatch ? parseFloat(totalMatch[1]) : 0;

  // --- Extract number of trips ---
  const tripsMatch = text.match(/מספר נסיעות\s+(\d+)/);
  const numTrips = tripsMatch ? tripsMatch[1] : "0";

  // --- Extract billing period ---
  const periodMatch = text.match(/תקופת החשבונית\s+([\d\/\-]+)/);
  const period = periodMatch ? periodMatch[1] : "";

  // --- Build description ---
  const description = `תשלומים עבור ${numTrips} נסיעות`;

  // --- Build final filename (no slashes allowed) ---
  const finalName = `${date}_חשבונית מס_כביש 6_${description}_${total}_שח.pdf`;

  // Build output object
  return {
    date,
    year,
    invoiceType: "חשבונית מס",
    merchant: "כביש 6",
    category: "נסיעות",
    description,
    total,
    finalName,
    id: id || null,
    threadId: threadId || null
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseKvish6Invoice;
}
