# Vendor-Specific Invoice Parsers

This directory contains JavaScript parsers for extracting structured data from invoices from specific vendors/merchants in Israel.

## Overview

Instead of using a generic AI-based parser for all invoices, this system maintains **vendor-specific parsers** that ensure:
- **Consistency** - Same vendor always parsed the same way
- **Accuracy** - Parsers are tuned to each vendor's specific format
- **Speed** - No need for AI inference for known vendors
- **Expandability** - New vendors can be added easily

## How It Works

### 1. Invoice Arrives
When Claude Code receives an invoice to parse:

```
User: "Parse this invoice from פרטנר..."
```

### 2. Vendor Identification
Claude reads `vendor-mapping.json` and identifies the vendor:
- By email pattern (e.g., `Thankyou@partner.net.il`)
- By merchant name in the invoice text
- By other identifying features

### 3. Parser Selection
Two paths:

**Path A: Known Vendor**
1. Finds matching parser in `vendor-mapping.json`
2. Reads the corresponding `.js` file
3. Executes the parser function
4. Returns structured JSON

**Path B: Unknown Vendor**
1. Claude creates a new parser file
2. Updates `vendor-mapping.json`
3. Executes the new parser
4. Returns structured JSON
5. **Future invoices from this vendor will use the same parser**

## File Structure

```
vendor-parsers/
├── README.md                  # This file
├── vendor-mapping.json        # Maps vendors to parser files
├── morning.js                 # Morning invoices
├── arnona-hod-hasharon.js     # Hod HaSharon municipality
├── partner.js                 # Partner communications
├── hot-mobile.js              # Hot Mobile
├── iec-hashmal.js             # Israel Electric Corporation
├── delek-ocr.js               # Delek fuel (OCR)
└── 10ten.js                   # 10ten fuel
```

## vendor-mapping.json Format

```json
{
  "vendors": [
    {
      "name": "partner",              // Unique ID (kebab-case)
      "displayName": "פרטנר",         // Display name (Hebrew)
      "emailPatterns": [              // Email patterns to match
        "Thankyou@partner.net.il"
      ],
      "parserFile": "partner.js",     // Parser filename
      "category": "דואר ותקשורת"      // Tax category
    }
  ]
}
```

## Parser File Template

Each parser file follows this structure:

```javascript
/**
 * [Vendor Name] Invoice Parser
 * Vendor: [Hebrew Name]
 * Email Pattern: [email@example.com]
 */

function parse[VendorName]Invoice(text, id, threadId) {
  // 1. Extract date
  const dateMatch = text.match(/תאריך\s*(\d{2}\/\d{2}\/\d{4})/);
  let date = null;
  if (dateMatch) {
    const [dd, mm, yyyy] = dateMatch[1].split("/");
    date = `${yyyy}-${mm}-${dd}`;
  }

  // 2. Extract total
  const totalMatch = text.match(/סה["']כ\s*([\d,\.]+)/);
  const total = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : 0;

  // 3. Extract other fields...

  // 4. Return structured object
  return {
    date,
    year: date ? date.substring(0, 4) : null,
    invoiceType: "חשבונית מס קבלה",
    merchant: "[Vendor Name]",
    category: "[Category]",
    description: "[Description]",
    total,
    finalName: `${date}_חשבונית מס קבלה_[Vendor]_[Desc]_${total}_שח.pdf`,
    id,
    threadId
  };
}

// Export for Node.js or n8n
if (typeof module !== 'undefined' && module.exports) {
  module.exports = parse[VendorName]Invoice;
}
```

## Adding a New Vendor

### Step 1: Create Parser File

Create a new file `vendor-parsers/new-vendor.js`:

```javascript
/**
 * New Vendor Invoice Parser
 * Vendor: ספק חדש
 * Email Pattern: invoices@newvendor.co.il
 */

function parseNewVendorInvoice(text, id, threadId) {
  // Implement parsing logic based on vendor's invoice format

  return {
    date: "2024-12-23",
    year: "2024",
    invoiceType: "חשבונית מס קבלה",
    merchant: "ספק חדש",
    category: "קטגוריה מתאימה",
    description: "תיאור השירות",
    total: 100,
    finalName: "2024-12-23_חשבונית מס קבלה_ספק חדש_תיאור_100_שח.pdf",
    id,
    threadId
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = parseNewVendorInvoice;
}
```

### Step 2: Update vendor-mapping.json

Add entry to the `vendors` array:

```json
{
  "name": "new-vendor",
  "displayName": "ספק חדש",
  "emailPatterns": ["invoices@newvendor.co.il"],
  "parserFile": "new-vendor.js",
  "category": "קטגוריה מתאימה"
}
```

### Step 3: Test

```bash
claude -m "Parse this invoice from ספק חדש:
תאריך: 23/12/2024
סה\"כ: 100 ₪"
```

