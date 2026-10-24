"""Generates the app icons (a serif 'V' on deep green). Run once: python3 build/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent.parent / "icons"
FONTS = ["/System/Library/Fonts/Supplemental/Georgia Bold.ttf", "/System/Library/Fonts/NewYork.ttf",
         "/System/Library/Fonts/Times.ttc"]

def icon(size):
    img = Image.new("RGB", (size, size), "#2f5d50")
    d = ImageDraw.Draw(img)
    font = next(ImageFont.truetype(f, int(size * 0.62)) for f in FONTS if Path(f).exists())
    d.text((size / 2, size * 0.53), "V", font=font, fill="#f7f5f0", anchor="mm")
    d.rectangle([size * 0.3, size * 0.8, size * 0.7, size * 0.815], fill="#c9a96e")
    return img

OUT.mkdir(exist_ok=True)
for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    icon(size).save(OUT / name)
print("icons written")
