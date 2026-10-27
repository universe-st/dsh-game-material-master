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
const previewStartedSchema = z.object({
  started: z.boolean(),
  reason: z.string().optional(),
  previewPath: z.string().optional(),
  revisionAtStart: z.string().optional()
});
const okSchema = z.object({ ok: z.boolean(), message: z.string().optional() });
const configViewSchema = jsonObject;
const projectViewSchema = jsonObject;
const projectListSchema = z.object({ projects: z.array(jsonObject) });

const saveConfigSchema = z.record(z.string(), z.unknown());

const createProjectSchema = z.object({ name: z.string().optional() });
const projectIdSchema = z.object({ projectId: z.string() });
/**
 * 读项目：比 `projectIdSchema` 多一个 `lang`。
 *
 * 内置默认提示词存在宿主侧，而宿主没有 locale 服务，所以界面语言只能由浏览器半区带过来。
 * **这个字段必须写进 schema**：typert 会按声明校验 payload，schema 里没有的键会被丢掉，
 * 方法里 `input.lang` 永远是 undefined——表现就是「切了英文提示词还是中文」，
 * 而且不报任何错（实测踩过）。
 */
const getProjectSchema = z.object({ projectId: z.string(), lang: z.string().optional() });
const renameSchema = z.object({ projectId: z.string(), name: z.string() });
const uploadSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  /** 原始文件字节的 base64（不带 data: 前缀）。 */
  data: z.string()
});
/**
 * 选用一段**本地视频**（用户自己选的，不走远程生成）。
 *
 * `key` 是槽位：`turn`（转圈视频）或八个方向之一的 key。两步放在同一个方法里而不是
 * 拆成两个，是因为两条路的落盘、作废与回报完全同形，只是目标节点不同。
 */
const uploadVideoSchema = z.object({
  projectId: z.string(),
  /** `turn` 或方向 key（front / back / downLeft / …）。 */
  key: z.string(),
  name: z.string().optional(),
  /** 原始视频字节的 base64（不带 data: 前缀）。 */
  data: z.string()
});
/** 打包中间图片：只有项目 id，没有别的参数（打哪些是宿主按项目状态算的）。 */
const exportImagesSchema = z.object({ projectId: z.string() });
const promptsSchema = z.object({
  projectId: z.string(),
  /** 界面语言：「重置为默认」要重置成哪一国话的默认提示词（见 getProjectSchema）。 */
  lang: z.string().optional(),
  images: z.record(z.string(), z.string()).optional(),
  video: z.string().optional(),
  /** 转圈模式的旋转视频提示词（整圈只有这一份）。 */
  turn: z.string().optional(),
  videoPerDirection: z.record(z.string(), z.string()).optional(),
  /** 统一附加提示词：追加到每个方向的生图提示词末尾；空串表示关闭。 */
  suffix: z.string().optional(),
  /** 一键把八个方向的生图提示词重置为当前默认模板。 */
  resetImagesToDefault: z.boolean().optional(),
  /** 一键把视频提示词重置为当前默认模板。 */
  resetVideoToDefault: z.boolean().optional(),
  /** 一键把转圈视频提示词重置为当前默认模板。 */
  resetTurnToDefault: z.boolean().optional()
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
  /**
   * 六个模块都要能设审核模式。
   *
   * ⚠️ 这个枚举漏一个模块，那条模块的「固定流程必须问清审核模式」就落不了地
   * （骨骼动画与地图地块都踩过：走到宿主才抛「未知模块」）。模块六（map）同理。
   */
  module: z.enum(["sprite", "image", "sequence", "rig", "iso", "map", "music", "sfx"]),
  reviewMode: z.enum(["auto", "manual"])
});
const runImageSchema = z.object({ projectId: z.string(), key: z.string(), prompt: z.string().optional() });
const runImagesSchema = z.object({ projectId: z.string(), force: z.boolean().optional() });

// ── 阶段①的另一种生成方式：转圈截帧 ────────────────────────────────────
/** 生成方式：`turn` = 转一圈再按时间截帧（默认）；`direct` = 逐方向生图（备选）。 */
const setImageModeSchema = z.object({ projectId: z.string(), mode: z.enum(["turn", "direct"]) });
const runTurnFramesSchema = z.object({
  projectId: z.string(),
  /** 候选帧张数；不给就沿用项目里的 `settings.turnFrameCount`。 */
  count: z.number().optional()
});
const setTurnPickSchema = z.object({
  projectId: z.string(),
  /** 方向 key（front / back / downLeft / …）。 */
  key: z.string(),
  /** 候选帧下标（0 起）。 */
  index: z.number()
});
/** 一次写多个截帧位置（agent 看完整圈条带后整份写回）。 */
const setTurnPicksSchema = z.object({
  projectId: z.string(),
  /** 方向 key → 候选帧下标。只给要改的方向。 */
  picks: z.record(z.string(), z.number())
});
const resetTurnPicksSchema = z.object({
  projectId: z.string(),
  /** 转圈方向；不给就沿用当前值。 */
  direction: z.enum(["cw", "ccw"]).optional()
});
const cutTurnFramesSchema = z.object({ projectId: z.string(), keys: z.array(z.string()).optional() });
const runKeysSchema = z.object({ projectId: z.string(), keys: z.array(z.string()).optional() });
/** 从一个方向的行走视频抽出候选帧。count 是候选张数（8~512），不是最终序列帧数。 */
const prepareFramePickSchema = z.object({
  projectId: z.string(),
  key: z.string(),
  count: z.number().optional()
});
/** 拖动某一个输出帧的圆圈。slot 是输出帧序号，index 是候选帧下标。 */
const setFramePickSchema = z.object({
  projectId: z.string(),
  key: z.string(),
  slot: z.number(),
  index: z.number()
});
const setWalkPicksSchema = z.object({
  projectId: z.string(),
  key: z.string(),
  picks: z.array(z.number())
});
const resetWalkPicksSchema = z.object({ projectId: z.string(), key: z.string() });
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
 * 关键帧编辑（M3 的时间轴编辑器）。
 *
 * 逐台取、整份存：「取一台动画的可编辑数据」与「整份写回」。
 * 不做逐关键帧的 patch——时间轴的增删改三者互相牵连（删一帧会同时改两个段的
 * 缓动归属），服务端再去解析 patch 等于把同一套语义实现两遍，多一处能出错的地方。
 */
