import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
W,H = im.size
px = im.load()
rows = {}
for y in range(0, H, 4):
    xs = [x for x in range(0, W, 2) if sum(px[x,y]) < 60]
    if len(xs) > 6:
        rows[y] = (len(xs), min(xs), max(xs))
for y in sorted(rows)[:40]:
    print(y, rows[y])
print('size', W, H)
