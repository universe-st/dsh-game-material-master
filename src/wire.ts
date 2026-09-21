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
/**
 * 审核模式：`auto` = agent 自己审完就往下走；`manual` = 每一步都停下来等用户看。
 * 固定流程里必须先问用户选哪个，选完记在目标上，之后所有步骤都按它走。
 */
const setReviewModeSchema = z.object({
  id: z.string(),
  /** 四个模块都要能设审核模式——骨骼动画（rig）早期漏了，见 index.ts 的注释。 */
  module: z.enum(["sprite", "image", "sequence", "rig"]),
  reviewMode: z.enum(["auto", "manual"])
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
  keying: z.record(z.string(), z.unknown()).optional(),
  /** 验收打标：不带 index 就是整个任务，带 index 只改那一张。 */
  approved: z.boolean().optional(),
  index: z.number().nullable().optional()
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
  keying: z.record(z.string(), z.unknown()).optional(),
  /** 验收打标：不带 step 就是三步全打，带 step 只改那一步。 */
  approved: z.boolean().optional(),
  step: z.enum(["video", "frames", "sheet"]).nullable().optional()
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

// ── 骨骼动画生成模块 ────────────────────────────────────────────────────
const rigJobIdSchema = z.object({ jobId: z.string() });
const createRigJobSchema = z.object({ name: z.string().optional() });
const saveRigJobSchema = z.object({
  jobId: z.string(),
  name: z.string().optional(),
  /** 拆件提示词与统一附加提示词。 */
  sheetPrompt: z.string().optional(),
  suffix: z.string().optional(),
  resetSheetPrompt: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  /** 验收打标：不带 stage 就是全部阶段，带 stage 只改那一个。 */
  approved: z.boolean().optional(),
  stage: z.enum(["parts", "layout", "rig", "atlas"]).nullable().optional(),
  /** 只对某个部件打通过（配合 stage="parts"）。 */
  part: z.string().nullable().optional()
});
const uploadRigSourceSchema = z.object({ jobId: z.string(), name: z.string().optional(), data: z.string() });
const uploadRigPartSchema = z.object({ jobId: z.string(), name: z.string().optional(), data: z.string() });
const removeRigPartSchema = z.object({ jobId: z.string(), name: z.string() });
const renameRigPartSchema = z.object({ jobId: z.string(), from: z.string(), to: z.string() });
const rigPartFlagSchema = z.object({ jobId: z.string(), name: z.string(), hidden: z.boolean() });
const rigLayoutItemSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  z: z.number().optional()
});
const runRigLayoutSchema = z.object({ jobId: z.string(), names: z.array(z.string()).optional() });
const saveRigLayoutItemsSchema = z.object({
  jobId: z.string(),
  /** 一次手动装配动作里的全部改动（拖动 / 缩放 / 键盘微调 / 改层级）。 */
  items: z.array(
    z.object({
      name: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      rotation: z.number().optional(),
      z: z.number().optional(),
      /** false = 收回未摆放状态（从画布上取下来）。 */
      placed: z.boolean().optional()
    })
  )
});
const setRigLayoutHintsSchema = z.object({
  jobId: z.string(),
  /**
   * 部件名 → 它在参考图里的大致像素框；传 null 表示清除该部件的先验。
   * 由多模态模型看一眼图给出来（对话里就是 agent 自己），不需要精确。
   */
  hints: z.record(
    z.string(),
    z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .nullable()
  )
});
/**
 * 语义层（阶段③）。
 *
 * 只传**要改的字段**：这是细粒度失效传播的前提——改一个部件的 `parent`
 * 不该让整份语义表重新生成，也不该丢掉别人调过的锚点。
 */
/**
 * 手工骨骼偏移（三通道的中间那一层）。
 *
 * 只传要改的字段；`origin` 由布局与语义算出来、每次重跑都会重算，
 * 而这里写下的偏置**任何自动重跑都不碰**（重跑骨骼、重跑装配、改语义都不影响它）。
 * 全零的条目会被自动删除——「改回去了」等于「没有这条记录」。
 */
