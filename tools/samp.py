
from PIL import Image
import sys, os
d = r"bathhouse/shots"
names = ["r_water","r_ao_water","r_dif_water","r_spec_water"]
for n in names:
    p = os.path.join(d, n + ".png")
    im = Image.open(p).convert("RGB")
    w,h = im.size
    px = im.load()
    # sample center region where ring tower is
    xs = range(int(w*0.35), int(w*0.75), 4)
    ys = range(int(h*0.25), int(h*0.80), 4)
    s=[0,0,0]; cnt=0
    for y in ys:
        for x in xs:
            r,g,b = px[x,y]
            s[0]+=r; s[1]+=g; s[2]+=b; cnt+=1
    print(n, w, h, [round(v/cnt/255.0,3) for v in s])
