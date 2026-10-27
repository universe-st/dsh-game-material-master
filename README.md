[English](https://github.com/universe-st/dsh-game-material-master/blob/main/README.en.md) | 中文

# 游戏素材大师

**从一张角色设定图出发，批量做出游戏里真正要用的素材。**

火山方舟 **Seedream** 负责生图，**MiniMax**（或本机 **ComfyUI**）负责图生视频，抠像、抽帧、
像素量化、合图全部在本机用 `ffmpeg` 完成——不需要任何系统图像库，素材也不会被传到第三方服务。

[![npm](https://img.shields.io/npm/v/dsh-game-material-master?color=blue)](https://www.npmjs.com/package/dsh-game-material-master)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> **🆕 0.11.2 更新**：生图尺寸与抠像底色修复 —— 图片任务默认**跟随全局尺寸**，也可切「**自定义**」只影响本任务；
> 全局尺寸支持 `1K` / `2K` / `4K` 与精确宽高，ComfyUI 工作流里写死的 `Empty*` 尺寸也会被自动注入。
> 新增可配置**抠像背景色**（绿 / 蓝 / 品红 / 青 / 黄 / 红 / 白 / 黑 + 自定义），图片、序列帧、八方向、地图整图、
> 45° 物件与两套 AI 生成素材入口都可选；默认提示词里的「绿幕 / #00FF00」会跟着底色替换，用户手写原文不改。
>
> **0.11.0 更新**：两套地图编辑器补上 **Agent 闭环** —— `mapInspect` / `isoInspect` 按区域读逐格、物件、整图、标记与通行性，
> `mapRender` / `isoRender` 同步出**检查图**（区域裁切、放大、可叠标记 / 网格 / 通行性 / 轮廓，返回本机绝对路径交给 `read_image`）；
> `applyMapOps` / `applyIsoOps` 新增 **`dryRun`**（只校验不写盘）与 **`ifRevision`**（旧版本直接拒绝，防覆盖）。
> 标记可带 **类型 / 颜色 / 备注 / 标签**（`marker update`，导出格式升到 `@5` / `@2`）；整图支持**移动 / 旋转**、最小占格放宽到 **1×1**，
> 素材属性里可**重画通行区域**；45° 物件可**复制**；导入素材支持直接传**本机路径**；所有项目 / 任务都能**一键复制 ID**。
> 另外修掉「整图多格笔刷被标记 / 橡皮借用」的问题。wire 方法 184 → **188**，新增自检 `verify-map-agent`。
>
> **0.10.0 更新**：对话工具面收成一个 **`game_material`**（`action` 选 `guide / intake / call / status /
> wait / review / approve / reviewMode / upload`），常驻上下文从 **49 KB 降到约 4 KB**，流程与方法表改成按需读手册；
> 模块⑤换成**全本地的 45° 地图编辑器**（2:1 等距、4×4 自动连接、多格 / 高处物件、动画地块、标记层、环绕、
> 一键生成；还能「**AI 生成素材**」：自动开对话生成，整理好回链到「新增素材」确认导入）；
> 新增**可选 ToAPIs 异步图片 / 视频后端**（感谢 [PR #7](https://github.com/universe-st/dsh-game-material-master/pull/7)，
> 来自 [@ToAPIs-2025](https://github.com/ToAPIs-2025)）。
> 0.9.x 的 **音效生成**（Seed-Audio）与网络重试修复继续保留。
>
> **0.10.1 修复**：45° 地图编辑器「一键生成 → 大陆」不再崩溃（高度场中点插值写到了不存在的格子上）。
>
> **0.10.2 更新**：ToAPIs 生图可选**原生透明背景**（GPT Image，下载原图不再二次抠像），图生视频可选
> **画幅比例**（方形角色用 1:1）；透明首帧会先铺白再交给视频模型。感谢
> [PR #8](https://github.com/universe-st/dsh-game-material-master/pull/8)（[@YamiAnn](https://github.com/YamiAnn)）
> 与真机验收记录。
> 完整变更见 [AGENTS.md 发布记录](https://github.com/universe-st/dsh-game-material-master/blob/main/AGENTS.md#已发布版本)。

![游戏素材大师 · 工作台](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-00-workbench.png)

> **30 秒上手**：`dsh plugin --profile web add dsh-game-material-master` → 重启 DSH →
> 侧栏点「游戏素材大师」→ 设置里填好要用的 API Key（生图 / 视频；音效另填语音 Key）→ 新建项目、上传设定图 → 点「生成转圈视频」
>（默认路径：角色原地匀速转一圈，再自动截出八个方向；要逐方向生图就在阶段①切一下方式）。
>
> 侧栏那个入口上还有一个**小折角菜单按钮**：点它直接弹出八个功能，一步跳进要用的那个；
> 不用的功能可以在设置里关掉（见「功能管理」）。

八个模块共用同一套「生成 → 验收 → 重跑」工作台。每个阶段都能**单独重做**，每份产物都能
**逐项打「通过」**；「审核模式」可以选 agent 自动审完就往下走，也可以选每一步停下来等你点头。

| 模块 | 做什么 | 走完能拿到 |
|---|---|---|
| **① 八方向图生成** | 一张设定图 → 8 方位 × 8 帧（默认「转圈截帧」：一段转圈视频截出八个方向；两处视频都能**自己选本地文件**顶替生成） | 可用 WASD 操控预览的行走精灵图（中间每一张图都能单独存或整包 zip） |
| **② 图片生成** | 提示词（可带参考图）→ 出图 → 抠绿幕 | 干净透明的 PNG 立绘 / 道具 |
| **③ 序列帧生成** | 首尾帧或参考视频 → 生成视频 → 抽帧 → 抠像 | 横向排布、可循环播放的序列帧 |
| **⑤ 45°地图编辑器**（**全本地零计费**） | 导入自己的 45° 菱形素材（或用内置素材）→ 2:1 等距画布上画地面 / 自动连接 / 多格物件 / 标记 → 导出。素材属性在导入时一次定死（物件大小可在「新增素材」里按地格实时预览并自己调），之后只能改名字 / 播放速度 / 循环方式；内置草地、泥土、石地、水面、水岸自动连接与树 / 石 / 灌木 / 木桶 / 石屋 | PNG + 存档 JSON（等距网格、自动连接、动画地块、多格物件、标记点、通行性）；勾几项导几项，多个产物自动打成 ZIP |
| **⑥ 俯视地图编辑器**（**全本地零计费**） | 选一张素材图 → 直接画（参照 AsLib 的 RPG Map Maker 重做：一屏、纯图标、零术语；默认「地理层 / 装饰层 / 建筑层」三层且可改名换序；**标记层**：每格放一个可命名的标记，画成圆圈里的数字；素材窗口里还有 **AI 生成素材**：填提示词 / 名字 / 帧数 / 方式 / 用法，插件会**自动开一个新对话**去生成 —— 用哪种素材（普通 / 整格 / 拼块）由它按提示词自动判断，只让模型画**一块无缝的砖**，16 种接法 / 5 种形状与断口收口都由插件用代码拼出来（这样拼到地图上才不会有缝）。会动的素材走「拼块」（帧数 = 变体，会自动连接）或「普通」（翻页图），每张素材还能在「新增素材」里单独设自己的播放速度（不设就跟设置里的全局速度走）、**清晰度**（2K 大图缩到 32px 格子时用面积平均 / 最近邻 / 平均+锐化，细节差很多）、**循环方式**（正放 / 倒放 / 来回）；另有**整图**（一张画一次占 N×M 格：雕像 / 壁画 / 地毯，右键转 90°、绿幕自动抠成透明、导入时逐格点通行区域）；新建项目还能选**一格多大**（16 / 32 / 48 / 64，想让 AI 素材更清楚就用 48 / 64），模型在四周留的白框会被自动裁掉；整格只有 16 种接法、没有动画，界面里会把帧数与视频模型锁住，回来点链接这张图与用法就填在「新增素材」里） | PNG + 存档 JSON（地图四周环绕、自动连接、动画地块、标记点）；勾几项就导几项，多个产物自动打成一个 ZIP 下载 | 
| **⑦ 音乐生成编辑**（谱乐 AI） | 灵感提示词或完整歌词 → 自动开一个**不挂靠项目**的新对话；对话里的 agent 读内置创作指南、扩写提示词、选 Suno / Mureka / MiniMax / ACE-Step 与模式并生成 → 回界面裁剪 / 调音量 / 淡入淡出 / 标准化 → 保存版本与导出。另有**谱曲模式**：先分析想法、给出曲风/调性/段落/配器方案，再用 scoremill 写 MIDI、本地渲染试听、逐版修改，满意后可选交给 Suno 生成正式版 | MP3 / WAV / M4A（多产物可打 zip）；谱曲模式另有 MIDI / 试听 / 方案 / compose.py 的乐谱包。原曲保留，编辑与谱曲结果都是新版本 |
| **⑧ 音效生成**（火山引擎 Seed-Audio） | 一句话描述声源 / 环境 / 强度 / 时长 → 生成音效、环境音、UI 声、生物吼叫或角色配音；可带 1 张参考图或最多 3 条参考音频（两者互斥）；每次生成新增一条 take，旧 take 不覆盖 | WAV / MP3 / Ogg Opus；可单条导出或全部打 zip。单次最长 120 秒；每次生成真实计费 |
| ~~④ 骨骼动画生成~~ | 拆件 → 装配 → 骨骼动画 → Spine / DragonBones 图集 | **实验性功能，本文不展示** |

> 💡 **模块⑤「45°地图编辑器」的几何由代码保证，内容由你导入。**
> 2:1 等距的步进、菱形位置、物件底面中心、遮挡顺序全部由宿主算好；
> 界面只执行绘制计划，所以预览与导出不会错位。自动连接是严格的 4×4 = 16 块
> （N/E/S/W 位序），物件可以高出一格（树冠 / 屋顶），地面与标记四周环绕。
> **一次模型调用都没有，也就不花钱。**

> 💡 **模块⑥「俯视地图编辑器」借鉴了 [AsPJT/AsLib](https://github.com/AsPJT/AsLib/tree/master) 的 RPG Map Maker，按它重做为一屏、纯图标、零术语。**
> 左边是素材调色板与 12 个图标按钮，右边就是画布。**「素材」点开是一张素材列表 + 一个「新增素材」**：
> 新增时弹窗口填**素材图 / 名字 / 格子大小 / 用法 / 会动吗**（鼠标移上去都有解释），一步填完
> **属性就定下来了，之后只能删掉重来**；尺寸不用你算，留空就按图片尺寸自动识别。
> 内置素材默认就在列表里（自带 4 张自动连接图 + 1 张道具，水自带 2 帧动画），
> 同样可以删，删错了点「恢复默认素材」一键拿回来 —— 它的属性不允许改。
> 自己的图该怎么排？窗口右上角那颗「**素材说明**」点开是三页图文：普通图块 / 整格自动连接 /
> 拼块自动连接各一页，图上的网格会循环隐藏、显现，几列几行、第几块是哪一种接法一眼就能看出来。
> 想让**自己的普通素材**也动，新增时选「**翻页图**」—— 像手翻书，每一行是一页；
> 拼块自动连接素材不用设，它的变体本来就是帧，列表上直接标出「会动 N 帧」。
> 地图大小、格子大小都能随便填（宽高各填各的）；
> **四周环绕**在数据层：自动连接会把上下、左右两边接起来。画布拖不出地图 —— 拖到边就停，
> 地图左上角对齐后不会再乱动，图外那片空白也画不上；
> 还能一键生成随机地形 / 迷宫 / 大陆。
> **一次模型调用都没有，也就不花钱。**

> 🏷️ **八个模块的新建都先问一个名字**：输入框里已经填好默认名（直接回车就用默认值），点取消则不会创建；
> 地图项目还能随时「重命名」。

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
直接拖圆圈，或点一下「转圈方向」重排。改变候选帧数（8~512）会自动重抽，并把拖过的位置按比例换算。

### 也可以直接用**自己电脑上的视频**（阶段①、②都能）

两处「要生成视频」的地方都不只有「调模型生成」一条路：手上已经有一段合适的视频时，
点**选择本地视频**把它选进来即可，产物和生成出来的完全一样，后面几步照旧走。

- **阶段①·转圈视频**：选进来的是「角色原地匀速转一圈」的绿幕视频，导入后插件会**立刻**
  自动抽候选帧并切出八个方向，接着拖圆圈调位置就行。
- **阶段②·某个方位的行走视频**：每一格都能单独选自己的一段（固定机位、原地走），
  之后照旧在第 3 步「提取全部序列帧」。
- 支持 MP4 / MOV / M4V / WebM / MKV / AVI（按**文件头**认，不看扩展名），单个 ≤100MB；
  这一段只在本机用 ffmpeg 处理，不会上传到任何模型。
- 换掉某一段视频时，它下游已经抽出来的帧与整图会自动作废，避免拿上一段视频的帧去合成。

### 中间图片都能存下来

一路生成下来的**每一张图**都能保存：八方向绿幕图、转圈候选帧与整圈条带、每段视频抽出来的
绿幕帧与手动选帧候选、抠完绿幕的帧、合成整图。界面里看得见的产物每张都有「保存」链接；
候选帧一抽就是 32~64 张，所以底部另有一个 **保存全部图片（zip）**——打成一个包，里面按项目
目录的结构摆好（`images/…`、`turn/…`、`frames/…`、`keyed/…`、`out/sheet.png`）。
生成出来的成片（转圈视频、八段行走视频）同样各自有一个「保存视频」链接。

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

## ⑦ 音乐生成编辑（谱乐 AI）

这一模块不靠「点按钮直接出歌」：输入一段灵感或贴一整首歌词，点「生成并打开对话」后，插件会先建一个
音乐任务，再开一个**不挂靠任何项目**的新对话，把任务 id 与用户原文一起发进去。对话里的 agent 会：

1. 先读内置的**音乐创作指南**（风格提示词结构、歌词 13 点 QC、Suno / Mureka / MiniMax / ACE-Step
   的选择、生成设置经验值、游戏循环 / 短曲 / 响度目标）；
2. 扩写/结构化提示词；用户给了完整歌词时**以歌词为权威文本**，只做断句、结构标签、发音的最小修正；
3. 按用途选引擎与模式（默认 Suno `chirp-v6`；纯音乐 / 固定 BPM 可用 ACE-Step 等），提交生成；
4. 提交后等平台返回，按需要做**本地免费**的后期（裁剪 / 音量 / 淡入淡出 / loudnorm）；
5. 把工具返回的 `openUrl` 贴成 Markdown 链接。

点开链接就回到音乐页：歌曲可试听（路由支持 Range，能拖进度）、看波形、裁剪、调音量、淡入淡出、
标准化到 -14 LUFS / -1 dBTP、保存成新版本、导出 MP3 / WAV / M4A（多产物自动打 zip）。
原曲永远保留，所有编辑结果都是新版本。生成按谱乐 AI 积分计费；插件不代收，也不会为「确认状态」重复提交。

### 谱曲模式（本地 MIDI，谱曲/试听免费）

新建音乐卡顶部可以切到 **「谱曲模式（本地 MIDI）」**。它不直接让 AI 出音频，而是：

1. 对话里的 agent 先分析你的想法：用途、情绪弧、曲风、调性与主音、BPM、拍号、段落表、配器、主题动机；
2. **先用你的语言把方案输出给你看**，再 `saveMusicScorePlan` 落盘（manual 模式会停在这里等确认）；
3. 写一份 `compose.py`（[scoremill](https://github.com/CharlesCNorton/scoremill)，MIT 文本记谱库），
   交给插件在本机执行，产出 `score.mid`；
4. 宿主解析 MIDI，并用 **FluidSynth + SoundFont**（没装就用内置简易合成器）渲染试听；
5. 回界面逐版试听、看波形、下载 MIDI / 试听、打「通过」、导出乐谱包（MIDI + 试听 + `plan.md` + `compose.py`）；
6. 你提「太吵 / 太慢 / 鼓太多 / 第二段太长」时，agent 只改对应段落，**每次修改都是新版本**，旧版保留；
7. 满意后可以点「用这首音频生成 Suno 正式版（计费）」。插件会先把这一版的**试听音频上传**给 Suno
   作为参考（标准上传免费），再走 **cover** 生成 —— Suno 不接受 MIDI 原文件，但接受音频，所以这是
   「MIDI → 渲染音频 → 上传 → cover」的链路，比只发文字标签更贴近你的配器与段落。若 Suno 判定音频有版权，
   会提示你确认后走付费版权通道。结果仍是重新演奏，不会逐音一致。

**依赖**（设置 → 游戏素材大师 → 谱曲模式里有探测与路径输入）：

- `python3 -m pip install scoremill` —— 写 MIDI 必需；
- `fluidsynth` + 一个 `.sf2`（默认找 `~/Library/Audio/SoundFonts/FluidR3_GM.sf2`）—— 更好的试听，可选；
- `ffmpeg` —— 转 MP3 / 导出（已有音乐模块也需要它）。

谱曲、试听、导出全部在本地完成，**不消耗谱乐 AI 积分**；只有最后交给 Suno 才计费。

## ⑧ 音效生成（火山引擎 Seed-Audio）

音效这一模块不派给对话，界面上直接生成：写一句「要什么声音」，选格式与采样率，点「生成（计费）」。

- **提示词当导演脚本写**：声源 + 环境 + 强度/节奏 + 大致时长。例如「暴雨中的金属撞击，短促有力，
  约 1 秒，带一点尾音」。单次输出上限 **120 秒**；接口没有 duration 参数，时长只能写进提示词。
- **参考素材（可选）**：1 张参考图（图生音）或最多 3 条参考音频（每条 ≤30 秒 / ≤10MB），两者不能同时用；
  参考音频在提示词里用 `@音频1…@音频3` 引用。
- **每次生成一条 take**：旧 take 永远保留，可以在界面里逐条试听 / 导出 / 打包；失败不会自动重试。
- **默认模型** `seed-audio-1.0`，默认输出 WAV / 24000Hz（可切 MP3 / Ogg Opus 与
  16k / 24k / 32k / 44.1k / 48k）。
- **Key 是语音控制台的 API Key**（请求头 `X-Api-Key`），**不是**火山方舟的 `ARK_API_KEY`；
  `seed-audio-1.0` 需要先在语音控制台开通。设置页的「测试连接」会真实生成一条极短音效，
  会产生少量费用。
- 计费按返回的 `original_duration`；重试会再计费，失败/重试前请先确认。
- v1 不做本地剪辑（裁剪 / 淡入淡出 / 响度标准化），只做生成、试听、下载与导出。

## 用对话驱动

八个模块（含实验性的骨骼动画与全本地的 45° 地图编辑器）的**全部功能都能通过对话调用**。插件只注册**一个**工具
`game_material`：先按主题读手册，再按手册里的方法名调用。详细的流程、方法表与参数**按需加载**，
不会在无关任务里常驻上下文。

| action | 作用 |
|---|---|
| `guide` | 读手册：`overview` / `workflow` / `config` / `methods` / `ai-asset` / `map-agent` / 八个模块主题 |
| `intake` | **固定流程第 0 步**：先把关键参数与审核模式问清楚，再动手 |
| `call` | 万能通道：插件全部远程方法逐个可调（`{method, payload}`） |
| `upload` | 按本机文件路径上传素材（设定图 / 参考图 / 首尾帧 / 部件…） |
| `reviewMode` | 记下审核模式：`auto` 自动审核 / `manual` 每一步人工审核 |
| `status` | 看一眼当前进度，以及现在该做哪一步 |
| `wait` | 阻塞等到「没有任务在跑」，回来就是可审查状态 |
| `review` | 出**验收包**：每个产物的绝对 URL、状态、通过标记、深链接 |
| `approve` | 打「通过 / 取消通过」 |

例如：

```js
game_material({ action: "guide", topic: "sprite" })        // 先读八方向图手册
game_material({ action: "intake", module: "sprite" })     // 问清参数与审核模式
game_material({ action: "call", method: "runTurnVideo", payload: { projectId } })
game_material({ action: "wait", module: "sprite", id: projectId })
```

地图编辑器还支持 Agent 专用的「读状态 → 画 → 看效果图」闭环：

```js
game_material({ action: "call", method: "mapInspect", payload: { projectId, region: { r0: 0, c0: 0, r1: 16, c1: 16 } } })
game_material({ action: "call", method: "mapRender", payload: { projectId, region: { r0: 0, c0: 0, r1: 16, c1: 16 }, overlay: { markers: true, grid: true } } })
// 把返回的 localPath 交给 read_image；iso 用 isoInspect / isoRender
```

旧版按 `game_material_call` / `game_material_status` / … 逐个注册的工具已经合并到上面这一个工具，
迁移对照见 [docs/ENGINEERING.md](docs/ENGINEERING.md#对话调用agent-也能驱动整条流水线)。

验收链接是**深链接**：agent 在回复里贴出的 `openUrl` 点一下就切到插件对应页面，原地落到
对应模块 / 项目 / 阶段上，不需要你自己翻。

每个模块的项目 / 任务标题旁都有「**复制 ID**」按钮（侧栏项目行里还有 `⧉`），点一下就把
`projectId` / `jobId` 复制到剪贴板，直接粘贴给 agent 即可。

---

## 安装

```bash
# npm 安装
dsh plugin --profile web add dsh-game-material-master

# 本地目录安装（开发时）
dsh plugin --profile web add /path/to/dsh-game-material-master
```

包已发布到 npm：[dsh-game-material-master](https://www.npmjs.com/package/dsh-game-material-master)
（当前 `0.11.2`，`latest`）。本包没有运行时依赖，`dsh plugin add` 拉下来即可用。

**DSH 版本**：`>=0.2.0-rc.2 <0.3.0`（`package.json` 的 `engines.dsh`；DSH 0.2.1 起插件管理器优先按它判断兼容性）。
Web 部署用 `--public-url https://host/prefix/` 时，深链接与产物地址会跟着补路径前缀。

装完**重启 DSH**（宿主半区在启动时装入）。浏览器半区按磁盘上的 `lib/client.js` 现取，
刷新浏览器即可生效。

**依赖**：`ffmpeg` / `ffprobe` 得能找到。查找顺序是 `FFMPEG_PATH` / `FFPROBE_PATH` 环境变量 →
Windows 注册表里的同名变量 → WinGet / Scoop / Chocolatey 与 `C:\ffmpeg\bin` 这类常见安装位置 →
`PATH`（macOS：`brew install ffmpeg`）。于是 Windows 上「装了 ffmpeg 却没加进 `PATH`」也能直接用；
用 `setx` 设过路径仍提示找不到也正常——`setx` 只写注册表，已经在跑的进程继承不到，插件会自己再读一遍。
本包**没有任何运行时 npm 依赖**，`zod`、`cordis` 等全部从 DSH 自身的安装树解析。

> 从旧版 `dsh-8dir-sprites` 升级时，首次启动会自动迁移数据目录，已有项目无缝接上。

## 配置

**设置 → 游戏素材大师**：

![设置](https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-10-settings.png)

| 项 | 说明 |
|---|---|
| 生图后端 | 选**火山方舟 Seedream**（默认）或**自定义生图模型**；换后端只改这一处，所有生图模块都跟着走 |
| 火山方舟 API Key | 「测试连接」会真实生成一张 1K 小图（少量费用），同时验证 Key 与模型 |
| 生图模型 | 默认 `doubao-seedream-5-0-flash-260915`，可切 5.0 Pro / Lite / 4.5 |
| 自定义生图协议 | `OpenAI API` / `ComfyUI API` / `Stable Diffusion WebUI API` 三选一，填主机根地址即可 |
| 自定义生图参数 | 模型名、输出尺寸（宽x高）、负面提示词、采样步数 / CFG / 采样器、图生图重绘强度、种子、超时 |
| ComfyUI 工作流 | 整段粘贴「导出（API）」的 JSON；支持 `{{prompt}}` `{{width}}` `{{seed}}` `{{image}}` 等占位符，不写占位符就原样跑 |
| MiniMax API Key | 「测试连接」免费，能区分 Key 无效与其它错误 |
| 视频模型 | 默认 `MiniMax-H3`（v2 协议）；Hailuo / I2V 走 v1；优云智算版 H3 显式选择 |
| Base URL | 主机根，不含 `/v1` `/v2`。国内 `api.minimax.cn`，国际 `api.minimaxi.com` |
| 输出尺寸 | 所有生图模块的**默认值**；支持 `1K` / `2K` / `4K` 或 `宽x高`。图片任务可单独把「尺寸来源」切成「自定义」，只影响那一个任务；跟随全局的任务会随这里变化 |
| 抠像背景色 | 默认纯绿 `#00FF00`；角色穿绿衣服时改成品红 / 蓝 / 白 / 黑等。生成提示词里的「绿幕 / #00FF00」会跟着替换，所有抠像入口都能单独选 |
| 默认参数 | 单格宽高、抽帧张数、像素块边长、抠像阈值等 |
| 本地 ComfyUI（图生视频） | 勾选后图生视频改走**本机 ComfyUI**，替代 MiniMax；「测试连接」只读状态、免费 |
| 音乐生成（谱乐 AI） | 填谱乐 AI API Key、Base URL、默认音乐模型与超时；「测试连接」读一页历史，不产生生成费用。生成按平台积分计费，插件不代收 |
| 音效生成（火山引擎 Seed-Audio） | 填语音控制台 API Key（不是方舟 Key）、Base URL、默认模型 `seed-audio-1.0`、默认格式/采样率与超时；「测试连接」会真实生成一条极短音效（少量费用） |
| 功能管理 | 逐个开关八个模块：关掉的模块界面上不再出现，**对话里的 AI 也调不到**（见下） |

Key 只写入本机 `<DSH_HOME>/game-material-master/config.json`，界面回显始终脱敏。
**生图后端与模型是插件级设置，所有需要生图的模块共用**，切换后任务自动对齐新档位。
图生视频始终只走 MiniMax，不受生图后端影响。

### 自定义生图后端

除了火山方舟，插件也支持把你的**自己的生图服务**接进来（设置 → 游戏素材大师 → 生图后端）：

| 协议 | 生图 | 带参考图 | 说明 |
|---|---|---|---|
| OpenAI API | `POST {base}/images/generations` | `POST {base}/images/edits`（端点不存在时退回 generations 的 `image` 字段） | 兼容 OpenAI 官方与各家兼容网关；`b64_json` / `url` 两种返回都认 |
| ComfyUI API | `POST {base}/prompt` → 轮询 `/history` → `GET /view` | 先 `POST {base}/upload/image`，把文件名写进工作流 | 需要**API 格式**的工作流 JSON；`{{image}}` 占位符没写时自动改 `LoadImage` 节点 |
| Stable Diffusion WebUI API | `POST {base}/sdapi/v1/txt2img` | `POST {base}/sdapi/v1/img2img`（`init_images` + 重绘强度） | 需要 WebUI 以 `--api` 启动；API Key 填 `user:pass` 走 HTTP Basic |

本地服务通常不需要 API Key；地址填**主机根**（例如 `http://127.0.0.1:8188`），具体端点由插件按协议拼。
配好点「测试连接」即可真跑一张测试图确认链路通。

### 本地 ComfyUI（图生视频）

不想用 MiniMax、或想跑自己的模型时，可以把**图生视频**这一步接到本机的
[ComfyUI](https://github.com/comfyanonymous/ComfyUI)：设置页勾选「本地 ComfyUI（图生视频）」，
填上地址（默认 `http://127.0.0.1:8188`），把工作流 JSON 贴进去即可——API 格式、或编辑器里直接
保存的界面格式都行。
生图、抠像、抽帧、合图完全不受影响，与 MiniMax 走同一套下游流程。

- **两种格式都收**：`Workflow → Export (API)` 导出的 API 格式最直接；编辑器里直接保存的**界面格
  式**（顶层是 `nodes` / `links` 数组）也直接粘——插件会先转成 API 格式，那句「已自动转成 API 格
  式（N 个节点）」会出现在「测试连接」下面。转换会跳过便签与静音 / 旁路节点；若那份 JSON 连控件
  值都没带 `widget` 信息（很老的 ComfyUI 版本），插件会提示你改用 Save (API Format)。
- **注入点自动探测**：提示词写进哪个节点的哪个输入、首帧图从哪进、宽高 / 时长 / 种子覆盖哪几个
  输入，插件会自己认一遍，认到的结果就显示在「测试连接」下面。认错了就手工填 `节点ID.输入名`
  （例如 `1.text`）覆盖。
- **首帧图**：工作流里已经有 `LoadImage` 就直接用它；没有时插件会读 ComfyUI 的节点定义，在
  「声明了 `IMAGE` 输入却没接线」的位置（例如 `FreeVideoGenerate.first`）自动补一个 `LoadImage`
  接过去。
- **内置模板就是 FreeVideo 那条链路**（`FreeVideoGenerate` + `FreeVideoMedia` + 一个空
  `LoadImage`，首帧接在 `FreeVideoGenerate.first`——与官方示例
  [FreeVideo-All-in-One.json](https://github.com/FlashML-org/FreeVideo/blob/main/example_workflows/FreeVideo-All-in-One.json)
  的接法一致）。改坏了点「恢复内置模板」还原；官方那份界面格式的 JSON 也可以直接粘进来用。
- 产物照旧：ComfyUI 只负责吐出那段绿幕视频，**抽帧、抠像、合图仍然是本机 `ffmpeg` 干的**。
- 「测试连接」只读 ComfyUI 的版本、显卡与队列长度，**不排队、不生成、不产生费用**。
- **Cookie（可选）**：ComfyUI 自己不做鉴权；只有当它被挡在需要登录的反向代理后面（Cloudflare
  Access、Basic Auth 之类）时才用得上。从浏览器开发者工具里把 Cookie 整段复制过来即可，插件会
  先归一化成一行，再让**每个请求**都带上它 —— 上传首尾帧图、提交、查询、取回成品视频，一个都不落。
- 本地后端**不支持「多模态参考模式」**（参考图 / 参考视频）——那是 MiniMax v2 的能力，
  走 ComfyUI 请用首尾帧模式。

### 功能管理（隐藏不用的模块）

不用的模块可以在**设置 → 游戏素材大师 → 功能管理**里关掉，随时再打开，已有项目数据不会删：

- **界面**：工作台页签、侧栏快捷菜单里都不再出现它；如果当时正停在这个模块，会自动落到第一个可见模块。
- **对话**：`game_material` 的 `guide` / `call` / `status` / `intake` / `upload` / `wait` / `review` / `approve`
  一律拒绝，报错里说明去哪里打开。只藏界面不拦工具等于没藏——模型看不见页签，
  照样能调生成类方法真实计费，所以宿主半区每次都按最新配置再拦一次。
- 可见性**只能由用户在设置页里改**：工具面拒绝 `saveConfig({hiddenModules})`，
  否则模型能自己把隐藏的功能放出来。
- 全部关掉也是允许的，工作台会提示「所有功能都已被隐藏」。

## 界面语言

**插件界面跟随 DSH 自身的语言设置**（设置 → 通用 → 语言），中文 / 英文都是一等公民，
切换**即时生效**、不用刷新页面：工作台标题、八个模块页签、每一张卡片的按钮、提示条、
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
八个模块页签、每一张卡片的按钮与提示条、弹窗、设置页、验收控件、默认提示词。
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
├── iso-jobs/<id>/      45° 地图编辑器（project.json / map.json / tilesets / preview / export）
├── map-jobs/<id>/      地图编辑器（project.json / map.json / tilesets / ai / preview / export）
├── music-jobs/<id>/    音乐生成编辑（songs / versions / peaks / tools / out）
└── sfx-jobs/<id>/      音效生成（refs / takes / out）
```

> 旧版「45°地图地块生成」的 `tile-jobs/` **不再被读取**，原样留在磁盘上，可手动归档；
> 新模块的数据在 `iso-jobs/`，两者不迁移。

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
- **本地 ComfyUI 的耗时不可预期**：任务在本机队列里可能排很久，也可能中途显存不足失败。
  插件只负责提交与轮询，失败原因（执行到哪个节点、抛了什么异常）会原样带回界面，
  模型 / 显存层面的问题要回到 ComfyUI 自己的控制台看。

## 交流与反馈

- **QQ 群：`1126382236`**（群名「DSH游戏素材大师插件」）——新版本发布、路线图和踩坑经验都在群里同步，
  欢迎进群获取最新动态，也欢迎直接参与开发：提需求、报 bug、认领模块都可以在群里聊。
- 也可以在 [GitHub Issues](https://github.com/universe-st/dsh-game-material-master/issues)
  提 issue 或直接发 PR。

## 致谢

- **模块⑥「俯视地图编辑器」借鉴了 [AsPJT/AsLib](https://github.com/AsPJT/AsLib/tree/master) 的 RPG Map Maker。**
  具体借鉴的是它的**交互与界面**（一屏：左边素材调色板 + 图标工具栏、右边画布；画笔 / 橡皮 / 油漆桶 /
  吸管 / 抓手 + 单层预览 + 图层上下 + 撤销重做这一组工具；点调色板选笔刷、红框标当前笔刷、
  滚轮缩放、拖动平移）和两处**几何约定**：
  1. **地图四周环绕** —— 自动连接的邻域判断取模，上下 / 左右两边接得上（数据层语义）；
     相机被夹在地图内（拖到边就停、地图左上角与画布左上角对齐），图外不落笔；
  2. **A2 拼块自动连接** —— 一张 64×160 的图 = 2 变体 × 5 形状，一格拆成四个 16px 象限，
     每个象限按「左 / 上 / 左上」查同一张 5 状态表；小格的挑选公式，以及
     「1-based 序号 − 1 == AsLib 的 chip 下标」这条对应关系，都出自它的 `AsMap.hpp`。

  它的代码是 **CC0**；本插件是照它的行为用 TypeScript 重写的，**没有拷贝它的源码**。
- **音乐创作方法论提炼自 [bitwize-music-studio/claude-ai-music-skills](https://github.com/bitwize-music-studio/claude-ai-music-skills)**：
  该仓库以 **CC0-1.0**（Public Domain）释出。本插件只吸收了「风格提示词工程 / 歌词写作与评审 /
  Suno 模型选择 / 母带响度目标」等方法论，并结合游戏音乐用法改写为中英双语内置指南
  （`src/musicguide.ts`），没有搬运原仓库的代码或长段原文。原仓库版权归其作者所有，特此致谢。
- **谱曲模式使用 [CharlesCNorton/scoremill](https://github.com/CharlesCNorton/scoremill)**（**MIT**）：
  文本记谱 → MIDI 的库与记谱约定；插件不打包 scoremill，只在内置指南中吸收其用法与避坑清单，
  并由本机 Python 执行用户/agent 写的 `compose.py`。产品思路另参考
  [XIAODUOLU/Midra](https://github.com/XIAODUOLU/Midra) 的「prompt-to-code MIDI、可编辑、再决定是否生成音频」。
  原仓库版权归其作者所有，特此致谢。
- **可选 ToAPIs 异步图片 / 视频后端由 [@ToAPIs-2025](https://github.com/ToAPIs-2025) 通过
  [PR #7](https://github.com/universe-st/dsh-game-material-master/pull/7) 贡献**（`feat(toapis)`）：
  设置页独立配置、异步任务回执防重复提交、凭证只在宿主保存，默认后端仍是火山方舟 / MiniMax。感谢这份实现。
- ⚠️ **AsLib 仓库里的 `Picture/MapChip/*_pipo.png` 素材属于第三方，没有打包进本插件**
  （它的 README 写明 "Third party content is copyrighted by its respective owners"）。
  内置素材由 `scripts/make-map-sample-tileset.mjs` 按同样的 A2 规格在本机程序化生成。

## 许可

[MIT](LICENSE)

> 完整工程文档（算法细节、自检契约、历史踩坑）见 [docs/ENGINEERING.md](docs/ENGINEERING.md)。

## 可选 ToAPIs 图片／视频后端

设置页可独立配置 ToAPIs，再将生图后端切为 ToAPIs，或打开「使用 ToAPIs 生成视频」。默认仍是火山方舟／MiniMax，ComfyUI、自定义协议和本地处理保持可选。国内 `https://toapis.cn/v1`，国际 `https://toapis.com/v1`；异步任务需要专用协议，不是把 OpenAI 的地址换一下即可。

[配置、计费与恢复说明](https://github.com/universe-st/dsh-game-material-master/blob/main/docs/TOAPIS.md)。API Key仅在宿主保存，生成真实计费；先在自己的账号核对报价和参数。

## ToAPIs

ToAPIs 可作为可选图片／视频 Provider，使用用户自己的 Key。官网：[国内站](https://toapis.cn/)／[国际站](https://toapis.com/)；Base URL 分别为 `https://toapis.cn/v1`／`https://toapis.com/v1`。[配置、价格口径与快速复用](https://github.com/universe-st/dsh-game-material-master/blob/main/docs/TOAPIS.md) · [真实 DSH 八方向与精灵导出验收](https://github.com/universe-st/dsh-game-material-master/blob/main/docs/toapis-live-20261024/README.md)。原生透明 GPT Image、方形视频与实测截图见文档；功能可用版本以合并／发布状态为准。
