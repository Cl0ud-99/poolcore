
import sys
from PIL import Image
import numpy as np
a = np.asarray(Image.open('shots/w1_hero.png').convert('RGB')).astype(np.float32)/255.0
# region of interest: top-left corner area
roi = a[0:200, 0:340]
lum = roi.mean(axis=2)
idx = np.unravel_index(np.argmin(lum), lum.shape)
print('darkest in TL', idx, roi[idx[0], idx[1]])
# print a coarse grid of colors
for y in range(10, 200, 30):
    row = []
    for x in range(10, 340, 60):
        c = a[y, x]
        row.append(f'({x},{y})={c[0]:.2f},{c[1]:.2f},{c[2]:.2f}')
    print(' '.join(row))
