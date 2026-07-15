/**
 * Carrefour Global Duty Free Invoice Parser
 * Vendor: גלובל דיוטי פרי (Carrefour)
 * Email Pattern: carrefour, global duty free
 */

function parseCarrefourGlobalInvoice(inputText, id, threadId) {
  const currency = "שח";

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function formatDate(dateStr) {
    // Handle DD/MM/YYYY format
    const parts = dateStr.split(/[./-]/);
    if (parts.length === 3) {
      const day = parts[0].padStart(2, "0");
      const month = parts[1].padStart(2, "0");
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }
    return "";
  }

  function extractData(text) {
    const result = {};

    // --- Date ---
    const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch) {
      result.date = formatDate(dateMatch[1]);
    } else {
      result.date = "";
    }
    result.year = result.date ? result.date.substring(0, 4) : "";

    // --- Invoice Type ---
    // This appears to be a receipt (קבלה) from Carrefour
    result.invoiceType = "קבלה";

    // --- Merchant ---
    result.merchant = "קרפור - גלובל דיוטי פרי";

    // --- Category ---
    result.category = "כיבודים";

    // --- Description ---
    // Extract item if visible, otherwise generic description
    const itemMatch = text.match(/יסודברט מזונעי/);
    if (itemMatch) {
      result.description = "קניה - מוצרי מזון";
    } else {
      result.description = "קניה - סופרמרקט";
    }

    // --- Total ---
    const totalMatch = text.match(/סה["']כ לתשלום[:\s]*([\d,\.]+)/i) ||
                       text.match(/סה["']כ כולל מע["']מ[:\s]*([\d,\.]+)/i) ||
                       text.match(/חיוב כולל מע["']מ[:\s]*([\d,\.]+)/i);

    if (totalMatch) {
      result.total = Math.round(parseFloat(totalMatch[1].replace(/,/g, "")));
    } else {
      // Try to find last number before end
      const numbers = [...text.matchAll(/([\d]+\.[\d]{2})/g)];
      if (numbers.length > 0) {
        const last = numbers[numbers.length - 1][1];
        result.total = Math.round(parseFloat(last));
      } else {
        result.total = 0;
      }
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
  module.exports = parseCarrefourGlobalInvoice;
}
