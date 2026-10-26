import sys
from PIL import Image, ImageFilter
import numpy as np
files = sys.argv[1:]
# vault region at 960x540
x0,y0,x1,y1 = 285,0,810,225
for f in files:
    im = Image.open(f).convert('RGB')
    a = np.asarray(im.crop((x0,y0,x1,y1))).astype(np.float32)/255.0
    L = a @ np.array([0.2126,0.7152,0.0722], dtype=np.float32)
    blur = np.asarray(Image.fromarray((L*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)/255.0
    hp = L - blur
    print("%-22s mean=%.3f hpStd=%.4f Lstd=%.4f" % (f.split('/')[-1].split(chr(92))[-1], L.mean(), hp.std(), L.std()))