const setRigBoneOffsetsSchema = z.object({
  jobId: z.string(),
  bones: z.array(
    z.object({
      name: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      rotation: z.number().optional()
    })
  ),
  by: z.enum(["ai", "human"]).optional(),
  label: z.string().optional()
});
const resetRigBoneOffsetsSchema = z.object({
  jobId: z.string(),
  /** 不传或传空数组 = 清除全部手工偏移。 */
  names: z.array(z.string()).optional()
});
/**
 * 动画参数（M3）。
 *
 * 只传要改的字段；两个旋钮覆盖绝大多数真实诉求：
 *   - `amplitude` 统一缩放旋转与位移（「动作太大了」）；
 *   - `duration`  改一个循环的时长（「这是慢节奏的 NPC」）。
 * 「生成哪些动作」仍由 `saveRigJob` 的 `settings.animations` 决定，不在这里重复。
 */
const setRigAnimationSettingsSchema = z.object({
  jobId: z.string(),
  animations: z.array(
    z.object({
      id: z.string(),
      duration: z.number().optional(),
      amplitude: z.number().optional()
    })
  ),
  by: z.enum(["ai", "human"]).optional()
});
const resetRigAnimationSettingsSchema = z.object({
  jobId: z.string(),
  /** 不传或传空数组 = 重置全部。 */
  ids: z.array(z.string()).optional()
});
/**
 * 贴图版本（阶段⑦）。
 *
 * 每一次换色 / 重绘 / 手工上传都**新增一版**，永不覆盖原图——于是「这张不行
 * 换回原版」是改一个字段，而且每一版都可复现、可审计。
 */
const setRigTextureVersionSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  version: z.number()
});
const removeRigTextureVersionSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  version: z.number()
});
/** 换色参数；滑杆取值域抄自 reskin-app 的 `imaging.py`。 */
const tintSchema = z.object({
  hue: z.number().optional(),
  saturation: z.number().optional(),
  lightness: z.number().optional(),
  brightness: z.number().optional(),
  contrast: z.number().optional(),
  rgb: z.tuple([z.number(), z.number(), z.number()]).optional()
});
const tintRigPartsSchema = z.object({
  jobId: z.string(),
  /** 点名几个部件；与 `tag` 二选一。 */
  names: z.array(z.string()).optional(),
  /** 或者按语义标签批量（`tags` 来自语义层）。 */
  tag: z.string().optional(),
  tint: tintSchema,
  note: z.string().optional(),
  by: z.enum(["ai", "human"]).optional()
});
const uploadRigTextureSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  /** 原始文件字节的 base64（不带 data: 前缀）。 */
  data: z.string(),
  note: z.string().optional()
});
const setRigSemanticsSchema = z.object({
  jobId: z.string(),
  parts: z.array(
    z.object({
      name: z.string(),
      role: z.string().optional(),
      /** null 表示挂到 root。 */
      parent: z.string().nullable().optional(),
      proximal: z.tuple([z.number(), z.number()]).optional(),
      distal: z.tuple([z.number(), z.number()]).optional(),
      tags: z.array(z.string()).optional()
    })
  ),
  /** 强制按人形校验（不给时按「有没有 head 角色」自动判断）。 */
  humanoid: z.boolean().optional(),
  /** 改动来源，用于把 `semanticsSource` 记成 ai 还是 human。 */
  by: z.enum(["ai", "human"]).optional()
});

/**
 * 浏览器半区上报自己真实的 `location.origin`。
 *
 * 宿主不知道对外 origin（可能被反代改写过），而模型要在回复里贴出可点的
 * 深链接，只能由页面自己上报一次。见 src/links.ts。
 */
const reportOriginSchema = z.object({ origin: z.string() });

interface MethodSpec {
  method: string;
  payload?: z.ZodType;
  result: z.ZodType;
  /**
   * 只给浏览器半区用、**不暴露给模型工具**的方法。
   * `game_material_call` 的 method 枚举会跳过它们。
   */
  clientOnly?: boolean;
}

