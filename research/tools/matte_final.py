"""三个候选修法，都在像素级实现，量「合成后观测到的边缘」。

根因（已用数据确认）：
  · 源图没有白边（中间调像素腐蚀 2 次后只剩 13 px）
  · 树冠边缘源窗口 ᾱ=0.56、C̄=(114,140,122) —— 1369 个源像素的平均，
    其中 44% 是白底。这一格的「平均色」天生偏亮。
  · 现状把它当**完全不透明**输出 → 就是那圈可见的亮描边。

三个候选：
  A interior-fill   α < 阈值 的像素，RGB 直接换成最近的前景色
                    （等于承认「这一格的颜色不可信，用邻居的颜色」）
  B premult-blend   α 与 RGB 都用 premultiplied 方式处理，输出保持软 alpha
  C hard-cut        现行做法（对照组）

判据：把结果合成到**草地**上，量剪影外沿 1 圈的 RGB 与「纯叶子色」的距离。
      越接近叶子色 = 越不像白边。同时不能把剪影缩小（面积要保住）。
"""
from __future__ import annotations
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import save  # noqa: E402
from prepare import border_bg_color, foreground, solid_bleed  # noqa: E402

B13 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "b13")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "mattetest5")
GRASS = (124, 176, 66, 255)
W_TARGET, H_MAX, ANCHOR = 40.0, 54.0, 54


def alpha_soft(rgb, bg, lo=40.0, hi=190.0):
    d = np.abs(rgb - bg).sum(axis=2)
    return np.clip((d - lo) / (hi - lo), 0.0, 1.0)


def to_cell(rgb_c, al_c, w, h):
    k = min(W_TARGET / w, H_MAX / h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    c = Image.fromarray(np.clip(rgb_c, 0, 255).astype(np.uint8), "RGB").resize((nw, nh), Image.LANCZOS)
    m = Image.fromarray((np.clip(al_c, 0, 1) * 255).astype(np.uint8), "L").resize((nw, nh), Image.LANCZOS)
    crop = Image.fromarray(np.dstack([np.asarray(c), np.asarray(m)]), "RGBA")
    out = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    out.alpha_composite(crop, (round(32 - nw / 2), ANCHOR - nh))
    return out


def variant_C_hardcut(src: Image.Image, cut: float = 0.5):
    """C：软 alpha，但低于阈值直接丢弃，RGB 原样（现行做法的等价物）。"""
    full = np.asarray(src.convert("RGBA")).astype(np.float32)
    bg = border_bg_color(full[:, :, :3])
    fg = foreground(src); ys, xs = np.where(fg)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    rgb = full[:, :, :3][t:b + 1, l:r + 1]
    al = alpha_soft(rgb, bg)[t:b + 1, l:r + 1]
    al = np.where(al >= cut, 1.0, 0.0)
    return to_cell(rgb, al, r - l + 1, b - t + 1)


def variant_B_premult(src: Image.Image):
    """B：un-premultiply + 颜色凝固，保留软 alpha。"""
    full = np.asarray(src.convert("RGBA")).astype(np.float32)
    bg = border_bg_color(full[:, :, :3])
    fg = foreground(src); ys, xs = np.where(fg)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    rgb = full[:, :, :3]
    al = alpha_soft(rgb, bg)
    use = al >= 0.02
    aa = np.clip(al, 0.02, 1.0)[:, :, None]
    unmat = np.clip((rgb - (1 - aa) * bg) / aa, 0, 255)
    rgb_u = np.where(use[:, :, None], unmat, rgb)
    mask = al > 0.5
    if mask.sum():
        rgb_u = solid_bleed(rgb_u, mask, rings=3)
    return to_cell(rgb_u[t:b + 1, l:r + 1], al[t:b + 1, l:r + 1], r - l + 1, b - t + 1)


def variant_A_interior(src: Image.Image, thresh: float = 0.75):
    """A：α 低于阈值的像素，RGB 换成最近的前景色（承认这一格颜色不可信）。"""
    full = np.asarray(src.convert("RGBA")).astype(np.float32)
    bg = border_bg_color(full[:, :, :3])
    fg = foreground(src); ys, xs = np.where(fg)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    rgb = full[:, :, :3]
    al = alpha_soft(rgb, bg)
    mask = al >= thresh
    if mask.sum() == 0:
        raise ValueError("阈值过高，没有可信前景")
    rgb_f = solid_bleed(rgb, mask, rings=4)      # 只用可信像素做种
    return to_cell(rgb_f[t:b + 1, l:r + 1], al[t:b + 1, l:r + 1], r - l + 1, b - t + 1)


def observed_edge(cell: Image.Image, bg=GRASS):
    """把 cell 合成到草地上，量剪影外沿 1 圈的亮度/饱和度。"""
    c = Image.new("RGBA", cell.size, bg)
    c.alpha_composite(cell)
    a = np.asarray(c.convert("RGB")).astype(np.float32)
    al = np.asarray(cell)[:, :, 3]
    solid = al >= 140
    grown = solid.copy()
    e = grown.copy()
    e[1:, :] |= grown[:-1, :]; e[:-1, :] |= grown[1:, :]
    e[:, 1:] |= grown[:, :-1]; e[:, :-1] |= grown[:, 1:]
    ring = e & ~solid
    inner = solid.copy()
    for _ in range(3):
        f = inner.copy()
        f[1:, :] &= inner[:-1, :]; f[:-1, :] &= inner[1:, :]
        f[:, 1:] &= inner[:, :-1]; f[:, :-1] &= inner[:, 1:]
        inner = f
    if ring.sum() < 10 or inner.sum() < 10:
        return None
    lum = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    return {
        "ring_lum": round(float(lum[ring].mean()), 1),
        "inner_lum": round(float(lum[inner].mean()), 1),
        "gap": round(float(lum[ring].mean() - lum[inner].mean()), 1),
        "ring_sat": round(float(sat[ring].mean()), 3),
        "core_px": int(solid.sum()),
    }


VARIANTS = {"A-interior-fill": variant_A_interior, "B-premult": variant_B_premult,
            "C-hardcut": variant_C_hardcut}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(f"{'sample':16s} {'variant':18s} {'外沿亮度':>8s} {'内部亮度':>8s} {'gap':>7s} {'sat':>6s} {'剪影px':>7s}")
    for name in ["D-treeA-white", "D-treeB-white", "D-treeC-white", "D-treeD-white", "D-rockA-white"]:
        src = Image.open(os.path.join(B13, name + ".png")).convert("RGBA")
        for vn, fn in VARIANTS.items():
            try:
                cell = fn(src)
            except Exception as ex:  # noqa: BLE001
                print(f"{name:16s} {vn:18s} FAIL {ex}")
                continue
            save(cell.resize((128, 192), Image.LANCZOS), os.path.join(OUT, f"{name}__{vn}.png"))
            m = observed_edge(cell)
            if m is None:
                print(f"{name:16s} {vn:18s} 样本太少")
                continue
            print(f"{name:16s} {vn:18s} {m['ring_lum']:8.1f} {m['inner_lum']:8.1f} "
                  f"{m['gap']:+7.1f} {m['ring_sat']:6.2f} {m['core_px']:7d}")
        print()
