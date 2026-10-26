set -e
for v in 0.3 1.5 4.0; do
  node tools/shot.mjs --shots hero,sun --prefix "vd$v" --dir shots --w 960 --h 540 --qs "dof=0&vold=$v" 2>&1 | tail -1 >/dev/null
done
echo DONE
