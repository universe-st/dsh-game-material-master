"""从参考图里切出单块地块，做成参考图（放大 4 倍，白底/透明底各一份）。"""
from __future__ import annotations
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from img import load, save  # noqa: E402
from PIL import Image  # noqa: E402

REF = r"C:\Users\kuang\Desktop\b28436693ce40fc5e9e0c415783f278b47292ef3.png"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "probe", "ref")

im = load(REF)
W = 64
H = 64
print(f"tile size = {W}x{H}, sheet={im.size} -> 正好 {im.width//W} x {im.height//H} 格")


def crop(idx: int):
    r, c = divmod(idx, 4)
    return im.crop((c * W, r * H, (c + 1) * W, (r + 1) * H))


# 命名：按内容（肉眼判断，见 measure_ref 的 ascii）
names = {
    0: "grass-plain",
    2: "grass-plain2",
    4: "bush-green",
    8: "grass-flowers",
    9: "rock-grass",
    10: "tree",
    16: "forest",
    17: "pine",
    18: "bush-trees",
    19: "flowers-sun",
    20: "flowerbed",
}

for idx, name in names.items():
    t = crop(idx)
    big = t.resize((W * 4, H * 4), Image.Resampling.NEAREST)
    save(big, os.path.join(OUT, f"ref-{idx:02d}-{name}.png"))
    # 白底版（部分模型对纯透明背景会脑补棋盘格）
    white = Image.new("RGBA", big.size, (255, 255, 255, 255))
    white.alpha_composite(big)
    save(white.convert("RGB"), os.path.join(OUT, f"ref-{idx:02d}-{name}-white.png"))

# 整张参考图也复制一份到 probe/ref 方便引用
save(im, os.path.join(OUT, "ref-sheet.png"))
print("wrote", sorted(os.listdir(OUT)))
