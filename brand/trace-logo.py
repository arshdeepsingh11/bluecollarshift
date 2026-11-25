"""Vectorise the owner's Blue Collar logo (their own artwork) into a clean SVG."""
import sys
import numpy as np
from PIL import Image, ImageFilter
import potrace

SRC = sys.argv[1]
OUT = sys.argv[2]
SCALE = 6
im = Image.open(SRC).convert('RGBA')
bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
bg.alpha_composite(im)
g = bg.convert('L')
g = g.resize((g.width * SCALE, g.height * SCALE), Image.LANCZOS).filter(ImageFilter.GaussianBlur(SCALE * 0.6))
bitmap = np.array(g) >= 140         # True = logo ink
bm = potrace.Bitmap(bitmap)
path = bm.trace(turdsize=40, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.0, opticurve=True, opttolerance=0.2)

w, h = im.width, im.height
parts = []
for curve in path:
    sp = curve.start_point
    d = [f"M{sp.x / SCALE:.2f},{sp.y / SCALE:.2f}"]
    for seg in curve.segments:
        if seg.is_corner:
            d.append(f"L{seg.c.x / SCALE:.2f},{seg.c.y / SCALE:.2f}L{seg.end_point.x / SCALE:.2f},{seg.end_point.y / SCALE:.2f}")
        else:
            d.append(f"C{seg.c1.x / SCALE:.2f},{seg.c1.y / SCALE:.2f} {seg.c2.x / SCALE:.2f},{seg.c2.y / SCALE:.2f} {seg.end_point.x / SCALE:.2f},{seg.end_point.y / SCALE:.2f}")
    d.append('Z')
    parts.append(''.join(d))
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="Blue Collar">'
       f'<title>Blue Collar</title><path fill="currentColor" fill-rule="evenodd" d="{" ".join(parts)}"/></svg>')
open(OUT, 'w').write(svg)
print('paths', len(parts), 'bytes', len(svg))
