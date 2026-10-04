"""给大型建筑用的「地基网格」模板：4 格菱形 + 亮色轮廓线，AI 照着摆房子。"""
from __future__ import annotations
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("m", os.path.join(os.path.dirname(os.path.abspath(__file__)), "mk-templates2.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
from img import save  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "tpl")
SIZE, SS = 2048, 4

# 用 t2x2 的同一套几何算出 4 个菱形的顶点
rs = cs = [0, 1]
cols = rows = 2
span = (cols + rows) / 2.0
margin = 0.92
tw = min(SIZE * margin / span, SIZE * margin / (span / 2))
th = tw / 2
cx0 = ((0 - 0) + (1 - 1)) / 4.0 * tw
cy0 = ((0 + 0) + (1 + 1)) / 4.0 * th

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
for r in range(rows):
    for c in range(cols):
        cx = SIZE / 2 + (c - r) * tw / 2 - cx0
        cy = SIZE / 2 + (c + r) * th / 2 - cy0
        d.polygon(m.hexa(cx, cy, tw, th), fill=(230, 230, 235, 255), outline=(255, 60, 60, 255), width=max(2, int(tw * 0.004)))
# 外轮廓（大菱形）也描一遍
big = [(SIZE / 2, SIZE / 2 - th), (SIZE / 2 + tw, SIZE / 2), (SIZE / 2, SIZE / 2 + th), (SIZE / 2 - tw, SIZE / 2)]
d.line(big + [big[0]], fill=(255, 0, 255, 255), width=max(3, int(tw * 0.006)))
save(img, os.path.join(OUT, "build-grid-2048.png"))

# 只留外轮廓 + 浅灰填充的版本
img2 = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d2 = ImageDraw.Draw(img2)
d2.polygon(big, fill=(225, 228, 232, 255), outline=(255, 0, 255, 255), width=max(3, int(tw * 0.008)))
for r in range(rows):
    for c in range(cols):
        cx = SIZE / 2 + (c - r) * tw / 2 - cx0
        cy = SIZE / 2 + (c + r) * th / 2 - cy0
        d2.line([m.hexa(cx, cy, tw, th)[1], m.hexa(cx, cy, tw, th)[3]], fill=(150, 155, 165, 255), width=2)
        d2.line([m.hexa(cx, cy, tw, th)[0], m.hexa(cx, cy, tw, th)[2]], fill=(150, 155, 165, 255), width=2)
save(img2, os.path.join(OUT, "build-grid2-2048.png"))
print("ok")
