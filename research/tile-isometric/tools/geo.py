"""地块几何分析：找出「地块基底」连通域，拟合理想 2:1 等距菱形，给出各项指标。

指标：
  bbox_wh / ratio        基底包围盒宽高与实际比例
  diamond_iou            最优拟合理想菱形与基底的 IoU（越接近 1 越标准）
  edge_slope_deg         四条边的倾角（理想 ≈ 26.565°）
  straightness           边缘点到理想直线的最大偏差（像素）
  corners                四角坐标（相对画布中心）
  fills_canvas           基底是否顶到画布边缘（会被裁切）
  color_std              基底颜色方差（越大越「花」）
"""
from __future__ import annotations
import json
import math
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import load, save  # noqa: E402


def bg_mask(a: np.ndarray, tol: int = 26, max_side: int = 700) -> np.ndarray:
    """从四边向内泛洪，标出背景（含 alpha=0 的全部）。大图先缩到 max_side 再算。"""
    h, w = a.shape[:2]
    if max(h, w) > max_side:
        img = Image.fromarray(a).convert("RGBA")
        img.thumbnail((max_side, max_side), Image.LANCZOS)
        a = np.asarray(img)
        h, w = a.shape[:2]
    rgb = a[:, :, :3].astype(np.int16)
    alpha = a[:, :, 3]
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    opaque = border[border.sum(axis=1) > 0] if border.ndim == 2 else border
    # 边框颜色里取众数
    if len(opaque):
        vals, counts = np.unique(opaque, axis=0, return_counts=True)
        bgcol = vals[counts.argmax()]
    else:
        bgcol = np.array([255, 255, 255])
    near = (np.abs(rgb - bgcol).sum(axis=2) <= tol * 3) | (alpha < 16)
    # 只在「靠近边框的连通区」算背景：从边框泛洪
    vis = np.zeros((h, w), bool)
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
    fg = ~vis
    return fg, tuple(int(v) for v in bgcol)


def largest_component(fg: np.ndarray) -> np.ndarray:
    h, w = fg.shape
    lab = np.zeros((h, w), np.int32)
    best, best_n, cur = None, 0, 0
    for y in range(h):
        for x in range(w):
            if not fg[y, x] or lab[y, x]:
                continue
            cur += 1
            q = deque([(y, x)])
            lab[y, x] = cur
            cells = []
            while q:
                cy, cx = q.popleft()
                cells.append((cy, cx))
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and lab[ny, nx] == 0:
                        lab[ny, nx] = cur
                        q.append((ny, nx))
            if len(cells) > best_n:
                best_n = len(cells)
                best = cells
    out = np.zeros((h, w), bool)
    if best:
        for cy, cx in best:
            out[cy, cx] = True
    return out


def diamond_mask(shape, cx, cy, tw, th) -> np.ndarray:
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    return (np.abs(xx - cx) / (tw / 2) + np.abs(yy - cy) / (th / 2)) <= 1.0


def _iou_at(comp, cx, cy, tw, th, k=4):
    """在 1/k 分辨率上算 IoU —— 拟合阶段够用，快 16 倍。"""
    h, w = comp.shape
    H, W = h // k, w // k
    c = comp[: H * k, : W * k].reshape(H, k, W, k).mean(axis=(1, 3)) > 0.5
    yy, xx = np.mgrid[0:H, 0:W]
    dm = (np.abs(xx * k + k / 2 - cx) / (tw / 2) + np.abs(yy * k + k / 2 - cy) / (th / 2)) <= 1.0
    inter = np.logical_and(dm, c).sum()
    union = np.logical_or(dm, c).sum()
    return inter / max(1, union)


