# n8n Integration Guide - Invoice Expert

This guide shows how to integrate the Invoice Expert skill with n8n workflows.

## Option 1: Claude API via HTTP Request (Recommended)

Use n8n's HTTP Request node to call the Claude API directly. This is more reliable and doesn't require SSH.

### Setup Steps

1. **Get an API Key**
   - Go to https://console.anthropic.com/
   - Create an API key
   - Store it in n8n credentials

2. **Create HTTP Request Node**

**Node Configuration:**
```
Method: POST
URL: https://api.anthropic.com/v1/messages
Authentication: Header Auth
  - Name: x-api-key
  - Value: {{ $credentials.anthropicApiKey }}

Headers:
  - anthropic-version: 2023-06-01
  - content-type: application/json

Body (JSON):
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 4096,
  "system": "You are an expert assistant that extracts receipt fields for tax tracking in Israel. Your answers will be in Hebrew.\n\nExtract and return a single JSON object with the following fields:\n- \"date\": Format as YYYY-MM-DD.\n- \"year\": the year of the invoice.\n- \"invoiceType\": The type of the invoice (חשבונית מס/ חשבונית מס קבלה/ קבלה) dont add the \"/\" sign if the type is חשבונית מס קבלה.\n- \"merchant\": Name of business or company issuing the receipt. If missing, return null.\n- \"category\": Infer based on context from this list: עבודות חוץ וקבלני משנה, עלויות אחרות, נסיעות, ביטוחים, שירותים מקצועיים, כלי עבודה ציוד ואחזקה, נסיעות ומוניות, רכב - אחזקה תיקונים וחניה, רכב - דלק, ארנונה וועד בית, פחת, חשמל ומים, השתלמות וספרות מקצועית, פרסום קידום מכירות ואחזקת אתר, כיבודים, דואר ותקשורת, תוכנה, מחשבים ציוד מחשוב וטלפון נייד, רהיטים ואביזרים, ציוד לעסק כלי נגינה וציוד אלקטרוני, תרומות.\n- \"description\": A short summary of the service or item purchased. If missing, return null.\n- \"total\": Final amount paid (after tax). If missing, return 0.\n- \"id\": Use the id from the workflow.\n- \"threadId\": Use the threadId from the workflow.\n- \"finalName\": [date]_[invoiceType]_[merchant]_[description]_[total]_[currency].pdf\n\nRespond ONLY with a JSON object.",
  "messages": [
    {
      "role": "user",
      "content": "{{ $json.invoiceText }}"
    }
  ]
}
```

### Scenario 1: Text from PDF Extractor

**Workflow:**
```
PDF Extractor → HTTP Request (Claude API) → Process JSON → Save to Database
```

**HTTP Request Body (for text):**
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 4096,
  "system": "[System prompt from above]",
  "messages": [
    {
      "role": "user",
      "content": "עבד את החשבונית הבאה:\n\n{{ $json.extractedText }}"
    }
  ]
}
```

### Scenario 2: PDF File with Image (Vision)

**Workflow:**
```
Read Binary File → Convert to Base64 → HTTP Request (Claude API) → Process JSON
```

**Step 1: Read Binary File**
```
Node: Read Binary File
File Path: {{ $json.filePath }}
Property Name: data
```

**Step 2: HTTP Request with Vision**
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 4096,
  "system": "[System prompt from above]",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": "{{ $binary.data.data }}"
          }
        },
        {
          "type": "text",
          "text": "נתח את החשבונית בקובץ זה וחלץ את כל הפרטים."
        }
      ]
    }
  ]
}
```

**For Image PDFs (scanned documents):**
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 4096,
  "system": "[System prompt from above]",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": "{{ $binary.data.data }}"
          }
        },
        {
          "type": "text",
          "text": "זו חשבונית סרוקה. נא לקרוא את התמונה ולחלץ את כל השדות הנדרשים."
        }
      ]
    }
  ]
}
```

### Step 3: Parse JSON Response

Add a **Code Node** after the HTTP Request:

```javascript
const response = $input.first().json.content[0].text;

// Parse the JSON from Claude's response
let invoiceData;
try {
  invoiceData = JSON.parse(response);
} catch (error) {
  // If Claude wrapped it in markdown, extract the JSON
  const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    invoiceData = JSON.parse(jsonMatch[1]);
  } else {
    invoiceData = JSON.parse(response);
  }
}

