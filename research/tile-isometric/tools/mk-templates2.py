"""最终流程用的模板：全部由代码精确生成 2:1 等距菱形，AI 只负责「填内容」。

等距坐标系（与参考图一致）：单元格宽 = tw，高 = tw/2，
格子 (r, c) 的菱形中心 = 左上角格中心 + ((c - r) * tw/2, (c + r) * tw/4)。
这样相邻格子的菱形正好边对边贴合，拼出来是一整片无缝地面。
"""
from __future__ import annotations
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import save  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "tpl")
PALETTE = [(255, 0, 255, 255), (255, 140, 0, 255), (0, 130, 255, 255), (0, 200, 60, 255),
           (255, 220, 0, 255), (150, 0, 255, 255), (0, 230, 230, 255), (255, 40, 40, 255)]


def hexa(cx, cy, tw, th):
    return [(cx, cy - th / 2), (cx + tw / 2, cy), (cx, cy + th / 2), (cx - tw / 2, cy)]


def render_diamonds(size: int, diamonds, margin: float = 0.92, ss: int = 4) -> Image.Image:
    """diamonds: [(r, c, color)]，按等距网格自动居中 + 缩放到画布的 margin。"""
    rs = [d[0] for d in diamonds]
    cs = [d[1] for d in diamonds]
    r0, r1, c0, c1 = min(rs), max(rs), min(cs), max(cs)
    cols, rows = c1 - c0 + 1, r1 - r0 + 1
    # 整体包围盒（单位 tw）：宽 = (cols+rows)/2 * tw，高 = (cols+rows)/4 * tw
    span = (cols + rows) / 2.0
    tw = min(size * margin / span, size * margin / (span / 2))
    th = tw / 2
    # 中心：所有菱形中心的平均；再用包围盒中心校正
    cx0 = ((c0 - r0) + (c1 - r1)) / 4.0 * tw       # 单位化后的中心 x
    cy0 = ((c0 + r0) + (c1 + r1)) / 4.0 * th
    img = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for r, c, color in diamonds:
        cx = (size / 2 + (c - r) * tw / 2 - cx0) * ss
        cy = (size / 2 + (c + r) * th / 2 - cy0) * ss
        d.polygon(hexa(cx, cy, tw * ss, th * ss), fill=color)
    return img.resize((size, size), Image.LANCZOS)


def grid(cols: int, rows: int, color=(255, 0, 255, 255)):
    return [(r, c, color) for r in range(rows) for c in range(cols)]


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    MAGENTA = (255, 0, 255, 255)
    save(render_diamonds(2048, grid(1, 1, MAGENTA)), os.path.join(OUT, "t1-2048.png"))
    save(render_diamonds(1024, grid(1, 1, MAGENTA)), os.path.join(OUT, "t1-1024.png"))
    save(render_diamonds(2048, grid(2, 2, MAGENTA)), os.path.join(OUT, "t2x2-2048.png"))
    save(render_diamonds(1024, grid(2, 2, MAGENTA)), os.path.join(OUT, "t2x2-1024.png"))
    save(render_diamonds(2048, grid(3, 3, MAGENTA)), os.path.join(OUT, "t3x3-2048.png"))
    # 带编号的四色 2x2（用于验证「分格填不同内容」这类需求）
    d4 = [(0, 0, PALETTE[0]), (0, 1, PALETTE[1]), (1, 0, PALETTE[2]), (1, 1, PALETTE[3])]
    save(render_diamonds(1024, d4), os.path.join(OUT, "t2x2-4color-1024.png"))
    print("wrote", sorted(os.listdir(OUT)))