def fit_diamond(comp: np.ndarray):
    ys, xs = np.where(comp)
    l, r, t, b = xs.min(), xs.max(), ys.min(), ys.max()
    cx, cy = (l + r) / 2, (t + b) / 2
    best = None
    for tw in np.arange((r - l + 1) * 0.82, (r - l + 1) * 1.15, 2.0):
        for th in np.arange((b - t + 1) * 0.82, (b - t + 1) * 1.15, 2.0):
            for dx in np.arange(-6, 6.5, 2.0):
                for dy in np.arange(-6, 6.5, 2.0):
                    iou = _iou_at(comp, cx + dx, cy + dy, tw, th, 4)
                    if best is None or iou > best[0]:
                        best = (iou, cx + dx, cy + dy, tw, th)
    # 局部精修
    _, bx, by, bw, bh = best
    for tw in np.arange(bw - 3, bw + 3.5, 1.0):
        for th in np.arange(bh - 3, bh + 3.5, 1.0):
            for dx in np.arange(-2, 2.5, 1.0):
                for dy in np.arange(-2, 2.5, 1.0):
                    iou = _iou_at(comp, bx + dx, by + dy, tw, th, 1)
                    if iou > best[0]:
                        best = (iou, bx + dx, by + dy, tw, th)
    return best


def edge_slopes(comp: np.ndarray, cx, cy, tw, th):
    """量四条边的倾角与直线度：分别取菱形的上下左右四个象限的边界点。"""
    ys, xs = np.where(comp)
    q = {
        "top_right": (xs >= cx) & (ys <= cy),
        "bottom_right": (xs >= cx) & (ys > cy),
        "top_left": (xs < cx) & (ys <= cy),
        "bottom_left": (xs < cx) & (ys > cy),
    }
    out = {}
    ideal = math.degrees(math.atan2(th / 2, tw / 2))
    for name, m in q.items():
        if m.sum() < 20:
            out[name] = None
            continue
        px, py = xs[m], ys[m]
        # 每个 x 取最外的 y 作为边界点（对右上/左上取最小 y，对下取最大 y）
        pts = {}
        for x, y in zip(px, py):
            if name.startswith("top"):
                pts[x] = min(pts.get(x, 10**9), y)
            else:
                pts[x] = max(pts.get(x, -1), y)
        ax = np.array(sorted(pts))
        ay = np.array([pts[x] for x in ax])
        if len(ax) < 8:
            out[name] = None
            continue
        # 线性拟合斜率
        k, b0 = np.polyfit(ax, ay, 1)
        ang = abs(math.degrees(math.atan(k)))
        resid = float(np.abs(ay - (k * ax + b0)).max())
        out[name] = {"slope_deg": round(ang, 2), "fit_resid_px": round(resid, 2), "n": int(len(ax))}
    return out, ideal


def analyze(path: str, draw_overlay: bool = True):
    img = load(path).convert("RGBA")
    img.thumbnail((256, 256), Image.LANCZOS)
    w, h = img.size
    a = np.asarray(img)
    fg, bgcol = bg_mask(a)
    comp = largest_component(fg)
    if comp.sum() < 50:
        return {"path": path, "error": "未找到地块基底"}
    ys, xs = np.where(comp)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    iou, cx, cy, tw, th = fit_diamond(comp)
    slopes, ideal = edge_slopes(comp, cx, cy, tw, th)
    rgb = a[:, :, :3].astype(np.float32)
    base_colors = rgb[comp]
    res = {
        "path": os.path.basename(path),
        "canvas": [w, h],
        "bg": bgcol,
        "bbox": [l, t, r, b],
        "bbox_wh": [r - l + 1, b - t + 1],
        "area_frac": round(float(comp.sum()) / (w * h), 4),
        "fit": {
            "iou": round(float(iou), 4),
            "center": [round(float(cx), 1), round(float(cy), 1)],
            "w": round(float(tw), 1),
            "h": round(float(th), 1),
            "ratio": round(float(tw / th), 3),
        },
        "edge_ideal_deg": round(ideal, 2),
        "edges": slopes,
        "touches_border": bool(l == 0 or t == 0 or r == w - 1 or b == h - 1),
        "color_mean": [round(float(v), 1) for v in base_colors.mean(axis=0)],
        "color_std": round(float(base_colors.std()), 1),
    }
    if draw_overlay:
        ov = img.copy()
        d = ImageDraw.Draw(ov)
        pts = [(cx, cy - th / 2), (cx + tw / 2, cy), (cx, cy + th / 2), (cx - tw / 2, cy)]
        d.line(pts + [pts[0]], fill=(255, 0, 0, 220), width=2)
        d.rectangle([l, t, r, b], outline=(0, 90, 255, 200), width=1)
        out = os.path.join(os.path.dirname(path), "annot", os.path.splitext(os.path.basename(path))[0] + ".png")
        save(ov, out)
        res["annot"] = out
    return res


