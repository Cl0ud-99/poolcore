set -e
node tools/shot.mjs --shots sun,hero --prefix vb10_ --dir shots --w 960 --h 540 --qs "dof=0&gis=3.5&vold=10&vols=-1" 2>&1 | tail -3
node tools/shot.mjs --shots sun --prefix vb1_ --dir shots --w 960 --h 540 --qs "dof=0&gis=3.5&vold=1&vols=-1" 2>&1 | tail -3
echo DONE
