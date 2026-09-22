# 游戏素材大师 · DSH 插件

从一张角色设定图出发，批量产出游戏要用的素材。**火山方舟 Seedream** 负责生图，
**MiniMax** 负责图生视频，抠像与合成全部在本地用 ffmpeg 完成——不需要任何系统图像库，
素材也不会传到第三方服务。

## 功能

| 模块 | 做什么 | 验收 |
|---|---|---|
| **八方向图生成** | 一张设定图 → 8 方位 × 8 帧行走精灵图 | WASD 操控预览，逐方向重做 |
| **图片生成** | 按提示词出图（可带参考图）→ 一键抠绿幕导出透明 PNG | 逐张通过 / 重做 |
| **序列帧生成** | 首尾帧或参考图 + 参考视频 → 生成视频 → 抽帧 → 抠像 → 横向合成 | 循环预览，按步骤通过 |
| **骨骼动画生成**（实验性） | 角色整图 → 拆件 → 装配 → 骨骼动画（6 种预设）→ 导出 Spine / DragonBones 图集 | 逐阶段可视化验收 |

> ⚠️ **骨骼动画生成仍是实验性功能，尚未完善**：拆件质量取决于生图模型，自动装配与骨骼推导
> 对真实立绘经常需要人工校正（agent 视觉先验或手工拖放），导出的 Spine / DragonBones 产物
> 也还没经过足够的引擎侧验证。界面上该模块带「实验性」角标，并在每次进入时弹窗说明。
> 如果你需要它、或者想一起把它做扎实，欢迎到
> [GitHub 仓库](https://github.com/universe-st/dsh-game-material-master) 参与开发。

每个模块的每个阶段都能单独重跑——哪一步不满意，就只重做那一步。

四个模块的**全部功能都可以通过对话调用**：插件把整条流水线注册成 `game_material_*`
工具，agent 能自己推进、等待、审查，也可以在每一步停下来让你验收。

## 安装

```bash
# npm 安装
dsh plugin --profile web add dsh-game-material-master

# 本地目录安装（开发时）
dsh plugin --profile web add /path/to/dsh-game-material-master
```

包已发布到 npm：[dsh-game-material-master](https://www.npmjs.com/package/dsh-game-material-master)
（当前 `0.1.0`，`latest`）。本包没有运行时依赖，`dsh plugin add` 拉下来即可用。

装完**重启 DSH**（宿主半区在启动时装入）。浏览器半区按磁盘上的 `lib/client.js`
现取，刷新浏览器即可生效。

**依赖**：`ffmpeg` / `ffprobe` 需要在 `PATH` 上（macOS：`brew install ffmpeg`），
也可用 `FFMPEG_PATH` / `FFPROBE_PATH` 指定绝对路径。本包**没有任何运行时 npm 依赖**，
`zod`、`cordis` 等全部从 DSH 自身的安装树解析。

> 从旧版 `dsh-8dir-sprites` 升级时，首次启动会自动迁移数据目录，已有项目无缝接上。

## 配置

**设置 → 游戏素材大师**：

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
└── rig-jobs/<id>/      骨骼动画（sheet / parts / layout / rig / atlas）
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
