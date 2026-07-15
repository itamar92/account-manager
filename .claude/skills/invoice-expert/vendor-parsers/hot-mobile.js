/**
 * Hot Mobile Invoice Parser
 * Vendor: הוט מובייל בעמ (Hot Mobile)
 * Email Pattern: HOTmobile@printernet.co.il
 */

function parseHotMobileInvoice(text, emailId, threadId) {
  // --- Extract issue date (from תאריך הפקת החשבוןNN/NN/NNNN) ---
  let dateMatch = text.match(/תאריך הפקת החשבון\s*(\d{2}\/\d{2}\/\d{4})/);
  let date = null, year = null;
  if (dateMatch) {
    const parts = dateMatch[1].split("/");
    date = `${parts[2]}-${parts[1]}-${parts[0]}`;
    year = parts[2];
  }

  // --- Extract billing period end date (for month) ---
  let periodMatch = text.match(/תקופת החשבון.*?עד(\d{2}\/\d{2}\/\d{4})/);
  let monthName = null;
  if (periodMatch) {
    const endDate = periodMatch[1].split("/");
    const monthNum = Number(endDate[1]);
    const hebMonths = [
      "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
      "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
    ];
    monthName = hebMonths[monthNum - 2];
  }

  // --- Extract total amount (סה"כ בחשבונית זו לתשלום כולל מע"מNN.NN) ---
  let totalMatch = text.match(/סה"?כ בחשבונית זו לתשלום כולל מע"?מ\s*([\d\.]+)/);
  let total = null;
  if (totalMatch) {
    total = Number(totalMatch[1]);
  }

  // --- Build description ---
  const description = `חשבון טלפון חודש ${monthName}`;

  // --- Build final filename ---
  const finalName = `${date}_חשבונית מס_הוט מובייל בעמ_${description}_${total}_שח.pdf`;

  // Build output object
  return {
    date,
    year,
    invoiceType: "חשבונית מס",
    merchant: "הוט מובייל בעמ",
    category: "סלולרי",
    description,
    total,
    finalName,
    id: emailId,
    threadId: threadId
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseHotMobileInvoice;
}
