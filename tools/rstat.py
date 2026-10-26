import sys
from PIL import Image

box = tuple(int(v) for v in sys.argv[1].split(','))
for path in sys.argv[2:]:
    im = Image.open(path).convert('RGB').crop(box)
    px = list(im.getdata())
    lum = [0.2126*p[0]+0.7152*p[1]+0.0722*p[2] for p in px]
    m = sum(lum)/len(lum)
    sd = (sum((v-m)**2 for v in lum)/len(lum))**0.5
    lo = sorted(lum)[int(len(lum)*0.02)]
    hi = sorted(lum)[int(len(lum)*0.98)]
    print(f"{path:26s} mean={m:6.1f} std={sd:6.2f} p02={lo:6.1f} p98={hi:6.1f}")