const getRigAnimationSchema = z.object({ jobId: z.string(), id: z.string() });
const saveRigAnimationSchema = z.object({
  jobId: z.string(),
  id: z.string(),
  /**
   * 不传 = **实例化**：按当前参数把预设烘成显式关键帧，之后以数据为准。
   * 传了 = 整份替换。结构见 `riggen.RigCustomAnimation`。
   */
  animation: z.unknown().optional()
});
const resetRigAnimationSchema = z.object({ jobId: z.string(), id: z.string() });
/**
 * 拆件质检（阶段①②之间）。
 *
 * `expectedParts`（参考图里大致有几个独立部位）只能靠视觉判断，所以由 agent
 * 看图后填；不填就跳过这项判断——宁可不报，也不要瞎报。
 */
const runRigQaSchema = z.object({
  jobId: z.string(),
  expectedParts: z.number().int().positive().max(200).optional()
});
/**
 * IK 约束（M5）。
 *
 * `chain` 是「链长」：1 = 末端骨 + 它的父级两根骨。目标骨不在骨架里时宿主会自动
 * 补一根可拖的点——让用户手工去建那样一根骨头是没有意义的负担。
 */
const setRigConstraintsSchema = z.object({
  jobId: z.string(),
  constraints: z.array(
    z.object({
      name: z.string(),
      bone: z.string(),
      target: z.string().optional(),
      chain: z.number().int().min(1).max(8).optional(),
      bendPositive: z.boolean().optional(),
      /** 软 IK 权重 0~1。 */
      weight: z.number().min(0).max(1).optional()
    })
  ),
  by: z.enum(["ai", "human"]).optional()
});
const resetRigConstraintsSchema = z.object({
  jobId: z.string(),
  /** 不传或传空数组 = 清空全部约束。 */
  names: z.array(z.string()).optional()
});
/**
 * 蒙皮网格与 FFD 变形（M5 的 L1 / L3）。
 *
 * `cols/rows` 是网格密度（规则三角化，确定性重算，不落盘）；`deform` 是波形变形，
 * 传 `null` 表示只保留网格、不加变形。
 */
const setRigMeshSchema = z.object({
  jobId: z.string(),
  meshes: z.array(
    z.object({
      name: z.string(),
      cols: z.number().int().min(1).max(16).optional(),
      rows: z.number().int().min(1).max(16).optional(),
      deform: z
        .object({
          amplitude: z.number().min(0).max(400).optional(),
          cycles: z.number().min(0.25).max(8).optional(),
          direction: z.number().optional(),
          anchor: z.enum(["top", "bottom", "none"]).optional(),
          duration: z.number().min(0.1).max(10).optional()
        })
        .nullable()
        .optional()
    })
  ),
  by: z.enum(["ai", "human"]).optional()
});
/** Path 约束（M5）：把一串骨沿折线铺开。`points` 是扁平的 `[x0,y0,x1,y1,…]`（参考图像素）。 */
const setRigPathSchema = z.object({
  jobId: z.string(),
  paths: z.array(
    z.object({
      name: z.string(),
      points: z.array(z.number()).optional(),
      closed: z.boolean().optional(),
      bones: z.array(z.string()).optional(),
      spacing: z.number().min(0).max(4000).optional(),
      translateMix: z.number().min(0).max(1).optional(),
      rotateMix: z.number().min(0).max(1).optional()
    })
  ),
  by: z.enum(["ai", "human"]).optional()
});
const resetRigPathSchema = z.object({
  jobId: z.string(),
  names: z.array(z.string()).optional()
});
const resetRigMeshSchema = z.object({
  jobId: z.string(),
  /** 不传或传空数组 = 清除全部网格。 */
  names: z.array(z.string()).optional()
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
/**
 * AI 逐部件重绘（**花钱**：一次 Seedream 调用）。
 *
 * 一个部件进、一个部件出——所以 reskin-app 那套「整张图重绘后再用 SAM /
 * 连通域反向切回各 slot」完全不需要（见方案 §3.1 的范围裁剪）。
 * 结果落成新版本，不满意随时切回上一版。
 */
const runRigRedrawSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  /** 想怎么改（例如「换成深蓝色」「加上金属高光」）。 */
  prompt: z.string(),
  /** 边缘腐蚀半径（像素），用来削掉 AI 生成部件常见的白晕。默认 1。 */
  erode: z.number().optional()
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
 * 浏览器半区上报自己真实的 `location.origin`（`path` = 应用路径前缀）。
 *
 * 宿主不知道对外 origin（可能被反代改写过），而模型要在回复里贴出可点的
 * 深链接，只能由页面自己上报一次。DSH 0.2.1 起 `--public-url` 允许带路径
 * 前缀，`path` 就是给这种情况用的。见 src/links.ts。
 */
const reportOriginSchema = z.object({ origin: z.string(), path: z.string().optional() });

interface MethodSpec {
  method: string;
  payload?: z.ZodType;
  result: z.ZodType;
  /**
   * 只给浏览器半区用、**不暴露给模型工具**的方法。
   * `game_material({action:'call'})` 的 method 枚举会跳过它们。
   */
  clientOnly?: boolean;
}

// ── 45° 地图编辑器（模块五 · iso）────────────────────────────────────────
//
// ⚠️ 每个字段都必须写进 schema：typert 按声明校验 payload，
// **schema 里没有的键会被静默丢掉**。尤其是 `isoPlan.view`、`applyIsoOps.ops`、
// `isoPlan.pending` 与 `importIsoTileset` 的每个字段 —— 漏一个就是「界面点了没反应」。
const isoProjectIdSchema = z.object({ projectId: z.string() });
const isoGetSchema = z.object({ projectId: z.string() });
const createIsoProjectSchema = z.object({
  name: z.string().optional(),
  cell: z.record(z.string(), z.unknown()).optional(),
  cols: z.number().optional(),
  rows: z.number().optional(),
  wrap: z.boolean().optional()
});
const saveIsoProjectSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  wrap: z.boolean().optional()
});
const importIsoTilesetSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  /** 原始文件字节的 base64（不带 data: 前缀）；与 `path` 二选一。 */
  data: z.string().optional(),
  /** 本机绝对路径；宿主自己读盘，避免把 base64 塞进工具参数。 */
  path: z.string().optional(),
  kind: z.enum(["ground", "autotile", "object"]).optional(),
  sourceCell: z.record(z.string(), z.unknown()).optional(),
  animRows: z.boolean().optional(),
  frames: z.number().optional(),
  fps: z.number().optional(),
  loop: z.enum(["forward", "reverse", "pingpong"]).optional(),
  clarity: z.enum(["smooth", "sharp", "crisp"]).optional(),
  footprint: z.record(z.string(), z.unknown()).optional(),
  anchor: z.record(z.string(), z.unknown()).optional(),
  /** 仅物件：图片大小相对占格（1 = 正好占满）。 */
  objectScale: z.number().optional(),
  pass: z.array(z.number()).optional(),
  keyGreen: z.boolean().optional(),
  /** 抠像底色（`#RRGGBB`）；留空 = 默认绿。 */
  keyColor: z.string().optional()
});
const composeIsoAssetSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  files: z.array(z.string()).min(1),
  /** 首版只支持地面 / 物件；自动连接 4×4 不在这里做。 */
  kind: z.enum(["ground", "object"]),
  /** 仅物件：占几格（1..地图大小）。 */
  footprint: z.record(z.string(), z.unknown()).optional(),
  /** 是否抠掉背景（AI 那条路默认开；导入时已抠过的图会带 keyed=1 关掉）。 */
  keyGreen: z.boolean().optional(),
  /** 抠像底色（`#RRGGBB`）；留空 = 默认绿。 */
  keyColor: z.string().optional()
});
const saveIsoTilesetSchema = z.object({
  projectId: z.string(),
  tilesetId: z.string(),
  name: z.string().optional(),
  fps: z.number().nullable().optional(),
  loop: z.enum(["forward", "reverse", "pingpong"]).optional()
});
const removeIsoTilesetSchema = z.object({ projectId: z.string(), tilesetId: z.string() });
const saveIsoDocSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  cols: z.number().optional(),
  rows: z.number().optional(),
  layers: z.array(z.record(z.string(), z.unknown())).optional(),
  addLayer: z.record(z.string(), z.unknown()).optional(),
  removeLayerId: z.string().optional(),
  moveLayer: z.record(z.string(), z.unknown()).optional(),
  clearLayerId: z.string().optional()
});
const applyIsoOpsSchema = z.object({
  projectId: z.string(),
  ops: z.array(z.record(z.string(), z.unknown())),
  stroke: z.string().optional(),
  have: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
  ifRevision: z.string().optional()
});
const isoHaveSchema = z.object({ projectId: z.string(), have: z.array(z.string()).optional() });
const isoPlanSchema = z.object({
  projectId: z.string(),
  view: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  have: z.array(z.string()).optional(),
  layerIds: z.array(z.number()).optional(),
  pending: z.array(z.record(z.string(), z.unknown())).optional(),
  pass: z.boolean().optional()
});
const runIsoGenerateSchema = z.object({
  projectId: z.string(),
  kind: z.enum(["random", "maze", "continent"]),
  tiles: z.array(z.number()).optional(),
  seed: z.number().optional(),
  layerId: z.string().optional()
});
const runIsoPreviewSchema = z.object({ projectId: z.string() });
const runIsoExportSchema = z.object({
  projectId: z.string(),
  scale: z.number().optional(),
  formats: z.object({ png: z.boolean().optional(), json: z.boolean().optional(), tilesets: z.boolean().optional(), zip: z.boolean().optional() }).optional()
});
const setIsoApprovedSchema = z.object({
  projectId: z.string(),
  stage: z.enum(["assets", "paint", "export"]).optional(),
  approved: z.boolean()
});
const revealIsoProjectSchema = z.object({
  projectId: z.string(),
  target: z.enum(["project", "export"]).optional()
});
const isoInspectSchema = z.object({
  projectId: z.string(),
  region: z.object({ r0: z.number(), c0: z.number(), r1: z.number(), c1: z.number() }).optional(),
  layerIds: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  format: z.enum(["text", "json", "both"]).optional(),
  maxCells: z.number().optional(),
  maxItems: z.number().optional()
});

