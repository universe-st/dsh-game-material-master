"""测量参考图的等距网格：找棕色菱形质心的行/列间距。"""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import load  # noqa
import numpy as np

REF = r"C:\Users\kuang\Desktop\b28436693ce40fc5e9e0c415783f278b47292ef3.png"

im = load(REF)
a = np.asarray(im).astype(np.int16)
rgb = a[:, :, :3]
alpha = a[:, :, 3]

# 「棕土」掩码：接近 (183,139,94)
d = np.abs(rgb - np.array([183, 139, 94])).sum(axis=2)
mask = (d < 90) & (alpha > 128)
print("brown px:", mask.sum())

# 逐行统计棕色像素数，找周期性
rowsum = mask.sum(axis=1).astype(float)
colsum = mask.sum(axis=0).astype(float)
# 自相关找周期
def period(sig, lo=8, hi=100):
    s = sig - sig.mean()
    best = []
    for lag in range(lo, hi):
        v = float(np.dot(s[:-lag], s[lag:]) / max(1, len(s) - lag))
        best.append((v, lag))
    best.sort(reverse=True)
    return best[:6]

print("row period candidates:", [(round(v, 1), l) for v, l in period(rowsum)])
print("col period candidates:", [(round(v, 1), l) for v, l in period(colsum)])

# 打印棕色像素的行分布峰值
def peaks(sig, thresh_ratio=0.6):
    t = sig.max() * thresh_ratio
    out, run = [], None
    for i, v in enumerate(sig):
        if v >= t and run is None:
            run = i
        elif v < t and run is not None:
            out.append((run, i - 1, round(float(sig[run:i].max()), 1)))
            run = None
    return out

print("\nrow peaks:", peaks(rowsum))
print("\ncol peaks:", peaks(colsum))

# 找每个棕色菱形的连通区域质心（粗略：用网格切分）
# 先看第一行第一个菱形：扫左上角区域
print("\ntop-left 40x40 has brown?", mask[:40, :40].sum())
# 输出棕色掩码的 ASCII 缩略
h, w = mask.shape
step = 4
print("\nbrown mask ascii (每格 4px, 竖轴 step=4):")
for y in range(0, h, step):
    line = "".join("#" if mask[y:y+step, x:x+step].sum() > step*step*0.5 else ("+" if mask[y:y+step, x:x+step].sum() > 0 else ".") for x in range(0, w, step))
    print(f"{y:3d} {line}")
