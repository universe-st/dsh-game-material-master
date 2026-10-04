"""对「完整规整管线」的末端产物做抠底方案对比。

现在的 to_sprite_cell 步骤：
  自底向上逐行找树干底 →
  边框众数色 **硬阈值**（<=66 直接 alpha=0）→ 裁 bbox →
  按 min(40/w, anchorY/h) 缩放（无 alpha 感知）→ 贴到 64x96

怀疑点：
  ① 硬阈值把模型自带的抗锯齿像素判成背景 → 产生「透明但吃进白」的边
  ② LANCZOS 把已判透明的白底数据平均进边缘 → 出现「不透明但洗白」的像素
"""
from __future__ import annotations
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fringe import analyze  # noqa: E402
from img import save  # noqa: E402
from matte_test import bg_color, dilate_mask, solidify  # noqa: E402

B13 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "b13")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "mattetest2")

CELL_W, CELL_H = 64, 96
ANCHOR_Y = 54
MAX_W = 40


def place(crop: Image.Image, anchor_y: int = ANCHOR_Y) -> Image.Image:
    out = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    left = int(round(CELL_W / 2 - crop.width / 2))
    top = anchor_y - crop.height
    out.alpha_composite(crop, (left, top))
    return out


def target_size(w: int, h: int) -> tuple[int, int]:
    k = min(MAX_W / w, ANCHOR_Y / h)
    return max(1, int(round(w * k))), max(1, int(round(h * k)))


# ── 方案 0：现状（与 prepare.py 的 to_sprite_cell 逐行一致）──────
def prep_0_baseline(src: Image.Image) -> Image.Image:
    a = np.asarray(src.convert("RGBA")).copy()
    rgb = a[:, :, :3].astype(np.int16)
    bg = bg_color(src).astype(np.int16)
    near = np.abs(rgb - bg).sum(axis=2) <= 66          # ← 硬阈值二值化
    a[near, 3] = 0                                     # ← 只改 alpha，RGB 原样保留（白被留在边缘）
    ys, xs = np.where(a[:, :, 3] > 0)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    crop = Image.fromarray(a[t:b + 1, l:r + 1])
    tw, th = target_size(crop.width, crop.height)
    # ← RGB 与 alpha 一起缩放；半透明像素的 RGB 是白，缩小时把白平均进边缘
    return place(crop.resize((tw, th), Image.LANCZOS))


# ── 方案 1：软 alpha（距离映射）+ 颜色凝固 + 分离缩放 ────────────
def prep_1_soft_bleed(src: Image.Image, rings: int = 3) -> Image.Image:
    a = np.asarray(src.convert("RGBA")).astype(np.float32)
    rgb = a[:, :, :3]
    bg = bg_color(src)
    d = np.abs(rgb - bg).sum(axis=2)
    al = np.clip((d - 30.0) / (150.0 - 30.0), 0.0, 1.0)
    mask = al > 0.5
    solid = solidify(rgb, mask, rings)
    ys, xs = np.where(al > 0.02)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    rgb_s = solid[t:b + 1, l:r + 1]
    al_s = al[t:b + 1, l:r + 1]
    tw, th = target_size(rgb_s.shape[1], rgb_s.shape[0])
    c = Image.fromarray(np.clip(rgb_s, 0, 255).astype(np.uint8), "RGB").resize((tw, th), Image.LANCZOS)
    m = Image.fromarray((al_s * 255).astype(np.uint8), "L").resize((tw, th), Image.LANCZOS)
    return place(Image.fromarray(np.dstack([np.asarray(c), np.asarray(m)]), "RGBA"))


# ── 方案 2：软 alpha + unmatte（解出真正前景色） ─────────────────
def prep_2_matte(src: Image.Image, rings: int = 3) -> Image.Image:
    a = np.asarray(src.convert("RGBA")).astype(np.float32)
    rgb = a[:, :, :3]
    bg = bg_color(src)
    d = np.abs(rgb - bg).sum(axis=2)
    al = np.clip((d - 30.0) / (150.0 - 30.0), 0.0, 1.0)
    aa = np.clip(al, 1e-3, 1.0)[:, :, None]
    F = np.clip((rgb - (1 - aa) * bg) / aa, 0, 255)
    mask = al > 0.5
    F = np.where(mask[:, :, None], F, rgb)
    F = solidify(F, mask, rings)
    ys, xs = np.where(al > 0.02)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    F = F[t:b + 1, l:r + 1]
    al_s = al[t:b + 1, l:r + 1]
    tw, th = target_size(F.shape[1], F.shape[0])
    c = Image.fromarray(np.clip(F, 0, 255).astype(np.uint8), "RGB").resize((tw, th), Image.LANCZOS)
    m = Image.fromarray((al_s * 255).astype(np.uint8), "L").resize((tw, th), Image.LANCZOS)
    return place(Image.fromarray(np.dstack([np.asarray(c), np.asarray(m)]), "RGBA"))


