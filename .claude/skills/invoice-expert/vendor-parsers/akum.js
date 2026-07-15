/**
 * AKUM Invoice Parser
 * Vendor: אקו"ם בע"מ (AKUM - Israeli music royalties organization)
 * Email Pattern: TBD
 */

function parseAkumInvoice(texts, id, threadId) {
  // --- Extract Date (format dd/mm/yyyy like 02/12/2025) ---
  // Look for "תאריך אסמכתא:" followed by date
  const dateMatch = texts.match(/תאריך אסמכתא:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  let date = null;
  let year = null;
  if (dateMatch) {
    const [_, day, month, yyyy] = dateMatch;
    date = `${yyyy}-${month}-${day}`;
    year = `${yyyy}`;
  }

  // --- Extract total amount (look for "סה"כ לתשלום:") ---
  const totalMatch = texts.match(/סה["']כ לתשלום:\s*₪?\s*([\d,]+(?:\.\d{2})?)/);
  let total = 0;
  if (totalMatch) {
    // Remove commas and convert to number
    total = parseFloat(totalMatch[1].replace(/,/g, ''));
  }

  // --- Extract event description ---
  // Look for the event name (e.g., "MOONLIGHT COLDPLAY" or "מחווה לקולדפליי")
  let eventName = null;
  const eventMatch = texts.match(/(\d+)\s+([A-Z\s]+\d*)\s+(\d+)\s+₪/);
  if (eventMatch) {
    eventName = eventMatch[2].trim();
  }

  // Also look for Hebrew description
  const hebrewDescMatch = texts.match(/מחווה ל(.+?)(?:\n|מקום המופע)/);
  let hebrewDesc = null;
  if (hebrewDescMatch) {
    hebrewDesc = hebrewDescMatch[1].trim();
  }

  // --- Extract venue and date ---
  const venueMatch = texts.match(/מקום המופע:\s*([^\n]+)/);
  const venue = venueMatch ? venueMatch[1].trim() : null;

  // --- Build description ---
  let description = "כרטיס";
  if (hebrewDesc) {
    description = `כרטיס מחווה ל${hebrewDesc}`;
  } else if (eventName) {
    description = `כרטיס ${eventName}`;
  }

  if (venue) {
    description += ` - ${venue.split('(')[0].trim()}`;
  }

  // --- Determine invoice type ---
  // AKUM invoices typically show "חשבונית מס" with a linked קבלה
  const invoiceType = "חשבונית מס קבלה";

  // --- Build final filename ---
  const merchant = "אקום";
  const finalName = `${date}_${invoiceType}_${merchant}_${description}_${total}_שח.pdf`;

  // Build output object
  return {
    date,
    year,
    invoiceType,
    merchant,
    category: "קבלני משנה",
    description,
    total,
    finalName,
    id: id,
    threadId: threadId
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseAkumInvoice;
}