const overlaySchema = z.object({
  markers: z.boolean().optional(),
  markerLabels: z.boolean().optional(),
  grid: z.boolean().optional(),
  axes: z.boolean().optional(),
  pass: z.boolean().optional(),
  objects: z.boolean().optional(),
  regions: z.boolean().optional(),
  outlines: z
    .array(
      z.object({
        r: z.number(),
        c: z.number(),
        color: z.string().optional(),
        label: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional()
      })
    )
    .optional()
});

const isoRenderSchema = z.object({
  projectId: z.string(),
  region: z.object({ r0: z.number(), c0: z.number(), r1: z.number(), c1: z.number() }).optional(),
  scale: z.number().optional(),
  layerIds: z.array(z.string()).optional(),
  frame: z.number().optional(),
  background: z.enum(["transparent", "checker", "white", "dark"]).optional(),
  overlay: overlaySchema.optional(),
  maxPixels: z.number().optional(),
  name: z.string().optional()
});

// ── 地图编辑器（模块六）──────────────────────────────────────────────────
//
// ⚠️ 同样的硬约束：typert 按 schema 校验 payload，**schema 里没有的键会被静默丢掉**。
// 尤其是 `applyMapOps` 的 `ops` 与 `mapPlan` 的 `view` —— 少了它们，界面画什么都不
// 生效 / 一张图都拉不下来，而且不报错。
//
// 单项目 = 单张地图：`mapId` 只剩 `getMapProject` 里那个兼容位（老深链接带的），
// 其它方法的 payload 一律不带 mapId。
const mapProjectIdSchema = z.object({ projectId: z.string() });
/**
 * 「在文件夹中显示」。`target: "export"` = 导出目录（界面上的「打开导出目录」），
 * 省略 = 项目目录。
 *
 * ⚠️ 这里必须给 reveal 单独一条 schema：它与 `deleteMapProject` / `cancelMapJob` 共用
 * `mapProjectIdSchema`，直接把 `target` 加在那个共享 schema 上会让所有方法都多一个无意义字段；
 * 而**不加**的后果是 typert 把 `target` 静默丢掉 —— 界面点「打开导出目录」打不开导出的那个目录，
 * 且不报任何错。
 */
const revealMapProjectSchema = z.object({
  projectId: z.string(),
  target: z.enum(["project", "export"]).optional()
});
const mapInspectSchema = z.object({
  projectId: z.string(),
  region: z.object({ r0: z.number(), c0: z.number(), r1: z.number(), c1: z.number() }).optional(),
  layerIds: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  format: z.enum(["text", "json", "both"]).optional(),
  maxCells: z.number().optional(),
  maxItems: z.number().optional()
});

