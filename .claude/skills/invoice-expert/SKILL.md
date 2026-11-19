---
name: invoice-expert
description: Expert assistant for extracting receipt and invoice fields for Israeli tax tracking. Use when processing invoices, receipts, tax documents, PDF files, or when the user provides invoice text or file paths. Can read PDFs directly (with OCR if needed), identify vendors automatically, and use vendor-specific parsers. Responds in Hebrew with structured JSON output.
---

# Invoice Expert - מומחה חשבוניות

מומחה לעיבוד חשבוניות וקבלות למעקב מס בישראל עם מערכת פרסרים ייעודיים לכל ספק.

## הוראות - Workflow

כאשר מקבלים נתוני חשבונית, עקוב אחר השלבים הבאים:

### שלב 0: קריאת נתוני החשבונית

**אם מקבלים נתיב לקובץ PDF:**
1. **קרא את הקובץ** באמצעות Read tool
2. **אם הקובץ הוא PDF טקסטואלי** - קרא את הטקסט ישירות
3. **אם הקובץ הוא PDF סרוק (תמונה)** - Claude יכול לקרוא את התמונה בקובץ
4. **חלץ את כל הטקסט** מהקובץ

**אם מקבלים טקסט ישירות:**
- המשך לשלב הבא עם הטקסט

### שלב 0.5: טיפול בפורמטים שונים של קלט

**הנתונים יכולים להגיע בפורמטים שונים - טפל בכולם:**

1. **Vendor (ספק)** יכול להיות:
   - String פשוט: `"noreplys@iec.co.il"`
   - JSON string: `"{\"value\":[{\"address\":\"noreplys@iec.co.il\",\"name\":\"חברת חשמל\"}]}"`
   - Object: `{ address: "noreplys@iec.co.il", name: "..." }`
   - Array: `[{ address: "noreplys@iec.co.il" }]`

2. **Text (טקסט החשבונית)** יכול להיות:
   - String פשוט: `"חשבונית מס..."`
   - JSON array string: `"[\"חברת החשמל...\", \"עמוד 2...\"]"`
   - Array: `["חברת החשמל...", "עמוד 2..."]`

**פעולות:**
- אם vendor הוא JSON string - parse אותו
- אם vendor הוא object/array - חלץ את ה-email address
- אם text הוא JSON array string - parse ואחד למחרוזת אחת
- אם text הוא array - join עם newlines

**דוגמה לטיפול:**
```javascript
// Vendor parsing
let vendorEmail = "";
if (typeof vendor === 'string') {
  try {
    const parsed = JSON.parse(vendor);
    vendorEmail = parsed.value?.[0]?.address || parsed.address || vendor;
  } catch {
    vendorEmail = vendor; // Already a plain string
  }
} else if (vendor?.value?.[0]?.address) {
  vendorEmail = vendor.value[0].address;
} else if (vendor?.address) {
  vendorEmail = vendor.address;
}

// Text parsing
let invoiceText = "";
if (typeof text === 'string') {
  try {
    const parsed = JSON.parse(text);
    invoiceText = Array.isArray(parsed) ? parsed.join('\n\n') : parsed;
  } catch {
    invoiceText = text; // Already a plain string
  }
} else if (Array.isArray(text)) {
  invoiceText = text.join('\n\n');
}
```

### שלב 1: זיהוי הספק/Merchant

1. **קרא את `vendor-parsers/vendor-mapping.json`** כדי לראות את רשימת הספקים הקיימים

2. **זהה את הספק מתוך טקסט החשבונית:**
   - חפש כתובות email בטקסט (בדרך כלל ליד "מאת:", "From:", או בכותרת)
   - חפש שמות של חברות בעברית (לדוגמה: "חברת החשמל", "פרטנר", "עיריית <העיר שלך>")
   - חפש מספרי עוסק או ח.פ. שיכולים לעזור לזיהוי

3. **חפש התאמה** ברשימת הספקים:
   - התאמה לפי דפוס email (`emailPatterns`) - אם נמצא email בטקסט
   - התאמה לפי שם הספק (`displayName`) - אם נמצא שם החברה
   - אם לא נמצאה התאמה - זה ספק חדש

### שלב 2: שימוש בפרסר קיים או יצירת חדש

**אם נמצא פרסר קיים:**
1. **קרא את קובץ הפרסר** מתוך `vendor-parsers/[parserFile]`
2. **הרץ את הפונקציה** על טקסט החשבונית
3. **החזר את הנתונים המחולצים** בפורמט JSON

