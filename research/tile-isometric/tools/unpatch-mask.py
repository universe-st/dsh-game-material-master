"""把 jobs/batch6.json 里内联的 mask data URI 还原成占位符。

mask 图由 `tools/mk-masks.py` 生成到 `probe/tpl/`（该目录不入库），
所以作业文件里不该内联 28KB 的 base64 —— 那是二进制数据，且会让 diff 无法阅读。
复跑时先跑 `mk-masks.py`，再跑 `patch-mask.mjs` 把占位符换成真实 data URI。
"""
from __future__ import annotations
import json
import pathlib

p = pathlib.Path(__file__).resolve().parent.parent / "jobs" / "batch6.json"
cfg = json.loads(p.read_text(encoding="utf8"))
n = 0
for i, c in enumerate(cfg["calls"]):
    extra = c.get("extra") or {}
    if "mask" not in extra:
        continue
    # 每次跑的 mask 是同一张，用同一个占位符即可；patch-mask.mjs 会按 id 决定填哪张
    extra["mask"] = "data:image/png;base64,PLACEHOLDER"
    c["extra"] = extra
    n += 1
p.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
print(f"已还原 {n} 处占位符；文件大小 {p.stat().st_size} 字节")
