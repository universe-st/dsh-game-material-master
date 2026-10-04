"""研究用图像工具：PNG 解码/编码、调色板统计、接触表、网格拼图、几何测量。

统一用 RGBA + Pillow，避免在 Node 里手写解码器。
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections import Counter

from PIL import Image, ImageDraw


def load(path: str) -> Image.Image:
    return Image.open(path).convert("RGBA")


def save(img: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    img.save(path)


def to_rgb(img: Image.Image, bg=(255, 255, 255, 255)) -> Image.Image:
    canvas = Image.new("RGBA", img.size, bg)
    canvas.alpha_composite(img)
    return canvas.convert("RGB")


def color_count(img: Image.Image, ignore_alpha_below: int = 8) -> int:
    px = img.convert("RGBA").getdata()
    seen = set()
    for r, g, b, a in px:
        if a >= ignore_alpha_below:
            seen.add((r, g, b))
    return len(seen)


def top_colors(img: Image.Image, n: int = 12, ignore_alpha_below: int = 8):
    px = img.convert("RGBA").getdata()
    c = Counter()
    for r, g, b, a in px:
        if a >= ignore_alpha_below:
            c[(r, g, b)] += 1
    return c.most_common(n)


def bbox_alpha(img: Image.Image, threshold: int = 8):
    """返回非透明像素的紧致包围盒 (l, t, r, b)。"""
    alpha = img.convert("RGBA").split()[3]
    bb = alpha.point(lambda v: 255 if v >= threshold else 0).getbbox()
    return bb


def contact_sheet(paths, out: str, cols: int = 4, cell: int = 320, labels=None, pad: int = 8):
    """把若干图（含透明）摆成一张接触表，白底 + 分隔线 + 标签。"""
    n = len(paths)
    rows = math.ceil(n / cols)
    W = cols * (cell + pad) + pad
    H = rows * (cell + pad + 18) + pad
    sheet = Image.new("RGBA", (W, H), (245, 245, 248, 255))
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(paths):
        r, c = divmod(i, cols)
        x = pad + c * (cell + pad)
        y = pad + r * (cell + pad + 18)
        d.rectangle([x - 2, y - 2, x + cell + 2, y + cell + 2], outline=(180, 180, 190, 255), width=2)
        try:
            im = load(p)
        except Exception as e:  # noqa: BLE001
            d.text((x + 4, y + 4), f"ERR {e}", fill=(200, 0, 0, 255))
            continue
        im.thumbnail((cell, cell), Image.LANCZOS)
        sheet.alpha_composite(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        label = labels[i] if labels else os.path.basename(p)
        d.text((x + 2, y + cell + 3), label[:60], fill=(40, 40, 50, 255))
    save(sheet, out)
    return out


def tile_grid(tiles, out: str, cols: int, rows: int, tile_w: int, tile_h: int,
              order=None, bg=(120, 150, 100, 255), snap: bool = False):
    """等距拼图：把 tile_w x tile_h 的地块按 2:1 菱形排布铺成 cols x rows。

    等距坐标：屏幕 x = (c - r) * tile_w/2, y = (c + r) * tile_h/2
    order[i] 给出第 i 个格子用哪张图（下标），默认循环。
    """
    n = len(tiles)
    W = (cols + rows) * (tile_w // 2) + tile_w
    H = (cols + rows) * (tile_h // 2) + tile_h
    canvas = Image.new("RGBA", (W, H), bg)

    # 从后往前画（r+c 小的先画，远的先画）
    cells = []
    for r in range(rows):
        for c in range(cols):
            idx = order[(r * cols + c) % len(order)] if order else (r * cols + c) % n
            cells.append((r + c, r, c, idx))
    cells.sort(key=lambda t: (t[0], t[1]))
    for _, r, c, idx in cells:
        im = tiles[idx]
        if im.size != (tile_w, tile_h):
            im = im.resize((tile_w, tile_h), Image.LANCZOS)
        x = (cols - 1) * (tile_w // 2) + (c - r) * (tile_w // 2)
        y = (r + c) * (tile_h // 2)
        canvas.alpha_composite(im, (max(0, x), max(0, y)))
    save(canvas, out)
    return out


def diamond_overlay(path: str, out: str, grid=None):
    """在图上叠加理想等距菱形网格，用来肉眼比对角度。"""
    im = load(path).convert("RGBA")
    d = ImageDraw.Draw(im)
    w, h = im.size
    if grid is None:
        step = w // 4
        grid = (step, step // 2)
    tw, th = grid
    for gy in range(-1, h // max(1, th // 2) + 2):
        for gx in range(-1, w // max(1, tw // 2) + 2):
            cx = gx * (tw // 2)
            cy = gy * (th // 2)
            if (gx + gy) % 2:
                continue
            pts = [(cx, cy - th // 2), (cx + tw // 2, cy), (cx, cy + th // 2), (cx - tw // 2, cy)]
            d.line(pts + [pts[0]], fill=(255, 0, 0, 160), width=1)
    save(im, out)
    return out


def strip_analysis(path: str) -> dict:
    """分析一张等距地块图：透明包围盒、底菱形几何、颜色数。"""
    img = load(path)
    bb = bbox_alpha(img)
    res = {
        "path": path,
        "size": list(img.size),
        "bbox": list(bb) if bb else None,
        "colors": color_count(img),
        "top_colors": [[list(c), n] for c, n in top_colors(img, 8)],
    }
    if bb:
        l, t, r, b = bb
        res["bbox_wh"] = [r - l, b - t]
    return res


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "info":
        print(json.dumps([strip_analysis(p) for p in sys.argv[2:]], ensure_ascii=False, indent=2))
    elif cmd == "dims":
        out = []
        for p in sys.argv[2:]:
            try:
                with Image.open(p) as im:
                    out.append({"path": os.path.basename(p), "size": list(im.size), "mode": im.mode, "format": im.format})
            except Exception as e:  # noqa: BLE001
                out.append({"path": os.path.basename(p), "error": str(e)})
        print(json.dumps(out, ensure_ascii=False, indent=2))
    elif cmd == "sheet":
        # sheet out.png cols cell p1 p2 ...
        contact_sheet(sys.argv[4:], sys.argv[2], cols=int(sys.argv[3]))
    else:
        raise SystemExit(f"unknown cmd {cmd}")
