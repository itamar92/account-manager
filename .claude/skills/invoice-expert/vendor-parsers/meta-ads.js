/**
 * Meta Ads Invoice Parser
 * Vendor: Meta Platforms Ireland Limited
 * Email Pattern: facebook, meta ads, meta platforms
 */

function parseMetaAdsInvoice(inputText, id, threadId) {
  const currency = "שח";

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function formatDate(dateStr) {
    // Handle "Feb 11, 2026, 6:16 AM" format
    const monthMap = {
      'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
      'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
      'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };

    const match = dateStr.match(/(\w{3})\s+(\d{1,2}),\s+(\d{4})/);
    if (match) {
      const [_, month, day, year] = match;
      return `${year}-${monthMap[month]}-${day.padStart(2, '0')}`;
    }

    // Handle DD/MM/YYYY format
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
    const dateMatch = text.match(/Invoice\/Payment Date\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
    if (dateMatch) {
      result.date = formatDate(dateMatch[1]);
    } else {
      result.date = "";
    }
    result.year = result.date ? result.date.substring(0, 4) : "";

    // --- Invoice Type ---
    result.invoiceType = "קבלה";

    // --- Merchant ---
    result.merchant = "Meta";

    // --- Category ---
    result.category = "פרסום, קידום מכירות ואחזקת אתר";

    // --- Description ---
    // Extract campaign names
    const campaignMatches = [...text.matchAll(/גריי מודיעין [^\n]+/g)];
    if (campaignMatches.length > 0) {
      const campaigns = campaignMatches.map(m => cleanText(m[0]));
      const uniqueCampaigns = [...new Set(campaigns)];
      result.description = `פרסום Meta - ${uniqueCampaigns.length} קמפיינים`;
    } else {
      result.description = "פרסום Meta Ads";
    }

    // --- Total ---
    // Extract from "₪1,680.50 ILS" or "Paid ₪1,680.50 ILS"
    const totalMatch = text.match(/Paid\s+₪([\d,\.]+)\s+ILS/);
    if (totalMatch) {
      result.total = Math.round(parseFloat(totalMatch[1].replace(/,/g, "")));
    } else {
      const altMatch = text.match(/₪([\d,\.]+)\s+ILS/);
      if (altMatch) {
        result.total = Math.round(parseFloat(altMatch[1].replace(/,/g, "")));
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
  module.exports = parseMetaAdsInvoice;
}
