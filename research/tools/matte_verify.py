"""抠边修复的验收：对照「现状（硬阈值）」与「修复后（软 alpha + 可信色填充）」。

关键指标（都是实测出来的、能直接对应肉眼看到的白边）：
  opaque_white   alpha>200 且 min(RGB)>=220 的像素数 —— **就是那圈白边**（现状 184，修复后应为 0）
  levels         alpha 的不同取值个数（1 = 全硬边；越大说明抗锯齿被保住）
  semi_frac      半透明像素占非透明像素的比例
  color_sat      非透明像素的平均饱和度（白边会把饱和度拉低）
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
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "matte-verify")
SAMPLES = ["D-treeA-white", "D-treeB-white", "D-treeC-white", "D-treeD-white", "D-rockA-white"]


def stats(cell: Image.Image) -> dict:
    a = np.asarray(cell).astype(np.int16)
    al = a[:, :, 3]
    on = al > 0
    mx, mn = a[:, :, :3].max(axis=2), a[:, :, :3].min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    return {
        "opaque_white": int(((al > 200) & (mn >= 220)).sum()),
        "levels": int(len(np.unique(al))),
        "semi_frac": round(float(((al > 12) & (al < 243)).sum() / max(1, on.sum())), 3),
        "color_sat": round(float(sat[on].mean()), 3),
        "on": int(on.sum()),
    }


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(f"{'sample':16s} {'路线':5s} {'不透明px':>8s} {'★近白不透明':>11s} {'alpha档位':>9s} "
          f"{'软边占比':>8s} {'平均饱和':>8s}")
    tot = {"old": 0, "new": 0}
    for name in SAMPLES:
        src = Image.open(os.path.join(B13, name + ".png")).convert("RGBA")
        for tag, matte in (("old", False), ("new", True)):
            cell, _ = to_sprite_cell(src, matte=matte)
            save(cell.resize((128, 192), Image.LANCZOS), os.path.join(OUT, f"{name}__{tag}.png"))
            s = stats(cell)
            tot[tag] += s["opaque_white"]
            print(f"{name:16s} {tag:5s} {s['on']:8d} {s['opaque_white']:11d} {s['levels']:9d} "
                  f"{s['semi_frac']:8.3f} {s['color_sat']:8.3f}")
        print()
    print(f"→ 近白不透明像素总数： old={tot['old']}  new={tot['new']}")
