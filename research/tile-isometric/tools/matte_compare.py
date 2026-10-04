"""抠边修复的前后对比：在**真实交付产物**上量边缘白边。

对照对象是同一套接口：
  old = to_sprite_cell(matte=False)  → 硬阈值抠底 + RGB/alpha 一起缩（修复前的行为）
  new = to_sprite_cell(matte=True)   → 软 alpha + unmatte + 颜色凝固 + 分离缩放

指标（都在 2 倍交付尺寸上量，即最终会被看到的那一级）：
  gap              边缘平均亮度 − 内部平均亮度（正 = 边缘偏白）
  minRGB>=200 占比  边缘像素里「三通道最小值都 >= 200」的比例（= 明显洗白的像素）
  sat 边/内         边缘与内部的平均饱和度（白边会把饱和度拉垮）
  semi              半透明像素占非透明像素的比例（软边是否保住）
"""
from __future__ import annotations
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import save  # noqa: E402
from prepare import to_sprite_cell  # noqa: E402

B13 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "b13")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "mattetest3")
SAMPLES = ["D-treeA-white", "D-treeB-white", "D-treeC-white", "D-treeD-white", "D-rockA-white"]


def metrics(path: str) -> dict:
    """在 2 倍交付尺寸（128x192）上量边缘。"""
    im = Image.open(path).convert("RGBA")
    if im.width < 100:
        im = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
    a = np.asarray(im).astype(np.float32)
    al = a[:, :, 3]
    lum = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    mx, mn = a[:, :, :3].max(axis=2), a[:, :, :3].min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-6)

    edge_l, inner_l, edge_minrgb, edge_sat, inner_sat = [], [], [], [], []
    for y in range(a.shape[0]):
        on = np.where(al[y] > 8)[0]
        if len(on) < 16:
            continue
        for x in (on.min(), on.min() + 1, on.max() - 1, on.max()):
            edge_l.append(lum[y, x]); edge_minrgb.append(mn[y, x]); edge_sat.append(sat[y, x])
        for x in range(on.min() + 5, on.max() - 4):
            inner_l.append(lum[y, x]); inner_sat.append(sat[y, x])
    e_min = np.array(edge_minrgb)
    on_px = al > 8
    return {
        "gap": round(float(np.mean(edge_l) - np.mean(inner_l)), 1),
        "edge_bright": round(float((e_min >= 200).mean()), 3),
        "sat_edge": round(float(np.mean(edge_sat)), 3),
        "sat_inner": round(float(np.mean(inner_sat)), 3),
        "semi": round(float(((al > 8) & (al < 248)).sum() / max(1, on_px.sum())), 3),
    }


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(f"{'sample':20s} {'路线':6s} {'gap':>7s} {'边缘洗白占比':>12s} {'sat边':>6s} {'sat内':>6s} {'软边':>6s}")
    agg = {"old": [], "new": []}
    for s in SAMPLES:
        src = Image.open(os.path.join(B13, s + ".png")).convert("RGBA")
        for tag, matte in (("old", False), ("new", True)):
            cell, rep = to_sprite_cell(src, matte=matte)
            big = cell.resize((128, 192), Image.NEAREST)
            p = os.path.join(OUT, f"{s}__{tag}.png")
            save(big, p)
            m = metrics(p)
            agg[tag].append(m)
            print(f"{s:20s} {tag:6s} {m['gap']:+7.1f} {m['edge_bright']:12.3f} "
                  f"{m['sat_edge']:6.2f} {m['sat_inner']:6.2f} {m['semi']:6.3f}")
        print()
    print("── 平均 ──")
    for tag in ("old", "new"):
        ms = agg[tag]
        print(f"{tag:4s} gap={np.mean([m['gap'] for m in ms]):+7.1f}  "
              f"边缘洗白={np.mean([m['edge_bright'] for m in ms]):.3f}  "
              f"sat边={np.mean([m['sat_edge'] for m in ms]):.2f}  "
              f"软边={np.mean([m['semi'] for m in ms]):.3f}")
