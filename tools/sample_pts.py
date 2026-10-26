
import sys
from PIL import Image
files = ["m1_vault.png","dD_vault.png","dA_vault.png","dF_vault.png","x_sh0_vault.png","dB_vault.png"]
pts = [(480,120),(300,80),(700,80),(480,60),(250,150),(760,150),(480,240),(120,60),(860,60)]
for f in files:
    try:
        im = Image.open("shots/"+f).convert("RGB")
    except Exception as e:
        print(f, "ERR", e); continue
    w,h = im.size
    sc = w/960.0
    row = []
    for (x,y) in pts:
        px = im.getpixel((int(x*sc), int(y*sc)))
        row.append("%3d,%3d:%02x%02x%02x" % (x,y,px[0],px[1],px[2]))
    print(f, w, h)
    print("   " + "  ".join(row))
