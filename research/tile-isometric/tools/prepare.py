"""把 AI 生成的 2K 地块图，规整成游戏可用的 64x96 单元格地块。

为什么需要这一步：
  模型给的菱形比例总在 1.9~2.04 之间浮动、位置也不固定，直接摆进网格会错位。
  这里先量出它画的地面菱形，再「裁到菱形 + 缩放到标准 2:1 + 对齐到单元格中心」，
  几何就完全确定了；装饰层（树/灌木/建筑）也跟着同一套变换搬过去。

输出：64x96 RGBA，菱形四个顶点固定在
  上 (32, 32)  右 (64, 48)  下 (32, 64)  左 (0, 48)
菱形之上留 32px 给「高出地面」的装饰（树冠、屋顶）。

两条规整路线：
  template  —— 模板填充出来的图，几何已知，直接按模板坐标搬（最稳）
  decorated —— 带「高出菱形的装饰」的地块（树）：先按模板几何搬，然后
               地面层裁到菱形、装饰层保留并整体上移到菱形上方（见 to_decorated_cell）
"""
from __future__ import annotations
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import load, save  # noqa: E402

CELL_W = 64
CELL_H = 96          # 单元格高：菱形上顶点在 y=32、下顶点在 y=64，上方 32px 给高出菱形的装饰
DIA_W, DIA_H = 64, 32
DIA_CX = CELL_W / 2  # 32
DIA_CY = 32.0 + DIA_H / 2  # 48：菱形中心
TRUNK_ANCHOR_Y = 54        # 装饰底部锚点 = 地面在菱形中轴上的高度（树干正好踩在草面上）


