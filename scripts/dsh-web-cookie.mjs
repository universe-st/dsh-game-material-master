#!/usr/bin/env node
/**
 * 为 Playwright 测试生成 DSH Web 的浏览器会话 cookie。
 *
 * 背景：DSH Web 的每个 Host RPC 都要求同一个「浏览器会话」。
 *   - `dsh web` 启动时生成一个**进程级随机启动令牌**，把它作为 `?token=...`
 *     放在根 URL 上打印出来；
 *   - `GET /?token=<该令牌>` 会写入一个绑定 authority 的签名 cookie，然后 303 到干净的 `/`；
 *   - 之后所有请求靠这个 cookie 认证，缺失/过期/authority 不匹配都会在 RPC 分发前 401。
 *
 * 启动令牌只存在于进程内存里，脚本无法取得。但 cookie 的签名密钥是**持久化**的：
 * 它落在 `$DSH_HOME/.credentials.yaml` 的 `client-connection/browser-session` grant 里。
 * 所以本脚本按同一套算法（`dsh-client-connection/lib/index.js` 的
 * `cookieName` / `encodeCookie` / `signature`）自行派生一份合法 cookie，
 * 供无头浏览器直接注入——不需要去猜那个进程内令牌。
 *
 * 用法：
 *   node scripts/dsh-web-cookie.mjs                      # 打印 cookie 名与值（默认 127.0.0.1:43120）
 *   node scripts/dsh-web-cookie.mjs 127.0.0.1:43120
 *   node scripts/dsh-web-cookie.mjs --json               # 打印 {name,value,authority,expiresAt}
 *   node scripts/dsh-web-cookie.mjs --stamp <文件>        # 把 name=value;... 写进文件，供 playwright 读取
 *
 * 注意：这是**本机测试辅助**，不修改任何服务端状态；删除 `.credentials.yaml` 里的该记录
 * 即可让所有已签发的 cookie 一起失效。
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const COOKIE_PREFIX = "dsh-auth-";
const COOKIE_PAYLOAD_VERSION = 1;
const STORED_SECRET_VERSION = 1;
const SECRET_BYTES = 32;
const DAY_MILLISECONDS = 1440 * 60 * 1000;
/** 与服务端默认 `cookieMaxAgeDays` 一致；cookie 的有效期不能超过它。 */
const MAX_AGE_DAYS = 30;

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return undefined;
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/") + padding, "base64");
  return encodeBase64Url(decoded) === value ? decoded : undefined;
}

/** cookie 名绑定 authority：`dsh-auth-` + base64url(sha256(authority))。 */
function cookieName(authority) {
  return COOKIE_PREFIX + encodeBase64Url(createHash("sha256").update(authority).digest());
}

function signature(secret, body) {
  return createHmac("sha256", secret).update(body).digest();
}

function encodeCookie(payload, secret) {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `v1.${body}.${encodeBase64Url(signature(secret, body))}`;
}

function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/**
 * 从 `.credentials.yaml` 里取出 32 字节签名密钥。
 *
 * 不引入 YAML 依赖：这里只需要定位 `client-connection/browser-session` 记录下的
 * `secret: <base64url>` 一行——它在本机这份文件里是唯一出现该键的位置。
 */
async function readSecret() {
  const file = join(dshHome(), ".credentials.yaml");
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(`读不到 ${file}：DSH 可能还没启动过 Web 半区，或 DSH_HOME 不对`);
  }
  const block = text.split(/\r?\n/).findIndex((line) => line.includes("client-connection/browser-session"));
  if (block === -1) throw new Error(`${file} 里没有 client-connection/browser-session 记录（从未启动过 dsh web？）`);
  // 只在该记录之后的若干行里找 secret，避免误取别的凭据（例如某个 API Key 的 refs）。
  for (let i = block; i < Math.min(block + 12, text.split(/\r?\n/).length); i++) {
    const line = text.split(/\r?\n/)[i];
    const match = /^\s*secret:\s*(\S+)\s*$/u.exec(line);
    if (match === null) continue;
    const decoded = decodeBase64Url(match[1]);
    if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) {
      throw new Error("凭据里的 secret 不是 32 字节 base64url，格式与预期不符");
    }
    return decoded;
  }
  throw new Error("在 browser-session 记录里没找到 secret 字段");
}

/** 规范化 authority：与服务端 `new URL('http://' + host).host` 完全一致。 */
function canonicalAuthority(input) {
  try {
    return new URL(`http://${input}`).host;
  } catch {
    throw new Error(`authority 不合法：${input}`);
  }
}

const argv = process.argv.slice(2);
const jsonMode = argv.includes("--json");
const stampIndex = argv.indexOf("--stamp");
const stampPath = stampIndex === -1 ? undefined : argv[stampIndex + 1];
// `--stamp <path>` 的那一项是选项的值，不是位置参数。（`stampIndex === -1` 时
// 不能拿 `-1 + 1 = 0` 去排除，否则第一个位置参数会被吃掉——这正是最初写成
// 一行 filter 时踩的坑。）
const stampValueIndex = stampIndex === -1 ? -1 : stampIndex + 1;
const positional = argv.filter((item, index) => !item.startsWith("--") && index !== stampValueIndex);
const authority = canonicalAuthority(positional[0] ?? "127.0.0.1:43120");

const secret = await readSecret();
const issuedAt = Date.now();
const expiresAt = issuedAt + MAX_AGE_DAYS * DAY_MILLISECONDS;
const name = cookieName(authority);
const value = encodeCookie({ version: COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt }, secret);

// 自检：把生成的 cookie 按服务端的 decode 逻辑验一遍，避免「生成了但服务端不认」。
{
  const parts = value.split(".");
  const body = parts[1];
  const actual = decodeBase64Url(parts[2]);
  const expected = signature(secret, body);
  if (parts.length !== 3 || parts[0] !== "v1" || actual === undefined) throw new Error("自检失败：cookie 结构不对");
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    throw new Error("自检失败：签名不匹配");
  }
  const payload = JSON.parse(decodeBase64Url(body).toString("utf8"));
  if (payload.authority !== authority || payload.version !== COOKIE_PAYLOAD_VERSION) {
    throw new Error("自检失败：payload 字段不对");
  }
}

const result = { name, value, authority, issuedAt, expiresAt };
if (stampPath !== undefined) {
  await writeFile(stampPath, `${name}=${value}\n`, "utf8");
  console.log(`已写入 ${stampPath}`);
} else if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`authority: ${authority}`);
  console.log(`name:      ${name}`);
  console.log(`value:     ${value}`);
  console.log(`expires:   ${new Date(expiresAt).toISOString()}`);
}

export { cookieName, encodeCookie, canonicalAuthority, readSecret, MAX_AGE_DAYS };
