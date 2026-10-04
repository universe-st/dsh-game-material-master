"""用连通域找棕色菱形质心（纯 numpy 实现，不依赖 scipy）。"""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import load
import numpy as np
from collections import deque

REF = r"C:\Users\kuang\Desktop\b28436693ce40fc5e9e0c415783f278b47292ef3.png"


def label4(m):
    h, w = m.shape
    lab = np.zeros((h, w), np.int32)
    cur = 0
    for y in range(h):
        for x in range(w):
            if not m[y, x] or lab[y, x]:
                continue
            cur += 1
            q = deque([(y, x)])
            lab[y, x] = cur
            while q:
                cy, cx = q.popleft()
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and lab[ny, nx] == 0:
                        lab[ny, nx] = cur
                        q.append((ny, nx))
    return lab, cur


im = load(REF)
a = np.asarray(im).astype(np.int16)
rgb, alpha = a[:, :, :3], a[:, :, 3]
d = np.abs(rgb - np.array([183, 139, 94])).sum(axis=2)
# 棕色基座（含阴影变化）比较宽
mask = (d < 150) & (alpha > 100)
# 只取上半部分（菱形基座在行的上方），用形态学闭运算连接
m = mask.copy()
h, w = m.shape
# 3x5 闭运算
def dilate(mm, k):
    out = np.zeros_like(mm)
    for dy in range(k[0]):
        for dx in range(k[1]):
            out[dy: h - (k[0] - 1 - dy), dx: w - (k[1] - 1 - dx)] |= mm[0: h - (k[0] - 1), 0: w - (k[1] - 1)]
    return out


def erode(mm, k):
    inv = ~mm
    return ~dilate(inv, k)


m = erode(dilate(m, (3, 5)), (3, 3))
lab, n = label4(m)
print("components:", n)
res = []
for i in range(1, n + 1):
    ys, xs = np.where(lab == i)
    if len(ys) < 100:
        continue
    res.append((round(float(xs.mean()), 1), round(float(ys.mean()), 1), len(ys),
                int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())))
res.sort(key=lambda p: (p[1], p[0]))
for p in res:
    print(f"centroid=({p[0]:6.1f},{p[1]:6.1f}) area={p[2]:5d} x[{p[3]:3d},{p[4]:3d}] y[{p[5]:3d},{p[6]:3d}]  w={p[4]-p[3]+1:3d} h={p[6]-p[5]+1:3d}")
print("\n间距（按 y 分行后相邻质心的 dx/dy）：")
res.sort(key=lambda p: p[1])
for i in range(1, len(res)):
    p, q = res[i - 1], res[i]
    print(f"  ({p[0]},{p[1]}) -> ({q[0]},{q[1]})  d=({q[0]-p[0]:+7.1f},{q[1]-p[1]:+7.1f})")
