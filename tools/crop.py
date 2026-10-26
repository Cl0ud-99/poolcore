import sys
from PIL import Image
# usage: crop.py in.png x y w h out.png [scale]
a = sys.argv[1:]
im = Image.open(a[0]).convert("RGB")
x, y, w, h = int(a[1]), int(a[2]), int(a[3]), int(a[4])
out = a[5]
sc = float(a[6]) if len(a) > 6 else 1.0
c = im.crop((x, y, x + w, y + h))
if sc != 1.0:
    c = c.resize((int(w * sc), int(h * sc)), Image.LANCZOS)
c.save(out)
print("wrote", out, c.size)
