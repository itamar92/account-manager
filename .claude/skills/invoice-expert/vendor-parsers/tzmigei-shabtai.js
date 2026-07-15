/**
 * Tzmigei Shabtai Barak V'Or Invoice Parser
 * Vendor: צמיגי שבתאי ברק ואור
 * Tax ID: 558044475
 */

function parseTzmigeiShabtaiInvoice(inputText, id, threadId) {
  const currency = "שח";

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function formatDate(dateStr) {
    // Handle format like "6.1.26" or "06.01.2026"
    const parts = dateStr.split(/[./-]/);
    if (parts.length === 3) {
      let [day, month, year] = parts.map(p => p.trim());

      // Pad day and month
      day = day.padStart(2, "0");
      month = month.padStart(2, "0");

      // Handle 2-digit year
      if (year.length === 2) {
        year = "20" + year;
      }

      return `${year}-${month}-${day}`;
    }
    return "";
  }

  function extractData(text) {
    const result = {};

    // --- Date ---
    const dateMatch = text.match(/תאריך[:\s]*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/);
    if (dateMatch) {
      result.date = formatDate(dateMatch[1]);
    } else {
      // Try to find date in format 6.1.26
      const altDateMatch = text.match(/(\d{1,2}\.\d{1,2}\.\d{2,4})/);
      if (altDateMatch) {
        result.date = formatDate(altDateMatch[1]);
      }
    }
    result.year = result.date ? result.date.substring(0, 4) : "";

    // --- Invoice Type ---
    if (text.includes("חשבונית מס/קבלה מס") || text.includes("חשבונית מס קבלה")) {
      result.invoiceType = "חשבונית מס קבלה";
    } else if (text.includes("חשבונית מס")) {
      result.invoiceType = "חשבונית מס";
    } else if (text.includes("קבלה")) {
      result.invoiceType = "קבלה";
    } else {
      result.invoiceType = "חשבונית מס קבלה";
    }

    // --- Merchant ---
    result.merchant = "צמיגי שבתאי ברק ואור";

    // --- Category ---
    result.category = "רכב - אחזקה תיקונים וחניה";

    // --- Description ---
    // Look for service description
    let description = "";
    if (text.includes("איזון גלגל")) {
      description = "איזון גלגל";
    }
    if (text.includes("פירוק והרכבה")) {
      description = description ? description + " פירוק והרכבה" : "פירוק והרכבה";
    }
    if (text.includes("מיזוג")) {
      description = description ? description + " מיזוג" : "מיזוג";
    }

    result.description = cleanText(description || "תיקון צמיגים");

    // --- Total ---
    // Look for total at bottom (לתשלום)
    const totalMatch = text.match(/לתשלום[:\s]*(\d+)/);
    if (totalMatch) {
      result.total = parseInt(totalMatch[1], 10);
    } else {
      // Try to find standalone number
      const altTotalMatch = text.match(/(\d{3,})/);
      if (altTotalMatch) {
        result.total = parseInt(altTotalMatch[1], 10);
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
  module.exports = parseTzmigeiShabtaiInvoice;
}