const mapRenderSchema = z.object({
  projectId: z.string(),
  region: z.object({ r0: z.number(), c0: z.number(), r1: z.number(), c1: z.number() }).optional(),
  scale: z.number().optional(),
  layerIds: z.array(z.string()).optional(),
  frame: z.number().optional(),
  background: z.enum(["transparent", "checker", "white", "dark"]).optional(),
  overlay: overlaySchema.optional(),
  maxPixels: z.number().optional(),
  name: z.string().optional()
});
const mapGetSchema = z.object({
  projectId: z.string(),
  /** 仅兼容旧深链接：单项目单地图后它没有意义，宿主忽略。 */
  mapId: z.string().optional(),
  lang: z.string().optional()
});
const createMapProjectSchema = z.object({
  name: z.string().optional(),
  grid: z.record(z.string(), z.unknown()).optional(),
  cols: z.number().optional(),
  rows: z.number().optional()
});
const saveMapProjectSchema = z.object({
  projectId: z.string(),
  name: z.string().optional()
});
const importMapTilesetSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  /** 原始文件字节的 base64（不带 data: 前缀）；与 `path` 二选一。 */
  data: z.string().optional(),
  /** 本机绝对路径；宿主自己读盘。 */
  path: z.string().optional(),
  /**
   * 新增素材时可以**一次性**把属性定下来（留空 = 自动识别）。属性之后不能再改：
   * 内置素材一律拒绝，自己新增的也只能删掉重来。
   */
  cell: z.record(z.string(), z.unknown()).optional(),
  shape: z.string().optional(),
  animRows: z.boolean().optional(),
  /**
   * 这个素材**自己的播放速度**（帧/秒，0.5~30）。留空 = 跟「设置 → 动画速度」那条全局速度走。
   *
   * 不动几何、不动序号，所以它不属于「属性一次定死」那一类，之后还能改（见 `saveMapTileset`）。
   */
  fps: z.number().optional(),
  /**
   * **清晰度**：把大图缩到地图格子时用哪种重采样（`smooth` 面积平均 / `sharp` 最近邻 /
   * `crisp` 平均+锐化）。留空 = `smooth`。
   */
  clarity: z.string().optional(),
  /**
   * 素材图相对格子的倍数：AI 生成的那条路会先留到 `cell × scale`（默认 4），
   * 导入时再按 `clarity` 缩到格子大小。留空 = 1（图就是格子大小，一个像素都不动）。
   */
  scale: z.number().optional(),
  /**
   * **整图**规格：`{ cols, rows, frames, pass }`（占几格、几帧、每格通行性）。
   *
   * 给了它就是整图（形态强制为 `stamp`，格子锁定为地图网格）；`pass` 是
   * `cols*rows` 个 0/1/2（不可通过 / 可通过·被人物遮挡 / 可通过·遮挡人物）。
   */
  stamp: z.record(z.string(), z.unknown()).optional(),
  /** 仅整图：导入时**抠掉背景**（手动导一张带背景的整图时用；AI 那条路在整理时已经抠过）。 */
  stampKey: z.boolean().optional(),
  /** 仅整图抠像：背景色（`#RRGGBB`）；留空 = 默认绿。 */
  keyColor: z.string().optional(),
  /** 会动的素材怎么循环：`forward` 正放（默认）/ `reverse` 倒放 / `pingpong` 来回。 */
  loop: z.string().optional()
});
const recomposeMapTilesetSchema = z.object({
  projectId: z.string(),
  tilesetId: z.string(),
  /** 源图绝对路径：整格给 1 张、普通 / 拼块按帧顺序给 N 张。 */
  files: z.array(z.string()).optional(),
  clarity: z.string().optional()
});
const saveMapTilesetSchema = z.object({
  projectId: z.string(),
  tilesetId: z.string(),
  name: z.string().optional(),
  /** 逻辑块尺寸；不给就沿用当前值。 */
  cell: z.record(z.string(), z.unknown()).optional(),
  /** `plain` / `a2quad` / `corner16`。 */
  shape: z.string().optional(),
  animRows: z.boolean().optional(),
  /** 改播放速度（帧/秒）；`null` = 清掉，跟全局速度走。 */
  fps: z.number().nullable().optional(),
  /** 改循环方式（正放 / 倒放 / 来回）：只换帧序展开，不动几何也不动序号。 */
  loop: z.string().optional(),
  /** 仅整图：改逐格通行区域（`cols*rows` 个 0/1/2）。只改数据，不动几何 / 序号。 */
  stampPass: z.array(z.unknown()).optional()
});
/**
 * 整理 AI 生成的那几张图 → 一张待确认的素材图（按**生图前定好的形态**规整）。
 *
 * `files` 是**本机绝对路径**（对话里的 agent 从 `getImageJob.dir` / `getSequenceJob.dir`
 * 拼出来）。三种形态的输入约定见 `maptiles.composeAssetSheet`：普通每张一帧竖排、
 * 整格一张 4×4、拼块每张一列（5 行形状）横排。落在项目的 `ai/` 暂存区，
 * **不进素材列表** —— 用户在「新增素材」窗口里确认后才是素材。
 */
const composeMapAssetSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  files: z.array(z.string()).min(1),
  /** 这块素材怎么用：`plain`（普通，默认）/ `corner16`（整格）/ `a2quad`（拼块）/ `stamp`（整图）。 */
  shape: z.string().optional(),
  /** 留空 = 用地图项目的网格尺寸。 */
  cell: z.record(z.string(), z.unknown()).optional(),
  /** 只有普通形态用得上（多张 = 翻页图）；留空由宿主按张数推。 */
  animRows: z.boolean().optional(),
  /** 仅整图：占几格（2~8）。少了它整图没法切 —— 宿主会明确报错。 */
  stampCols: z.number().optional(),
  stampRows: z.number().optional(),
  /** 整图抠像的底色（`#RRGGBB`）；留空 = 默认绿。 */
  keyColor: z.string().optional()
});
const removeMapTilesetSchema = z.object({ projectId: z.string(), tilesetId: z.string() });
const saveMapDocSchema = z.object({
  projectId: z.string(),
  name: z.string().optional(),
  cols: z.number().optional(),
  rows: z.number().optional(),
  /** 图层改名补丁：`[{id, name}]`。 */
  layers: z.array(z.record(z.string(), z.unknown())).optional(),
  addLayer: z.record(z.string(), z.unknown()).optional(),
  removeLayerId: z.string().optional(),
  moveLayer: z.record(z.string(), z.unknown()).optional(),
  clearLayerId: z.string().optional(),
  /** 地图四周是否环绕（落在项目网格上）。 */
  wrap: z.boolean().optional()
});
const applyMapOpsSchema = z.object({
  projectId: z.string(),
  /**
   * 笔画 id（一次拖拽 / 一次填充一个）。
   *
   * ⚠️ 必须写进 schema：typert 会**静默丢掉**没声明的键，漏了它界面传不进来，
   * 一次拖拽又会变回好几步撤销（而且不报任何错）。
   */
  stroke: z.string().optional(),
  /**
   * 编辑操作：`{kind:"paint"|"fill"|"rect"|"replace"|"marker"|"stampPlace"|"stampRemove", …}`。
   *
   * 整图的两种 op **只带素材 id 与参考点**（`stampPlace` 还不许带 cols/rows —— 占格由宿主
   * 从素材上读，界面传错了就是几何错位）。
   * 返回脏 chunk 与该丢的客户端缓存 key。
   */
  ops: z.array(z.record(z.string(), z.unknown())),
  /** 客户端已经有的 chunk key（未 wrap）；宿主据此回 `dropKeys`。 */
  have: z.array(z.string()).optional(),
  /** 只校验 / 预演，不写盘、不进撤销栈。 */
  dryRun: z.boolean().optional(),
  /** 文档版本不一致时直接拒绝，避免覆盖用户的新编辑。 */
  ifRevision: z.string().optional()
});
const mapHaveSchema = z.object({ projectId: z.string(), have: z.array(z.string()).optional() });
const mapPlanSchema = z.object({
  projectId: z.string(),
  /**
   * 视口矩形（画布像素坐标）。
   *
   * ⚠️ 必须逐键声明：typert 会**静默丢掉** schema 之外的键，只写
   * `z.record(...)` 之外的东西都行，但漏一个字段就是「计划永远算的是 0×0 视口」。
   */
  view: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  /**
   * 预览用：还在笔里、还没提交的 op。宿主盖到一份克隆上算计划，**不落盘** ——
   * 「画的过程中看得见，但一次都没存」。提交后客户端会把这些 chunk 标成待重拉。
   */
  pending: z.array(z.record(z.string(), z.unknown())).optional(),
  /** 客户端已有的 chunk key（未 wrap）。 */
  have: z.array(z.string()).optional(),
  /** 只算这几个层号（0 起）。 */
  layerIds: z.array(z.number()).optional(),
  /** 顺带回整图的通行区域（`[{r,c,kind}]`，界面「区域」开关打开时）。 */
  pass: z.boolean().optional()
});
const runMapGenerateSchema = z.object({
  projectId: z.string(),
  kind: z.enum(["random", "maze", "continent"]),
  /** 用哪些图块序号（1-based 全局序号；0 = 空）。不给就用项目里全部图块。 */
  tiles: z.array(z.number()).optional(),
  seed: z.number().optional(),
  layerId: z.string().optional()
});
const runMapPreviewSchema = z.object({ projectId: z.string() });
const runMapExportSchema = z.object({
  projectId: z.string(),
  scale: z.number().optional(),
  /**
   * 导出内容（**逐项写清楚**，不再是 `record(unknown)`）：界面上是三个复选框 +
   * 一个倍率，宿主按同一组键决定写哪些文件。
   *
   * - `png` / `json`：地图图片、存档数据（都不给 = 都要，与旧行为一致）；
   * - `tilesets`：把素材原图一起拷进 `tilesets/`（整包自包含）；
   * - `zip`：打一个 zip；不给 = 产物超过一个就自动打；
   * - `scale`：只影响 PNG 的整数倍率。
   */
  formats: z
    .object({
      png: z.boolean().optional(),
      json: z.boolean().optional(),
      tilesets: z.boolean().optional(),
      zip: z.boolean().optional(),
      scale: z.number().optional()
    })
    .optional()
});
const setMapApprovedSchema = z.object({
  projectId: z.string(),
  /** 空 = 四个阶段全打。 */
  stage: z.string().optional(),
  approved: z.boolean()
});

const musicJobIdSchema = z.object({ jobId: z.string() });

const setMusicApprovedSchema = z.object({  jobId: z.string(),
  /** `compose` / `generate` / `edit` / `export`；空 = 全部阶段。 */
  stage: z.string().optional(),
  songId: z.string().optional(),
  versionId: z.string().optional(),
  /** 谱曲模式：只对某一版谱曲打通过。 */
  scoreId: z.string().optional(),
  approved: z.boolean()
});

const musicSourceSchema = z.object({
  kind: z.enum(["prompt", "lyrics"]).optional(),
  prompt: z.string().optional(),
  lyrics: z.string().optional(),
  note: z.string().optional(),
  title: z.string().optional(),
  tags: z.string().optional(),
  instrumental: z.boolean().optional(),
  preferredEngine: z.string().optional(),
  adaptedPrompt: z.string().optional(),
  adaptedLyrics: z.string().optional(),
  adaptedTags: z.string().optional(),
  adaptedNote: z.string().optional()
});

const musicSettingsSchema = z.object({
  engine: z.string().optional(),
  mode: z.string().optional(),
  model: z.string().optional(),
  n: z.number().optional(),
  vocalGender: z.string().optional(),
  negativeTags: z.string().optional(),
  styleWeight: z.number().optional(),
  weirdness: z.number().optional(),
  duration: z.number().optional(),
  isMaxMode: z.boolean().optional(),
  augCreativity: z.number().optional(),
  vocalLanguage: z.string().optional(),
  bpm: z.number().optional(),
  keyScale: z.string().optional(),
  timeSignature: z.string().optional(),
  sampleRate: z.number().optional(),
  bitrate: z.number().optional()
});

const createMusicJobSchema = z.object({
  name: z.string().optional(),
  source: musicSourceSchema.optional(),
  settings: musicSettingsSchema.optional(),
  reviewMode: z.enum(["auto", "manual"]).optional(),
  /** `generate`（默认）= 谱乐 AI 直接生成；`compose` = 本地 MIDI 谱曲模式。 */
  workflow: z.enum(["generate", "compose"]).optional()
});

const getMusicJobSchema = z.object({ jobId: z.string(), lang: z.string().optional() });
const saveMusicJobSchema = z.object({
  jobId: z.string(),
  name: z.string().optional(),
  source: musicSourceSchema.optional(),
  settings: musicSettingsSchema.optional(),
  reviewMode: z.enum(["auto", "manual"]).optional()
});
const getMusicGuideSchema = z.object({ lang: z.string().optional() });
const getMusicScoreGuideSchema = z.object({ lang: z.string().optional() });

/**
 * 谱曲方案。**每个字段都要显式声明**：typert 会把 schema 外的键静默丢掉，
 * 表现是「方案存进去了、界面上少了几段」，而且不报错。
 */
const musicScorePlanSchema = z.object({
  summary: z.string().optional(),
  style: z.string().optional(),
  mood: z.string().optional(),
  key: z.string().optional(),
  tempo: z.number().optional(),
  timeSignature: z.string().optional(),
  lengthBars: z.number().optional(),
  durationTarget: z.number().optional(),
  instrumental: z.boolean().optional(),
  structure: z.array(z.object({
    name: z.string(),
    bars: z.number().optional(),
    energy: z.string().optional(),
    description: z.string().optional()
  })).optional(),
  instrumentation: z.array(z.object({
    name: z.string(),
    program: z.number().optional(),
    channel: z.number().optional(),
    role: z.string().optional()
  })).optional(),
  motif: z.string().optional(),
  notes: z.string().optional(),
  lyrics: z.string().optional(),
  sunoTags: z.string().optional(),
  sunoPrompt: z.string().optional(),
  negativeTags: z.string().optional()
});

