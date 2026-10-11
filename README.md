[English](https://github.com/universe-st/dsh-game-material-master/blob/main/README.en.md) | 中文

# 游戏素材大师

**从一张角色设定图出发，批量做出游戏里真正要用的素材。**

火山方舟 **Seedream** 负责生图，**MiniMax** 负责图生视频，抠像、抽帧、像素量化、合图全部在
本机用 `ffmpeg` 完成——不需要任何系统图像库，素材也不会被传到第三方服务。

[![npm](https://img.shields.io/npm/v/dsh-game-material-master?color=blue)](https://www.npmjs.com/package/dsh-game-material-master)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

![游戏素材大师 · 工作台](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-00-workbench.png)

> **30 秒上手**：`dsh plugin --profile web add dsh-game-material-master` → 重启 DSH →
> 侧栏点「游戏素材大师」→ 设置里填两个 API Key → 新建项目、上传设定图 → 点「生成转圈视频」
>（默认路径：角色原地匀速转一圈，再自动截出八个方向；要逐方向生图就在阶段①切一下方式）。
>
> 侧栏那个入口上还有一个**小折角菜单按钮**：点它直接弹出六个功能，一步跳进要用的那个；
> 不用的功能可以在设置里关掉（见「功能管理」）。

六个模块共用同一套「生成 → 验收 → 重跑」工作台。每个阶段都能**单独重做**，每份产物都能
**逐项打「通过」**；「审核模式」可以选 agent 自动审完就往下走，也可以选每一步停下来等你点头。

| 模块 | 做什么 | 走完能拿到 |
|---|---|---|
| **① 八方向图生成** | 一张设定图 → 8 方位 × 8 帧（默认「转圈截帧」：一段转圈视频截出八个方向） | 可用 WASD 操控预览的行走精灵图 |
| **② 图片生成** | 提示词（可带参考图）→ 出图 → 抠绿幕 | 干净透明的 PNG 立绘 / 道具 |
| **③ 序列帧生成** | 首尾帧或参考视频 → 生成视频 → 抽帧 → 抠像 | 横向排布、可循环播放的序列帧 |
| **⑤ 45°地图地块生成**（实验性） | 45° 等距地块 → 铺成整张地图 | 地块包（PNG）+ 地图 PNG + 布局 JSON |
| **⑥ 地图编辑器**（实验性，**全本地零计费**） | 导入自己的 tileset → 切分与地形族 → 自动过渡 → 多图层拼图 | 分层/合并 PNG + 自有 JSON + **Tiled `.tmj`/`.tsj`** |
| ~~④ 骨骼动画生成~~ | 拆件 → 装配 → 骨骼动画 → Spine / DragonBones 图集 | **实验性功能，本文不展示** |

> 💡 **模块⑤「45°地图地块生成」的核心思路是「几何交给代码，内容交给 AI」。**
> 菱形模板由本机代码渲染（严格 2:1 等距），AI 只负责把菱形内部填成指定地貌；
> 生成完再本地量一次、仿射对齐到标准菱形，最后本地按等距网格铺图。
> 好处是**几何永远精确**——地块拼起来不会有缝，换种子重铺逐像素可复现。
> 实测「让模型自由画菱形」的比例只有 1.03~1.55（对不上 2:1），而模板填充的达标率是 100%。

> 💡 **模块⑥「地图编辑器」走的是另一条路：不生成素材，只导入你自己的 tileset。**
> 导入图集 → 按网格或矩形切分 → 把图块归入地形族（自动过渡支持**单块 / 16 掩码 / 47 掩码 blob**）→
> 多图层拼图（每层可设高度偏移）→ 导出 PNG、自有 JSON 与 **Tiled `.tmj`/`.tsj`**（图集一起打包，Tiled 直接能打开）。
> 正方形俯视与 2:1 等距两种格网都支持，**一次模型调用都没有，也就不花钱**。

> ⚠️ **模块④「骨骼动画生成」仍是实验性功能，尚未完善**：拆件质量取决于生图模型，自动装配与骨骼推导
> 对真实立绘经常需要人工校正（agent 视觉先验或手工拖放），导出的 Spine / DragonBones 产物也还没经过
> 足够的引擎侧验证。界面上该模块带「实验性」角标，并在每次进入时弹窗说明。本文只展示前三个模块。
> 如果你需要它、或者想一起把它做扎实，欢迎到
> [GitHub 仓库](https://github.com/universe-st/dsh-game-material-master) 参与开发，
> 或加入 **QQ 群 `1126382236`**（见文末「交流与反馈」）。

---

## ① 八方向图生成

一张正面设定图进去，八个方位一次做完：**绿幕图 → 行走视频 → 序列帧 → 精灵整图 → 可操控预览**。

```mermaid
flowchart LR
  S(["设定图"]) --> I["① 八方向绿幕图"] --> V["② 行走视频"] --> F["③ 提取序列帧"] --> P["④ 合成整图"] --> W(["⑤ WASD 预览"])
```

### ① 的两种生成方式：转圈截帧（默认）/ 逐方向生图

八张方向图有两条产法，产物完全一样（`images/<方位>.png`），所以后面四步不用换做法：

| | **转圈截帧（默认）** | 逐方向生图（备选） |
|---|---|---|
| 做法 | 先生成**一段**「角色原地匀速转一整圈」的绿幕视频，再按时间轴截出八个方向的帧 | 八个方位各自生图，按依赖顺序 |
| 花费 | 一次视频调用 | 八次生图调用 |
| 一致性 | **八个方向同源**：同一个角色、同一段光线、同一套画风 | 模型每次都要重新理解角色，脸型/发色/服装容易漂移 |
| 调位置 | 时间轴上有**八个可拖动的圆圈**，拖到哪一帧就切哪一帧（本机重切，免费、即时） | 逐张重新生成 |

界面上那一排圆圈就是八个方位的截帧位置，底下的缩略条带是整圈候选帧——对着画面拖，
松手就重切那一张（并自动作废这个方位的行走视频与序列帧，避免新旧朝向混在一起）。
默认位置是「从正面开始、匀速转满一圈」的等分假设；模型实际转的方向或快慢不一样时，
直接拖圆圈，或点一下「转圈方向」重排。改变候选帧数（8~64）会自动重抽，并把拖过的位置按比例换算。

### 怎么用

1. **新建项目 → 上传设定图**，写提示词（转圈截帧用的是**一份转圈视频提示词**；逐方向生图是每个方位一份，
   另有「统一附加提示词」八个方向共用）。
2. **生成转圈视频**（默认路径）：角色原地匀速转一整圈，绿幕背景。视频到手后插件会自动抽候选帧
   并切出八个方向，一般不需要你动手。**逐方向生图**（备选）则是**一键生成全部**：八个方位按依赖顺序
   出绿幕全身图。逐张能看到用时、落到哪个模型；不满意就**重新生成**这一张，或展开**编辑提示词**只改它。
3. **生成全部视频**：让角色在原方位原地走三步。这一步最贵、也最慢（单段 1~6 分钟）。
4. **提取全部序列帧**：每段视频按时长平均抽帧，这里同时完成统一裁剪、缩放与**像素风量化**。
5. **合成整图**：剔除绿幕，按行序拼成一张精灵图；行序可用 ↑↓ 拖动调整，合成前可存参数。
6. **行走预览**：用 WASD 或方向键操控角色，八方向接得顺不顺，一眼就能看出来。

### ① 八方向绿幕图

**转圈截帧（默认）**：一段「原地匀速转一整圈」的绿幕视频，按时间轴截出八个方向；
轴上八个圆圈就是各自的截帧位置，拖着改，松手即时重切（本机、免费）。

![转圈截帧](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-01b-sprite-turn.png)

**逐方向生图（备选）**：八个方位各自生图，单张更清晰，适合只要几个方向或追求单张质量时。

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
4. 结果区**逐张**看：通过、下载原图 / 下载 PNG（抠像结果）、重新生成、删除；背景占比会直接标出来，判断抠像干不干净。

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

六个模块（含实验性的骨骼动画、地图地块与地图编辑器）的**全部功能都能通过对话调用**。插件把整条流水线注册成
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
| 生图模型 | 默认 `doubao-seedream-5-0-flash-260915`，可切 5.0 Pro / Lite / 4.5 |
| MiniMax API Key | 「测试连接」免费，能区分 Key 无效与其它错误 |
| 视频模型 | 默认 `MiniMax-H3`（v2 协议）；Hailuo / I2V 走 v1；优云智算版 H3 显式选择 |
| Base URL | 主机根，不含 `/v1` `/v2`。国内 `api.minimax.cn`，国际 `api.minimaxi.com` |
| 默认参数 | 单格宽高、抽帧张数、像素块边长、抠像阈值等 |
| 功能管理 | 逐个开关六个模块：关掉的模块界面上不再出现，**对话里的 AI 也调不到**（见下） |

Key 只写入本机 `<DSH_HOME>/game-material-master/config.json`，界面回显始终脱敏。
**模型是插件级设置，三个模块共用**，切换模型后任务自动对齐新档位。

### 功能管理（隐藏不用的模块）

不用的模块可以在**设置 → 游戏素材大师 → 功能管理**里关掉，随时再打开，已有项目数据不会删：

- **界面**：工作台页签、侧栏快捷菜单里都不再出现它；如果当时正停在这个模块，会自动落到第一个可见模块。
- **对话**：`game_material_call` / `status` / `intake` / `upload` / `wait` / `review` / `approve`
  一律拒绝，报错里说明去哪里打开。只藏界面不拦工具等于没藏——模型看不见页签，
  照样能调生成类方法真实计费，所以宿主半区每次都按最新配置再拦一次。
- 可见性**只能由用户在设置页里改**：工具面拒绝 `saveConfig({hiddenModules})`，
  否则模型能自己把隐藏的功能放出来。
- 全部关掉也是允许的，工作台会提示「所有功能都已被隐藏」。

## 界面语言

**插件界面跟随 DSH 自身的语言设置**（设置 → 通用 → 语言），中文 / 英文都是一等公民，
切换**即时生效**、不用刷新页面：工作台标题、六个模块页签、每一张卡片的按钮、提示条、
弹窗与设置页全部跟着走。

实现上不猜也不复制 DSH 的语言状态，而是接 DSH 的 `locale` 服务
（`@deepseek-ai/dsh-client-locale`）：插件把中英词条表注册进去，之后所有界面文案都从它取。
服务不在时不报错，界面退回中文原文。

**内置默认提示词也跟着切。** 八方向生图提示词、行走视频提示词、转圈视频提示词在英文界面下
就是英文版——它们会真的发给 Seedream / MiniMax，所以语言得跟界面一致，不然用户读不懂
自己在调什么。规则是「只换没改过的那些」：手改过的提示词切语言时一个字都不动，
点「重置为默认」得到的是**当前语言**的默认值。提示词存在宿主侧（宿主拿不到 locale 服务），
所以浏览器半区每次读项目、重置提示词时把当前语言一起带过去。

范围说明：**多语言覆盖的是浏览器半区的界面文案与内置默认提示词**——工作台标题、
六个模块页签、每一张卡片的按钮与提示条、弹窗、设置页、验收控件、默认提示词。
以下两类仍是中文，因为 DSH 目前只把 locale 服务提供给浏览器半区：

- **运行日志里由宿主写入的行**（「开始生成「南 · 正对镜头」」「…生成完成，用时 12.3 秒」等）
  以及拆件质检给出的动态结论；
- 对话工具返回给模型看的文本（`game_material_status` / `review` 的渲染、`intake` 的追问）。

界面上能点、能改、能验收的部分都是双语。

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
├── rig-jobs/<id>/      骨骼动画（实验性：sheet / parts / layout / rig / atlas）
├── tile-jobs/<id>/     地图地块（template / raw / cell / decor / map / export）
└── map-jobs/<id>/      地图编辑器（tilesets / maps / preview / export）
```

> 地图地块的 `raw/` 会**保留原始生成结果**：改了单元格尺寸之类的规整参数后，
> 可以零成本重跑规整，不必重新花钱生成。

## 开发

```bash
npm run build        # tsc → lib/，并剥掉浏览器束结尾的 export
npm run typecheck    # 只做类型检查
```

本地自检（不联网、不花钱）：`scripts/verify-host.mjs`（宿主链路）、`verify-tools.mjs`
（对话调用面）、`verify-pipeline.mjs`（抽帧 / 抠像 / 合成）、`verify-client.mjs` +
`verify-feedback.mjs`（浏览器半区契约与真渲染）、`verify-i18n.mjs`（中英词条表完整性）、
`verify-rig.mjs`（骨骼算法层）等。真实 API 端到端脚本会花钱，按需运行。

### 加一条界面文案

中文原文**就是**词条表的 key，所以正常写代码即可：

```ts
h("span", null, T("正在装配定位…"))                       // 纯文案
T("第 {n0} 帧", { n0: index + 1 })                        // 带插值，英文可自由换语序
```

然后在 `src/client.ts` 的词条表（`i18n-ignore-start` / `i18n-ignore-end` 之间）补一条英文；
漏了也不会崩，`verify-i18n.mjs` 会拦下来。批量包老代码用
`node scripts/i18n-wrap.mjs src/client.ts --write`（词法级、幂等，可反复跑）。

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

## 交流与反馈

- **QQ 群：`1126382236`**（群名「DSH游戏素材大师插件」）——新版本发布、路线图和踩坑经验都在群里同步，
  欢迎进群获取最新动态，也欢迎直接参与开发：提需求、报 bug、认领模块都可以在群里聊。
- 也可以在 [GitHub Issues](https://github.com/universe-st/dsh-game-material-master/issues)
  提 issue 或直接发 PR。

## 许可

[MIT](LICENSE)

> 完整工程文档（算法细节、自检契约、历史踩坑）见 [docs/ENGINEERING.md](docs/ENGINEERING.md)。
