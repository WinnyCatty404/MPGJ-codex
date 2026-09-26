"""Build small contact sheets for visual QA of a rendered report."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw

folder = Path(sys.argv[1])
pages = sorted(folder.glob('page-*.jpg'))
for offset in range(0, len(pages), 12):
    batch = pages[offset:offset + 12]
    sheet = Image.new('RGB', (1440, 1300), '#eeeeee')
    draw = ImageDraw.Draw(sheet)
    for index, page in enumerate(batch):
        image = Image.open(page).convert('RGB')
        image.thumbnail((340, 400))
        x = (index % 4) * 360 + (360 - image.width) // 2
        y = (index // 4) * 430 + 20
        sheet.paste(image, (x, y))
        draw.text((x, y + image.height + 3), page.stem, fill='black')
    sheet.save(folder / f'contact-{offset // 12 + 1}.jpg', quality=85)
print(f'{len(pages)} pages, {(len(pages) + 11) // 12} contact sheets')
