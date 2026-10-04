"""等距拼图：把 64x64 单元格地块铺成地图。

坐标（单元格内）：菱形四顶点 = 上(32,0) 右(64,16) 下(32,32) 左(0,16)
格 (r,c) 的菱形中心 = 原点 + ((c-r)*32, (c+r)*16)
→ 每格步进 (±32, +16)，相邻菱形正好边对边无缝。
装饰在单元格 y ∈ [0,32]，往上溢出的部分由画布容差兜住；
绘制顺序按 (r+c) 升序，保证「近处盖住远处」。
"""
from __future__ import annotations
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import save  # noqa: E402

CELL = 64
STEP_X, STEP_Y = 32, 16
DIA_BOTTOM_IN_CELL = 64   # 菱形下顶点在单元格里的 y（单元格 64x96）


def assemble(cells: dict[str, Image.Image], layout: list[list[str]], out: str,
             bg=(120, 150, 100, 0), pad_y: int = 64, sprites=None) -> str:
    """layout: rows x cols 的名字矩阵；名字用 '.': 空格子（不画）。

    sprites: [(贴图, 锚点偏移 dx, dy, 排序键)] —— 大型建筑这类跨格贴图，
             贴图自身约定「大菱形下顶点」在 (w/2, h)，锚点给到它要落在的屏幕坐标。
    """
    rows = len(layout)
    cols = max(len(r) for r in layout)
    W = (cols + rows) * STEP_X + CELL
    H = (rows + cols) * STEP_Y + CELL + pad_y
    canvas = Image.new("RGBA", (W, H), bg)
    origin_x = (rows - 1) * STEP_X
    origin_y = pad_y
    order = []
    for r in range(rows):
        for c in range(cols):
            name = layout[r][c]
            if name in (None, "", "."):
                continue
            order.append((r + c, r, c, name))
    order.sort(key=lambda t: (t[0], t[1]))
    for _, r, c, name in order:
        cell = cells[name]
        x = origin_x + (c - r) * STEP_X
        y = origin_y + (c + r) * STEP_Y
        canvas.alpha_composite(cell, (x, y))
    for sprite, r, c, dz in (sprites or []):
        # 大菱形下顶点 = 2x2 区域里 (r+1, c+1) 格的上顶点
        x = origin_x + (c + 1 - (r + 1)) * STEP_X - sprite.width // 2
        y = origin_y + (c + 1 + r + 1) * STEP_Y - sprite.height
        canvas.alpha_composite(sprite, (x, y + dz))
    save(canvas, out)
    return out


def load_cells(mapping: dict[str, str]) -> dict[str, Image.Image]:
    return {k: Image.open(v).convert("RGBA") for k, v in mapping.items()}


if __name__ == "__main__":
    import glob
    cells = {os.path.splitext(os.path.basename(p))[0]: Image.open(p).convert("RGBA")
             for p in glob.glob(sys.argv[1] + "/*.png")}
    names = sorted(cells)
    cols = 4
    layout = [[names[(r * cols + c) % len(names)] for c in range(cols)] for r in range(len(names) // cols + 1)]
    assemble(cells, layout, sys.argv[2])
    print("ok", sys.argv[2])
