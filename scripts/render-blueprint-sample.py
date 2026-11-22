"""Render the public fictional sample with Poppler; update its page links.

Requires pypdf, Pillow, and pdftoppm. No customer data or service calls are used.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from PIL import Image, ImageOps, ImageDraw
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('--pdftoppm', default=shutil.which('pdftoppm'))
parser.add_argument('--qa-dir', type=Path)
args = parser.parse_args()
if not args.pdftoppm:
    raise SystemExit('pdftoppm is required to verify sample page images')
root = Path(__file__).resolve().parents[1]
pdf = root / 'assets/blueprint-sample.pdf'
reader = PdfReader(pdf)
pages = [p.extract_text() for p in reader.pages]
for number, text in enumerate(pages, 1):
    assert 'ILLUSTRATIVE SAMPLE | FICTIONAL PROFILE' in text, f'Unmarked sample page {number}'
previews = {}
html_file = root / 'index.html'
html = html_file.read_text(encoding='utf-8')
for key, marker in [('gaps', 'Qualification Gap Analysis'), ('resume', 'Resume Strategy'), ('plan', '90-Day Career Transition Plan')]:
    page = next(i + 1 for i, text in enumerate(pages) if re.search(r'^' + re.escape(marker) + r'$', text, re.M))
    prefix = root / f'assets/blueprint-sample-{key}'
    subprocess.run([args.pdftoppm, '-f', str(page), '-l', str(page), '-r', '72', '-png', '-singlefile', str(pdf), str(prefix)], check=True, capture_output=True)
    with Image.open(prefix.with_suffix('.png')) as image:
        assert image.size == (612, 792), image.size
    previews[key] = {'page': page, 'image': f'/assets/blueprint-sample-{key}.png'}
    pattern = r'(<a href="/assets/blueprint-sample\.pdf#page=)\d+("[^>]*><img src="/assets/blueprint-sample-' + key + r'\.png")'
    html, changed = re.subn(pattern, lambda match: match[1] + str(page) + match[2], html)
    assert changed == 1, f'Expected one {key} page preview link'
html_file.write_text(html, encoding='utf-8', newline='\n')
manifest = {'fictional': True, 'pageCount': len(pages), 'pdf': '/assets/blueprint-sample.pdf',
    'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'previews': previews}
(root / 'assets/blueprint-sample-pages.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

if args.qa_dir:
    args.qa_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([args.pdftoppm, '-r', '85', '-png', str(pdf), str(args.qa_dir / 'page')], check=True, capture_output=True)
    thumbnails = []
    for number, path in enumerate(sorted(args.qa_dir.glob('page-*.png')), 1):
        with Image.open(path) as source:
            thumb = ImageOps.contain(source.convert('RGB'), (306, 396))
            tile = Image.new('RGB', (330, 430), '#e7e5e0')
            tile.paste(thumb, ((330 - thumb.width) // 2, 24))
            ImageDraw.Draw(tile).text((12, 6), f'PDF page {number}', fill='#222222')
            thumbnails.append(tile)
    for start in range(0, len(thumbnails), 8):
        sheet = Image.new('RGB', (330 * 4, 430 * 2), '#dedbd5')
        for index, tile in enumerate(thumbnails[start:start + 8]):
            sheet.paste(tile, ((index % 4) * 330, (index // 4) * 430))
        sheet.save(args.qa_dir / f'contact-sheet-{start // 8 + 1}.png')
print(json.dumps(manifest))
