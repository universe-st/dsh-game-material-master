/**
 * 新模块共用的 JSON 落盘助手。
 *
 * 三个功能模块（八方向图 / 图片生成 / 序列帧生成）各自独立存目录，
 * 但「原子写 + 读文件 + 日志裁剪」这几件事是一样的，抽在这里避免重复。
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface JobLogEntry {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * 先写临时文件再 rename，避免写到一半崩溃留下半个 JSON。
 *
 * 临时文件名必须**每次唯一**：轮询器和用户操作可能同时写同一个 job.json，
 * 共用一个 `.tmp` 名字时，先完成的 rename 会把临时文件移走，后一个就会
 * ENOENT（实测踩过）。
 *
 * ⚠️ Windows 上 `rename` 会被**暂时占用目标文件的进程**挡下来，报
 * `EPERM: operation not permitted`（杀软扫描、索引器，或同一进程里另一个
 * 还没释放句柄的写）。实测：用户点「保存布局」时后台恰好在收尾写同一次
 * project.json，就报「保存失败」，而且**几次都一样**，看起来像功能坏了。
 * 所以这里要重试；重试仍失败就清掉临时文件再抛，别留一地 `.tmp`。
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  let lastError: unknown;
  // 实测 225ms 不够：杀软/索引器的扫描句柄能占住几百毫秒。
  // 8 次、递增到 240ms，总共约 1.1s —— 用户点一次保存等得住，
  // 而这一点延迟远好过报一句「保存失败」。
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (error) {
      lastError = error;
      // EPERM / EBUSY / EACCES 都是「目标被占着」，等一下再试；
      // 其它错误（比如路径不存在）重试也没意义
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(240, 30 * (attempt + 1))));
    }
  }
  await rm(tmp, { force: true }).catch(() => undefined);
  throw lastError;
}

/**
 * 清掉某个目录里遗留的 `*.tmp`（写失败留下的）。
 *
 * `writeJsonAtomic` 失败时会尽力删掉自己的临时文件，但**进程被杀**
 * （DSH 重启、任务管理器结束）时来不及 —— 实测在项目目录里留下过
 * `project.json.fa69b405.tmp`。它们不会被读，只会越积越乱，
 * 所以在读项目时顺手扫一次。
 */
export async function sweepTempFiles(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.endsWith(".tmp"))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => undefined))
  );
}

export function appendJobLog(log: JobLogEntry[], level: JobLogEntry["level"], message: string, limit = 200): void {
  log.push({ at: Date.now(), level, message });
  if (log.length > limit) log.splice(0, log.length - limit);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
