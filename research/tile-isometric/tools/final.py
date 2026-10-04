"""生成最终交付：5 类地块（含变体）+ 组合地图 + 无缝性验证图。

地块来源（都在本任务目录 research/tile-isometric/ 下）：
  probe/b8   —— 主体 5 类（grass / dirt / rock / bush / building）
  probe/b10  —— 草地、土地、灌木、石块的变体（打破网格重复感）
  probe/b9   —— 大型建筑候选
  probe/b13  —— 独立装饰（树 / 巨石）
"""
from __future__ import annotations
import json
import os
import random
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TASK = os.path.dirname(HERE)          # research/tile-isometric

sys.path.insert(0, HERE)
from img import save  # noqa: E402
from prepare import to_cell  # noqa: E402
from prepare_building import to_building  # noqa: E402

B8 = os.path.join(TASK, "probe", "b8")
B10 = os.path.join(TASK, "probe", "b10")
B9 = os.path.join(TASK, "probe", "b9")
B13 = os.path.join(TASK, "probe", "b13")
OUT = os.path.join(TASK, "out", "tiles")

SCALE = 2
CELL = 64 * SCALE
CELL_H = 96 * SCALE
STEP_X, STEP_Y = 32 * SCALE, 16 * SCALE

# 名字 -> (源目录, 源文件名)
SOURCES = {
    "grass": (B8, "G-grass-flash.png"),
    "grass2": (B10, "G-grass3-flash.png"),
    "dirt": (B8, "G-dirt-flash.png"),
    "dirt2": (B10, "G-dirt2-flash.png"),
    "rock": (B8, "G-rock-pro.png"),
    "rock2": (B10, "G-rock2-flash.png"),
    "bush": (B8, "G-bush-flash.png"),
    "bush2": (B10, "G-bush2-flash.png"),
    "bush3": (B10, "G-bush3-flash.png"),
}

# 地形类别 -> 可选变体
FAMILY = {
    "grass": ["grass", "grass", "grass2"],
    "dirt": ["dirt", "dirt2", "dirt"],
    "rock": ["rock", "rock2", "rock"],
    "bush": ["bush", "bush2", "bush3"],
}


