/**
 * Heichal HaTarbut (Culture Hall) Invoice Parser
 * Vendor: היכל התרבות בע"מ
 * Email Pattern: heichal, התרבות, היכל
 */

function parseHeichalHatarbutInvoice(inputText, id, threadId) {
  const currency = "שח";

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function formatDate(dateStr) {
    // Handle DD/MM/YYYY format
    const parts = dateStr.split(/[./-]/);
    if (parts.length === 3) {
      let [day, month, year] = parts;
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
    // Look for "תאריך DD/MM/YYYY"
    const dateMatch = text.match(/תאריך\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (dateMatch) {
      result.date = formatDate(dateMatch[1]);
    } else {
      // Try alternative format
      const altDateMatch = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
      if (altDateMatch) result.date = formatDate(altDateMatch[1]);
    }
    result.year = result.date ? result.date.substring(0, 4) : "";

    // --- Invoice Type ---
    if (text.includes("חשבונית מס קבלה") || text.includes("חשבונית מס / קבלה")) {
      result.invoiceType = "חשבונית מס קבלה";
    } else if (text.includes("חשבונית מס")) {
      result.invoiceType = "חשבונית מס";
    } else if (text.includes("קבלה")) {
      result.invoiceType = "קבלה";
    } else {
      result.invoiceType = "מסמך";
    }

    // --- Merchant ---
    result.merchant = "היכל התרבות";

    // --- Category ---
    result.category = "עלויות אחרות";

    // --- Description ---
    // Look for item description in the invoice
    let description = "";
    
    // Try to find "שם פריט" section
    const itemMatch = text.match(/שם פריט[^\n]*\n[^\n]*\n[^\d]*\d+\s+([א-ת\s]+)\s+\d/);
    if (itemMatch) {
      description = cleanText(itemMatch[1]);
    } else {
      // Alternative: look for common items
      if (text.includes("שכר אולם")) {
        description = "שכר אולם";
      } else {
        // Try to extract event name
        const eventMatch = text.match(/(\d{2}\/\d{2}\/\d{2})\s+([א-ת\s]+)\d{2}:/);
        if (eventMatch) {
          description = cleanText(eventMatch[2]);
        } else {
          description = "שירות";
        }
      }
    }
    result.description = description;

    // --- Total ---
    // Look for "סה"כ לתשלום"
    const totalMatch = text.match(/סה["']כ לתשלום\s+([\d,\.]+)/);
    if (totalMatch) {
      result.total = Math.round(parseFloat(totalMatch[1].replace(/,/g, "")));
    } else {
      // Look for the last number with currency or decimal
      const numbers = [...text.matchAll(/([\d,]+\.\d{2})/g)];
      if (numbers.length > 0) {
        const last = numbers[numbers.length - 1][1];
        result.total = Math.round(parseFloat(last.replace(/,/g, "")));
      } else {
        result.total = 0;
      }
    }

    // --- Final Name ---
    result.finalName = `${result.date || ""}_${result.invoiceType}_${result.merchant}_${result.description}_${result.total}_${currency}.pdf`
      .replace(/[\/\:]/g, "")
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
  module.exports = parseHeichalHatarbutInvoice;
}
