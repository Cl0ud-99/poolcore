import sys
from PIL import Image
files = ["shots/so_rings.png","shots/tb_rings.png","shots/te_rings.png","shots/dz5_rings.png","shots/dz1_rings.png"]
for f in files:
    im = Image.open(f).convert("RGB")
    # column through tower centre
    x = 470
    col = [im.getpixel((x,y)) for y in range(150,530)]
    lum = [ (r*0.2126+g*0.7152+b*0.0722)/255.0 for (r,g,b) in col]
    # count local minima / variation
    import statistics
    d = [abs(lum[i+1]-lum[i]) for i in range(len(lum)-1)]
    print(f, "mean=%.3f std=%.3f maxjump=%.3f sumjump=%.2f" % (statistics.mean(lum), statistics.pstdev(lum), max(d), sum(d)))
    s = "".join("%d" % min(9,int(v*10)) for v in lum[::6])
    print("  ", s)