export const METHODS: MethodSpec[] = [
  { method: "getConfig", result: configViewSchema },
  { method: "saveConfig", payload: saveConfigSchema, result: configViewSchema },
  { method: "testArk", result: jsonObject },
  { method: "testMinimax", result: jsonObject },
  // 浏览器半区在挂载时上报 origin，供宿主拼深链接；不是用户可调用的功能。
  { method: "reportClientOrigin", payload: reportOriginSchema, result: okSchema, clientOnly: true },

  { method: "listProjects", result: projectListSchema },
  { method: "createProject", payload: createProjectSchema, result: jsonObject },
  { method: "getProject", payload: projectIdSchema, result: projectViewSchema },
  { method: "deleteProject", payload: projectIdSchema, result: okSchema },
  { method: "renameProject", payload: renameSchema, result: okSchema },
  { method: "uploadSource", payload: uploadSchema, result: okSchema },
  { method: "savePrompts", payload: promptsSchema, result: okSchema },
  { method: "saveSettings", payload: settingsSchema, result: okSchema },
  { method: "setApproved", payload: approvedSchema, result: okSchema },
  { method: "setReviewMode", payload: setReviewModeSchema, result: okSchema },
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
  { method: "composeSequence", payload: sequenceJobIdSchema, result: startedSchema },

  // 骨骼动画生成
  { method: "listRigJobs", result: z.object({ jobs: z.array(jsonObject) }) },
  { method: "createRigJob", payload: createRigJobSchema, result: jsonObject },
  { method: "getRigJob", payload: rigJobIdSchema, result: projectViewSchema },
  { method: "deleteRigJob", payload: rigJobIdSchema, result: okSchema },
  { method: "saveRigJob", payload: saveRigJobSchema, result: okSchema },
  { method: "uploadRigSource", payload: uploadRigSourceSchema, result: okSchema },
  { method: "uploadRigPart", payload: uploadRigPartSchema, result: okSchema },
  { method: "removeRigPart", payload: removeRigPartSchema, result: okSchema },
  { method: "renameRigPart", payload: renameRigPartSchema, result: okSchema },
  { method: "setRigPartVisibility", payload: rigPartFlagSchema, result: okSchema },
  { method: "saveRigLayoutItem", payload: rigLayoutItemSchema, result: okSchema },
  { method: "saveRigLayoutItems", payload: saveRigLayoutItemsSchema, result: okSchema },
  { method: "setRigLayoutHints", payload: setRigLayoutHintsSchema, result: okSchema },
  { method: "setRigSemantics", payload: setRigSemanticsSchema, result: jsonObject },
  { method: "setRigBoneOffsets", payload: setRigBoneOffsetsSchema, result: jsonObject },
  { method: "resetRigBoneOffsets", payload: resetRigBoneOffsetsSchema, result: jsonObject },
  { method: "setRigAnimationSettings", payload: setRigAnimationSettingsSchema, result: jsonObject },
  { method: "resetRigAnimationSettings", payload: resetRigAnimationSettingsSchema, result: jsonObject },
  { method: "tintRigParts", payload: tintRigPartsSchema, result: jsonObject },
  { method: "uploadRigTexture", payload: uploadRigTextureSchema, result: jsonObject },
  { method: "setRigTextureVersion", payload: setRigTextureVersionSchema, result: jsonObject },
  { method: "removeRigTextureVersion", payload: removeRigTextureVersionSchema, result: jsonObject },
  { method: "runRigSheet", payload: rigJobIdSchema, result: startedSchema },
  { method: "runRigSegment", payload: rigJobIdSchema, result: startedSchema },
  { method: "runRigLayout", payload: runRigLayoutSchema, result: startedSchema },
  { method: "runRigBones", payload: rigJobIdSchema, result: startedSchema },
  { method: "runRigAtlas", payload: rigJobIdSchema, result: startedSchema }
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
export const METHOD_NAMES: Array<{ method: string; payload: boolean; clientOnly: boolean }> = METHODS.map((spec) => ({
  method: spec.method,
  payload: spec.payload !== undefined,
  clientOnly: spec.clientOnly === true
}));

/**
 * 暴露成模型工具的方法（`game_material_call` 的 method 枚举）。
 * 顺序即清单顺序，方便在工具描述里按模块分组。
 */
export const TOOL_METHODS: Array<{ method: string; payload: boolean }> = METHODS.filter(
  (spec) => spec.clientOnly !== true
).map((spec) => ({ method: spec.method, payload: spec.payload !== undefined }));
