import sys
from PIL import Image
im = Image.open('shots/m3_water.png').convert('RGB')
W,H = im.size
def avg(x0,y0,x1,y1):
    c = im.crop((x0,y0,x1,y1))
    px = list(c.getdata())
    n = len(px)
    return tuple(round(sum(p[i] for p in px)/n/255.0,3) for i in range(3))
for name,(x0,y0,x1,y1) in {
  'near_water':(300,430,660,530),
  'mid_water':(300,350,660,420),
  'far_water':(300,300,660,340),
  'tower':(430,180,540,300),
  'left_wall':(40,150,180,300),
  'ceiling':(300,20,660,90),
}.items():
    print(name, avg(x0,y0,x1,y1))
