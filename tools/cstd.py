import sys
from PIL import Image
import statistics as st

def stats(path, box):
    im = Image.open(path).convert('RGB')
    c = im.crop(box)
    px = list(c.getdata())
    lum = [0.2126*p[0]+0.7152*p[1]+0.0722*p[2] for p in px]
    m = sum(lum)/len(lum)
    sd = (sum((v-m)**2 for v in lum)/len(lum))**0.5
    lo = sorted(lum)[int(len(lum)*0.05)]
    hi = sorted(lum)[int(len(lum)*0.95)]
    return m, sd, lo, hi

box = (760, 30, 1240, 250)
for p in sys.argv[1:]:
    m, sd, lo, hi = stats(p, box)
    print(f"{p:32s} mean={m:6.1f} std={sd:6.2f} p05={lo:6.1f} p95={hi:6.1f} contrast={(hi-lo):6.1f}")
