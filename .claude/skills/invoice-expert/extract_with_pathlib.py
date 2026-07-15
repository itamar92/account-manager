import pdfplumber
import sys
from pathlib import Path

# Use pathlib to handle unicode paths properly
pdf_path = Path(r"C:\Users\itama\Dropbox\Docs Itamar\Docs Itamar - Buisness") / "חשבוניות - קבלות" / "19b3645d5c73d694.pdf"

try:
    # Check if file exists
    if not pdf_path.exists():
        print(f"File not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    with pdfplumber.open(pdf_path) as pdf:
        text_pages = []
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_pages.append(text)

        full_text = "\n\n".join(text_pages)
        print(full_text)
except Exception as e:
    print(f"Error: {str(e)}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
