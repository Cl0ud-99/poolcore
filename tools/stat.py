import sys
from PIL import Image
import numpy as np

for p in sys.argv[1:]:
    im = Image.open(p).convert("RGB")
    a = np.asarray(im, dtype=np.float32) / 255.0
    l = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    sat = (a.max(axis=2) - a.min(axis=2)).mean()
    print("%-16s mean=%.3f p05=%.3f p25=%.3f p50=%.3f p75=%.3f p95=%.3f sat=%.3f  rgb %.3f %.3f %.3f" % (
        p.split("/")[-1].split("\\")[-1], l.mean(), np.percentile(l, 5), np.percentile(l, 25),
        np.percentile(l, 50), np.percentile(l, 75), np.percentile(l, 95), sat,
        a[..., 0].mean(), a[..., 1].mean(), a[..., 2].mean()))
