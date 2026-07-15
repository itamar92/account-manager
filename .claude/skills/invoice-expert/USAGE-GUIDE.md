# Usage Guide - Invoice Expert with Raw Data

## The Problem We Solved

**Before:** You had to parse vendor and text data before sending to Claude
- Vendor could be: JSON string, object, array, plain string
- Text could be: JSON array string, array, plain string
- Required complex preprocessing logic in n8n

**Now:** Just send everything to Claude as-is!
- No preprocessing needed
- Claude handles all formats automatically
- Simpler workflows
- Fewer errors

## Complete n8n Workflow Example

### Input Data (from your workflow):

```json
{
  "vendor": "{\"value\":[{\"address\":\"noreplys@iec.co.il\",\"name\":\"חברת חשמל לישראל\"}],\"html\":\"...\",\"text\":\"...\"}",
  "text": "[\"חברת החשמל לישראל בע\\\"מ\\n...\",\"עמוד 2/2\"]",
  "emailId": "19b47b388b4f3d81",
  "threadId": "19b47b388b4f3d81"
}
```

### Workflow Nodes:

```
┌─────────────────────────────────────┐
│  When Executed by Another Workflow │
│                                     │
│  Inputs:                            │
│  - vendor (any format)              │
│  - text (any format)                │
│  - emailId                          │
│  - threadId                         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Write Raw Data to File             │
│  (Code Node)                        │
│                                     │
│  fs.writeFileSync(                  │
│    tempFile,                        │
│    JSON.stringify({                 │
│      vendor: $json.vendor,          │
│      text: $json.text,              │
│      emailId: $json.emailId,        │
│      threadId: $json.threadId       │
│    })                               │
│  )                                  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Execute Claude Code                │
│  (Execute Command)                  │
│                                     │
│  claude -m "Read file and parse     │
│  invoice. Handle any data format.   │
│  Return JSON." --no-stream          │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Parse JSON Output                  │
│  (Code Node)                        │
│                                     │
│  - Extract JSON from stdout         │
│  - Clean up temp file               │
│  - Return invoice data              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Output: Structured Invoice Data   │
│                                     │
│  {                                  │
│    date: "2025-12-22",              │
│    year: "2025",                    │
│    invoiceType: "חשבונית מס קבלה",  │
│    merchant: "חברת החשמל...",       │
│    category: "חשמל ומים",           │
│    description: "חשבון חשמל...",    │
│    total: 308.55,                   │
│    finalName: "2025-12-22_...",     │
│    id: "19b47b388b4f3d81",          │
│    threadId: "19b47b388b4f3d81"     │
│  }                                  │
└─────────────────────────────────────┘
```

## What Claude Does Automatically

### Step 1: Parse Input Formats

Claude reads the temp file and intelligently parses:

**Vendor parsing:**
```javascript
// Input: "{\"value\":[{\"address\":\"noreplys@iec.co.il\",...}]}"
// Claude extracts: "noreplys@iec.co.il"
```

**Text parsing:**
```javascript
// Input: "[\"חברת החשמל...page 1\", \"page 2...\"]"
// Claude joins: "חברת החשמל...page 1\n\npage 2..."
```

### Step 2: Identify Vendor

Claude reads `vendor-parsers/vendor-mapping.json`:

```json
{
  "name": "iec-hashmal",
  "emailPatterns": ["noreplys@iec.co.il"],
  "parserFile": "iec-hashmal.js"
}
```

Finds match: `noreplys@iec.co.il` → `iec-hashmal.js`

### Step 3: Use Vendor Parser

Claude reads and executes `vendor-parsers/iec-hashmal.js`:

```javascript
function parseIECInvoice(text, emailId, threadId) {
  // Extract date: תאריך עריכת החשבון 22/12/2025
  // Extract total: 308.55 סה"כ לתשלום
  // Extract period: 19/11/2025 עד 19/12/2025
  // Build description: "חשבון חשמל חודש נובמבר"

  return {
    date: "2025-12-22",
    year: "2025",
    invoiceType: "חשבונית מס קבלה",
    merchant: "חברת החשמל לישראל בעמ",
    category: "חשמל ומים",
    description: "חשבון חשמל חודש נובמבר",
    total: 308.55,
    finalName: "2025-12-22_חשבונית מס קבלה_חברת החשמל לישראל בעמ_חשבון חשמל חודש נובמבר_308.55_שח.pdf",
    id: emailId,
    threadId: threadId
  };
}
```

### Step 4: Return JSON

Claude outputs clean JSON (no explanations).

## Different Vendor Examples

### Example 1: Partner (פרטנר)

**Input:**
```json
{
  "vendor": "Thankyou@partner.net.il",
  "text": "פרטנר\nתאריך: 15/12/24\nסה\"כ: 89 ₪"
}
```

**Claude identifies:** `partner.js`

