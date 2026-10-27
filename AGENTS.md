# AGENTS.md

给在本仓库里干活的编码 agent 的说明。

- 人看的入门文档 → [README.md](README.md)
- 算法细节、自检契约、历史踩坑 → [docs/ENGINEERING.md](docs/ENGINEERING.md)

本文不重复上面两份，只写**干活时必须知道的事**和**发布流程**。

---

## 这是什么

DSH 插件「游戏素材大师」：从一张角色设定图出发批量产出游戏素材。火山方舟 **Seedream** 生图、
**MiniMax**（或本机 **ComfyUI**）图生视频，抠像 / 抽帧 / 像素量化 / 合图全部在本机用 `ffmpeg` + 内置 JS 完成。

| 模块 | key | 状态 |
|---|---|---|
| 八方向图生成 | `sprite` | 正式 |
| 图片生成 | `image` | 正式 |
| 序列帧生成 | `sequence` | 正式 |
| 骨骼动画生成 | `rig` | **实验性**（页签带角标、进入弹窗、模块内常驻提示条） |
| 45°地图编辑器 | `iso` | 正式（**全本地零计费**：2:1 等距菱形地块、4×4 自动连接、多格/高处物件、动画地块、标记层、环绕、一键生成；导入自己的 45° 素材 + 程序化内置素材；素材卡支持 **AI 生成地面 / 物件**（新对话 → `composeIsoAsset` → 回链确认；首版不做 AI 自动连接）；导出 PNG / JSON / zip。**全本地**） |
| 俯视地图编辑器 | `map` | 正式（参照 AsLib 的 RPG Map Maker：一屏、纯图标、零术语；素材列表 + 新增（属性一次定死）、内置素材默认在列表且可删可恢复、地图环绕、自动连接、动画地块（翻页图）、一键生成；默认三层「地理层 / 装饰层 / 建筑层」且图层可改名换序；**标记层**（每格一个标记、可命名、地图上画成圆圈里的数字、编号连续删了重排）；导出是「内容多选 → 一个「导出」按钮 → 一个 zip 下载 / 另存为」；**全本地零计费**） |
| 音乐生成编辑 | `music` | 正式（谱乐 AI：灵感/歌词 → 不挂靠项目的新对话 → agent 读内置指南、选引擎/模式生成 → 回界面裁剪/音量/淡入淡出/标准化/导出；**生成按平台积分计费**。另有**谱曲模式**：对话里先给方案 → scoremill 本地写 MIDI → 宿主渲染试听 → 逐版修改 → 可选交 Suno；**谱曲/试听/导出本地免费**） |
| 音效生成 | `sfx` | 正式（火山引擎豆包语音 **Seed-Audio**：一句话描述 → 音效 / 环境音 / UI 声 / 生物吼叫 / 角色配音；可带 1 张参考图或最多 3 条参考音频（互斥）；每次生成一条 take、永不覆盖；单次 ≤120 秒；**每次生成真实计费**。界面上直接生成，不派给对话；工具面同样可调） |

生图后端是可切换的：默认火山方舟 Seedream，也可以换成用户自己的服务
（OpenAI 兼容 / ComfyUI / Stable Diffusion WebUI 三种协议；
`src/imageprovider.ts` 分发、`src/customimage.ts` 实现三种协议）。
所有生图调用点都必须走 `imageprovider.generateImageWithProvider`，**不要在模块里自己判 `imageProvider`**。

图生视频默认走 MiniMax，也可以改走本机 / 远端 ComfyUI（`src/videogen.ts` 按**节点上记的** `backend`
分派，`src/comfy.ts` 是 ComfyUI 客户端）。

---

## 硬约束（改错了不报错，只是静默坏掉）

