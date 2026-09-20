/**
 * gameStudio 远程服务的 wire 协议。
 *
 * 约定：**每个方法只有一个 `payload` 对象参数**（无参方法则为空）。
 * 这样一份 manifest 描述符就能同时被宿主网关和浏览器半区复用，
 * 不必为每个字段单独写一遍 positional 参数描述。
 */

import { z } from "zod";

/** 复杂返回体（配置视图、项目视图）用宽松的 JSON 对象，避免协议层过度约束。 */
const jsonObject = z.record(z.string(), z.unknown());
const startedSchema = z.object({ started: z.boolean(), reason: z.string().optional() });
const okSchema = z.object({ ok: z.boolean(), message: z.string().optional() });
const configViewSchema = jsonObject;
const projectViewSchema = jsonObject;
const projectListSchema = z.object({ projects: z.array(jsonObject) });

const saveConfigSchema = z.record(z.string(), z.unknown());

const createProjectSchema = z.object({ name: z.string().optional() });
const projectIdSchema = z.object({ projectId: z.string() });
const renameSchema = z.object({ projectId: z.string(), name: z.string() });
const uploadSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  /** 原始文件字节的 base64（不带 data: 前缀）。 */
  data: z.string()
});
const promptsSchema = z.object({
  projectId: z.string(),
  images: z.record(z.string(), z.string()).optional(),
  video: z.string().optional(),
  videoPerDirection: z.record(z.string(), z.string()).optional(),
  /** 统一附加提示词：追加到每个方向的生图提示词末尾；空串表示关闭。 */
  suffix: z.string().optional(),
  /** 一键把八个方向的生图提示词重置为当前默认模板。 */
  resetImagesToDefault: z.boolean().optional(),
  /** 一键把视频提示词重置为当前默认模板。 */
  resetVideoToDefault: z.boolean().optional()
});
const settingsSchema = z.object({ projectId: z.string(), settings: z.record(z.string(), z.unknown()) });
const approvedSchema = z.object({
  projectId: z.string(),
  stage: z.enum(["images", "videos", "frames", "sheet"]),
  key: z.string().optional(),
  approved: z.boolean()
});
const runImageSchema = z.object({ projectId: z.string(), key: z.string(), prompt: z.string().optional() });
const runImagesSchema = z.object({ projectId: z.string(), force: z.boolean().optional() });
const runKeysSchema = z.object({ projectId: z.string(), keys: z.array(z.string()).optional() });
const runVideosSchema = z.object({
  projectId: z.string(),
  keys: z.array(z.string()).optional(),
  /**
   * 「重新生成」：已经完成的视频也重新提交。
   *
   * 不带这个标记时 `runVideos` 会跳过 ready 的方向（防止重复提交把任务覆盖成
   * 无人认领的孤儿），所以单方向「重新生成」必须显式声明，宿主才知道要先作废
   * 旧视频与它抽出来的帧。必须与 `keys` 一起用：批量提交带这个标记会把八段
   * 视频全部重跑一遍（真金白银）。
   */
  regenerate: z.boolean().optional()
});

// ── 图片生成模块 ────────────────────────────────────────────────────────
const imageJobIdSchema = z.object({ jobId: z.string() });
const createImageJobSchema = z.object({ name: z.string().optional() });
const saveImageJobSchema = z.object({
  jobId: z.string(),
  name: z.string().optional(),
  prompt: z.string().optional(),
  suffix: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  keying: z.record(z.string(), z.unknown()).optional()
});
const uploadSchema2 = z.object({ jobId: z.string(), name: z.string().optional(), data: z.string() });
const removeRefSchema2 = z.object({ jobId: z.string(), file: z.string() });
const removeItemSchema2 = z.object({ jobId: z.string(), index: z.number() });
const runImageJobSchema = z.object({ jobId: z.string(), count: z.number().optional() });

// ── 序列帧生成模块 ──────────────────────────────────────────────────────
const sequenceJobIdSchema = z.object({ jobId: z.string() });
const createSequenceJobSchema = z.object({ name: z.string().optional() });
const saveSequenceJobSchema = z.object({
  jobId: z.string(),
  name: z.string().optional(),
  mode: z.enum(["frames", "reference"]).optional(),
  prompt: z.string().optional(),
  suffix: z.string().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  keying: z.record(z.string(), z.unknown()).optional()
});
const uploadSequenceRefSchema = z.object({
  jobId: z.string(),
  kind: z.enum(["firstFrame", "lastFrame", "referenceImage", "referenceVideo"]),
  name: z.string().optional(),
  data: z.string()
});
const removeSequenceRefSchema = z.object({
  jobId: z.string(),
  kind: z.enum(["firstFrame", "lastFrame", "referenceImage", "referenceVideo"]),
  file: z.string().optional()
});
const runSequenceFramesSchema = z.object({ jobId: z.string(), count: z.number().optional() });
const projectOnlySchema = z.object({ projectId: z.string() });

interface MethodSpec {
  method: string;
  payload?: z.ZodType;
  result: z.ZodType;
}

