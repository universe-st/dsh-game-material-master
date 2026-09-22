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

---

## 构建与自检

```bash
npm run build        # tsc → lib/，并剥掉浏览器束结尾的 export
npm run typecheck    # 只做类型检查
```

纯本地自检（不联网、不花钱），改完代码**至少跑这几个**：

```bash
node scripts/verify-host.mjs       # 宿主全链路（237 项）
node scripts/verify-client.mjs     # 浏览器半区契约（211 项）
node scripts/verify-tools.mjs      # 对话调用面（93 项）
node scripts/verify-pipeline.mjs   # 抽帧 / 抠像 / 合成（30 项）
node scripts/verify-feedback.mjs   # 浏览器半区真渲染（87 项）
```

其余脚本（`verify-rig*.mjs`、`e2e-*.mjs` 等）的覆盖范围见 ENGINEERING.md 的「自检脚本」表。
`e2e-*.mjs` / `probe-redraw.mjs` 会**真实调 API 花钱**，不要顺手跑。

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
- **截图不进 npm tarball。** `files` 白名单只有 `lib` / `README.md` / `cordis.patch.yml`，
  `docs/` 不发布——这也是上一条必须用绝对 URL 的原因。tarball 约 341 kB / 31 个文件。
- **`npm publish` 不触发构建。** 忘了 `npm run build` 就会把旧的 `lib/` 发出去。
  第 0 步的 `git status` 检查就是防这个。

### README 截图怎么重拍

截图由 Playwright 对着真实运行的 DSH Web 界面拍摄，原图在 `docs/images/`，命名 `gmm-NN-<模块>-<阶段>.png`。
重拍时注意：

- 只截**插件面板**，不要把 DSH 侧栏 / 会话列表截进去：对 `.SPR_root` 做元素截图
  （设置页则裁到 `[role=dialog]` 的范围）。
- 深链接可以直接把界面切到目标页面：`http://127.0.0.1:<port>/?dsh-gmm=1&module=sprite&project=<id>&stage=videos`。
- **设置页截图必须处理 API Key 回显**（界面显示脱敏尾号），用局部模糊盖掉再入库。
