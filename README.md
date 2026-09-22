# 游戏素材大师

**从一张角色设定图出发，批量做出游戏里真正要用的素材。**

火山方舟 **Seedream** 负责生图，**MiniMax** 负责图生视频，抠像、抽帧、像素量化、合图全部在
本机用 `ffmpeg` 完成——不需要任何系统图像库，素材也不会被传到第三方服务。

[![npm](https://img.shields.io/npm/v/dsh-game-material-master?color=blue)](https://www.npmjs.com/package/dsh-game-material-master)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

![游戏素材大师 · 工作台](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-00-workbench.png)

> **30 秒上手**：`dsh plugin --profile web add dsh-game-material-master` → 重启 DSH →
> 侧栏点「游戏素材大师」→ 设置里填两个 API Key → 新建项目、上传设定图、点「一键生成全部」。

三个模块共用同一套「生成 → 验收 → 重跑」工作台。每个阶段都能**单独重做**，每份产物都能
**逐项打「通过」**；「审核模式」可以选 agent 自动审完就往下走，也可以选每一步停下来等你点头。

| 模块 | 做什么 | 走完能拿到 |
|---|---|---|
| **① 八方向图生成** | 一张设定图 → 8 方位 × 8 帧 | 可用 WASD 操控预览的行走精灵图 |
| **② 图片生成** | 提示词（可带参考图）→ 出图 → 抠绿幕 | 干净透明的 PNG 立绘 / 道具 |
| **③ 序列帧生成** | 首尾帧或参考视频 → 生成视频 → 抽帧 → 抠像 | 横向排布、可循环播放的序列帧 |
| ~~④ 骨骼动画生成~~ | 拆件 → 装配 → 骨骼动画 → Spine / DragonBones 图集 | **实验性功能，本文不展示** |

> ⚠️ **模块④「骨骼动画生成」仍是实验性功能，尚未完善**：拆件质量取决于生图模型，自动装配与骨骼推导
> 对真实立绘经常需要人工校正（agent 视觉先验或手工拖放），导出的 Spine / DragonBones 产物也还没经过
> 足够的引擎侧验证。界面上该模块带「实验性」角标，并在每次进入时弹窗说明。本文只展示前三个模块。
> 如果你需要它、或者想一起把它做扎实，欢迎到
> [GitHub 仓库](https://github.com/universe-st/dsh-game-material-master) 参与开发。

---

## ① 八方向图生成

一张正面设定图进去，八个方位一次做完：**绿幕图 → 行走视频 → 序列帧 → 精灵整图 → 可操控预览**。

```mermaid
flowchart LR
  S(["设定图"]) --> I["① 八方向绿幕图"] --> V["② 行走视频"] --> F["③ 提取序列帧"] --> P["④ 合成整图"] --> W(["⑤ WASD 预览"])
```

### 怎么用

1. **新建项目 → 上传设定图**，写每个方位的生图提示词（可只写一次「统一附加提示词」，八个方向共用）。
2. **一键生成全部**：八个方位按依赖顺序出绿幕全身图。逐张能看到用时、落到哪个模型；不满意就
   **重新生成**这一张，或展开**编辑提示词**只改它。
3. **生成全部视频**：让角色在原方位原地走三步。这一步最贵、也最慢（单段 1~6 分钟）。
4. **提取全部序列帧**：每段视频按时长平均抽帧，这里同时完成统一裁剪、缩放与**像素风量化**。
5. **合成整图**：剔除绿幕，按行序拼成一张精灵图；行序可用 ↑↓ 拖动调整，合成前可存参数。
6. **行走预览**：用 WASD 或方向键操控角色，八方向接得顺不顺，一眼就能看出来。

### ① 八方向绿幕图

![八方向绿幕图](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-01-sprite-images.png)

### ② 行走动作视频

![行走动作视频](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-02-sprite-videos.png)

### ③ 提取序列帧

![提取序列帧](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-03-sprite-frames.png)

### ④ 抠绿幕合成整图

![抠绿幕合成整图](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-04-sprite-sheet.png)

### ⑤ 行走预览

![行走预览](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-05-sprite-preview.png)

> **单独重跑**：任何一步不满意，只重做那一步——单个方位、单个阶段都行，不必整批重来。

---

## ② 图片生成

按提示词出图，可选参考图。生成后**自动抠绿幕**，落成透明 PNG——也可以直接上传一张已有图片，
只走抠像不花生图的钱。

### 怎么用

1. 写主提示词；需要跨批次复用的共同要求（比如「不要出现文字水印」）写进**统一附加提示词**。
2. 可选：拖入**参考图**（最多 10 张），有参考图时走图生图；引用多张可在提示词里写「图一」「图二」。
3. 选好模型 / 尺寸 / 张数，点**生成**。
4. 结果区**逐张**看：通过、下载 PNG、重新生成、删除；背景占比会直接标出来，判断抠像干不干净。

![图片生成 · 提示词与参考图](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-06-image.png)

![图片生成 · 抠像结果](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-07-image-keyed.png)

---

## ③ 序列帧生成

比八方向图更「一次到位」的路径：给一张首帧图（或参考图 + 参考视频），直接生成一段循环动作，
再抽帧、抠像、横向合成并**原地循环播放预览**。

```mermaid
flowchart LR
  A(["首尾帧 / 参考图 + 参考视频"]) --> V["生成视频"] --> F["提取序列帧"] --> K["抠绿幕 + 横向合成"] --> L(["循环播放验收"])
```

### 怎么用

1. 选模式——平台规定两种互斥：
   - **首尾帧模式**：一张图作为起始画面（尾帧可选）；
   - **多模态参考模式**：参考图 + 参考视频，用来约束风格与动作。
2. 写提示词、选模型 / 时长（4~15 秒）/ 分辨率，点**生成视频**。
3. **提取序列帧**：抽帧、统一裁剪、像素量化。
4. **绿幕抠像与合成**：调好抠像参数后合成横向条图；右侧预览区会按帧率循环播放，
   **动作连不连贯、抠像边缘稳不稳，直接看播放**。
5. **验收**：三步各自打「通过」。

![序列帧生成 · 视频输入](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-08-sequence-input.png)

![序列帧生成 · 抠像合成与循环预览](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-09-sequence-compose.png)

---

## 用对话驱动

四个模块（含实验性的骨骼动画）的**全部功能都能通过对话调用**。插件把整条流水线注册成
`game_material_*` 工具，agent 能自己推进、等待、审查，也可以在每一步停下来让你验收。

| 工具 | 作用 |
|---|---|
| `game_material_intake` | **固定流程第 0 步**：先把关键参数与审核模式问清楚，再动手 |
| `game_material_call` | 万能通道：插件全部远程方法逐个可调，覆盖全部功能 |
| `game_material_upload` | 按本机文件路径上传素材（设定图 / 参考图 / 首尾帧 / 部件…） |
| `game_material_reviewMode` | 记下审核模式：`auto` 自动审核 / `manual` 每一步人工审核 |
| `game_material_status` | 看一眼当前进度，以及现在该做哪一步 |
| `game_material_wait` | 阻塞等到「没有任务在跑」，回来就是可审查状态 |
| `game_material_review` | 出**验收包**：每个产物的绝对 URL、状态、通过标记、深链接 |
| `game_material_approve` | 打「通过 / 取消通过」 |

验收链接是**深链接**：agent 在回复里贴出的 `openUrl` 点一下就切到插件对应页面，原地落到
对应模块 / 项目 / 阶段上，不需要你自己翻。

---

## 安装

```bash
# npm 安装
dsh plugin --profile web add dsh-game-material-master

# 本地目录安装（开发时）
dsh plugin --profile web add /path/to/dsh-game-material-master
```

包已发布到 npm：[dsh-game-material-master](https://www.npmjs.com/package/dsh-game-material-master)
（当前 `0.1.1`，`latest`）。本包没有运行时依赖，`dsh plugin add` 拉下来即可用。

装完**重启 DSH**（宿主半区在启动时装入）。浏览器半区按磁盘上的 `lib/client.js` 现取，
刷新浏览器即可生效。

**依赖**：`ffmpeg` / `ffprobe` 需要在 `PATH` 上（macOS：`brew install ffmpeg`），
也可用 `FFMPEG_PATH` / `FFPROBE_PATH` 指定绝对路径。本包**没有任何运行时 npm 依赖**，
`zod`、`cordis` 等全部从 DSH 自身的安装树解析。

> 从旧版 `dsh-8dir-sprites` 升级时，首次启动会自动迁移数据目录，已有项目无缝接上。

## 配置

**设置 → 游戏素材大师**：

![设置](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-10-settings.png)

| 项 | 说明 |
|---|---|
| 火山方舟 API Key | 「测试连接」会真实生成一张 1K 小图（少量费用），同时验证 Key 与模型 |
| 生图模型 | 默认 `doubao-seedream-4-0-250828`，可切 4.5 / 5.0 Lite / Pro |
| MiniMax API Key | 「测试连接」免费，能区分 Key 无效与其它错误 |
| 视频模型 | 默认 `MiniMax-H3`（v2 协议）；Hailuo / I2V 走 v1；优云智算版 H3 显式选择 |
| Base URL | 主机根，不含 `/v1` `/v2`。国内 `api.minimax.cn`，国际 `api.minimaxi.com` |
| 默认参数 | 单格宽高、抽帧张数、像素块边长、抠像阈值等 |

Key 只写入本机 `<DSH_HOME>/game-material-master/config.json`，界面回显始终脱敏。
**模型是插件级设置，三个模块共用**，切换模型后任务自动对齐新档位。

## 常见坑

- 提示词别用「剪影」——生图模型会照字面把角色画成纯黑轮廓。
- 区分「转身」和「视线」：写方位时要补「只绕竖轴转身、视线始终水平」，否则会变抬头仰视。
- 图生视频不保证守住纯色背景（可能被打光成渐变），所以抠像不认单一绿色。
- 重复提交会被拦截（界面与对话都拦），避免白花钱。

## 产物位置

```
<DSH_HOME>/game-material-master/
├── projects/<id>/      八方向图（source / images / videos / frames / keyed / preview / out）
├── image-jobs/<id>/    图片生成
├── sequence-jobs/<id>/ 序列帧生成
└── rig-jobs/<id>/      骨骼动画（实验性：sheet / parts / layout / rig / atlas）
```

## 开发

```bash
npm run build        # tsc → lib/，并剥掉浏览器束结尾的 export
npm run typecheck    # 只做类型检查
```

本地自检（不联网、不花钱）：`scripts/verify-host.mjs`（宿主链路）、`verify-tools.mjs`
（对话调用面）、`verify-pipeline.mjs`（抽帧 / 抠像 / 合成）、`verify-rig.mjs`
（骨骼算法层）等。真实 API 端到端脚本会花钱，按需运行。

改代码后如何生效：

| 改了哪里 | 怎么生效 |
|---|---|
| `src/client.ts`（浏览器半区） | 刷新浏览器即可 |
| `src/*.ts` 宿主半区 | 重启 DSH（或 `--patch` 热重载） |

本文截图由 Playwright 对着真实界面拍摄，原图在
[`docs/images/`](https://github.com/universe-st/dsh-game-material-master/tree/main/docs/images)。

## 已知取舍

- **像素风来自后处理**（抽帧阶段的像素量化），不来自提示词——Seedream 会忽略「像素画」类指令。
- **拆件质量由生图模型决定**，是当前最大瓶颈。模型偶尔会「换角色」或把角色拆成服装裁片；
  最可靠的路径是「上传自己的部件 PNG」（文件名即部件名），完全绕开生图。
- **自动装配只对「部件就是参考图上整块肢体」的素材可靠**；真实立绘走生图拆件时，
  建议用 agent 视觉先验或手工拖放校正（这些步骤都不花钱）。
- MiniMax 偶发内容审核拒绝（实测约 10%），换一版更中性的提示词重试即可。

## 许可

[MIT](LICENSE)

> 完整工程文档（算法细节、自检契约、历史踩坑）见 [docs/ENGINEERING.md](docs/ENGINEERING.md)。