export const METHODS: MethodSpec[] = [
  { method: "getConfig", result: configViewSchema },
  { method: "saveConfig", payload: saveConfigSchema, result: configViewSchema },
  { method: "testArk", result: jsonObject },
  { method: "testMinimax", result: jsonObject },

  { method: "listProjects", result: projectListSchema },
  { method: "createProject", payload: createProjectSchema, result: jsonObject },
  { method: "getProject", payload: projectIdSchema, result: projectViewSchema },
  { method: "deleteProject", payload: projectIdSchema, result: okSchema },
  { method: "renameProject", payload: renameSchema, result: okSchema },
  { method: "uploadSource", payload: uploadSchema, result: okSchema },
  { method: "savePrompts", payload: promptsSchema, result: okSchema },
  { method: "saveSettings", payload: settingsSchema, result: okSchema },
  { method: "setApproved", payload: approvedSchema, result: okSchema },
  { method: "revealProject", payload: projectIdSchema, result: okSchema },

  { method: "runImage", payload: runImageSchema, result: startedSchema },
  { method: "runImages", payload: runImagesSchema, result: startedSchema },
  { method: "runVideos", payload: runVideosSchema, result: startedSchema },
  { method: "pollVideos", payload: projectOnlySchema, result: okSchema },
  { method: "clearVideos", payload: runKeysSchema, result: okSchema },
  { method: "runFrames", payload: runKeysSchema, result: startedSchema },
  { method: "rekey", payload: projectOnlySchema, result: startedSchema },
  { method: "compose", payload: projectOnlySchema, result: startedSchema },

  // 图片生成
  { method: "listImageJobs", result: z.object({ jobs: z.array(jsonObject) }) },
  { method: "createImageJob", payload: createImageJobSchema, result: jsonObject },
  { method: "getImageJob", payload: imageJobIdSchema, result: projectViewSchema },
  { method: "deleteImageJob", payload: imageJobIdSchema, result: okSchema },
  { method: "saveImageJob", payload: saveImageJobSchema, result: okSchema },
  { method: "uploadImageRef", payload: uploadSchema2, result: okSchema },
  { method: "removeImageRef", payload: removeRefSchema2, result: okSchema },
  { method: "addImageItem", payload: uploadSchema2, result: okSchema },
  { method: "removeImageItem", payload: removeItemSchema2, result: okSchema },
  { method: "runImageJob", payload: runImageJobSchema, result: startedSchema },
  { method: "keyImageJob", payload: imageJobIdSchema, result: startedSchema },

  // 序列帧生成
  { method: "listSequenceJobs", result: z.object({ jobs: z.array(jsonObject) }) },
  { method: "createSequenceJob", payload: createSequenceJobSchema, result: jsonObject },
  { method: "getSequenceJob", payload: sequenceJobIdSchema, result: projectViewSchema },
  { method: "deleteSequenceJob", payload: sequenceJobIdSchema, result: okSchema },
  { method: "saveSequenceJob", payload: saveSequenceJobSchema, result: okSchema },
  { method: "uploadSequenceRef", payload: uploadSequenceRefSchema, result: okSchema },
  { method: "removeSequenceRef", payload: removeSequenceRefSchema, result: okSchema },
  { method: "runSequenceVideo", payload: sequenceJobIdSchema, result: startedSchema },
  { method: "pollSequenceVideo", payload: sequenceJobIdSchema, result: okSchema },
  { method: "clearSequenceVideo", payload: sequenceJobIdSchema, result: okSchema },
  { method: "runSequenceFrames", payload: runSequenceFramesSchema, result: startedSchema },
  { method: "keySequenceFrames", payload: sequenceJobIdSchema, result: startedSchema },
  { method: "composeSequence", payload: sequenceJobIdSchema, result: startedSchema }
];

export const PACKAGE_NAME = "dsh-game-material-master";
export const SERVICE_NAME = "gameStudio";

/** 注册给宿主 typert 网关的 package face。 */
export const MANIFEST = {
  package: PACKAGE_NAME,
  face: "host" as const,
  schemas: [],
  invocations: METHODS.map((spec) => ({
    id: `${PACKAGE_NAME}#${SERVICE_NAME}/${spec.method}`,
    service: SERVICE_NAME,
    namespace: SERVICE_NAME,
    method: spec.method,
    invocation: { kind: "direct" as const },
    parameters:
      spec.payload === undefined
        ? []
        : [
            {
              name: "payload",
              wire: "payload",
              source: "json" as const,
              codec: { mode: "strict" as const, typeSymbol: `${PACKAGE_NAME}#${spec.method}Payload`, schema: spec.payload }
            }
          ],
    result: { mode: "strict" as const, typeSymbol: `${PACKAGE_NAME}#${spec.method}Result`, schema: spec.result }
  })),
  model: { services: [], events: [], objects: [] }
};

/** 客户端只需要方法名与是否有 payload；这里导出给浏览器半区复用同一张清单。 */
export const METHOD_NAMES: Array<{ method: string; payload: boolean }> = METHODS.map((spec) => ({
  method: spec.method,
  payload: spec.payload !== undefined
}));
