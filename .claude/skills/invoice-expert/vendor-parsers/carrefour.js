/**
 * Carrefour Invoice Parser
 * Vendor: Carrefour (קרפור)
 * Email Pattern: carrefour
 */

function parseCarrefourInvoice(inputText, id, threadId) {
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
    // Look for date pattern like "11/12/2025 09:27"
    const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch) {
      result.date = formatDate(dateMatch[1]);
    } else {
      result.date = "";
    }
    result.year = result.date ? result.date.substring(0, 4) : "";

    // --- Invoice Type ---
    // Carrefour receipts are typically "קבלה"
    result.invoiceType = "קבלה";

    // --- Merchant ---
    result.merchant = "קרפור";

    // --- Category ---
    result.category = "כיבודים";

    // --- Description ---
    result.description = "קניות";

    // --- Total ---
    // Look for "סה\"כ כולל מע\"מ" followed by amount
    const totalMatch = text.match(/סה["']כ\s+כולל\s+מע["']מ.*?(\d+\.?\d*)/);
    if (totalMatch) {
      result.total = parseFloat(totalMatch[1]);
    } else {
      // Fallback: look for last amount with ₪ or שח
      const amountMatches = [...text.matchAll(/(\d+\.?\d*)\s*[₪שח]/g)];
      if (amountMatches.length > 0) {
        const lastMatch = amountMatches[amountMatches.length - 1];
        result.total = parseFloat(lastMatch[1]);
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
  module.exports = parseCarrefourInvoice;
}
