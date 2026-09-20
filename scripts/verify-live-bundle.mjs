/**
 * 通过宿主的 HMR SSE 通道拿到真实的客户端模块图，再按图里的 URL 取回
 * dsh-game-material-master 的浏览器束，验证运行中的宿主**确实**在提供这份新代码。
 *
 * 为什么要这么绕：浏览器束是按 graph 里的带 rev 的 URL 提供的，
 * 自己拼 `/plugins/<id>/client.js` 一定会 404。
 */
import http from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DSH_VERIFY_PORT ?? 43120);
const TARGET = "dsh-game-material-master";

/** 取回完整响应体（等 `end`，不提前断开——断开会把束截断）。 */
function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path, method: "GET", headers: { host: `${HOST}:${PORT}` } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error(`GET ${path} 超时`));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * SSE 是长连接，这里只要第一帧：拿到完整的一帧（以空行结束）就断开。
 */
function firstSseFrame(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path, method: "GET", headers: { host: `${HOST}:${PORT}` } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (/(?:^|\n)data: [^\n]*\n\n/.test(body)) {
          req.destroy();
          resolve({ status: res.statusCode, body });
        }
      });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(15000, () => req.destroy(new Error(`GET ${path} 超时`)));
    req.on("error", (error) => {
      if (error.code === "ECONNRESET" || error.code === "ERR_STREAM_PREMATURE_CLOSE") return;
      reject(error);
    });
    req.end();
  });
}

const sse = await firstSseFrame("/plugins/events");
const line = sse.body.split("\n").find((row) => row.startsWith("data: "));
if (line === undefined) {
  console.error(`拿不到 graph 帧（HTTP ${sse.status}）：${sse.body.slice(0, 200)}`);
  process.exit(1);
}
const frame = JSON.parse(line.slice(6));
const entries = frame.graph?.entries ?? [];
console.log(`客户端模块图：${entries.length} 个入口`);
const row = entries.find((entry) => entry.id === TARGET);
if (row === undefined) {
  console.error(`图里没有 ${TARGET} —— 运行中的宿主没有挂载这个插件的浏览器半区`);
  console.error(`（图里的入口：${entries.map((entry) => entry.id).join("、")}）`);
  process.exit(1);
}
console.log(`找到入口：${row.id} rev=${row.rev}`);

const bundle = await get(row.url);
console.log(`按图取束：HTTP ${bundle.status}，${bundle.body.length} 字节`);
if (process.env.DSH_VERIFY_DUMP === "1") {
  console.log("── 束开头 ──");
  console.log(bundle.body.slice(0, 800));
  console.log("── 束结尾 ──");
  console.log(bundle.body.slice(-400));
}
// 最后一组标记是「这次改动是否已经在线上生效」的判别词：
// 单方向「重新生成」视频必须把 regenerate 传给宿主（否则宿主会把已完成的方向
// 当成已完成跳过，界面转一圈就结束，失败只留在日志里）。
const markers = ["SPR_ovl", "usePendingTasks", "LoadingOverlay", "BusyBtn", "BusyBadge", "SPR_spinSm", "正在生成", "regenerate"];
const missing = markers.filter((marker) => !bundle.body.includes(marker));
for (const marker of markers) console.log(`  ${missing.includes(marker) ? "✗" : "✓"} ${marker}`);
if (missing.length > 0) {
  console.error(`运行中的宿主提供的束里缺少：${missing.join("、")} —— 浏览器刷新后看不到新反馈`);
  process.exit(1);
}
console.log("运行中的宿主正在提供带 loading 反馈的新浏览器束。");