def build_tiles() -> tuple[dict[str, Image.Image], dict]:
    os.makedirs(OUT, exist_ok=True)
    out, report = {}, {}
    for name, (d, fn) in SOURCES.items():
        # 走 measure：模板填充的产物也能量准（实测 w2/h2 得到 2.00x 比例、残差 <2px），
        # 比按模板几何硬搬更稳 —— 模型总有 0.5% 左右的漂移，量一次就归零了。
        cell, rep = to_cell(Image.open(os.path.join(d, fn)).convert("RGBA"), mode="measured")
        report[name] = rep
        big = cell.resize((CELL, CELL_H), Image.NEAREST)
        save(big, os.path.join(OUT, f"{name}.png"))
        out[name] = big
        print(f"tile {name:6s} <- {fn}  ratio={rep.get('ratio_measured')} resid={rep.get('resid')}")
    b, rep = to_building(Image.open(os.path.join(B9, "H1-grid-flash.png")).convert("RGBA"), mode="bbox")
    report["building"] = rep
    big = b.resize((b.width * SCALE, b.height * SCALE), Image.NEAREST)
    save(big, os.path.join(OUT, "building.png"))
    out["building"] = big
    print(f"tile building <- H1-grid-flash  {rep.get('scaled_wh')}")
    save_tilesheet(out)
    with open(os.path.join(OUT, "_build.json"), "w", encoding="utf8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return out, report

def save_tilesheet(tiles: dict[str, Image.Image]) -> str:
    names = [n for n in SOURCES if n in tiles] + ["building"] + \
            [n for n in ("tree", "tree2", "tree3", "tree4", "boulder") if n in tiles]
    cols = 5
    cw = CELL + 16
    ch = CELL_H + 28
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cw + 8, rows * ch + 8), (245, 245, 248, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        r, c = divmod(i, cols)
        x, y = 8 + c * cw, 8 + r * ch
        t = tiles[n]
        sheet.alpha_composite(t, (x + (CELL - t.width) // 2, y + (CELL_H - t.height) // 2))
        d.rectangle([x - 1, y - 1, x + CELL, y + CELL_H], outline=(190, 190, 200, 255))
        d.text((x + 2, y + CELL_H + 4), f"{n}  {t.width}x{t.height}", fill=(40, 40, 50, 255))
    dest = os.path.join(OUT, "_tilesheet.png")
    save(sheet, dest)
    return dest


def assemble_map(tiles: dict[str, Image.Image], layout: list[list[str]], out: str,
                 buildings: list[tuple[int, int]] = (), decor: list[tuple[int, int, str]] = (),
                 zoom: int = 3, bg=(96, 128, 80, 255), seed: int = 20261004) -> str:
    """等距拼图。

    layout[i][j] 给「地形类别」，具体用哪个变体随机抽（固定种子，可复现）。
    decor 给 [(r, c, 装饰名)]：装饰作为独立图层，跟在它自己那格之后、前排格子之前画，
    所以它既能往上长、又会被前排地块正确遮挡。
    """
    rng = random.Random(seed)
    rows, cols = len(layout), len(layout[0])
    W = (cols + rows) * STEP_X + CELL
    H = (rows + cols) * STEP_Y + CELL_H * 3
    canvas = Image.new("RGBA", (W, H), bg)
    origin_x = (rows - 1) * STEP_X
    origin_y = CELL_H

    def pos(r, c):
        return (origin_x + (c - r) * STEP_X, origin_y + (c + r) * STEP_Y)

    decor_at: dict[tuple[int, int], list[str]] = {}
    for r, c, name in decor:
        decor_at.setdefault((r, c), []).append(name)

    for _, r, c in sorted(((r + c, r, c) for r in range(rows) for c in range(cols))):
        fam = layout[r][c]
        options = [tiles[k] for k in FAMILY.get(fam, [fam]) if k in tiles]
        x, y = pos(r, c)
        canvas.alpha_composite(rng.choice(options), (x, y))
        for name in decor_at.get((r, c), []):
            d = tiles[name]
            # 装饰图层按自身尺寸居中放到格子里（sprites 已经是 64x96 单元格坐标）
            canvas.alpha_composite(d, (x + (CELL - d.width) // 2 if d.width != CELL else x, y))
    for r, c in buildings:
        sp = tiles["building"]
        x = origin_x + (c - r) * STEP_X - sp.width // 2
        y = origin_y + (r + c + 2) * STEP_Y - (sp.height - 8 * SCALE)
        canvas.alpha_composite(sp, (x, y))
    bb = canvas.getbbox()
    if bb:
        canvas = canvas.crop(bb)
    if zoom > 1:
        canvas = canvas.resize((canvas.width * zoom, canvas.height * zoom), Image.NEAREST)
    save(canvas, out)
    return out


def build_decor() -> dict[str, Image.Image]:
    """独立装饰图层（树、巨石）。源图是纯白底，规整时按边框众数色键成透明。"""
    from prepare import to_sprite_cell
    os.makedirs(os.path.join(OUT, "decor"), exist_ok=True)
    mapping = {
        "tree": "D-treeA-white",
        "tree2": "D-treeB-white",
        "tree3": "D-treeC-white",
        "tree4": "D-treeD-white",
        "boulder": "D-rockA-white",
    }
    out, report = {}, {}
    for name, fn in mapping.items():
        cell, rep = to_sprite_cell(Image.open(os.path.join(B13, fn + ".png")).convert("RGBA"))
        report[name] = rep
        big = cell.resize((CELL, CELL_H), Image.NEAREST)
        save(big, os.path.join(OUT, "decor", f"{name}.png"))
        out[name] = big
        print(f"decor {name:8s} <- {fn}  {rep['cell_wh']} @ {rep['placed_at']}")
    return out, report


if __name__ == "__main__":
    random.seed(20261004)
    tiles, _ = build_tiles()
    decor_tiles, _ = build_decor()
    tiles.update(decor_tiles)
    save_tilesheet(tiles)

    # ① 示例地图 14x14
    G, D, R, B = "grass", "dirt", "rock", "bush"
    n = 14
    layout = [[G] * n for _ in range(n)]
    for i in range(3, 11):                        # 斜向土路
        layout[i][i] = D
        layout[i][i + 1] = D
    for r in range(1, 4):                          # 农田
        for c in range(8, 13):
            layout[r][c] = D
    for (r, c) in [(7, 2), (8, 2), (7, 3), (11, 9), (12, 9), (11, 10), (9, 5), (9, 6), (4, 6)]:
        layout[r][c] = R
    for (r, c) in [(5, 1), (5, 2), (6, 1), (2, 2), (2, 3), (3, 3), (10, 2), (11, 3),
                   (1, 10), (2, 11), (6, 9), (6, 10), (7, 10), (8, 6), (8, 7), (3, 5),
                   (12, 5), (13, 6), (5, 11), (4, 12)]:
        layout[r][c] = B
    for r in (6, 7):                               # 建筑占 (6,6)-(7,7) 四格
        for c in (6, 7):
            layout[r][c] = D
    # 独立装饰图层：树 + 巨石（会正确被前排地块遮挡）
    decor = [
        (1, 2, "tree"), (2, 5, "tree2"), (4, 3, "tree3"), (0, 7, "tree4"),
        (3, 9, "tree"), (5, 4, "tree2"), (8, 10, "tree3"), (10, 6, "tree4"),
        (11, 1, "tree"), (12, 8, "tree2"), (9, 12, "tree4"), (6, 12, "tree3"),
        (13, 3, "tree"), (2, 0, "boulder"), (10, 11, "boulder"), (7, 8, "boulder"),
    ]
    assemble_map(tiles, layout, os.path.join(TASK, "out", "map-demo.png"),
                 buildings=[(6, 6)], decor=decor, zoom=3)

    # ② 纯草地铺满：验证无缝
    assemble_map(tiles, [[G] * 10 for _ in range(10)],
                 os.path.join(TASK, "out", "map-seamless.png"), zoom=3)

    # ③ 每类地块单独铺 5x5：验证同类之间无缝
    for fam in ["grass", "dirt", "rock", "bush"]:
        assemble_map(tiles, [[fam] * 5 for _ in range(5)],
                     os.path.join(TASK, "out", f"map-tile-{fam}.png"), zoom=4)

    # ④ 纯装饰图层单独验证：树/巨石铺在草地上，检查遮挡与接地
    deco_layout = [[G] * 6 for _ in range(6)]
    deco = [(r, c, ["tree", "tree3", "boulder", "tree2", "tree4"][(r * 6 + c) % 5])
            for r in range(6) for c in range(6)]
    assemble_map(tiles, deco_layout, os.path.join(TASK, "out", "map-decor.png"),
                 decor=deco, zoom=5, bg=(255, 255, 255, 255))

    print("\n输出目录：", OUT)
