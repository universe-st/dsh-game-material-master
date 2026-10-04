"""汇总所有探针的几何精度，产出报告用的统计表。"""
from __future__ import annotations
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import measure_ground  # noqa: E402

SKIP = {"G-building-flash.png", "G-tree-pro.png", "G-bushmany-lite.png"}
GROUPS = [
    ("① 纯文生图 Seedream 4.0（无模板）", ["research/probe/b1/*.jpg"]),
    ("② 纯文生图 Seedream 5.0（堆砌几何约束的长提示词）", ["research/probe/b3/*.jpg", "research/probe/b3/*.png"]),
    ("③ 自由生成 Seedream 5.0（短提示词）", ["research/probe/b5/F-free-bush.png"]),
    ("④ 模板填充 Seedream 5.0 三档模型", ["research/probe/b8/G-*.png"]),
]


def collect(pats, max_resid=12.0):
    vals = []
    for pat in pats:
        for p in sorted(glob.glob(pat)):
            b = os.path.basename(p)
            if b in SKIP or b.endswith("-crop.png") or "-white" in b or "-s." in b or "annot" in p:
                continue
            try:
                r = measure_ground(p)
            except Exception:  # noqa: BLE001
                continue
            if "iso_ratio" not in r:
                continue
            resid = max(r["left"]["fit_resid_px"], r["right"]["fit_resid_px"])
            if resid > max_resid:
                continue
            vals.append((b, r["iso_ratio"], r["angle_deg"], resid))
    return vals


def main():
    print(f"{'方法':52s} {'n':>3s} {'ratio 范围':>16s} {'平均比':>7s} {'平均偏差':>8s} {'|Δ|≤0.05':>9s}")
    rows = []
    for name, pats in GROUPS:
        vals = collect(pats)
        if not vals:
            continue
        rs = [v[1] for v in vals]
        mad = sum(abs(r - 2.0) for r in rs) / len(rs)
        within = sum(1 for r in rs if abs(r - 2.0) <= 0.05) / len(rs) * 100
        print(f"{name:52s} {len(rs):3d} {min(rs):7.3f}~{max(rs):<8.3f} {sum(rs)/len(rs):7.4f} {mad:8.4f} {within:8.0f}%")
        rows.append((name, vals))
    print()
    for name, vals in rows:
        if "模板填充" not in name:
            continue
        print(f"【{name}】逐条：")
        for b, r, a, resid in vals:
            print(f"  {b:26s} ratio={r:.4f}  angle={a:5.2f}°  edge_resid={resid:4.1f}px  相对误差={abs(r-2)/2*100:5.2f}%")
        rs = [v[1] for v in vals]
        print(f"  → 相对误差 max={max(abs(r-2)/2*100 for r in rs):.2f}%  "
              f"mean={sum(abs(r-2)/2 for r in rs)/len(rs)*100:.2f}%  "
              f"角度 mean={sum(v[2] for v in vals)/len(vals):.2f}° (理想 26.565°)")


if __name__ == "__main__":
    main()
