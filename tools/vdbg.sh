set -e
node tools/shot.mjs --shots sun --prefix vdbg3_ --dir shots --w 960 --h 540 --qs "dof=0&vols=-1&vdbg=4" 2>&1 | tail -2
node tools/shot.mjs --shots sun --prefix vdbg5_ --dir shots --w 960 --h 540 --qs "dof=0&vols=-1&vdbg=5" 2>&1 | tail -2
echo DONE