**אם הספק לא קיים במערכת:**
1. **צור קובץ פרסר חדש** בשם `vendor-parsers/[vendor-name].js`
   - השתמש באחד הפרסרים הקיימים כתבנית
   - התאם את הלוגיקה לפורמט החשבונית החדשה
2. **עדכן את `vendor-mapping.json`** והוסף את הספק החדש
3. **הרץ את הפרסר החדש** על החשבונית
4. **החזר את הנתונים המחולצים**

### שלב 3: החזרת הנתונים

1. **החזר JSON בלבד** - אין צורך בהסברים נוספים
2. **תשובות בעברית** - כל הערכים צריכים להיות בעברית
3. **אם שדה חסר** - השתמש ב-`null` או `0` לפי הצורך

## שדות לחילוץ

```json
{
  "finalName": "[date]_[invoiceType]_[merchant]_[description]_[total]_[currency].pdf",
  "date": "YYYY-MM-DD",
  "year": "YYYY",
  "invoiceType": "סוג החשבונית",
  "merchant": "שם העסק",
  "category": "קטגוריה",
  "description": "תיאור קצר של השירות או המוצר",
  "total": 0,
  "id": "{{ $json.id }}",
  "threadId": "{{ $json.threadId }}"
}
```

### הנחיות לשדות ספציפיים

#### invoiceType
סוגי חשבוניות אפשריים:
- חשבונית מס
- חשבונית מס קבלה (ללא סימן "/")
- קבלה

**שים לב:** אל תוסיף סימן "/" בסוג החשבונית. לדוגמה: "חשבונית מס קבלה" ולא "חשבונית מס/ קבלה"

#### category
בחר קטגוריה מהרשימה הבאה לפי ההקשר:

- עבודות חוץ וקבלני משנה
- עלויות אחרות
- נסיעות
- ביטוחים
- שירותים מקצועיים
- כלי עבודה, ציוד ואחזקה
- נסיעות ומוניות
- רכב - אחזקה, תיקונים וחניה
- רכב - דלק
- ארנונה וועד בית
- פחת
- חשמל ומים
- השתלמות וספרות מקצועית
- פרסום, קידום מכירות ואחזקת אתר
- כיבודים
- דואר ותקשורת
- תוכנה
- מחשבים, ציוד מחשוב וטלפון נייד
- רהיטים ואביזרים
- ציוד לעסק, כלי נגינה וציוד אלקטרוני
- תרומות

#### description
- תיאור קצר ותמציתי של השירות או המוצר
- לדוגמה: "חשבון חודשי חודש אוגוסט", "חידוש דומיין לשנתיים"

