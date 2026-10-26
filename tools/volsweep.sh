set -e
for v in 0.3 3 10 25; do
  node tools/shot.mjs --shots sun --prefix vg$v\_ --dir shots --w 960 --h 540 --qs "dof=0&gis=3.5&vold=$v" 2>&1 | tail -2
done
echo DONE
