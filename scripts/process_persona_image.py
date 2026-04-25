"""One-off helper: turn the Warren Buffett pencil sketch into a transparent PNG
sized for the frontend.

Reads:  warren_buffet_sketch.png  (repo root)
Writes: frontend/public/personas/warren-buffett.png
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPO_ROOT / "warren_buffet_sketch.png"
TARGET_DIR = REPO_ROOT / "frontend" / "public" / "personas"
TARGET = TARGET_DIR / "warren-buffett.png"

# Pixels brighter than HARD_THRESHOLD (min channel) become fully transparent.
# Pixels between SOFT_THRESHOLD and HARD_THRESHOLD ramp from opaque to transparent.
# Anything darker than SOFT_THRESHOLD stays fully opaque.
HARD_THRESHOLD = 220
SOFT_THRESHOLD = 170
MAX_LONG_SIDE = 900


def process() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing source image: {SOURCE}")

    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    img = Image.open(SOURCE).convert("RGBA")
    pixels = img.load()
    w, h = img.size

    band = max(1, HARD_THRESHOLD - SOFT_THRESHOLD)
    for y in range(h):
        for x in range(w):
            r, g, b, _a = pixels[x, y]
            min_rgb = min(r, g, b)
            if min_rgb >= HARD_THRESHOLD:
                pixels[x, y] = (r, g, b, 0)
            elif min_rgb >= SOFT_THRESHOLD:
                t = (min_rgb - SOFT_THRESHOLD) / band
                alpha = max(0, min(255, int(255 * (1 - t))))
                pixels[x, y] = (r, g, b, alpha)

    # Smooth alpha edges so the cut-out doesn't look hard-stencilled.
    r_ch, g_ch, b_ch, a_ch = img.split()
    a_ch = a_ch.filter(ImageFilter.GaussianBlur(radius=0.6))
    img = Image.merge("RGBA", (r_ch, g_ch, b_ch, a_ch))

    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    long_side = max(img.size)
    if long_side > MAX_LONG_SIDE:
        scale = MAX_LONG_SIDE / long_side
        new_size = (int(img.size[0] * scale), int(img.size[1] * scale))
        img = img.resize(new_size, Image.LANCZOS)

    img.save(TARGET, "PNG", optimize=True)
    print(f"wrote {TARGET} ({TARGET.stat().st_size / 1024:.1f} KB, {img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    process()