const saveMusicScorePlanSchema = z.object({
  jobId: z.string(),
  plan: musicScorePlanSchema
});

const runMusicScoreSchema = z.object({
  jobId: z.string(),
  title: z.string().optional(),
  plan: musicScorePlanSchema.optional(),
  script: z.string(),
  basedOn: z.string().optional(),
  label: z.string().optional()
});

const submitMusicScoreToSunoSchema = z.object({
  jobId: z.string(),
  scoreId: z.string().optional(),
  confirm: z.boolean().optional(),
  model: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  regenerate: z.boolean().optional(),
  /** Suno 判定版权后，走付费版权上传通道。 */
  copyrightAudio: z.boolean().optional(),
  /** cover 的参考音频权重 0–1。 */
  audioWeight: z.number().optional()
});

/**
 * 提交一次生成。
 *
 * `params` 用 record：不同引擎的参数集合差很多，逐个写进 schema 反而容易漏；
 * 宿主在 `buildGenerationRequest` 里按引擎/模式逐项校验。**Key 不在这里**。
 */
const runMusicGenerationSchema = z.object({
  jobId: z.string(),
  engine: z.string().optional(),
  mode: z.string().optional(),
  model: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  regenerate: z.boolean().optional()
});

const getMusicWavSchema = z.object({ jobId: z.string(), songId: z.string() });
const getMusicLrcSchema = z.object({ jobId: z.string(), songIds: z.array(z.string()).optional() });
const listMusicHistorySchema = z.object({
  page: z.number().optional(),
  size: z.number().optional(),
  filters: z.array(z.string()).optional()
});
const runMusicToolSchema = z.object({
  jobId: z.string(),
  kind: z.string(),
  params: z.record(z.string(), z.unknown()).optional()
});

const musicPeaksSchema = z.object({
  jobId: z.string(),
  songId: z.string().optional(),
  versionId: z.string().optional(),
  scoreId: z.string().optional(),
  buckets: z.number().optional()
});

/** 本地编辑参数：逐字段声明，避免 typert 静默丢掉 `ops.start` 这类键。 */
const musicEditOpsSchema = z.object({
  start: z.number().optional(),
  end: z.number().optional(),
  gainDb: z.number().optional(),
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional(),
  normalize: z.boolean().optional(),
  lufs: z.number().optional(),
  truePeak: z.number().optional(),
  format: z.enum(["mp3", "wav", "m4a"]).optional(),
  bitrate: z.number().optional(),
  channels: z.number().optional(),
  sampleRate: z.number().optional()
});

const renderMusicEditSchema = z.object({
  jobId: z.string(),
  songId: z.string().optional(),
  versionId: z.string().optional(),
  ops: musicEditOpsSchema,
  label: z.string().optional(),
  preview: z.boolean().optional(),
  by: z.enum(["human", "ai"]).optional(),
  force: z.boolean().optional()
});

const saveMusicVersionSchema = z.object({
  jobId: z.string(),
  versionId: z.string(),
  label: z.string().optional()
});
const deleteMusicVersionSchema = z.object({ jobId: z.string(), versionId: z.string() });
const exportMusicSchema = z.object({
  jobId: z.string(),
  songId: z.string().optional(),
  versionId: z.string().optional(),
  /** 谱曲模式：导出某一版的乐谱包（MIDI + 试听 + 方案 + compose.py）。 */
  scoreId: z.string().optional(),
  format: z.enum(["mp3", "wav", "m4a"]).optional(),
  name: z.string().optional(),
  zip: z.boolean().optional()
});

// ── 音效生成（模块八，火山引擎 Seed-Audio）─────────────────────────────
//
// ⚠️ 这一组字段必须逐个写进 schema：typert 会静默丢掉 schema 外的键，
// 界面表现就是「改了没反应 / 保存成功但没生效」，而且不报任何错。
const sfxSettingsSchema = z.object({
  format: z.enum(["mp3", "wav", "ogg_opus"]).optional(),
  sampleRate: z.number().optional(),
  speechRate: z.number().optional(),
  loudnessRate: z.number().optional(),
  pitchRate: z.number().optional(),
  watermark: z.boolean().optional()
});
const sfxJobIdSchema = z.object({ jobId: z.string() });
const createSfxJobSchema = z.object({
  name: z.string().optional(),
  prompt: z.string(),
  settings: sfxSettingsSchema.optional(),
  reviewMode: z.enum(["auto", "manual"]).optional()
});
const saveSfxJobSchema = z.object({
  jobId: z.string(),
  name: z.string().optional(),
  prompt: z.string().optional(),
  settings: sfxSettingsSchema.optional(),
  reviewMode: z.enum(["auto", "manual"]).optional()
});
const uploadSfxRefSchema = z.object({
  jobId: z.string(),
  kind: z.enum(["image", "audio"]),
  name: z.string().optional(),
  /** 原始文件字节的 base64（不带 data: 前缀）。 */
  data: z.string()
});
const removeSfxRefSchema = z.object({
  jobId: z.string(),
  kind: z.enum(["image", "audio"]),
  /** 音频参考按文件删；省略 = 删全部音频参考。 */
  file: z.string().optional()
});
const setSfxApprovedSchema = z.object({
  jobId: z.string(),
  /** `generate` / `export`；空 = 全部阶段。 */
  stage: z.enum(["generate", "export"]).optional(),
  approved: z.boolean()
});
const exportSfxSchema = z.object({
  jobId: z.string(),
  takeId: z.string().optional(),
  zip: z.boolean().optional()
});

