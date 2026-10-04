"""生成 mask 版模板：菱形内部白（要重绘），外部黑（保留）。"""
from __future__ import annotations
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("m", os.path.join(os.path.dirname(os.path.abspath(__file__)), "mk-templates2.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
from img import save  # noqa: E402
from PIL import Image  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "tpl")

# 用同样的菱形几何渲染一张「白菱形 + 黑背景」的 mask
for name, size, cols, rows in [("mask-t1-2048", 2048, 1, 1), ("mask-t2x2-2048", 2048, 2, 2)]:
    white = m.render_diamonds(size, m.grid(cols, rows, (255, 255, 255, 255)), margin=0.92)
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    bg.alpha_composite(white)
    save(bg.convert("RGB"), os.path.join(OUT, name + ".png"))

# 纯白底 + 洋红菱形的「无透明模板」（给不支持透明的模型用）
for name, size, cols, rows in [("white-t1-2048", 2048, 1, 1)]:
    img = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    dia = m.render_diamonds(size, m.grid(cols, rows, (255, 0, 255, 255)), margin=0.92)
    img.alpha_composite(dia)
    save(img.convert("RGB"), os.path.join(OUT, name + ".png"))

# 灰底模板（用地面平均色起手，减少「留底色」的概率）
for name, size, cols, rows, col in [("gray-t1-2048", 2048, 1, 1, (150, 150, 150, 255)),
                                    ("brown-t1-2048", 2048, 1, 1, (165, 130, 90, 255))]:
    dia = m.render_diamonds(size, m.grid(cols, rows, col), margin=0.92)
    save(dia, os.path.join(OUT, name + ".png"))

print("ok")
