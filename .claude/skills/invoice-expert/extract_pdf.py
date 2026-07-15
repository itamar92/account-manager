import pdfplumber
import sys
import os

# Set the correct path
pdf_path = r"C:\Users\itama\Dropbox\Docs Itamar\Docs Itamar - Buisness\חשבוניות - קבלות\global retainer.pdf"

try:
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
    sys.exit(1)
