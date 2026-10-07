# Invoice Expert Skill - Quick Start

מומחה חשבוניות לעיבוד חשבוניות ישראליות ומעקב מס.

## Files in This Directory

- **SKILL.md** - The main skill definition (used by Claude Code CLI)
- **n8n-integration.md** - Complete integration guide for n8n workflows
- **n8n-workflow-text-input.json** - Ready-to-import n8n workflow for text input
- **n8n-workflow-pdf-vision.json** - Ready-to-import n8n workflow for PDF files
- **n8n-workflow-ssh-cli.json** - Ready-to-import n8n workflow using SSH/CLI method
- **vendor-parsers/** - Directory containing vendor-specific invoice parsers
  - **README.md** - Complete guide to the vendor-specific parsing system
  - **vendor-mapping.json** - Maps vendors to their parser files
  - **[vendor].js** - Individual parser files for each vendor
- **README.md** - This file

## NEW: Vendor-Specific Parsing System

The skill now uses **vendor-specific JavaScript parsers** for consistent, accurate invoice processing:

### How It Works

1. **Identify Vendor** - Claude reads the invoice and identifies the merchant/vendor
2. **Load Parser** - Looks up the vendor in `vendor-parsers/vendor-mapping.json`
3. **Parse Invoice** - Uses the vendor-specific parser to extract data
4. **Return JSON** - Returns structured, consistent data

### Benefits

- **Consistency** - Same vendor always parsed the same way
- **Accuracy** - Parsers tuned to each vendor's format
- **Expandability** - New vendors automatically added when encountered
- **No AI Cost** - No API calls needed for known vendors

### Current Supported Vendors

| Vendor | Email Pattern | Category |
|--------|---------------|----------|
| Morning | notify@morning.co | כללי |
| פרטנר | Thankyou@partner.net.il | אינטרנט |
| הוט מובייל | HOTmobile@printernet.co.il | סלולרי |
| חברת החשמל | noreplys@iec.co.il | חשמל |
| דלק | Weezmo | דלק |
| 10ten | no-reply@10ten.co.il | דלק |

### Adding New Vendors

When Claude encounters a new vendor, it will **automatically**:
1. Create a new parser file in `vendor-parsers/`
2. Update `vendor-mapping.json`
3. Use the new parser for future invoices from that vendor

**This means your system grows smarter with each new invoice type!**

For detailed information, see **`vendor-parsers/README.md`**

## NEW: Raw Data Support

**Claude Code now handles ANY data format automatically!**

You can pass vendor and text data in any format:
- JSON strings
- Objects
- Arrays
- Plain strings

Claude will figure it out and parse correctly.

### n8n Workflow with Raw Data

Import **`n8n-workflow-claude-code-raw.json`** - it's just 4 nodes:

1. **Receive raw data** (vendor, text, emailId, threadId)
2. **Write to temp file** (no parsing!)
3. **Execute Claude Code** (Claude handles everything)
4. **Parse JSON output** (clean up temp file)

**That's it!** No data preprocessing needed.

## Usage Scenarios

### 1. Interactive Use in Claude Code

Just ask Claude to process an invoice:

```bash
claude -m "עבד את החשבונית:
חשבונית מס קבלה
בזק
תאריך: 15/12/2024
סה\"כ: 120 ₪"
```

The skill will automatically activate and return JSON output.

### 2. n8n Automation - Text Input

**Use Case:** You extract text from a PDF and want Claude to parse it.

**Steps:**
1. Import `n8n-workflow-text-input.json` into n8n
2. Add your Anthropic API key to n8n credentials (name it "Anthropic API Key")
3. Pass invoice text in `invoiceText` field
4. Get structured JSON output

**Example Input:**
```json
{
  "invoiceText": "חשבונית מס קבלה\nבזק\nתאריך: 15/12/2024\nסה\"כ: 120 ₪",
  "id": "inv_001",
  "threadId": "thread_123"
}
```

**Example Output:**
```json
{
  "finalName": "2024-12-15_חשבונית מס קבלה_בזק_חשבון חודשי_120_שח.pdf",
  "date": "2024-12-15",
  "year": "2024",
  "invoiceType": "חשבונית מס קבלה",
  "merchant": "בזק",
  "category": "דואר ותקשורת",
  "description": "חשבון חודשי",
  "total": 120,
  "id": "inv_001",
  "threadId": "thread_123"
}
```

### 3. n8n Automation - PDF File with Vision

**Use Case:** You have a PDF file (possibly scanned image) and want Claude to read and parse it.

**Steps:**
1. Import `n8n-workflow-pdf-vision.json` into n8n
2. Add your Anthropic API key
3. Pass file path in `filePath` field
4. Claude will read the PDF/image and extract data

**Example Input:**
```json
{
  "filePath": "/path/to/invoices/bezeq-december.pdf",
  "id": "inv_002",
  "threadId": "thread_123"
}
```

**Supported File Types:**
- PDF files (text or scanned images)
- JPEG images
- PNG images
- WebP images

### 4. n8n Automation - SSH/Execute Command

**Use Case:** You have Claude Code installed and want to use it via SSH node.

**Prerequisites:**
- Claude Code must be installed on the target machine
- The `.claude/skills/invoice-expert` directory must exist in your project

**Steps:**
1. Import `n8n-workflow-ssh-cli.json` into n8n
2. Update the path: Replace `/path/to/claude-code-project` with your actual project path
3. Choose text input or file path method
4. Get JSON output

**Important:** Make sure Claude Code is in your PATH or use full path like `/usr/local/bin/claude`

## Workflow Comparison

| Method | Pros | Cons | Best For |
|--------|------|------|----------|
| **Claude API (Text)** | Fast, reliable, no SSH needed | Requires API key, costs per request | Pre-extracted text from PDFs |
| **Claude API (Vision)** | Reads scanned images, no text extraction needed | Higher cost, requires API key | Scanned invoices, images |
| **SSH/CLI** | Uses your existing skill, familiar | Requires Claude Code installed, slower | Development/testing |

## Cost Optimization Tips

1. **Use Haiku for simple invoices:**
   ```json
   "model": "claude-3-5-haiku-20241022"
   ```
   Cost: ~$0.0005 per invoice

2. **Use Sonnet only for complex scanned images:**
   ```json
   "model": "claude-sonnet-4-5-20250929"
   ```
   Cost: ~$0.006 per invoice

3. **Batch processing:** Process multiple invoices in sequence to reduce overhead

4. **Cache PDFs:** If you process the same invoice multiple times, cache the results

## Setting Up Anthropic API Key in n8n

1. Go to https://console.anthropic.com/
2. Create an account or log in
3. Navigate to "API Keys"
4. Click "Create Key"
5. Copy the key
6. In n8n:
   - Go to Credentials → Add Credential
   - Choose "Header Auth"
   - Name: "Anthropic API Key"
   - Name: `x-api-key`
   - Value: `your-api-key-here`
   - Save

## Testing the Skill Locally

Before setting up n8n, test the skill works correctly:

```bash
cd /path/to/claude-code-project

# Test with text
echo "חשבונית מס
בזק
תאריך: 15/12/2024
סה\"כ: 120 ₪" | claude -m "עבד חשבונית זו"

# Test with file
claude -m "קרא את הקובץ /path/to/invoice.pdf וחלץ נתונים"
```

If the skill activates correctly, you'll see Hebrew JSON output.

## Common Issues

### Skill Not Activating
- Check that `SKILL.md` exists in `.claude/skills/invoice-expert/`
- Verify YAML frontmatter is correct (no tabs, proper `---` delimiters)
- Make sure description mentions "invoice" or "receipt"

### n8n "Unauthorized" Error
- Verify API key is correct in credentials
- Check that header name is `x-api-key` (not `Authorization`)
- Ensure `anthropic-version` header is set to `2023-06-01`

### JSON Parsing Errors
- Claude might wrap JSON in markdown code blocks - the Parse JSON node handles this
- Check that you're using `--no-stream` flag for CLI method
- Verify the system prompt asks for "JSON only"

### Hebrew Text Garbled
- Ensure your n8n instance supports UTF-8 encoding
- Check that database/storage supports Hebrew characters
- Use proper encoding when writing to files

## Next Steps

1. **Import a workflow** from the JSON files provided
2. **Test with a sample invoice** to verify it works
3. **Customize categories** if needed (edit SKILL.md)
4. **Add database storage** to save parsed invoices
5. **Set up batch processing** for multiple invoices

## Support

For issues with:
- **The skill itself**: Check SKILL.md and test locally with Claude Code
- **n8n workflows**: Refer to n8n-integration.md
- **Claude API**: See https://docs.anthropic.com/claude/reference/
- **Claude Code**: See https://code.claude.com/docs/

## License

This skill is part of your Claude Code project. Customize as needed for your tax tracking requirements.