// Add workflow-specific IDs
invoiceData.id = $input.first().json.id || null;
invoiceData.threadId = $input.first().json.threadId || null;

return {
  json: invoiceData
};
```

---

## Option 2: Claude Code CLI via Execute Command

Use this if you want the skill to work automatically and have Claude Code installed on the target machine.

### Prerequisites
- Claude Code must be installed on the machine where n8n runs
- The `.claude/skills/invoice-expert` skill must be in your working directory

### Scenario 1: Pass Text String

**n8n Execute Command Node:**
```bash
cd /path/to/your/claude-code/project
echo "{{ $json.invoiceText }}" | claude -m "עבד את החשבונית הזו והחזר JSON בלבד" --no-stream
```

### Scenario 2: Pass File Path

**n8n Execute Command Node:**
```bash
cd /path/to/your/claude-code/project
claude -m "נתח את החשבונית בקובץ {{ $json.filePath }} והחזר JSON בלבד" --no-stream
```

For PDF files with images:
```bash
cd /path/to/your/claude-code/project
claude -m "קרא את הקובץ {{ $json.filePath }} (חשבונית סרוקה) וחלץ את כל הנתונים. החזר רק JSON" --no-stream
```

### Extract JSON from CLI Output

Add a **Code Node** to parse the output:

```javascript
const cliOutput = $input.first().json.stdout;

// Claude Code might include additional text, extract JSON
let invoiceData;

try {
  // Try direct parse first
  invoiceData = JSON.parse(cliOutput);
} catch (error) {
  // Extract JSON block if wrapped
  const jsonMatch = cliOutput.match(/```json\n([\s\S]*?)\n```/) ||
                    cliOutput.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    invoiceData = JSON.parse(jsonStr);
  } else {
    throw new Error('Could not extract JSON from Claude output');
  }
}

return {
  json: invoiceData
};
```

---

## Complete n8n Workflow Examples

### Workflow 1: PDF Text Extractor → Claude API

```
[Trigger]
  → [Read Binary File] (PDF)
  → [PDF Extract Text Node]
  → [HTTP Request - Claude API]
  → [Code - Parse JSON]
  → [Set - Add Metadata]
  → [Save to Database/Google Sheets]
```

### Workflow 2: PDF with Image → Claude API Vision

```
[Trigger]
  → [Read Binary File] (PDF/Image)
  → [HTTP Request - Claude API with Vision]
  → [Code - Parse JSON]
  → [Rename File Node] (use finalName)
  → [Move File to Archive]
  → [Save to Database]
```

### Workflow 3: Multiple Files Processing

```
[Schedule Trigger]
  → [Read Files from Folder]
  → [Loop Over Items]
    → [Read Binary File]
    → [HTTP Request - Claude API]
    → [Code - Parse JSON]
    → [IF - Check if valid]
      → [Save to Database]
      → [Move to Processed Folder]
```

---

## Media Types for Vision

When using Claude API with vision (Option 1, Scenario 2):

- **PDF**: `"media_type": "application/pdf"`
- **JPEG**: `"media_type": "image/jpeg"`
- **PNG**: `"media_type": "image/png"`
- **GIF**: `"media_type": "image/gif"`
- **WebP**: `"media_type": "image/webp"`

---

## Tips for Production

1. **Error Handling**: Add error nodes to catch API failures
2. **Rate Limiting**: Claude API has rate limits - add delays between calls if processing many files
3. **Logging**: Log all API responses for debugging
4. **Validation**: Validate the JSON structure before saving to database
5. **Retry Logic**: Add retry logic for failed API calls (n8n has built-in retry options)
6. **Cost Optimization**:
   - Use Haiku model for simple invoices: `claude-3-5-haiku-20241022`
   - Use Sonnet for complex scanned images: `claude-sonnet-4-5-20250929`

---

## Cost Comparison

**Claude API Pricing (as of 2024):**
- **Haiku**: ~$0.25 per 1M input tokens, ~$1.25 per 1M output tokens
- **Sonnet**: ~$3 per 1M input tokens, ~$15 per 1M output tokens

For invoice processing:
- Average invoice: ~1000 tokens input, ~200 tokens output
- Cost per invoice with Haiku: ~$0.0005 (less than a cent)
- Cost per invoice with Sonnet: ~$0.006 (about half a cent)

**Recommendation**: Start with Haiku, upgrade to Sonnet only for scanned/poor quality images.
