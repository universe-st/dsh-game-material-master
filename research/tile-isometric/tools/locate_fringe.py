"""定位「白边像素到底来自哪里」：源图 vs 抠底 vs 缩放 vs 摆放。"""
from __future__ import annotations
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prepare import border_bg_color, matte_foreground, solid_bleed  # noqa: E402

B13 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "b13")
NAME = "D-treeA-white"


def stats(rgb: np.ndarray, alpha: np.ndarray, label: str):
    """统计前景内「浅色」像素占比（浅 = min(RGB) >= 170 且低饱和）。"""
    m = alpha > 0.5
    if m.sum() == 0:
        print(f"  {label}: 无前景")
        return
    mn = rgb[:, :, :3].min(axis=2)
    mx = rgb[:, :, :3].max(axis=2)
    pale = m & (mn >= 170) & ((mx - mn) <= 40)
    print(f"  {label}: 前景 {int(m.sum()):8d} px，其中浅色 {int(pale.sum()):7d} "
          f"({float(pale.sum())/m.sum()*100:5.2f}%)，前景平均亮度 "
          f"{float((0.299*rgb[:,:,0]+0.587*rgb[:,:,1]+0.114*rgb[:,:,2])[m].mean()):6.1f}")


if __name__ == "__main__":
    src = Image.open(os.path.join(B13, NAME + ".png")).convert("RGBA")
    full = np.asarray(src).astype(np.float32)
    rgb0, a0 = full[:, :, :3], full[:, :, 3] / 255.0
    print(f"{NAME}  尺寸 {src.size}")
    stats(rgb0, a0, "① 源图（alpha 全 255 时按全前景算）")

    bg = border_bg_color(rgb0)
    print(f"  背景色 {bg}")
    dist = np.abs(rgb0 - bg).sum(axis=2)
    for lo, hi in [(40, 190), (0, 150), (60, 220)]:
        al = np.clip((dist - lo) / (hi - lo), 0, 1)
        keep = al > 0.5
        mn = rgb0.min(axis=2)
        pale = keep & (mn >= 170)
        print(f"  lo={lo:3d} hi={hi:3d}: 前景 {int(keep.sum()):8d}，浅色(minRGB>=170) "
              f"{int(pale.sum()):7d} ({float(pale.sum())/max(1,keep.sum())*100:5.2f}%)")

    # 现在看：源图里「对象边界」上那些浅像素 —— 它们本来就在吗？
    obj = dist > 120
    ys, xs = np.where(obj)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    print(f"  对象 bbox ({l},{t})-({r},{b})  {r-l+1}x{b-t+1}")
    # 对象内、且「属于对象」的最外圈
    inner = obj.copy()
    for _ in range(2):
        e = inner.copy()
        e[1:, :] &= inner[:-1, :]; e[:-1, :] &= inner[1:, :]
        e[:, 1:] &= inner[:, :-1]; e[:, :-1] &= inner[:, 1:]
        inner = e
    ring = obj & ~inner
    mn = rgb0.min(axis=2)
    print(f"  对象最外 2 圈：{int(ring.sum())} px，平均 RGB "
          f"{[int(v) for v in rgb0[ring].mean(axis=0)]}，"
          f"minRGB>=170 占比 {float((mn[ring]>=170).mean()):.3f}")
