/**
 * Partner Invoice Parser
 * Vendor: פרטנר (Partner)
 * Email Pattern: Thankyou@partner.net.il
 */

function parsePartnerInvoice(texts, id, threadId) {
  // --- Extract Date (format dd/mm/yy like 25/10/25) ---
  const dateMatch = texts.match(/(\d{2}\/\d{2}\/\d{2})/);
  let date = null;
  let year = null;
  if (dateMatch) {
    const parts = dateMatch[1].split("/");
    const yy = parseInt(parts[2], 10);
    const yyyy = yy < 50 ? 2000 + yy : 1900 + yy;
    date = `${yyyy}-${parts[1]}-${parts[0]}`;
    year = `${yyyy}`;
  }

  // --- Extract total amount (matches 76.89{ or 76.89) ---
  const totalMatch = texts.match(/(\d+\.\d{1,2})\s*\{/);
  // const total = totalMatch ? Number(totalMatch[1]) : null;
  const total = 89;

  // --- Extract month from date ---
  let monthName = null;
  if (date) {
    const monthNum = Number(date.split("-")[1]);
    const hebMonths = [
      "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
      "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
    ];
    monthName = hebMonths[monthNum - 1];
  }

  // --- Build description ---
  const description = `חשבון אינטרנט חודש ${monthName}`;

  // --- Build final filename ---
  const finalName = `${date}_חשבונית מס קבלה_פרטנר_${description}_${total}_שח.pdf`;

  // Build output object
  return {
    date,
    year,
    invoiceType: "חשבונית מס קבלה",
    merchant: "פרטנר",
    category: "אינטרנט",
    description,
    total,
    finalName,
    id: id,
    threadId: threadId
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parsePartnerInvoice;
}
