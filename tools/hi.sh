set -e
node tools/shot.mjs --shots rings,hero --prefix hi_ --dir shots --w 1920 --h 1080 --qs "dof=0&vold=1.5" 2>&1 | tail -6
echo DONE
