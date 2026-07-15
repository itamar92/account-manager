/**
 * Morning Invoice Parser
 * Vendor: Morning (notify@morning.co)
 * Email Pattern: notify@morning.co
 */

function parseMorningInvoice(inputText, id, threadId) {
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
    const lines = text.split(/\n+/).map(cleanText).filter(Boolean);

    // --- Date ---
    const dateMatch = text.match(/\b(\d{1,2}[./-]\d{1,2}[./-]20\d{2})\b/);
    if (dateMatch) result.date = formatDate(dateMatch[1]);
    result.year = result.date ? result.date.substring(0, 4) : "";

    // --- Invoice Type ---
    if (text.includes("חשבונית מס / קבלה")) result.invoiceType = "חשבונית מס קבלה";
    else if (text.includes("חשבונית מס")) result.invoiceType = "חשבונית מס";
    else if (text.includes("קבלה")) result.invoiceType = "קבלה";
    else result.invoiceType = "מסמך";

    // --- Merchant ---
    const merchantMatch = text.match(/\n([א-ת\s\-]{2,30})\n(?:עוסק|ח\.פ|ע\.מ)/);
    if (merchantMatch) {
      result.merchant = cleanText(merchantMatch[1]);
    } else {
      const nameMatch = text.match(/([א-ת]+[\s\-][א-ת\s\-]+)(?=\nעוסק)/);
      result.merchant = nameMatch ? cleanText(nameMatch[1]) : "לא ידוע";
    }

    // --- Category ---
    const categoryMatch = text.match(/([\u0590-\u05FF]{2,})\s*\n[א-ת\s]+ \d+, [א-ת\s]+ \d{5,7}/);
    result.category = categoryMatch ? cleanText(categoryMatch[1]) : "";

    // --- Description ---
    let description = "";
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("₪") && lines[i + 1] && !lines[i + 1].includes("סה\"כ") && !lines[i + 1].includes("מע\"מ")) {
        description = lines[i + 1];
        break;
      }
    }
    result.description = cleanText(description || "");

    // --- Total ---
    const totalMatch = text.match(/סה["']כ לתשלום[^₪]*₪([\d,.,]+)/);
    if (totalMatch) {
      result.total = Math.round(parseFloat(totalMatch[1].replace(/,/g, "")));
    } else {
      const numbers = [...text.matchAll(/₪([\d,\.]+)/g)];
      if (numbers.length > 0) {
        const last = numbers[numbers.length - 1][1];
        result.total = Math.round(parseFloat(last.replace(/,/g, "")));
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
  module.exports = parseMorningInvoice;
}