**Output:**
```json
{
  "date": "2024-12-15",
  "merchant": "פרטנר",
  "category": "אינטרנט",
  "total": 89
}
```

### Example 2: New Unknown Vendor

**Input:**
```json
{
  "vendor": "invoices@newvendor.co.il",
  "text": "ספק חדש\nתאריך: 20/12/24\nסה\"כ: 150 ₪"
}
```

**Claude does:**
1. Checks `vendor-mapping.json` - not found
2. Creates `vendor-parsers/newvendor.js`
3. Updates `vendor-mapping.json`
4. Parses the invoice
5. **Next time this vendor arrives, uses the same parser!**

## Setup Instructions

### 1. Import Workflow

In n8n:
1. Go to Workflows
2. Click "Import from File"
3. Select `.claude/skills/invoice-expert/n8n-workflow-claude-code-raw.json`
4. Save

### 2. Update Path

Edit the "Execute Claude Code" node, change path to yours:

```powershell
Set-Location "YOUR_PATH_HERE\Claude-code"; claude -m "..." --no-stream
```

Replace `YOUR_PATH_HERE` with your actual path.

### 3. Test

Call the workflow with test data:

```json
{
  "vendor": "noreplys@iec.co.il",
  "text": "חשבונית מס\nחברת החשמל\nתאריך: 22/12/2025\nסה\"כ: 308.55",
  "emailId": "test123",
  "threadId": "thread123"
}
```

### 4. Check Output

Should return structured JSON:

```json
{
  "date": "2025-12-22",
  "year": "2025",
  "invoiceType": "חשבונית מס קבלה",
  "merchant": "חברת החשמל לישראל בעמ",
  "category": "חשמל ומים",
  "total": 308.55,
  "finalName": "2025-12-22_חשבונית מס קבלה_חברת החשמל לישראל בעמ_חשבון חשמל חודש נובמבר_308.55_שח.pdf"
}
```

## Supported Vendor Formats

### Vendor Field Examples:

✅ Plain string:
```json
"vendor": "noreplys@iec.co.il"
```

✅ Gmail-style object (as JSON string):
```json
"vendor": "{\"value\":[{\"address\":\"noreplys@iec.co.il\",\"name\":\"חברת חשמל\"}]}"
```

✅ Simple object:
```json
"vendor": {
  "address": "noreplys@iec.co.il",
  "name": "חברת חשמל"
}
```

✅ Array:
```json
"vendor": [{
  "address": "noreplys@iec.co.il",
  "name": "חברת חשמל"
}]
```

### Text Field Examples:

✅ Plain string:
```json
"text": "חשבונית מס\n..."
```

✅ Array (as JSON string):
```json
"text": "[\"עמוד 1...\", \"עמוד 2...\"]"
```

✅ Array:
```json
"text": ["עמוד 1...", "עמוד 2..."]
```

## Troubleshooting

### Issue: "Could not parse JSON from output"

**Cause:** Claude's output wasn't valid JSON

**Fix:** Check stderr in the error output. Common causes:
- Claude Code not in PATH
- Working directory doesn't exist
- Temp directory permissions

### Issue: "Command failed with exit code 1"

**Cause:** PowerShell error or Claude Code error

**Fix:**
1. Check `stderr` in error output
2. Test command manually in PowerShell
3. Verify Claude Code is installed: `claude --version`

### Issue: Wrong vendor identified

**Cause:** Email pattern doesn't match

**Fix:**
1. Check `vendor-parsers/vendor-mapping.json`
2. Add the new email pattern
3. Update the vendor entry

### Issue: Parsing errors for a specific vendor

**Cause:** Invoice format changed

**Fix:**
1. Go to `vendor-parsers/[vendor].js`
2. Update regex patterns
3. Test with the new invoice format

## Performance

**Typical execution times:**
- Known vendor: 2-5 seconds
- Unknown vendor (first time): 10-15 seconds (creates parser)
- Unknown vendor (subsequent): 2-5 seconds (uses created parser)

**Temp files:**
- Created in `Claude-code/temp/`
- Automatically cleaned up after parsing
- File format: `invoice-data-[timestamp].json`

## Benefits Summary

✅ **No preprocessing** - Send any data format
✅ **Auto-detection** - Claude figures out vendor
✅ **Consistent output** - Same vendor = same format
✅ **Self-learning** - New vendors added automatically
✅ **Simple workflow** - Just 4 n8n nodes
✅ **Easy debugging** - All data in temp file

## Next Steps

1. **Replace your Switch node** - Use this workflow instead
2. **Test with real invoices** - Try different vendors
3. **Monitor new vendors** - Check when new parsers are created
4. **Customize parsers** - Edit vendor-specific files as needed
5. **Version control** - Commit parser files to git

Your invoice parsing system now grows smarter with each new invoice! 🎯
