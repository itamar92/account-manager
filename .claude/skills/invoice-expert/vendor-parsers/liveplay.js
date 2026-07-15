/**
 * LivePlay Invoice Parser
 * Vendor: לייב פליי בע"מ (LivePlay Ltd.)
 * Email Pattern: liveplay.co.il
 */

function parseLivePlayInvoice(inputText, id, threadId) {
  const currency = "₪";

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function formatDate(dateStr) {
    const parts = dateStr.split(/[./-]/);
    if (parts.length === 3) {
      const [day, month, year] = parts.map(p => p.padStart(2, "0"));
      return `${year}-${month}-${day}`;
    }
    return "";
  }

  function extractData(text) {
    const result = {};

    // --- Date ---
    const dateMatch = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    if (dateMatch) {
      result.date = formatDate(dateMatch[1]);
    }
    result.year = result.date ? result.date.substring(0, 4) : "";

    // --- Invoice Type ---
    if (text.includes("חשבונית מס / קבלה")) {
      result.invoiceType = "חשבונית מס קבלה";
    } else if (text.includes("חשבונית מס")) {
      result.invoiceType = "חשבונית מס";
    } else if (text.includes("קבלה")) {
      result.invoiceType = "קבלה";
    } else {
      result.invoiceType = "מסמך";
    }

    // --- Merchant ---
    result.merchant = "לייב פליי";

    // --- Category ---
    result.category = "עבודות חוץ וקבלני משנה";

    // --- Description ---
    // Extract the main items from the invoice
    const itemMatches = text.matchAll(/(\d+)\s+צמידי\s+לד\s+לאירוע\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/g);
    const items = [];
    for (const match of itemMatches) {
      items.push(`${match[1]} צמידי לד לאירוע ${match[2]}`);
    }
    result.description = items.length > 0 ? items.join(", ") : "צמידי לד לאירועים";

    // --- Total ---
    const totalMatch = text.match(/סה["']כ:\s*([0-9,]+(?:\.\d{2})?)\s*₪/);
    if (totalMatch) {
      result.total = Math.round(parseFloat(totalMatch[1].replace(/,/g, "")));
    } else {
      result.total = 0;
    }

    // --- Final Name ---
    result.finalName = `${result.date || ""}_${result.invoiceType}_${result.merchant}_${result.description}_${result.total}_${currency}.pdf`
      .replace(/[\/\\:]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    result.id = id;
    result.threadId = threadId;

    return result;
  }

  return extractData(inputText);
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseLivePlayInvoice;
}
