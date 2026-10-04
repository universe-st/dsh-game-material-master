"""抠边质量的最终判据 —— 量「观测到的边缘」，而不是抠图掩码的统计学。

之前两版指标都量错了对象：
  · 第一版把「半透明像素」也算进边缘 → 半透明本来就是该有的，被误判成白边
  · 第二版没做 alpha 合成 → 半透明像素的 RGB（其实不可见）被当成可见颜色

现在改为：把精灵合成到**实际会用到的背景**上，再量紧贴剪影外沿那一圈的亮度。
剪影没有半透明像素（阈值 0.55），所以「一圈」是确定的。
"""
from __future__ import annotations
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import save  # noqa: E402

# 实际背景：地图上的草地（这是用户看到精灵时真正的底）
GRASS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "tiles", "grass.png")


def composite_over(img: Image.Image, bg_color) -> Image.Image:
    c = Image.new("RGBA", img.size, bg_color)
    c.alpha_composite(img.convert("RGBA"))
    return c.convert("RGB")


def outer_ring(alpha: np.ndarray, cut: int = 140, width: int = 2) -> np.ndarray:
    """剪影（alpha >= cut）外沿往外 width 圈。"""
    solid = alpha >= cut
    grown = solid.copy()
    for _ in range(width):
        e = grown.copy()
        e[1:, :] |= grown[:-1, :]; e[:-1, :] |= grown[1:, :]
        e[:, 1:] |= grown[:, :-1]; e[:, :-1] |= grown[:, 1:]
        e[1:, 1:] |= grown[:-1, :-1]; e[:-1, :-1] |= grown[1:, 1:]
        e[1:, :-1] |= grown[:-1, 1:]; e[:-1, 1:] |= grown[1:, :-1]
        grown = e
    return grown & ~solid


def metric(sprite_path: str, bg_color=(255, 255, 255, 255)) -> dict:
    sp = Image.open(sprite_path).convert("RGBA")
    a = np.asarray(sp)
    alpha = a[:, :, 3].astype(np.float32)
    solid = alpha >= 140
    if solid.sum() < 40:
        return {"error": "前景太少"}
    ring = outer_ring(alpha)
    ring_in = solid & ~outer_ring(alpha, cut=140, width=-2 if False else 1) if False else solid

    comp = np.asarray(composite_over(sp, bg_color)).astype(np.float32)
    lum = 0.299 * comp[:, :, 0] + 0.587 * comp[:, :, 1] + 0.114 * comp[:, :, 2]
    mn = comp.min(axis=2)
    mx = comp.max(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-6)

    # 剪影内部（去掉最外 2 圈，避开天然的抗锯齿边缘）
    inner = solid.copy()
    for _ in range(3):
        e = inner.copy()
        e[1:, :] &= inner[:-1, :]; e[:-1, :] &= inner[1:, :]
        e[:, 1:] &= inner[:, :-1]; e[:, :-1] &= inner[:, 1:]
        inner = e

    # 关键：以「背景亮度」为参照。精灵边缘接近背景 = 白边/糊边
    bg_lum = float(0.299 * bg_color[0] + 0.587 * bg_color[1] + 0.114 * bg_color[2])
    return {
        "ring_n": int(ring.sum()),
        "ring_lum": round(float(lum[ring].mean()), 1),
        "inner_lum": round(float(lum[inner].mean()), 1),
        "ring_gap": round(float(lum[ring].mean() - lum[inner].mean()), 1),
        "ring_to_bg": round(float(lum[ring].mean() - bg_lum), 1),
        "ring_white_frac": round(float((mn[ring] >= 200).mean()), 3),
        "ring_sat": round(float(sat[ring].mean()), 3),
        "inner_sat": round(float(sat[inner].mean()), 3),
        "semi_frac": round(float(((alpha > 12) & (alpha < 243)).sum() / max(1, (alpha > 12).sum())), 3),
    }


if __name__ == "__main__":
    for p in sys.argv[1:]:
        for label, bg in (("白底", (255, 255, 255, 255)), ("草地", (124, 176, 66, 255))):
            m = metric(p, bg)
            if "error" in m:
                print(f"{os.path.basename(p):34s} {label} {m['error']}")
                continue
            print(f"{os.path.basename(p):34s} {label}  外沿亮度{m['ring_lum']:6.1f} "
                  f"内部{m['inner_lum']:6.1f} 与背景差{m['ring_to_bg']:+7.1f} "
                  f"近白占比{m['ring_white_frac']:.3f} sat {m['ring_sat']:.2f}/{m['inner_sat']:.2f} "
                  f"软边{m['semi_frac']:.3f}")
