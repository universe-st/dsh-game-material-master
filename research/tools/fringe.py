"""量「边缘白边」：对一张带 alpha 的精灵，统计边缘像素的亮度与饱和度。

判据：
  fringe_luma_gap = 边缘像素平均亮度 − 内部像素平均亮度（正值 = 边缘偏白）
  fringe_ratio    = 边缘像素里「明显偏白」的占比
"""
from __future__ import annotations
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def luma(rgb: np.ndarray) -> np.ndarray:
    return 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]


def analyze(path: str, alpha_lo: int = 8, alpha_hi: int = 240, erode: int = 1) -> dict:
    img = Image.open(path).convert("RGBA")
    a = np.asarray(img).astype(np.float32)
    al = a[:, :, 3]
    solid = al >= alpha_hi
    # 内部 = solid 再腐蚀 erode 圈；边缘 = solid 减去内部，再并上半透明像素
    inner = solid.copy()
    for _ in range(erode):
        e = inner.copy()
        e[1:, :] &= inner[:-1, :]
        e[:-1, :] &= inner[1:, :]
        e[:, 1:] &= inner[:, :-1]
        e[:, :-1] &= inner[:, 1:]
        inner = e
    edge = (al > alpha_lo) & (~inner)
    if inner.sum() < 20 or edge.sum() < 20:
        return {"path": os.path.basename(path), "error": "样本太少"}
    lum = luma(a[:, :, :3])
    mx = a[:, :, :3].max(axis=2)
    mn = a[:, :, :3].min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    res = {
        "path": os.path.basename(path),
        "size": list(img.size),
        "inner_n": int(inner.sum()),
        "edge_n": int(edge.sum()),
        "inner_luma": round(float(lum[inner].mean()), 1),
        "edge_luma": round(float(lum[edge].mean()), 1),
        "fringe_luma_gap": round(float(lum[edge].mean() - lum[inner].mean()), 1),
        "inner_sat": round(float(sat[inner].mean()), 3),
        "edge_sat": round(float(sat[edge].mean()), 3),
        "edge_bright_frac": round(float((lum[edge] > lum[inner].mean() + 40).mean()), 3),
        "edge_near_white_frac": round(float(((lum[edge] > 225) & (sat[edge] < 0.12)).mean()), 3),
        "edge_semi_frac": round(float(((al[edge] > alpha_lo) & (al[edge] < alpha_hi)).mean()), 3),
    }
    return res


if __name__ == "__main__":
    for p in sys.argv[1:]:
        r = analyze(p)
        if "error" in r:
            print(f"{r['path']}: {r['error']}")
            continue
        print(f"{r['path']:28s} luma 内{r['inner_luma']:6.1f} 边{r['edge_luma']:6.1f} "
              f"gap={r['fringe_luma_gap']:+6.1f}  近白占比={r['edge_near_white_frac']:.3f} "
              f"半透明占比={r['edge_semi_frac']:.3f}  sat 内{r['inner_sat']:.2f}/边{r['edge_sat']:.2f}")
