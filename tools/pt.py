import sys
from PIL import Image

path = sys.argv[1]
pts = [(820,60),(900,90),(1000,120),(1100,160),(760,40),(1180,220),(860,150)]
im = Image.open(path).convert('RGB')
for (x,y) in pts:
    p = im.getpixel((x,y))
    print(f"({x},{y}) rgb={p}")
