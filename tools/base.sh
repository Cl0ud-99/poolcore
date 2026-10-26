set -e
node tools/shot.mjs --shots hero,water,rings,vault --prefix base_ --dir shots --w 1280 --h 720 --qs "dof=0" 2>&1 | tail -3
echo DONE
