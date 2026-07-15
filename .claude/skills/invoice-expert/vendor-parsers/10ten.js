/**
 * 10ten Invoice Parser
 * Vendor: טן חברה לדלק בעמ (10ten)
 * Email Pattern: no-reply@10ten.co.il
 */

function parse10tenInvoice(items, id, threadId) {
  // ----------------- UNIVERSAL TEXT EXTRACTOR -----------------
  function extractText(obj) {
    if (!obj) return "";

    // If the object itself is a string → return it
    if (typeof obj === "string") return obj;

    // If array → join recursive text extraction
    if (Array.isArray(obj)) {
      return obj.map(extractText).join("\n");
    }

    // If object → try to find text fields
    if (typeof obj === "object") {
      const textLikeKeys = ["text", "rawText", "content", "data", "body"];
      for (const key of textLikeKeys) {
        if (obj[key]) return extractText(obj[key]);
      }

      // As fallback → concatenate all string fields inside this object
      return Object.values(obj)
        .map(v => extractText(v))
        .join("\n");
    }

    return "";
  }

  function extractTotal(text) {
    // Matches numbers like: 123.45 , 1,234.56 , 50.00 , 7.9
    const amountRegex = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g;
    const matches = text.match(amountRegex);

    if (!matches) return "";

    // Convert each match to float (remove commas)
    const amounts = matches.map(n => parseFloat(n.replace(/,/g, "")));

    // Filter out unrealistic values (e.g. > 1,000,000 or < 1 NIS)
    const plausible = amounts.filter(n => n > 1 && n < 10000);

    if (plausible.length === 0) return "";

    // Most invoices have the TOTAL as the highest number
    const total = Math.max(...plausible);

    return total.toFixed(2);
  }

  // Extract ALL text from the incoming item
  const fullText = extractText(items);

  // Fail only if completely empty
  if (!fullText.trim()) {
    throw new Error("❌ Could not extract any text from input");
  }

  // ----------------- HELPERS -----------------
  function cleanNum(str) {
    return str.replace(/[^\d.]/g, "");
  }

  function getHebMonthName(mm) {
    const map = {
      "01": "ינואר", "02": "פברואר", "03": "מרץ", "04": "אפריל",
      "05": "מאי", "06": "יוני", "07": "יולי", "08": "אוגוסט",
      "09": "ספטמבר", "10": "אוקטובר", "11": "נובמבר", "12": "דצמבר"
    };
    return map[mm] || mm;
  }

  // ----------------- DATE -----------------
  const dateMatch = fullText.match(/(\d{2}\/\d{2}\/\d{4})/);
  let isoDate = "", year = "", month = "", day = "";

  if (dateMatch) {
    const [dd, mm, yyyy] = dateMatch[1].split("/");
    day = dd; month = mm; year = yyyy;
    isoDate = `${year}-${mm}-${dd}`;
  }

  // ----------------- MERCHANT -----------------
  const merchant = "טן חברה לדלק בעמ";

  // ----------------- INVOICE TYPE -----------------
  let invoiceType = "";
  const invMatch = fullText.match(/חשבונית מס(?:\/?קבלה)?/);
  invoiceType = invMatch ? invMatch[0] : "חשבונית מס קבלה";

  // ----------------- TOTAL -----------------
  let total = extractTotal(fullText);

  // ----------------- DESCRIPTION -----------------
  const description = `דלק חודש ${getHebMonthName(month)}`;

  // ----------------- FINAL NAME -----------------
  const finalName = `${isoDate}_${invoiceType}_${merchant}_${description}_${total}_שח.pdf`;

  // ----------------- RETURN -----------------
  return {
    date: isoDate,
    year,
    invoiceType,
    merchant,
    category: "דלק",
    description,
    total,
    finalName,
    id: id,
    threadId: threadId
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parse10tenInvoice;
}