| 约束 | 原因 |
|---|---|
| `src/client.ts` **必须是经典脚本**：不能有 `import` / `export`，React 元素一律 `React.createElement` | 它由宿主以 `/plugins/dsh-game-material-master/client.js` 直接发给浏览器，浏览器半区不参与打包。构建脚本 `scripts/strip-client-export.mjs` 会剥掉结尾的 `export`，但别指望它兜住真正的模块化写法 |
| 改完 `lib/` 里的**宿主半区**必须重启 DSH | 宿主半区是进程启动时冻结的模块图。开发时可另起测试宿主 + `scripts/dev-overlay.yml` 拿 `patchReload` 热重载，见 ENGINEERING.md「开发时的宿主半区热重载」 |
| 改完 `lib/client.js` 只需刷新浏览器 | 客户端束由宿主按请求从磁盘读，带 `rev` 指纹 |
| **没有任何运行时依赖** | `zod` / `cordis` / dsh-typert-protocol 等一律从 DSH 自身安装树解析；`node_modules` 与 lock 文件不入库 |
| `lib/` **入库**（不是构建产物目录） | 包直接以 `main: lib/index.js` 发布，`npm publish` 不触发构建 |
| **对话工具面常驻只有一个 `game_material`**；详细流程 / 方法表放 `src/toolguides.ts`，由 `action:"guide"` 按需读取 | 工具定义与系统提示词每次请求都进上下文；旧版 8 个工具 + 49,393 B 描述在无关任务里白烧 token。新增方法必须进对应模块主题与自动生成的 `methods` 目录，**不许**把方法表塞回工具描述 / 系统提示词；`verify-tools.mjs` 有 ≤6,000 B 预算断言 |
| 生成类调用必须带 loading 反馈，批量任务要按 `job.targets` 盖住**还没轮到**的方向 | 不盖遮罩时界面看着完全正常，只是「点了没反应」，用户会反复点——每次点击都真实计费。`verify-client.mjs` / `verify-feedback.mjs` 会拦 |
| **后台轮询刷新项目 / 任务时，不许用宿主的值整份覆盖编辑草稿** | 有任务在跑时每 2.5~5 秒拉一次 `getProject` / `getImageJob` / `getSequenceJob` / `getRigJob`；无条件覆盖草稿会让用户正在长文本框里替换的提示词一两秒后被打回原形（真机：「我替换的时候它一秒钟又换回来」）。所有 load 走 `mergeDrafts()`：只有「草稿 === 上一次宿主值」的字段才跟着宿主更新；换项目 / 换任务 / 点「重置为默认」才 `force`。`verify-feedback.mjs` 有合并用例，`verify-client.mjs` 逐模块钉住调用点 |
| 本地自选视频必须与远端生成的产物**同形**，且导入时作废该槽位已有的下游产物 | 两条路只差 `origin` / `originalName` 两个字段，阶段③④才不用改。不作废（尤其是 `frames/<方向>/raw.bin`）就会拿上一段视频的帧去合成——界面看着完全正常，只是动作 / 朝向对不上；同理，导入时要摘掉在跑的远端 `taskId`，否则它稍后会把本地视频覆盖掉。`verify-host.mjs` 的 9d 段逐条钉住这几条 |
| 生图一律走 `imageprovider.generateImageWithProvider`，模块里不许自己判 `imageProvider` | 分发只在一个地方，漏掉的那一处**不报错**，只是偷偷继续用另一家模型（用户以为换成了自己的服务，其实还在扣火山方舟的钱）。`verify-custom-image.mjs` 会打一台本地假服务端核对端点真的换了 |
| 音乐模块：**Key 是凭据**，不进 `saveConfig` 的 `directKeys` | `musicApiKey` 与 `arkApiKey` / `minimaxApiKey` 同一档：`saveConfig` 函数体里 trim 后写入、`maskConfig` 只回 `musicApiKeySet` / hint。加进白名单会原样透传、绕过归一化，而且看起来「保存成功」 |
| 音乐模块：**新增 payload 字段必须写进 `src/wire.ts`** | typert 会把 schema 外的键静默丢掉。`renderMusicEdit.ops.*` / `runMusicGeneration.params.*` / `saveMusicJob.source.adapted*` / `getMusicJob.lang` 都踩得到；`verify-music-gateway.mjs` 逐键比对 schema 解析结果 |
| 音乐模块：**下载音频必须按文件头校验，不能只信 `Content-Type`** | Suno 的音频 URL 偶尔会先返回未完成 / 加密的临时对象，`Content-Type` 仍可能是 `audio/mpeg`；只信它会把随机字节落成 `.mp3`，表现是「有歌名但第一首放不了」。`downloadToFile({requireAudio:true})` 用 `sniffBinary` 校验；`ensureLocalSong` 对坏本地文件删除重下（一次重试）；`musicSnapshot` 对坏文件回退远端 URL 并提示刷新。`verify-music` 有「伪音频 + 坏文件修复」两条回归 |
| 音乐模块：**静态资源 scope 四处 + MIME** | `AssetScope` 加 `music-assets`、`resolveAssetTarget` 分支、`SCOPES` 数组、`SERVABLE_MUSIC_DIRS`（唯一真源在 `musicgen.ts`）四处同步；音频 MIME（mp3/wav/m4a/aac/flac/ogg/mid）、pdf/xml/lrc 也要加，否则 `<audio>` 与下载会异常 |
| 音乐模块：**编辑/导出必须走 `media.runFfmpeg`**（内部用 `ffmpegPath()`），参数数组、绝不拼 shell | 绕过 `ffmpegPath()` 就是「自检全绿、真机找不到 ffmpeg」；拼 shell 会被文件名 / 数值注入。滤镜链只接受数字与枚举，`musicaudio.ts` 负责夹范围 |
| 音乐模块：**生成会真实计费**，`runMusicGeneration` 必须做并发与 `regenerate` 闸门 | 同任务已有任务在跑时拒绝；已有歌曲后再提交必须显式 `regenerate:true`。取消只停本地轮询，已提交的远端任务仍会完成并计费——报错文案要写清 |
| 音乐模块：后台任务表 **`activateMusic()` 每次 apply 都要复位**，并 `resumeMusicJobs()` 接上未完成任务 | 与 `pipeline` / `seqgen` / `riggen` 同一个坑：重载后 `disposed` 残留会让所有提交静默变成「任务已在进行中」。`resumeGeneration` 只查询/下载，**不重新提交** |
| 音乐模块：界面文案全走 `T()`，模块级 `MUSIC_ENGINES` / `MUSIC_PHASES` 进 `staticTextRebuilders` | 否则切英文后引擎名 / 阶段名停在中文；`verify-i18n.mjs` 会拦词条，`verify-music-client.mjs` 拦模块表 |
| 音乐模块：**界面里的产物地址一律从 `job.assetBase` 拼相对 URL**，不要直接用 snapshot 里的绝对 `url` | 宿主拼绝对地址依赖浏览器上报的 `location.origin`；插件刚重载 / 新宿主刚起来时上报可能还没到，宿主会退化成 `http://localhost`，表现就是**封面全裂、播放键点了没反应、下载链打不开**（真机踩过）。`musicAssetUrl` / `musicDownloadUrl` 优先用 `file` / `coverFile` 拼相对路径；`reportClientOrigin` 失败要退避重试。`verify-music-client` 钉住封面、版本下载与 origin 重试 |
| 音乐模块：**新对话不挂靠项目**（`sessions.create({})`），jobId 由界面先建好 | 与「AI 生成素材」同一条桥；首条消息必须带 jobId、用户原文、指南、生成/回链/审核模式要求。`verify-music-client.mjs` 用假 sessions 断言 |
| 音乐谱曲模式：**scoremill 由本机 Python 执行，插件不打包 Python** | `runMusicScore` 用参数数组、无 shell 的 `spawn` 跑 agent 写的 `compose.py`；cwd 是该版 `scores/<c…>/`；环境变量白名单、**不传任何 API Key**；180 秒超时杀进程组；必须产出 `score.mid`。缺 Python/scoremill 时 `detectScoreDeps` 给安装命令，界面禁用谱曲 |
| 音乐谱曲模式：**试听优先 FluidSynth + SoundFont，缺了必须退回内置合成器** | 不能因为用户没装 SoundFont 就让「试听」不可用；`midipreview.ts` 是兜底。`GMM_SCORE_RENDERER=builtin` 强制内置音源（自检 / 排障）。`scores` 必须进 `SERVABLE_MUSIC_DIRS` |
| 音乐谱曲模式：**每版都是新 `MusicComposition`，永不覆盖** | 修改意见 → 新目录 `scores/<c…>/`；旧 MIDI/试听/脚本保留。失败只把 `stages.compose` 标 error，不新增版本 |
| 音乐谱曲模式：**Suno 不接受 MIDI 原文件，但接受音频** | `submitMusicScoreToSuno` 先把这一版试听音频 `POST /v1/suno/audio/upload`（multipart，标准上传免费）拿参考 song id，再走 `POST /v1/suno/generate/cover`；判定版权时返回 `needsCopyrightConsent`，用户确认后传 `copyrightAudio:true` 走付费通道。强制 `confirm:true`；已有歌曲必须 `regenerate:true`；结果不会逐音一致。**绝不自动提交**（真实计费） |
| 音乐谱曲模式：**方案先落盘再谱曲** | `runMusicScore` 要求 `scorePlan`（或内联 `plan`）；manual 模式在方案后停下等确认。方案字段（含 `structure` / `instrumentation` 嵌套）必须逐个写进 `wire.ts`，否则 typert 静默丢键 |
| 音乐模块：创作指南来源要保留 **CC0-1.0** 致谢 | `src/musicguide.ts` 头部、README 中英文、设置页文案三处都写；原仓库 `bitwize-music-studio/claude-ai-music-skills`，只吸收方法论、不搬运原文 |
| 音效模块：**Key 是语音控制台的凭据**，不进 `directKeys` | `sfxApiKey` 与 `arkApiKey` / `musicApiKey` 同一档：`saveConfig` 函数体里 trim 后写入、`maskConfig` 只回 `sfxApiKeySet` / hint。它**不是** `ARK_API_KEY`；填错时 401 提示必须点明这一点 |
| 音效模块：**模型短名与端点别写错** | `POST {sfxBaseUrl}/api/v3/tts/create`，Header 只有 `Content-Type` / `X-Api-Key` / `X-Api-Request-Id`；`model` 是 `seed-audio-1.0`（不是方舟的 `doubao-seed-audio-1-0`），**不发** `X-Api-Resource-Id`。`verify-sfx.mjs` 逐条断言 |
| 音效模块：**响应必须按文件头校验音频** | `audio` base64 与 2 小时临时 `url` 两种返回都要认；`Content-Type` 不可信，用 `musicapi.sniffBinary` 校验后才落盘，否则会把错误页 / 未完成对象写成 `.mp3` |
| 音效模块：**每次生成真实计费**，一次请求 = 一条 take | `runSfxGeneration` 做并发闸门；失败**不自动重试**；取消只停本地请求，远端可能仍会完成并计费。`testSfx` 也会真实生成一条极短音效，设置页按钮必须写明 |
| 音效模块：**参考图与参考音频互斥** | 参考图最多 1 张；参考音频最多 3 条、每条 ≤30 秒 / ≤10MB；`uploadSfxRef` 与 `buildSfxBody` 两处都要校验。音频参考在提示词里按 `@音频1…@音频3` 引用 |
| 音效模块：后台任务表 **`activateSfx()` 每次 apply 都要复位**，`resumeSfxJobs()` 把残留 running 标失败 | 与 `pipeline` / `seqgen` / `riggen` / `musicgen` 同一个坑。同步接口没有远端 taskId 可续查，重启后只能标失败并提示「可能已计费」 |
| 音效模块：**静态资源 scope 四处 + MIME** | `AssetScope` 加 `sfx-assets`、`resolveAssetTarget` 分支、`SCOPES` 数组、`SERVABLE_SFX_DIRS`（唯一真源在 `sfxgen.ts`）四处同步；子目录 `refs` / `takes` / `out` 少一个就是 403 |
| 音效模块：**界面轮询不许覆盖草稿** | 生成中每 2.5 秒拉一次 `getSfxJob`；提示词与参数走 `mergeDrafts()`，只有「草稿 === 上次宿主值」才跟随更新，切任务才 `force`。`verify-sfx-client.mjs` 有静态契约 |
| 新增产物子目录时，`SERVABLE_DIRS`（`src/index.ts`）必须同步加一条 | 静态资源路由按**第一段路径**比对白名单，漏掉就 403。界面只表现为「图裂了」、不报错——转圈截帧的 `turn/` 就踩过。模块六的子目录白名单**唯一真源是 `mapgen.SERVABLE_MAP_DIRS`**（`index.ts` 的资源路由直接引用它，别再各写一份）；scope 级那三处（`AssetScope` 类型 / `resolveAssetTarget` 分支 / `SCOPES` 数组）改 scope 时要同步。`verify-map-gateway.mjs` 会真调一遍路由（含 `ai/` 的 200 与未列入目录的 403） |
| 模块五：**AI 生成素材首版只做 ground / object**，`autotile` 4×4 仍手工导入；`composeIsoAsset` 只整理到 `ai/`、不自动进素材列表，`ai/` 必须留在 `SERVABLE_ISO_DIRS` | 单张 AI 图无法可靠推导 16 种接法；`ai/` 漏白名单就是回链图片 403；自动导入会替用户拍板「属性一次定死」的素材 |
| 模块五：**物件大小 `objectScale` 在导入时烘进存图**（`footprint.cols × cell.width × objectScale`），渲染 / 导出都不读它；`importIsoTileset` 的 `objectScale` 必须留在 wire schema 里，越界要报错、不静默夹 | 少一行 schema 就是「滑杆调了、点确定还是原大小」；改成运行期缩放则地图与导出会各算一套 |
| 模块六：**客户端只能执行宿主下发的绘制计划**，不许自己算变体 / 形状 / chunk / 坐标变换 | 界面里唯一允许复刻的是 `MAP_pointToCell` / `MAP_cellAnchor` / `MAP_cellTopLeft` / `MAP_lineCells` 四个坐标函数（命中测试必需），且有黄金对照盯着；**连「哪些 chunk 可见」都由宿主算**（`mapPlan({view})` 回 `visibleKeys`）。多写一套口径就是旧模块「预览好看、导出位移」的老路，`verify-map-client.mjs` 会扫源码拦 |
| 模块六：**环绕（wrap）是默认行为**，凡涉及「邻居」的地方都必须先取模 | 网格、命中测试、绘制范围、脏块、自动连接的邻域判断都要 wrap。漏掉一处的表现是「接缝处形状不对 / 撤销后画面花掉」，只在贴边时看得出来 —— `verify-map.mjs` 里有「画第 0 行必须连带弄脏最后一行」这条断言，且配了非环绕的反向验证 |
| 模块六：**界面文案不许出现旧术语** | 用户对第一版的反馈就是「门槛太高、专业名词太多」。`verify-map.mjs` 与 `verify-map-client.mjs` 各扫一遍**模块六那一段**（`模块六 · 地图编辑器` 到下一个分节注释），`地形族 / 掩码 / 优先级 / 切分 / 图集 / 变体种子 / 高度偏移 / Tiled / 等距` 0 命中，`chunk` 按**词边界**判（所以协议字段 `"chunks"` 可以照实写 —— 曾经为了骗过这条自检写出过 `"chu" + "nks"`，那种写法比术语本身更坏）。⚠️ **只有模块六这一段**：`图集`（模块④ Spine 图集）与 `等距`（模块⑤ 45° 地块）在别处是正确的词，全文件扫会误伤 |
| 模块六：**派生数据不落盘**（形状判定 / 动画帧 / 视口范围 / chunk 一律现算） | 落盘的只有素材原图、`project.json`、`map.json`（每层每格的语义序号）。旧模块存了 `buildings` / `buildingGround` / `map.pixel` 三份缓存，各自都出过「过期后凭空多出一栋楼」这类 bug |
| 模块六：A2 素材在**图层数据里存的是「代表序号」**，一小格不是一笔 | 调色板对 A2 素材只出一个笔刷（`MapViewTileset.palette`），`maprender` 见到所属素材 `shape === "a2quad"` 就展开成 4 条象限 op。少了这条分支，用户拿自动连接笔刷刷下去只会画出一个 16px 小格 —— 不报错 |
| 界面文案一律写 `T("中文原文")`，并往 `src/client.ts` 的词条表补英文 | 中文原文就是 key；漏翻不会报错，只是那一条一直是中文。`verify-i18n.mjs` 会拦 |
| **模块级**（工厂顶层）出现 `T()` 的文案表要同步加进 `staticTextRebuilders` | 模块顶层的 `T()` 在插件 load 时就求值了，那时 locale 服务还没挂上，此后永远停在中文。实测表现：切英文后方向名 / 模块页签不动。函数体内的 `T()` 不受影响 |
| 浏览器半区往宿主加字段时，`src/wire.ts` 里那条方法的 `payload:` schema 必须同步加 | typert 按声明的 schema 校验 payload，**schema 里没有的键会被静默丢掉**。实测：给 `getProject` 带上 `lang` 却没进 schema，宿主永远读到 `undefined`，表现是「切了英文提示词还是中文」且不报任何错 |
| 新增配置字段必须同时在 `src/index.ts` 的 `saveConfig` `directKeys` 白名单里加一条 | 白名单外的键会被**静默丢掉**：界面显示已保存、`config.json` 没变、不报任何错。`comfy*` 那十个键是这么加的。⚠️ 唯一例外是**凭据类**字段（`arkApiKey` / `minimaxApiKey` / `comfyCookies`）：它们**不进**白名单——白名单是原样透传，凭据要先归一化 / trim，所以在 `saveConfig` 函数体里单独处理 |
| 视频**按节点上记的 `backend` 分派**（`src/videogen.ts`），两个后端的 taskId 都是字符串 | `comfyVideo` 是全局开关，用户可能中途改设置；按当前配置去查就会拿 MiniMax 的接口查 ComfyUI 的 `prompt_id`（表现：一边报「任务不存在」、另一边永远 pending）。新增视频字段时 `VideoNode` / `TurnVideoNode` 的 `backend?` 要一起写 |
| ComfyUI 工作流是**用户自己的 JSON**，注入前必须过 `parseComfyWorkflow` + `detectComfyBindings`，不许写死节点 id | 节点 id 与输入名由用户装的自定义节点决定。界面格式（顶层 `nodes` / `links` 数组）也收，由 `parseComfyWorkflow` 先转成 API 格式——但**没连线的 IMAGE 槽不会进转换结果**，首帧注入仍靠探测的第 4 级（`object_info` 声明的 optional IMAGE）。「首帧图」尤其危险：`LoadImage` 只代表一张图，首尾帧各用其一，搞错会**静默**把首帧顶掉（`verify-comfy.mjs` 盯这两条） |
| 后台任务表（`pipeline` / `seqgen` / `riggen`）**每次 `apply` 都要复位**（`activatePipeline()` / `activateSequence()` / `activateRig()`） | DSH 重载插件时 `ctx.effect` 的清理会把模块级的 `disposed` 置为 true，而 Node 模块缓存留着**同一个模块对象**——不可逆。症状：**所有生成类调用**都只回一句「任务已在进行中」，按钮点了没反应、项目日志一条不加，而上传源图 / 查状态 / 测试连接全正常。`activate*()` 就是给重载留的复位入口；`kick()` 失败时用 `kickFailure()` 区分「真在跑」与「实例已废」 |
| 内置默认提示词（`src/directions.ts`）中英各一份，改一份必须改另一份 | 它会真的发给生图 / 视频模型，不是界面装饰。`verify-host.mjs` 的 5b 段按语言逐条比对两侧 |
| 转圈截帧的首帧一律走 `src/pipeline.ts` 的 `turnFirstFrame()`：它除了「正面绿幕图优先」，还会拿文件时间兜一道（正面图比源图旧 → 退回源图） | 换源图会作废派生产物，但历史项目 / 手工替换的文件仍可能带着旧角色的 `images/front.png`。那一张就是交给视频模型的首帧，「新角色配旧脸」既不报错也不缺图，只能肉眼看出来 |
| 起 ffmpeg / ffprobe 一律走 `src/media.ts` 的 `ffmpegPath()` / `ffprobePath()`，别写死 `"ffmpeg"`、也别只读 `process.env` | Windows 上 ffmpeg 常常「装了但不在 `PATH` 里」，而 `setx` 设的环境变量又继承不到已经在跑的进程。这两个函数会继续查注册表与 WinGet / Scoop / Chocolatey 的常见位置——绕过它们就是「自检全绿、真机报找不到 ffmpeg」 |
| `engines.dsh` 与 devDependencies 里的 `cordis` / `typert-protocol` **必须一起跟 DSH 版本走** | DSH 0.2.1 起插件兼容性**优先看 `engines.dsh`**（声明了就不再回退 peerDependencies），本插件声明 `>=0.2.0-rc.2 <0.3.0-0`；`<0.3.0-0` 是必需的，因为 DSH 用 `includePrerelease` 判范围，写 `<0.3.0` 会放行 0.3.0 的 rc。开发依赖是**开发期契约**：0.2.1 对应 `cordis ~4.0.5` / `dsh-typert-protocol 0.2.1-rc.2`，版本太旧时自检会对着旧契约全绿、真机却挂 |
| 回给浏览器的 `assetBase` 一律走 `src/links.ts` 的 `assetBasePath()`，深链接一律走 `buildOpenLink()` 的默认 origin | DSH 0.2.1 的 `--public-url https://host/prefix/` 会由反代**剥掉路径前缀**再转给 DSH；宿主只拼 `origin + /dsh-game-material-master/...` 时，浏览器会请求反代根路径 → 图片全裂、回链落到根页。浏览器半区把 `location.pathname` 一起报上来（`reportClientOrigin({origin,path})`），宿主拼 URL 时补回去。绕过 `assetBasePath` 的字符串拼接就是「本地全对、反代后面图裂」 |

