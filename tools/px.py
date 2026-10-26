import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
W,H = im.size
for a in sys.argv[2:]:
    x,y = [int(v) for v in a.split(',')]
    print(a, im.getpixel((x,y)))
