import pdfplumber
import sys
from pathlib import Path
import shutil

# Source and destination paths
src_folder = Path(r"C:\Users\itama\Dropbox\Docs Itamar\Docs Itamar - Buisness") / "חשבוניות - קבלות"
src_file = src_folder / "302236799-2251652555.pdf"
dest_file = Path(__file__).parent / "temp_invoice_302236799.pdf"

try:
    # Try to copy file
    print(f"Attempting to copy from: {src_file}", file=sys.stderr)
    print(f"To: {dest_file}", file=sys.stderr)

    # Check if source exists
    if not src_file.exists():
        print(f"Source file not found: {src_file}", file=sys.stderr)
        sys.exit(1)

    # Try reading directly first
    try:
        with pdfplumber.open(str(src_file)) as pdf:
            text_pages = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    text_pages.append(text)

            full_text = "\n\n".join(text_pages)
            print(full_text)
            sys.exit(0)
    except OSError as e:
        print(f"Direct read failed: {e}, trying copy approach...", file=sys.stderr)

    # Copy file
    shutil.copy2(src_file, dest_file)
    print(f"File copied successfully", file=sys.stderr)

    # Extract text from copied file
    with pdfplumber.open(dest_file) as pdf:
        text_pages = []
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_pages.append(text)

        full_text = "\n\n".join(text_pages)
        print(full_text)

    # Clean up
    dest_file.unlink()

except Exception as e:
    print(f"Error: {str(e)}", file=sys.stderr)
    import traceback
    traceback.print_exc()
    sys.exit(1)
