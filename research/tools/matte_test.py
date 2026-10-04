"""抠底/边缘处理的候选方案对比。

背景（实测）：树精灵边缘亮度比内部高 ~98、饱和度从 0.84 掉到 0.21 —— 一圈亮白边。
根因候选：
  A. 颜色键只做「阈值二值化」，模型自带的抗锯齿像素被硬判 → 边缘出现「不透明但洗白」的像素
  B. 裁 bbox 后 **无 alpha 感知** 的 LANCZOS 缩放 → 白底像素被平均进边缘
  C. 两者叠加

方案：
  0 baseline   现在的做法（阈值二值化 → 裁 bbox → LANCZOS，RGB/alpha 一起缩）
  1 solid+bleed 先「颜色凝固」（前景外扩 N 圈、用最近前景色填），再缩放；alpha 单独缩
  2 matte       估计前景色 F 与背景色 B，按 alpha 解出 F（unmatte）；再缩放
  3 bleed+matte 1 与 2 组合
"""
from __future__ import annotations
import os
import sys

import numpy as np
from PIL import Image
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fringe import analyze  # noqa: E402
from img import save  # noqa: E402

B13 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "b13")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "mattetest")


def bg_color(img: Image.Image) -> np.ndarray:
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    vals, counts = np.unique(border, axis=0, return_counts=True)
    return vals[counts.argmax()].astype(np.float64)


