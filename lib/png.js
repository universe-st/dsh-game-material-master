/**
 * 极简 PNG 编码器（RGBA8）。
 *
 * 为什么不引第三方库：整个流程只需要「把 RGBA 缓冲区写成 PNG」这一件事，
 * 用 node:zlib 的 deflate 手写 ~70 行即可，比拉一个图像库依赖靠谱得多。
 * 解码方向完全不需要——所有解码都交给 ffmpeg（视频 → rawvideo rgba）。
 */
import { deflateSync } from "node:zlib";
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();
function crc32(buffer) {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i++)
        c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBytes = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
    return Buffer.concat([length, typeBytes, data, crc]);
}
/** 把 `width * height * 4` 字节的 RGBA 缓冲编码成 PNG。 */
export function encodePng(rgba, width, height) {
    const expected = width * height * 4;
    if (rgba.length < expected) {
        throw new Error(`RGBA 缓冲区太小：需要 ${expected} 字节，实际 ${rgba.length} 字节`);
    }
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: truecolour with alpha
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace
    const stride = width * 4;
    const filtered = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        const rowStart = y * (stride + 1);
        filtered[rowStart] = 0; // filter type 0 (None)
        rgba.copy(filtered, rowStart + 1, y * stride, y * stride + stride);
    }
    const idat = deflateSync(filtered, { level: 6 });
    return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