Claude will:
1. Identify "ספק חדש" as the vendor
2. Load `new-vendor.js`
3. Execute the parser
4. Return structured JSON

## Common Parsing Patterns

### Date Extraction

```javascript
// Pattern 1: DD/MM/YYYY
const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
if (dateMatch) {
  const [dd, mm, yyyy] = dateMatch[1].split("/");
  date = `${yyyy}-${mm}-${dd}`;
}

// Pattern 2: DD/MM/YY
const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{2})/);
if (dateMatch) {
  const [dd, mm, yy] = dateMatch[1].split("/");
  const yyyy = yy < 50 ? `20${yy}` : `19${yy}`;
  date = `${yyyy}-${mm}-${dd}`;
}

// Pattern 3: With label
const dateMatch = text.match(/תאריך\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
```

### Total Amount Extraction

```javascript
// Pattern 1: After label
const totalMatch = text.match(/סה["']כ לתשלום[^₪]*₪([\d,\.]+)/);

// Pattern 2: With currency symbol
const totalMatch = text.match(/₪\s*([\d,\.]+)/);

// Pattern 3: Find all numbers and take the largest
const amounts = [...text.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g)]
  .map(m => parseFloat(m[0].replace(/,/g, '')))
  .filter(n => n > 1 && n < 100000);
const total = Math.max(...amounts);
```

### Month Name Conversion

```javascript
function getHebMonthName(monthNum) {
  const months = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
  ];
  return months[monthNum - 1];
}
```

### Invoice Type Detection

```javascript
let invoiceType = "";
if (text.includes("חשבונית מס קבלה") || text.includes("חשבונית מס / קבלה")) {
  invoiceType = "חשבונית מס קבלה";
} else if (text.includes("חשבונית מס")) {
  invoiceType = "חשבונית מס";
} else if (text.includes("קבלה")) {
  invoiceType = "קבלה";
} else {
  invoiceType = "מסמך";
}
```

## Integration with n8n

These parsers can be used in n8n workflows:

### Method 1: Direct Integration

Create a Code Node in n8n and copy the parser function:

```javascript
// Import the parser
const parsePartnerInvoice = [paste partner.js code here];

// Execute
const text = $input.first().json.text;
const result = parsePartnerInvoice(text, $json.emailId, $json.threadId);

return { json: result };
```

### Method 2: Via Claude Code CLI

Use the Execute Command node to call Claude Code:

```bash
cd /path/to/claude-code-project
echo "{{ $json.invoiceText }}" | claude -m "Parse this invoice"
```

The invoice-expert skill will automatically:
1. Identify the vendor
2. Use the appropriate parser
3. Return JSON

## Existing Parsers Overview

| Vendor | File | Email Pattern | Category | Notes |
|--------|------|---------------|----------|-------|
| Morning | `morning.js` | notify@morning.co | כללי | Generic parser with regex |
| עיריית הוד השרון | `arnona-hod-hasharon.js` | no_replay@orda.co.il | ארנונה | Class-based extractor |
| פרטנר | `partner.js` | Thankyou@partner.net.il | אינטרנט | Simple date/total extraction |
| הוט מובייל | `hot-mobile.js` | HOTmobile@printernet.co.il | סלולרי | Billing period extraction |
| חברת החשמל | `iec-hashmal.js` | noreplys@iec.co.il | חשמל | Complex period handling |
| דלק (Delek) | `delek-ocr.js` | Weezmo | דלק | OCR-optimized parser |
| 10ten | `10ten.js` | no-reply@10ten.co.il | דלק | Recursive text extraction |

## Best Practices

1. **Test thoroughly** - Test parser with multiple invoice samples
2. **Handle edge cases** - Missing dates, unusual formats, OCR errors
3. **Use robust regex** - Make patterns flexible but specific
4. **Document assumptions** - Comment why certain patterns are used
5. **Consistent output** - Always return the same structure
6. **Error handling** - Return partial data rather than failing completely
7. **Version control** - Commit parser changes with descriptive messages

## Troubleshooting

### Parser Not Found
- Check `vendor-mapping.json` for typos
- Verify `parserFile` matches actual filename
- Ensure file is in `vendor-parsers/` directory

### Wrong Data Extracted
- Review regex patterns in the parser
- Check for format changes in invoices
- Add debug logging to see matched values

### Parser Not Activating
- Verify email pattern matches exactly
- Check vendor name matching logic
- Ensure skill description mentions "invoice" or "receipt"

## Future Enhancements

- [ ] Add validation schemas for each vendor
- [ ] Create unit tests for each parser
- [ ] Add parser versioning for format changes
- [ ] Build parser generator tool
- [ ] Add confidence scores for extracted data
- [ ] Support multi-page invoices
- [ ] Handle invoice corrections/cancellations

## Contributing

When adding new parsers:
1. Follow the template structure
2. Test with at least 3 sample invoices
3. Update `vendor-mapping.json`
4. Document any special handling
5. Add to the table in this README
