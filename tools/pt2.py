import sys
from PIL import Image
pts=[(1060,130),(1000,100),(1120,170),(900,80)]
for path in sys.argv[1:]:
    im=Image.open(path).convert('RGB')
    out=[]
    for (x,y) in pts:
        out.append(str(im.getpixel((x,y))))
    print(f"{path:24s} " + "  ".join(out))
