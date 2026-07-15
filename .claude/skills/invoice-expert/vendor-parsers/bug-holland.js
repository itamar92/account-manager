/**
 * Bug Holland Center Invoice Parser
 * Vendor: באג הולנדיטסנטר
 * Pattern: bug.co.il
 */

function parseBugHollandInvoice(text, id, threadId) {
  // Extract date - format: DD/MM/YYYY
  const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
  const year = date ? date.split('-')[0] : null;

  // Merchant
  const merchant = 'באג הולנדיטסנטר';

  // Extract product description - look for item details
  let description = '';
  const productMatch = text.match(/תנור חימום[^\n]*/);
  if (productMatch) {
    description = productMatch[0].trim();
  } else {
    // Fallback - look for any item description
    const itemMatch = text.match(/[א-ת\s]+(?:LG|[A-Z]{2,})/);
    if (itemMatch) {
      description = itemMatch[0].trim();
    } else {
      description = 'רכישה';
    }
  }

  // Extract total - look for the final amount
  const totalMatch = text.match(/סה"כ\s+(\d+\.?\d*)/);
  const total = totalMatch ? parseFloat(totalMatch[1]) : 0;

  // Invoice type
  const invoiceType = 'חשבונית מס קבלה';

  // Category
  const category = 'כלי עבודה, ציוד ואחזקה';

  // Build final filename - no slashes or backslashes
  const cleanDescription = description.replace(/[\/\\]/g, '-');
  const finalName = `${date}_${invoiceType}_${merchant}_${cleanDescription}_${total}_שח.pdf`;

  return {
    finalName,
    date,
    year,
    invoiceType,
    merchant,
    category,
    description: cleanDescription,
    total,
    id: id || null,
    threadId: threadId || null
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseBugHollandInvoice;
}
