/**
 * Arnona Hod HaSharon Invoice Parser
 * Vendor: עיריית הוד השרון (Hod HaSharon Municipality)
 * Email Pattern: no_replay@orda.co.il
 */

class SimpleInvoiceExtractor {
  extract(text, threadId = null) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    const date = this.extractDate(lines);
    const total = this.extractTotal(lines);
    const months = this.extractMonths(lines);
    const invoiceType = 'קבלה';
    const merchant = 'עיריית הוד השרון';
    const description = `ארנונה לחודשים ${months}`;

    return {
      date: date,
      year: this.extractYear(lines),
      invoiceType: invoiceType,
      merchant: merchant,
      category: 'ארנונה',
      description: description,
      total: total,
      finalName: this.buildFileName(date, invoiceType, merchant, description, total),
      id: threadId,
      threadId: threadId || this.extractThreadId(text)
    };
  }

  buildFileName(date, invoiceType, merchant, description, total) {
    return `${date}_${invoiceType}_${merchant}_${description}_${total}_שח.pdf`;
  }

  extractMonths(lines) {
    const text = lines.join(' ');
    const match = text.match(/חוד['\s]*(\d+[-\s]\d+)/);
    if (match) {
      return match[1].replace(/\s/g, '-');
    }
    return '';
  }

  extractDate(lines) {
    for (const line of lines) {
      const match = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (match) {
        const [_, day, month, year] = match;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }
    return null;
  }

  extractYear(lines) {
    const date = this.extractDate(lines);
    return date ? date.substring(0, 4) : null;
  }

  extractTotal(lines) {
    for (const line of lines) {
      if (line.includes('לתשלום בש״ח') || line.includes('סה״כ')) {
        const match = line.match(/(\d+[\.,]\d{1,2})/);
        if (match) {
          return parseFloat(match[1].replace(',', '.'));
        }
      }
    }
    return null;
  }

  extractId(lines) {
    for (const line of lines) {
      const match = line.match(/(\d{9})/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  extractThreadId(text) {
    return text;
  }
}

function parseArnonaInvoice(emailText, id, threadId) {
  const extractor = new SimpleInvoiceExtractor();

  // Convert to string if it's not already
  if (typeof emailText !== 'string') {
    emailText = JSON.stringify(emailText);
  }

  return extractor.extract(emailText, threadId);
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseArnonaInvoice;
}