# ── 方案 3：在原始分辨率抠好，再「高分辨率摆放 → 最后一步缩放」 ──
def prep_3_hires_then_place(src: Image.Image) -> Image.Image:
    """不做几何缩放，先把 alpha 抠干净（高分辨率），再整体缩到目标尺寸。"""
    a = np.asarray(src.convert("RGBA")).astype(np.float32)
    rgb, bg = a[:, :, :3], bg_color(src)
    d = np.abs(rgb - bg).sum(axis=2)
    al = np.clip((d - 30.0) / (150.0 - 30.0), 0.0, 1.0)
    mask = al > 0.5
    solid = solidify(rgb, mask, 3)
    out = np.dstack([solid, al * 255])
    full = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")
    ys, xs = np.where(al > 0.02)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    crop = full.crop((l, t, r + 1, b + 1))
    tw, th = target_size(crop.width, crop.height)
    # 只缩一次，且缩的是「已凝固」的图 —— RGB 与 alpha 同缩没问题，因为背景色已被消除
    return place(crop.resize((tw, th), Image.LANCZOS))


# ── 方案 4：换背景色（不用白，用中性灰/品红）+ 软 alpha ──────────
def prep_4_bg_neutral(src: Image.Image) -> Image.Image:
    """模拟「生成时用中性灰底」：把白底像素重映射成灰，再走方案 1。"""
    a = np.asarray(src.convert("RGBA")).astype(np.float32)
    rgb, bg = a[:, :, :3], bg_color(src)
    d = np.abs(rgb - bg).sum(axis=2)
    al = np.clip((d - 30.0) / (150.0 - 30.0), 0.0, 1.0)
    # 把「背景占比高」的像素的 RGB 拉向中性灰，模拟灰底
    neutral = np.array([128.0, 128.0, 128.0])
    w = (1.0 - al)[:, :, None]
    rgb2 = rgb * (1 - w) + neutral * w
    mask = al > 0.5
    solid = solidify(rgb2, mask, 3)
    ys, xs = np.where(al > 0.02)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    rgb_s, al_s = solid[t:b + 1, l:r + 1], al[t:b + 1, l:r + 1]
    tw, th = target_size(rgb_s.shape[1], rgb_s.shape[0])
    c = Image.fromarray(np.clip(rgb_s, 0, 255).astype(np.uint8), "RGB").resize((tw, th), Image.LANCZOS)
    m = Image.fromarray((al_s * 255).astype(np.uint8), "L").resize((tw, th), Image.LANCZOS)
    return place(Image.fromarray(np.dstack([np.asarray(c), np.asarray(m)]), "RGBA"))


# ── 方案 5：绿色背景生成（研究：换底色）+ 软 alpha ───────────────
#    这里不真去生成，而是把「白底」模拟成「绿底」看抠图端的效果
def prep_5_bg_green(src: Image.Image) -> Image.Image:
    a = np.asarray(src.convert("RGBA")).astype(np.float32)
    rgb, bg = a[:, :, :3], bg_color(src)
    d = np.abs(rgb - bg).sum(axis=2)
    al = np.clip((d - 30.0) / (150.0 - 30.0), 0.0, 1.0)
    green = np.array([0.0, 200.0, 80.0])
    w = (1.0 - al)[:, :, None]
    rgb2 = rgb * (1 - w) + green * w
    mask = al > 0.5
    solid = solidify(rgb2, mask, 3)
    ys, xs = np.where(al > 0.02)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    rgb_s, al_s = solid[t:b + 1, l:r + 1], al[t:b + 1, l:r + 1]
    tw, th = target_size(rgb_s.shape[1], rgb_s.shape[0])
    c = Image.fromarray(np.clip(rgb_s, 0, 255).astype(np.uint8), "RGB").resize((tw, th), Image.LANCZOS)
    m = Image.fromarray((al_s * 255).astype(np.uint8), "L").resize((tw, th), Image.LANCZOS)
    return place(Image.fromarray(np.dstack([np.asarray(c), np.asarray(m)]), "RGBA"))


METHODS = {
    "0-baseline(现状)": prep_0_baseline,
    "1-软alpha+凝固": prep_1_soft_bleed,
    "2-unmatte": prep_2_matte,
    "3-高分辨率凝固后缩": prep_3_hires_then_place,
    "4-中性灰底+软alpha": prep_4_bg_neutral,
    "5-绿底+软alpha": prep_5_bg_green,
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    samples = ["D-treeA-white", "D-treeD-white", "D-rockA-white", "D-treeC-white", "D-treeB-white"]
    rows = []
    for s in samples:
        src = Image.open(os.path.join(B13, s + ".png")).convert("RGBA")
        for name, fn in METHODS.items():
            try:
                r = fn(src)
            except Exception as e:  # noqa: BLE001
                rows.append((s, name, None, str(e)))
                continue
            p = os.path.join(OUT, f"{s}__{name.replace('(现状)','')}.png")
            save(r, p)
            rows.append((s, name, analyze(p), None))
    print(f"{'sample':16s} {'method':22s} {'gap':>7s} {'近白':>7s} {'sat边':>6s} {'edge_n':>7s}")
    for s, name, res, err in rows:
        if err or "error" in res:
            print(f"{s:16s} {name:22s}  {(err or res.get('error'))[:40]}")
            continue
        print(f"{s:16s} {name:22s} {res['fringe_luma_gap']:+7.1f} "
              f"{res['edge_near_white_frac']:7.3f} {res['edge_sat']:6.2f} {res['edge_n']:7d}")
    print()
    for name in METHODS:
        vals = [r[2]["fringe_luma_gap"] for r in rows if r[1] == name and r[2] and "error" not in r[2]]
        nw = [r[2]["edge_near_white_frac"] for r in rows if r[1] == name and r[2] and "error" not in r[2]]
        if vals:
            print(f"{name:22s} 平均 gap={sum(vals)/len(vals):+7.1f}  平均近白占比={sum(nw)/len(nw):.3f}")
