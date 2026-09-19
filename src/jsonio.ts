/**
 * 新模块共用的 JSON 落盘助手。
 *
 * 三个功能模块（八方向图 / 图片生成 / 序列帧生成）各自独立存目录，
 * 但「原子写 + 读文件 + 日志裁剪」这几件事是一样的，抽在这里避免重复。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export function appendJobLog(log: JobLogEntry[], level: JobLogEntry["level"], message: string, limit = 200): void {
  log.push({ at: Date.now(), level, message });
  if (log.length > limit) log.splice(0, log.length - limit);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