#### total
- הסכום הסופי ששולם (אחרי מע"מ)
- אם חסר - החזר 0

#### finalName
- פורמט: `[date]_[invoiceType]_[merchant]_[description]_[total]_[currency].pdf`
- לדוגמה: `2025-03-12_חשבונית מס קבלה_בזק_חשבון חודשי חודש אוגוסט_89_שח.pdf`

## דוגמה

**קלט:**
```
חשבונית מס קבלה
בזק - דואר ותקשורת
תאריך: 12/03/2025
תיאור: חשבון חודשי חודש אוגוסט
סה"כ לתשלום: 89 ₪
```

**פלט:**
```json
{
  "finalName": "2025-03-12_חשבונית מס קבלה_בזק_חשבון חודשי חודש אוגוסט_89_שח.pdf",
  "date": "2025-03-12",
  "year": "2025",
  "invoiceType": "חשבונית מס קבלה",
  "merchant": "בזק",
  "category": "דואר ותקשורת",
  "description": "חשבון חודשי חודש אוגוסט",
  "total": 89,
  "id": "{{ $json.id }}",
  "threadId": "{{ $json.threadId }}"
}
```

## קוד JavaScript ל-n8n

אם המשתמש מבקש קוד JavaScript עבור n8n node, ספק את הקוד הבא המותאם לחשבונית האחרונה שעובדה:

```javascript
// n8n Code Node - Invoice Parser for Israeli Tax Tracking
// Parse invoice text and extract structured data

const invoiceText = $input.first().json.body; // Adjust based on your input

// Helper function to extract date in various formats
function extractDate(text) {
  // Try DD/MM/YYYY format
  const dateMatch = text.match(/(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})/);
  if (dateMatch) {
    const [_, day, month, year] = dateMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

// Helper function to extract total amount
function extractTotal(text) {
  // Look for patterns like: ₪89, 89 ₪, סה"כ: 89
  const patterns = [
    /(?:סה["']כ|סך הכל|לתשלום)[:\s]*(\d+(?:\.\d{2})?)/,
    /(\d+(?:\.\d{2})?)\s*[₪]/,
    /[₪]\s*(\d+(?:\.\d{2})?)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseFloat(match[1]);
  }
  return 0;
}

// Helper function to determine invoice type
function extractInvoiceType(text) {
  if (text.includes('חשבונית מס קבלה')) return 'חשבונית מס קבלה';
  if (text.includes('חשבונית מס')) return 'חשבונית מס';
  if (text.includes('קבלה')) return 'קבלה';
  return null;
}

// Category mapping (customize based on merchant/description)
function categorizeInvoice(merchant, description) {
  const text = (merchant + ' ' + description).toLowerCase();

  if (text.includes('בזק') || text.includes('הוט') || text.includes('פרטנר')) {
    return 'דואר ותקשורת';
  }
  if (text.includes('דלק') || text.includes('פז') || text.includes('סונול')) {
    return 'רכב - דלק';
  }
  if (text.includes('חשמל') || text.includes('מים')) {
    return 'חשמל ומים';
  }
  if (text.includes('ביטוח')) {
    return 'ביטוחים';
  }
  // Add more rules as needed
  return 'עלויות אחרות';
}

// Extract fields
const date = extractDate(invoiceText);
const year = date ? date.split('-')[0] : null;
const invoiceType = extractInvoiceType(invoiceText);
const total = extractTotal(invoiceText);

// Extract merchant (customize regex based on your invoice format)
const merchantMatch = invoiceText.match(/(?:חברה|עסק|ספק)[:\s]*([^\n]+)/);
const merchant = merchantMatch ? merchantMatch[1].trim() : null;

// Extract description (customize based on your needs)
const descMatch = invoiceText.match(/(?:תיאור|פירוט)[:\s]*([^\n]+)/);
const description = descMatch ? descMatch[1].trim() : null;

const category = categorizeInvoice(merchant || '', description || '');

// Build final filename
const finalName = `${date}_${invoiceType}_${merchant}_${description}_${total}_שח.pdf`;

// Return structured output
return {
  json: {
    finalName,
    date,
    year,
    invoiceType,
    merchant,
    category,
    description,
    total,
    id: $input.first().json.id,
    threadId: $input.first().json.threadId
  }
};
```

## יצירת פרסר חדש לספק חדש

כאשר נתקלים בספק שאין לו פרסר:

1. **צור קובץ JavaScript חדש** בתיקיית `vendor-parsers/`
2. **כלול כותרת תיעוד** עם פרטי הספק:
   ```javascript
   /**
    * [Vendor Name] Invoice Parser
    * Vendor: [Hebrew Name]
    * Email Pattern: [email@example.com]
    */
   ```

3. **כתוב פונקציה שמחלצת את הנתונים:**
   ```javascript
   function parse[VendorName]Invoice(text, id, threadId) {
     // Extract date
     // Extract merchant
     // Extract total
     // Extract description
     // Return structured object
   }

   // Export for Node.js or n8n
   if (typeof module !== 'undefined' && module.exports) {
     module.exports = parse[VendorName]Invoice;
   }
   ```

4. **עדכן את vendor-mapping.json:**
   ```json
   {
     "name": "vendor-name",
     "displayName": "שם הספק בעברית",
     "emailPatterns": ["email@example.com"],
     "parserFile": "vendor-name.js",
     "category": "קטגוריה מתאימה"
   }
   ```

## דוגמאות לפרסרים קיימים

ניתן להשתמש בפרסרים הקיימים כתבנית:
- **`morning.js`** - פרסר כללי עם regex מתקדם
- **`partner.js`** - פרסר פשוט עם חילוץ תאריך
- **`iec-hashmal.js`** - טיפול בתקופות חיוב מורכבות
- **`delek-ocr.js`** - טיפול בטקסט OCR עם איכות נמוכה
- **`10ten.js`** - חילוץ טקסט רקורסיבי ממבני JSON מורכבים

## הערות חשובות

1. **תמיד קרא את vendor-mapping.json תחילה** כדי לבדוק אם יש פרסר קיים
2. **החזר רק JSON** - אל תוסיף הסברים או טקסט נוסף
3. **כל הערכים בעברית** - מלבד פורמט התאריך והשדות הטכניים
4. **אם שדה חסר:**
   - טקסט: `null`
   - מספר: `0`
5. **finalName צריך לכלול את כל החלקים** לפי הפורמט המדויק
6. **בדוק היטב את סוג החשבונית** - אל תוסיף סימן "/" לא נחוץ
7. **שמור עקביות** - פרסרים לאותו ספק צריכים להחזיר פורמט זהה תמיד
8. **תעד שינויים** - כשיוצרים פרסר חדש, ציין זאת למשתמש
