/**
 * IEC (Israel Electric Corporation) Invoice Parser
 * Vendor: חברת החשמל לישראל בעמ
 * Email Pattern: noreplys@iec.co.il
 */

function parseIECInvoice(rawText, emailId, threadId) {
  // Normalize text - handle array inputs
  let text = rawText;
  if (Array.isArray(text)) {
    text = text.join('\n\n');
  } else if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        text = parsed.join('\n\n');
      }
    } catch (e) {
      // Already a plain string
    }
  }
  text = text || "";

  // --- Extract issue date ---
  // Format 1: "תאריך עריכת החשבון DD/MM/YYYY" (regular monthly bill)
  let dateMatch = text.match(/תאריך עריכת החשבון\s*(\d{2}\/\d{2}\/\d{4})/);
  let date = null, year = null;
  if (dateMatch) {
    const parts = dateMatch[1].split("/");
    date = `${parts[2]}-${parts[1]}-${parts[0]}`;
    year = parts[2];
  }
  // Format 2: standalone DD.MM.YYYY (online-payment receipt format)
  if (!date) {
    const dotMatch = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dotMatch) {
      date = `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
      year = dotMatch[3];
    }
  }

  // --- Extract period (handling the actual IEC format) ---
  // Pattern: "ימים 25 חשבון לתקופה -\n18/11/2025 25/10/2025 עד -מ"
  let periodMatch = text.match(/ימים\s*(\d+)\s*חשבון לתקופה[\s\-\n]+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+עד\s*-?מ/);

  // Fallback: try date range pattern
  if (!periodMatch) {
    const rangeMatch = text.match(/(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*(\d{2}\/\d{2}\/\d{4})/);
    if (rangeMatch) {
      const d1Parts = rangeMatch[1].split("/").map(Number);
      const d2Parts = rangeMatch[2].split("/").map(Number);
      const days = Math.abs((d2Parts[0] - d1Parts[0]) + (d2Parts[1] - d1Parts[1]) * 30);
      periodMatch = [null, days, rangeMatch[2], rangeMatch[1]];
    }
  }

  let descMonth = null;
  const hebMonths = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
  ];

  if (periodMatch) {
    const numDays = Number(periodMatch[1]);
    const endDate = periodMatch[2];    // 18/11/2025
    const startDate = periodMatch[3];  // 25/10/2025

    const startParts = startDate.split("/");
    const endParts = endDate.split("/");
    const startMonthNum = Number(startParts[1]);
    const endMonthNum = Number(endParts[1]);

    if (numDays < 30) {
      descMonth = `חודש ${hebMonths[endMonthNum - 1]}`;
    } else {
      descMonth = `חודשים ${hebMonths[startMonthNum - 1]}-${hebMonths[endMonthNum - 1]}`;
    }
  } else {
    descMonth = "";
  }

  // --- Extract total amount ---
  let totalMatch = text.match(/סה"?כ כולל מע"?מ לתקופת חשבון\s*([\d,\.]+)/);
  if (!totalMatch) {
    totalMatch = text.match(/הסכום לתשלום בש"?ח\s*([\d,\.]+)/);
  }
  if (!totalMatch) {
    totalMatch = text.match(/סכום לתשלום\s*([\d,\.]+)/);
  }
  // Format 2: amount before label (RTL extraction — "809.47 סה"כ לתשלום")
  if (!totalMatch) {
    totalMatch = text.match(/(\d+(?:[,\.]\d+)?)\s*סה"?כ לתשלום/);
  }
  let total = null;
  if (totalMatch) {
    total = Number(totalMatch[1].replace(/,/g, ''));
  }

  // --- Build description ---
  const description = descMonth ? `חשבון חשמל ${descMonth}` : "חשבון חשמל";

  // --- Build final filename ---
  const invoiceType = "חשבונית מס קבלה";
  const merchant = "חברת החשמל לישראל בעמ";
  const finalName = `${date}_${invoiceType}_${merchant}_${description}_${total}_שח.pdf`;

  return {
    date,
    year,
    invoiceType,
    merchant,
    category: "חשמל ומים",
    description,
    total,
    finalName,
    id: emailId,
    threadId: threadId
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseIECInvoice;
}