def soft_alpha(rgb: np.ndarray, bg: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """用「离背景色的距离」算软 alpha（0~1），而不是硬阈值。"""
    d = np.abs(rgb - bg).sum(axis=2)
    return np.clip((d - lo) / max(1e-6, hi - lo), 0.0, 1.0)


def dilate_mask(m: np.ndarray, rings: int = 1) -> np.ndarray:
    out = m.copy()
    for _ in range(rings):
        e = out.copy()
        e[1:, :] |= out[:-1, :]
        e[:-1, :] |= out[1:, :]
        e[:, 1:] |= out[:, :-1]
        e[:, :-1] |= out[:, 1:]
        e[1:, 1:] |= out[:-1, :-1]
        e[:-1, :-1] |= out[1:, 1:]
        e[1:, :-1] |= out[:-1, 1:]
        e[:-1, 1:] |= out[1:, :-1]
        out = e
    return out


def solidify(rgb: np.ndarray, mask: np.ndarray, rings: int = 3) -> np.ndarray:
    """把前景颜色往外扩散 rings 圈（最近前景色填充），得到「没有背景色」的图。"""
    h, w = mask.shape
    out = rgb.copy()
    known = mask.copy()
    frontier = list(zip(*np.where(mask)))
    for _ in range(rings):
        nxt = []
        for y, x in frontier:
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and not known[ny, nx]:
                        out[ny, nx] = out[y, x]
                        known[ny, nx] = True
                        nxt.append((ny, nx))
        frontier = nxt
        if not frontier:
            break
    return out


def box_downscale(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    return img.resize(size, Image.LANCZOS)


def method_baseline(sprite: Image.Image, target_w: int = 40) -> Image.Image:
    """现在的做法：边框众数色硬阈值 → 裁 bbox → 无 alpha 感知缩放。"""
    rgb = np.asarray(sprite.convert("RGB")).astype(np.int16)
    bg = bg_color(sprite).astype(np.int16)
    near = np.abs(rgb - bg).sum(axis=2) <= 66
    a = np.asarray(sprite.convert("RGBA")).copy()
    a[near, 3] = 0
    fg = a[:, :, 3] > 0
    ys, xs = np.where(fg)
    l, r, t, b = xs.min(), xs.max(), ys.min(), ys.max()
    crop = Image.fromarray(a[t:b + 1, l:r + 1])
    k = target_w / crop.width
    return crop.resize((target_w, max(1, round(crop.height * k))), Image.LANCZOS)


def method_solid_bleed(sprite: Image.Image, target_w: int = 40, rings: int = 3) -> Image.Image:
    """方案 1：颜色凝固（前景外扩 + 最近色填充）后才缩放；alpha 单独用高质量滤镜缩。"""
    a = np.asarray(sprite.convert("RGBA")).astype(np.float32)
    rgb = a[:, :, :3]
    bg = bg_color(sprite)
    al = soft_alpha(rgb, bg, 40.0, 130.0)
    mask = al > 0.5
    ys, xs = np.where(al > 0.1)
    if len(ys) == 0:
        raise ValueError("no sprite")
    l, r, t, b = xs.min(), xs.max(), ys.min(), ys.max()
    rgb_s = solidify(rgb, mask, rings)[t:b + 1, l:r + 1]
    al_s = al[t:b + 1, l:r + 1]
    h, w = rgb_s.shape[:2]
    k = target_w / w
    tw, th = target_w, max(1, round(h * k))
    # 颜色：用「已凝固的 RGB」放大后缩（RGB 与 alpha 分开处理是关键）
    c = Image.fromarray(np.clip(rgb_s, 0, 255).astype(np.uint8), "RGB").resize((tw, th), Image.LANCZOS)
    m = Image.fromarray((al_s * 255).astype(np.uint8), "L").resize((tw, th), Image.LANCZOS)
    out = np.dstack([np.asarray(c), np.asarray(m)])
    return Image.fromarray(out, "RGBA")


def method_matte(sprite: Image.Image, target_w: int = 40, rings: int = 3) -> Image.Image:
    """方案 2：unmatte —— 用 alpha 解出真正的前景色 F = (C − (1−a)·B) / a。"""
    a = np.asarray(sprite.convert("RGBA")).astype(np.float32)
    rgb = a[:, :, :3]
    bg = bg_color(sprite)
    al = soft_alpha(rgb, bg, 40.0, 130.0)
    ys, xs = np.where(al > 0.1)
    l, r, t, b = xs.min(), xs.max(), ys.min(), ys.max()
    aa = np.clip(al, 1e-3, 1.0)[:, :, None]
    F = np.clip((rgb - (1 - aa) * bg) / aa, 0, 255)
    mask = al > 0.5
    F = np.where(mask[:, :, None], F, rgb)          # 前景外不动
    F = solidify(F, mask, rings)                     # 再外扩，防止缩放时吃到背景
    F = F[t:b + 1, l:r + 1]
    al_s = al[t:b + 1, l:r + 1]
    h, w = F.shape[:2]
    k = target_w / w
    tw, th = target_w, max(1, round(h * k))
    c = Image.fromarray(np.clip(F, 0, 255).astype(np.uint8), "RGB").resize((tw, th), Image.LANCZOS)
    m = Image.fromarray((al_s * 255).astype(np.uint8), "L").resize((tw, th), Image.LANCZOS)
    return Image.fromarray(np.dstack([np.asarray(c), np.asarray(m)]), "RGBA")


def method_bleed_matte(sprite: Image.Image, target_w: int = 40, rings: int = 3) -> Image.Image:
    """方案 3：unmatte + 凝固 + 缩放后再做一次「alpha 阈值 + 颜色外扩」，彻底去掉半透明洗白。"""
    base = method_matte(sprite, target_w, rings)
    a = np.asarray(base).astype(np.float32)
    rgb, al = a[:, :, :3], a[:, :, 3] / 255.0
    mask = al > 0.45
    if mask.sum() == 0:
        return base
    solid = solidify(rgb, mask, 1)
    # 只在「紧贴前景」的那一圈用凝固色，避免整图变色
    ring = dilate_mask(mask, 1) & ~mask
    rgb = np.where(ring[:, :, None], solid, rgb)
    al = np.clip((al - 0.10) / 0.80, 0, 1)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255).astype(np.uint8),
                                      (al * 255).astype(np.uint8)]), "RGBA")


METHODS = {
    "0-baseline": method_baseline,
    "1-solid-bleed": method_solid_bleed,
    "2-matte": method_matte,
    "3-bleed-matte": method_bleed_matte,
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    samples = ["D-treeA-white", "D-treeD-white", "D-rockA-white", "D-treeC-white"]
    print(f"{'sample':18s} {'method':16s} {'gap':>7s} {'近白':>7s} {'sat边':>6s} {'edge_n':>7s}")
    for s in samples:
        src = Image.open(os.path.join(B13, s + ".png")).convert("RGBA")
        for name, fn in METHODS.items():
            try:
                r = fn(src)
            except Exception as e:  # noqa: BLE001
                print(f"{s:18s} {name:16s} FAIL {e}")
                continue
            p = os.path.join(OUT, f"{s}__{name}.png")
            save(r, p)
            res = analyze(p)
            if "error" in res:
                print(f"{s:18s} {name:16s} {res['error']}")
                continue
            print(f"{s:18s} {name:16s} {res['fringe_luma_gap']:+7.1f} "
                  f"{res['edge_near_white_frac']:7.3f} {res['edge_sat']:6.2f} {res['edge_n']:7d}")
        print()
