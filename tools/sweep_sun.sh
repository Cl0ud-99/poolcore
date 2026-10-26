set -e
for d in "-0.20,0.94,0.28" "-0.30,0.90,0.32" "-0.10,0.98,0.16" "-0.40,0.86,0.32"; do
  tag=$(echo $d | tr ',' '_' | tr -d '-')
  node tools/shot.mjs --shots hero,rings --prefix "sd$tag" --dir shots --w 960 --h 540 --qs "dof=0&sundir=$d" 2>&1 | grep -o '"perf":[^}]*}' | head -1
done
echo DONE
