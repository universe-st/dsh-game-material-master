"""按扫描线找菱形顶点：确定单块菱形尺寸与网格间距。"""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import load
import numpy as np

REF = r"C:\Users\kuang\Desktop\b28436693ce40fc5e9e0c415783f278b47292ef3.png"
im = load(REF)
a = np.asarray(im).astype(np.int16)
rgb, alpha = a[:, :, :3], a[:, :, 3]
d = np.abs(rgb - np.array([183, 139, 94])).sum(axis=2)
mask = (d < 150) & (alpha > 100)
print("color at some probes:")
for (y, x) in [(16, 32), (16, 96), (16, 160), (16, 224), (0, 32), (62, 32), (63, 32)]:
    print(f"  ({x},{y}) = {tuple(rgb[y, x])} a={alpha[y, x]}")


def runs(row):
    out, run = [], None
    for i, v in enumerate(row):
        if v and run is None:
            run = i
        elif not v and run is not None:
            out.append((run, i - 1))
            run = None
    if run is not None:
        out.append((run, len(row) - 1))
    return out


for y in [0, 2, 4, 8, 12, 16, 20, 24, 28, 30, 32, 40, 48, 56, 62]:
    r = runs(mask[y])
    print(f"y={y:3d} runs={r}")