def measure_ground(path: str, debug: bool = False) -> dict:
    """只量「地面菱形」的两条下边（不被装饰遮挡的那两条）。

    做法：从紧致包围盒底部往上扫，每行取最左/最右前景像素，得到左右两条边界的折线；
    对下半部分做线性拟合，得到斜率 k。标准 2:1 等距菱形 |k| = 0.5，倾角 26.57°。
    """
    img = load(path).convert("RGBA")
    img.thumbnail((512, 512), Image.LANCZOS)
    a = np.asarray(img)
    fg, bgcol = bg_mask(a)
    comp = largest_component(fg)
    if comp.sum() < 50:
        return {"path": os.path.basename(path), "error": "未找到地块"}
    ys, xs = np.where(comp)
    l, r, t, b = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    H = b - t + 1
    # 下半部分（地面 V 形）——装饰一般在它上方
    y0 = t + int(H * 0.55)
    left, right = [], []
    for y in range(y0, b + 1):
        row = np.where(comp[y])[0]
        if len(row) == 0:
            continue
        left.append((row.min(), y))
        right.append((row.max(), y))
    res = {"path": os.path.basename(path), "canvas": list(img.size), "bbox": [l, t, r, b], "bg": bgcol}
    if len(left) < 6:
        res["error"] = "下半部分前景太少"
        return res
    for name, pts, sign in (("left", left, -1), ("right", right, 1)):
        px = np.array([p[0] for p in pts], float)
        py = np.array([p[1] for p in pts], float)
        k, c = np.polyfit(py, px, 1)  # x = k*y + c
        resid = float(np.abs(px - (k * py + c)).max())
        res[name] = {
            "dx_per_dy": round(float(k), 4),
            "iso_ratio": round(float(abs(k)), 4),   # 每下降 1px 横向外扩多少 px；2:1 等距 = 0.5
            "slope_deg": round(float(math.degrees(math.atan(1 / max(1e-6, abs(k))))), 2),
            "fit_resid_px": round(resid, 2),
            "n": int(len(px)),
        }
    if "left" in res and "right" in res:
        res["iso_ratio"] = round((res["left"]["iso_ratio"] + res["right"]["iso_ratio"]) / 2, 4)
        res["angle_deg"] = round((res["left"]["slope_deg"] + res["right"]["slope_deg"]) / 2, 2)
    if debug:
        ov = img.copy()
        d = ImageDraw.Draw(ov)
        for pts, col in ((left, (255, 0, 0, 255)), (right, (0, 0, 255, 255))):
            for x, y in pts:
                d.point((x, y), fill=col)
        save(ov, os.path.join(os.path.dirname(path), "annot", "ground-" + os.path.splitext(os.path.basename(path))[0] + ".png"))
    return res


if __name__ == "__main__":
    args = sys.argv[1:]
    mode = "json"
    if args and args[0] == "--overlay":
        mode = "overlay"
        args = args[1:]
    elif args and args[0] == "--ground":
        mode = "ground"
        args = args[1:]
    if mode == "ground":
        for p in args:
            r = measure_ground(p)
            if "error" in r:
                print(f"{r['path']}: {r['error']}")
            else:
                print(f"{r['path']}: iso_ratio={r.get('iso_ratio')} angle={r.get('angle_deg')}° "
                      f"L(k={r['left']['dx_per_dy']},resid={r['left']['fit_resid_px']}) "
                      f"R(k={r['right']['dx_per_dy']},resid={r['right']['fit_resid_px']}) bbox={r['bbox']}")
        raise SystemExit(0)
    out = [analyze(p) for p in args]
    if mode == "json":
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        for r in out:
            if "error" in r:
                print(f"{r['path']}: {r['error']}")
                continue
            e = r["edges"]
            print(f"{r['path']}: iou={r['fit']['iou']:.3f} w={r['fit']['w']:.0f} h={r['fit']['h']:.0f} "
                  f"ratio={r['fit']['ratio']:.2f} touch={r['touches_border']} "
                  f"TR={e['top_right'] and e['top_right']['slope_deg']} "
                  f"BR={e['bottom_right'] and e['bottom_right']['slope_deg']} "
                  f"std={r['color_std']}")