---

## 构建与自检

```bash
npm run build        # tsc → lib/，并剥掉浏览器束结尾的 export
npm run typecheck    # 只做类型检查
```

纯本地自检（不联网、不花钱），改完代码**至少跑这几个**：

```bash
node scripts/verify-host.mjs       # 宿主全链路（387 项）
node scripts/verify-client.mjs     # 浏览器半区契约（362 项）
node scripts/verify-tools.mjs      # 对话调用面（196 项，含常驻工具面 ≤6,000 B 预算）
node scripts/verify-pipeline.mjs   # 抽帧 / 抠像 / 合成（40 项）
node scripts/verify-feedback.mjs   # 浏览器半区真渲染（217 项，含功能管理、侧栏菜单、生图后端设置页、语义保存错误与草稿合并）
node scripts/verify-i18n.mjs       # 中英词条表契约（9 项）
node scripts/verify-comfy.mjs      # 本地 ComfyUI 后端（124 项，自起 mock ComfyUI，纯本地、不用装 ComfyUI）
node scripts/verify-custom-image.mjs  # 自定义生图后端三协议（68 项：起本地假服务端，离线、零计费）
node scripts/verify-toapis.mjs       # ToAPIs 可选异步图片 / 视频后端（43 项，mock HTTP、零付费调用）
node scripts/verify-music.mjs      # 音乐生成编辑：mock 谱乐 AI 的生成/轮询/下载/编辑/导出/工具/路由（86 项）
node scripts/verify-music-score.mjs   # 谱曲模式：方案 / 假 Python / 内置试听 / 乐谱包 / Suno 上传+cover mock（46 项，纯本地）
node scripts/verify-music-gateway.mjs  # 音乐走真实网关：wire schema 不丢键、工具面、深链接、隐藏模块、谱曲字段（52 项）
node scripts/verify-music-client.mjs   # 音乐界面真渲染 + 新对话桥 + 谱曲卡 + 静态契约（67 项）
node scripts/verify-sfx.mjs         # 音效生成：mock 火山引擎语音的请求/返回/错误/参考/导出/路由（55 项，纯本地）
node scripts/verify-sfx-gateway.mjs # 音效走真实网关：wire schema 不丢键、工具面、深链接、隐藏模块、配置字段（39 项）
node scripts/verify-sfx-client.mjs  # 音效界面真渲染：新建卡 / 任务卡 / 参考 / takes / 生成 / 遮罩 / 静态契约（29 项）
node scripts/verify-rig-runtime.mjs  # 骨骼改动：官方 Spine 4.2 实际加载/IK/Path/FFD/顶点求值（开发依赖）
node scripts/verify-iso.mjs        # 45° 地图编辑器几何内核（42 项：2:1 步进 / 命中反解 / 物件锚点 / 环绕脏块 / 内置素材确定性 / 自动连接 mask / 水面无接缝 / 物件大小边界）
node scripts/verify-iso-pipeline.mjs  # 45° 地图编辑器数据层与导出（54 项：导入 / 编辑 / 撤销 / 计划 / 动画 / 一键生成 / 导出可复现 / 删除素材重映射 / AI 整理 / 物件大小落盘）
node scripts/verify-iso-gateway.mjs   # 45° 地图编辑器网关契约（64 项：23 个方法 / schema 逐键不丢 / 模块枚举 / 路由白名单 / AI 回链参数 / objectScale 透传 / isoInspect·isoRender）
node scripts/verify-iso-client.mjs    # 45° 地图编辑器界面契约（83 项：客户端坐标函数与宿主逐点黄金对照 / 新增素材预览的菱形地格与「滑杆在图片下方」/ 按 z 绘制 / pending·have / 方法表 / AI 对话框与回链）

node scripts/verify-map.mjs            # 地图编辑器几何 / 环绕 / 自动连接 / 标记点 / AI 素材按形态规整与「收口 + 无缝」/ 播放速度 / 清晰度重采样 / 循环方式 / 自动裁边 / 换向与斜接 / 整图（多格印花）的内核（239 项，含反向验证与术语黑名单）
node scripts/verify-map-agent.mjs      # 地图编辑器 Agent 读模型 / 检查图（35 项：inspect 逐格与预算 / dryRun+ifRevision / render 区域裁切与标记叠加 / 标记语义与 @5 导出 / iso 同链路）
node scripts/verify-map-pipeline.mjs   # 地图编辑器数据层与流水线（429 项，含 A2 每格 4 条 op、动画循环、翻页图调色板每列一条、dropKeys、标记点 op 与撤销、老文档升级、导出逐字段与真解包的 ZIP）
node scripts/verify-map-gateway.mjs    # 地图编辑器走真实网关（228 项，含资源路由 403 / 目录穿越 / zip 的 MIME / 并发提交 / 标记 op 的 schema 穿透 / `ai/` 白名单 / AI 素材的形态透传与 openUrl / mapInspect·mapRender·dryRun·标记语义）
node scripts/verify-map-client.mjs     # 地图编辑器界面真渲染 + 黄金对照（474 项：坐标函数逐点一致、drawImage 序列 == 宿主计划、挂载首帧 == 同视口的计划、导出卡片的选择/执行/下载三段、图层改名与标记层圆圈数字、工具小标签的 z-index 层级、「素材说明」三页的示例图逐字节 == 生成器产出且网格百分比按真实列数现算、网格循环动画的数值，「模块⑥已转正」的角标 / 弹窗 / 常驻提示条三处反向验证，以及「AI 生成素材」（提示词的形态判据与「一块无缝砖」约定 / 用法控件 / 帧数为 1 时视频模型点不动 / 点生成时用假 sessions 断言建的会话与发出去的正文 / 回链按 shape 预填「新增素材」））
```

`scripts/find-missing-i18n.mjs` 不是断言脚本，是**工具**：列出所有还没进词条表的
`T("…")` 原文，直接输出可粘贴的条目。加了新界面文案时先跑它。

`scripts/make-map-sample-tileset.mjs` 是模块六**内置素材**的生成器：默认纯程序化、确定性
（同一输入两次生成逐字节一致，`--check` 会断言形状/变体真的互不相同）；`--ark --yes` 会改用
火山引擎生成纹理再本地合成，**这一步真实计费**，别顺手跑。

`scripts/make-map-guide-art.mjs` 是模块六**「素材说明」窗口那三张示例图**的生成器：
它把图写进 `src/client.ts` 的标记块 `MAP_GUIDE_ART`（base64 内联 —— 浏览器半区不能 import，
宿主也没有「随便给个静态文件」的路由）。`--check` 断言确定性、`src/client.ts` 里那一份是最新的、
已构建进 `lib/client.js`，并**把整格那张图解回来量一遍方向位序**（行优先第 i 块必须是
「上=1 / 右=2 / 下=4 / 左=8 加起来等于 i」的那种接法 —— 说明窗口就照它教用户排图，画错了
只会让照做的人排出一张连不上的图，不报任何错）。改了 `src/mapsamplegen.ts` 里的说明图就把
它重跑一次、再 `npm run build`。

其余脚本（`verify-rig*.mjs`、`e2e-*.mjs` 等）的覆盖范围见 ENGINEERING.md 的「自检脚本」表。
`e2e-map.mjs` 是模块六的**真实链路端到端**（不联网、不花钱）：它会**故意把产物留在**
`<DSH_HOME>/game-material-master/map-jobs/` 下并打印绝对路径，方便人眼验收。
`e2e-*.mjs` / `probe-redraw.mjs` 会**真实调 API 花钱**，不要顺手跑。

### ⚠️ 自检全绿 ≠ 界面对

界面 / 摆放口径的 bug **反复**出现「自检全绿、真机坏」。改界面或几何之后，
除了跑自检，必须照 ENGINEERING.md「真机视觉验证的四类盲区」逐条自查。
四个名字本身就够当清单：

1. **拿自己的公式验自己** —— 契约要和**宿主的真实产出**比，不是和我的推导比。
2. **只测了一个方向** —— 摆放是二维的，垂直对了不代表水平对。
3. **夹具选了不暴露问题的样本** —— 用**贴边**的格子，别总用正中。
4. **只在「已经存过」的状态试** —— 新建 / 已存 / 刚改未存 / 老数据缺字段，四个入口都要试。

另外：判断「有没有位移」要量 `getBoundingClientRect()` 或截图逐像素比，
别只读 `style.top` 这类字符串 —— `transform` 与贴图自然尺寸也参与定位，
数值一样、位置照样不同。

---

## 提交约定

Conventional Commits，中文描述：`feat(rig): …` / `docs: …` / `fix(sprite): …`。
仓库历史里能直接找到例子。改动要与代码同批提交，不要留「代码已改、文档待补」的半成品。

---

## 发布到 npm

