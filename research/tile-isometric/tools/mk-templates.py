"""生成用于「模板填充」实验的精确 2:1 等距菱形模板。

用途：把几何完全交给代码（保证 2:1、四条边笔直、位置精确），
让 AI 只负责「把菱形里面填成某种地貌」。
"""
from __future__ import annotations
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import save  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "tpl")


def diamond_points(cx, cy, tw, th):
    hw, hh = tw / 2.0, th / 2.0
    return [(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)]


def solid_diamond(size, tw_frac=0.8, color=(255, 0, 255, 255), ss=4):
    """画一个 2:1 菱形，超采样保证边缘干净。"""
    W = H = size
    img = Image.new("RGBA", (W * ss, H * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    tw = W * tw_frac
    th = tw / 2.0
    d.polygon(diamond_points(W * ss / 2, H * ss / 2, tw * ss, th * ss), fill=color)
    return img.resize((W, H), Image.LANCZOS)


def diamond_sheet(size, cols, rows, tw_frac=0.8, colors=None, ss=4):
    """在正方形画布上按等距网格排出 cols x rows 个互不相连的菱形。"""
    W = H = size * ss
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    tw = W * tw_frac / (cols * 0.5 + 0.5)
    tw = min(tw, H * tw_frac / (rows * 0.25 + 0.25))
    th = tw / 2
    # 等距排布：x = (c - r) * tw/2, y = (c + r) * th/2
    for r in range(rows):
        for c in range(cols):
            cx = W / 2 + (c - r) * tw / 2
            cy = H / 2 + (c + r - cols / 2 - rows / 2 + 1) * th / 2
            col = (colors[(r * cols + c) % len(colors)] if colors else (255, 0, 255, 255))
            d.polygon(diamond_points(cx, cy, tw, th), fill=col)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    # 单块洋红模板
    for size in (1024, 2048):
        for frac in (0.62, 0.8, 0.9):
            save(solid_diamond(size, frac), os.path.join(OUT, f"magenta-2to1-{size}-{int(frac*100)}.png"))
    # 单块，带明确轮廓 + 内部浅灰（提示「只填色不许改形状」）
    base = solid_diamond(1024, 0.8, (255, 0, 255, 255))
    d = ImageDraw.Draw(base)
    W = 1024
    tw = W * 0.8
    d.polygon(diamond_points(512, 512, tw, tw / 2), outline=(0, 255, 255, 255), width=6)
    save(base, os.path.join(OUT, "magenta-2to1-1024-outline.png"))

    # 2x2 四色模板
    save(diamond_sheet(1024, 2, 2, 0.8, [(255, 0, 255, 255), (255, 160, 0, 255), (0, 120, 255, 255), (0, 200, 0, 255)]),
         os.path.join(OUT, "sheet2x2-1024.png"))
    # 3x3
    save(diamond_sheet(1024, 3, 3, 0.9), os.path.join(OUT, "sheet3x3-1024.png"))
    print("wrote", sorted(os.listdir(OUT)))
