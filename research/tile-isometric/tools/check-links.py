"""校验 md 里的相对链接与图片是否真实存在（跳过 http / 锚点 / 绝对路径）。"""
from __future__ import annotations
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]   # tools -> tile-isometric -> research -> 仓库根
DOCS = [
    ROOT / "docs/地图地块生成-产品文档.md",
    ROOT / "docs/地图地块生成-开发计划.md",
    ROOT / "docs/ENGINEERING.md",
    ROOT / "docs/骨骼动画生成-重开发方案.md",
    ROOT / "research/README.md",
    ROOT / "research/tile-isometric/tile-isometric-research-report.md",
    ROOT / "README.md",
    ROOT / "README.en.md",
]
LINK = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
KNOWN_PRE_EXISTING = {("docs/ENGINEERING.md", "LICENSE")}

bad, total = [], 0
for doc in DOCS:
    if not doc.exists():
        bad.append((str(doc), "文档不存在"))
        continue
    for m in LINK.finditer(doc.read_text(encoding="utf8")):
        t = m.group(1).strip()
        if t.startswith(("http://", "https://", "mailto:", "#", "file:", "/")):
            continue
        rel = t.split("#")[0].strip()
        if not rel:
            continue
        total += 1
        if not (doc.parent / rel).resolve().exists():
            pair = (str(doc.relative_to(ROOT)).replace("\\", "/"), t)
            if pair in KNOWN_PRE_EXISTING:
                print(f"-- 已知遗留断链（非本次改动）: {pair[0]} -> {t}")
                continue
            bad.append(pair)

print(f"\n共检查 {total} 条相对链接")
if bad:
    for d, t in bad:
        print(f"!! 断链 {d} -> {t}")
    sys.exit(1)
print("全部通过")