def background_by_flood(rgb: np.ndarray, bgcol: np.ndarray, tol: int = 22) -> np.ndarray:
    """从画布四边向内泛洪，标出与 bgcol 相近且与边框连通的区域。"""
    h, w = rgb.shape[:2]
    near = np.abs(rgb - bgcol).sum(axis=2) <= tol * 3
    vis = np.zeros((h, w), bool)
    from collections import deque
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not vis[y, x]:
                vis[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not vis[y, x]:
                vis[y, x] = True
                q.append((y, x))
    while q:
        cy, cx = q.popleft()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not vis[ny, nx]:
                vis[ny, nx] = True
                q.append((ny, nx))
    return ~vis


def foreground(img: Image.Image, tol: int = 22) -> np.ndarray:
    """前景掩码。有透明通道就信透明通道，否则用边框众数色「泛洪」当背景。"""
    a = np.asarray(img)
    alpha = a[:, :, 3]
    rgb = a[:, :, :3].astype(np.int16)
    if alpha.min() < 24:  # 有透明像素 → 这张图带 alpha
        return alpha >= 24
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    vals, counts = np.unique(border, axis=0, return_counts=True)
    bgcol = vals[counts.argmax()].astype(np.int16)
    return background_by_flood(rgb, bgcol, tol)


def robust_fit(xs: np.ndarray, ys: np.ndarray, iters: int = 4) -> tuple[float, float, float]:
    """最小二乘 + 按残差裁剪的稳健拟合，返回 (k, c, resid)。"""
    sel = np.ones(len(xs), bool)
    k = c = 0.0
    resid = 0.0
    for _ in range(iters):
        k, c = np.polyfit(ys[sel], xs[sel], 1)
        r = np.abs(xs - (k * ys + c))
        keep = r <= max(2.0, np.percentile(r[sel], 80))
        if keep.sum() < 8 or (keep == sel).all():
            break
        sel = keep
    resid = float(np.abs(xs[sel] - (k * ys[sel] + c)).max())
    return float(k), float(c), resid


def measure_ground(img: Image.Image, verbose: bool = False) -> dict:
    """量出地面菱形的「下顶点 + 左右顶点」，从而得到精确的斜边比例。"""
    fg = foreground(img)
    ys, xs = np.where(fg)
    if len(ys) < 200:
        raise ValueError("图里找不到地块")
    l, r = int(xs.min()), int(xs.max())
    t, b = int(ys.min()), int(ys.max())
    H = b - t + 1
    # 只在下半部分找地面边（上半部分可能被树/建筑挡住）
    y_lo = t + int(H * 0.5)
    left_x, left_y, right_x, right_y = [], [], [], []
    for y in range(y_lo, b + 1):
        row = np.where(fg[y])[0]
        if len(row) == 0:
            continue
        if row.max() - row.min() < 8:  # 接近尖端的行，噪声大
            continue
        left_x.append(float(row.min()))
        left_y.append(float(y))
        right_x.append(float(row.max()))
        right_y.append(float(y))
    if len(left_x) < 12:
        raise ValueError("下半部分前景太少，量不到地面边")
    kL, cL, resL = robust_fit(np.array(left_x), np.array(left_y))
    kR, cR, resR = robust_fit(np.array(right_x), np.array(right_y))
    if abs(kL - kR) < 1e-6:
        raise ValueError("左右边平行，拟合失败")
    # 下顶点：两线交点
    y_bot = (cR - cL) / (kL - kR)
    x_bot = kL * y_bot + cL
    # 左顶点 / 右顶点：下半部分 x 的极值点（对左边界取最小 x，对右边界取最大 x）
    li = int(np.argmin(left_x))
    ri = int(np.argmax(right_x))
    xL, yL = left_x[li], left_y[li]
    xR, yR = right_x[ri], right_y[ri]
    k = (abs(kL) + abs(kR)) / 2.0
    # 用「左顶点 → 下顶点」这条下边直接算半宽/半高（同为一条边，最可信）
    #   水平距离 = x_bot - xL，竖直距离 = y_bot - yL
    w2_edge = (x_bot - xL)
    h2_edge = (y_bot - yL)
    if verbose:
        print(f"  bbox=({l},{t},{r},{b}) kL={kL:.3f} kR={kR:.3f} resid=({resL:.1f},{resR:.1f})")
        print(f"  bottom=({x_bot:.0f},{y_bot:.0f}) left=({xL:.0f},{yL:.0f}) right=({xR:.0f},{yR:.0f}) "
              f"edge(w2={w2_edge:.0f},h2={h2_edge:.0f}) ratio={w2_edge/max(1,h2_edge):.3f}")
    return {"bbox": (l, t, r, b), "kL": kL, "kR": kR, "k": k, "x_bot": x_bot, "y_bot": y_bot,
            "xL": xL, "yL": yL, "xR": xR, "yR": yR,
            "w2": w2_edge, "h2": h2_edge, "resid": max(resL, resR),
            "ratio_edge": w2_edge / max(1.0, h2_edge)}


def template_diamond(path: str, color=(255, 0, 255), tol: int = 60):
    """从一张「纯色菱形模板」图里量出菱形几何，而不是硬编码尺寸。

    为什么必须量：模板图可能在流程中被缩放过（本次研究里就把 2048 的探针图压到过 1536），
    硬编码「宽 1884 / 高 942 / 中心 1024」会静默算错比例 —— 表现是产物被裁出一个奇怪的形状，
    而且不报任何错。量一次的成本可以忽略。
    """
    a = np.asarray(Image.open(path).convert("RGBA"))
    rgb, alpha = a[:, :, :3].astype(np.int16), a[:, :, 3]
    m = (alpha > 128) & (np.abs(rgb - np.array(color)).sum(axis=2) <= tol)
    ys, xs = np.where(m)
    if len(ys) < 100:
        raise ValueError(f"{path} 里找不到指定颜色的菱形")
    return {"l": int(xs.min()), "r": int(xs.max()), "t": int(ys.min()), "b": int(ys.max()),
            "cx": (float(xs.min()) + float(xs.max()) + 1) / 2.0,
            "cy": (float(ys.min()) + float(ys.max()) + 1) / 2.0,
            "w": int(xs.max() - xs.min() + 1), "h": int(ys.max() - ys.min() + 1)}


def to_cell(img: Image.Image, verbose: bool = False, mode: str = "measured"):
    """把生成图规整成 CELL_W x CELL_H 的单元格地块。

    菱形四顶点固定在：上 (32,32) 右 (64,48) 下 (32,64) 左 (0,48)
    菱形之上留 32px 给高出地面的装饰（树冠、屋顶）。

    mode:
      measured        —— 量出模型实际画的菱形（**首选**，模板填充的产物也能量准）
      template        —— 退路：按模板几何搬（测量失败时用）
      template-small  —— 小菱形模板（树实验用）
    """
    if mode.startswith("template"):
        g = None
        tpl = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "tpl",
                           "t1-small-2048.png" if mode == "template-small" else "t1-2048.png")
        t = template_diamond(tpl)
        w2, h2 = t["w"] / 2.0, t["h"] / 2.0
        cx, cy = t["cx"], t["cy"]
    else:
        g = measure_ground(img, verbose=verbose)
        w2, h2 = g["w2"], g["h2"]
        cx, cy = (g["xL"] + g["xR"]) / 2.0, g["y_bot"] - g["h2"]
    sx = (DIA_W / 2) / w2
    sy = (DIA_H / 2) / max(1.0, h2)
    cell = img.transform(
        (CELL_W, CELL_H), Image.AFFINE,
        (1 / sx, 0, cx - DIA_CX / sx, 0, 1 / sy, cy - DIA_CY / sy),
        resample=Image.BICUBIC,
    )
    arr = np.asarray(cell).copy()
    if arr.shape[2] == 3:
        arr = np.dstack([arr, np.full(arr.shape[:2], 255, np.uint8)])
    yy, xx = np.mgrid[0:CELL_H, 0:CELL_W]
    inside = (np.abs(xx + 0.5 - DIA_CX) / (DIA_W / 2) + np.abs(yy + 0.5 - DIA_CY) / (DIA_H / 2)) <= 1.0
    arr[~inside, 3] = 0
    cell = Image.fromarray(arr)
    report = {"mode": mode, "scale": [round(sx, 4), round(sy, 4)]}
    if g:
        report.update({"k_measured": round(g["k"], 3), "ratio_measured": round(g["ratio_edge"], 3),
                       "w2": round(g["w2"], 1), "h2": round(g["h2"], 1), "resid": round(g["resid"], 1)})
    return cell, report