export const METHODS: MethodSpec[] = [  { method: "getConfig", result: configViewSchema },
  { method: "saveConfig", payload: saveConfigSchema, result: configViewSchema },
  { method: "testArk", result: jsonObject },
  { method: "testCustomImage", result: jsonObject },
  { method: "testMinimax", result: jsonObject },
  // 本地 ComfyUI 后端自检（读 /system_stats + /queue，不排队生图）。
  { method: "testComfy", result: jsonObject },
  // 谱乐 AI 连接自检（读一页历史，不生成、不扣生成积分）。
  { method: "testMusic", result: jsonObject },
  // 火山引擎音效生成自检（★会真实生成一条极短音效，产生少量费用）。
  { method: "testSfx", result: jsonObject },
  // 浏览器半区在挂载时上报 origin，供宿主拼深链接；不是用户可调用的功能。
  { method: "reportClientOrigin", payload: reportOriginSchema, result: okSchema, clientOnly: true },

  { method: "listProjects", result: projectListSchema },
  { method: "createProject", payload: createProjectSchema, result: jsonObject },
  { method: "getProject", payload: getProjectSchema, result: projectViewSchema },
  { method: "deleteProject", payload: projectIdSchema, result: okSchema },
  { method: "renameProject", payload: renameSchema, result: okSchema },
  { method: "uploadSource", payload: uploadSchema, result: okSchema },
  { method: "savePrompts", payload: promptsSchema, result: okSchema },
  { method: "saveSettings", payload: settingsSchema, result: okSchema },
  { method: "setApproved", payload: approvedSchema, result: okSchema },
  { method: "setReviewMode", payload: setReviewModeSchema, result: okSchema },
  { method: "revealProject", payload: projectIdSchema, result: okSchema },
  { method: "uploadVideo", payload: uploadVideoSchema, result: jsonObject },
  { method: "exportImages", payload: exportImagesSchema, result: jsonObject },

  { method: "runImage", payload: runImageSchema, result: startedSchema },
  { method: "runImages", payload: runImagesSchema, result: startedSchema },
  { method: "setImageMode", payload: setImageModeSchema, result: okSchema },
  { method: "runTurnVideo", payload: projectOnlySchema, result: startedSchema },
  { method: "runTurnFrames", payload: runTurnFramesSchema, result: startedSchema },
  { method: "setTurnPick", payload: setTurnPickSchema, result: jsonObject },
  { method: "setTurnPicks", payload: setTurnPicksSchema, result: jsonObject },
  { method: "resetTurnPicks", payload: resetTurnPicksSchema, result: jsonObject },
  { method: "cutTurnFrames", payload: cutTurnFramesSchema, result: okSchema },
  { method: "runVideos", payload: runVideosSchema, result: startedSchema },
  { method: "pollVideos", payload: projectOnlySchema, result: okSchema },
  { method: "clearVideos", payload: runKeysSchema, result: okSchema },
  { method: "runFrames", payload: runKeysSchema, result: startedSchema },
  { method: "prepareFramePick", payload: prepareFramePickSchema, result: startedSchema },
  { method: "setFramePick", payload: setFramePickSchema, result: jsonObject },
  { method: "setFramePicks", payload: setWalkPicksSchema, result: jsonObject },
  { method: "resetFramePicks", payload: resetWalkPicksSchema, result: jsonObject },
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
  { method: "getRigAnimation", payload: getRigAnimationSchema, result: jsonObject },
  { method: "saveRigAnimation", payload: saveRigAnimationSchema, result: jsonObject },
  { method: "resetRigAnimation", payload: resetRigAnimationSchema, result: jsonObject },
  { method: "runRigQa", payload: runRigQaSchema, result: jsonObject },
  { method: "setRigConstraints", payload: setRigConstraintsSchema, result: jsonObject },
  { method: "resetRigConstraints", payload: resetRigConstraintsSchema, result: jsonObject },
  { method: "setRigMesh", payload: setRigMeshSchema, result: jsonObject },
  { method: "resetRigMesh", payload: resetRigMeshSchema, result: jsonObject },
  { method: "setRigPath", payload: setRigPathSchema, result: jsonObject },
  { method: "resetRigPath", payload: resetRigPathSchema, result: jsonObject },
  { method: "tintRigParts", payload: tintRigPartsSchema, result: jsonObject },
  { method: "uploadRigTexture", payload: uploadRigTextureSchema, result: jsonObject },
  { method: "setRigTextureVersion", payload: setRigTextureVersionSchema, result: jsonObject },
  { method: "removeRigTextureVersion", payload: removeRigTextureVersionSchema, result: jsonObject },
  { method: "runRigRedraw", payload: runRigRedrawSchema, result: startedSchema },
  { method: "runRigSheet", payload: rigJobIdSchema, result: startedSchema },
  { method: "runRigSegment", payload: rigJobIdSchema, result: startedSchema },
  { method: "runRigLayout", payload: runRigLayoutSchema, result: startedSchema },
  { method: "runRigBones", payload: rigJobIdSchema, result: startedSchema },
  { method: "runRigAtlas", payload: rigJobIdSchema, result: startedSchema },

  // 45° 地图编辑器（模块五 · iso）
  { method: "listIsoProjects", result: z.object({ projects: z.array(jsonObject) }) },
  { method: "createIsoProject", payload: createIsoProjectSchema, result: jsonObject },
  { method: "getIsoProject", payload: isoGetSchema, result: projectViewSchema },
  { method: "saveIsoProject", payload: saveIsoProjectSchema, result: jsonObject },
  { method: "deleteIsoProject", payload: isoProjectIdSchema, result: okSchema },
  { method: "importIsoTileset", payload: importIsoTilesetSchema, result: jsonObject },
  { method: "importIsoSampleTileset", payload: isoProjectIdSchema, result: jsonObject },
  { method: "composeIsoAsset", payload: composeIsoAssetSchema, result: jsonObject },
  { method: "saveIsoTileset", payload: saveIsoTilesetSchema, result: jsonObject },
  { method: "removeIsoTileset", payload: removeIsoTilesetSchema, result: jsonObject },
  { method: "saveIsoDoc", payload: saveIsoDocSchema, result: jsonObject },
  { method: "applyIsoOps", payload: applyIsoOpsSchema, result: jsonObject },
  { method: "isoUndo", payload: isoHaveSchema, result: jsonObject },
  { method: "isoRedo", payload: isoHaveSchema, result: jsonObject },
  { method: "isoPlan", payload: isoPlanSchema, result: jsonObject },
  { method: "isoInspect", payload: isoInspectSchema, result: jsonObject },
  { method: "isoRender", payload: isoRenderSchema, result: jsonObject },
  { method: "runIsoGenerate", payload: runIsoGenerateSchema, result: jsonObject },
  { method: "runIsoPreview", payload: runIsoPreviewSchema, result: previewStartedSchema },
  { method: "runIsoExport", payload: runIsoExportSchema, result: startedSchema },
  { method: "cancelIsoJob", payload: isoProjectIdSchema, result: okSchema },
  { method: "setIsoApproved", payload: setIsoApprovedSchema, result: okSchema },
  { method: "revealIsoProject", payload: revealIsoProjectSchema, result: okSchema },

  // 地图编辑器（模块六，单项目 = 单张地图）
  { method: "listMapProjects", result: z.object({ projects: z.array(jsonObject) }) },
  { method: "createMapProject", payload: createMapProjectSchema, result: jsonObject },
  { method: "getMapProject", payload: mapGetSchema, result: projectViewSchema },
  { method: "saveMapProject", payload: saveMapProjectSchema, result: jsonObject },
  { method: "deleteMapProject", payload: mapProjectIdSchema, result: okSchema },
  { method: "importMapTileset", payload: importMapTilesetSchema, result: jsonObject },
  { method: "importSampleTileset", payload: mapProjectIdSchema, result: jsonObject },
  { method: "composeMapAsset", payload: composeMapAssetSchema, result: jsonObject },
  { method: "recomposeMapTileset", payload: recomposeMapTilesetSchema, result: jsonObject },
  { method: "saveMapTileset", payload: saveMapTilesetSchema, result: jsonObject },
  { method: "removeMapTileset", payload: removeMapTilesetSchema, result: jsonObject },
  { method: "saveMapDoc", payload: saveMapDocSchema, result: jsonObject },
  { method: "applyMapOps", payload: applyMapOpsSchema, result: jsonObject },
  { method: "mapUndo", payload: mapHaveSchema, result: jsonObject },
  { method: "mapRedo", payload: mapHaveSchema, result: jsonObject },
  { method: "mapPlan", payload: mapPlanSchema, result: jsonObject },
  { method: "mapInspect", payload: mapInspectSchema, result: jsonObject },
  { method: "mapRender", payload: mapRenderSchema, result: jsonObject },
  { method: "runMapGenerate", payload: runMapGenerateSchema, result: jsonObject },
  { method: "runMapPreview", payload: runMapPreviewSchema, result: previewStartedSchema },
  { method: "runMapExport", payload: runMapExportSchema, result: startedSchema },
  { method: "cancelMapJob", payload: mapProjectIdSchema, result: okSchema },
  { method: "setMapApproved", payload: setMapApprovedSchema, result: okSchema },
  { method: "revealMapProject", payload: revealMapProjectSchema, result: okSchema },

  // 音乐生成编辑（模块七）
  { method: "getMusicGuide", payload: getMusicGuideSchema, result: jsonObject },
  { method: "getMusicScoreGuide", payload: getMusicScoreGuideSchema, result: jsonObject },
  { method: "testMusicScore", result: jsonObject },
  { method: "listMusicJobs", result: z.object({ jobs: z.array(jsonObject) }) },
  { method: "createMusicJob", payload: createMusicJobSchema, result: jsonObject },
  { method: "getMusicJob", payload: getMusicJobSchema, result: jsonObject },
  { method: "saveMusicJob", payload: saveMusicJobSchema, result: jsonObject },
  { method: "saveMusicScorePlan", payload: saveMusicScorePlanSchema, result: jsonObject },
  { method: "runMusicScore", payload: runMusicScoreSchema, result: jsonObject },
  { method: "submitMusicScoreToSuno", payload: submitMusicScoreToSunoSchema, result: jsonObject },
  { method: "deleteMusicJob", payload: musicJobIdSchema, result: okSchema },
  { method: "setMusicApproved", payload: setMusicApprovedSchema, result: jsonObject },
  { method: "revealMusicJob", payload: musicJobIdSchema, result: okSchema },
  { method: "runMusicGeneration", payload: runMusicGenerationSchema, result: jsonObject },
  { method: "cancelMusicGeneration", payload: musicJobIdSchema, result: okSchema },
  { method: "refreshMusicJob", payload: musicJobIdSchema, result: jsonObject },
  { method: "getMusicWav", payload: getMusicWavSchema, result: jsonObject },
  { method: "getMusicLrc", payload: getMusicLrcSchema, result: jsonObject },
  { method: "listMusicHistory", payload: listMusicHistorySchema, result: jsonObject },
  { method: "listMusicStemInstruments", result: jsonObject },
  { method: "runMusicTool", payload: runMusicToolSchema, result: jsonObject },
  { method: "musicPeaks", payload: musicPeaksSchema, result: jsonObject },
  { method: "renderMusicEdit", payload: renderMusicEditSchema, result: jsonObject },
  { method: "saveMusicVersion", payload: saveMusicVersionSchema, result: jsonObject },
  { method: "deleteMusicVersion", payload: deleteMusicVersionSchema, result: okSchema },
  { method: "exportMusic", payload: exportMusicSchema, result: jsonObject },

  // 音效生成（模块八）
  { method: "listSfxJobs", result: z.object({ jobs: z.array(jsonObject) }) },
  { method: "createSfxJob", payload: createSfxJobSchema, result: jsonObject },
  { method: "getSfxJob", payload: sfxJobIdSchema, result: jsonObject },
  { method: "saveSfxJob", payload: saveSfxJobSchema, result: jsonObject },
  { method: "deleteSfxJob", payload: sfxJobIdSchema, result: okSchema },
  { method: "uploadSfxRef", payload: uploadSfxRefSchema, result: jsonObject },
  { method: "removeSfxRef", payload: removeSfxRefSchema, result: jsonObject },
  { method: "runSfxGeneration", payload: sfxJobIdSchema, result: startedSchema },
  { method: "cancelSfxGeneration", payload: sfxJobIdSchema, result: jsonObject },
  { method: "setSfxApproved", payload: setSfxApprovedSchema, result: jsonObject },
  { method: "revealSfxJob", payload: sfxJobIdSchema, result: okSchema },
  { method: "exportSfx", payload: exportSfxSchema, result: jsonObject }
];


export const PACKAGE_NAME = "dsh-game-material-master";
export const SERVICE_NAME = "gameStudio";

/**
 * 当前 DSH（typert 0.1.7+）的 strict codec 必须带 `create()`。
 * 注册时只检查工厂存在；真正过边界时调用 `codec.create().parse(value)`。
 * 旧写法把 Zod schema 挂在 `schema` 上，启动时会直接拒绝整份 manifest。
 */
function strictCodec(typeSymbol: string, schema: z.ZodType) {
  return {
    mode: "strict" as const,
    typeSymbol,
    create: () => schema
  };
}

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
              codec: strictCodec(`${PACKAGE_NAME}#${spec.method}Payload`, spec.payload)
            }
          ],
    result: strictCodec(`${PACKAGE_NAME}#${spec.method}Result`, spec.result)
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
 * 暴露成模型工具的方法（`game_material({action:'call'})` 的 method 枚举）。
 * 顺序即清单顺序，方便在工具描述里按模块分组。
 */
export const TOOL_METHODS: Array<{ method: string; payload: boolean }> = METHODS.filter(
  (spec) => spec.clientOnly !== true
).map((spec) => ({ method: spec.method, payload: spec.payload !== undefined }));
