# AGENTS.md

给在本仓库里干活的编码 agent 的说明。

- 人看的入门文档 → [README.md](README.md)
- 算法细节、自检契约、历史踩坑 → [docs/ENGINEERING.md](docs/ENGINEERING.md)

本文不重复上面两份，只写**干活时必须知道的事**和**发布流程**。

---

## 这是什么

DSH 插件「游戏素材大师」：从一张角色设定图出发批量产出游戏素材。火山方舟 **Seedream** 生图、
**MiniMax** 图生视频，抠像 / 抽帧 / 像素量化 / 合图全部在本机用 `ffmpeg` + 内置 JS 完成。

| 模块 | key | 状态 |
|---|---|---|
| 八方向图生成 | `sprite` | 正式 |
| 图片生成 | `image` | 正式 |
| 序列帧生成 | `sequence` | 正式 |
| 骨骼动画生成 | `rig` | **实验性**（页签带角标、进入弹窗、模块内常驻提示条） |
| 地图地块生成 | `tile` | 正式（等距地块 → 拼成地图） |

---

## 硬约束（改错了不报错，只是静默坏掉）

| 约束 | 原因 |
|---|---|
| `src/client.ts` **必须是经典脚本**：不能有 `import` / `export`，React 元素一律 `React.createElement` | 它由宿主以 `/plugins/dsh-game-material-master/client.js` 直接发给浏览器，浏览器半区不参与打包。构建脚本 `scripts/strip-client-export.mjs` 会剥掉结尾的 `export`，但别指望它兜住真正的模块化写法 |
| 改完 `lib/` 里的**宿主半区**必须重启 DSH | 宿主半区是进程启动时冻结的模块图。开发时可另起测试宿主 + `scripts/dev-overlay.yml` 拿 `patchReload` 热重载，见 ENGINEERING.md「开发时的宿主半区热重载」 |
| 改完 `lib/client.js` 只需刷新浏览器 | 客户端束由宿主按请求从磁盘读，带 `rev` 指纹 |
| **没有任何运行时依赖** | `zod` / `cordis` / dsh-typert-protocol 等一律从 DSH 自身安装树解析；`node_modules` 与 lock 文件不入库 |
| `lib/` **入库**（不是构建产物目录） | 包直接以 `main: lib/index.js` 发布，`npm publish` 不触发构建 |
| 生成类调用必须带 loading 反馈，批量任务要按 `job.targets` 盖住**还没轮到**的方向 | 不盖遮罩时界面看着完全正常，只是「点了没反应」，用户会反复点——每次点击都真实计费。`verify-client.mjs` / `verify-feedback.mjs` 会拦 |
| 新增产物子目录时，`SERVABLE_DIRS`（`src/index.ts`）必须同步加一条 | 静态资源路由按**第一段路径**比对白名单，漏掉就 403。界面只表现为「图裂了」、不报错——转圈截帧的 `turn/` 就踩过 |
| 界面文案一律写 `T("中文原文")`，并往 `src/client.ts` 的词条表补英文 | 中文原文就是 key；漏翻不会报错，只是那一条一直是中文。`verify-i18n.mjs` 会拦 |
| **模块级**（工厂顶层）出现 `T()` 的文案表要同步加进 `staticTextRebuilders` | 模块顶层的 `T()` 在插件 load 时就求值了，那时 locale 服务还没挂上，此后永远停在中文。实测表现：切英文后方向名 / 模块页签不动。函数体内的 `T()` 不受影响 |
| 浏览器半区往宿主加字段时，`src/wire.ts` 里那条方法的 `payload:` schema 必须同步加 | typert 按声明的 schema 校验 payload，**schema 里没有的键会被静默丢掉**。实测：给 `getProject` 带上 `lang` 却没进 schema，宿主永远读到 `undefined`，表现是「切了英文提示词还是中文」且不报任何错 |
| 内置默认提示词（`src/directions.ts`）中英各一份，改一份必须改另一份 | 它会真的发给生图 / 视频模型，不是界面装饰。`verify-host.mjs` 的 5b 段按语言逐条比对两侧 |

---

## 构建与自检

```bash
npm run build        # tsc → lib/，并剥掉浏览器束结尾的 export
npm run typecheck    # 只做类型检查
```

纯本地自检（不联网、不花钱），改完代码**至少跑这几个**：

```bash
node scripts/verify-host.mjs       # 宿主全链路（317 项）
node scripts/verify-client.mjs     # 浏览器半区契约（324 项）
node scripts/verify-tools.mjs      # 对话调用面（123 项）
node scripts/verify-pipeline.mjs   # 抽帧 / 抠像 / 合成（40 项）
node scripts/verify-feedback.mjs   # 浏览器半区真渲染（119 项）
node scripts/verify-i18n.mjs       # 中英词条表契约（9 项）
node scripts/verify-tile.mjs       # 地图地块几何内核（121 项，含反向验证）
node scripts/verify-tile-pipeline.mjs  # 地图地块数据层与流水线（86 项）
node scripts/verify-tile-gateway.mjs   # 地图地块走真实网关（78 项：payload / 验收 / 作废边界 / 建筑 / 布局冻住 / 保存往返）
node scripts/verify-tile-client.mjs    # 地图地块界面真渲染（187 项，拦「遮罩没出现」「地图不显示」这类静默问题）
```

`scripts/find-missing-i18n.mjs` 不是断言脚本，是**工具**：列出所有还没进词条表的
`T("…")` 原文，直接输出可粘贴的条目。加了新界面文案时先跑它。

其余脚本（`verify-rig*.mjs`、`e2e-*.mjs` 等）的覆盖范围见 ENGINEERING.md 的「自检脚本」表。
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

下一次发布请**在表中追加一行**，写明版本、UTC 时间与内容。

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
  tarball 约 415 kB / 32 个文件。
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