def diamond_alpha(size=(CELL_W, CELL_H), cx=DIA_CX, cy=DIA_CY,
                  half_w=DIA_W / 2, half_h=DIA_H / 2, feather: float = 0.7) -> Image.Image:
    """菱形软遮罩：|dx|/half_w + |dy|/half_h <= 1 处为 255，边界带 1px 羽化。"""
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.abs(xx + 0.5 - cx) / half_w + np.abs(yy + 0.5 - cy) / half_h
    a = np.clip((1.0 - d) / (feather / half_h) + 0.5, 0.0, 1.0)
    return Image.fromarray((a * 255).astype(np.uint8), "L")


def compose_layers(base: Image.Image | None, top: Image.Image) -> Image.Image:
    """把两个 RGBA 图层合成到 CELL_W x CELL_H 的透明画布。"""
    canvas = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    if base is not None:
        canvas.alpha_composite(base.convert("RGBA"))
    canvas.alpha_composite(top.convert("RGBA"))
    return canvas


def to_decorated_cell(img: Image.Image, shape_scale: float = 1.0, verbose: bool = False):
    """给「带高出菱形装饰」的地块（树/塔）用。

    和 to_cell 的区别：to_cell 会把整个菱形之外的东西一律 alpha=0，
    树冠正好在「菱形之外」，所以会被削平。这里改成两层：

      ① 按模板几何搬进 64x96 单元格（不裁）
      ② 地面层 = 与菱形遮罩取交；装饰层 = 落在菱形「上顶点水平线以上」的部分，
         整体上移到菱形上方，底部贴住菱形顶部

    输出里地面精确（数学菱形），装饰自由向上长。
    """
    t = template_diamond(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "tpl", "t1-2048.png"))
    w2, h2 = t["w"] / 2.0, t["h"] / 2.0
    cx, cy = t["cx"], t["cy"]
    sx = (DIA_W / 2) / w2 * shape_scale
    sy = (DIA_H / 2) / h2
    flat = img.transform(
        (CELL_W, CELL_H), Image.AFFINE,
        (1 / sx, 0, cx - DIA_CX / sx, 0, 1 / sy, cy - DIA_CY / sy),
        resample=Image.BICUBIC,
    )
    arr = np.asarray(flat.convert("RGBA")).copy()

    dia_top = int(DIA_CY - DIA_H / 2)          # 32
    alpha = np.asarray(diamond_alpha()).astype(np.float32) / 255.0

    # ① 地面层：菱形内，其余透明
    ground = arr.copy()
    ground[:, :, 3] = (ground[:, :, 3].astype(np.float32) * alpha).astype(np.uint8)

    # ② 装饰层：菱形上顶点以上那一整条
    deco = arr.copy()
    deco[dia_top:, :, :] = 0
    ys, xs = np.where(deco[:, :, 3] > 8)
    if len(ys) == 0:
        raise ValueError("菱形上方没有找到装饰（树冠），检查提示词或模板")
    dl, dr = int(xs.min()), int(xs.max())
    dt, db = int(ys.min()), int(ys.max())
    deco_crop = Image.fromarray(deco[dt:db + 1, dl:dr + 1])

    # ③ 合成：装饰底部贴住菱形顶部（优先），再限一限水平位置
    max_h = CELL_H - dia_top               # 装饰最多占到单元格顶端（y=0），放不下就等比缩
    clipped = False
    if deco_crop.height > max_h:
        k = max_h / deco_crop.height
        deco_crop = deco_crop.resize((max(1, int(deco_crop.width * k)), max_h), Image.LANCZOS)
        clipped = True
    top = dia_top - deco_crop.height
    left = int(round(DIA_CX - deco_crop.width / 2))          # 水平居中
    left = max(-DIA_W // 2, min(left, CELL_W - deco_crop.width // 2))  # 允许略微出界
    out = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    out.alpha_composite(Image.fromarray(ground), (0, 0))
    out.alpha_composite(deco_crop, (left, top))

    report = {
        "mode": "decorated",
        "scale": [round(sx, 4), round(sy, 4)],
        "deco_bbox_src": [dl, dt, dr, db],
        "deco_wh_src": [dr - dl + 1, db - dt + 1],
        "deco_wh_cell": [deco_crop.width, deco_crop.height],
        "deco_placed_at": [left, top],
        "deco_shrunk": clipped,
    }
    if verbose:
        print(f"  装饰 源 {report['deco_wh_src']} -> 单元 {report['deco_wh_cell']} 放在 ({left},{top}) "
              f"缩放={clipped}")
    return out, report


def border_bg_color(rgb: np.ndarray) -> np.ndarray:
    """边框众数色 = 背景色（float32）。"""
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    vals, counts = np.unique(border.astype(np.int16), axis=0, return_counts=True)
    return vals[counts.argmax()].astype(np.float32)


def solid_bleed(rgb: np.ndarray, mask: np.ndarray, rings: int = 3) -> np.ndarray:
    """颜色凝固：把前景色往外扩散 rings 圈（最近前景色填充）。

    为什么必须做：裁 bbox 之后的图里，紧贴前景的那几圈像素是**背景色**。
    任何重采样（LANCZOS）都会把它们平均进边缘 —— 这就是白边的来源。
    先把背景色换成「合理的前景色」，重采样才吃不到背景。
    """
    h, w = mask.shape
    out = rgb.copy()
    known = mask.copy()
    frontier = [(int(y), int(x)) for y, x in zip(*np.where(mask))]
    for _ in range(rings):
        nxt = []
        for y, x in frontier:
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and not known[ny, nx]:
                    out[ny, nx] = out[y, x]
                    known[ny, nx] = True
                    nxt.append((ny, nx))
        frontier = nxt
        if not frontier:
            break
    return out


def matte_foreground(rgba: np.ndarray, bg: np.ndarray, lo: float = 40.0, hi: float = 190.0,
                     solid_trust: float = 0.75):
    """把「白底图」变成（可信的前景色 + 软 alpha）。

    返回 (rgb_out, alpha01)。

    ## 白边的真正成因（实测数据）

    一张 2048² 的树缩到 40px 宽，一个输出像素要平均 37×37=1369 个源像素。
    树冠/树干边缘那一格的源像素里，大部分是「半覆盖的抗锯齿像素」——
    它们的颜色是**已经在白底上合成过的**，天生偏亮。
    最外一格实测 C̄=(114,140,122)、ᾱ=0.56。

    如果这时还用**硬阈值**决定 alpha（`α≥0.5 → 1`），就会得到一个
    「完全不透明 + 偏亮颜色」的像素 → 一圈可见的亮描边。
    实测：现行做法下 64×96 单元格里有 **184 个 alpha>200 且 min(RGB)≥220** 的像素。

    ## 修法：alpha 用软映射，颜色只用「可信」的像素

    1. **软 alpha**：`α = clamp((dist − lo)/(hi − lo))`，保留模型的抗锯齿。
       死区 `lo=40` 是必须的：纯白底图里压缩噪声让 dist 落在 2~10，
       无死区会把整张底判成 α≈0.03 的「前景」。
    2. **颜色只用可信像素**：只有 `α ≥ solid_trust` 的像素，它的 RGB 才是
       「没被背景稀释过的真前景色」。其余位置（含全部边缘像素）一律用
       **最近的可信像素颜色**填充（`solid_bleed`）。
       这一步是关键 —— 边缘不再使用那个被白稀释过的平均色。
    3. 颜色与 alpha 之后**分开**缩放（见 `to_sprite_cell`）。

    为什么不用 unmatte（`F=(C−(1−α)B)/α`）：把 1369 个源像素平均出来的
    C̄ 当作"单个已合成像素"去反解，得到的仍是偏亮的颜色（实测几乎没变化）；
    而且 α→0 时数值不稳。用「最近可信邻居的颜色」更直接也更稳。
    """
    rgb = rgba[:, :, :3].astype(np.float32)
    a0 = rgba[:, :, 3].astype(np.float32) / 255.0

    if a0.min() < 0.999:
        # 模型直接给了 alpha（5.0 的透明输出）：alpha 用它自己的，别重算
        alpha = a0.copy()
    else:
        dist = np.abs(rgb - bg).sum(axis=2)
        alpha = np.clip((dist - lo) / max(1e-6, hi - lo), 0.0, 1.0)

    trust = alpha >= solid_trust
    if trust.sum() == 0:
        raise ValueError("没有可信前景像素（阈值过高或图里没有装饰）")
    rgb_out = solid_bleed(rgb, trust, rings=4)
    return rgb_out, alpha


def to_sprite_cell(img: Image.Image, trunk_bottom: bool = True, verbose: bool = False,
                   matte: bool = True):
    """把「独立装饰贴图」（一棵树 / 一座塔）规整成单元格大小的透明 PNG。

    输入：白底或透明底的完整装饰图（不含地面）。
    输出：64x96 单元格，装饰按 bbox 等比缩放，横向居中，
          **底部踩在草地上**（等距游戏里「站在格子里」的读感）。

    这条路线是为了避开「地面 + 装饰同图」时的重复采样问题：
    地面用模板填充的纯地面地块，装饰单独生成、单独摆放，两者都干净。

    matte=False 走的是旧路线（硬阈值抠底 + RGB/alpha 一起缩），只用于对照实验：
    实测那条路会在成品上留一圈「完全不透明但偏白」的边
    （边缘平均亮度比内部高 ~100，29% 的边像素 min(RGB) ≥ 200）。
    """
    fg = foreground(img)
    ys, xs = np.where(fg)
    if len(ys) < 50:
        raise ValueError("图里没有找到装饰")
    l, r = int(xs.min()), int(xs.max())
    t, b = int(ys.min()), int(ys.max())
    w, h = r - l + 1, b - t + 1
    report = {"mode": "sprite", "src_bbox": [l, t, r, b], "src_wh": [w, h], "matte": matte}

    if matte:
        full = np.asarray(img.convert("RGBA")).astype(np.float32)
        bg = border_bg_color(full[:, :, :3])
        rgb_m, alpha = matte_foreground(full, bg)
        rgb_c = rgb_m[t:b + 1, l:r + 1]
        al_c = alpha[t:b + 1, l:r + 1]
    else:
        crop0 = img.convert("RGBA").crop((l, t, r + 1, b + 1))
        arr = np.asarray(crop0).copy()
        rgb_i = arr[:, :, :3].astype(np.int16)
        bgcol = border_bg_color(arr[:, :, :3])
        near = np.abs(rgb_i - bgcol.astype(np.int16)).sum(axis=2) <= 66
        arr[near, 3] = 0
        rgb_c = arr[:, :, :3].astype(np.float32)
        al_c = arr[:, :, 3].astype(np.float32) / 255.0

    # 缩放策略（统一「世界尺度」，避免一棵树巨一棵树小）：
    #   ① 宽度归一化到 40（= 菱形宽的 5/8）—— 宽窄是装饰的辨识特征，统一后粗细一致
    #   ② 高度上限 = 锚点以上的可用空间
    #   ③ 取最保守的一个
    k = min(40.0 / w, float(TRUNK_ANCHOR_Y) / h)
    nw, nh = max(1, int(round(w * k))), max(1, int(round(h * k)))

    if matte:
        # 颜色与 alpha **分开**缩放：颜色是「已凝固」的，随便怎么重采样都不会吃到背景；
        # alpha 用 LANCZOS 才能保住模型自带的抗锯齿。
        c = Image.fromarray(np.clip(rgb_c, 0, 255).astype(np.uint8), "RGB").resize((nw, nh), Image.LANCZOS)
        m = Image.fromarray((np.clip(al_c, 0, 1) * 255).astype(np.uint8), "L").resize((nw, nh), Image.LANCZOS)
        crop = Image.fromarray(np.dstack([np.asarray(c), np.asarray(m)]), "RGBA")
    else:
        crop = Image.fromarray(np.dstack([rgb_c, al_c * 255]).astype(np.uint8), "RGBA")
        crop = crop.resize((nw, nh), Image.LANCZOS)

    # 摆放：水平居中，底部锚点 = 地面上「站得住」的高度
    left = int(round(DIA_CX - nw / 2))
    bottom = TRUNK_ANCHOR_Y if trunk_bottom else int(DIA_CY - DIA_H / 2)
    top = bottom - nh
    out = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    out.alpha_composite(crop, (left, top))

    report.update({"scale": round(k, 4), "cell_wh": [nw, nh], "placed_at": [left, top]})
    if matte:
        a = np.asarray(out)[:, :, 3]
        report["alpha_levels"] = int(len(np.unique(a)))
        report["semi_alpha_frac"] = round(float(((a > 8) & (a < 248)).sum() / max(1, (a > 8).sum())), 4)
    if verbose:
        print(f"  装饰 源 {w}x{h} -> 单元 {nw}x{nh}，放在 ({left},{top})（底部 y={bottom}）"
              + (f"  软边占比={report.get('semi_alpha_frac')}" if matte else "  [旧路线：硬阈值]"))
    return out, report


def quantize(img: Image.Image, colors: int = 24) -> Image.Image:
    """限定调色板 + 保留 alpha，得到像素画的干净色块。"""
    alpha = img.getchannel("A")
    q = img.convert("RGB").quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE)
    out = q.convert("RGBA")
    out.putalpha(alpha)
    return out


