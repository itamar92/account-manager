/**
 * Ginzburg Music Invoice Parser
 * Vendor: גינזבורג מוסיקה בע"מ (GINZBURG MUSICLTD.)
 * Email Pattern: ginzburg
 */

function parseGinzburgMusicInvoice(inputText, id, threadId) {
  const currency = "שח";

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function formatDate(dateStr) {
    // Handle DD/MM/YYYY or similar formats
    const parts = dateStr.split(/[./-]/);
    if (parts.length === 3) {
      const day = parts[0].padStart(2, "0");
      const month = parts[1].padStart(2, "0");
      const year = parts[2].length === 2 ? "20" + parts[2] : parts[2];
      return `${year}-${month}-${day}`;
    }
    return "";
  }

  function extractData(text) {
    const result = {};

    // --- Date --- Extract from handwritten date or any date pattern
    const dateMatch = text.match(/(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/);
    if (dateMatch) {
      const [_, day, month, year] = dateMatch;
      const fullYear = year.length === 2 ? "20" + year : year;
      result.date = `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    } else {
      result.date = "";
    }
    result.year = result.date ? result.date.substring(0, 4) : "";

    // --- Invoice Type ---
    if (text.includes("קבלה") && text.includes("חשבונית")) {
      result.invoiceType = "קבלה חשבונית מס";
    } else if (text.includes("קבלה")) {
      result.invoiceType = "קבלה";
    } else if (text.includes("חשבונית")) {
      result.invoiceType = "חשבונית מס";
    } else {
      result.invoiceType = "מסמך";
    }

    // --- Merchant ---
    result.merchant = "גינזבורג מוסיקה";

    // --- Category ---
    result.category = "כלי עבודה, ציוד ואחזקה";

    // --- Description --- Extract from "פרטים" section
    let description = "";
    const detailsMatch = text.match(/פרטים\s*([^\n]+)/);
    if (detailsMatch) {
      description = cleanText(detailsMatch[1]);
    }
    result.description = description || "רכישת ציוד";

    // --- Total --- Extract from "סה\"כ כולל מע\"מ" or last amount
    const totalMatch = text.match(/סה["']כ\s*כולל\s*מע["']מ\s*(\d+)/);
    if (totalMatch) {
      result.total = parseInt(totalMatch[1], 10);
    } else {
      // Try to find any circled or emphasized number
      const amountMatch = text.match(/(\d{3,5})\s*$/m);
      if (amountMatch) {
        result.total = parseInt(amountMatch[1], 10);
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
  module.exports = parseGinzburgMusicInvoice;
}
