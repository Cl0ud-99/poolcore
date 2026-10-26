
from PIL import Image
im = Image.open("shots/mid_vault.png").convert("RGB")
pts = [(480,300),(300,300),(700,300),(480,420),(200,420),(760,420),(480,180),(250,180),(120,300),(860,300),(480,60),(150,60)]
for (x,y) in pts:
    print("%3d,%3d -> %s" % (x,y,im.getpixel((x,y))))