def snap_to_grid(img: Image.Image, scale: int = 2) -> Image.Image:
    """把 64x64 的内容按 scale 倍「像素化」，让边缘落在整数格上（更像素画）。"""
    small = img.resize((CELL_W // scale, CELL_H // scale), Image.BOX)
    return small.resize((CELL_W, CELL_H), Image.NEAREST)


if __name__ == "__main__":
    args = sys.argv[1:]
    quant = 0
    outdir = None
    mode = "auto"
    for a in list(args):
        if a.startswith("--quant="):
            quant = int(a.split("=")[1]); args.remove(a)
        elif a.startswith("--out="):
            outdir = a.split("=")[1]; args.remove(a)
        elif a.startswith("--mode="):
            mode = a.split("=")[1]; args.remove(a)
    report = {}
    for p in args:
        img = load(p)
        use_mode = mode
        cell = None
        if mode == "auto":
            # 先试测量；测量结果离谱（前景铺满画布 / 菱形超界）就退回模板几何
            try:
                fg = foreground(img)
                frac = float(fg.mean())
                cell, rep = to_cell(img, verbose=True, mode="measured")
                if frac > 0.75 or rep.get("w2", 0) > img.width * 0.55 or rep.get("h2", 0) > img.height * 0.4:
                    raise ValueError(f"测量不可信（前景占比 {frac:.2f}）")
            except Exception as e:  # noqa: BLE001
                print(f"  ! 退回模板几何：{e}")
                cell, rep = to_cell(img, verbose=True, mode="template")
                rep["fallback"] = str(e)
                use_mode = "template"
        else:
            cell, rep = to_cell(img, verbose=True, mode=use_mode)
        if quant:
            cell = quantize(cell, quant)
        name = os.path.splitext(os.path.basename(p))[0] + ".png"
        dest = os.path.join(outdir or os.path.dirname(p), name)
        save(cell, dest)
        report[os.path.basename(p)] = {**rep, "out": dest}
        print(f"{os.path.basename(p)} -> {dest}  ratio={rep.get('ratio_measured')} scale={rep['scale']}")
    if outdir:
        with open(os.path.join(outdir, "_prepare.json"), "w", encoding="utf8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