包名 [`dsh-game-material-master`](https://www.npmjs.com/package/dsh-game-material-master)，
发布账号 **kuangthree**，`license: MIT`，`access: public`（默认）。

### 已发布版本

| 版本 | 发布时间（UTC） | 内容 |
|---|---|---|
| `0.1.0` | 2026-09-21 23:22 | 首个公开发布 |
| `0.1.1` | 2026-09-22 15:20 | README 重写为展示版（11 张 Playwright 实拍截图 + mermaid 流程图 + 「用对话驱动」章节）；`package.json` 补 `repository` / `homepage` / `bugs`。**无源码改动** |
| `0.2.0` | 2026-09-24 14:19 | 阶段①新增「**转圈截帧**」并设为默认（一段原地匀速转一整圈的绿幕视频 → 本机抽候选帧 → 时间轴八圆圈截出八个方向；逐方向生图保留为备选）；`fix(chroma)` 角色贴边时不再把自己的颜色当背景（实测 160/160 帧被吃掉最多 1.8 万像素角色）；数字输入框改为失焦/回车提交；序列帧缩略图双击看大图；`turn/` 进资源路由白名单 |
| `0.2.1` | 2026-09-30 14:18 | 合并 PR #2（来自 qiufl）：适配新版 DSH 的 strict codec `create()` 契约（`fix(typert)`，含 revert 后修正版）；阶段①「提取序列帧」新增**手动选帧**功能，15 文件 +1387 行 |
| `0.3.0` | 2026-10-05 12:56 | 新增**多语言支持**（界面文案与内置提示词跟随 DSH 语言设置，中 / 英，`feat(i18n)`，README 增加英文版）；新增模块五「**45°地图地块生成**」（实验性：等距地块 → 拼成整张地图，`feat(tile)`）；另有 `fix(tools)` 工具返回值统一过 `jsonSafe`、`fix(scripts)` verify-live-bundle 兼容 |
| `0.4.0` | 2026-10-09 14:12 | 设置页新增「**功能管理**」（`feat(settings)`）：逐个开关五个模块，隐藏后界面上不再出现它的页签与侧栏菜单项，**对话工具面同样拒绝调用**（`game_material_call` / `status` / `intake` / `upload` / `wait` / `review` / `approve`），且可见性只能由用户在设置页里改；侧栏「游戏素材大师」入口上新增**快捷菜单按钮**，点击直接弹出五个功能 |
| `0.6.0` | 2026-10-15 08:50 | **模块六「地图编辑器」推倒重做**（`feat(map)`，实验性，**全本地零计费**）：参照 [AsPJT/AsLib](https://github.com/AsPJT/AsLib/tree/master) 的 **RPG Map Maker** 改成**一屏、纯图标、零术语**（左侧素材调色板 + 12 个图标按钮，右侧画布，选一张素材图就能开画）；素材形态（RPG Maker A2 拼块 / 整格 16 块 / 普通图块）由尺寸**自动识别**；**地图四周环绕**（相机 / 命中 / 绘制范围 / 脏块 / 邻域判断全部取模）；一格的 A2 自动连接由宿主展开成 **4 条象限 op**（客户端仍只 `drawImage`）；**动画地块**走 op 上的 `cycle` + 全局帧号；自带**程序化生成的内置素材**（4 张 A2 + 1 张道具，水有 2 帧动画；AsLib 的 pipo 素材是第三方版权，不打包）；新增**一键生成**（随机铺满 / 迷宫 / 大陆，同种子逐字节可复现）；编辑协议新增 **`dropKeys`**（界面把缓存 chunk key 报上来，宿主只回真正失效的那几个），`mapPlan` 改成按视口查询（`view` + `have`）；「**翻页图**」给自己的普通素材开逐行动画；**导出窗口按正常操作逻辑重做**（内容三只复选框多选 / 只有一个「导出」/ 多产物自动打一个 `<地图名>.zip`，`src/zip.ts` 手写且时间戳写死所以可复现 / 卡片写出本机绝对路径、「另存为…」走浏览器原生保存框）；**删除**：2:1 等距、多地图、图层高度 / 不透明度 / 类型 / 锁定、地形族与掩码编辑器、掩码覆盖率、Tiled `.tmj` `.tsj` 导出、带图例的自有 JSON、切片 contact sheet（`map-jobs/<id>/maps/` 目录消失，单张地图直接落 `map.json`）；wire 方法删 4 个（`saveMapFamilies` / `createMapDoc` / `deleteMapDoc` / `duplicateMapDoc`）、加 2 个（`runMapGenerate` / `importSampleTileset`）；自检脚本同步重写：`verify-map` / `-pipeline` / `-gateway` / `-client` 四件 + `e2e-map.mjs`。⚠️ 改完必须重启 DSH（宿主半区）。（`0.5.0` 从未发布，其模块六实现已被本次重做整体取代） |
| `0.7.0` | 2026-10-16 08:27 | **生图后端可选自定义服务**（`feat(image)`）：设置页新增「生图后端」，默认火山方舟 Seedream，也可换成用户自己的服务，协议三选一（**OpenAI 兼容** / **ComfyUI** / **Stable Diffusion WebUI**）；新增 `src/imageprovider.ts`（唯一分发层 `generateImageWithProvider`，模块里自己判 `imageProvider` 会被自检拦）与 `src/customimage.ts`（三协议各自发请求：OpenAI 的 `/images/generations`、带参考图先走 `/images/edits` 且端点不存在时退回 `image` 字段；SD WebUI 的 `txt2img` / `img2img` 与 `user:pass` 走 HTTP Basic；ComfyUI 的上传参考图 → `/prompt` → 轮询 `/history` → `/view`，工作流按 **JSON 树**替换占位符、没写 `{{image}}` 时自动改 `LoadImage` 节点）；配置项 `imageProvider` / `customProtocol` / `customBaseUrl` / `customApiKey`（脱敏回传）/ `customModel` / `customSize` / 负面提示词 / 步数 / CFG / 采样器 / 重绘强度 / 种子 / 超时 / ComfyUI 工作流；设置页 ark 与 custom 两组同时渲染（没配火山方舟 Key 也能先配本地服务并点「测试连接」），新增远程方法 `testCustomImage`；新增自检 `scripts/verify-custom-image.mjs`（68 项，起本地假服务端把三种协议都模拟出来，离线零计费）。**模块六「地图编辑器」转正**（全本地零计费，几何与导出都有像素级自检兜底）：去掉页签角标、进入弹窗与模块内常驻提示条，`verify-map-client.mjs` 反过来逐条钉住这三处不能出现、并断言模块⑤仍带实验性标记。**生成视频的两处都能自选本地视频**（`feat(sprite)`：阶段①转圈视频与阶段②八方向行走视频，导入产物与远端生成只差 `origin` / `originalName` 两个字段，阶段③④一行不用改；容器按**文件头**识别、上限 100MB；导入时作废该槽位已有的下游产物并**摘掉在跑的远端 `taskId`**）；新增 `exportImages`（八方向图 / 候选帧与条带 / 抠像帧 / 整图打成 zip 落 `out/`），界面上每张产物都有单独「保存」、候选帧另有「保存全部图片（zip）」；对话面 `game_material_upload` 新增 `kind=video` + `key`。**模块六：图层可改名换序 + 标记层**（`feat(map)`：默认三层「地理层 / 装饰层 / 建筑层」，图层卡里就地改名 / ↑↓ 换序 / 删层；`MapDoc.markers` 每格一个可命名标记，不进 `layer.data`，op 四态（add / remove / move / rename）走同一条 `applyMapOps`，画成圆圈里的数字、编号连续删了自动重排，导出 `map.json` 加 `markers` 且格式升到 `dsh-gem-map@3`）；`fix(mapgeom)` 视口比地图大时不画最后一列 / 最后一行。自检项数：host 367 / client 352 / tools 153 / feedback 203 / map 123 / map-pipeline 274 / map-gateway 160 / map-client 263。⚠️ 改到了宿主半区：要让设置页显示新的生图后端分组，必须重启 DSH。 |
| `0.8.0` | 2026-10-17 15:00 | **新增第七个模块「音乐生成编辑」**（`feat(music)`，谱乐 AI：灵感/歌词 → 不挂靠项目的新对话 → 四引擎生成 → 回界面裁剪 / 音量 / 淡入淡出 / loudnorm / 版本 / 导出；另有**谱曲模式**：方案 → scoremill 本地写 MIDI → 试听 → 逐版修改 → 可选交 Suno，谱曲本地免费）；**地图编辑器「AI 生成素材」**（自动判形态、只画一块无缝砖、播放速度 / 清晰度 / 循环方式 / 自动裁边 / 整图多格印花）；**图生视频可选本地 ComfyUI**；**DSH 0.2.1 适配**（`engines.dsh`、`--public-url`）。自检项数：host 387 / client 353 / tools 179 / feedback 203 / music 86 / music-score 46 / music-gateway 51 / music-client 66 / map 238 / map-pipeline 416 / map-gateway 216 / map-client 457。详见下方「0.8.0 发布说明」。 |
| `0.9.0` | 2026-10-18 10:11 | **新增第八个模块「音效生成」**（`feat(sfx)`，火山引擎豆包语音 **Seed-Audio**：一句话描述 → 音效 / 环境音 / UI 声 / 生物吼叫 / 角色配音；可带 1 张参考图或最多 3 条参考音频（互斥）；每次生成一条 take、永不覆盖；单次 ≤120 秒；每次生成真实计费；界面直接生成、工具面可调）。新增 `src/sfxapi.ts` / `src/sfxgen.ts`、配置项 `sfx*`、wire 13 个方法（163 → **176**）、`sfx-assets` 路由与独立导出；新增自检 `verify-sfx` 54 / `verify-sfx-gateway` 39 / `verify-sfx-client` 28。⚠️ 宿主半区改动，需重启 DSH。 |
| `0.9.1` | 2026-10-18 12:50 | **音效生成修复**（`fix(sfx)`）：轮询 `getSfxJob` 时同步刷新左侧任务列表（生成完成后不再停在「0 条 · ⏳」）；火山引擎 `fetch failed` 带上底层 `cause`（例如 TLS `ECONNRESET`），便于区分网络与鉴权问题。`verify-sfx-client` 28 → **29**。 |
| `0.9.2` | 2026-10-18 13:11 | **音效生成网络重试**（`fix(sfx)`）：只对「TLS 握手尚未建立就断开」这类**请求还没发出**的错误自动重试最多 3 次（Clash / TUN 节点抖动常见）；已发出的请求不重试，避免重复计费。成功后日志写明重试次数；`verify-sfx` 54 → **55**。 |
| `0.10.0` | 2026-10-24 06:49 | **对话工具面收成单入口**（`feat(tools)!`）：8 个 `game_material_*` 合并成 1 个 `game_material`，常驻 49,393 B → 约 3.9 KB，流程 / 方法表改由 `guide` 按需加载。**模块五推倒重做**（`feat(iso)!`）：删掉「45° 地图地块生成」，换成全本地 **45° 地图编辑器**（2:1 等距 / 4×4 自动连接 / 多格高处物件 / 动画地块 / 标记层 / 环绕 / 一键生成 / 内置素材 / 导出 PNG·JSON·zip），并支持**AI 生成素材**（开新对话 → `composeIsoAsset` → 回链确认）。**新增可选 ToAPIs 异步图片 / 视频后端**（`feat(toapis)`，[PR #7](https://github.com/universe-st/dsh-game-material-master/pull/7) by [@ToAPIs-2025](https://github.com/ToAPIs-2025)）。wire 方法 176 → **184**；新增 `verify-iso*` 四件与 `verify-toapis`。⚠️ 宿主半区改动，需重启 DSH。 |
| `0.10.1` | 2026-10-24 07:18 | **45° 地图编辑器修复**（`fix(iso)`）：「一键生成 · 大陆」的高度场中点插值把 `grid[8.5]` 当成格子写，点一次必抛 `TypeError`；现在 `step < 2` 时跳过这段（step = 1 的第一段已经把每格补满，中点那段本来就是重复的）。`verify-iso-pipeline` 54 → **55**（新增 continent 回归）。⚠️ 宿主半区改动，需重启 DSH。 |
| `0.10.2` | 2026-10-24 07:23 | **ToAPIs 后端验收修复**（`fix(toapis)`，[PR #8](https://github.com/universe-st/dsh-game-material-master/pull/8) by [@YamiAnn](https://github.com/YamiAnn)）：生图新增**背景**选项（`auto` / `transparent` / `opaque`，GPT Image 原生透明 PNG，下载原图不再二次抠像）；图生视频新增**画幅比例**（默认 16:9，方形角色用 1:1），透明首帧先铺白再交给视频模型；补真实 DSH 八方向 / 精灵导出验收文档，新增 `verify-toapis-alpha`（原生透明、白底首帧、ZIP 原字节）与 Windows 临时文件锁回归 `verify-project-windows-lock`；`verify-toapis` 42 → **43**、`verify-feedback` 214 → **217**。⚠️ 宿主半区改动，需重启 DSH。 |
| `0.11.0` | 2026-10-26 04:32 | **两套地图编辑器补上 Agent 闭环**（`feat(map)`）：新增 `mapInspect` / `isoInspect`（按区域、按预算读逐格 / 物件 / 整图 / 标记 / 通行性，默认 4096 格，超了回 `truncated` + `nextRange`）与 `mapRender` / `isoRender`（同步检查图：区域裁切、1~4 倍、透明 / 棋盘 / 白 / 深底、可叠 markers / grid / axes / pass / outlines，返回 `localPath` 给 `read_image`）；新增 `guide` 主题 `map-agent`。`applyMapOps` / `applyIsoOps` 新增 **`dryRun`** 与 **`ifRevision`**，项目视图带 `revision`。标记新增 **kind / color / note / tags** 与 `marker update`，导出格式 `dsh-gem-map@5` / `dsh-gem-iso-map@2`。整图新增 `stampMove` / `stampRotate`（越界或被别的整图占住会跳过，不静默顶掉）、最小占格 2 → **1**，素材属性里可改 `stampPass`；45° 物件新增 `duplicate`；`importMapTileset` / `importIsoTileset` 支持 **`path`**；`compose*` 返回 `localPath` / `previewPath`；所有模块的项目 / 任务标题旁与侧栏行都能**一键复制 projectId / jobId**。修复整图多格笔刷被标记 / 橡皮 / 油漆桶 / 吸管借用。wire 184 → **188**；新增 `verify-map-agent` 35。自检：host 387 / client 362 / tools 196 / feedback 217 / map 239 / map-pipeline 429 / map-gateway 228 / map-client 474 / iso 42 / iso-pipeline 55 / iso-gateway 64 / iso-client 83。⚠️ 宿主半区改动，需重启 DSH。 |
| `0.11.1` | 2026-10-27 12:36 | **生图尺寸与抠像底色修复**（`fix(image)` / `fix(chroma)`）：生图输出尺寸统一为**全局设置**（所有模块共用，任务级旧尺寸不再覆盖），支持 `1K` / `2K` / `4K` 与精确 `宽x高`，ComfyUI 工作流没写 `width`/`height` 占位符时自动改 `Empty*` latent 节点；修复「生成的图总是同一尺寸、改了也不行」。新增 `keyColor` 抠像底色（默认 `#00FF00`，内置绿 / 蓝 / 品红 / 青 / 黄 / 红 / 白 / 黑 + 自定义），图片 / 序列帧 / 八方向 / 地图整图 / 45° 物件 / 两套 AI 生成素材入口都可选；绿色保留原判据，非绿走 RGB 距离与通用去溢色；默认生图 / 转圈 / 行走提示词与地图 AI 素材提示词跟随底色替换「绿幕 / #00FF00」，用户原文不改，老项目默认提示词自动迁移，项目可跟随全局或单独覆盖。自检：host 398 / client 362 / tools 196 / feedback 220 / pipeline 47 / custom-image 69 / map 239 / map-pipeline 431 / map-gateway 228 / map-client 478 / iso 42 / iso-pipeline 55 / iso-gateway 64 / iso-client 83。⚠️ 宿主半区改动，需重启 DSH。 |

### 0.11.0 发布说明（2026-10-26）

`package.json` 是 `0.11.0`。相对已发布的 `0.10.2`，这次把两套地图编辑器从「Agent 能调写入接口」补成
「**读状态 → 出方案 → 批量执行 → 看效果图 → 校验 / 迭代**」的完整闭环，并顺带修掉几处真机反馈。

#### ① Agent 闭环：inspect / render

- 新增 `mapInspect` / `isoInspect`：按 `region`（右下开区间）读逐格、物件 / 整图、标记、通行性与统计；
  默认预算 4096 格，超了回 `truncated:true` + `nextRange`，不会让 agent 把 512×512 一次拉出来。
  `include` 可选 `layers / markers / stamps / pass / stats / legend`，`format` 可选 `text / json / both`。
- 新增 `mapRender` / `isoRender`：**同步**出检查图，按 `region` 裁、`scale` 1~4、`background` 透明 / 棋盘 /
  白 / 深，`overlay` 可叠 `markers / markerLabels / grid / axes / pass / objects / regions / outlines`；
  返回 `localPath`（本机绝对路径）与 `url`，`read_image` 直接看。返回 `revision` 与 `revisionAtStart`
  对不上时标 `stale:true`。`MAX_RENDER_PIXELS` 兜住超大图。
- 新增 `guide({topic:"map-agent"})`：两套编辑器共用的读 / 写 / 看 / 验收流程与硬规则
  （不要拿 `mapPlan` / `isoPlan` 当状态查询、不要用 shell 改 `map.json`、检查图不代替阶段通过）。

#### ② 安全写入：dryRun / ifRevision

- `applyMapOps` / `applyIsoOps` 新增 `dryRun`：只校验、回 `skipped` / `summary`，不写盘、不进撤销栈。
- 新增 `ifRevision`：文档 revision 不一致时直接拒绝，避免 agent 拿着旧状态覆盖用户刚做的编辑。
- `getMapProject` / `getIsoProject` 等回包带 `revision`；`apply*` 回 `revision`。

#### ③ 标记语义

- `MapMarker` / `IsoMarker` 新增 `kind`（spawn / exit / chest / boss / event / resource / npc / custom…，开放字符串）、
  `color`（`#rrggbb`）、`note`、`tags`；新增 `{kind:"marker", op:"update", patch:{…}}`，可逐字段改 / 清空。
- 导出格式在有语义字段时升到 `dsh-gem-map@5` / `dsh-gem-iso-map@2`；没有语义字段仍写 `@4` / `@1`，旧档照常读。
- 标记仍是源数据，导出 PNG 不画标记；检查图要看标记必须打开 `overlay.markers`。

#### ④ 编辑能力

- 整图新增 `stampMove` / `stampRotate`：目标越界、比地图大、或与另一张整图重叠时**跳过并写 `skipped`**，
  不会静默顶掉别的实例；撤销恢复到旧位置 / 旧朝向。
- 整图最小占格 **2 → 1**：1×1 也能带 4 个旋转与逐格通行区域（`STAMP_MIN_CELLS` / `OPEN_STAMP_MIN` / 界面 /
  回链预填一起改）。
- 整图素材属性里可直接重画通行区域：`saveMapTileset({stampPass})`，长度必须 = `cols×rows`，
  只改数据、不动几何与图块序号；下次 `mapPlan` / 导出立刻生效。
- 45° 物件新增 `duplicate`（可指定 `newId`，自动错开 / 防重叠）。
- `importMapTileset` / `importIsoTileset` 支持 `path`（本机绝对路径，宿主自己读盘），避免把 base64 塞进工具参数；
  `data` 与 `path` 二选一。`composeMapAsset` / `composeIsoAsset` 回 `localPath` / `previewPath`。
- `upload` 的 `options` 透传到 map / iso 的素材导入。
- 所有模块的项目 / 任务标题旁与侧栏行新增**一键复制 `projectId` / `jobId`**。

#### ⑤ 修复

- 整图的多格笔刷只借给「画笔」：切到标记 / 橡皮 / 油漆桶 / 吸管时悬停框、右键与落笔都回到 1×1；
  橡皮右键恢复为「擦一格」，切回画笔仍是整张。
- 多帧整图在素材列表正确显示「会动」，属性窗口的速度 / 循环不再被禁用。
- `verify-map-client` 在渲染 40 轮仍未稳定时返回最后一帧（原来返回入参函数，后续断言拿到空树）。

#### 自检项数（0.11.0）

`host 387` / `client 362` / `tools 196` / `feedback 217` / `i18n 9` / `map 239` / `map-pipeline 429` /
`map-gateway 228` / `map-client 474` / `map-agent 35` / `iso 42` / `iso-pipeline 55` /
`iso-gateway 64` / `iso-client 83`。wire 方法 **188**。

### 0.10.0 发布说明（2026-10-24）

`package.json` 是 `0.10.0`。相对已发布的 0.9.2，这是把三段开发合并成的一次发布（内部曾按
0.10.0 / 0.11.0 / 0.12.0 推进，0.11.0 与 0.12.0 **从未发布到 npm**，git 历史里仍能看到这两个版本号）。

#### ① 对话工具面收成单入口（破坏性）

- 原来 8 个 `game_material_*` 工具合并成 1 个 `game_material`，用 `action` 选择
  `guide / intake / call / status / wait / review / approve / reviewMode / upload`。
- 新增 `src/toolguides.ts`：原来塞在工具描述与系统提示词里的流程 / 方法表 / 参数按主题拆到这里，
  由 `action:"guide"` 按需加载；`methods` 目录从 `TOOL_METHODS` 自动生成并按 `hiddenModules` 过滤。
- 常驻工具面从 **49,393 B**（工具 schema 33,615 B + 提示词 15,778 B）降到约 **3.9 KB**
  （`verify-tools.mjs` 断言 ≤6,000 B）。详细手册只在实际调用时进入上下文。
- `intake` / `upload` / `status` / `wait` / `review` / `approve` / `reviewMode` 的行为不变；
  顺手把 `approve` 的 `variant` 与 `review` 的 `key` 补进 schema（之前执行体读了但 schema 没声明）。
- 自动任务（AI 生成素材 / 音乐 / 谱曲）提示词改为「先读 guide」，并统一新调用语法；
  `src/musicguide.ts` / `src/musicscoreguide.ts` / `src/sfxgen.ts` 里模型可见的旧工具名同步更新。
- 自检：`verify-tools` 179 → **194**（新增常驻字节预算、guide 覆盖、隐藏模块不泄露手册）；
  `verify-map-gateway` 216 / `verify-music-gateway` 52 / `verify-sfx-gateway` 39 / `verify-music-client` 67。

#### ② 模块五推倒重做：全本地 45° 地图编辑器（`iso`）

- **删除旧「45°地图地块生成」（`tile`）**：`src/tilegen.ts` / `tilemap.ts` / `tilegeom.ts`、
  13 个 tile 远程方法、`tile-assets` 路由、tile 界面与实验性弹窗全部移除。旧 `tile-jobs/`
  原样留在磁盘上、不再被读取，不做迁移。
- **新增「45°地图编辑器」（`iso`）**：2:1 正交等距（默认 `64×96` 格），
  地面 / 4×4 自动连接 / 多格高处物件 / 动画 / 标记 / 环绕 / 一键生成；
  导入自己的 45° 素材 + 程序化内置素材；全本地零计费；导出 `dsh-gem-iso-map@1` + PNG + zip。
- 现有模块六「地图编辑器」（`map`）不动：`mapgeom` / `mapdoc` / `maprender` / `mapgen` /
  `mapexport` 的口径、数据格式与自检期望一行未改。
- wire 方法 176 → **183**（删 13 个 tile、加 20 个 iso）；`module` 枚举 `tile` → `iso`；
  `STUDIO_MODULES` 顺序 `sprite,image,sequence,rig,iso,map,music,sfx`。
- 项目 id 前缀 `g…`，数据在 `iso-jobs/<id>/`（`project.json` / `map.json` / `tilesets` /
  `preview` / `export`）；资源 scope `iso-assets`（`AssetScope` / `resolveAssetTarget` / `SCOPES` /
  `SERVABLE_ISO_DIRS` 四处同步）。

#### ③ 45° 地图编辑器：AI 生成素材

- 素材卡「AI 生成素材」→ 新对话 → 宿主 `composeIsoAsset` 抠绿 / 裁边 / 2:1 菱形或占格整理 →
  回链打开「新增素材」预填，用户确认才导入。首版支持地面（2:1 菱形）与物件（整图 + footprint）；
  自动连接 4×4 仍走手工导入。
- 新增 `src/isocompose.ts`（纯像素整理）与 `isogen.composeIsoAsset`；`ai/` 加入 iso 资源目录。
- 回链复用 `dialog=add&asset=…&shape=ground|object&frames=…&scale=…&cols=…&rows=…&keyed=1`，
  iso 界面自动打开「新增素材」并预填；只整理、不自动导入。
- wire 新增 `composeIsoAsset`，方法数 183 → **184**；新增 `iso-ai-asset` 工具手册。

#### ④ 可选 ToAPIs 异步图片 / 视频后端（PR #7）

- 由 [@ToAPIs-2025](https://github.com/ToAPIs-2025) 在
  [PR #7](https://github.com/universe-st/dsh-game-material-master/pull/7) 贡献（`feat(toapis)`）。
- 设置页独立配置 ToAPIs（Base URL / Key / 图片模型与尺寸 / 视频开关与参数 / 超时），
  生图后端可切 ToAPIs，图生视频可改走 ToAPIs 异步接口；默认后端仍是火山方舟 / MiniMax，
  与 ComfyUI、自定义协议、本地处理互不影响。
- 异步媒体协议（提交 → 轮询 → 下载），回执落在 `<DSH_HOME>/game-material-master/toapis-receipts/`，
  提交不确定或缺 taskId 时**阻止重复付费提交**；取消本地等待不会取消远端付费任务。
- 视频首版只接受文生视频或一张首帧图（MP4 / 无音频 / 16:9）；尾帧与多模态参考在付费提交前拒绝；
  Seedance Global 变体拒绝。
- 新增 `verify-toapis.mjs`（42 项，mock HTTP、零付费调用）；`verify-feedback` 覆盖设置页新选项与 Key 输入。

#### 自检项数（0.10.0）

`host 387` / `client 364` / `tools 196` / `feedback 214` / `comfy 124` / `custom-image 68` /
`toapis 42` / `music 86` / `music-score 46` / `music-gateway 52` / `music-client 67` /
`sfx 55` / `sfx-gateway 39` / `sfx-client 29` / `map 238` / `map-pipeline 416` /
`map-gateway 216` / `map-client 457` / `iso 42` / `iso-pipeline 54` / `iso-gateway 58` / `iso-client 83`。

> 自检脚本以仓库里的实际断言数为准；上面这组对应当前 `scripts/`。

### 0.9.0 发布说明（2026-10-18）

`package.json` 是 `0.9.0`。相对 0.8.0：

- **新增第八个模块「音效生成」**（`feat(sfx)`，火山引擎豆包语音 **Seed-Audio**）：界面直接生成 /
  工具面可调；一句话描述 → 音效 / 环境音 / UI 声 / 生物吼叫 / 角色配音；可带 1 张参考图或最多 3 条
  参考音频（互斥）；每次生成一条 take、永不覆盖；单次 ≤120 秒；每次生成真实计费。
- 新增 `src/sfxapi.ts`（HTTP 客户端与参数校验）、`src/sfxgen.ts`（任务、参考、生成、导出、
  `SERVABLE_SFX_DIRS`）；配置项 `sfxProvider` / `sfxApiKey`（凭据，不进 `directKeys`）/
  `sfxBaseUrl` / `sfxModel` / `sfxFormat` / `sfxSampleRate` / `sfxTimeoutMs`。
- wire 新增 13 个方法（`testSfx` + 12 个 sfx 方法），方法数 163 → **176**；工具面新增
  `intake` 的 `sfx` 分支、`status.sfxJobs`、`review` / `approve` / `upload` 分支与系统提示词。
- 新增自检 `verify-sfx`（54）/ `verify-sfx-gateway`（39）/ `verify-sfx-client`（28）；
  `verify-client` 363 → **364**，其余回归不变。
- ⚠️ 改到了宿主半区：**要重启 DSH**；浏览器半区刷新即可。

下一次发布请**在表中追加一行**，写明版本、UTC 时间与内容；详细说明可以另起一节（格式参照下面的「0.8.0 发布说明」）。

### 0.8.0 发布说明（2026-10-17）

`package.json` 是 `0.8.0`。相对已发布的 0.7.0，0.8.0 的内容如下。

#### 模块六「AI 生成素材」

素材卡片上多一颗按钮，点开填「提示词 / 素材名字 / 动画帧数（默认 1）/ 动画生成方式（生图模型 | 视频模型）」，
点「生成」**不在插件里生成图**，而是**开一个新对话**（`sessions.create({})`：不给 workspaceId / cwd = 不挂靠项目）→
切到对话界面 → 把拼好的需求作为第一句话发进去（`buildAssetRequestPrompt`，逐行 `T()` 拼，别整段塞进一条 `T()`）；
对话里的 agent 用**现成工具**生成（帧数 1 = 图片生成 count:1；帧数 > 1 + 生图模型 = count:N；
+ 视频模型 = 先出静态首帧，再序列帧 `upload(firstFrame)` → `runSequenceVideo` → `runSequenceFrames`），
最后调**新的宿主方法 `composeMapAsset`**（`scripts/verify-*` 会拦「新增方法忘了归模块 / 忘了进客户端清单」）
把帧整理成**一张图**：等比裁到**当前地图网格**、最近邻缩放、**按帧自上而下堆成一列**，落在项目的 `ai/` 暂存区 ——
**只整理、不进素材列表**。工具返回的 `openUrl` 带 `dialog=add&asset=ai/<名字>.png&frames=<N>&shape=<形态>`，
点开就回到地图编辑器、素材窗口展开、「新增素材」已打开并预填（图 / 名字 / 格子=项目网格 / 用法=**回链里的形态** / 会动吗按形态定），
用户点「确定」才真的导入。⚠️ 三处必须记住：格子必须等于地图网格（否则图块压边）、预填的用法**不能**是「自动识别」
（`32×(32×N)` 在 N=5 这类情形会被认成拼块）、`ai/` 必须进资源白名单（真源 `mapgen.SERVABLE_MAP_DIRS`，
`index.ts` 的路由直接引用它）。
**这块素材怎么用（普通 / 整格 / 拼块）是生图前就定好的计划**：对话框里默认「自动判断」（由对话里的 agent 按提示词判据定，也可以在那里替它拍板），
agent 再把这个形态原样传给 `composeMapAsset`；宿主按它**规整几何**。回链多带一个 `shape` 参数，
「新增素材」按它预选用法 —— 少了它拼块 / 整格会被当成普通素材导入，画出来全是碎块而且不报错。

⚠️ **整格 / 拼块绝不能让模型画「多格排布」，只能让它画「一块砖」**（这条是被真实素材打回来过的，见 ENGINEERING.md「AI 素材的接缝」）：
一排墙在地图上用到的是**三块不同的图块**（掩码 2 / 10 / 8），模型画的 16 个格子却是各自独立的（霓虹灯带、板缝各偏几十像素），
拼起来边缘差 201、块内相邻列才 58 —— 那就是用户看到的接缝。现在：**模型画一块无缝砖（四边能接上自己），
代码从同一块砖的像素拼出全部格子**（`corner16SheetFromTile` / `a2SheetFromTiles`），
「断」的边由 `shadeSide` / `shadeCorner` 加收口（整格 4px、拼块小格 2px，`capThicknessFor` 按尺寸算）。
于是任何「连」的边都是砖自己的边缘，接缝等于砖的环绕缝（最好的可能值）；`tileSeamRatios` 还会把它量出来 ——
砖接不上自己时 `notes` 会直接说「平铺每隔一格会有一道缝，让模型重画一张更均匀的无缝材质」，提示词里也写明**这种情况不要自动重跑（要花钱）**，交给用户决定。

⚠️ **三种用法里只有两种会动**，界面与提示词都必须照这个来（这条也是真机踩出来的：用户在整格上选了「视频模型 + 8 帧」，
提示词里同时写着「帧数 8」和「整格没有帧这一维」，agent 按静态做完，出来的图不动、**而且没人告诉他**）：

| 用法 | 会动吗 | 怎么动 |
|---|---|---|
| 整格 `corner16` | **不会** | 4×4 全是接法（动画行也是接法行），没有帧这一维 |
| 拼块 `a2quad` | 会 | 帧数 = 变体数，宿主给每格 4 条等长 `cycle`，客户端按全局帧号循环 —— **既自动连接又会动** |
| 普通 `plain` | 会 | 帧数 = 翻页图的行，`animRows` 一开就有 `cycle` |

所以：对话框里选整格会把**帧数灰掉、视频模型点不动**（外加一句「想要会动改用拼块」）；
`buildAssetRequestPrompt` 对整格一律把帧数 / 方式**归一到静态**，并在用户原本要动画时要求 agent「**在回答里说清这件事**」；
形态待判断（自动）而用户要动画时，提示词直接要求 agent「判断成整格就改用拼块」；
`composeMapAsset` 收到「整格 + 多张」时报错也点明「整格没有动画，要会动请用拼块」。
自检：`verify-map-client` 钉住「整格 ⇒ 帧数 disabled / 视频点不动 / 提示词归一到 1 且带说明」，`verify-map-pipeline` 钉住那条报错文案。

⚠️ **动画播放速度是「素材自己的属性」，在「新增素材」里定**（`MapTileset.fps`，0.5~30 帧/秒；留空 = 跟
「设置 → 动画速度」那条全局速度走）。它不是「属性一次定死」那一类 —— 纯表现层、不动几何也不动序号，
所以 `saveMapTileset({fps})` 随时能改（`null` = 清掉回全局）。内置素材**也能改**（只挡几何，见「素材属性现在可以改」）。
链路必须**一路带到底**，少一环都只是「存了个数」：
`importMapTileset/saveMapTileset` 的 wire schema → `mapgen`（`parseAssetFps` 越界抛错，不静默夹）→
`maprender` 把速度写进每一条 op（`PlanOp.fps`）+ 计划里给 `fpsMax`（= 最快那条）→
客户端用它推动画时钟（`clockFps = max(全局, fpsMax)`，否则 8 帧/秒的素材会被 1 帧/秒的时钟拖住）
并按**每一格自己的速度**算帧号（`floor(经过秒数 × op.fps)`）。
⚠️ 还有两个静默坑：① `index.ts` 的 `mapTilesetBrief` 少列一个字段，界面就永远看不到速度
（网关自检专门盯它，这次真是它漏的）；② 客户端的计划身份（`planKey`）要带**素材动画属性签名**，
否则改完速度缓存里的 op 还带着旧 fps，表现是「改了没反应」。
自检：`verify-map`（`parseAssetFps` 边界）、`verify-map-pipeline`（第 18 节：导入带上 / op 带 fps / `fpsMax` /
改与清 / 越界报错；内置素材只挡几何、不挡速度）、`verify-map-gateway`（schema 不吞字段 + `mapPlan.fpsMax`）、
`verify-map-client`（8b 节：对话框只对会动的素材显示、可选值、提交真的带上 fps，
以及**拨 1 秒后 8 帧/秒的走 8 帧、跟全局 1 帧/秒的只走 1 帧**）。

⚠️ **「图片最终处理的清晰度」在「新增素材」里定**（`MapTileset.clarity`：`smooth` 面积平均 / `sharp` 最近邻 /
`crisp` 平均+锐化，默认 `smooth`）。为了让这个选择**真的有用**，`composeMapAsset` 不再把 AI 大图直接缩到
格子 —— 它先留 `cell × k`（k = 源图每块 ÷ 格子，上限 `MAX_ASSET_SCALE = 4`），**导入那一步才按清晰度缩**
（`importMapTileset({clarity, scale})`：先按 `1/scale` 重采样再把缩好的图存进 `tilesets/`）。
于是：
- 回链多带一个 `scale`（`scale > 1` 时「新增素材」才显示「清晰度」，并写明「这张图每格 128px，会缩到 32px」）；
- `scale = 1`（自己导格子大小的图，绝大多数手动导入）**逐字节原样存**，一个像素都不动（自检钉死了这条）；
- 缩法是**一次**的：结果烘进 `tilesets/<id>.png`，所以 `clarity` 只作记录，改它不会重算 —— 要换就删掉重导。
⚠️ 两个坑：① `mapTilesetBrief` 少列 `clarity` 界面就看不到（网关自检盯着）；② 抠像素材必须**预乘 alpha 再平均**，
不预乘的话透明边缘会被拖黑一圈（`verify-map` 有专门一条）。
自检：`verify-map`（`parseClarity` / `parseAssetScale` / `resampleToSize` 三档的像素与 alpha）、
`verify-map-pipeline`（棋盘格 1px：锐利 0 个混色、平滑 256 个混色；波纹：清晰比平滑对比更强；
`scale=1` 逐字节原样；越界报错）、`verify-map-gateway`（`clarity`/`scale` 不被 schema 吞）、
`verify-map-client`（回链带 `scale=4` → 出现三个选项、默认平滑、点确定时 `clarity`/`scale` 一起发出去）。

⚠️ **循环方式（`MapTileset.loop`：`forward` 正放 / `reverse` 倒放 / `pingpong` 来回）也在「新增素材」里定**，
跟播放速度并列、只对会动的素材显示。实现上它**只是把帧序展开**（`maptiles.applyLoop`，宿主在 `maprender` 里做）：
正放 `0,1,2,3`；倒放 `3,2,1,0`；来回 `0,1,2,3,2,1`（= `[...frames, ...frames.slice(1,-1).reverse()]`，2 帧时等于正放）。
**客户端一行都不用改** —— 帧号照旧 `cycle[floor(经过秒数 × 速度) % 长度]`，只是 `cycle` 变长了（`frameCount` 跟着变：
来回 4 帧 → 6）。它同样属于「表现层」：`saveMapTileset({loop})` 随时能改、下一次 `mapPlan` 就生效，不用重切素材。
⚠️ `mapTilesetBrief` 少列 `loop` 界面就看不到（跟 `clarity` / `fps` 是同一个坑，网关自检都盯着）。
自检：`verify-map`（`parseAssetLoop` 边界 + `applyLoop` 三种展开、2 帧/单帧/空数组的边界）、
`verify-map-pipeline`（第 19 节：三种方式下 `mapPlan` 的帧序真的不同、`frameCount` 跟着变、改完立刻生效、越界报错）、
`verify-map-gateway`（`loop` 过 schema 不丢）、`verify-map-client`（静态素材不显示 / 三个选项 / 点「倒放」「来回」真的切过去 / 提交时带上 `loop`）。

⚠️ **自动裁边**（`maptiles.trimUniformBorder`）：模型经常无视「四边不留白」，在自己画的图外面又留一圈白框；
留着的话每块素材边上都带一道白边（用户那张赛博墙：2048² 里 79/81/77/78px 是白框）。裁在 **`composeMapAsset` 里、
对每张源图单独裁**（不是裁合成图：多帧竖排时中间几帧的白框裁不到）。四道保险缺一不可，否则会把内容裁坏：
① 只裁**浅色**带（亮度 ≥ 170，深色平底是道具自己的背景）；② 每边最多 6%（更宽的纯色带是背景，不是画布边）；
③ 裁完至少留 60%；④ 四条边都得有浅色带，而且**里面必须真的有内容**（≥2% 像素与边框色明显不同）——
所以整张纯色 / 单色砖**一个像素都不动**。裁了会写进 `notes`（`verify-map` 与 `verify-map-pipeline` 都有正反用例）。

⚠️ **一格多大（地图网格）在新建项目时定**（客户端「新建项目」对话框的 16 / 32 / 48 / 64，默认 32；设置卡里只读显示）。
它是**项目级、建完不能改**的属性（改了所有素材都要重切）。32 一格时 2K 的 AI 图必然被压扁 —— 要真的清楚就开 48 / 64。
连带三处必须跟着走：① `composeMapAsset` 的默认 `cell` = 项目网格（已是如此，AI 素材按 64 出块、`scale` ×4 = 256px）；
② **内置素材**是按 32 画的，`importSampleTileset` 现在按 `项目网格 / 32` 重采样（整数倍放大用最近邻，缩小 / 非整数倍用面积平均）
—— 不缩放的话图块只有半格，看起来像缩小了一圈；③ `importMapTileset` **不给 cell 时仍按自动识别**（手动导「8×8 个 32px 小格」
是常见用法，拿网格当默认会把小格切成 4 倍大小），但**素材格子 ≠ 地图网格时会给一条明确告警**（`verify-map-pipeline` 第 20 节盯着）。
⚠️ **整格是「墙体」用法，所以它带方向**（`corner16SheetFromTile`）：南北直线（掩码 5）用**转 90° 的砖**、
四个转角用 **`joinCorner` 把横向砖与竖向砖沿斜接线拼起来**（真砌墙的转角做法），其余照旧。
这条来自真机反馈：「竖过来的部分花纹没拼」「拐角没有拐角的效果」——只画一条亮线没用，得让砖缝真的换向。
⚠️ 方向只在 **compose** 阶段烘进那 16 块，改规则后**已有素材不会自动变**；而「删掉再导」会把画在那张素材上的
格子清空。所以有了 **`recomposeMapTileset({projectId, tilesetId, files})`**：按同一份源图原地重烘，
**保留素材 id 与图块数**（`verify-map-pipeline` 第 21 节断言重烘前后 `map.json` 的每格值一模一样、只换图片）。
⚠️ 重烘只换图，**图的 URL 得跟着变**：素材视图带 `rev`（文件 mtime），界面拼 `?v=rev`。
少了它浏览器会继续用缓存里的旧图 —— 表现是「重烘跑完了，画面一点没变」，而 `rev` 又是**派生数据、不落盘**，
所以 `importMapTileset` 的回包里也要现取一次（`mapgen.tilesetRevisions`），只改 `mapTilesetBrief` 不够。

⚠️ **新增了一种素材形态「整图」（`stamp`，多格印花）**：一张图**一次占 N×M 格**（雕像 / 壁画 / 地毯），
可带序列帧，4 个旋转**烘在素材图里**（不是运行期转），导入时逐格标通行性并导出。要点：
- `MapTileset.stamp = {cols, rows, frames, pass[]}`；`MapDoc.stamps[]` 是**实例**（参考点 + 旋转），
  **不进 `layer.data`**（一格只装得下一个图块序号），占哪些格由 `stampSpan` 现算。
- 素材图 = `帧 × 4 旋转`，逐块竖排：宽 = `max(cols,rows)` 格，高 = `frames × 2(cols+rows)` 格；
  90°/270° 的长宽互换。**旋转烘进图里**是为了不动渲染契约（客户端与宿主光栅化器都只 `drawImage`）。
- op 只有两条：`stampPlace{tilesetId,r,c,rot}` / `stampRemove{id}`；`paint|fill|rect|replace` 落笔前
  **整张摘掉**压到的整图（哪怕值没变 —— 否则橡皮对着雕像什么都不发生）。整图**不覆盖**下面的图块。
- 通行性三态 `0 不可通过 / 1 可通过·被人物遮挡（角色画在上面）/ 2 可通过·遮挡人物（它画在上面）`，
  **只导出**（编辑器只做颜色叠加，见「区域」开关）。导出格式升到 `dsh-gem-map@4`。
- **背景要透明，绿幕由代码抠**：整图是「立在格子上的物件」，模型必须画**纯绿背景 + 只画本体**
  （提示词里写死了：不要地面 / 草地 / 道路 / 天空）。`composeMapAsset` 逐帧 `chroma.keyGreen`
  抠成透明，但用的是**整图专用的严格参数** `STAMP_KEY_OPTIONS`（`keyLow 80 / keyHigh 150`、
  **关掉空间分割**）：只认饱和纯绿。真机教训 —— 用户那张城门的背景是**草地**（绿的优势值只有 26~59），
  角色的默认参数（`keyLow 14` + `bgTolerance 40`）会吃掉 82%，连城墙内部的阴影一起啃成碎片。
  另外 `backgroundFraction < 0.02` 或 `> 0.98` 一律原样返回（绝不把图抠成空白），`notes` 会说清
  「抠了多少」或「没检测到绿幕，按原图用了」；回包带 `keyed`，回链据此带 `keyed=1` 让「新增素材」
  **取消**再抠一次。手动导绿幕图走 `importMapTileset({stampKey:true})`（对话框里默认勾着，
  自己导透明 PNG 也能勾 —— 没有绿就什么都不做）。
- **「新增素材」窗口自己滚**：`.SPR_mapEdDlg` 有 `max-height: calc(100vh - 96px)` + `overflow-y:auto`，
  标题与底部「取消 / 确定」都是 `position:sticky` —— 整图的选项一多（占格 / 帧数 / 区域格子 / 速度 / 清晰度），
  不这么做窗口会长到出屏、底下的「确定」根本点不到。
- **区域格子叠在图上**（`.SPR_mapEdStamp` + `SPR_mapEdStampGrid`）：选中的图铺满那个框
  （`background-size:100% 100%`），格子用 CSS grid 严丝合缝压上去，点哪一格就是那一格；
  三态用**很淡**的半透明色（0.10 / 0.16）+ 内描边 —— 涂重了就把素材图盖住了。
  多帧时只铺第 1 帧（`background-size: 100% <frames*100>%`），否则格子与画面对不上。
  预览 URL 用 `URL.createObjectURL`（**同步**）而不是 `FileReader`：异步读会让 effect 反复 setState。
- **整图帧数 > 1 时也有「动画速度 / 循环方式」**（整张图同步播同一帧）。判定条件是
  `animRows || a2quad || (stamp && stampFrames > 1)`，三处（循环方式 / 动画速度）都要一致。
- **整图的占格上限是「地图自己」**（`STAMP_MAX_CELLS = 512` 只是防离谱值的硬上限）：
  `parseStampSpec` 不再卡 8 格，真正的校验是 `assertStampFitsProject(spec, doc.cols, doc.rows)`
  —— 一张整图最多和整张地图一样大，比地图大就直接报错（再大地图上也画不全）。
  「新增素材」里的 宽/高 输入框 `max` 也跟着 `view.cols / view.rows` 走（客户端 `stampLimits`）。
- **素材属性现在可以改**（点素材列表里的一行 → 弹「素材属性」）：名字 / 播放速度 / 循环方式。
  这三样是**表现层**（不动几何、不动图块序号），`saveMapTileset({name, fps, loop})` 随时能改，
  地图上已经画好的格子不用重画。**内置素材也能改这三样**（`builtin && touchesGeometry` 才拒绝）。
  形态 / 格子尺寸仍然一次定死（那会重切图块、把画过的格子整体错位）。
  ⚠️ `saveMapTileset` 的 `name` / `fps` / `loop` 都必须留在 wire schema 里，少一个就是「改了没反应」。
- ⚠️ 四个坑：① 整图**必须**用 `stampPlace`（拿它的图块序号去 `paint` 会跳过并说明）；
  ② 一键生成**不进**整图（按格铺只会得到碎片）；③ 删素材要连带删掉引用它的整图
  （`dropStampsOfTileset`，`layer.data` 的重映射清不到它们）；
  ④ **旋转只能烘一次**：`composeMapAsset` 出的是**源图**（`cols × rows*frames`，`stampSourceCells`），
  旋转由导入 / 重烘那一步烘（`stampTilesetImage`）。两边都烘的话，导入会把「4 个旋转叠起来的图」
  当成一帧压扁 —— 真机就是这样：`ai/…png` 是 1024×2560，导入压成 256×64，地图上成了一条条横条纹。
  ⑤ **块序号：`base` 是 1 基、`local` 是 0 基，所以是 `base + local`**（`maprender.stampTileIndex`）。
  写成 `base + local + 1` 的表现是**整体左移一格 + 最右一列越界取到 rot1 的竖块**
  （用户原话：「左边少了一块、右边多了点东西」），而且**一条警告都不报**。这类错位唯一的拦法是
  **黄金对照**：`verify-map-pipeline` 第 22 节会把 `mapPlan` 每条 op 的矩形拿去素材图上取像素，
  逐格和源图比，并断言「这一格必须落在自己的旋转段里」。

⚠️ **提示词要按一格的像素写「细节尺寸」**（真机翻车过：一张 2K 的细密砖墙缩到 32px 只剩一片红雾 —— 实测细节量
32px 8.9 / 64px 14.6，用户看到的就是「宫廷围墙不像墙」）。所以 `buildAssetRequestPrompt` 现在会说
「任何细节不能小于一格的 1/4」「砖块这类重复单元一格最多排 3/4/5 排」，并且**一格 ≤32px 时直接劝退**：
按大砖画 + 在回答里告诉用户「做成一格 64px 再生成，同样一幅画能留 4 倍细节」。
⚠️ 画得再准也救不了 32px 的细砖纹 —— 那是分辨率问题，只能靠 64 格（或接受简化画法）。

⚠️ **AI 提示词只写用户选中的那一种**：用户已经指定用法时，「第一步 · 定用法」那四条判据整块都不写
（只留一句「已经定死了，不要再讨论别的用法」）。真机踩过：指定了「整图」，回答里还在讨论「要不要当拼块」——
把没选中的选项念一遍，agent 会以为还有得商量。另外整图的提示词与其它形态**相反**：要**纯绿幕**、
只画本体、不要地面，并明说「不用自己抠图」（别为了抠图再花一次钱）。

自检：`verify-map`（`trimUniformBorder` 的六条正反用例）、`verify-map-pipeline`（第 17 节自动裁边、第 20 节 16/32/64 网格与内置素材缩放）、
`verify-map-gateway`（`createMapProject.grid` 过 schema）、`verify-map-client`（新建对话框的四档 / 说明 / 建出来真的是 64 网格，建完即删并切回 32）。同批还加了：深链接意图的 `dialog` / `asset` / `frames` / `shape` 四个参数、
`getImageJob` / `getSequenceJob` 返回的 `dir`（本机绝对目录，agent 拼帧路径用）、
工具描述与系统提示词里的「AI 生成素材」固定流程。⚠️ **宿主半区改了，要重启 DSH**。
自检项数：verify-host 387 / verify-client 353 / verify-tools 153 → **179** / verify-pipeline 40 / verify-feedback 203 / music 86 / music-score 46 / music-gateway 51 / music-client 66 /
verify-i18n 9 / verify-map 123 → **238** / verify-map-pipeline 276 → **416** / verify-map-gateway 160 → **216** /
verify-map-client 298 → **457**。

另有一批 **DSH 0.2.1 适配**（`fix(dsh)` / `feat(compat)`）：`package.json` 补 `engines.dsh`（`>=0.2.0-rc.2 <0.3.0-0`）；
开发依赖对齐 0.2.1 的 `cordis ~4.0.5` / `dsh-typert-protocol 0.2.1-rc.2`（旧的自检树还停在 protocol 0.1.0-rc.6，
等于在拿旧契约验收）；移除 DSH 0.2.1 已废弃的 `@deepseek-ai/dsh-invariants` 开发依赖（本插件从未 import）。
另外支持 `--public-url https://host/prefix/`：浏览器半区把 `location.pathname` 一起报给宿主
（`reportClientOrigin({origin,path})`），宿主用 `links.assetBasePath()` 给所有 `assetBase` 补路径前缀、
`buildOpenLink()` 默认拼 `origin + /prefix`；`verify-host` 与 `verify-tools` 各加了几条前缀断言。
⚠️ 宿主半区改了，**要重启 DSH**；浏览器半区刷新即可。
自检项数：verify-host **387** / verify-tools **179**（其余不变）。

0.8.0 还包括一个**本地 ComfyUI 视频后端**
（`feat(comfy)`，可选、不影响默认链路）：设置页新增「本地 ComfyUI（图生视频）」，勾选后**只有「图生视频」这一步**
改走 ComfyUI（替代 MiniMax）——工作流收 JSON（**API 格式**直通，编辑器里保存的界面格式会先自动转成 API 格式），
注入点（提示词 / 宽高 / 时长 / 种子 / 首尾帧）自动探测，工作流里没连的 optional `IMAGE` 输入按 `/object_info`
的节点定义自动补一个 `LoadImage`，内置模板就是 FreeVideo 那条链路；新增 `src/comfy.ts`（客户端）、
`src/videogen.ts`（后端分派，按**节点上记的** `backend` 查任务）、`scripts/verify-comfy.mjs`（124 项，自起 mock
ComfyUI）、配置项 `comfy*` 十一个（多出的 `comfyCookies` 专供鉴权反代，不进 `directKeys`），wire 新增 `testComfy`。
同批还包括：候选帧上限 64 → 512、换源图后作废由旧源图派生的产物、转圈首帧的时间兜底、
ffmpeg / ffprobe 的路径查找（Windows 上读注册表与常见安装位置）；以及模块六「新增素材」窗口里的
**「素材说明」按钮**（`feat(map)`）：点开是一个三页的图文说明窗口，逐页讲清「普通图块 / 整格自动连接 /
拼块自动连接」这三种素材图**该怎么排**（示例图、几列几行、第几块是哪一种接法），图上的网格按示例图
真实的 cols / rows / sub **现算百分比**、两层网格错开半拍循环隐现。示例图不是手画的：普通 / 整格两张由
`src/mapsamplegen.ts` 的 `renderGuideSheets()` 现画，拼块那张就是内置草地；生成器
`scripts/make-map-guide-art.mjs` 把三张图 base64 内联进 `src/client.ts` 的 `MAP_GUIDE_ART` 标记块
（**只改客户端，不用重启 DSH**），`--check` 会把整格那张图解回来量一遍方向位序。
另有一处 `fix(map)`：**新建地图后调色板里一堆重复的块** —— 内置道具图（8 列 × 5 帧）的 5 行
是按列取名字画出来的、逐像素相同，又声明成 `animRows: false` 的普通网格，于是 40 个小格全成了
独立图块（调色板 44 条里 32 条重复）。现在道具图按相位画成**真帧**、声明 `animRows: true`，
`paletteFor` 对翻页图**每列只出第 0 帧**（帧由宿主按全局帧号现推），调色板变成 12 条。
⚠️ 模块六自检当时把错值当成了期望（`prop.palette.length === 40`），已改成 8 条，并新增
「自建翻页图的调色板每列一条」与「道具图逐列量帧差」两条断言。⚠️ 这部分在宿主半区，要重启 DSH。
生图 / 抠像 / 抽帧 / 合图不变。

另有一个**新模块「音乐生成编辑」**（`feat(music)`，谱乐 AI，**生成按平台积分计费**）：设置页新增「音乐生成（谱乐 AI）」分组（API Key 脱敏、Base URL、默认模型、请求超时、生成等待超时；「测试连接」读一页历史、不生成）；新增 `src/musicmodels.ts`（四个引擎 / 模式 / 模型与参数枚举）、`src/musicapi.ts`（谱乐 AI OpenAPI 客户端：Suno / Mureka / MiniMax / ACE-Step 生成、query / wav / LRC / 历史 / 分轨 / MIDI / 乐谱 / 风格分析 / 转码、下载与 URL 安全）、`src/musicguide.ts`（中英双语创作指南，**来自 claude-ai-music-skills，CC0-1.0，已在 README 与源码头部致谢**）、`src/musicaudio.ts`（ffmpeg 裁剪 / 增益 / 淡入淡出 / loudnorm / 波形）、`src/musicgen.ts`（任务存储、生成轮询与下载、工具任务、版本、导出、`SERVABLE_MUSIC_DIRS`）。新增 22 个远程方法（`testMusic` + 21 个 music 方法），wire 方法数 136 → **158**。客户端新增第七个模块页签：灵感/歌词 → `createMusicJob` → 开一个**不挂靠项目**的新对话（`sessions.create({})`）→ agent 按内置指南扩写/选引擎/生成 → 回链接进界面裁剪/调音量/淡入淡出/标准化/保存版本/导出，路由支持 Range 与 `?download=1`。新增自检 `verify-music`（86 项，mock 谱乐 AI + 真 ffmpeg）、`verify-music-gateway`（37 项，wire schema 不丢键 / 工具面 / 隐藏模块）、`verify-music-client`（46 项，界面真渲染 + 新对话桥）。⚠️ 改到了宿主半区：**要重启 DSH**。

另有一个**「谱曲模式」**（`feat(music)`，`workflow: "compose"`，**谱曲/试听/导出本地免费，只有交 Suno 计费**）：
新建音乐卡的 `AI 生成 / 谱曲模式` 两个页签；谱曲模式的对话流程是「分析 → 用用户语言输出方案 →
`saveMusicScorePlan` →（manual 停下）→ 写 `compose.py` → `runMusicScore` → 宿主跑 Python/scoremill、
解析 MIDI、渲染试听 → 贴 `openUrl` 让用户听 → 逐版修改 → 用户明确要求才 `submitMusicScoreToSuno`」。
新增 `src/midifile.ts`（SMF 0/1 解析 + WAV）、`src/midipreview.ts`（内置 GM 近似合成器兜底）、
`src/musicscore.ts`（方案归一化 / 依赖探测 / 脚本执行 / FluidSynth 或内置渲染 / Suno 参数 / 乐谱包）、
`src/musicscoreguide.ts`（中英 scoremill 指南，来源 scoremill MIT + Midra 思路）；`musicgen.ts` 增加
`workflow` / `scorePlan` / `compositions` / `currentScoreId` / `stages.compose` 与五个方法
（`getMusicScoreGuide` / `testMusicScore` / `saveMusicScorePlan` / `runMusicScore` /
`submitMusicScoreToSuno`），wire 方法数 158 → **163**；设置页增加依赖探测与
`musicPythonPath` / `musicFluidsynthPath` / `musicSoundfontPath`。⚠️ **Suno 不接受 MIDI 原文件，
但接受音频**：交 Suno 时先把这一版试听音频 `POST /v1/suno/audio/upload`（multipart，标准上传免费）
拿参考 song id，再走 `POST /v1/suno/generate/cover`；判定版权时返回 `needsCopyrightConsent`，
用户确认后传 `copyrightAudio:true` 走付费版权通道。结果不会逐音一致；界面与提示词都写明。
⚠️ 谱曲脚本由宿主以参数数组、无 shell 跑，环境变量白名单、不传 API Key、180 秒超时；
`score.mid` 缺失/解析失败会返回原始 stderr（常带小节号），失败不新增版本。
`GMM_SCORE_RENDERER=builtin` 可强制内置音源。新增自检 `verify-music-score`（46 项，假 Python +
手工 MIDI + 内置合成器 + mock 上传/cover）；`verify-music-gateway` 37 → **51**、`verify-music-client`
46 → **66**、`verify-host` 方法数 158 → **163**。⚠️ 改到了宿主半区：**要重启 DSH**。

发布下一版时按下面的流程走，并在「已发布版本」表里追加一行（补上 UTC 时间），详细说明另起一节。

### 流程

```bash
# 0. 确认 lib/ 与 src/ 同步：build 之后 git status 不应出现 lib/ 的改动
npm run build
git status --short

# 1. 手工把 package.json 的 version 提上去
#    （纯文档 / 元数据改动走 patch；功能改动按 semver 判断，实验性模块的新功能也走 minor）

# 2. 提交并打 tag
git add -A
git commit -m "docs: …"
git tag v0.1.1
git push origin main
git push origin v0.1.1     # ← 必须显式推！--follow-tags 只推附注标签，不推轻量标签

# 3. 若 README 引用仓库内的图片，先确认线上绝对 URL 已经 200
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/gmm-00-workbench.png"

# 4. 预览将要发布的内容（files 白名单）
npm pack --dry-run

# 5. 发布
npm publish
```

### 发布后的验证

registry 有**分钟级传播延迟**，不要看到 404 就以为发布失败：

```bash
# 版本端点通常 1 分钟内从 404 变 200
curl -s "https://registry.npmjs.org/dsh-game-material-master/0.1.1" | head -c 200

# dist-tag 更慢，实测约 2 分钟后 latest 才切到新版本
npm view dsh-game-material-master dist-tags
```

实测时间线（0.1.1）：`npm publish` 返回 `+ dsh-game-material-master@0.1.1` 后，
版本端点约 1 分钟内 404 → 200，`latest` 约 2 分钟后从 `0.1.0` 切到 `0.1.1`。

### 发布相关的几个坑

- **`git push --follow-tags` 不会推轻量标签。** `git tag v0.1.1`（不带 `-a`）是轻量标签，
  必须 `git push origin v0.1.1` 单独推。漏了就出现「commit 在远端、tag 只在本地」。
- **README 里的图片必须用绝对 URL。** npmjs.com 不可靠地解析相对图片路径，用
  `docs/images/x.png` 在 GitHub 上正常、在 npm 包页面上是裂图。所以统一写
  `https://raw.githubusercontent.com/universe-st/dsh-game-material-master/main/docs/images/x.png`。
  代价是仓库内改图后要跟着改 URL，别写成相对路径「图方便」。
- **截图不进 npm tarball。** `files` 白名单只有 `lib` / `README.md` / `README.en.md` /
  `cordis.patch.yml`，`docs/` 不发布——这也是上一条必须用绝对 URL 的原因。
  tarball 约 978 kB / 59 个文件（0.8.0 实测；0.7.0 发布时是 704 kB / 48 个文件，0.6.0 时是 665 kB / 46 个文件，0.1.1 时是 415 kB / 32 个文件）。
- **两份 README 要成对改。** `README.md` 是中文原文，`README.en.md` 是英文版，
  两边顶部各有一条指向对方的**绝对**链接（npm 包页面解析不了相对路径，理由同上一条）。
  改了结构或数字（自检项数、tarball 大小等）就两边一起改。
- **`npm publish` 不触发构建。** 忘了 `npm run build` 就会把旧的 `lib/` 发出去。
  第 0 步的 `git status` 检查就是防这个。

### README 截图怎么重拍

截图由 Playwright 对着真实运行的 DSH Web 界面拍摄，原图在 `docs/images/`，命名 `gmm-NN-<模块>-<阶段>.png`。
重拍时注意：

- 只截**插件面板**，不要把 DSH 侧栏 / 会话列表截进去：对 `.SPR_root` 做元素截图
  （设置页则裁到 `[role=dialog]` 的范围）。
- 深链接可以直接把界面切到目标页面：`http://127.0.0.1:<port>/?dsh-gmm=1&module=sprite&project=<id>&stage=videos`。
- **设置页截图必须处理 API Key 回显**（界面显示脱敏尾号），用局部模糊盖掉再入库。














