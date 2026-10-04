"""把「大型建筑」生成图规整成 128x96 的 2x2 建筑贴图。

2x2 地块在屏幕上的范围（以 64px 单元格、菱形高 32px 计）：
  水平 128px、菱形总高 64px；建筑可以往上长高，所以贴图取 128 宽 x 96 高，
  底部 64px 是地面菱形区域，上面 32px 给屋顶。
锚点：贴图的「大菱形下顶点」= (64, 96)，即贴图底边中心。
"""
from __future__ import annotations
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import save  # noqa: E402
from prepare import foreground, robust_fit, template_diamond  # noqa: E402

OUT_W, OUT_H = 128, 96
ANCHOR = (64.0, 96.0)   # 大菱形下顶点在贴图里的位置


def measure_footprint(img: Image.Image, verbose: bool = True):
    """量出建筑/地面的大菱形：返回 (xL, xR, y_bot, y_top_est)。

    大菱形左右顶点一定在「地面」上，所以取前景下半部分 x 的极值。
    上顶点用斜率外推。
    """
    fg = foreground(img)
    ys, xs = np.where(fg)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    H = b - t + 1
    y_lo = t + int(H * 0.6)
    lx, ly, rx, ry = [], [], [], []
    for y in range(y_lo, b + 1):
        row = np.where(fg[y])[0]
        if len(row) < 6:
            continue
        lx.append(float(row.min())); ly.append(float(y))
        rx.append(float(row.max())); ry.append(float(y))
    kL, cL, resL = robust_fit(np.array(lx), np.array(ly))
    kR, cR, resR = robust_fit(np.array(rx), np.array(ry))
    y_bot = (cR - cL) / (kL - kR)
    x_bot = kL * y_bot + cL
    xL, yL = lx[int(np.argmin(lx))], ly[int(np.argmin(lx))]
    xR, yR = rx[int(np.argmax(rx))], ry[int(np.argmax(rx))]
    w2 = x_bot - xL
    h2 = y_bot - yL
    if verbose:
        print(f"  bbox=({l},{t},{r},{b}) kL={kL:.3f} kR={kR:.3f} resid=({resL:.1f},{resR:.1f})")
        print(f"  bottom=({x_bot:.0f},{y_bot:.0f}) left=({xL:.0f},{yL:.0f}) right=({xR:.0f},{yR:.0f}) "
              f"w2={w2:.0f} h2={h2:.0f} ratio={w2/max(1,h2):.3f}")
    return dict(bbox=(l, t, r, b), x_bot=x_bot, y_bot=y_bot, xL=xL, xR=xR, w2=w2, h2=h2,
                k=(abs(kL) + abs(kR)) / 2, resid=max(resL, resR))


def to_building(img: Image.Image, mode: str = "bbox", verbose: bool = True) -> tuple[Image.Image, dict]:
    """三种规整方式：

    bbox      —— 按紧致包围盒缩放，让建筑总宽 = 128（最稳，适合「底面贴满 4 格」的生成）
    template  —— 直接用代码给的 t2x2-2048 模板几何
    measured  —— 量出地面菱形的两条下边再规整
    """
    if mode == "template":
        t = template_diamond(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                                          "probe", "tpl", "t2x2-2048.png"))
        w2, h2 = t["w"] / 2.0, t["h"] / 2.0
        cx, y_bot = t["cx"], float(t["b"]) + 1.0
        sx = 64.0 / w2
        sy = 32.0 / h2
        rep = {"mode": "template", "scale": [round(sx, 4), round(sy, 4)]}
    elif mode == "measured":
        m = measure_footprint(img, verbose=verbose)
        w2, h2 = m["w2"], m["h2"]
        cx, y_bot = (m["xL"] + m["xR"]) / 2.0, m["y_bot"]
        sx = 64.0 / w2
        sy = 32.0 / max(1.0, h2)
        rep = {"mode": "measured", "ratio_measured": round(w2 / max(1.0, h2), 3), "resid": round(m["resid"], 1),
               "scale": [round(sx, 4), round(sy, 4)]}
    else:
        fg = foreground(img)
        ys, xs = np.where(fg)
        l, r = int(xs.min()), int(xs.max())
        t, b = int(ys.min()), int(ys.max())
        # 按「宽 ≤128 且 高 ≤88」等比缩放（88 = 96 - 8 顶部留白）
        sx = sy = min(128.0 / (r - l + 1), 88.0 / (b - t + 1))
        cx, y_bot = (l + r) / 2.0, float(b) + 1.0
        rep = {"mode": "bbox", "bbox": [l, t, r, b], "bbox_wh": [r - l + 1, b - t + 1],
               "scaled_wh": [round((r - l + 1) * sx, 1), round((b - t + 1) * sy, 1)],
               "scale": [round(sx, 4), round(sy, 4)]}
    # 源图取样点：x_src = x_out/sx + (cx - 64/sx)   y_src = y_out/sy + (y_bot - 96/sy)
    out = img.transform(
        (OUT_W, OUT_H), Image.AFFINE,
        (1 / sx, 0, cx - ANCHOR[0] / sx, 0, 1 / sy, y_bot - ANCHOR[1] / sy),
        resample=Image.BICUBIC,
    )
    return out, rep


if __name__ == "__main__":
    src = sys.argv[1]
    dst = sys.argv[2]
    mode = sys.argv[3] if len(sys.argv) > 3 else "bbox"
    img = Image.open(src).convert("RGBA")
    out, rep = to_building(img, mode=mode)
    save(out, dst)
    print(f"{src} -> {dst}  {rep}")
