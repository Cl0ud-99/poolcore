import sys
from PIL import Image

names = sys.argv[1:]
box = (940, 20, 1240, 200)   # strictly inside the vault surface
tiles = []
for n in names:
    im = Image.open(n).convert('RGB').crop(box).resize((300, 180))
    tiles.append((n, im))

cols = 3
rows = (len(tiles) + cols - 1) // cols
out = Image.new('RGB', (300*cols, 180*rows), (0,0,0))
for i,(n,im) in enumerate(tiles):
    out.paste(im, ((i%cols)*300, (i//cols)*180))
out.save('shots/montage.png')
print('rows', rows)
for n,_ in tiles:
    im = Image.open(n).convert('RGB').crop(box)
    px = list(im.getdata())
    lum = [0.2126*p[0]+0.7152*p[1]+0.0722*p[2] for p in px]
    m = sum(lum)/len(lum)
    sd = (sum((v-m)**2 for v in lum)/len(lum))**0.5
    print(f"{n:22s} mean={m:6.1f} std={sd:5.2f}")
