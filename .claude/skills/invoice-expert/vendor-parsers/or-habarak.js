/**
 * Or Habarak Auto Service Invoice Parser
 * Vendor: מוסך אור הברק
 * Email Pattern: orhabarak106@gmail.com
 * Category: רכב - אחזקה תיקונים וחניה
 */

function parseOrHabarakInvoice(text, id, threadId) {
  // Extract date - format: DD/MM/YY
  let date = null;
  const dateMatch = text.match(/תאריך:\s*(\d{2})\/(\d{2})\/(\d{2})/);
  if (dateMatch) {
    const day = dateMatch[1];
    const month = dateMatch[2];
    const year = '20' + dateMatch[3]; // Convert YY to YYYY
    date = `${year}-${month}-${day}`;
  }

  // Extract invoice number
  const invoiceMatch = text.match(/חשבונית מס קבלת מס מספר\s*[:\s]*(\d+)/);
  const invoiceNumber = invoiceMatch ? invoiceMatch[1] : null;

  // Extract vehicle number
  const vehicleMatch = text.match(/רכב\s*[:\s]*(\d{2,3}-\d{2}-\d{2,3})/);
  const vehicleNumber = vehicleMatch ? vehicleMatch[1] : null;

  // Extract description (service performed)
  let description = '';
  const descMatch = text.match(/X\s*([^\n]+)/);
  if (descMatch) {
    description = descMatch[1].trim();
  }

  // If no description found, try to extract from the work section
  if (!description) {
    description = 'שירותי מוסך';
  }

  // Add vehicle number to description if available
  if (vehicleNumber) {
    description = `${description} - רכב ${vehicleNumber}`;
  }

  // Extract total amount
  let total = 0;
  const totalMatch = text.match(/ס[\"']ה\s*כ?\s*לתשלום\s*[:\s]*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (totalMatch) {
    total = parseFloat(totalMatch[1].replace(/,/g, ''));
  }

  // Determine invoice type
  let invoiceType = 'חשבונית מס קבלה';
  if (text.includes('חשבונית מס קבלת מס')) {
    invoiceType = 'חשבונית מס קבלה';
  } else if (text.includes('חשבונית מס')) {
    invoiceType = 'חשבונית מס';
  } else if (text.includes('קבלה')) {
    invoiceType = 'קבלה';
  }

  const merchant = 'מוסך אור הברק';
  const category = 'רכב - אחזקה תיקונים וחניה';
  const year = date ? date.split('-')[0] : null;

  // Build final filename
  const finalName = `${date}_${invoiceType}_${merchant}_${description}_${total}_שח.pdf`;

  return {
    finalName: finalName,
    date: date,
    year: year,
    invoiceType: invoiceType,
    merchant: merchant,
    category: category,
    description: description,
    total: total,
    id: id,
    threadId: threadId
  };
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseOrHabarakInvoice;
}
