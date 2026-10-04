"""在**已知真值**的合成图上定标 unmatte 与 alpha 映射。

构造：取一张真实精灵的前景（已抠好）当 F_true，在纯白底上按已知 alpha 合成：
    C = a·F_true + (1−a)·B
然后让候选算法从 C 反推 (F̂, â)，与真值比：
    color_err  前景色平均绝对误差（只在 a_true > 0.3 的像素上算）
    alpha_err  alpha 平均绝对误差
    bg_leak    a_true == 0 的像素里，被误判成 â > 0.2 的比例（= 白底没抠掉）
"""
from __future__ import annotations
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import save  # noqa: E402

B13 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "b13")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "mattetest4")


def true_foreground(path: str, bg=np.array([255.0, 255.0, 255.0])):
    """从一张白底图里取「近似真值」前景：用很紧的阈值，只保留明显远离白的像素。"""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    dist = np.abs(a - bg).sum(axis=2)
    keep = dist > 120
    return a, keep


def synthesize(rgb_true, keep, alpha_true, bg):
    """在 bg 上按 alpha_true 合成；背景区的 RGB 就是 bg（模拟生成图的真实状态）。"""
    out = rgb_true * alpha_true[:, :, None] + bg * (1 - alpha_true[:, :, None])
    out[~keep] = bg
    return np.clip(out, 0, 255)


def soft_alpha_dist(rgb, bg, lo, hi):
    d = np.abs(rgb - bg).sum(axis=2)
    return np.clip((d - lo) / max(1e-6, hi - lo), 0.0, 1.0)


def unmatte(rgb, bg, alpha, always: bool):
    aa = np.clip(alpha, 1e-3, 1.0)[:, :, None]
    F = np.clip((rgb - (1 - aa) * bg) / aa, 0, 255)
    if always:
        return F
    solid = (alpha >= 0.999)[:, :, None]
    return np.where(solid, rgb, F)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    bg = np.array([255.0, 255.0, 255.0])

    # 用两张真实精灵合成测试集
    cases = []
    for name in ["D-treeA-white", "D-rockA-white", "D-treeD-white"]:
        rgb_src, keep = true_foreground(os.path.join(B13, name + ".png"))
        # 造一个「软边」的真值 alpha：对 keep 做一点模糊当抗锯齿
        m = Image.fromarray((keep * 255).astype(np.uint8), "L").filter(
            __import__("PIL.ImageFilter", fromlist=["ImageFilter"]).GaussianBlur(2.0))
        alpha_true = np.asarray(m).astype(np.float32) / 255.0
        rgb_true = np.asarray(Image.open(os.path.join(B13, name + ".png")).convert("RGB")).astype(np.float32)
        cases.append((name, rgb_true, keep, alpha_true))

    print(f"{'case':16s} {'lo':>5s} {'hi':>5s} {'unmatte':>8s} {'color_err':>10s} {'alpha_err':>10s} {'bg_leak':>8s}")
    best = None
    for name, rgb_true, keep, alpha_true in cases:
        C = synthesize(rgb_true, keep, alpha_true, bg)
        for lo, hi in [(0, 90), (0, 150), (12, 120), (20, 200), (0, 255)]:
            for always in (True, False):
                al = soft_alpha_dist(C, bg, lo, hi)
                F = unmatte(C, bg, al, always)
                sel = alpha_true > 0.3
                cerr = float(np.abs(F[sel] - rgb_true[sel]).mean())
                aerr = float(np.abs(al - alpha_true).mean())
                leak = float((al[alpha_true < 0.01] > 0.2).mean())
                print(f"{name:16s} {lo:5d} {hi:5d} {str(always):>8s} {cerr:10.2f} {aerr:10.4f} {leak:8.4f}")
        print()
