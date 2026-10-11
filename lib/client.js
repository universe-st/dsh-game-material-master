/**
 * dsh-game-material-master —— 浏览器半区。
 *
 * 两块界面：
 *   1. `sidebar.panellist` + `main`(key="gameStudio") —— 主体工作台，
 *      四个阶段的卡片式验收界面，每张图 / 每段视频 / 每组帧都能单独看、
 *      单独改提示词、单独重跑、单独打「通过」。
 *   2. `settings.section` —— API Key、模型与全局默认参数。
 *
 * 这份文件由宿主以 /plugins/dsh-game-material-master/client.js 直接提供给浏览器，
 * 因此必须是**不带 import/export 的经典脚本**，只能 require 外壳种子词。
 * 所有 React 元素都用 React.createElement 构造（没有 JSX 编译步骤）。
 */
window.__ModuleLoader__.load({
    id: "dsh-game-material-master",
    factory: (require) => {
        const bundleModule = { exports: {} };
        Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" });
        const React = require("react");
        const h = React.createElement;
        const PACKAGE = "dsh-game-material-master";
        const SERVICE = "gameStudio";
        /**
         * 工作台在 `main` 槽里的 key，也是侧栏 `sidebar.panellist` 的 id。
         * 深链接要切到的就是它（宿主 src/links.ts 的 PANEL_KEY 必须与它一致）。
         */
        const GAME_STUDIO_PANEL_ID = "gameStudio";
        // ── 多语言（中 / 英）──────────────────────────────────────────────────
        /**
         * 界面文案跟随 DSH 的语言设置（设置 → 通用 → 语言），切换即时生效。
         *
         * 词条表的 key 就是**源码里的中文原文**：浏览器半区是经典脚本（不能 import），
         * 800+ 条文案再维护一张人造 key 表只会多一层对不上号的风险。英文表里没有的
         * 条目原样返回中文——漏译只会「少翻一条」，不会在界面上露出 key。
         *
         * 插值用 `{n0}` 这类占位符（与 @deepseek-ai/dsh-client-locale 同一套规则），
         * 英文可以自由换语序：`T("第 {n0} 帧", { n0: 3 })`。
         */
        const I18N_NS = PACKAGE;
        /** 中文原文 → 英文译文。key 里可能带 `{nN}` 占位符。 */
        /* i18n-ignore-start */
        const EN = {
            "南 · 正对镜头": "South · facing the camera",
            "源图": "Source image",
            "北 · 背对镜头": "North · back to the camera",
            "南": "South",
            "西南 · 四分之三正面": "Southwest · three-quarter front",
            "东南 · 四分之三正面": "Southeast · three-quarter front",
            "西北 · 四分之三背面": "Northwest · three-quarter back",
            "北": "North",
            "东北 · 四分之三背面": "Northeast · three-quarter back",
            "西 · 左侧脸": "West · left profile",
            "东 · 右侧脸": "East · right profile",
            "功能还不完善：拆件质量取决于生图模型，自动装配与骨骼推导对真实立绘经常需要人工校正，导出的 Spine / DragonBones 产物也还没经足够的引擎侧验证。": "Not finished yet: part segmentation quality depends on the image model, auto placement and bone inference often need manual correction on real character art, and the exported Spine / DragonBones output has not been verified enough on the engine side.",
            "流程本身能走通（拆件 → 装配 → 骨骼 → 图集，每一步都有手工兜底），但请预期会出现需要反复调整的情况，暂时别把它当成稳定功能用。": "The pipeline itself does work (part segmentation → layout → bones → atlas, with a manual fallback at every step), but expect plenty of back-and-forth adjustment. For now, do not treat it as a stable feature.",
            "发现问题或有改进想法，欢迎到 GitHub 仓库一起开发。": "Found a problem or have an idea for improvement? Come build it with us in the GitHub repository.",
            "八方向图生成": "Eight-direction sheet",
            "一张设定图 → 8 方向 × 8 帧精灵图": "One character sheet → 8 directions × 8 frames sprite sheet",
            "图片生成": "Image generation",
            "按提示词出图，可带参考图，支持抠绿幕导出 PNG": "Generate images from a prompt, optionally with reference images, and export PNGs with chroma keying",
            "序列帧生成": "Sequence frames",
            "图/视频参考生成视频 → 抽帧 → 抠像 → 合成与播放预览": "Image/video reference → video → frame extraction → keying → compose and playback preview",
            "骨骼动画生成": "Skeletal animation",
            "拆件 → 装配定位 → 推骨骼与动画 → 打包 Spine 图集": "Part segmentation → layout → bone and animation inference → pack Spine atlas",
            "① 八方向绿幕图": "① Eight-direction chroma-key images",
            "以源图为基准，按依赖顺序生成八个方位的纯绿幕全身图": "Using the source image as the base, generate full-body images on a pure green screen for all eight directions, in dependency order",
            "② 行走动作视频": "② Walking animation videos",
            "固定镜头、固定背景，让角色朝原方位原地走三步": "Fixed camera, fixed background: the character walks three steps in place, facing its original direction",
            "③ 提取序列帧": "③ Extract sequence frames",
            "可整批等分抽帧，也可对每一段视频手动选帧": "Extract evenly spaced frames for the whole batch, or pick frames manually for each video",
            "④ 抠绿幕合成整图": "④ Chroma key and compose sheet",
            "剔除绿幕并按行序拼成一张精灵图": "Remove the green screen and stitch the frames into a single sprite sheet in row order",
            "⑤ 行走预览": "⑤ Walking preview",
            "用 WASD 或方向键操控角色，看看八方向接起来顺不顺": "Drive the character with WASD or the arrow keys and see how smoothly the eight directions connect",
            "未生成": "Not generated",
            "已通过": "Approved",
            "进行中": "Running",
            "失败": "Failed",
            "需重做": "Needs redo",
            "已完成": "Done",
            "跟随即「设置 → 游戏素材大师」": "Follows \"Settings → Game Material Master\"",
            "双击看大图": "Double-click to view full size",
            "关闭大图": "Close full size",
            "关闭（Esc）": "Close (Esc)",
            "处理中…": "Processing…",
            "正在生成…": "Generating…",
            "正在处理…": "Working…",
            "审核模式": "Review mode",
            "未设置（对话里会先问）": "Not set (the agent asks first in chat)",
            "自动审核": "Auto review",
            "每一步人工审核": "Manual review at every step",
            "每一步产出后 agent 会贴出验收链接并停下来等你确认": "After each step the agent posts an acceptance link and waits for your confirmation",
            "agent 自己检查每步产出后继续推进": "The agent checks each step's output itself and keeps going",
            "还没定：对话里 agent 会先问你要哪种": "Not decided yet: the agent asks which one you want in chat",
            "通过": "Approve",
            "远程服务尚未挂载完成，请稍候再试": "The remote service is not mounted yet. Please try again shortly.",
            "角色 {n0}": "Character {n0}",
            "已创建新项目": "New project created",
            "确定删除项目「{n0}」？项目目录会被整个移除，无法撤销。": "Delete project \"{n0}\"? The whole project directory is removed, and this cannot be undone.",
            "新的项目名": "New project name",
            "新项目的名字": "Name for the new project",
            "读取文件失败": "Failed to read file",
            "已上传源图：{n0}": "Source image uploaded: {n0}",
            "提示词已保存": "Prompt saved",
            "参数已保存": "Settings saved",
            "任务没有启动": "The task did not start",
            "正在挂载游戏素材大师…": "Mounting Game Material Master…",
            "游戏素材大师": "Game Material Master",
            "火山方舟 Seedream 生图 · MiniMax 图生视频 · 本地抠绿幕合成": "Volcengine Ark Seedream image gen · MiniMax image-to-video · local chroma keying and compositing",
            "刷新列表": "Refresh list",
            "重命名": "Rename",
            "删除项目": "Delete project",
            "新建项目": "New project",
            "实验性": "Experimental",
            "项目（{n0}）": "Projects ({n0})",
            "还没有项目，点右上角「新建项目」开始。": "No projects yet. Click \"New project\" in the top right to start.",
            "图 {n0}/8 · 视频 {n1}/8 · 帧 {n2}/8{n3}": "Images {n0}/8 · Videos {n1}/8 · Frames {n2}/8{n3}",
            " · 整图✓": " · Sheet ✓",
            "关闭": "Close",
            "正在载入…": "Loading…",
            "请选择或新建一个项目": "Select or create a project",
            "上传角色的原始设定图。第一步的正面绿幕图会以它为唯一参考。": "Upload the character's original sheet. The first stage's front chroma-key image uses it as its only reference.",
            "尚未上传源图": "No source image uploaded yet",
            "正在上传…": "Uploading…",
            "把图片拖到这里，或": "Drag the image here, or",
            "选择源图": "Choose source image",
            "更换源图": "Replace source image",
            "刷新状态": "Refresh status",
            "在访达中打开项目目录": "Open the project directory in Finder",
            "先生成一段「角色原地匀速转一整圈」的绿幕视频，再按时间截出八个方向的帧；下面时间轴上的八个圆圈就是各自的截帧位置，拖动即可改。": "First generate a chroma-key video of the character turning a full circle in place at a constant speed, then cut frames for the eight directions by time. The eight circles on the timeline below mark each direction's frame position; drag them to change it.",
            "转圈截帧": "Turn-frame capture",
            "先生成一段「原地匀速转一整圈」的视频，再按时间截出八个方向（默认，一致性最好）": "Generate one video of a full turn in place at a constant speed, then cut the eight directions from it by time (default, best consistency)",
            "逐方向生图": "Per-direction generation",
            "每个方向单独生图（备选：单张更清晰，但八个方向容易不一致）": "Generate each direction separately (alternative: each frame is sharper, but the eight directions easily drift apart)",
            "生成方式": "Generation mode",
            "默认": "Default",
            "正在切出「{n0}」第 {n1} 帧…": "Cutting frame {n1} for \"{n0}\"…",
            "整圈候选帧": "Full-turn candidate frames",
            "{n0}：第 {n1}/{n2} 帧（{n3} 秒）— 拖动改位置，←/→ 微调": "{n0}: frame {n1}/{n2} ({n3} s) — drag to reposition, ←/→ to nudge",
            "{n0} 第 {n1} 帧": "{n0} frame {n1}",
            "0 秒": "0 s",
            "共 {n0} 张候选帧 · 每张约 {n1} 秒 —— 拖动圆圈调整每个方向截在哪一帧": "{n0} candidate frames · about {n1} s each — drag a circle to choose which frame each direction uses",
            "还没有候选帧：先点「生成转圈视频」，视频到手会自动抽帧": "No candidate frames yet: click \"Generate turn video\" first, and frames are extracted automatically once the video is ready",
            "{n0} 秒": "{n0} s",
            "正在生成转圈视频…": "Generating turn video…",
            "正在抽取候选帧…": "Extracting candidate frames…",
            "正在抽取候选帧并切出八个方向…": "Extracting candidate frames and cutting the eight directions…",
            "先生成一段「角色原地匀速转一整圈」的视频（绿幕、保持原图风格、除旋转外不做任何动作），再按时间截出八个方向的帧。八个方向出自同一段视频，一致性比逐方向生图好得多；下面时间轴上的八个圆圈就是各自的截帧位置，随便拖。": "First generate a video of the character turning a full circle in place at a constant speed (chroma key, keeping the source style, no motion other than the rotation), then cut frames for the eight directions by time. All eight directions come from the same video, so consistency is far better than per-direction generation. The eight circles on the timeline below mark each direction's frame position — drag them freely.",
            "保存转圈提示词": "Save turn prompt",
            "转圈提示词已保存": "Turn prompt saved",
            "转圈提示词已重置为默认模板": "Turn prompt reset to the default template",
            "重置为默认": "Reset to default",
            "正在提交…": "Submitting…",
            "正在提交转圈视频任务…": "Submitting turn video job…",
            "生成转圈视频（计费一次）": "Generate turn video (charged once)",
            "转圈视频生成中…": "Generating turn video…",
            "重新生成转圈视频（计费一次）": "Regenerate turn video (charged once)",
            "正在抽帧…": "Extracting frames…",
            "重新抽帧（当前 {n0} 张）": "Re-extract frames (currently {n0})",
            "抽取候选帧": "Extract candidate frames",
            "候选帧数（8~64）": "Candidate frame count (8-64)",
            "已按 {n0} 张重抽候选帧": "Re-extracted {n0} candidate frames",
            "正在按 {n0} 张重抽候选帧…": "Re-extracting {n0} candidate frames…",
            "应用帧数": "Apply frame count",
            "当前 {n0} 张": "Currently {n0}",
            "未应用（当前 {n0} 张）": "Not applied (currently {n0})",
            "八个圆圈已回到默认等分位置": "The eight circles are back at their default evenly spaced positions",
            "重置八个圆圈": "Reset the eight circles",
            "转圈方向决定默认位置怎么排；拖动过的圆圈以你的位置为准": "The turn direction sets the default layout; circles you dragged keep your positions",
            "已改为顺时针并重排八个圆圈": "Switched to clockwise and rearranged the eight circles",
            "已改为逆时针并重排八个圆圈": "Switched to counter-clockwise and rearranged the eight circles",
            "转圈方向：逆时针（点一下换向）": "Turn direction: counter-clockwise (click to flip)",
            "转圈方向：顺时针（点一下换向）": "Turn direction: clockwise (click to flip)",
            "取消全部通过": "Clear all approvals",
            "全部标记通过": "Approve all",
            "还没有转圈视频：点上面的「生成转圈视频」": "No turn video yet: click \"Generate turn video\" above",
            "首帧用的是{n0}：{n1}": "First frame uses the {n0}: {n1}",
            "已生成的正面绿幕图": "generated front chroma-key image",
            "上传的源图": "uploaded source image",
            "候选帧已过期（转圈视频换过了）：点「重新抽帧」": "Candidate frames are out of date (the turn video changed): click \"Re-extract frames\"",
            "还没有候选帧": "No candidate frames yet",
            "正在切出这一帧…": "Cutting this frame…",
            "切帧中": "Cutting frames",
            "还没有这一方向的图": "No image for this direction yet",
            "第 {n0}/{n1} 帧 · {n2} 秒": "Frame {n0}/{n1} · {n2}s",
            "等待候选帧": "Waiting for candidate frames",
            "正在生成绿幕图…": "Generating chroma-key images…",
            "正在提交全部方向…": "Submitting all directions…",
            "一键生成全部（跳过已通过的）": "Generate all (skips approved)",
            "正在提交全部重做…": "Submitting full regeneration…",
            "全部重新生成": "Regenerate all",
            "正在重置…": "Resetting…",
            "把八个方向的生图提示词和视频提示词都重置为当前默认模板？你手改过的内容会丢失。": "Reset the image and video prompts for all eight directions to the current default templates? Any manual edits you made will be lost.",
            "提示词已重置为默认模板": "Prompts reset to the default templates",
            "正在重置提示词…": "Resetting prompts…",
            "重置提示词为默认": "Reset prompts to default",
            "请先上传源图": "Upload a source image first",
            "生成中": "Generating",
            "参考：{n0}": "Reference: {n0}",
            "用时 {n0} 秒 · {n1}": "Took {n0}s · {n1}",
            "收起提示词 ▲": "Collapse prompt ▲",
            "编辑提示词 ▼": "Edit prompt ▼",
            "保存改动": "Save changes",
            "已保存": "Saved",
            "正在用这段提示词生成「{n0}」…": "Generating \"{n0}\" with this prompt…",
            "用这段提示词生成": "Generate with this prompt",
            "正在生成「{n0}」…": "Generating \"{n0}\"…",
            "生成": "Generate",
            "重新生成": "Regenerate",
            "正在提交 8 个方向的视频任务…": "Submitting video jobs for all 8 directions…",
            "提示词要求「固定镜头、固定背景、原地走三步」。Hailuo 一段通常要 1~6 分钟，提交后可以离开这个页面。": "The prompt asks for \"fixed camera, fixed background, three steps in place\". A Hailuo clip usually takes 1-6 minutes, so you can leave this page after submitting.",
            "保存视频提示词": "Save video prompt",
            "视频提示词已保存": "Video prompt saved",
            "正在提交 8 个方向…": "Submitting all 8 directions…",
            "生成全部视频（{n0}/8 张绿幕图就绪）": "Generate all videos ({n0}/8 chroma-key images ready)",
            "正在查询…": "Checking…",
            "正在查询远端视频进度…": "Checking remote video progress…",
            "立即刷新进度": "Refresh progress now",
            "清空所有视频与已抽的帧？绿幕图会保留。": "Clear all videos and extracted frames? Chroma-key images are kept.",
            "已清空视频与序列帧": "Videos and sequence frames cleared",
            "清空视频重来": "Clear videos and start over",
            "{n0} 个任务进行中，界面会自动刷新": "{n0} jobs running, the view refreshes automatically",
            "正在生成视频…": "Generating video…",
            "还没有绿幕图": "No chroma-key image yet",
            "远端状态：{n0}": "Remote status: {n0}",
            "正在生成「{n0}」视频…": "Generating \"{n0}\" video…",
            "生成视频": "Generate video",
            "正在切出第 {n0} 帧…": "Cutting frame {n0}…",
            "候选帧": "Candidate frames",
            "第 {n0} 帧：候选第 {n1}/{n2}（{n3} 秒）— 拖动改位置，←/→ 微调": "Frame {n0}: candidate {n1}/{n2} ({n3}s) - drag to move, ←/→ to nudge",
            "第 {n0} 帧，候选第 {n1}": "Frame {n0}, candidate {n1}",
            "共 {n0} 张候选帧 · {n1} 个圆圈 —— 拖动圆圈决定每一张输出帧截在哪": "{n0} candidate frames · {n1} circles - drag a circle to set where each output frame is cut",
            "手动选帧 · {n0}": "Manual frame picking · {n0}",
            "只影响这一段视频。圆圈个数跟「每段视频抽帧数」走，拖到哪一格就截哪一格。": "Affects only this video clip. The number of circles follows \"frames per video\", and each circle cuts the cell you drop it on.",
            "正在抽候选帧…": "Extracting candidate frames…",
            "已按 {n0} 张候选帧重抽「{n1}」": "Re-extracted {n0} candidate frames for \"{n1}\"",
            "正在抽取「{n0}」的候选帧…": "Extracting candidate frames for \"{n0}\"…",
            "重新抽取候选帧": "Re-extract candidate frames",
            "圆圈已回到等分位置": "Circles are back at their evenly spaced positions",
            "正在重置「{n0}」的选帧…": "Resetting frame picks for \"{n0}\"…",
            "重置为等分": "Reset to even spacing",
            "正在抽取全部序列帧…": "Extracting all sequence frames…",
            "单格宽（px）": "Cell width (px)",
            "单格高（px）": "Cell height (px)",
            "每段视频抽帧数": "Frames per video",
            "抽帧工作尺寸（长边 px）": "Frame extraction working size (long edge, px)",
            "并发数": "Concurrency",
            "抽帧抽到的是「工作尺寸」（长边上限），不是最终格子尺寸。自动裁剪、统一缩放和像素量化都在第 4 步做，这样八个方向才能共享同一个裁剪框、脚底对齐同一条基线。改完这里需要重新抽帧。": "Frame extraction produces the \"working size\" (a long-edge cap), not the final cell size. Auto-crop, uniform scaling, and quantization all happen in step 4, so the eight directions share one crop box and land on the same foot baseline. Changing anything here means you must extract frames again.",
            "「提取全部」对每一段视频用同一套等分；要某一段单独挑帧，点那张卡片上的「手动选帧」，拖圆圈即可（和转圈截帧一样）。": "\"Extract all\" uses the same even spacing for every video; to pick frames for one clip on its own, click \"Manual frame picking\" on that card and drag the circles (same as turn-frame capture).",
            "预览带是**双击看大图**：格子尺寸只有 256px，看不清动作和抠像质量。": "**Double-click the preview strip to view it larger**: at only 256px per cell you cannot judge motion or keying quality.",
            "提取全部序列帧（{n0}/8 段视频就绪）": "Extract all sequence frames ({n0}/8 videos ready)",
            "正在抽取序列帧…": "Extracting sequence frames…",
            "抽帧中": "Extracting frames",
            "{n0} 序列帧": "{n0} sequence frames",
            "{n0} · {n1} 帧 · 视频 {n2} 秒（点「×」/ 背景 / Esc 关闭）": "{n0} · {n1} frames · {n2}s video (click \"×\" / the backdrop / Esc to close)",
            "尚未抽帧": "Not extracted yet",
            "{n0} 帧 · 视频 {n1} 秒": "{n0} frames · {n1}s video",
            "手动选帧 · {n0} 个圆圈 / {n1} 张候选": "Manual frame picking · {n0} circles / {n1} candidates",
            "正在抽取「{n0}」序列帧…": "Extracting \"{n0}\" sequence frames…",
            "重新抽帧": "Re-extract frames",
            "抽取": "Extract",
            "收起选帧": "Hide frame picker",
            "调整选帧": "Adjust frame pick",
            "手动选帧": "Pick frames manually",
            "正在抠绿幕并合成整图…": "Keying green screen and composing sheet…",
            "抠像在这里会**再跑一次**：第 3 步那次抠的是每个方向的预览带（顺便把整图合出来），这里重抠是为了让下面这些参数改完立刻生效——两次读的是同一份帧缓存（raw.bin）、同一套参数，所以结果一致。": "Keying runs **one more time** here: step 3 keyed the preview strip for each direction (and composed the sheet along the way), while re-keying here makes the parameters below take effect the moment you change them. Both passes read the same frame cache (raw.bin) with the same settings, so the results always match.",
            "改完参数会自动重新抠像并合成整图，不需要重新抽帧。": "Changing the parameters re-keys and recomposes the sheet automatically, with no need to re-extract frames.",
            "整图单格宽（px）": "Sheet cell width (px)",
            "整图单格高（px）": "Sheet cell height (px)",
            "像素块边长（0/1 = 关闭）": "Pixel block size (0/1 = off)",
            "背景分割容差（0 = 只认绿色）": "Background split tolerance (0 = green only)",
            "抠像下限（绿色优势）": "Key low (green dominance)",
            "抠像上限（绿色优势）": "Key high (green dominance)",
            "去绿溢出 0~1": "Despill green 0~1",
            "边缘收缩（px）": "Edge shrink (px)",
            "自动裁剪填充比例 0.5~1": "Auto-crop fill ratio 0.5~1",
            "底部留白（px）": "Bottom padding (px)",
            "自动裁剪到角色包围盒": "Auto-crop to the character's bounding box",
            "开启（推荐：角色填满格子，八个方向缩放一致）": "On (recommended: the character fills the cell and all eight directions share one scale)",
            "关闭（用整帧画面）": "Off (use the full frame)",
            "正在保存并合成…": "Saving and composing…",
            "正在保存并重新合成…": "Saving and recomposing…",
            "保存并重新合成": "Save and recompose",
            "正在重跑抠像…": "Re-keying…",
            "正在重跑抠像并重新合成…": "Re-keying and recomposing…",
            "只重跑抠像并重新合成": "Re-key and recompose only",
            "正在合成整图…": "Composing sheet…",
            "合成整图（{n0}/8 组帧就绪）": "Compose sheet ({n0}/8 frame sets ready)",
            "下载整图": "Download sheet",
            "整图已通过": "Sheet approved",
            "整图通过": "Approve sheet",
            "行序（第 1 行在最上方）": "Row order (row 1 at the top)",
            "输出 {n0}×{n1} 像素 · 单格 {n2}×{n3} · 每行 {n4} 帧": "Output {n0}×{n1} px · cell {n2}×{n3} · {n4} frames per row",
            " · 抠掉的背景占 {n0}%": " · keyed background is {n0}%",
            " · 边框采样排除了 {n0} 个不属于背景主色的点（角色贴边）": " · border sampling excluded {n0} points that are not the dominant background color (character touching the edge)",
            "整图": "Sheet",
            "整图 {n0}×{n1} · 单格 {n2}×{n3}（点「×」/ 背景 / Esc 关闭）": "Sheet {n0}×{n1} · cell {n2}×{n3} (click \"×\" / the background / Esc to close)",
            "本地抠像 + 合成，不上传": "Local keying + compositing, nothing uploaded",
            "正在生成第一张整图…": "Generating the first sheet…",
            "请先完成第 3 步的抽帧": "Finish frame extraction in step 3 first",
            "还没有合成整图": "No sheet composed yet",
            "正在重新合成整图…": "Recomposing sheet…",
            "还没有可播放的整图。先完成第 ④ 步合成，再回到这里用 WASD 走一走。": "No sheet to play yet. Finish composing in step ④, then come back here and walk around with WASD.",
            "角色缩放倍率": "Character scale",
            "移动速度（像素/秒）": "Movement speed (px/s)",
            "播放速度（倍，只影响步频）": "Playback speed (×, step rate only)",
            "背景参考网格": "Background reference grid",
            "显示（更容易看出在移动）": "Show (motion is easier to see)",
            "关闭（纯白）": "Off (pure white)",
            "回到中间": "Recenter",
            "当前朝向：{n0}（{n1}） · {n2}": "Facing: {n0} ({n1}) · {n2}",
            "行走中": "Walking",
            "站立": "Standing",
            "· 整图是按旧行序生成的，正在重新合成…": "· The sheet was built with the old row order; recomposing…",
            "已获得键盘焦点": "Keyboard focus acquired",
            "点击画面后即可操控": "Click the canvas to take control",
            "点击这里，然后用 WASD 或 ↑↓←→ 操控角色": "Click here, then steer the character with WASD or ↑↓←→",
            "正在载入整图…": "Loading sheet…",
            "行走": "Walk",
            "方向按屏幕方位映射：按 ↑ 向北走（背对镜头）、↓ 向南走（正对镜头）、← 向西、→ 向东；斜向同时按两个键。": "Directions map to screen positions: ↑ walks north (back to camera), ↓ walks south (facing camera), ← walks west, → walks east; hold two keys at once for diagonals.",
            "「播放速度」只改步频快慢，不影响角色移动速度；「移动速度」只改走得多快，不影响动画帧率。切图用的是整图自己记录的行序，所以改完行序即使还没重新合成，预览也不会取错方向。": "\"Playback speed\" only changes how fast the steps cycle and does not affect how fast the character moves; \"Movement speed\" only changes how fast it walks and does not affect the animation frame rate. Frame switching uses the row order recorded in the sheet itself, so even if you change the row order before recomposing, the preview still picks the right direction.",
            "选择文件": "Choose file",
            "{n0}（{n1}）": "{n0} ({n1})",
            "还没有内容，点右上角新建一个。": "Nothing here yet. Click New in the top right to create one.",
            "新建": "New",
            "图片 {n0}": "Image {n0}",
            "已新建图片任务": "Image task created",
            "正在新建任务…": "Creating task…",
            "删除任务「{n0}」？目录会被整个移除。": "Delete task \"{n0}\"? Its whole folder will be removed.",
            "已删除": "Deleted",
            "正在上传 {n0} 个文件…": "Uploading {n0} files…",
            "图片任务": "Image tasks",
            "{n0} 张 · 抠像 {n1}": "{n0} images · {n1} keyed",
            "正在新建…": "Creating…",
            "新建任务": "New task",
            "删除任务": "Delete task",
            "正在调用接口…": "Calling the API…",
            "请选择或新建一个图片任务": "Select or create an image task",
            "① 提示词": "① Prompt",
            "统一附加提示词会接在主提示词后面，用来写跨批次的共同要求。": "The shared suffix prompt is appended after the main prompt, for requirements that apply across batches.",
            "描述你要生成的图片…": "Describe the image you want to generate…",
            "统一附加提示词（可留空）": "Shared suffix prompt (optional)",
            "生图模型": "Image model",
            "尺寸": "Size",
            "生成张数（1~8）": "Images to generate (1~8)",
            "正在生成 {n0} 张…": "Generating {n0} images…",
            "已开始生成 {n0} 张": "Started generating {n0} images",
            "正在生成 {n0} 张图片…": "Generating {n0} images…",
            "生成 {n0} 张": "Generate {n0}",
            "按 Seedream 刊例约 0.2 元/张，实际以方舟账单为准": "About ¥0.2 per image at Seedream list price; your Volcengine Ark bill is authoritative",
            "② 参考图（可留空）": "② Reference images (optional)",
            "最多 10 张。有参考图时走图生图；引用多张时可在提示词里写「图一」「图二」。": "Up to 10. With reference images it runs image-to-image; to cite several, write \"image 1\" and \"image 2\" in the prompt.",
            "把参考图拖到这里": "Drag reference images here",
            "已移除参考图": "Reference image removed",
            "移除": "Remove",
            "③ 绿幕抠图": "③ Green screen keying",
            "开启后每张生成完会自动抠一遍；也可以上传已有图片只做抠像。": "When on, each image is keyed automatically after it is generated; you can also upload existing images to key them only.",
            "不抠像": "No keying",
            "自动抠绿幕输出 PNG": "Auto-key green screen, output PNG",
            "正在抠像…": "Keying…",
            "已开始抠像": "Keying started",
            "正在抠绿幕…": "Keying green screen…",
            "按当前参数重新抠像": "Re-key with current settings",
            "上传一张已有图片，直接抠成透明 PNG": "Upload an existing image to key straight to a transparent PNG",
            "④ 结果（{n0} 张）": "④ Results ({n0} images)",
            "还没有图片": "No images yet",
            "第 {n0} 张": "Image {n0}",
            "上传": "Upload",
            "抠像结果": "Keying result",
            "生成结果": "Generation result",
            "生成中…": "Generating…",
            "等待生成": "Waiting to generate",
            "背景占比 {n0}%": "Background {n0}%",
            "已取消通过": "Approval removed",
            "已标记通过": "Marked as approved",
            "下载 PNG": "Download PNG",
            "下载原图": "Download original",
            "已重新生成": "Regenerated",
            "正在重新生成第 {n0} 张…": "Regenerating image {n0}…",
            "删除": "Delete",
            "序列帧 {n0}": "Sequence frames {n0}",
            "已新建序列帧任务": "Sequence frames job created",
            "视频生成中…（H3 通常 1~6 分钟，可以离开本页）": "Generating video… (H3 usually takes 1-6 minutes; you can leave this page)",
            "正在抠像并合成条图…": "Keying and composing strip…",
            "序列帧任务": "Sequence frames jobs",
            "{n0} {n1} {n2}": "{n0} {n1} {n2}",
            "视频✓": "Video✓",
            "视频·": "Video·",
            "帧✓": "Frames✓",
            "帧·": "Frames·",
            "合成✓": "Compose✓",
            "合成·": "Compose·",
            "请选择或新建一个序列帧任务": "Select or create a sequence frames job",
            "① 视频输入": "① Video input",
            "平台规定两种模式互斥：首尾帧模式以一张图作为起始画面；多模态参考模式用参考图+参考视频来约束风格与动作。": "The platform does not allow these two modes at once: first/last frame mode uses one image as the opening frame; multimodal reference mode uses reference images plus reference videos to constrain style and motion.",
            "首尾帧模式（上传首帧图）": "First/last frame mode (upload a first frame)",
            "多模态参考模式（参考图 / 参考视频）": "Multimodal reference mode (reference images / reference videos)",
            "首帧图（必填）": "First frame (required)",
            "尾帧图（选填）": "Last frame (optional)",
            "把首帧图拖到这里": "Drag the first frame here",
            "参考图（{n0}/9）": "Reference images ({n0}/9)",
            "已移除": "Removed",
            "参考视频（{n0}/3，每段 2~15 秒，单文件 ≤ 40MB）": "Reference videos ({n0}/3, 2-15 s each, ≤ 40MB per file)",
            "移除 {n0}": "Remove {n0}",
            "把参考视频拖到这里": "Drag reference videos here",
            "② 提示词与参数": "② Prompt and parameters",
            "视频模型": "Video model",
            "时长（秒，{n0}~{n1}）": "Duration (s, {n0}-{n1})",
            "分辨率": "Resolution",
            "正在提交视频任务…": "Submitting video job…",
            "已提交视频任务，可离开本页": "Video job submitted; you can leave this page",
            "重新生成视频": "Regenerate video",
            "正在查询远端进度…": "Checking remote progress…",
            "已清空视频与帧": "Video and frames cleared",
            "H3 768P 按 0.5 元/秒刊例计费": "H3 768P is billed at the list price of ¥0.5/second",
            "状态：{n0} {n1} {n2}": "Status: {n0} {n1} {n2}",
            "③ 序列帧提取": "③ Sequence frame extraction",
            "提取张数": "Frames to extract",
            "已开始抽帧": "Frame extraction started",
            "按当前张数抽帧（{n0} 张）": "Extract with the current count ({n0} frames)",
            "参数已变，需重抽": "Parameters changed; extract again",
            "视频时长 {n0} 秒 · {n1} 帧": "Video duration {n0} s · {n1} frames",
            "④ 绿幕抠像与合成": "④ Chroma keying and composition",
            "正在重新抠像…": "Re-keying…",
            "已开始重新抠像": "Re-keying started",
            "重新抠像": "Re-key",
            "正在合成条图…": "Composing strip…",
            "已合成": "Composed",
            "正在合成横向条图…": "Composing horizontal strip…",
            "合成横向条图": "Compose horizontal strip",
            "下载条图": "Download strip",
            "正在处理序列帧…": "Processing sequence frames…",
            "还没有序列帧": "No sequence frames yet",
            "序列帧条图": "Sequence frames strip",
            "第 {n0} 帧": "Frame {n0}",
            "第 {n0} / {n1} 帧（点「×」/ 背景 / Esc 关闭）": "Frame {n0} / {n1} (click \"×\" / the backdrop / Esc to close)",
            "⑤ 验收": "⑤ Acceptance",
            "三步各自打「通过」。对话里的 agent 读写同一份标记：选「每一步人工审核」时，它会等你通过才继续。": "Approve each of the three steps. The agent in the conversation reads and writes the same flags: with \"manual review at every step\" selected, it waits for your approval before continuing.",
            "① 生成视频": "① Generate video",
            "② 抽帧 + 抠像": "② Frame extraction + keying",
            "③ 横向条图": "③ Horizontal strip",
            "未上传": "Not uploaded",
            "播放帧率（fps）": "Playback frame rate (fps)",
            "预览缩放": "Preview zoom",
            "播放": "Play",
            "播放中": "Playing",
            "暂停": "Pause",
            "已载入 {n0}/{n1} 帧。这是抠像后的帧按顺序循环播放的效果，用来判断动作连贯性和抠像边缘是否稳定。": "Loaded {n0}/{n1} frames. This loops the keyed frames in order so you can judge motion continuity and whether the keyed edges are stable.",
            "{n0} → {n1}": "{n0} → {n1}",
            "运行日志（{n0} 条{n1}）": "Run log ({n0} entries{n1})",
            " · {n0} 错误": " · {n0} errors",
            " · {n0} 警告": " · {n0} warnings",
            "全部": "All",
            "警告+（{n0}）": "Warning+ ({n0})",
            "错误（{n0}）": "Errors ({n0})",
            "搜关键字…": "Search keywords…",
            "当前筛选下没有日志。": "No log entries match the current filter.",
            "（{n0}）": "({n0})",
            "运行日志": "Run log",
            "头部": "Head",
            "脖子": "Neck",
            "躯干": "Torso",
            "胯部": "Hips",
            "上臂": "Upper arm",
            "小臂": "Forearm",
            "手": "Hand",
            "大腿": "Thigh",
            "小腿": "Calf",
            "脚": "Foot",
            "头发": "Hair",
            "衣料": "Cloth",
            "配饰": "Accessory",
            "武器": "Weapon",
            "① 拆件": "① Part segmentation",
            "生图模型把角色拆成独立部件（这一步花钱，只跑一次；也可以直接上传部件 PNG）": "The image model splits the character into separate parts (this step is charged and runs once; you can also upload part PNGs directly)",
            "② 装配定位": "② Layout and placement",
            "把部件摆回参考姿态；本地计算，免费，可以逐件重跑或手工拖动": "Puts the parts back into the reference pose; local computation, free, and you can rerun it part by part or drag manually",
            "③ 骨骼与动画": "③ Bones and animation",
            "自动推骨骼层级 + 待机/行走/奔跑/挥手/跳跃/攻击，直接播放验收": "Infers the bone hierarchy + idle/walk/run/wave/jump/attack, play it right here for acceptance",
            "④ 图集": "④ Atlas",
            "打包成 Spine 纹理图集（.png + .atlas），可直接导入引擎": "Packs a Spine texture atlas (.png + .atlas) that imports straight into your engine",
            "正在刷新…": "Refreshing…",
            "正在拆件生图…": "Generating part segmentation…",
            "正在分割部件…": "Splitting parts…",
            "正在装配定位…": "Placing parts…",
            "正在生成骨骼…": "Generating bones…",
            "正在打包图集…": "Packing atlas…",
            "正在重绘部件…": "Redrawing part…",
            "正在创建任务…": "Creating job…",
            " · 已定位": " · Placed",
            " · 未定位": " · Not placed",
            " · 相似度 {n0}": " · Similarity {n0}",
            " · 手工调整": " · Manually adjusted",
            "自动定位没找到，请手工拖到正确位置": "Auto placement did not find it — drag it to the right position manually",
            "相似度偏低，建议核对或拖一下": "Low similarity — check it or drag it a little",
            "选中": "Select",
            "重新定位": "Reposition",
            "改名": "Rename",
            "取消隐藏": "Unhide",
            "隐藏": "Hide",
            "已更新「{n0}」的语义": "Updated semantics for \"{n0}\"",
            "语义校验失败": "Semantics validation failed",
            "{n0}{n1}": "{n0}{n1}",
            "近端": "proximal",
            "远端": "distal",
            "语义（角色 / 父级 / 锚点）：决定骨骼挂在谁身上、骨骼从部件的哪一端伸到哪一端。改这里不会动②里已经摆好的位置，只会重算③骨骼。": "Semantics (role / parent / anchors): decides which bone each part hangs from and which end of the part the bone runs to. Changing this leaves the placements you already made in ② alone and only recomputes ③ bones.",
            "语义有 {n0} 处错误：": "Semantics has {n0} errors: ",
            "{n0} {n1}": "{n0} {n1}",
            "整体": "Overall",
            "；": "; ",
            "提示：": "Note: ",
            "语义已就绪，无结构问题。": "Semantics is ready, with no structural problems.",
            "还没有可用部件。": "No usable parts yet.",
            "部件": "Part",
            "角色": "Role",
            "父级": "Parent",
            "近端锚点": "Proximal anchor",
            "远端锚点": "Distal anchor",
            "来源": "Source",
            "（挂 root）": "(attach to root)",
            "人工": "Manual",
            "还没有骨骼。先点上面的「生成骨骼与动画」——生成之后这里可以逐根微调。": "No bones yet. Click \"Generate bones and animation\" above first — after that you can fine-tune each bone here.",
            "已调整「{n0}」": "Adjusted \"{n0}\"",
            "骨骼手工偏移（{n0}）": "Manual bone offsets ({n0})",
            "已调 {n0} 根": "{n0} bone(s) adjusted",
            "未调整": "Not adjusted",
            "这里调的是「你相对绑定姿势改了多少」，不会被重新推骨骼覆盖。位移单位是参考图像素，旋转是度。全零即视为未调整。": "What you change here is how far you moved away from the binding pose, and rerunning bone inference will not overwrite it. Translation is in reference-image pixels and rotation is in degrees. All zeros counts as not adjusted.",
            "骨骼": "Bone",
            "绑定姿势": "Binding pose",
            "手工位移 x": "Manual x offset",
            "手工位移 y": "Manual y offset",
            "手工旋转": "Manual rotation",
            "已清除「{n0}」的手工偏移": "Cleared the manual offset for \"{n0}\"",
            "清除": "Clear",
            "清除中…": "Clearing…",
            "已清除全部手工骨骼偏移": "Cleared all manual bone offsets",
            "清除全部手工偏移（{n0} 根）": "Clear all manual offsets ({n0} bones)",
            "已调整「{n0}」的动画参数": "Adjusted the animation settings for \"{n0}\"",
            "动画参数（{n0}）": "Animation settings ({n0})",
            "已调 {n0} 个": "{n0} adjusted",
            "全部为预设默认值": "All at preset defaults",
            "幅度统一缩放旋转与位移（1 = 预设原样）；时长是一个循环的秒数。改完点上面的「生成骨骼与动画」重算。": "Amplitude scales rotation and translation together (1 = preset unchanged); duration is the length of one loop in seconds. When you are done, click \"Generate bones and animation\" above to recompute.",
            "动作": "Action",
            "时长（秒）": "Duration (s)",
            "幅度": "Amplitude",
            "状态": "Status",
            "会生成": "Will be generated",
            "未勾选": "Not selected",
            " · 预设 {n0}s": " · Preset {n0}s",
            "已重置「{n0}」": "Reset \"{n0}\"",
            "重置": "Reset",
            "重置中…": "Resetting…",
            "已重置全部动画参数": "Reset all animation settings",
            "重置全部（{n0} 个）": "Reset all ({n0})",
            "旋转": "Rotation",
            "位移": "Translation",
            "缩放": "Scale",
            "线性": "Linear",
            "阶跃": "Stepped",
            "已在「{n0}/{n1}」加了一帧": "Added a frame to \"{n0}/{n1}\"",
            "已删除「{n0}/{n1}」的第 {n2} 帧": "Deleted frame {n2} of \"{n0}/{n1}\"",
            "已为「{n0}」加一条{n1}轨道": "Added a {n1} track to \"{n0}\"",
            "已删除「{n0}/{n1}」轨道": "Deleted the \"{n0}/{n1}\" track",
            "已移动「{n0}/{n1}」的关键帧": "Moved the keyframe in \"{n0}/{n1}\"",
            "时间轴与关键帧": "Timeline and keyframes",
            "选一台动画后可以加/删/拖关键帧、改数值与缓动。提交后这台动画就以这份数据为准（参数滑杆不再影响它），": "After you pick an animation you can add/delete/drag keyframes and edit values and easing. Once submitted, this animation follows this data (the settings sliders no longer affect it), ",
            "「还原」可以退回预设。": "and \"Restore\" takes it back to the preset.",
            " ·已改": " · Edited",
            "读取中…": "Loading…",
            "选择一台动画开始编辑。": "Pick an animation to start editing.",
            "循环时长（秒）": "Loop duration (s)",
            "已把「{n0}」的时长改为 {n1}s": "Changed the duration of \"{n0}\" to {n1}s",
            "已设为不循环": "Set to play once",
            "已设为循环": "Set to loop",
            "循环": "Loop",
            "一次性": "Play once",
            "已改为手工数据": "Switched to manual data",
            "预设（改动后转为数据）": "Preset (becomes data once changed)",
            "已还原「{n0}」到预设": "Restored \"{n0}\" to the preset",
            "还原到预设": "Restore to preset",
            "这台动画在当前部件集下没有任何轨道（预设依赖的骨骼都不存在）。": "This animation has no tracks with the current part set (none of the bones the preset relies on are present).",
            "删除这条轨道": "Delete this track",
            "点一个关键帧来改它；在轨道空白处**双击**加一帧。首帧（0 秒）不能删——它是每条轨道的锚。": "Click a keyframe to edit it; **double-click** an empty spot on the track to add a frame. The first frame (0 s) cannot be deleted — it is the anchor of every track.",
            "{n0} · {n1} · 第 {n2} 帧": "{n0} · {n1} · Frame {n2}",
            "时间(s)": "Time (s)",
            "已改「{n0}」的关键帧时间": "Changed the keyframe time of \"{n0}\"",
            "角度": "Angle",
            "已改「{n0}/{n1}」的{n2}": "Changed {n2} of \"{n0}/{n1}\"",
            "缓动": "Easing",
            "已把「{n0}」的缓动改为 {n1}": "Changed easing of \"{n0}\" to {n1}",
            "删除这一帧": "Delete this frame",
            "首帧是轨道锚点，不能删": "The first frame is the track anchor and cannot be deleted",
            "每条轨道至少留两帧": "Each track needs at least two frames",
            "加轨道": "Add track",
            "改完自动重算预览：开": "Auto-rebuild preview after edits: On",
            "改完自动重算预览：关": "Auto-rebuild preview after edits: Off",
            "重新读取": "Reload",
            "重算是本地计算，免费": "Rebuilding is local computation and is free",
            "拆件质检": "Segmentation QA",
            "可信度 {n0}%": "Confidence {n0}%",
            "不可信（{n0}%）": "Not reliable ({n0}%)",
            "没有发现重复件，装配相似度也在正常范围。": "No duplicate parts found, and layout similarity is within the normal range.",
            "质检中…": "Checking…",
            "已重跑拆件质检": "Segmentation QA re-run",
            "重新质检": "Re-run QA",
            "参考图里大约几个部位": "Roughly how many parts in the reference image",
            "看图填，可留空": "Fill in from the image; optional",
            "已按「{n0} 个部位」重新质检": "Re-ran QA with \"{n0} parts\"",
            "填了它就能判断「部件数是不是多出来了」——多出来的多半是重复件": "With this filled in, it can tell whether the part count is too high — extras are usually duplicates",
            "IK 约束（{n0}）": "IK constraints ({n0})",
            "{n0} 条": "{n0}",
            "无": "None",
            "把一条骨骼链约束到一个**可拖的目标点**：在下面的预览里拖那个青色菱形，手就跟着走。": "Constrain a bone chain to a **draggable target point**: drag the cyan diamond in the preview below and the hand follows.",
            "链长 1 = 末端骨 + 它的父级（两骨余弦定理）；权重小于 1 是软 IK。": "Chain length 1 = the end bone plus its parent (two-bone law of cosines); a weight below 1 gives soft IK.",
            "名称": "Name",
            "链末端骨骼": "Chain end bone",
            "目标点": "Target point",
            "链长": "Chain length",
            "弯曲": "Bend",
            "权重": "Weight",
            "已改「{n0}」的链长": "Changed chain length of \"{n0}\"",
            "已切换弯曲方向": "Bend direction switched",
            "正向": "Positive",
            "反向": "Negative",
            "已把「{n0}」的权重改为 {n1}": "Changed weight of \"{n0}\" to {n1}",
            "已删除约束「{n0}」": "Deleted constraint \"{n0}\"",
            "加约束": "Add constraint",
            "已为「{n0}」加 IK 约束": "Added an IK constraint for \"{n0}\"",
            "加到这条链上": "Add to this chain",
            "目标点会自动补一根骨骼，位置就在链末端": "A bone is added automatically for the target point, at the end of the chain",
            "已清空全部 IK 约束": "All IK constraints cleared",
            "清空全部": "Clear all",
            "已更新「{n0}」的网格": "Updated the mesh of \"{n0}\"",
            "蒙皮网格（{n0}）": "Skinned meshes ({n0})",
            "{n0} 个部件已细分": "{n0} parts subdivided",
            "把部件切成网格之后就能对顶点做 FFD 变形——裙摆、披风、长发这类「上缘不动、下缘甩出去」": "Once a part is cut into a mesh you can apply FFD deformation to its vertices — for skirts, capes, and long hair, where the top edge stays put and the bottom swings out",
            "用刚体骨骼是动不出来的。网格是规则三角化，密度越高越软，预览也越吃性能。": "Rigid bones cannot produce that motion. The mesh is a regular triangulation: the denser it is, the softer it looks, and the more the preview costs in performance.",
            "列=行": "Cols=Rows",
            "摆幅": "Amplitude",
            "循环(s)": "Loop (s)",
            "固定端": "Fixed end",
            "加飘动": "Add sway",
            "上缘": "Top edge",
            "下缘": "Bottom edge",
            "已取消「{n0}」的网格": "Mesh removed from \"{n0}\"",
            "取消": "Remove",
            "加网格": "Add mesh",
            "细分这个部件": "Subdivide this part",
            "给裙摆加飘动": "Add sway to the skirt",
            "网格与变形都是本地计算，免费": "Meshes and deformation are computed locally and are free",
            "已清除全部网格与变形": "All meshes and deformation cleared",
            "Path 约束（{n0}）": "Path constraints ({n0})",
            "把一串骨骼沿折线按弧长铺开——尾巴、辫子这类「长度远超单根骨」的部件用它。": "Spread a chain of bones along a polyline by arc length — use this for parts like tails and braids, whose length far exceeds a single bone.",
            "间距 0 表示均匀铺满整条路径；大于 0 就是固定间距，骨骼只覆盖路径的一段。": "Spacing 0 spreads the bones evenly across the whole path; a value above 0 uses a fixed spacing, so the bones cover only part of the path.",
            "骨链": "Bone chain",
            "间距": "Spacing",
            "旋转混合": "Rotate mix",
            "已改「{n0}」的间距": "Changed spacing of \"{n0}\"",
            "已改「{n0}」的旋转混合": "Changed rotate mix of \"{n0}\"",
            "已删除路径「{n0}」": "Deleted path \"{n0}\"",
            "加路径": "Add path",
            "已沿「{n0}」加路径": "Added a path along \"{n0}\"",
            "沿这条链加路径": "Add a path along this chain",
            "默认路径沿这些部件的近端锚点生成": "The default path is generated along the proximal anchors of these parts",
            "已清空全部路径约束": "All path constraints cleared",
            "已给「{n0}」换色（新增一版）": "Tinted \"{n0}\" (new version added)",
            "贴图变体": "Texture variants",
            "每一次换色 / 上传替换都新增一个版本，永不覆盖原图；「换回原版」就是切版本。": "Every tint or uploaded replacement adds a new version and never overwrites the original; \"back to the original\" is just a version switch.",
            "当前 v{n0}{n1}": "Current v{n0}{n1}",
            "版本": "Version",
            "已切到 v{n0}": "Switched to v{n0}",
            "删除这一版": "Delete this version",
            "已删除 v{n0}": "Deleted v{n0}",
            "色相": "Hue",
            "饱和度": "Saturation",
            "明度": "Lightness",
            "亮度": "Brightness",
            "对比": "Contrast",
            "换色中…": "Tinting…",
            "应用换色（新增一版）": "Apply tint (adds a version)",
            "重置滑杆": "Reset sliders",
            "上传替换": "Upload replacement",
            "手工上传": "Manual upload",
            "已上传「{n0}」的新贴图": "Uploaded a new texture for \"{n0}\"",
            "滑杆只是预览，点「应用换色」才落成新版本": "The sliders are preview only; click \"Apply tint\" to save them as a new version",
            "想让这块变成什么样？（例如「换成深蓝色布料」「加上金属高光」）": "What should this part become? (e.g. \"dark blue cloth\", \"add metallic highlights\")",
            "正在重绘…": "Redrawing…",
            "已提交 AI 重绘（会花钱）": "AI redraw submitted (costs money)",
            "AI 重绘这一块（会花钱）": "AI redraw this part (costs money)",
            "重绘结果是一版新的贴图：轮廓按原样裁回，不满意切回上一版即可": "The redraw becomes a new texture version: the silhouette is clipped back as-is, so just switch back to the previous version if you don't like it",
            "色相{n0}{n1}°": "Hue {n0}{n1}°",
            "饱和×{n0}": "Saturation ×{n0}",
            "明度{n0}{n1}": "Lightness {n0}{n1}",
            "亮度{n0}{n1}": "Brightness {n0}{n1}",
            "对比×{n0}": "Contrast ×{n0}",
            "换色": "Tint",
            "已撤销": "Undone",
            "已重做": "Redone",
            "已移动「{n0}」": "Moved \"{n0}\"",
            "已缩放「{n0}」": "Resized \"{n0}\"",
            "已微调「{n0}」": "Nudged \"{n0}\"",
            "已收回「{n0}」": "Unplaced \"{n0}\"",
            "已放置「{n0}」": "Placed \"{n0}\"",
            "已调整图层顺序": "Layer order updated",
            "还没有可用部件，请先在第 ① 步拆件或上传部件 PNG。": "No parts available yet. Run part segmentation in step ① first, or upload part PNGs.",
            "缩小": "Zoom out",
            "适应窗口（Ctrl/Cmd+0）": "Fit to window (Ctrl/Cmd+0)",
            "放大": "Zoom in",
            "把参考图叠在下面，方便对位": "Overlay the reference image underneath to help with alignment",
            "参考图底图": "Reference underlay",
            "显示边框": "Show boxes",
            "拖动时吸附到其它部件的边与中线": "Snap to other parts' edges and center lines while dragging",
            "吸附": "Snap",
            "拖角手柄时保持宽高比": "Keep the aspect ratio when dragging corner handles",
            "锁等比": "Lock ratio",
            "撤销{n0}": "Undo{n0}",
            "重做": "Redo",
            "已放置 {n0}/{n1}　·　拖部件移动、拖角缩放、方向键微调 1px（Shift 10px）、Delete 收回、滚轮缩放、空格拖动平移": "Placed {n0}/{n1} · Drag a part to move, drag a corner to resize, arrow keys nudge 1px (Shift 10px), Delete to unplace, scroll wheel to zoom, hold Space and drag to pan",
            "未放置（{n0}）· 拖进画布": "Unplaced ({n0}) · drag onto the canvas",
            "全部部件都已放置。": "All parts are placed.",
            "选中：{n0}": "Selected: {n0}",
            "已修改 x": "x updated",
            "已修改 y": "y updated",
            "宽": "W",
            "已修改宽度": "Width updated",
            "高": "H",
            "已修改高度": "Height updated",
            "已旋转": "Rotation updated",
            "层级": "Layer",
            "已修改层级": "Layer updated",
            "置顶": "Bring to front",
            "上移": "Move up",
            "下移": "Move down",
            "置底": "Send to back",
            "已交换宽高": "Width and height swapped",
            "宽高互换": "Swap W/H",
            "重定位中…": "Repositioning…",
            "已重新自动定位「{n0}」": "Auto-repositioned \"{n0}\"",
            "这块重新自动定位": "Re-run auto placement",
            "收回部件": "Unplace part",
            "这块目前是「未放置」状态：拖到画布上或点上面的数值确认即可放回。": "This part is currently \"Unplaced\": drag it onto the canvas or confirm the values above to place it back.",
            "在画布上点一个部件，这里会出现它的精确参数与图层操作。": "Click a part on the canvas and its exact values and layer controls will appear here.",
            "图层（从下到上）": "Layers (bottom to top)",
            "骨骼动画生成（实验性）": "Skeletal animation generation (experimental)",
            "骨骼动画生成仍在开发中": "Skeletal animation generation is still in development",
            "本次会话不再提示": "Don't show this again this session",
            "去 GitHub 仓库": "Open the GitHub repo",
            "我知道了": "Got it",
            "该模块功能尚不完善，仍在开发中；若你需要它，欢迎到": "This module is not finished yet and is still in development; if you need it, you are welcome to help build it at the ",
            "GitHub 仓库": "GitHub repo",
            "一起开发。": ".",
            "宿主半区版本过旧（缺少骨骼动画模块的字段）。请重启 DSH Desktop 后重试。": "The host-side version is too old (it lacks the skeletal animation module's fields). Restart DSH Desktop and try again.",
            "正在重新定位…": "Repositioning…",
            "新骨骼动画任务": "New skeletal animation job",
            "已新建骨骼动画任务": "Skeletal animation job created",
            "删除任务「{n0}」？产物文件会一并删除。": "Delete job \"{n0}\"? Its output files will be deleted as well.",
            "新的任务名": "New job name",
            "新图片任务的名字": "Name for the new image job",
            "新序列帧任务的名字": "Name for the new sequence job",
            "新骨骼动画任务的名字": "Name for the new skeletal animation job",
            "新地图项目的名字": "Name for the new map project",
            "已重命名": "Renamed",
            "已上传参考图：{n0}": "Reference image uploaded: {n0}",
            "已上传 {n0} 个部件（文件名即部件名）": "Uploaded {n0} parts (the file name is used as the part name)",
            "已保存提示词与参数": "Prompt and settings saved",
            "远程服务尚未挂载完成，请稍候…": "The remote service is not mounted yet, please wait…",
            "创建中…": "Creating…",
            "未配置": "Not configured",
            "（模型在「设置 → 游戏素材大师」里改）": "(change the model in \"Settings → Game Material Master\")",
            "进行中…": "Running…",
            "正在读取任务…": "Loading jobs…",
            "还没有骨骼动画任务，点右上角「新建任务」开始。": "No skeletal animation jobs yet. Click \"New job\" in the top right to get started.",
            "任务": "Job",
            "{n0}（部件 {n1}）": "{n0} ({n1} parts)",
            "本阶段进行中…": "This stage is running…",
            "角色参考图": "Character reference image",
            "拆件、装配、骨骼都以这张整图为基准；建议用能看清全身、背景干净的角色立绘。": "Part segmentation, layout, and bones are all based on this sheet; use a character illustration that shows the whole body clearly on a clean background.",
            "拖入角色整图（PNG / JPG）": "Drag in the character sheet (PNG / JPG)",
            "拖入部件 PNG（可多选，文件名即部件名）": "Drag in part PNGs (multiple allowed; the file name is used as the part name)",
            "让生图模型把角色拆成摊平的部件图，再自动分割成逐件透明 PNG。**这一步花钱**，只跑一次；参数改了可以「重新分割」，不额外计费。": "Let the image model split the character into a flattened parts sheet, then automatically segment it into individual transparent PNGs. **This step costs money** and only runs once; if you change the settings you can \"Re-segment\" at no extra cost.",
            "已提交拆件生图": "Part sheet generation submitted",
            "重新生成拆件图（会花钱）": "Regenerate part sheet (costs money)",
            "生成拆件图（会花钱）": "Generate part sheet (costs money)",
            "正在分割…": "Segmenting…",
            "已提交重新分割": "Re-segmentation submitted",
            "用现有拆件图重新分割": "Re-segment the existing part sheet",
            "网格列": "Grid columns",
            "网格行": "Grid rows",
            "底色容差": "Background tolerance",
            "边缘羽化": "Edge feather",
            "最小面积": "Min area",
            "底色容差：与底色多接近算背景。边缘羽化：只决定轮廓最外圈那几个像素的软过渡，部件内部不会变半透明。": "Background tolerance: how close to the background color still counts as background. Edge feather: controls only the soft transition of the few pixels on the outermost edge of the outline, and the inside of a part never becomes semi-transparent.",
            "保存参数与提示词": "Save settings and prompt",
            "留空则使用内置的网格拆件提示词（要求模型按 4×4 网格摆放 16 个标准人形部件）": "Leave empty to use the built-in grid part-sheet prompt (it asks the model to lay out 16 standard humanoid parts in a 4×4 grid)",
            "生图模型正在拆件…": "The image model is generating the part sheet…",
            "先上传角色参考图。": "Upload the character reference image first.",
            "还没有拆件图：点上面的「生成拆件图」，或者用上面的上传框直接给现成部件 PNG。": "No part sheet yet: click \"Generate part sheet\" above, or use the upload box above to supply ready-made part PNGs directly.",
            "部件（{n0}）——逐件验收，摆错的可单独重跑": "Parts ({n0}) — accept them one by one; any misplaced part can be re-run on its own",
            "把「{n0}」改成什么名字？\n（名字决定骨骼层级，标准名如 head / torso / hip / left-upper-arm / left-lower-leg / right-foot，见拆件提示词里的网格表）": "Rename \"{n0}\" to what?\n(The name determines the bone hierarchy; standard names are head / torso / hip / left-upper-arm / left-lower-leg / right-foot — see the grid table in the part-sheet prompt.)",
            "已改名为「{n0}」": "Renamed to \"{n0}\"",
            "已重新定位「{n0}」": "Repositioned \"{n0}\"",
            "第①步已通过": "Step ① approved",
            "第①步：已通过": "Step ①: Approved",
            "第①步：通过": "Step ①: Approve",
            "取消通过": "Unapprove",
            "下一步：装配定位 →": "Next: Layout →",
            "多尺度模板匹配把每个部件摆回参考姿态。**本地计算，免费**：失败或摆错只重跑那几个部件，不用整批重来。": "Multi-scale template matching places each part back into the reference pose. **Local compute, free**: if it fails or lands wrong, re-run just those parts instead of the whole batch.",
            "已提交装配定位（本地计算）": "Layout submitted (local compute)",
            "重新装配全部部件": "Re-layout all parts",
            "正在重试…": "Retrying…",
            "已提交重试未命中的部件": "Retry of unmatched parts submitted",
            "只重试未命中的 {n0} 个": "Retry only the {n0} unmatched",
            "只显示合成图": "Show composite only",
            "并排显示参考图": "Show reference side by side",
            "这些部件没匹配上，请手工拖到正确位置：{n0}": "These parts did not match. Drag them into the correct positions manually: {n0}",
            "、": ", ",
            "第②步已通过": "Step 2 approved",
            "第②步：已通过": "Step 2: approved",
            "第②步：通过": "Step 2: Approve",
            "下一步：骨骼与动画 →": "Next: Bones & Animation →",
            "按部件语义自动推骨骼层级，并生成六个动画预设。**本地计算，免费**。下面直接播放验收。": "Derives the bone hierarchy automatically from part semantics and generates six animation presets. **Local compute, free**. Play them below to review.",
            "已提交骨骼构建": "Bone build submitted",
            "生成骨骼与动画": "Generate bones and animations",
            "动画预设": "Animation presets",
            "保存动画选择": "Save animation selection",
            "下载 skeleton.json": "Download skeleton.json",
            "新窗口打开预览": "Open preview in new window",
            "骨骼告警：{n0}": "Bone warnings: {n0}",
            "播放动画": "Play animation",
            "预览里也能拖时间轴、开骨骼网格": "You can also scrub the timeline and toggle the bone mesh in the preview",
            "骨骼动画预览": "Skeletal animation preview",
            "点「生成骨骼与动画」得到 skeleton.json 与可播放预览。": "Click \"Generate bones and animations\" to get skeleton.json and a playable preview.",
            "先完成第②步装配定位。": "Complete step 2 (layout) first.",
            "DragonBones 骨架": "DragonBones skeleton",
            "同一份骨架的 DragonBones 5.5 写法（Cocos / Egret / Laya 可直接加载）": "The same skeleton written for DragonBones 5.5 (loads directly in Cocos / Egret / Laya)",
            "第③步已通过": "Step 3 approved",
            "第③步：已通过": "Step 3: approved",
            "第③步：通过": "Step 3: Approve",
            "下一步：图集 →": "Next: Atlas →",
            "把部件按装配后的尺寸打包成 Spine 纹理图集。区域尺寸与 skeleton.json 里挂点的 width/height 一致，导入引擎不会错位。": "Packs the parts at their laid-out sizes into a Spine texture atlas. Region sizes match the attachment width/height in skeleton.json, so nothing shifts when you import into an engine.",
            "正在打包…": "Packing…",
            "已提交图集打包": "Atlas packing submitted",
            "打包纹理图集": "Pack texture atlas",
            "查看 skeleton.atlas": "View skeleton.atlas",
            "下载 skeleton.png": "Download skeleton.png",
            "{n0}×{n1} · {n2} 区域{n3}": "{n0}×{n1} · {n2} regions{n3}",
            " · {n0} 页": " · {n0} pages",
            "DragonBones 贴图": "DragonBones textures",
            "图集提示：{n0}": "Atlas notes: {n0}",
            "点「打包纹理图集」生成 skeleton.png + skeleton.atlas。": "Click \"Pack texture atlas\" to generate skeleton.png + skeleton.atlas.",
            "先完成第③步骨骼构建。": "Complete step 3 (bone build) first.",
            "分页": "Pages",
            "{n0}（{n1}×{n2} · {n3} 区域）": "{n0} ({n1}×{n2} · {n3} regions)",
            "第④步已通过": "Step 4 approved",
            "第④步：已通过": "Step 4: approved",
            "第④步：通过": "Step 4: Approve",
            "导入 Spine：把 skeleton.json、skeleton.atlas、skeleton.png 三个文件放在同一目录，打开 Spine 时选 skeleton.json 即可。": "Importing into Spine: put skeleton.json, skeleton.atlas and skeleton.png in the same folder, then select skeleton.json when you open Spine.",
            "导入 DragonBones：把 export/dragonbones/skeleton_ske.json 与 atlas/skeleton_tex.json、atlas/skeleton.png 放同一目录后加载 .json 数据与纹理。": "Importing into DragonBones: put export/dragonbones/skeleton_ske.json in the same folder as atlas/skeleton_tex.json and atlas/skeleton.png, then load the .json data and textures.",
            "正在载入配置…": "Loading configuration…",
            "配置已保存": "Configuration saved",
            "配置两家模型的 API Key 与整条流水线的默认参数。Key 只保存在本机 DSH 数据目录下的 game-material-master/config.json（真实路径见文末「数据位置」），界面里始终脱敏显示。": "Configure the API keys for both models and the default parameters for the whole pipeline. Keys are stored only in game-material-master/config.json under your local DSH data directory (see \"Data location\" at the end for the real path) and are always masked in the UI.",
            "火山方舟（生图）": "Volcengine Ark (image generation)",
            "ffmpeg 可用：{n0}": "ffmpeg available: {n0}",
            "ffmpeg 不可用：{n0}": "ffmpeg unavailable: {n0}",
            "未知": "Unknown",
            "API Key {n0}": "API Key {n0}",
            "（已配置 {n0}）": "(configured {n0})",
            "（未配置）": "(not configured)",
            "留空表示不修改": "Leave blank to keep unchanged",
            "粘贴 ARK_API_KEY": "Paste ARK_API_KEY",
            "火山方舟 Key 已保存": "Volcengine Ark key saved",
            "保存 Key": "Save key",
            "已清除火山方舟 Key": "Volcengine Ark key cleared",
            "自定义：{n0}": "Custom: {n0}",
            "部件重绘模型": "Part redraw model",
            "跟生图模型相同": "Same as the generation model",
            "输出尺寸": "Output size",
            "正在生成测试图…": "Generating test image…",
            "连接正常：{n0} 返回 {n1} 字节图片": "Connection OK: {n0} returned a {n1}-byte image",
            "测试连接（会真实生成 1 张 1K 小图，产生少量费用）": "Test connection (generates one real 1K image, small charge)",
            "MiniMax（图生视频）": "MiniMax (image-to-video)",
            "视频阶段使用图生视频（I2V）。建议用 MiniMax-Hailuo-02，镜头稳定性最好。": "The video stage uses image-to-video (I2V). MiniMax-Hailuo-02 is recommended for the most stable camera.",
            "粘贴 MiniMax API Key": "Paste MiniMax API Key",
            "MiniMax Key 已保存": "MiniMax key saved",
            "已清除 MiniMax Key": "MiniMax key cleared",
            "Base URL（优云智算版 H3 固定使用，无需修改）": "Base URL (fixed for the CompShare H3 build, no changes needed)",
            "Base URL（主机根，不含 /v1、/v2）": "Base URL (host root, without /v1 or /v2)",
            "当前协议：{n0}": "Current protocol: {n0}",
            "v2（{n0}/v2/video_generation）": "v2 ({n0}/v2/video_generation)",
            "v1（{n0}/v1/video_generation）": "v1 ({n0}/v1/video_generation)",
            "正在校验…": "Validating…",
            "连接正常：{n0}": "Connection OK: {n0}",
            "测试连接（只校验 Key，不产生费用）": "Test connection (validates the key only, no charge)",
            "新建项目的默认参数": "Defaults for new projects",
            "这些值会成为每个新项目的初始设置，之后可在项目里单独调整。": "These values become the initial settings for every new project and can be adjusted per project later.",
            "抠像下限": "Keying lower bound",
            "抠像上限": "Keying upper bound",
            "去绿溢出": "Despill",
            "自动裁剪填充比例": "Auto-crop fill ratio",
            "数据位置": "Data location",
            "所有项目（源图、绿幕图、视频、序列帧、整图）都保存在：": "All projects (source images, chroma-key images, videos, sequence frames, sheets) are stored in:",
            "已刷新": "Refreshed",
            "重新读取配置": "Reload configuration",
            "gameStudio 远程服务不可用，请确认插件已启用": "The gameStudio remote service is unavailable. Make sure the plugin is enabled.",
            "{n0} 调用失败": "{n0} call failed",
            "{n0}: 深链接拦截": "{n0}: deep link interception",
            "{n0}: 深链接引导": "{n0}: deep link guidance",
            // ── 45° 地图地块生成（模块五）──
            "45°地图地块生成": "45° map tile generation",
            "45° 等距地块 → 拼成地图：几何交给代码，内容交给 AI": "45° isometric tiles → a whole map: geometry by code, content by AI",
            "45°地图地块生成仍在开发中": "45° map tile generation is still in development",
            "45°地图地块生成（实验性）": "45° map tile generation (experimental)",
            "几何是可靠的：等距参考图、拼图与裁剪全部由本地代码计算，并有像素级自检兜底 —— 菱形比例、底面中心、包围盒都不会跑偏。": "The geometry is solid: the isometric reference images, map assembly and cropping are all computed by local code with pixel-level self-checks — diamond ratio, base centre and bounding box will not drift.",
            "不稳定的是**造型**：生图模型能否照着参考图的占格形状画出正确的建筑，取决于模型本身。实测非矩形占地（L 形、3×1 长条）经常需要反复重跑才可接受。": "What is unstable is the **artwork**: whether the image model can draw a correct building from the footprint shape in the reference image depends on the model itself. In practice non-rectangular footprints (L-shapes, 3x1 strips) often need several re-runs before they are acceptable.",
            "参考图（自动生成，免费）": "Reference image (auto-generated, free)",
            "待生成": "Pending",
            "还没生成 —— 点「生成全部地块」时会自动渲染": "Not generated yet — it will be rendered automatically when you click Generate all tiles",
            "按②里每个地块的占格形状渲染；改了形状或格子尺寸，下次生成时自动重做": "Rendered from each tile footprint shape; re-done automatically on the next generate if a shape or the cell size changed",
            "正在准备参考图…": "Preparing the reference images…",
            "还没有参考图 —— 点「生成全部地块」时会自动渲染（免费）。": "No reference images yet — they are rendered automatically (free) when you click Generate all tiles.",
            "生成一个变体 = 一次 Seedream 调用。参考图按每个地块的占格形状自动渲染，不用手动准备。": "One variant = one Seedream call. The reference image is rendered automatically from each tile footprint shape; there is nothing to prepare by hand.",
            "① 生成地块": "① Generate tiles",
            "按占格形状自动渲染等距参考图交给 Seedream 填内容。这一步真实计费，每个变体一次调用": "An isometric reference image is rendered automatically from each footprint shape and handed to Seedream to fill in. This step is billed: one call per variant",
            "② 验收": "② Review",
            "逐项看几何报告与成品，不满意的单张重跑": "Check the geometry report and the result per item; re-run any single one you dislike",
            "③ 拼成地图": "③ Assemble map",
            "本地按等距网格铺图，按类别随机抽变体。免费，可反复换种子": "Lay tiles on the isometric grid locally, picking variants at random per family. Free, re-seed as often as you like",
            "④ 导出": "④ Export",
            "导出地块包与地图 PNG / JSON": "Export the tile pack plus map PNG / JSON",
            "未命名地图": "Untitled map",
            "项目": "Project",
            "（未选择）": "(none selected)",
            "新项目名称": "New project name",
            "已生成 {n0} / {n1}，已验收 {n2}": "Generated {n0} / {n1}, approved {n2}",
            "还没有地图地块项目——取个名字点「新建项目」开始。": "No map tile project yet — name one and click 'New project' to start.",
            "停止": "Stop",
            "单格模板（1×1 地形用）": "Single-cell template (for 1x1 terrain)",
            "{n0}×{n1} 建筑模板": "{n0}x{n1} building template",
            "异形模板 · {n0} 格 {n1}": "Custom-shape template · {n0} cells {n1}",
            "模板几何": "Template geometry",
            "统一画风": "Shared style",
            "保存画风": "Save style",
            "改画风会让已生成的地块全部作废（重跑要花钱）": "Changing the style invalidates every generated tile (re-running costs money)",
            "生成全部": "Generate all",
            "生成全部地块": "Generate all tiles",
            "补缺": "Fill gaps",
            "所有地块都已经生成过了": "Every tile has already been generated",
            "只补没生成的": "Only fill missing ones",
            "排队中": "Queued",
            "重跑": "Re-run",
            "逐项看成品与几何报告。几何正常的地块拼起来不会有缝；标「模板几何」说明这张没量准，建议重跑。": "Check each result and its geometry report. Tiles with correct geometry will not show seams; a 'template geometry' badge means the measurement failed, so re-running is recommended.",
            "验收": "Review",
            "行": "Rows",
            "列": "Cols",
            "种子": "Seed",
            "装饰密度": "Decor density",
            "拼图": "Assemble",
            "铺成地图（免费）": "Assemble map (free)",
            "换种子": "Re-seed",
            "换个种子重铺": "Re-roll with a new seed",
            "地图": "Map",
            "还没有拼图——点「铺成地图」立刻看到结果（不花钱）。": "No map assembled yet — click 'Assemble map' to see the result immediately (no cost).",
            "导出地块包（每张 PNG）+ 地图 PNG + 布局 JSON。全部本地计算。": "Export the tile pack (one PNG each) plus map PNG and layout JSON. All computed locally.",
            "导出": "Export",
            "导出到 export/": "Export to export/",
            "打开产物目录": "Open output folder",
            "正在生成地块…": "Generating tiles…",
            // ── 地图地块：地块清单编辑 ──
            "已保存「{n0}」——提示词变了，这个地块的产物已作废，需要重跑": "Saved '{n0}' — the prompt changed, so this tile's output was discarded and needs a re-run",
            "已保存「{n0}」——提示词没变，产物保住了": "Saved '{n0}' — the prompt is unchanged, so its output was kept",
            "至少要留一个地块": "Keep at least one tile",
            "已删除「{n0}」": "Deleted '{n0}'",
            "地块标识只能用英文小写字母开头，后接小写字母 / 数字 / 下划线（2~24 位）——它会当文件名用": "A tile id must start with a lowercase letter followed by lowercase letters, digits or underscores (2-24 chars) — it is used as a file name",
            "已经有同名地块了：{n0}": "A tile with that id already exists: {n0}",
            "已新增地块「{n0}」": "Added tile '{n0}'",
            "已恢复默认地块清单（已生成的地块会作废）": "Restored the default tile list (generated tiles are discarded)",
            "标识（key，只读）": "Id (key, read-only)",
            "用途": "Role",
            "地形（占 1 格）": "Terrain (1 cell)",
            "装饰（占 1 格、按锚点摆放）": "Decor (1 cell, placed on an anchor)",
            "建筑（跨格）": "Building (spans cells)",
            "模板填充（地形）": "Template filling (terrain)",
            "白底单图（装饰）": "White-background single image (decor)",
            "2×2 地基网格（建筑）": "2x2 foundation grid (building)",
            "变体数（每个变体一次计费调用）": "Variants (one billed call each)",
            "类别（铺图时按它随机抽变体）": "Family (variants are drawn from it at random when assembling)",
            "占格形状（点格子增删，支持 L 形）": "Footprint shape (click cells to add/remove; L-shapes supported)",
            "锚点（左上角，必选）": "Anchor (top-left, always on)",
            "点格子增删占格（{n0} 格）；左上角是锚点": "Click cells to add/remove tiles ({n0} so far); the top-left cell is the anchor",
            "生成提示词（只描述「菱形里面是什么」；形状 / 角度 / 透视由代码保证，不要写）": "Prompt (describe only what is inside the diamond; shape, angle and perspective are guaranteed by code, do not write them)",
            "提示词与生成方式有改动 —— 保存后这个地块的已生成产物会作废（重跑要花钱）": "The prompt or generation mode changed — saving discards this tile's existing output (re-running costs money)",
            "只改名称 / 类别 / 变体数不会作废产物": "Changing only the name, family or variant count keeps existing output",
            "看最终提示词": "Show the final prompt",
            "保存地块": "Save tile",
            "保存": "Save",
            "移除地块": "Remove tile",
            "删除这个地块": "Delete this tile",
            "＋ 新增地块": "+ Add tile",
            "恢复默认清单": "Restore defaults",
            "标识（英文小写，会当文件名）": "Id (lowercase, used as a file name)",
            "灰色岩壁": "Grey cliff",
            "生成提示词（只描述「菱形里面是什么」）": "Prompt (describe only what is inside the diamond)",
            "留空即用标识": "Leave empty to reuse the id",
            "下面的预览就是当前草稿：涂一格立刻变，不用先保存。": "The preview below shows the current draft: paint a cell and it updates instantly, no need to save first.",
            "重跑中…": "Re-running…",
            "已撤销。": "Undone.",
            "已重做。": "Redone.",
            "撤销": "Undo",
            "快捷键：Ctrl+Z 撤销 / Ctrl+Shift+Z 重做；Esc 放下笔刷；在地图上按住 Ctrl 滚轮切笔刷。": "Shortcuts: Ctrl+Z undo / Ctrl+Shift+Z redo; Esc puts the brush down; hold Ctrl and scroll over the map to cycle brushes.",
            "超出地图范围": "Outside the map",
            "放不下：占 {n0}×{n1} 格，这里会超出边界": "Does not fit: needs {n0}x{n1} cells and would go past the edge",
            "放不下：会压到 ({n0},{n1}) 那栋建筑": "Does not fit: would overlap the building at ({n0},{n1})",
            "地面": "Ground",
            "装饰": "Decor",
            "建筑": "Building",
            "{n0} · 占 {n1}×{n2} 格": "{n0} · takes {n1}x{n2} cells",
            "{n0}（{n1}/{n2}）": "{n0} ({n1}/{n2})",
            "新增地块": "Add tile",
            "新增": "Add",
            "编辑": "Edit",
            // ── 地图地块：手动编辑布局 ──      "布局已保存。点「铺成地图」重新出图。": "Layout saved. Click 'Assemble map' to render it again.",
            "布局已保存。点「铺成地图」重新出图。": "Layout saved. Click 'Assemble map' to render it again.",
            "空格": "empty",
            "铺图全在本地：按等距网格铺、按类别随机抽变体、按 (r+c) 顺序遮挡。同种子 + 同布局 = 逐像素一致。也可以手动改：挑一个地块当笔刷，点格子涂上去。": "Assembly is entirely local: laid on the isometric grid, variants drawn per family, painted in (r+c) order. Same seed + same layout = pixel-identical. You can also edit by hand: pick a tile as a brush and click cells to paint.",
            "笔刷（点格子刷上去）": "Brush (click cells to paint)",
            "橡皮擦": "Eraser",
            "已取出当前布局，开始涂改（改完点「保存布局」）": "Loaded the current layout — start painting, then click 'Save layout'",
            "开始编辑布局": "Start editing the layout",
            "全刷成当前笔刷": "Fill all with the brush",
            "全部清空": "Clear all",
            "保存布局": "Save layout",
            "放弃修改": "Discard changes",
            "共 {n0} 行 × {n1} 列": "{n0} rows x {n1} cols",
            "正在编辑 {n0} · 当前是「{n1}」": "Editing {n0} · currently '{n1}'",
            "涂改只改草稿，点「保存布局」才写回项目；之后再点「铺成地图」出图。手动改布局不会作废已生成的地块。": "Painting only changes a draft; click 'Save layout' to write it back, then 'Assemble map' to render. Editing the layout never discards generated tiles.",
            // ── 功能管理 / 侧栏快捷菜单 ──
            "功能菜单": "Feature menu",
            "快捷进入功能": "Jump to a feature",
            "功能管理": "Feature management",
            "隐藏不用的功能。隐藏后界面里不再出现它的页签与侧栏菜单项，对话里的 AI 也无法调用它（工具会直接报错）。随时可以再打开，已有的项目数据不会被删除。": "Hide the features you do not use. A hidden feature disappears from the workbench tabs and the sidebar menu, and the agent cannot call it either (its tools fail loudly). You can turn it back on at any time, and existing project data is never deleted.",
            "已隐藏": "Hidden",
            "显示中": "Visible",
            "当前功能全部可见。": "All features are currently visible.",
            "已隐藏 {n0} 个功能：{n1}。隐藏的模块在对话里同样不可调用。": "{n0} feature(s) hidden: {n1}. Hidden modules cannot be called from chat either.",
            "已隐藏 {n0} 个功能（设置 → 游戏素材大师 → 功能管理）": "{n0} feature(s) hidden (Settings → Game Material Master → Feature management)",
            "所有功能都已被隐藏，请到「设置 → 游戏素材大师 → 功能管理」里打开至少一个。": "Every feature is hidden. Turn at least one back on in \"Settings → Game Material Master → Feature management\".",
            "所有功能都已被隐藏。请到「设置 → 游戏素材大师 → 功能管理」里打开至少一个。": "Every feature is hidden. Turn at least one back on in \"Settings → Game Material Master → Feature management\".",
            // ── 地图编辑器（模块六）────────────────────────────────────────────
            "地图编辑器": "Map editor",
            "导入自己的 tileset → 自动过渡 → 多层拼图 → 导出 Tiled": "Import your own tileset → auto-tiling → multi-layer assembly → export to Tiled",
            "① 图集": "① Tilesets",
            "导入你自己的 tileset 图，按网格或矩形切分，再把图块归入地形族": "Import your own tileset image, slice it by grid or rectangles, then assign tiles to terrain families",
            "② 规则": "② Rules",
            "定义地形族与自动过渡（单块 / 16 掩码 / 47 掩码），缺的块会标出来": "Define terrain families and auto-tiling (single / 16-mask / 47-mask); missing pieces are flagged",
            "③ 地图": "③ Maps",
            "多张地图、多图层、每层高度偏移；画布上直接刷，撤销重做都在宿主": "Several maps and layers with per-layer height offset; paint straight on the canvas — undo/redo lives in the host",
            "PNG 分层与合并 + 自有 JSON + Tiled .tmj/.tsj，全部本地免费": "Layered and merged PNG + own JSON + Tiled .tmj/.tsj, all local and free",
            "单块（不自动过渡）": "Single tile (no auto-tiling)",
            "四邻域 16 掩码": "4-neighbour, 16 masks",
            "八邻域 47 掩码（blob）": "8-neighbour, 47 masks (blob)",
            "画笔": "Brush",
            "橡皮": "Eraser",
            "填充": "Fill",
            "矩形": "Rectangle",
            "吸管": "Picker",
            "按住拖动画线（B）": "Hold and drag to draw a line (B)",
            "擦成空（E）": "Erase to empty (E)",
            "同色连通区一次填满（G）": "Flood-fill the connected area (G)",
            "拖出矩形，按住「矩形填充」为实心（R）": "Drag a rectangle; tick \"Rectangle fill\" for a solid one (R)",
            "吸取格子上的图块（I）": "Pick the tile under the cursor (I)",
            "我的地图": "My map",
            "读文件失败": "Failed to read the file",
            "已导入 {n0}": "Imported {n0}",
            "已按顺序给前 {n0} 块分配掩码": "Assigned masks to the first {n0} tiles in order",
            "还没有地图项目。": "No map project yet.",
            "新建地图项目": "New map project",
            "选择已有项目…": "Choose an existing project…",
            "未分组": "Ungrouped",
            "点一块图作为笔刷（序号 {n0}）。带底色的是已归族的块。": "Click a tile to use it as the brush (index {n0}). Tinted tiles belong to a family.",
            "{n0} / {n1} 个掩码已配": "{n0} / {n1} masks assigned",
            "工具": "Tool",
            "撤销/重做": "Undo / redo",
            "适应窗口": "Fit",
            "当前图层": "Active layer",
            "矩形填充": "Rectangle fill",
            "显示": "Visible",
            "锁定": "Locked",
            "高度": "Height",
            "不透明度%": "Opacity %",
            "加装饰层": "Add decor layer",
            "加建筑层": "Add building layer",
            "覆盖": "Overlay",
            "加覆盖层": "Add overlay layer",
            "新地图名字": "New map name",
            "新地图": "New map",
            "新建地图": "New map",
            "复制当前地图": "Duplicate map",
            "删除当前地图": "Delete map",
            "导入图集": "Import tileset",
            "导入你自己的 tileset 图（PNG / JPEG / WebP）。原图会原样保存，切分参数随便改都能重切。": "Import your own tileset image (PNG / JPEG / WebP). The original is kept as-is, so you can re-slice it with any settings.",
            "正在导入…": "Importing…",
            "块": "tiles",
            "选为调色板": "Use as palette",
            "移除图集": "Remove tileset",
            "格宽": "Tile width",
            "格高": "Tile height",
            "左边距": "Left margin",
            "上边距": "Top margin",
            "横向间距": "H spacing",
            "纵向间距": "V spacing",
            "应用切分": "Apply slicing",
            "切分建议：{n0}": "Slicing suggestions: {n0}",
            "没有能整除的常见尺寸，请手动填": "no common size divides evenly — please fill it in manually",
            "选中 {n0} 块": "{n0} selected",
            "归入「{n0}」": "Assign to \"{n0}\"",
            "清空分组": "Clear family",
            "给「{n0}」按顺序分配掩码": "Assign masks to \"{n0}\" in order",
            "地形族与自动过渡": "Terrain families and auto-tiling",
            "优先级大的族会朝优先级小的邻居长过渡块（草地 < 土路 < 水）。缺掩码的地方会回退成最近的一块，并在下面标出来。": "A family with higher priority grows transition tiles toward lower-priority neighbours (grass < dirt < water). Missing masks fall back to the nearest one and are listed below.",
            "优先级": "Priority",
            "新族": "New family",
            "加一个族": "Add a family",
            "保存族": "Save families",
            "掩码覆盖率": "Mask coverage",
            "还没有族。先加一个族，再把图块归进去。": "No family yet. Add one, then assign tiles to it.",
            "完整": "Complete",
            "缺 {n0} 块": "{n0} missing",
            "生成验收预览图": "Generate review previews",
            "调色板": "Palette",
            "选择图集…": "Choose a tileset…",
            "全部本地计算，不花钱。导出目录是自包含的：图集 PNG 会一起复制过去，Tiled 直接能打开。": "Everything is computed locally and free. The export folder is self-contained: tileset PNGs are copied alongside so Tiled can open it directly.",
            "合并 PNG（map.png）": "Merged PNG (map.png)",
            "分层 PNG": "Layered PNG",
            "自有 JSON": "Own JSON",
            "Tiled .tmj/.tsj": "Tiled .tmj/.tsj",
            "在访达中打开": "Open in Finder",
            "还没有导出过。": "Nothing exported yet.",
            "任务进行中…": "A job is running…",
            // ── 地图编辑器：实验性说明弹窗 ──────────────────────────────────────
            "这条路是全本地的：导入图集、切分、自动过渡、拼图、导出都在本机算，一次模型调用都没有，所以不花钱。": "This road is **fully local**: importing the atlas, slicing, auto-tiling, assembly and export all run on this machine — not a single model call, so nothing is billed.",
            "与模块⑤不同：它不生成素材，只把你已有的 tileset 切成可用地块。自动过渡支持单块 / 16 掩码 / 47 掩码，缺掩码会回退并在覆盖率里标出来。": "Unlike module ⑤ it generates no artwork: it slices the tileset you already have into usable tiles. Auto-tiling supports single / 16-mask / 47-mask; missing masks fall back and are flagged in the coverage report.",
            "界面上看到的地图与导出的 PNG 执行的是同一份绘制计划，所以不会有「预览好看、导出位移」这种事。": "The map you see and the exported PNG execute the **same draw plan**, so \"looks right in the preview but shifts on export\" cannot happen.",
            "地图编辑器仍在开发中": "The map editor is still in development",
            "地图编辑器（实验性）": "Map editor (experimental)",
            "先选一块图当笔刷：点调色板里的图块，或点上面的族胶囊。": "Pick a tile first: click a tile in the palette, or a family chip above."
        };
        /* i18n-ignore-end */
        /**
         * 语言切换后必须重算的模块级文案表。
         *
         * 这些表在模块加载时就求了值（`T()` 是纯函数，模块级调用不会自己变），
         * 不重算的话语言切了它们还停在旧语言——页签标题、方向名这类就属于此列。
         */
        const staticTextRebuilders = [
            () => {
                DIRECTIONS = make_DIRECTIONS();
            },
            () => {
                RIG_EXPERIMENTAL_POINTS = make_RIG_EXPERIMENTAL_POINTS();
            },
            () => {
                MODULES = make_MODULES();
            },
            () => {
                TILE_STAGES = make_TILE_STAGES();
            },
            () => {
                MAP_STAGES = make_MAP_STAGES();
            },
            () => {
                MAP_AUTOTILE_SCHEMES = make_MAP_AUTOTILE_SCHEMES();
            },
            () => {
                MAP_TOOL_LABELS = make_MAP_TOOL_LABELS();
                MAP_TOOL_HINTS = make_MAP_TOOL_HINTS();
            },
            () => {
                MAP_EXPERIMENTAL_POINTS = make_MAP_EXPERIMENTAL_POINTS();
            },
            () => {
                STAGES = make_STAGES();
            },
            () => {
                IMAGE_MODES = make_IMAGE_MODES();
            },
            () => {
                RIG_ROLES = make_RIG_ROLES();
            },
            () => {
                RIG_STAGES = make_RIG_STAGES();
            },
            () => {
                RIG_BUSY_LABEL = make_RIG_BUSY_LABEL();
            },
            () => {
                TRACK_LABELS = make_TRACK_LABELS();
            },
            () => {
                EASING_PRESETS = make_EASING_PRESETS();
            },
            () => {
                LABEL_OF = make_LABEL_OF();
            }
        ];
        /** 重算全部模块级文案表（幂等；语言切换与首次挂载都会走一次）。 */
        function rebuildStaticText() {
            for (const rebuild of staticTextRebuilders)
                rebuild();
        }
        /**
         * 中文表是恒等映射。必须写全：locale 服务的回退链是「当前语言 → en」，
         * 只注册 en 的话中文界面会一路落到英文。
         */
        const ZH = Object.fromEntries(Object.keys(EN).map((key) => [key, key]));
        /** DSH locale 服务给的绑定翻译函数；服务还没挂载时是 null。 */
        let boundTranslate = null;
        /** locale 服务本身；宿主侧的默认提示词要靠它算出「该用哪国话」。 */
        let localeService = null;
        /** 语言变化时要重渲染的订阅者（各模块顶层组件挂一个，子树跟着重渲染）。 */
        const localeListeners = new Set();
        /**
         * 当前界面语言，规整成宿主认识的两个值。
         *
         * 内置默认提示词（八方向生图 / 行走视频 / 转圈视频）存在宿主侧，
         * 宿主没有 locale 服务，所以每次读写提示词都把它带过去。
         * 服务不在时按中文算——那也正是界面当时的语言。
         */
        function activeLang() {
            const active = localeService?.getSnapshot?.()?.active;
            return typeof active === "string" && active.trim().toLowerCase().startsWith("en") ? "en" : "zh";
        }
        /** `{name}` 插值；与 locale 服务内部用的是同一条规则。 */
        function fill(text, params) {
            if (params === undefined)
                return text;
            return String(text).replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
        }
        /** 翻译。没有 locale 服务时退回中文原文——自检脚本直接渲染组件走的就是这条。 */
        function T(key, params) {
            return boundTranslate === null ? fill(key, params) : boundTranslate(key, params);
        }
        /**
         * 挂上 DSH 的 locale 服务。
         *
         * locale 是**可选**依赖：服务不在（或注册失败）时界面继续用中文原文，
         * 插件不会因为缺这一个服务就整块不挂载。
         * @returns 是否挂上了。
         */
        function installI18n(ctx) {
            const locale = ctx.get("locale");
            if (locale === undefined || locale === null)
                return false;
            try {
                ctx.effect(() => locale.register(I18N_NS, { zh: ZH, en: EN }), `${PACKAGE}: i18n dictionary`);
                localeService = locale;
                boundTranslate = locale.bind(I18N_NS);
                // 模块级文案表是**模块加载时**求值的（那时还没有 locale 服务，全是中文原文），
                // 所以挂上服务的第一件事就是把它们按当前语言重算一遍。
                rebuildStaticText();
                ctx.effect(() => locale.subscribe(() => {
                    boundTranslate = locale.bind(I18N_NS);
                    rebuildStaticText();
                    for (const listener of [...localeListeners]) {
                        try {
                            listener();
                        }
                        catch {
                            // 单个订阅者出错不该拖垮语言切换本身。
                        }
                    }
                }), `${PACKAGE}: locale switch re-render`);
                return true;
            }
            catch {
                return false;
            }
        }
        /** 语言切换时重渲染当前组件。挂在各模块顶层即可，子树跟着一起重渲染。 */
        function useLocaleTick() {
            const [tick, setTick] = React.useState(0);
            React.useEffect(() => {
                const listener = () => setTick((value) => value + 1);
                localeListeners.add(listener);
                return () => {
                    localeListeners.delete(listener);
                };
            }, []);
            return tick;
        }
        /**
         * 把 locale 服务接进来。立刻不是它的锅（服务可能比插件后挂载），
         * 所以先试一次，没成就等它可用——用 ctx.inject 而不是把它写进 inject 列表：
         * 写进去会让整个插件卡在这个服务上，缺了它就整个不挂载。
         */
        function attachI18n(ctx) {
            if (installI18n(ctx))
                return;
            try {
                ctx.inject(["locale"], (child) => {
                    installI18n(child);
                });
            }
            catch {
                // 老版本宿主没有 ctx.inject：那就一直用中文原文，界面仍然是完整的。
            }
        }
        // ── 远程贡献 ─────────────────────────────────────────────────────────
        // 与宿主 src/wire.ts 的 METHODS 必须一一对应；那份是唯一的真源。
        // 宿主校验在服务端；浏览器半区只声明同一套 strict codec。
        // DSH 的 typert 要求 create() 工厂，运行时走 codec.create().parse()。
        const codec = (symbol) => ({ mode: "strict", typeSymbol: symbol, create: () => ({ parse: (value) => value }) });
        const REMOTE_METHODS = [
            ["getConfig", false],
            ["saveConfig", true],
            ["testArk", false],
            ["testMinimax", false],
            ["listProjects", false],
            ["createProject", true],
            ["getProject", true],
            ["deleteProject", true],
            ["renameProject", true],
            ["uploadSource", true],
            ["savePrompts", true],
            ["saveSettings", true],
            ["setApproved", true],
            ["setReviewMode", true],
            ["reportClientOrigin", true],
            ["revealProject", true],
            ["runImage", true],
            ["runImages", true],
            ["setImageMode", true],
            ["runTurnVideo", true],
            ["runTurnFrames", true],
            ["setTurnPick", true],
            ["setTurnPicks", true],
            ["resetTurnPicks", true],
            ["cutTurnFrames", true],
            ["runVideos", true],
            ["pollVideos", true],
            ["clearVideos", true],
            ["runFrames", true],
            ["prepareFramePick", true],
            ["setFramePick", true],
            ["setFramePicks", true],
            ["resetFramePicks", true],
            ["rekey", true],
            ["compose", true],
            // 模块②：图片生成
            ["listImageJobs", false],
            ["createImageJob", true],
            ["getImageJob", true],
            ["deleteImageJob", true],
            ["saveImageJob", true],
            ["uploadImageRef", true],
            ["removeImageRef", true],
            ["addImageItem", true],
            ["removeImageItem", true],
            ["runImageJob", true],
            ["keyImageJob", true],
            // 模块③：序列帧生成
            ["listSequenceJobs", false],
            ["createSequenceJob", true],
            ["getSequenceJob", true],
            ["deleteSequenceJob", true],
            ["saveSequenceJob", true],
            ["uploadSequenceRef", true],
            ["removeSequenceRef", true],
            ["runSequenceVideo", true],
            ["pollSequenceVideo", true],
            ["clearSequenceVideo", true],
            ["runSequenceFrames", true],
            ["keySequenceFrames", true],
            ["composeSequence", true],
            // 模块④：骨骼动画生成
            ["listRigJobs", false],
            ["createRigJob", true],
            ["getRigJob", true],
            ["deleteRigJob", true],
            ["saveRigJob", true],
            ["uploadRigSource", true],
            ["uploadRigPart", true],
            ["removeRigPart", true],
            ["renameRigPart", true],
            ["setRigPartVisibility", true],
            ["saveRigLayoutItem", true],
            ["saveRigLayoutItems", true],
            ["setRigLayoutHints", true],
            ["setRigSemantics", true],
            ["setRigBoneOffsets", true],
            ["resetRigBoneOffsets", true],
            ["setRigAnimationSettings", true],
            ["resetRigAnimationSettings", true],
            ["getRigAnimation", true],
            ["saveRigAnimation", true],
            ["resetRigAnimation", true],
            ["runRigQa", true],
            ["setRigConstraints", true],
            ["resetRigConstraints", true],
            ["setRigMesh", true],
            ["resetRigMesh", true],
            ["setRigPath", true],
            ["resetRigPath", true],
            ["tintRigParts", true],
            ["uploadRigTexture", true],
            ["setRigTextureVersion", true],
            ["removeRigTextureVersion", true],
            ["runRigRedraw", true],
            ["runRigSheet", true],
            ["runRigSegment", true],
            ["runRigLayout", true],
            ["runRigBones", true],
            ["runRigAtlas", true],
            // 地图地块。
            // ⚠️ 第二个字段是「这个方法**收不收 payload**」，不是「要不要盖遮罩」。
            // 写成 false 而方法其实收 payload，typert 会在浏览器侧直接拒绝：
            //   client api: gameStudio/getTileProject expected 0 argument(s), got 1
            // 界面表现是「点了没反应 + 一行错误」，不会崩，所以很容易漏过去。
            // scripts/verify-tools.mjs 现在会把两边的 payload 布尔逐条比对（见该文件的
            // 「客户端清单的 payload 标记」），这类错配不会再溜过。
            ["listTileProjects", false],
            ["createTileProject", true],
            ["getTileProject", true],
            ["deleteTileProject", true],
            ["saveTileProject", true],
            ["runTileItems", true],
            ["runTileItem", true],
            ["setTileApproved", true],
            ["runTileMap", true],
            ["saveTileMapCells", true],
            ["runTileExport", true],
            ["cancelTileJob", true],
            ["revealTileProject", true],
            // 地图编辑器（模块六）。同样：第二个字段是「收不收 payload」。
            ["listMapProjects", false],
            ["createMapProject", true],
            ["getMapProject", true],
            ["saveMapProject", true],
            ["deleteMapProject", true],
            ["importMapTileset", true],
            ["saveMapTileset", true],
            ["removeMapTileset", true],
            ["saveMapFamilies", true],
            ["createMapDoc", true],
            ["saveMapDoc", true],
            ["deleteMapDoc", true],
            ["duplicateMapDoc", true],
            ["applyMapOps", true],
            ["mapUndo", true],
            ["mapRedo", true],
            ["mapPlan", true],
            ["runMapPreview", true],
            ["runMapExport", true],
            ["cancelMapJob", true],
            ["setMapApproved", true],
            ["revealMapProject", true]
        ];
        const CONTRIBUTION = {
            package: PACKAGE,
            descriptors: REMOTE_METHODS.map(([method, hasPayload]) => ({
                id: `${PACKAGE}#${SERVICE}/${method}`,
                service: SERVICE,
                namespace: SERVICE,
                method,
                invocation: { kind: "direct" },
                parameters: hasPayload
                    ? [{ name: "payload", wire: "payload", source: "json", codec: codec(`${PACKAGE}#${method}Payload`) }]
                    : [],
                result: codec(`${PACKAGE}#${method}Result`)
            }))
        };
        // ── 方向元数据（与宿主 src/directions.ts 保持一致）────────────────────
        // 这是 RPG 地图上的八方向行走：约定画面上方为北，角色在地图上朝哪个方位走。
        // 「看不看得见脸」由南北决定——朝北走就是背对镜头，不是抬头。
        function make_DIRECTIONS() {
            return [
                { key: "front", compass: "S", label: T("南 · 正对镜头"), refs: [T("源图")] },
                { key: "back", compass: "N", label: T("北 · 背对镜头"), refs: [T("南")] },
                { key: "downLeft", compass: "SW", label: T("西南 · 四分之三正面"), refs: [T("南")] },
                { key: "downRight", compass: "SE", label: T("东南 · 四分之三正面"), refs: [T("南")] },
                { key: "upLeft", compass: "NW", label: T("西北 · 四分之三背面"), refs: [T("北")] },
                { key: "upRight", compass: "NE", label: T("东北 · 四分之三背面"), refs: [T("北")] },
                { key: "left", compass: "W", label: T("西 · 左侧脸"), refs: [T("南"), T("北")] },
                { key: "right", compass: "E", label: T("东 · 右侧脸"), refs: [T("南"), T("北")] }
            ];
        }
        let DIRECTIONS = make_DIRECTIONS();
        const DIRECTION_KEYS = DIRECTIONS.map((d) => d.key);
        function make_LABEL_OF() {
            return Object.fromEntries(DIRECTIONS.map((d) => [d.key, d.label]));
        }
        let LABEL_OF = make_LABEL_OF();
        const COMPASS_OF = Object.fromEntries(DIRECTIONS.map((d) => [d.key, d.compass]));
        /** 屏幕位移向量 → 方向 key。dy > 0 是往画面下方走（向南）。 */
        function directionKeyFor(dx, dy) {
            if (dx === 0 && dy === 0)
                return null;
            if (dy > 0)
                return dx > 0 ? "downRight" : dx < 0 ? "downLeft" : "front";
            if (dy < 0)
                return dx > 0 ? "upRight" : dx < 0 ? "upLeft" : "back";
            return dx > 0 ? "right" : "left";
        }
        /** WASD 与方向键统一成四个布尔轴。 */
        const KEY_AXIS = {
            w: "up",
            arrowup: "up",
            s: "down",
            arrowdown: "down",
            a: "left",
            arrowleft: "left",
            d: "right",
            arrowright: "right"
        };
        // ── 宿主侧后台任务的覆盖面（与宿主 src/pipeline.ts 的 JobInfo.targets 对应）──
        /**
         * 找一个正在跑的后台任务。
         *
         * `getProject` 会把宿主的运行表一起带回来（`project.jobs`），这是「正在跑什么」
         * 的唯一真相：本地那张 pending 表只活到远程调用返回（批量提交是 kick 型调用，
         * 一提交就返回 `{started:true}`，真正的活还在后台），撑不住整段任务。
         */
        function hostJob(project, taskKey) {
            const list = Array.isArray(project?.jobs) ? project.jobs : [];
            return list.find((job) => job !== null && typeof job === "object" && job.key === taskKey);
        }
        /**
         * 这个方向是不是还在某个后台任务的覆盖面里（还没轮到，或者产物还没出来）。
         *
         * 拿它当「等待中」的依据，才能让「提取全部序列帧」这种一次两个方向慢慢做的
         * 批量任务，从点下去到结果出来**一路盖着遮罩**：抽帧一共八段，宿主是先给两个
         * 方向写 running 的，其余六个在那段时间里既没有 running 也没有产物，只看本地
         * pending 就会退化成「尚未抽帧」——看着像点击没生效，实测就是这个 bug。
         *
         * 覆盖面由宿主维护并在产物真的可见时逐个摘掉，所以这里不需要再猜。
         */
        function jobCovers(job, key) {
            return job !== undefined && Array.isArray(job.targets) && job.targets.includes(key);
        }
        /**
         * 实验性模块的呈现材料。
         *
         * `experimental` 只影响**呈现**：页签上加角标、进入时弹一次说明、模块里常驻一条提示条。
         * 功能本身一概不拦——链路照常可用，只是要让用户先知道现状，并把共建入口摆出来。
         */
        const EXPERIMENTAL_REPO = "https://github.com/universe-st/dsh-game-material-master";
        /** 模块④「骨骼动画生成」的实验性说明。 */
        function make_RIG_EXPERIMENTAL_POINTS() {
            return [
                T("功能还不完善：拆件质量取决于生图模型，自动装配与骨骼推导对真实立绘经常需要人工校正，导出的 Spine / DragonBones 产物也还没经足够的引擎侧验证。"),
                T("流程本身能走通（拆件 → 装配 → 骨骼 → 图集，每一步都有手工兜底），但请预期会出现需要反复调整的情况，暂时别把它当成稳定功能用。"),
                T("发现问题或有改进想法，欢迎到 GitHub 仓库一起开发。")
            ];
        }
        let RIG_EXPERIMENTAL_POINTS = make_RIG_EXPERIMENTAL_POINTS();
        /**
         * 模块⑤「45°地图地块生成」也是实验性功能。
         *
         * 为什么标实验性：几何管线（参考图、拼图、裁剪）全部是本地代码算的、有像素级自检，
         * 这块可靠；**不稳定的是「AI 能不能照着占格形状画出对的造型」** ——
         * 实测非矩形占地（L 形、3×1 长条）经常要人工反复重跑才能接受。
         */
        function make_TILE_EXPERIMENTAL_POINTS() {
            return [
                T("几何是可靠的：等距参考图、拼图与裁剪全部由本地代码计算，并有像素级自检兜底 —— 菱形比例、底面中心、包围盒都不会跑偏。"),
                T("不稳定的是**造型**：生图模型能否照着参考图的占格形状画出正确的建筑，取决于模型本身。实测非矩形占地（L 形、3×1 长条）经常需要反复重跑才可接受。"),
                T("发现问题或有改进想法，欢迎到 GitHub 仓库一起开发。")
            ];
        }
        let TILE_EXPERIMENTAL_POINTS = make_TILE_EXPERIMENTAL_POINTS();
        /** 进入模块⑥时的实验性说明要点（导入自己的 tileset 那条路）。 */
        function make_MAP_EXPERIMENTAL_POINTS() {
            return [
                T("这条路是全本地的：导入图集、切分、自动过渡、拼图、导出都在本机算，一次模型调用都没有，所以不花钱。"),
                T("与模块⑤不同：它不生成素材，只把你已有的 tileset 切成可用地块。自动过渡支持单块 / 16 掩码 / 47 掩码，缺掩码会回退并在覆盖率里标出来。"),
                T("界面上看到的地图与导出的 PNG 执行的是同一份绘制计划，所以不会有「预览好看、导出位移」这种事。"),
                T("发现问题或有改进想法，欢迎到 GitHub 仓库一起开发。")
            ];
        }
        let MAP_EXPERIMENTAL_POINTS = make_MAP_EXPERIMENTAL_POINTS();
        /** 六个功能模块。插件是「大师」，每个模块管一类素材。 */
        function make_MODULES() {
            return [
                { key: "sprite", title: T("八方向图生成"), hint: T("一张设定图 → 8 方向 × 8 帧精灵图") },
                { key: "image", title: T("图片生成"), hint: T("按提示词出图，可带参考图，支持抠绿幕导出 PNG") },
                { key: "sequence", title: T("序列帧生成"), hint: T("图/视频参考生成视频 → 抽帧 → 抠像 → 合成与播放预览") },
                { key: "rig", title: T("骨骼动画生成"), hint: T("拆件 → 装配定位 → 推骨骼与动画 → 打包 Spine 图集"), experimental: true },
                { key: "tile", title: T("45°地图地块生成"), hint: T("45° 等距地块 → 拼成地图：几何交给代码，内容交给 AI"), experimental: true },
                { key: "map", title: T("地图编辑器"), hint: T("导入自己的 tileset → 自动过渡 → 多层拼图 → 导出 Tiled"), experimental: true }
            ];
        }
        let MODULES = make_MODULES();
        /** 地图编辑器（模块六）的四个阶段（对齐宿主 src/links.ts 的 MAP_STAGES）。 */
        function make_MAP_STAGES() {
            return [
                { key: "assets", title: T("① 图集"), hint: T("导入你自己的 tileset 图，按网格或矩形切分，再把图块归入地形族") },
                { key: "rules", title: T("② 规则"), hint: T("定义地形族与自动过渡（单块 / 16 掩码 / 47 掩码），缺的块会标出来") },
                { key: "paint", title: T("③ 地图"), hint: T("多张地图、多图层、每层高度偏移；画布上直接刷，撤销重做都在宿主") },
                { key: "export", title: T("④ 导出"), hint: T("PNG 分层与合并 + 自有 JSON + Tiled .tmj/.tsj，全部本地免费") }
            ];
        }
        let MAP_STAGES = make_MAP_STAGES();
        /** 三种自动过渡方案（对齐宿主 src/mapauto.ts 的 AUTOTILE_SCHEMES）。 */
        function make_MAP_AUTOTILE_SCHEMES() {
            return [
                { key: "single", title: T("单块（不自动过渡）") },
                { key: "corner16", title: T("四邻域 16 掩码") },
                { key: "blob47", title: T("八邻域 47 掩码（blob）") }
            ];
        }
        let MAP_AUTOTILE_SCHEMES = make_MAP_AUTOTILE_SCHEMES();
        /** 编辑器工具（纯界面概念，宿主不认识）。 */
        function make_MAP_TOOL_LABELS() {
            return { paint: T("画笔"), erase: T("橡皮"), fill: T("填充"), rect: T("矩形"), pick: T("吸管") };
        }
        function make_MAP_TOOL_HINTS() {
            return {
                paint: T("按住拖动画线（B）"),
                erase: T("擦成空（E）"),
                fill: T("同色连通区一次填满（G）"),
                rect: T("拖出矩形，按住「矩形填充」为实心（R）"),
                pick: T("吸取格子上的图块（I）")
            };
        }
        let MAP_TOOL_LABELS = make_MAP_TOOL_LABELS();
        let MAP_TOOL_HINTS = make_MAP_TOOL_HINTS();
        /** 地图地块的四个阶段（对齐宿主 src/links.ts 的 TILE_STAGES）。 */
        function make_TILE_STAGES() {
            return [
                { key: "generate", title: T("① 生成地块"), hint: T("按占格形状自动渲染等距参考图交给 Seedream 填内容。这一步真实计费，每个变体一次调用") },
                { key: "review", title: T("② 验收"), hint: T("逐项看几何报告与成品，不满意的单张重跑") },
                { key: "map", title: T("③ 拼成地图"), hint: T("本地按等距网格铺图，按类别随机抽变体。免费，可反复换种子") },
                { key: "export", title: T("④ 导出"), hint: T("导出地块包与地图 PNG / JSON") }
            ];
        }
        let TILE_STAGES = make_TILE_STAGES();
        function make_STAGES() {
            return [
                { key: "images", title: T("① 八方向绿幕图"), hint: T("以源图为基准，按依赖顺序生成八个方位的纯绿幕全身图") },
                { key: "videos", title: T("② 行走动作视频"), hint: T("固定镜头、固定背景，让角色朝原方位原地走三步") },
                { key: "frames", title: T("③ 提取序列帧"), hint: T("可整批等分抽帧，也可对每一段视频手动选帧") },
                { key: "sheet", title: T("④ 抠绿幕合成整图"), hint: T("剔除绿幕并按行序拼成一张精灵图") },
                { key: "preview", title: T("⑤ 行走预览"), hint: T("用 WASD 或方向键操控角色，看看八方向接起来顺不顺") }
            ];
        }
        let STAGES = make_STAGES();
        // ── 功能管理（被隐藏的模块）──────────────────────────────────────────
        //
        // 设置页「功能管理」写、工作台页签与侧栏菜单读，所以状态放在工厂闭包里共享
        // 一份，而不是各自去 `getConfig()`。
        //
        // 「隐藏」是**双向**的：这里只管界面，对话工具面由宿主 `src/tools.ts` 再拦
        // 一次（`hiddenModules` 存在宿主配置里，两侧读的是同一份）。只藏界面不拦
        // 工具等于没藏——模型照样能调生成类方法，真实计费。
        const hiddenModulesState = { keys: [], listeners: new Set() };
        /** 收敛成合法且顺序固定的 key 数组（与宿主 `normalizeHiddenModules` 同口径）。 */
        function normalizeHiddenKeys(value) {
            if (!Array.isArray(value))
                return [];
            return MODULES.map((entry) => entry.key).filter((key) => value.includes(key));
        }
        /** 写入并通知订阅者；内容没变就不通知（避免无谓重渲染）。 */
        function publishHiddenModules(value) {
            const next = normalizeHiddenKeys(value);
            if (next.length === hiddenModulesState.keys.length && next.every((key, index) => key === hiddenModulesState.keys[index]))
                return;
            hiddenModulesState.keys = next;
            for (const listener of [...hiddenModulesState.listeners]) {
                try {
                    listener(next);
                }
                catch {
                    // 单个订阅者出错不该拖垮别的。
                }
            }
        }
        /** 从宿主读一次当前可见性。读失败就当作「全部可见」，不要因此白屏。 */
        async function refreshHiddenModules(api) {
            if (api === undefined)
                return;
            try {
                const config = await api.getConfig();
                publishHiddenModules(config?.hiddenModules);
            }
            catch {
                // 配置读不到不是致命错误：界面照常，工具面仍然会拦。
            }
        }
        /**
         * 组件里用：当前被隐藏的模块 key 数组。
         *
         * `api` 可省略（那时只订阅、不主动拉取）——设置页自己会 `load()` 并 publish。
         */
        function useHiddenModules(api) {
            const [hidden, setHidden] = React.useState(hiddenModulesState.keys);
            React.useEffect(() => {
                hiddenModulesState.listeners.add(setHidden);
                // 订阅之前可能已经有值了（设置页先加载完），补一次对齐。
                setHidden(hiddenModulesState.keys);
                return () => {
                    hiddenModulesState.listeners.delete(setHidden);
                };
            }, []);
            React.useEffect(() => {
                void refreshHiddenModules(api);
            }, [api]);
            return hidden;
        }
        /** 可见的模块（页签、侧栏菜单都按它渲染）。 */
        function visibleModulesOf(hidden) {
            return MODULES.filter((entry) => !hidden.includes(entry.key));
        }
        // ── 深链接：从会话里点一下链接就切到插件对应页面 ─────────────────────
        //
        // 宿主 src/links.ts 是这套约定的唯一真源；这里只能复制常量（浏览器半区是
        // 经典脚本，不能 import），两边的一致性由 scripts/verify-tools.mjs 的
        // 文本契约钉住：参数名、模块名、面板 id 任一处改动都会让本地测试失败。
        //
        // 拦截方式刻意选在**捕获阶段**：会话正文的 Markdown 渲染器会给所有
        // http(s) 链接加 target="_blank"，不拦就会真的新开一个标签页。
        // 只按 `dsh-gmm` 参数识别自己的链接，其它链接（含站外的）一律放行。
        const OPEN_QUERY_KEY = "dsh-gmm";
        const OPEN_MODULES = new Set(["sprite", "image", "sequence", "rig", "tile", "map"]);
        /** 意图订阅者：各模块组件都挂着，谁在挂载谁就被通知。 */
        const intentListeners = new Set();
        /** 最近一次意图。晚挂载的组件（切模块后才渲染）订阅时立刻拿到它。 */
        let pendingIntent = null;
        function subscribeIntent(listener) {
            intentListeners.add(listener);
            if (pendingIntent !== null)
                listener(pendingIntent);
            return () => {
                intentListeners.delete(listener);
            };
        }
        /** 组件里用：拿到最近一次深链接意图（没有就是 null）。 */
        function useStudioIntent() {
            const [intent, setIntent] = React.useState(null);
            React.useEffect(() => subscribeIntent(setIntent), []);
            return intent;
        }
        /** 解析查询串。不是我们的链接就返回 null（宿主侧 links.ts 的同名实现）。 */
        function parseIntents(search) {
            let params;
            try {
                params = new URLSearchParams(typeof search === "string" ? search : "");
            }
            catch {
                return null;
            }
            if (!params.has(OPEN_QUERY_KEY))
                return null;
            const intent = {};
            const module = params.get("module");
            if (module !== null && OPEN_MODULES.has(module))
                intent.module = module;
            const projectId = params.get("project");
            if (projectId)
                intent.projectId = projectId;
            const jobId = params.get("job");
            if (jobId)
                intent.jobId = jobId;
            const stage = params.get("stage");
            if (stage)
                intent.stage = stage;
            const direction = params.get("direction");
            if (direction)
                intent.direction = direction;
            return intent;
        }
        /**
         * 切到工作台面板并广播意图。
         *
         * `layout.selectPanel` 在面板还没注册时会抛错（插件 apply 与页面启动有先后），
         * 所以这里带重试；重试期间意图已经广播出去了，组件挂载后会自己接上。
         */
        function openStudioIntent(ctx, intent, attempt = 0) {
            pendingIntent = intent;
            for (const listener of [...intentListeners]) {
                try {
                    listener(intent);
                }
                catch {
                    // 单个订阅者出错不该拖垮切换本身。
                }
            }
            const layout = ctx.get("layout");
            if (layout === undefined)
                return;
            try {
                layout.selectPanel(GAME_STUDIO_PANEL_ID);
            }
            catch {
                if (attempt < 20 && typeof window !== "undefined") {
                    window.setTimeout(() => openStudioIntent(ctx, intent, attempt + 1), 150);
                }
            }
        }
        function intentOfAnchor(event) {
            if (event.button !== 0)
                return null;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return null; // 让浏览器按用户意图新开标签页
            const target = event.target;
            if (target === null || target === undefined || typeof target.closest !== "function")
                return null;
            const anchor = target.closest("a[href]");
            if (anchor === null)
                return null;
            let url;
            try {
                url = new URL(anchor.getAttribute("href"), window.location.origin);
            }
            catch {
                return null;
            }
            return parseIntents(url.search);
        }
        /** 捕获阶段拦下深链接点击：原地切面板，不跳转、不新开标签。 */
        function installIntentInterceptor(ctx) {
            if (typeof document === "undefined" || typeof window === "undefined" || window.location === undefined)
                return () => { };
            const onClick = (event) => {
                if (event.defaultPrevented)
                    return;
                let intent;
                try {
                    intent = intentOfAnchor(event);
                }
                catch {
                    return;
                }
                if (intent === null)
                    return;
                event.preventDefault();
                event.stopPropagation();
                openStudioIntent(ctx, intent);
            };
            document.addEventListener("click", onClick, true);
            return () => document.removeEventListener("click", onClick, true);
        }
        /**
         * 直接以 `/?dsh-gmm=…` 打开时的兜底路径（中键、Ctrl+点击、或用户手动贴链接）：
         * 应用正常启动，这里读一次查询参数、把它从地址栏清掉、再切面板。
         */
        function consumeUrlIntent(ctx) {
            if (typeof window === "undefined" || window.location === undefined)
                return;
            const intent = parseIntents(window.location.search);
            if (intent === null)
                return;
            try {
                const url = new URL(window.location.href);
                // 确认过 dsh-gmm 才走到这里，所以这几个键一定是本插件写的，一起清掉。
                for (const key of [OPEN_QUERY_KEY, "module", "project", "job", "stage", "direction"]) {
                    url.searchParams.delete(key);
                }
                window.history.replaceState(null, "", url.toString());
            }
            catch {
                // 清不掉参数也不影响切换，忽略。
            }
            openStudioIntent(ctx, intent);
        }
        /**
         * 把真实 origin 报给宿主：宿主不知道对外地址（可能被反代改写），
         * 而模型要在回复里贴出可点的绝对链接。失败不影响任何功能。
         */
        function reportClientOrigin(api) {
            if (typeof window === "undefined" || window.location === undefined)
                return;
            const origin = window.location.origin;
            if (typeof origin !== "string" || origin === "" || origin === "null")
                return;
            void Promise.resolve(api.reportClientOrigin({ origin })).catch(() => undefined);
        }
        // ── 样式 ─────────────────────────────────────────────────────────────
        // ⚠️ `.SPR_root` 上的 `overflow-y:auto` 不能删。
        // 面板的外层（DSH 的 `.BynINW_centerCol` / `.BynINW_frame`）是 `overflow:hidden`，
        // 而 `.SPR_root` 是 `height:100%`，所以内容一旦超过面板高度就会被**直接裁掉**，
        // 既看不到下半截、也没法滚动。
        // 实测：模块五「地图地块生成」的五个阶段加起来 810px > 面板 686px，底部的地块卡片
        // 就被切了；而前四个模块恰好都在 686 以内，所以这个坑一直没暴露出来。
        const CSS = `
.SPR_root{display:flex;flex-direction:column;height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.SPR_head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.SPR_head h2{margin:0;font-size:15px;font-weight:600}
.SPR_headSub{color:var(--dsw-alias-label-tertiary);font-size:12px}
.SPR_spacer{flex:1}
.SPR_body{display:flex;flex:1;min-height:0}
.SPR_side{width:220px;flex:none;border-right:1px solid var(--dsw-alias-border-l2);padding:12px;overflow:auto;display:flex;flex-direction:column;gap:8px}
.SPR_sideTitle{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:0 2px}
.SPR_projItem{display:flex;flex-direction:column;gap:2px;text-align:left;width:100%;font:inherit;cursor:pointer;background:transparent;border:1px solid transparent;border-radius:8px;padding:7px 9px;color:var(--dsw-alias-label-primary)}
.SPR_projItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.SPR_projItem[data-active=true]{background:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-border-l1)}
.SPR_projName{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_projMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.SPR_main{flex:1;min-width:0;overflow:auto;padding:16px 18px 40px}
.SPR_steps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.SPR_step{font:inherit;font-size:12px;cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:5px 12px;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;gap:6px}
.SPR_step[data-active=true]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 28%, transparent)}
.SPR_stepDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
/* ── 地图地块生成（模块五）─────────────────────────────────────────────
   地块卡片要能一眼看出「几何对不对」：缩略图按 2:3 显示（单元格 64×96），
   下面跟一枚几何角标（2:1 · 实测比例）。角标是这一屏最有信息量的东西。 */
.SPR_tileHeader{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.SPR_tileStage{display:flex;flex-direction:column;gap:12px}
.SPR_tileGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.SPR_tileCard{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}
.SPR_tileCardHead{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.SPR_tileCardTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.SPR_tileThumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:8px}
.SPR_tileThumb{display:flex;flex-direction:column;gap:4px;align-items:center}
.SPR_tileThumb .SPR_thumb{aspect-ratio:2/3;max-height:150px}
.SPR_thumb-empty{display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;min-height:100px}
.SPR_tileBadge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.SPR_tileBadge-ok{color:var(--dsw-alias-state-success-primary,#2e7d32);border-color:currentColor}
.SPR_tileBadge-warn{color:var(--dsw-alias-state-warning-primary,#b26a00);border-color:currentColor}
.SPR_tileBadge-bad{color:var(--dsw-alias-state-error-primary,#c62828);border-color:currentColor}
.SPR_tileProgress{font-size:12px;color:var(--dsw-alias-label-secondary);padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3)}
.SPR_tileAsset{display:flex;flex-direction:column;gap:4px;align-items:center;width:140px}
.SPR_tileMap{max-width:100%;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background-color:var(--dsw-alias-bg-layer-3)}
/* 地块清单编辑器：一行放几个字段，窄屏自动换行 */
.SPR_tileEditor{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1)}
.SPR_tileEditorRow{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.SPR_tileEditorRow .SPR_field{flex:1;min-width:130px}
.SPR_tilePrompt{width:100%;font:inherit;line-height:1.5;resize:vertical;box-sizing:border-box}
.SPR_tilePromptPreview summary{font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.SPR_tilePromptPreview pre{white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.55;margin:6px 0 0;padding:8px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);max-height:220px;overflow:auto}
.SPR_tileCard-editing{grid-column:1/-1}
/* 地图布局编辑器：等距叠层，每个格子裁成菱形，只有菱形那部分能点 */
.SPR_mapBrush{display:flex;gap:6px;flex-wrap:wrap}
/* 笔刷按用途分组：地面 / 装饰 / 建筑，避免「刷树把草顶掉」这种误会 */
/* 幽灵预览（红警盖房子那套）：占格外框 + 可放/不可放配色 */
.SPR_mapGhost{position:absolute;pointer-events:none;z-index:5}
.SPR_mapGhostCell{position:absolute;border:2px solid transparent;box-sizing:border-box;clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%)}
.SPR_mapGhost-ok .SPR_mapGhostCell{background:rgba(80,220,120,0.28);border-color:rgba(40,180,80,0.9)}
.SPR_mapGhost-bad .SPR_mapGhostCell{background:rgba(240,80,80,0.30);border-color:rgba(200,40,40,0.9)}
/* 占格高亮：能放=绿底，不能放=红底（只高亮一格时用户不知道会盖多大一片） */
.SPR_mapCell-ghostOk{background:rgba(80,220,120,0.22)}
.SPR_mapCell-ghostBad{background:rgba(240,80,80,0.24)}
.SPR_mapBrushGroup{display:inline-flex;align-items:center;gap:6px;padding:2px 6px;border-radius:8px;border:1px dashed var(--dsw-alias-border-l2)}
.SPR_mapBrushLabel{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
/* 还没生成的参考图：占位块，**不挂 <img>**（挂了就是 404 裂图） */
.SPR_tileAsset-pending{opacity:.62}
.SPR_thumb-pending{display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;min-width:96px;min-height:96px;box-sizing:border-box}
/* 形状编辑器：小网格点选占格。左上角是锚点（恒亮、不可取消）。 */
.SPR_shapeEditor{display:flex;flex-direction:column;gap:4px}
.SPR_shapeGrid{display:inline-block;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:3px;background:var(--dsw-alias-bg-layer-2)}
.SPR_shapeRow{display:flex;gap:3px}
.SPR_shapeRow+.SPR_shapeRow{margin-top:3px}
.SPR_shapeCell{width:22px;height:22px;padding:0;border-radius:4px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);transition:background .08s}
.SPR_shapeCell:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.SPR_shapeCell-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.SPR_shapeCell-anchor{cursor:default;box-shadow:inset 0 0 0 2px var(--dsw-alias-bg-layer-1)}
.SPR_mapEditorWrap{overflow:auto;max-height:460px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);padding:8px}
/* 缩放容器：外层占的是**缩放后**的尺寸，内层用 transform 缩放整张叠层 */
.SPR_mapEditorFit{position:relative;margin:0 auto;overflow:hidden}
.SPR_mapEditorScaler{transform-origin:0 0}
.SPR_mapEditorCanvas{position:relative}
/* 即时预览层：贴在格子下面，不接事件（点击交给上面的可点格子） */
.SPR_mapArt{position:absolute;pointer-events:none;image-rendering:pixelated}
/* 装饰与建筑层同理，都必须是绝对定位 —— 少了 position 它们会退回文档流，
   top/left 完全不生效，表现是「所有装饰挤在画布左上角」（实测踩过）。 */
.SPR_mapDecor{position:absolute;pointer-events:none;image-rendering:pixelated}
.SPR_mapBuild{position:absolute;pointer-events:none}
.SPR_mapBuildImg{position:absolute;image-rendering:pixelated}
.SPR_mapUnder{opacity:1}
.SPR_mapCell{position:absolute;padding:0;margin:0;border:none;background:rgba(90,150,60,.34);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;color:transparent;transition:background .08s}
.SPR_mapCell:hover{background:rgba(255,196,0,.55)}
.SPR_mapCell-active{background:rgba(255,120,0,.6);outline:1px solid rgba(255,120,0,.9)}
.SPR_mapCell-empty{background:rgba(150,150,150,.16)}
.SPR_mapCellLabel{pointer-events:none;font-size:10px;color:var(--dsw-alias-label-secondary);opacity:0}
.SPR_meStage{display:flex;flex-direction:column;gap:10px}
.SPR_meCard{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-3)}
.SPR_meCard>h4{margin:0;font-size:13px}
.SPR_meCardHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.SPR_meHint{font-size:11px;color:var(--dsw-alias-label-tertiary);margin:0}
.SPR_meWarn{font-size:11px;color:var(--dsw-alias-label-error, #d24);margin:0}
.SPR_meWarnings{margin:0;padding-left:18px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.SPR_meSliceRow{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end}
.SPR_mePaletteWrap{display:flex;flex-direction:column;gap:6px}
/*
 * 盒子由 aspect-ratio + 最大宽度定死（见 mapPaletteBox），图与叠加层**共用同一个盒子**，
 * 图块的 left/top/width/height 一律写百分比 —— 图被缩放时叠加层跟着缩放。
 * ⚠️ 别再改回「图片原图像素」定位：.SPR_mePaletteImg 会被面板宽度压小，
 * 而 px 定位不跟着缩，2048px 的图集缩到 893px 后格子仍画在 0..2048 的原坐标，
 * 于是高亮框与可见图块错位、面板被撑到 2049px 高（真机：上传 2048×2048 后「显示就坏了」）。
 */
.SPR_mePalette{position:relative;align-self:flex-start;line-height:0;overflow:hidden;background:repeating-conic-gradient(#0000 0% 25%,#00000010 0% 50%) 50%/12px 12px;border:1px solid var(--dsw-alias-border-l2)}
.SPR_mePaletteImg{image-rendering:pixelated;width:100%;height:100%;display:block}
.SPR_mePaletteCell{position:absolute;padding:0;margin:0;border:none;background:transparent;cursor:pointer}
.SPR_mePaletteCell:hover{background:rgba(255,196,0,.35);outline:1px solid rgba(255,196,0,.9)}
.SPR_mePaletteCell[data-selected="true"]{background:rgba(255,120,0,.45);outline:1px solid rgba(255,120,0,1)}
.SPR_meGridV{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,0,255,.5);pointer-events:none}
.SPR_meGridH{position:absolute;left:0;right:0;height:1px;background:rgba(255,0,255,.5);pointer-events:none}
.SPR_meFamilyRow{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.SPR_meFamilyChip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 9px;font-size:12px;background:transparent;cursor:pointer}
.SPR_meFamilyChip[data-ok="true"]{border-color:rgba(80,200,120,.8)}
.SPR_meFamilyDot{width:9px;height:9px;border-radius:50%;display:inline-block}
.SPR_meFamilyCount{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.SPR_meFamilyEdit{display:flex;flex-direction:column;gap:6px}
.SPR_meFamilyEditRow{display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap}
.SPR_meName{min-width:110px}
.SPR_meCoverage{display:flex;flex-direction:column;gap:4px;font-size:12px}
.SPR_meCoverageRow{display:flex;gap:10px;align-items:center}
.SPR_meCoverageRow[data-ok="true"] .SPR_meOk{color:#3fa85f}
.SPR_meOk{color:#3fa85f}
.SPR_meBad{color:#d24}
.SPR_meShots{display:flex;gap:8px;flex-wrap:wrap}
.SPR_meShot{max-width:220px;max-height:160px;image-rendering:pixelated;border:1px solid var(--dsw-alias-border-l2)}
.SPR_meEditorWrap{display:flex;flex-direction:column;gap:8px}
.SPR_meToolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.SPR_meToolLabel{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.SPR_meLayerName{font-size:12px}
.SPR_meZoom{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.SPR_meCheck{display:inline-flex;align-items:center;gap:4px;font-size:11px}
.SPR_meCanvas{width:100%;height:420px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);cursor:crosshair;touch-action:none}
.SPR_meLayerList{display:flex;flex-direction:column;gap:6px}
.SPR_meLayerRow{display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;padding:4px;border-radius:8px;border:1px dashed transparent}
.SPR_meLayerRow[data-active="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2, rgba(0,0,0,.03))}
.SPR_meLayerPick{border:none;background:transparent;cursor:pointer;font-size:12px;padding:2px 4px;text-align:left}
.SPR_meMapList{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.SPR_meMapChip{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font-size:12px;background:transparent;cursor:pointer}
.SPR_meMapChip[data-active="true"]{background:rgba(120,180,255,.22);border-color:rgba(120,180,255,.9)}
.SPR_meBusy{font-size:11px;color:var(--dsw-alias-label-warning, #c80)}
.SPR_meFileList{margin:0;padding-left:18px;font-size:11px;line-height:1.7}

.SPR_mapCell:hover .SPR_mapCellLabel{opacity:1}
.SPR_step-active{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary)}
.SPR_step-done .SPR_stepMark{color:var(--dsw-alias-state-success-primary,#2e7d32)}
.SPR_step-error .SPR_stepMark{color:var(--dsw-alias-state-error-primary,#c62828)}
.SPR_stepMark{font-size:11px}
/* ⚠️ 面板的 .SPR_module 是 display:flex;flex-direction:column，所以 .SPR_row
   作为 flex item 会被算成 display:block —— 这会把 .SPR_field-inline 的
   inline-flex 压掉，四个数字输入框就**竖着排**（实测踩过，看着像样式坏了）。
   这里显式把行声明成 flex，让行内的 field 横向排。 */
.SPR_tileStage .SPR_row{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
.SPR_field-inline{display:inline-flex;align-items:center;gap:6px}
.SPR_input-num{width:84px}
.SPR_btn-mini{font-size:11px;padding:2px 8px}
.SPR_btn-on{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}
.SPR_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:14px;margin-bottom:14px}.SPR_cardHead{display:flex;align-items:baseline;gap:8px;margin-bottom:4px;flex-wrap:wrap}
.SPR_cardHead h3{margin:0;font-size:13px;font-weight:600}
.SPR_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0 0 10px}
.SPR_toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}
.SPR_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:10px}
.SPR_node{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px;display:flex;flex-direction:column;gap:8px;min-width:0}
.SPR_node[data-stale=true]{border-color:color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d9930d) 55%, transparent)}
.SPR_nodeTop{display:flex;align-items:center;gap:7px}
.SPR_nodeTitle{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_thumb{width:100%;aspect-ratio:1/1;object-fit:contain;border-radius:8px;display:block;background-color:var(--dsw-alias-bg-layer-3);background-image:linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%),linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%);background-size:16px 16px;background-position:0 0,8px 8px}
.SPR_thumbEmpty{width:100%;aspect-ratio:1/1;border-radius:8px;border:1px dashed var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center;padding:8px;box-sizing:border-box}
.SPR_refRow{color:var(--dsw-alias-label-tertiary);font-size:11px}
.SPR_error{color:var(--dsw-alias-state-error-primary);font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0}
.SPR_chip{font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none}
.SPR_chip[data-kind=ready]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary)}
.SPR_chip[data-kind=running]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary)}
.SPR_chip[data-kind=error]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);color:var(--dsw-alias-state-error-primary)}
.SPR_chip[data-kind=approved]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent);color:var(--dsw-alias-state-success-primary)}
.SPR_chip[data-kind=stale]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d9930d) 16%, transparent);color:var(--dsw-alias-state-warning-primary, #a06a00)}
.SPR_btn{font:inherit;font-size:12px;cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 11px;color:var(--dsw-alias-label-primary);white-space:nowrap}
.SPR_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.SPR_btn:disabled{cursor:default;opacity:.5}
.SPR_btn[data-primary=true]{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-state-business-on-primary, #fff)}
.SPR_btn[data-on=true]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.SPR_btn[data-danger=true]{color:var(--dsw-alias-state-error-primary)}
.SPR_btnRow{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto}
.SPR_area{width:100%;box-sizing:border-box;min-height:96px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px}
.SPR_input{box-sizing:border-box;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 9px;width:100%}
.SPR_field{display:flex;flex-direction:column;gap:4px;min-width:0}
.SPR_fieldLabel{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.SPR_fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:10px 0}
.SPR_note{border-radius:8px;padding:8px 11px;font-size:12px;margin:0 0 10px;border:1px solid transparent;white-space:pre-wrap}
.SPR_note[data-kind=error]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);color:var(--dsw-alias-state-error-primary)}
.SPR_note[data-kind=info]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 32%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent)}
.SPR_note[data-kind=ok]{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent);color:var(--dsw-alias-state-success-primary)}
.SPR_sheetWrap{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,rgba(128,128,128,.16) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.16) 75%),linear-gradient(45deg,rgba(128,128,128,.16) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.16) 75%);background-size:20px 20px;background-position:0 0,10px 10px;overflow:auto;max-height:70vh}
.SPR_sheet{display:block;width:100%;image-rendering:pixelated}
.SPR_log{margin-top:14px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}
.SPR_logList{margin:0;padding:0;list-style:none;max-height:180px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:11px;line-height:17px}
.SPR_logList li{display:flex;gap:8px;white-space:pre-wrap;word-break:break-word}
.SPR_logTime{color:var(--dsw-alias-label-tertiary);flex:none}
.SPR_logHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.SPR_logFilters{display:flex;align-items:center;gap:6px;margin-left:auto}
.SPR_logElapsed{color:var(--dsw-alias-label-tertiary);flex:none}
.SPR_logList li[data-level=error]{color:var(--dsw-alias-state-error-primary)}
.SPR_logList li[data-level=warn]{color:var(--dsw-alias-state-warning-primary, #a06a00)}
.SPR_empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:30px 0;text-align:center}
.SPR_drop{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:14px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
.SPR_drop[data-over=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.SPR_sourceRow{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
.SPR_sourcePreview{width:132px;height:132px;object-fit:contain;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex:none}
.SPR_rowOrder{display:flex;flex-direction:column;gap:5px;max-width:260px}
.SPR_rowOrderItem{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;background:var(--dsw-alias-bg-layer-1)}
.SPR_rowOrderIdx{color:var(--dsw-alias-label-tertiary);font-size:11px;width:16px;font-variant-numeric:tabular-nums}
.SPR_rowOrderName{flex:1}
.SPR_miniBtn{font:inherit;font-size:11px;cursor:pointer;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px;color:var(--dsw-alias-label-secondary)}
.SPR_miniBtn:disabled{opacity:.4;cursor:default}
.SPR_settings{max-width:720px;display:flex;flex-direction:column;gap:14px}
.SPR_settingsGroup{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px;background:var(--dsw-alias-bg-layer-3)}
.SPR_settingsGroup h3{margin:0 0 4px;font-size:13px;font-weight:600}
.SPR_settingsGroup p{margin:0 0 10px;color:var(--dsw-alias-label-tertiary);font-size:12px}
/* 功能管理：一行一个模块，勾选框在左、说明在中间、状态在右。 */
.SPR_featureList{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.SPR_featureRow{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.SPR_featureRow[data-hidden=true]{opacity:.62}
.SPR_featureCheck{margin:2px 0 0;width:15px;height:15px;flex:none;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
.SPR_featureText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.SPR_featureTitle{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.SPR_featureHint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.SPR_featureState{font-size:11px;line-height:18px;flex:none;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary)}
.SPR_keyRow{display:flex;gap:8px;align-items:flex-end}
.SPR_keyRow .SPR_field{flex:1}
.SPR_badge{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}
.SPR_videoWrap{position:relative;width:100%}
.SPR_video{width:100%;border-radius:8px;display:block;background:#000}
/* 转圈视频多半是竖屏（角色立绘比例）：按 width:100% 铺开会有上千像素高，把下面的
   时间轴与八个方向图全顶出屏幕，所以改成按高度封顶、水平居中。 */
.SPR_videoTurn{width:auto;max-width:100%;max-height:360px;margin:0 auto}
/* 双击看大图：序列帧缩略图太小，看不清动作与抠像质量 */
.SPR_zoomMask{position:fixed;inset:0;z-index:80;background:rgba(10,12,16,.84);display:flex;align-items:center;justify-content:center;padding:28px;box-sizing:border-box;cursor:zoom-out}
.SPR_zoomImg{max-width:92vw;max-height:82vh;object-fit:contain;image-rendering:pixelated;border-radius:8px;background-color:var(--dsw-alias-bg-layer-1);cursor:default;box-shadow:0 14px 44px rgba(0,0,0,.5)}
.SPR_zoomClose{position:absolute;top:16px;right:20px;width:36px;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.34);background:rgba(28,32,40,.86);color:#fff;font-size:20px;line-height:1;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;padding:0}
.SPR_zoomClose:hover{background:rgba(64,70,82,.96)}
.SPR_zoomCaption{position:absolute;left:20px;right:20px;bottom:16px;text-align:center;color:#e9ebf1;font-size:12px}
.SPR_input[data-dirty=true]{border-color:var(--dsw-alias-state-business-primary)}
/* 阶段①的生成方式切换（转圈截帧为默认，逐方向生图为备选） */
.SPR_modeBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px}
.SPR_modeBarLabel{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.SPR_mode{font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:4px 12px;color:var(--dsw-alias-label-secondary)}
.SPR_mode[data-active=true]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 28%, transparent)}
.SPR_modeTag{font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:#fff}
.SPR_modeBarHint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
/* 转圈截帧的时间轴：缩略条带 + 八个可拖动的圆圈 */
.SPR_axisWrap{margin:12px 0 4px}
.SPR_axis{position:relative;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:34px 0 8px;touch-action:none;user-select:none}
.SPR_axis[data-dragging=true]{cursor:ew-resize}
.SPR_axisStrip{display:block;width:100%;border-radius:6px;pointer-events:none;-webkit-user-drag:none}
.SPR_axisDot{position:absolute;transform:translateX(-50%);min-width:30px;padding:2px 6px;display:flex;flex-direction:column;align-items:center;gap:0;font:inherit;font-size:11px;line-height:14px;cursor:grab;border:1px solid var(--dsw-alias-state-business-primary);border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px rgba(0,0,0,.22)}
.SPR_axisDot:active{cursor:grabbing}
.SPR_axisDot[data-active=true]{box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent)}
.SPR_axisDot[data-approved=true]{border-color:var(--dsw-alias-state-success-primary)}
.SPR_axisDot[data-approved=true] .SPR_axisDotIndex{color:var(--dsw-alias-state-success-primary)}
.SPR_axisDotLabel{font-weight:600;white-space:nowrap}
.SPR_axisDotIndex{font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.SPR_axisRuler{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:6px}
.SPR_axisRulerMid{text-align:center}
.SPR_pickPanel{grid-column:1 / -1;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px;background:var(--dsw-alias-bg-layer-1)}
.SPR_pickHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.SPR_modules{display:flex;gap:8px;padding:10px 18px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;flex-wrap:wrap;align-items:center}
.SPR_modulesHiddenNote{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-left:auto}
.SPR_module{font:inherit;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:1px;padding:6px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.SPR_module:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.SPR_module[data-active=true]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent)}
.SPR_moduleTitle{font-size:13px;font-weight:600}
.SPR_moduleHint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.SPR_thumbSm{width:44px;height:44px;object-fit:contain;border-radius:6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);flex:none}
.SPR_thumbMd{width:104px;height:104px;object-fit:contain;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);flex:none;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%),linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%);background-size:16px 16px;background-position:0 0,8px 8px}
.SPR_player{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:#fff;padding:10px;display:flex;justify-content:center;overflow:auto;max-height:60vh}
.SPR_canvasPlayer{display:block;max-width:100%;image-rendering:pixelated}
.SPR_frames{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.SPR_frame{width:64px;height:64px;object-fit:contain;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%),linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%);background-size:12px 12px;background-position:0 0,6px 6px}
.SPR_stage{position:relative;outline:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;background:#fff;cursor:pointer;line-height:0}
.SPR_stage[data-focused=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent)}
.SPR_canvas{display:block;width:100%;height:auto;image-rendering:pixelated}
.SPR_stageHint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.74);color:#333;font-size:13px;line-height:20px;font-family:inherit}
.SPR_hud{position:absolute;left:10px;top:10px;display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.62);color:#fff;border-radius:999px;padding:3px 12px;font-size:12px;line-height:18px;pointer-events:none;font-family:inherit}
.SPR_hudDir{font-weight:600;letter-spacing:.5px}

/* ── 模块④：骨骼动画生成 ─────────────────────────────────────────────── */
.SPR_link{color:var(--dsw-alias-state-business-primary);font-size:12px;text-decoration:none;align-self:center}
.SPR_link:hover{text-decoration:underline}
/* 面板根必须自己是滚动容器：SPR_root 是定高 flex 列，子元素默认不滚动，
   内容一多就被裁掉（实测表现是「这一页没法下滑」）。另外两个模块靠
   SPR_main 滚动，这里因为任务选择器放在顶部工具条而不是左侧栏，
   直接让面板根承担滚动。 */
.SPR_rigPanel{display:flex;flex-direction:column;gap:14px;padding:14px 18px 24px;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.SPR_rigStage{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:12px}
.SPR_rigStageHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.SPR_rigStageTitle{font-size:13px;font-weight:600}
.SPR_rigStageHint{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:1;min-width:180px}
.SPR_rigGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;margin-top:10px}
.SPR_rigCard{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:0}
.SPR_rigCard[data-approved=true]{border-color:var(--dsw-alias-state-business-primary)}
.SPR_rigCard[data-hidden=true]{opacity:.45}
.SPR_rigCardName{font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;justify-content:space-between}
.SPR_rigCardMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.SPR_rigCardImg{width:100%;height:88px;object-fit:contain;border-radius:6px;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%),linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%);background-size:14px 14px;background-position:0 0,7px 7px}
.SPR_rigCardBtns{display:flex;gap:4px;flex-wrap:wrap}
.SPR_rigCanvasWrap{position:relative;margin-top:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;background:#fff;line-height:0;max-width:100%}
.SPR_rigCanvasWrap img{display:block;width:100%;height:auto}
.SPR_rigCanvasWrap[data-drag=true]{cursor:grabbing}
.SPR_rigBox{position:absolute;border:1.5px solid rgba(63,111,255,.85);border-radius:3px;box-sizing:border-box;cursor:grab;background:rgba(63,111,255,.10)}
.SPR_rigBox[data-selected=true]{border-color:#ff9f2e;background:rgba(255,159,46,.18);box-shadow:0 0 0 1px rgba(255,159,46,.6)}
/* ── 手动装配编辑器 ──────────────────────────────────────────────────── */
.SPR_asm{display:flex;flex-direction:column;gap:10px}
.SPR_asmBar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.SPR_asmGroup{display:flex;align-items:center;gap:5px}
.SPR_asmHint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
/* ── 时间轴（阶段⑥）────────────────────────────────────────────────────
   轨道条用**百分比定位**而不是 canvas：关键帧数量在几十的量级，DOM 足够，
   而且选中/拖拽/无障碍全都白拿。 */
.SPR_tlWrap{margin-top:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.SPR_tlRuler{position:relative;height:18px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l2)}
.SPR_tlTick{position:absolute;top:2px;transform:translateX(-50%);font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.SPR_tlRow{display:flex;align-items:center;gap:8px;padding:3px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.SPR_tlRow:last-child{border-bottom:none}
.SPR_tlName{flex:0 0 132px;display:flex;flex-direction:column;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_tlKind{font-style:normal;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.SPR_tlLane{position:relative;flex:1;min-width:0;height:20px;background:var(--dsw-alias-bg-layer-2);border-radius:5px;cursor:crosshair}
.SPR_tlKey{position:absolute;top:50%;width:11px;height:11px;margin:-6px 0 0 -6px;padding:0;border-radius:2px;transform:rotate(45deg);
  border:1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.3));background:var(--dsw-alias-bg-layer-1);cursor:grab}
.SPR_tlKey[data-first=true]{border-radius:50%;transform:none;background:var(--dsw-alias-label-tertiary)}
.SPR_tlKey[data-selected=true]{background:#3b82f6;border-color:#1d4ed8;z-index:1}
.SPR_tlEdit{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
/* ── 拆件质检 ─────────────────────────────────────────────────────── */
.SPR_qaList{margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px}
.SPR_qaList li{font-size:12px;line-height:1.5}
.SPR_qaList li[data-level=error]{color:var(--dsw-alias-state-error-primary, #b91c1c)}
.SPR_qaList li[data-level=warning]{color:var(--dsw-alias-state-warning-primary, #b45309)}
.SPR_qaMsg{display:block}
.SPR_qaFix{display:block;margin-top:2px;opacity:.85}
.SPR_asmBody{display:flex;gap:12px;align-items:flex-start}
/* 高度必须**固定**：早先用 max-height 让它被内容撑着，结果一缩放面板就跟着长高
   （100% 时 605px、176% 时 681px），画面会抽动，光标锚点也算不准。
   固定 70vh 之后它才是一个真正的「视口」。 */
.SPR_asmStage{flex:1;min-width:0;height:70vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:#fff;padding:8px;display:flex;align-items:flex-start}
.SPR_asmStage[data-pan=true]{cursor:grab}
.SPR_asmStage[data-panning=true]{cursor:grabbing}
/* 画布用 margin:auto 居中，而不是靠父级 justify-content:center——
   后者在「内容比容器宽」时会裁掉左侧且滚不到（flexbox 的经典问题），
   一放大就出现「左边那块够不着」。 */
.SPR_asmCanvas{position:relative;flex:none;margin:auto;background:#fff;background-image:linear-gradient(45deg,rgba(128,128,128,.12) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.12) 75%),linear-gradient(45deg,rgba(128,128,128,.12) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.12) 75%);background-size:20px 20px;background-position:0 0,10px 10px;user-select:none}
.SPR_asmRef{position:absolute;left:0;top:0;width:100%;height:100%;opacity:.3;pointer-events:none;object-fit:fill}
.SPR_asmLayer{position:absolute;transform-origin:center center;pointer-events:none;image-rendering:auto}
.SPR_asmGuide{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,159,46,.9);pointer-events:none}
.SPR_asmHandle{position:absolute;width:9px;height:9px;margin:-5px 0 0 -5px;border:1.5px solid #ff9f2e;background:#fff;border-radius:2px;cursor:pointer}
.SPR_asmHandle[data-handle=nw],.SPR_asmHandle[data-handle=se]{cursor:nwse-resize}
.SPR_asmHandle[data-handle=ne],.SPR_asmHandle[data-handle=sw]{cursor:nesw-resize}
.SPR_asmHandle[data-handle=n],.SPR_asmHandle[data-handle=s]{cursor:ns-resize}
.SPR_asmHandle[data-handle=e],.SPR_asmHandle[data-handle=w]{cursor:ew-resize}
.SPR_asmSide{width:292px;flex:none;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto}
.SPR_asmPalette{display:flex;flex-wrap:wrap;gap:6px;min-height:36px;padding:6px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.SPR_asmChip{display:flex;flex-direction:column;align-items:center;gap:2px;width:62px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);cursor:grab;font-size:10px;line-height:12px;text-align:center;overflow:hidden}
.SPR_asmChip img{width:52px;height:52px;object-fit:contain;pointer-events:none}
.SPR_asmChip span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_asmPanel{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}
.SPR_asmFields{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.SPR_asmFields .SPR_field{max-width:none}
.SPR_asmRow{display:flex;gap:6px;flex-wrap:wrap}
.SPR_asmLayers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;max-height:220px;overflow:auto}
.SPR_asmLayers li{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font-size:11px;cursor:pointer}
.SPR_asmLayers li[data-active=true]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-1)}
.SPR_asmLayerBtns{margin-left:auto;display:flex;gap:3px}
.SPR_rigHintBox{position:absolute;border:1px dashed rgba(255,159,46,.85);border-radius:4px;pointer-events:none;box-sizing:border-box}
.SPR_rigBoxLabel{position:absolute;left:0;top:-15px;font-size:10px;line-height:14px;padding:0 4px;border-radius:4px;background:rgba(20,22,30,.72);color:#fff;white-space:nowrap;pointer-events:none;font-family:inherit}
.SPR_rigSideBySide{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.SPR_rigSideBySide figure{margin:0;display:flex;flex-direction:column;gap:4px}
.SPR_rigSideBySide figcaption{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.SPR_rigSideBySide img{width:100%;height:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:#fff}
.SPR_rigPreview{width:100%;height:620px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:#12121c;margin-top:10px}
.SPR_rigEditorRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.SPR_rigEditorRow .SPR_field{max-width:104px}
.SPR_rigAtlasWrap{margin-top:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:auto;max-height:52vh;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,rgba(128,128,128,.14) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.14) 75%),linear-gradient(45deg,rgba(128,128,128,.14) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.14) 75%);background-size:20px 20px;background-position:0 0,10px 10px}
.SPR_rigAtlasWrap img{display:block;max-width:100%;height:auto}

/* ── 调用接口时的视觉反馈 ───────────────────────────────────────────────
   所有会「出素材」的远程调用（生图 / 生视频 / 抽帧 / 抠像 / 合成 / 上传）
   都必须让人一眼看见「正在跑」。分两层：
     1. LoadingOverlay —— 盖在预览图（缩略图 / 视频 / 整图 / 播放器）上的遮罩；
     2. BusyBadge/SPR_btn[data-busy] —— 按钮与工具栏级别的轻量反馈。 */
.SPR_ovl{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;background:rgba(16,18,22,.58);border-radius:8px;color:#fff;font-size:12px;line-height:16px;text-align:center;padding:8px;box-sizing:border-box;z-index:2;font-family:inherit;pointer-events:auto;backdrop-filter:blur(1px)}
.SPR_ovlText{max-width:100%;word-break:break-word;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.SPR_ovlSub{font-size:10px;opacity:.78;text-shadow:0 1px 2px rgba(0,0,0,.5)}
/* 行内进度条：长任务用它，不遮挡、不拦点击（见 TileProgressBar 注释） */
.SPR_progress{display:flex;flex-direction:column;gap:5px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);pointer-events:none}
.SPR_progressHead{display:flex;align-items:center;gap:7px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.SPR_progressText{flex:1;min-width:0;word-break:break-word}
.SPR_progressNow{opacity:.7;font-variant-numeric:tabular-nums}
.SPR_progressTrack{height:4px;border-radius:999px;background:color-mix(in srgb, currentColor 14%, transparent);overflow:hidden}
.SPR_progressFill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4a7dff);transition:width .25s ease}
.SPR_spin{width:26px;height:26px;flex:none;border-radius:50%;border:2.5px solid rgba(255,255,255,.26);border-top-color:#fff;animation:SPR_spin .8s linear infinite}
.SPR_spinSm{width:13px;height:13px;flex:none;border-radius:50%;border:2px solid color-mix(in srgb, currentColor 30%, transparent);border-top-color:currentColor;animation:SPR_spin .8s linear infinite}
@keyframes SPR_spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.SPR_spin,.SPR_spinSm{animation-duration:2.4s}}
.SPR_thumbBox{position:relative}
.SPR_btn[data-busy=true]{display:inline-flex;align-items:center;gap:6px;cursor:progress}
.SPR_busyBadge{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:16px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary);white-space:nowrap;flex:none}
.SPR_busyBadge .SPR_spinSm{border-color:color-mix(in srgb, currentColor 26%, transparent);border-top-color:currentColor}
.SPR_drop[data-busy=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}

/* ── 实验性标记：模块④「骨骼动画生成」───────────────────────────────────
   三处共用同一种观感：页签角标、进入时的说明弹窗、模块内常驻提示条。
   角标只在 MODULES 里带 experimental 的模块上出现。 */
.SPR_expTag{font-size:10px;line-height:15px;padding:0 6px;border-radius:999px;white-space:nowrap;flex:none;background:color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d9930d) 16%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d9930d) 45%, transparent);color:var(--dsw-alias-state-warning-primary, #a06a00)}
.SPR_moduleTitleRow{display:flex;align-items:center;gap:6px}
.SPR_expBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;line-height:18px;padding:7px 11px;border-radius:8px;border:1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d9930d) 35%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d9930d) 8%, transparent);color:var(--dsw-alias-label-secondary)}
.SPR_expBar .SPR_link{font-size:12px;align-self:auto}
/* 说明弹窗用 position:fixed 盖住整个工作台——放进 .SPR_rigPanel 的滚动容器会被裁掉。 */
.SPR_gateMask{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(8,10,14,.52);backdrop-filter:blur(2px)}
.SPR_gate{width:min(560px,100%);max-height:80vh;overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:18px 20px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 48px rgba(0,0,0,.32)}
.SPR_gateHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.SPR_gateTitle{font-size:15px;font-weight:600}
.SPR_gateBody{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.SPR_gateFoot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px}
.SPR_gateMute{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary);cursor:pointer;margin-right:auto}
.SPR_gate a.SPR_btn{text-decoration:none;display:inline-flex;align-items:center}
.SPR_gate .SPR_link{align-self:flex-start}

/* ── 侧栏入口上的菜单按钮 ───────────────────────────────────────────────
   宿主把这一坨渲染在它自己的 <button class=…panelRow> 里面，所以：
   · 图标本体保持原尺寸，右下角叠一个 14px 的折角触发器（命中区靠 padding 撑）；
   · 菜单用 position:fixed —— 祖先里有 overflow:hidden 的容器，
     absolute 定位在某些窗口布局下会被裁掉。 */
.SPR_railGlyph{position:relative;display:inline-flex;align-items:center;justify-content:center}
.SPR_railMenuBtn{position:absolute;right:-9px;bottom:-7px;width:14px;height:14px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l3);box-shadow:0 1px 3px rgba(0,0,0,.18)}
.SPR_railMenuBtn:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.SPR_railMenuBtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.SPR_railMenu{position:fixed;z-index:70;width:264px;max-height:min(70vh,420px);overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 16px 40px rgba(0,0,0,.28);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.SPR_railMenuHead{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:2px 8px 6px}
.SPR_railMenuEmpty{margin:0;padding:2px 8px 6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.SPR_railMenuItem{font:inherit;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:8px;border:none;background:transparent;color:inherit}
.SPR_railMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.SPR_railMenuItem:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.SPR_railMenuItemTitle{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600}
.SPR_railMenuItemHint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.SPR_railMenuFoot{margin-top:4px;padding:6px 8px 2px;border-top:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
`;
        // ── 小工具 ───────────────────────────────────────────────────────────
        function cls(...parts) {
            return parts.filter(Boolean).join(" ");
        }
        /** 从 unknown 的 catch 参数里取一条可读消息。 */
        function msg(error) {
            if (error instanceof Error)
                return error.message;
            if (error !== null && typeof error === "object" && typeof error.message === "string")
                return error.message;
            return String(error);
        }
        /**
         * 新建项目 / 任务时问一个名字（与「重命名」同一套 `window.prompt` 交互）。
         *
         * 返回值语义是**三态**，调用方必须照着写：
         *   · `null`      —— 用户点了取消 → **不要创建**（点了取消却多出一个项目，会被当成 bug）
         *   · 空串/全空白 —— 用 `fallback`（默认名）
         *   · 其余        —— 用户输入的名字（已 trim）
         * 没有 `window.prompt` 的宿主退回默认名，不阻断创建。
         */
        function askNewName(title, fallback) {
            if (typeof window === "undefined" || typeof window.prompt !== "function")
                return fallback;
            const value = window.prompt(title, fallback);
            if (value === null)
                return null;
            const trimmed = String(value).trim();
            return trimmed === "" ? fallback : trimmed;
        }
        /** 图集预览（调色板 / 切分预览）里图片的最长边上限。 */
        const MAP_PALETTE_MAX = 420;
        /**
         * 图集预览的盒子尺寸。
         *
         * 只约束**宽度**、高度交给 `aspect-ratio` 推：max-width 由「最长边不超过
         * MAP_PALETTE_MAX」反推得到，所以宽高两边都守得住，且**永远不会破坏宽高比**。
         * 给盒子直接写 `max-height` 就会：宽度仍是 100% 时被 max-height 一夹，比例塌掉，
         * 百分比定位的图块又和图片错位（正是下面 `.SPR_mePalette` 注释里那个真机 bug）。
         */
        function mapPaletteBox(imageWidth, imageHeight) {
            const width = imageWidth > 0 ? imageWidth : 1;
            const height = imageHeight > 0 ? imageHeight : 1;
            const maxWidth = Math.max(1, Math.round((MAP_PALETTE_MAX * width) / Math.max(width, height)));
            return { width: "100%", maxWidth: `${maxWidth}px`, aspectRatio: `${width} / ${height}` };
        }
        /** 原图像素 → 盒子百分比：叠加层必须按百分比写，才会跟着被缩放的图片一起缩。 */
        function mapPct(value, total) {
            return total > 0 ? `${(value / total) * 100}%` : "0%";
        }
        function statusKind(node) {
            if (node === undefined)
                return { kind: "empty", text: T("未生成") };
            if (node.approved)
                return { kind: "approved", text: T("已通过") };
            if (node.status === "running")
                return { kind: "running", text: T("进行中") };
            if (node.status === "error")
                return { kind: "error", text: T("失败") };
            if (node.status === "ready") {
                if (node.stale)
                    return { kind: "stale", text: T("需重做") };
                return { kind: "ready", text: T("已完成") };
            }
            return { kind: "empty", text: T("未生成") };
        }
        function Chip({ kind, text }) {
            return h("span", { className: "SPR_chip", "data-kind": kind }, text);
        }
        function StatusChip({ node }) {
            const info = statusKind(node);
            return h(Chip, { kind: info.kind, text: info.text });
        }
        /**
         * 基础按钮。
         *
         * `...rest` 透传到 `<button>`：主要是让调用点能挂 `data-testid`——
         * 界面测试（Playwright）靠它定位，而按可见文字定位在中文文案改动时很脆。
         * 之前不透传，结果是「明明写了 data-testid 但测试找不到元素」。
         */
        function Btn({ children, onClick, disabled, primary, on, danger, title, busy, ...rest }) {
            return h("button", {
                type: "button",
                className: "SPR_btn",
                ...rest,
                onClick,
                disabled: disabled === true,
                title,
                "data-primary": primary === true ? "true" : undefined,
                "data-on": on === true ? "true" : undefined,
                "data-danger": danger === true ? "true" : undefined,
                "data-busy": busy === true ? "true" : undefined,
                "aria-busy": busy === true ? "true" : undefined
            }, children);
        }
        /**
         * 数字参数输入框。
         *
         * ★ 必须**在失焦 / 回车时才提交**，不能边打字边提交：宿主那边对每个参数
         * 都会 clamp（单格宽最小 16、时长最小 4 秒…），敲一个字符就提交一次的话，
         * 想输入「128」会在敲下「1」的瞬间被夹成 16、输入框随即被回包覆盖——
         * 表现就是「数字总跳成别的值，根本没法输入」。所以这里本地存草稿文本，
         * 只在 onBlur / Enter 时解析 + 夹取 + 回调，输入过程中一个远程调用都不发。
         */
        /**
         * 形状工具（**模块级**，不是组件内的 const）。
         *
         * ⚠️ 必须是模块级：组件里那几处（`itemsForSave` 等）在**渲染早期**就要用到
         * 它们，而组件内的 `const` 在那个位置还处于暂时性死区 —— 实测报
         * `Cannot access 'shapeFromRect' before initialization`，整块白屏。
         */
        /**
         * 模板文件名的中文说明。
         *
         * 形状变了模板名也变，所以名字要从文件名**反推**，不能写死几个分支。
         * `cell.png` → 单格；`grid{C}x{R}.png` → C×R 矩形；
         * `shape-{格子}.png` → 非矩形（把格子坐标列出来，用户能对上是哪个形状）。
         */
        /**
         * 把占格形状写成人话（预览用）。
         *
         * ⚠️ 这是宿主 `tilegen.describeShape` 的**客户端复刻**：浏览器半区是经典脚本，
         * 不能 import 宿主代码。两边一致性由 `verify-tile-client.mjs` 的对照断言钉住
         * （同一份形状下两侧的描述必须一致）。
         *
         * ⚠️ 方位词只用**行列序号**，不用「左上 / 右上」：等轴测视角下屏幕上的左右
         * 和格子的行列不是一回事，说「右上角」会让模型猜错。
         */
        function describeShapePreview(shape) {
            if (!Array.isArray(shape) || shape.length === 0)
                return undefined;
            let maxR = 0;
            let maxC = 0;
            for (const cell of shape) {
                if (!Array.isArray(cell) || cell.length < 2)
                    continue;
                if (Number(cell[0]) > maxR)
                    maxR = Number(cell[0]);
                if (Number(cell[1]) > maxC)
                    maxC = Number(cell[1]);
            }
            const cols = maxC + 1;
            const rows = maxR + 1;
            // ★ 实心矩形**也要写**：等距投影下 `3×1` 与 `2×2` 是同一个形状
            // （半宽都是 cellWidth，模板逐字节相同），行列数只能靠文字交代。
            if (shape.length === cols * rows) {
                return `⚠️ 占地形状：地基是 ${cols}×${rows} 的等距菱形，**共 ${cols * rows} 格**` +
                    `（沿两条斜边分别 ${cols} 格、${rows} 格）。` +
                    `建筑的底面必须覆盖这个范围内的**全部 ${cols * rows} 格**，不要缩小成单格，也不要超出边界。`;
            }
            const missing = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (!shape.some((cell) => Number(cell[0]) === r && Number(cell[1]) === c)) {
                        missing.push(`第 ${r + 1} 行第 ${c + 1} 列`);
                    }
                }
            }
            return `⚠️ 占地形状：地基区域是 ${cols}×${rows} 格、共 ${cols * rows} 格，` +
                `但**这栋建筑只占其中 ${shape.length} 格**，` +
                `${missing.join("、")}那${missing.length > 1 ? "几" : ""}格是空地，不属于建筑。` +
                `参考图上那几格没有洋红轮廓、是透空的，成品里也必须完全透明。` +
                `不要把空地当成天井或内院围起来 —— 建筑的墙要沿着**洋红轮廓**拐进去，` +
                `底面必须与洋红轮廓逐格重合（以参考图的洋红轮廓为准）。`;
        }
        function templateLabel(name) {
            if (name === "cell.png")
                return T("单格模板（1×1 地形用）");
            const grid = /^grid(\d+)x(\d+)\.png$/.exec(name);
            if (grid !== null)
                return T("{n0}×{n1} 建筑模板", { n0: grid[1], n1: grid[2] });
            const shape = /^shape-(.+)\.png$/.exec(name);
            if (shape !== null) {
                const cells = shape[1].split("_").map((p) => {
                    const [r, c] = p.split("-");
                    return `(${r},${c})`;
                });
                return T("异形模板 · {n0} 格 {n1}", { n0: String(cells.length), n1: cells.join(" ") });
            }
            return name;
        }
        function shapeFromRect(fw, fh) {
            const out = [];
            for (let r = 0; r < Math.max(1, fh); r++) {
                for (let c = 0; c < Math.max(1, fw); c++)
                    out.push([r, c]);
            }
            return out;
        }
        /** 形状 → 包围矩形 `[列, 行]`（`footprint` 只是它的兼容副本）。 */
        function footprintOfShape(shape) {
            let fw = 1;
            let fh = 1;
            for (const [r, c] of shape ?? []) {
                if (c + 1 > fw)
                    fw = c + 1;
                if (r + 1 > fh)
                    fh = r + 1;
            }
            return [fw, fh];
        }
        /**
         * 形状编辑器：在网格里点选格子，配出任意占地（L 形、T 形、线形…）。
         *
         * - 左上角那格是**锚点**，恒亮、不可取消（形状必须含 `[0,0]`）。
         * - 网格大小 = 形状包围矩形 + 一圈空格（方便往外扩）。
         * - 格子数**不设上限**，但网格上限 12×12，免得铺出一张没人画得出来的图。
         *
         * ⚠️ 形状一律按**相对锚点的格子集合**存，不是「几列几行」——
         * 后者表达不了 L 形。`footprint` 只当包围矩形一起回传，供老版本读。
         */
        function ShapeEditor({ shape, onChange, disabled }) {
            const cells = Array.isArray(shape) && shape.length > 0 ? shape : [[0, 0]];
            const has = (r, c) => cells.some(([rr, cc]) => rr === r && cc === c);
            let maxR = 0;
            let maxC = 0;
            for (const [r, c] of cells) {
                if (r > maxR)
                    maxR = r;
                if (c > maxC)
                    maxC = c;
            }
            const gridR = Math.min(12, maxR + 2);
            const gridC = Math.min(12, maxC + 2);
            const toggle = (r, c) => {
                if (disabled === true)
                    return;
                if (r === 0 && c === 0)
                    return; // 锚点不能取消
                const next = has(r, c)
                    ? cells.filter(([rr, cc]) => !(rr === r && cc === c))
                    : [...cells, [r, c]];
                next.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
                onChange(next);
            };
            const rows = [];
            for (let r = 0; r < gridR; r++) {
                const row = [];
                for (let c = 0; c < gridC; c++) {
                    const on = has(r, c);
                    const anchor = r === 0 && c === 0;
                    row.push(h("button", {
                        key: `s${r},${c}`,
                        type: "button",
                        disabled: disabled === true || anchor,
                        className: `SPR_shapeCell${on ? " SPR_shapeCell-on" : ""}${anchor ? " SPR_shapeCell-anchor" : ""}`,
                        title: anchor ? T("锚点（左上角，必选）") : `${r},${c}`,
                        "data-shape-cell": `${r},${c}`,
                        "data-on": on ? "1" : "0",
                        onClick: () => toggle(r, c)
                    }, ""));
                }
                rows.push(h("div", { key: `r${r}`, className: "SPR_shapeRow" }, ...row));
            }
            return h("div", { className: "SPR_shapeEditor" }, h("div", { className: "SPR_shapeGrid", "data-shape-cells": String(cells.length) }, ...rows), h("span", { className: "SPR_muted" }, T("点格子增删占格（{n0} 格）；左上角是锚点", { n0: String(cells.length) })));
        }
        function NumField({ label, value, onChange, min, max, step, hint }) {
            const [text, setText] = React.useState(String(value ?? ""));
            const [focused, setFocused] = React.useState(false);
            // 外部值变了（宿主回包、切换项目）而用户没在输入时，同步过来。
            React.useEffect(() => {
                if (!focused)
                    setText(String(value ?? ""));
            }, [value, focused]);
            /**
             * ⚠️ 必须传 `onChange`（不是 `onCommit`）。
             *
             * 曾经有 5 个调用点写成 `onCommit`，而这里解构的是 `onChange` ——
             * 于是 `onChange` 是 `undefined`，一失焦就抛 `onChange is not a function`，
             * **值永远同步不进草稿**：用户改了「变体数 / 占格」，点保存看着成功，
             * 实际提交的还是旧值（真机表现：「改了变体数保存后还是 2」）。
             *
             * 这里主动校验一次并把错误说清楚 —— 静默失败比直接报错难查得多。
             */
            if (onChange === undefined) {
                throw new Error(`NumField「${label ?? ""}」缺少 onChange —— 是不是写成了 onCommit？`);
            }
            const commit = () => {
                const parsed = Number(text);
                if (text.trim() === "" || !Number.isFinite(parsed)) {
                    setText(String(value ?? ""));
                    return;
                }
                const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed));
                setText(String(clamped));
                if (clamped !== value)
                    onChange(clamped);
            };
            return h("label", { className: "SPR_field", "data-num-field": "1" }, h("span", { className: "SPR_fieldLabel" }, label), h("input", {
                className: "SPR_input",
                type: "number",
                inputMode: "decimal",
                value: text,
                min,
                max,
                step: step === undefined ? 1 : step,
                "data-dirty": focused && text !== String(value ?? "") ? "true" : undefined,
                onChange: (event) => setText(event.target.value),
                onFocus: (event) => {
                    setFocused(true);
                    // 光标落进来就全选：改参数基本都是整份替换，省一次三击。
                    try {
                        event.target.select?.();
                    }
                    catch {
                        /* 个别浏览器对 number 输入框的 select 有限制，忽略即可 */
                    }
                },
                onBlur: () => {
                    setFocused(false);
                    commit();
                },
                onKeyDown: (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                    }
                }
            }), hint === undefined ? null : h("span", { className: "SPR_fieldLabel" }, hint));
        }
        /**
         * 全局模型设置。生图模型 / 视频模型都是插件级设置（设置 → 游戏素材大师），
         * 各功能模块只跟随、不各自留一份副本——否则切换模型后旧任务会打到错误网关
         * （实测：任务里存官方 H3 + 全局已切优云智算 → cp.compshare.cn/v2/... 404）。
         */
        function useGlobalConfig(api) {
            const [value, setValue] = React.useState(null);
            React.useEffect(() => {
                let alive = true;
                void (async () => {
                    try {
                        const next = await api.getConfig();
                        if (alive)
                            setValue(next);
                    }
                    catch {
                        /* 取不到就退回任务里记录的值 */
                    }
                })();
                return () => {
                    alive = false;
                };
            }, [api]);
            return value;
        }
        /** 只读展示当前生效的全局模型：模型只在设置里改，模块内不允许覆盖。 */
        function GlobalModelField({ label, value }) {
            return h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, label), h("input", { className: "SPR_input", value: value ?? "", readOnly: true, disabled: true }), h("span", { className: "SPR_fieldLabel" }, T("跟随即「设置 → 游戏素材大师」")));
        }
        function assetUrl(project, relative, version) {
            if (project === null || relative === undefined || relative === null)
                return undefined;
            const base = project.assetBase ?? "";
            const suffix = version === undefined ? "" : `?v=${version}`;
            return `${base}${relative}${suffix}`;
        }
        /**
         * 双击看大图的缩略图。
         *
         * 序列帧缩略图按格子尺寸显示（默认 256px、像素风还会更小），肉眼根本看不清
         * 动作与抠像质量——双击弹出原图，右上角「×」、点背景、按 Esc 都能关。
         * 遮罩用 position:fixed，所以它在卡片内部渲染也能盖住整页。
         */
        function ZoomableImage({ src, alt, className, caption, style }) {
            const [open, setOpen] = React.useState(false);
            React.useEffect(() => {
                if (!open)
                    return undefined;
                const onKey = (event) => {
                    if (event.key === "Escape")
                        setOpen(false);
                };
                if (typeof window !== "undefined")
                    window.addEventListener("keydown", onKey);
                return () => {
                    if (typeof window !== "undefined")
                        window.removeEventListener("keydown", onKey);
                };
            }, [open]);
            const openImage = (event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpen(true);
            };
            return h(React.Fragment, null, h("img", {
                className,
                src,
                alt,
                style,
                title: T("双击看大图"),
                "data-zoomable": "true",
                onDoubleClick: openImage
            }), open
                ? h("div", {
                    className: "SPR_zoomMask",
                    role: "dialog",
                    "aria-modal": "true",
                    "data-testid": "zoom-mask",
                    onClick: () => setOpen(false)
                }, h("button", {
                    type: "button",
                    className: "SPR_zoomClose",
                    "aria-label": T("关闭大图"),
                    title: T("关闭（Esc）"),
                    "data-testid": "zoom-close",
                    onClick: (event) => {
                        event.stopPropagation();
                        setOpen(false);
                    }
                }, "×"), h("img", {
                    className: "SPR_zoomImg",
                    src,
                    alt,
                    onClick: (event) => event.stopPropagation()
                }), caption !== undefined && caption !== null ? h("div", { className: "SPR_zoomCaption" }, caption) : null)
                : null);
        }
        // ── 「正在调用接口」的视觉反馈 ───────────────────────────────────────
        /**
         * 点一次按钮 = 一次远程调用。调用期间界面必须看得见「在跑」，
         * 所以把「哪一个操作正在跑」抽成一个按 key 记账的 pending 表：
         *
         *   const tasks = usePendingTasks();
         *   await tasks.run(`image:${key}`, "正在生成…", () => api.runImage(…));
         *   tasks.has(`image:${key}`)   // 盖遮罩用
         *
         * 两个要点：
         * 1. 遮罩在**调用返回后仍多留一会儿**（HOLD_MS）。宿主把任务标成 running 是
         *    落在下一次 getProject 里的，如果调用一返回就撤遮罩，会有一次「图已经
         *    变旧了但还没盖上」的闪烁。多留 700ms 足够让下一次轮询把 running 状态刷进来。
         * 2. 卸载后不再 setState（长任务可能几分钟才回来）。
         */
        const TASK_HOLD_MS = 700;
        function usePendingTasks() {
            // React 经由 require 拿到，是 any，不能写泛型实参（TS2347）。
            const [map, setMap] = React.useState({});
            const aliveRef = React.useRef(true);
            const timersRef = React.useRef([]);
            React.useEffect(() => {
                aliveRef.current = true;
                const timers = timersRef.current;
                return () => {
                    aliveRef.current = false;
                    for (const id of timers)
                        clearTimeout(id);
                    timers.length = 0;
                };
            }, []);
            const release = React.useCallback((key) => {
                const id = setTimeout(() => {
                    if (!aliveRef.current)
                        return;
                    setMap((current) => {
                        if (current[key] === undefined)
                            return current;
                        const next = { ...current };
                        delete next[key];
                        return next;
                    });
                }, TASK_HOLD_MS);
                timersRef.current.push(id);
            }, []);
            const run = React.useCallback((key, label, fn) => {
                if (!aliveRef.current)
                    return Promise.resolve(undefined);
                setMap((current) => (current[key] === label ? current : { ...current, [key]: label }));
                return Promise.resolve()
                    .then(fn)
                    .then((value) => {
                    release(key);
                    return value;
                }, (error) => {
                    release(key);
                    throw error;
                });
            }, [release]);
            const has = React.useCallback((key) => map[key] !== undefined, [map]);
            const label = React.useCallback((key) => map[key], [map]);
            const any = React.useCallback((prefix) => Object.keys(map).some((key) => key.startsWith(prefix)), [map]);
            const keys = React.useCallback((prefix) => Object.keys(map).filter((key) => key.startsWith(prefix)), [map]);
            const active = Object.keys(map).length > 0;
            // 第一条 pending 的文案，用作「总有一个在跑」时的兜底显示。
            const firstLabel = Object.values(map)[0];
            return { map, run, has, label, any, keys, active, firstLabel };
        }
        /**
         * 盖在预览区上的 loading 遮罩。父元素必须是 position:relative
         * （`.SPR_thumbBox` 或 `.SPR_stage`）。
         */
        function LoadingOverlay({ show, text, sub }) {
            if (show !== true)
                return null;
            return h("div", { className: "SPR_ovl", role: "status", "aria-live": "polite", "aria-busy": "true" }, h("span", { className: "SPR_spin" }), h("span", { className: "SPR_ovlText" }, text ?? T("处理中…")), sub === undefined || sub === null ? null : h("span", { className: "SPR_ovlSub" }, sub));
        }
        /**
         * 行内进度条：**不遮挡、可点击穿透**。
         *
         * 与 `LoadingOverlay`（绝对定位盖住容器）的分工：
         *   · 要让人「看得见就放心、但不挡路」的**长任务**用这个；
         *   · 要盖住一小块预览区、明确「这块正在变」的用 `LoadingOverlay`。
         *
         * 长任务（生成地块一轮几十秒）绝不能盖整块面板：用户要能切阶段、
         * 去别的模块干活，而且「停止」按钮得点得到。
         */
        function TileProgressBar({ job, text }) {
            const targets = Array.isArray(job?.targets) ? job.targets : [];
            const done = Array.isArray(job?.done) ? job.done : [];
            const total = targets.length;
            const pct = total === 0 ? 0 : Math.min(100, Math.round((done.length / total) * 100));
            return h("div", { className: "SPR_progress", role: "status", "aria-live": "polite" }, h("div", { className: "SPR_progressHead" }, h("span", { className: "SPR_spinSm" }), h("span", { className: "SPR_progressText" }, total === 0
                ? text ?? T("处理中…")
                : T("{n0}（{n1}/{n2}）", { n0: text ?? T("处理中…"), n1: done.length, n2: total })), job?.running ? h("span", { className: "SPR_progressNow" }, job.running) : null), h("div", { className: "SPR_progressTrack" }, h("div", { className: "SPR_progressFill", style: { width: `${pct}%` } })));
        }
        /**
         * 一张图 / 一段视频的预览位：内容 + 可选遮罩。
         * 原来各阶段的 `<img className="SPR_thumb">` 直接放在节点卡片里，
         * 现在统一包一层定位容器，遮罩才能正好盖住预览区。
         */
        function MediaBox({ overlay, text, className, children }) {
            return h("div", { className: cls("SPR_thumbBox", className) }, h("div", { style: { visibility: overlay === true ? "hidden" : undefined } }, children), h(LoadingOverlay, { show: overlay === true, text: text ?? T("正在生成…") }));
        }
        /** 按钮级别的「正在跑」：转圈 + 文案，并把按钮本身置灰防重复点击。 */
        function BusyBtn({ busy, busyText, children, onClick, ...rest }) {
            return h(Btn, { ...rest, onClick, disabled: busy === true || rest.disabled === true, busy: busy === true }, busy === true ? h("span", { className: "SPR_spinSm" }) : null, busy === true ? busyText ?? T("处理中…") : children);
        }
        /** 工具栏上的状态徽章：有任务在跑时显示，同时兼作按钮区的位置占位。 */
        function BusyBadge({ show, text }) {
            if (show !== true)
                return null;
            return h("span", { className: "SPR_busyBadge", role: "status", "aria-live": "polite" }, h("span", { className: "SPR_spinSm" }), text ?? T("正在处理…"));
        }
        // ── 验收：审核模式与「通过」───────────────────────────────────────────
        /**
         * 审核模式（固定流程必问项）：`auto` = agent 自己审完继续，`manual` = 每一步人工审。
         *
         * 与对话里的 `game_material_reviewMode` 写的是同一份数据（存在项目 / 任务上），
         * 所以用户在界面上改了、会话里的 agent 也会按新值走，反之亦然。
         */
        function ReviewModeBar({ api, module, id, mode, onChanged }) {
            const [busy, setBusy] = React.useState(false);
            const change = async (next) => {
                if (busy || next === "" || id === null || id === undefined)
                    return;
                setBusy(true);
                try {
                    await api.setReviewMode({ module, id, reviewMode: next });
                    if (onChanged !== undefined)
                        onChanged(next);
                }
                catch {
                    // 失败就保持原值；下一次轮询会把宿主上的真实值带回来。
                }
                finally {
                    setBusy(false);
                }
            };
            return h("div", { className: "SPR_toolbar" }, h("span", { className: "SPR_refRow" }, T("审核模式")), h("select", {
                className: "SPR_input",
                style: { width: 210 },
                value: mode ?? "",
                disabled: busy || id === null || id === undefined,
                onChange: (event) => void change(event.target.value)
            }, h("option", { value: "" }, T("未设置（对话里会先问）")), h("option", { value: "auto" }, T("自动审核")), h("option", { value: "manual" }, T("每一步人工审核"))), h("span", { className: "SPR_refRow" }, mode === "manual"
                ? T("每一步产出后 agent 会贴出验收链接并停下来等你确认")
                : mode === "auto"
                    ? T("agent 自己检查每步产出后继续推进")
                    : T("还没定：对话里 agent 会先问你要哪种")));
        }
        /** 单个产物的「通过 / 取消通过」。与对话里的 game_material_approve 同一份数据。 */
        function ApproveBtn(props) {
            const { approved, disabled, onToggle, idleText } = props;
            return h(Btn, { on: approved === true, disabled: disabled === true, onClick: onToggle }, approved === true ? T("已通过") : idleText ?? T("通过"));
        }
        // ── 侧栏图标（入口按钮 + 快捷菜单）───────────────────────────────────
        /**
         * 图标本体。抽出来是因为 `StudioGlyph` 现在还要在旁边挂一个菜单按钮，
         * 而自检脚本会单独拿这个纯图形做断言。
         */
        function StudioGlyphIcon(props) {
            const size = props?.size ?? 18;
            return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, h("rect", { x: 3.2, y: 3.2, width: 17.6, height: 17.6, rx: 3, stroke: "currentColor", strokeWidth: 1.6 }), h("rect", { x: 5.6, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }), h("rect", { x: 10.2, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }), h("rect", { x: 14.8, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }), h("rect", { x: 5.6, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }), h("rect", { x: 10.2, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.28 }), h("rect", { x: 14.8, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }), h("rect", { x: 5.6, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }), h("rect", { x: 10.2, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }), h("rect", { x: 14.8, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }));
        }
        /** 菜单按钮上的小折角箭头。 */
        function ChevronGlyph() {
            return h("svg", { width: 8, height: 8, viewBox: "0 0 8 8", fill: "none", "aria-hidden": "true" }, h("path", { d: "M1.4 2.6 L4 5.4 L6.6 2.6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }));
        }
        /**
         * 侧栏「游戏素材大师」入口。
         *
         * 宿主把这一坨渲染在**它自己的 `<button class=…panelRow>` 里面**（见
         * dsh-client-ui-sidebar 的 `PanelRow`），所以我们没法在旁边加一个平级的
         * `<button>`——那会变成嵌套按钮。做法是：图标右下角挂一个
         * `span[role=button]` 的小折角，点击时 `stopPropagation` 掉宿主那一下
         * （否则会顺带切面板），然后在它旁边弹出功能菜单。
         *
         * 菜单用 `position:fixed` 渲染：侧栏面板列本身不裁剪，但祖先里有
         * `overflow:hidden` 的容器，`absolute` 会在某些窗口布局下被切掉。
         */
        function StudioGlyph(props) {
            const size = props?.size ?? 18;
            const api = props?.api;
            const studioCtx = props?.studioCtx;
            const hidden = useHiddenModules(api);
            const [open, setOpen] = React.useState(false);
            const [anchor, setAnchor] = React.useState(null);
            const rootRef = React.useRef(null);
            const menuRef = React.useRef(null);
            const entries = visibleModulesOf(hidden);
            // 菜单开着时：点外面 / 按 Esc 关掉。监听挂在 document 上，
            // 用捕获阶段，避免被宿主自己的处理吞掉。
            React.useEffect(() => {
                if (!open)
                    return undefined;
                const onPointerDown = (event) => {
                    const root = rootRef.current;
                    if (root !== null && root !== undefined && typeof root.contains === "function" && root.contains(event.target))
                        return;
                    setOpen(false);
                };
                const onKeyDown = (event) => {
                    if (event.key === "Escape")
                        setOpen(false);
                };
                document.addEventListener("mousedown", onPointerDown, true);
                document.addEventListener("keydown", onKeyDown);
                return () => {
                    document.removeEventListener("mousedown", onPointerDown, true);
                    document.removeEventListener("keydown", onKeyDown);
                };
            }, [open]);
            const toggle = (event) => {
                // 两下都要拦：宿主 `<button>` 的 onClick 也在这条冒泡路径上。
                event.preventDefault();
                event.stopPropagation();
                if (open) {
                    setOpen(false);
                    return;
                }
                const target = event.currentTarget;
                if (target !== null && target !== undefined && typeof target.getBoundingClientRect === "function") {
                    const rect = target.getBoundingClientRect();
                    setAnchor({ left: rect.right + 8, top: rect.top - 4, bottom: rect.bottom });
                }
                else {
                    setAnchor(null);
                }
                setOpen(true);
            };
            const pick = (key) => {
                setOpen(false);
                openStudioIntent(studioCtx, { module: key });
            };
            // 菜单从按钮右上角展开；超出视口下沿时整体上移，别让它跑到屏幕外。
            let menuStyle = { left: 0, top: 0 };
            if (anchor !== null) {
                const viewportHeight = typeof window !== "undefined" && Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
                const estimated = 96 + entries.length * 52;
                const top = viewportHeight > 0 ? Math.max(8, Math.min(anchor.top, viewportHeight - estimated - 12)) : anchor.top;
                menuStyle = { left: anchor.left, top };
            }
            return h("span", { className: "SPR_railGlyph", ref: rootRef }, h(StudioGlyphIcon, { size }), h("span", {
                className: "SPR_railMenuBtn",
                role: "button",
                tabIndex: 0,
                "aria-haspopup": "menu",
                "aria-expanded": open ? "true" : "false",
                "aria-label": T("功能菜单"),
                title: T("功能菜单"),
                "data-testid": "gmm-rail-menu-btn",
                onClick: toggle,
                onKeyDown: (event) => {
                    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar")
                        toggle(event);
                }
            }, h(ChevronGlyph, null)), open
                ? h("div", {
                    className: "SPR_railMenu",
                    role: "menu",
                    ref: menuRef,
                    style: menuStyle,
                    "data-testid": "gmm-rail-menu",
                    onClick: (event) => event.stopPropagation(),
                    onMouseDown: (event) => event.stopPropagation()
                }, h("div", { className: "SPR_railMenuHead" }, T("快捷进入功能")), entries.length === 0
                    ? h("p", { className: "SPR_railMenuEmpty" }, T("所有功能都已被隐藏，请到「设置 → 游戏素材大师 → 功能管理」里打开至少一个。"))
                    : entries.map((entry) => h("button", {
                        key: entry.key,
                        type: "button",
                        role: "menuitem",
                        className: "SPR_railMenuItem",
                        "data-module": entry.key,
                        onClick: () => pick(entry.key)
                    }, h("span", { className: "SPR_railMenuItemTitle" }, entry.title, entry.experimental === true ? h("span", { className: "SPR_expTag" }, T("实验性")) : null), h("span", { className: "SPR_railMenuItemHint" }, entry.hint))), hidden.length > 0
                    ? h("div", { className: "SPR_railMenuFoot" }, T("已隐藏 {n0} 个功能（设置 → 游戏素材大师 → 功能管理）", { n0: hidden.length }))
                    : null)
                : null);
        }
        // ── 主体工作台 ───────────────────────────────────────────────────────
        function StudioPanel(props) {
            const localeTick = useLocaleTick();
            const api = props?.api;
            const [projects, setProjects] = React.useState([]);
            const [projectId, setProjectId] = React.useState(null);
            const [project, setProject] = React.useState(null);
            const [stage, setStage] = React.useState("images");
            const [module, setModule] = React.useState("sprite");
            const [notice, setNotice] = React.useState(null);
            const [loading, setLoading] = React.useState(true);
            const [promptDraft, setPromptDraft] = React.useState({});
            const [promptOpen, setPromptOpen] = React.useState({});
            const [videoPromptDraft, setVideoPromptDraft] = React.useState("");
            const [settingsDraft, setSettingsDraft] = React.useState(null);
            const [sourceBusy, setSourceBusy] = React.useState(false);
            const [dropOver, setDropOver] = React.useState(false);
            const fileInputRef = React.useRef(null);
            // 「正在调用接口」的记账表：宿主侧任务状态还没落盘时，遮罩靠它撑住。
            const tasks = usePendingTasks();
            // 深链接意图：会话里点「查看验收」时落到对应模块 / 项目 / 阶段。
            const intent = useStudioIntent();
            // 功能管理：被隐藏的模块既不在页签里，也不该在别处被切进来（深链接也会被挡）。
            const hidden = useHiddenModules(api);
            const visibleModules = visibleModulesOf(hidden);
            /**
             * 真正渲染的模块：当前选中项被隐藏（或压根不存在）时落到第一个可见模块。
             *
             * 不用等 `useEffect` 把 state 改回来——那样会先渲染一帧隐藏模块，
             * 深链接进被隐藏的模块时就会闪一下它的界面。
             */
            const activeModule = visibleModules.some((entry) => entry.key === module) ? module : visibleModules.length > 0 ? visibleModules[0].key : null;
            React.useEffect(() => {
                if (activeModule !== null && activeModule !== module)
                    setModule(activeModule);
            }, [activeModule, module]);
            React.useEffect(() => {
                if (intent === null)
                    return;
                if (typeof intent.module === "string")
                    setModule(intent.module);
                if (typeof intent.projectId === "string")
                    setProjectId(intent.projectId);
                if (typeof intent.stage === "string" && STAGES.some((item) => item.key === intent.stage))
                    setStage(intent.stage);
            }, [intent]);
            const busy = project !== null && ((project.jobs?.length ?? 0) > 0 ||
                DIRECTION_KEYS.some((key) => project.videos?.[key]?.status === "running") ||
                // 转圈视频是「提交完就返回」的后台任务：kick 的那条记录在提交结束时就撤了，
                // 之后只剩节点自己还是 running。不把它算进来，界面在几分钟的等视频期间
                // 一次都不会刷新（宿主其实一直在轮询），看着就像卡住了。
                project.turn?.video?.status === "running");
            // 轮询条件也要算上正在跑的这一次调用，否则点完按钮到 running 落盘之间不会刷新。
            const polling = busy || tasks.active;
            const refreshProjects = React.useCallback(async () => {
                if (api === undefined)
                    return;
                try {
                    const result = await api.listProjects();
                    setProjects(result.projects ?? []);
                    return result.projects ?? [];
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                    return [];
                }
            }, [api]);
            const loadProject = React.useCallback(async (id) => {
                if (api === undefined || id === null)
                    return;
                try {
                    const next = await api.getProject(id);
                    setProject(next);
                    setPromptDraft({ ...(next.prompts?.images ?? {}) });
                    setVideoPromptDraft(next.prompts?.video ?? "");
                    setSettingsDraft({ ...(next.settings ?? {}) });
                    setPromptOpen((current) => {
                        const keys = Object.keys(current);
                        if (keys.length > 0)
                            return current;
                        return {};
                    });
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api]);
            // 首次挂载：拉项目列表，自动选中最近一个。
            React.useEffect(() => {
                let cancelled = false;
                void (async () => {
                    const list = await refreshProjects();
                    if (cancelled)
                        return;
                    setLoading(false);
                    if (list.length > 0)
                        setProjectId((current) => current ?? list[0].id);
                })();
                return () => {
                    cancelled = true;
                };
            }, [refreshProjects]);
            React.useEffect(() => {
                if (projectId === null) {
                    setProject(null);
                    return;
                }
                void loadProject(projectId);
                // `localeTick` 也在依赖里：内置默认提示词存在宿主侧，界面重渲染换不掉它们，
                // 语言一变就得重新拉一次项目（宿主会把「从没改过」的提示词换成新语言的默认值）。
            }, [projectId, loadProject, localeTick]);
            // 有任务在跑时轮询；跑完自动停。
            React.useEffect(() => {
                if (!polling || projectId === null)
                    return undefined;
                const timer = setInterval(() => {
                    void loadProject(projectId);
                }, 2500);
                return () => clearInterval(timer);
            }, [polling, projectId, loadProject]);
            // 视频阶段即便宿主侧在轮询，界面也要定期刷新任务状态。
            React.useEffect(() => {
                if (stage !== "videos" || projectId === null)
                    return undefined;
                const timer = setInterval(() => {
                    void loadProject(projectId);
                }, 5000);
                return () => clearInterval(timer);
            }, [stage, projectId, loadProject]);
            const withApi = React.useCallback(async (fn, options = {}) => {
                if (api === undefined) {
                    setNotice({ kind: "error", text: T("远程服务尚未挂载完成，请稍候再试") });
                    return undefined;
                }
                try {
                    const value = await fn();
                    if (options.notice !== undefined)
                        setNotice({ kind: options.noticeKind ?? "info", text: options.notice });
                    if (options.reload === true && projectId !== null)
                        await loadProject(projectId);
                    return value;
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                    return undefined;
                }
            }, [api, projectId, loadProject]);
            const createProject = async () => {
                const name = askNewName(T("新项目的名字"), T("角色 {n0}", { n0: new Date().toLocaleString("zh-CN", { hour12: false }) }));
                if (name === null)
                    return;
                await withApi(async () => {
                    const created = await api.createProject({ name });
                    await refreshProjects();
                    setProjectId(created.projectId);
                }, { notice: T("已创建新项目") });
            };
            const deleteCurrent = async () => {
                if (project === null)
                    return;
                // eslint-disable-next-line no-alert
                if (typeof window !== "undefined" && !window.confirm(T("确定删除项目「{n0}」？项目目录会被整个移除，无法撤销。", { n0: project.name })))
                    return;
                await withApi(async () => {
                    await api.deleteProject({ projectId: project.id });
                    const list = await refreshProjects();
                    setProjectId(list.length > 0 ? list[0].id : null);
                    if (list.length === 0)
                        setProject(null);
                });
            };
            const renameCurrent = async () => {
                if (project === null)
                    return;
                // eslint-disable-next-line no-alert
                const next = typeof window === "undefined" ? null : window.prompt(T("新的项目名"), project.name);
                if (next === null || next.trim() === "")
                    return;
                await withApi(async () => {
                    await api.renameProject({ projectId: project.id, name: next.trim() });
                    await refreshProjects();
                }, { reload: true });
            };
            const uploadSource = React.useCallback(async (file) => {
                if (project === null || file === undefined || file === null)
                    return;
                setSourceBusy(true);
                try {
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const text = String(reader.result ?? "");
                            resolve(text.slice(text.indexOf(",") + 1));
                        };
                        reader.onerror = () => reject(new Error(T("读取文件失败")));
                        reader.readAsDataURL(file);
                    });
                    await api.uploadSource({ projectId: project.id, name: file.name, data: base64 });
                    setNotice({ kind: "ok", text: T("已上传源图：{n0}", { n0: file.name }) });
                    await loadProject(project.id);
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
                finally {
                    setSourceBusy(false);
                }
            }, [api, project, loadProject]);
            const savePrompts = (patch) => withApi(() => api.savePrompts({ projectId: project.id, ...patch }), {
                reload: true,
                notice: T("提示词已保存"),
                noticeKind: "ok"
            });
            const saveSettings = (patch) => withApi(() => api.saveSettings({ projectId: project.id, settings: patch }), {
                reload: true,
                notice: T("参数已保存"),
                noticeKind: "ok"
            });
            /**
             * 启动一个后台任务。
             * `started: false` 表示宿主拒绝了这次启动（例如同一任务已在跑）——
             * 这不算错误，但必须让用户看见原因，否则点按钮像是没反应。
             *
             * 第三个参数是「正在调用接口」的反馈：给了就按 key 记账，
             * 界面据此盖 loading 遮罩 / 把按钮变成转圈。
             */
            const start = async (fn, done, feedback) => {
                const invoke = () => withApi(fn, done);
                const result = feedback === undefined
                    ? await invoke()
                    : await tasks.run(feedback.key, feedback.label, invoke);
                if (result !== null && typeof result === "object" && result.started === false) {
                    setNotice({ kind: "info", text: result.reason ?? T("任务没有启动") });
                }
                return result;
            };
            if (api === undefined) {
                return h("div", { className: "SPR_root" }, h("p", { className: "SPR_empty" }, T("正在挂载游戏素材大师…")));
            }
            const activeStageIndex = STAGES.findIndex((s) => s.key === stage);
            const activeStage = STAGES[activeStageIndex < 0 ? 0 : activeStageIndex];
            return h("div", { className: "SPR_root" }, h("div", { className: "SPR_head" }, h("h2", null, T("游戏素材大师")), h("span", { className: "SPR_headSub" }, T("火山方舟 Seedream 生图 · MiniMax 图生视频 · 本地抠绿幕合成")), h("span", { className: "SPR_spacer" }), activeModule === "sprite"
                ? h(React.Fragment, null, h(Btn, { onClick: () => void refreshProjects(), disabled: loading }, T("刷新列表")), project !== null ? h(Btn, { onClick: renameCurrent }, T("重命名")) : null, project !== null ? h(Btn, { onClick: deleteCurrent, danger: true }, T("删除项目")) : null, h(Btn, { onClick: createProject, primary: true }, T("新建项目")))
                : null), h("div", { className: "SPR_modules", "data-hidden-count": String(hidden.length) }, visibleModules.map((entry) => h("button", {
                key: entry.key,
                type: "button",
                className: "SPR_module",
                "data-module": entry.key,
                "data-active": activeModule === entry.key ? "true" : "false",
                onClick: () => setModule(entry.key)
            }, h("span", { className: "SPR_moduleTitleRow" }, h("span", { className: "SPR_moduleTitle" }, entry.title), entry.experimental === true ? h("span", { className: "SPR_expTag" }, T("实验性")) : null), h("span", { className: "SPR_moduleHint" }, entry.hint))), hidden.length > 0
                ? h("span", { className: "SPR_modulesHiddenNote" }, T("已隐藏 {n0} 个功能（设置 → 游戏素材大师 → 功能管理）", { n0: hidden.length }))
                : null), activeModule === null
                ? h("div", { className: "SPR_body" }, h("p", { className: "SPR_empty" }, T("所有功能都已被隐藏。请到「设置 → 游戏素材大师 → 功能管理」里打开至少一个。")))
                : null, activeModule === "sprite"
                ? h("div", { className: "SPR_body" }, h("div", { className: "SPR_side" }, h("div", { className: "SPR_sideTitle" }, T("项目（{n0}）", { n0: projects.length })), projects.length === 0
                    ? h("p", { className: "SPR_hint" }, T("还没有项目，点右上角「新建项目」开始。"))
                    : projects.map((summary) => h("button", {
                        key: summary.id,
                        type: "button",
                        className: "SPR_projItem",
                        "data-active": summary.id === projectId ? "true" : "false",
                        onClick: () => setProjectId(summary.id)
                    }, h("span", { className: "SPR_projName" }, summary.name), h("span", { className: "SPR_projMeta" }, T("图 {n0}/8 · 视频 {n1}/8 · 帧 {n2}/8{n3}", { n0: summary.imageReady, n1: summary.videoReady, n2: summary.framesReady, n3: summary.sheetReady ? T(" · 整图✓") : "" }))))), h("div", { className: "SPR_main" }, notice !== null
                    ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text, h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, T("关闭"))))
                    : null, project === null
                    ? h("p", { className: "SPR_empty" }, loading ? T("正在载入…") : T("请选择或新建一个项目"))
                    : h(React.Fragment, null, 
                    // 审核模式：与对话里的 game_material_reviewMode 是同一份数据。
                    h(ReviewModeBar, { api, module: "sprite", id: project.id, mode: project.reviewMode, onChanged: () => void loadProject(project.id) }), h("div", { className: "SPR_steps" }, STAGES.map((item, index) => h("button", {
                        key: item.key,
                        type: "button",
                        className: "SPR_step",
                        "data-active": item.key === stage ? "true" : "false",
                        onClick: () => setStage(item.key)
                    }, h("span", {
                        className: "SPR_stepDot",
                        style: {
                            background: stageDone(project, item.key)
                                ? "var(--dsw-alias-state-success-primary)"
                                : "var(--dsw-alias-label-tertiary)"
                        }
                    }), item.title))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, activeStage.title)), 
                    // 阶段①的说明跟着生成方式走：转圈截帧不是「八个方向各生成一次」，
                    // 沿用逐方向生图那句话会让人以为走错了页面。
                    h("p", { className: "SPR_hint" }, stageHint(project, stage, activeStage)), stage === "images"
                        ? renderImageStage({
                            project,
                            api,
                            promptDraft,
                            setPromptDraft,
                            promptOpen,
                            setPromptOpen,
                            savePrompts,
                            start,
                            setNotice,
                            loadProject,
                            tasks
                        })
                        : null, stage === "videos"
                        ? renderVideoStage({
                            project,
                            api,
                            videoPromptDraft,
                            setVideoPromptDraft,
                            savePrompts,
                            start,
                            setNotice,
                            loadProject,
                            tasks
                        })
                        : null, stage === "frames"
                        ? renderFrameStage({ project, api, start, setNotice, loadProject, settingsDraft, saveSettings, tasks })
                        : null, stage === "sheet"
                        ? renderSheetStage({
                            project,
                            api,
                            settingsDraft,
                            setSettingsDraft,
                            saveSettings,
                            start,
                            setNotice,
                            loadProject,
                            tasks
                        })
                        : null, stage === "preview" ? h(WalkPreview, { project, tasks }) : null), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("源图"))), h("p", { className: "SPR_hint" }, T("上传角色的原始设定图。第一步的正面绿幕图会以它为唯一参考。")), h("div", { className: "SPR_sourceRow" }, project.source !== null
                        ? h("img", {
                            className: "SPR_sourcePreview",
                            src: assetUrl(project, project.source.file, project.updatedAt),
                            alt: T("源图")
                        })
                        : h("div", { className: "SPR_thumbEmpty", style: { width: 132, height: 132, flex: "none" } }, T("尚未上传源图")), h("div", { style: { flex: 1, minWidth: 240 } }, h("div", {
                        className: "SPR_drop",
                        "data-over": dropOver ? "true" : "false",
                        onDragOver: (event) => {
                            event.preventDefault();
                            setDropOver(true);
                        },
                        onDragLeave: () => setDropOver(false),
                        onDrop: (event) => {
                            event.preventDefault();
                            setDropOver(false);
                            const file = event.dataTransfer?.files?.[0];
                            void uploadSource(file);
                        }
                    }, sourceBusy ? T("正在上传…") : T("把图片拖到这里，或")), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => fileInputRef.current?.click(), disabled: sourceBusy, primary: project.source === null }, project.source === null ? T("选择源图") : T("更换源图")), project.source !== null
                        ? h("span", { className: "SPR_refRow" }, project.source.name)
                        : null), h("input", {
                        ref: fileInputRef,
                        type: "file",
                        accept: "image/*",
                        style: { display: "none" },
                        onChange: (event) => {
                            const file = event.target.files?.[0];
                            void uploadSource(file);
                            event.target.value = "";
                        }
                    })))), renderLog(project), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => void loadProject(project.id) }, T("刷新状态")), h(Btn, { onClick: () => void withApi(() => api.revealProject({ projectId: project.id })) }, T("在访达中打开项目目录"))))))
                : activeModule === "image"
                    ? h(ImageModule, { api })
                    : activeModule === "sequence"
                        ? h(SequenceModule, { api })
                        : activeModule === "tile"
                            ? h(TileModule, { api })
                            : activeModule === "map"
                                ? h(MapModule, { api })
                                : activeModule === "rig"
                                    ? h(RigModule, { api })
                                    : null);
        }
        /** 阶段卡片下方的说明文字（阶段①有两种生成方式，各说各的）。 */
        function stageHint(project, stage, activeStage) {
            if (stage === "images" && imageModeOf(project) === "turn") {
                return T("先生成一段「角色原地匀速转一整圈」的绿幕视频，再按时间截出八个方向的帧；下面时间轴上的八个圆圈就是各自的截帧位置，拖动即可改。");
            }
            return activeStage.hint;
        }
        function stageDone(project, key) {
            if (key === "images")
                return DIRECTION_KEYS.every((k) => project.images?.[k]?.approved);
            if (key === "videos")
                return DIRECTION_KEYS.every((k) => project.videos?.[k]?.approved);
            if (key === "frames")
                return DIRECTION_KEYS.every((k) => project.frames?.[k]?.approved);
            if (key === "preview")
                return project.sheet?.approved === true;
            return project.sheet?.approved === true;
        }
        // ── 阶段 1：八方向绿幕图 ─────────────────────────────────────────────
        /** 阶段①的 pending key：单方向、批量、整批重新生成、重置提示词。 */
        const KEY_IMG_ONE = (key) => `image:${key}`;
        const KEY_IMG_ALL = "image:*all";
        const KEY_IMG_REGENERATE = "image:*regenerate";
        const KEY_PROMPT_RESET = "prompt:*reset";
        // ── 阶段①的另一种生成方式：转圈截帧 ──────────────────────────────────
        //
        // 逐方向生图是八次独立调用，模型每次都要重新「理解」角色，脸型/发色/服装
        // 容易在八个方向之间漂移。转圈截帧只生成**一段**「原地匀速转一整圈」的视频，
        // 八个方向是它时间轴上的八个截帧位置——八个方向天生同源，一致性最好。
        // 这条是默认路径，逐方向生图保留为备选（单张更清晰，但一致性看运气）。
        function make_IMAGE_MODES() {
            return [
                { key: "turn", title: T("转圈截帧"), hint: T("先生成一段「原地匀速转一整圈」的视频，再按时间截出八个方向（默认，一致性最好）") },
                { key: "direct", title: T("逐方向生图"), hint: T("每个方向单独生图（备选：单张更清晰，但八个方向容易不一致）") }
            ];
        }
        let IMAGE_MODES = make_IMAGE_MODES();
        const KEY_TURN_VIDEO = "turn:*video";
        const KEY_TURN_FRAMES = "turn:*frames";
        const KEY_TURN_PICK = (key) => `turn:pick:${key}`;
        const TURN_FRAME_MIN = 8;
        const TURN_FRAME_MAX = 64;
        /**
         * 项目用的是哪种生成方式。
         *
         * 宿主 `normalizeProject` 一定会补齐 `imageMode`；这里再兜一层是给**渲染桩数据**
         * 用的（测试里的项目对象不经过宿主），也是给「字段还不存在的老项目」用的：
         * 已经有图就按逐方向生图走，否则走默认的转圈截帧。
         */
        function imageModeOf(project) {
            if (project?.imageMode === "direct")
                return "direct";
            if (project?.imageMode === "turn")
                return "turn";
            const hasImages = DIRECTION_KEYS.some((key) => project?.images?.[key]?.file !== undefined);
            return hasImages ? "direct" : "turn";
        }
        /** 方向的短名（轴上的圆圈放不下「西南 · 四分之三正面」这种长标签）。 */
        function shortLabelOf(key) {
            const label = LABEL_OF[key] ?? key;
            return label.split(" · ")[0];
        }
        function clamp01(value) {
            return Math.min(1, Math.max(0, value));
        }
        /** 阶段①的生成方式切换条。 */
        function ImageModeBar({ project, api, start, mode }) {
            return h("div", { className: "SPR_modeBar" }, h("span", { className: "SPR_modeBarLabel" }, T("生成方式")), IMAGE_MODES.map((entry) => h("button", {
                key: entry.key,
                type: "button",
                className: "SPR_mode",
                "data-active": mode === entry.key ? "true" : "false",
                title: entry.hint,
                "data-testid": `image-mode-${entry.key}`,
                onClick: () => void start(() => api.setImageMode({ projectId: project.id, mode: entry.key }), { reload: true })
            }, h("span", { className: "SPR_modeTitle" }, entry.title), entry.key === "turn" ? h("span", { className: "SPR_modeTag" }, T("默认")) : null)), h("span", { className: "SPR_modeBarHint" }, (IMAGE_MODES.find((entry) => entry.key === mode) ?? IMAGE_MODES[0]).hint));
        }
        /**
         * 八个截帧位置的时间轴。
         *
         * 轴底是整圈候选帧的缩略条带，「对着画面拖圆圈」是唯一不需要解释的交互——
         * 拖到哪个位置，那个方向就切那一帧。松手才提交（拖动过程只改本地状态），
         * 所以一次拖动最多只触发一次重切。方向键 ←/→ 也能逐个候选帧地微调。
         */
        function TurnAxis({ project, total, duration, picks, images, api, start, busy }) {
            const trackRef = React.useRef(null);
            // 拖动过程只改这份本地状态（圆圈跟着手走），松手才提交一次远程调用。
            const [drag, setDrag] = React.useState(null);
            const pickOf = (key) => {
                if (drag !== null && drag.key === key)
                    return drag.index;
                return Math.min(total - 1, Math.max(0, Number(picks?.[key] ?? 0)));
            };
            const indexFromEvent = (event) => {
                const node = trackRef.current;
                if (node === null || total <= 0)
                    return 0;
                const rect = node.getBoundingClientRect();
                if (rect.width <= 0)
                    return 0;
                const fraction = clamp01((event.clientX - rect.left) / rect.width);
                return Math.min(total - 1, Math.max(0, Math.round(fraction * total - 0.5)));
            };
            const commit = (key, index) => {
                const current = Math.min(total - 1, Math.max(0, Number(picks?.[key] ?? 0)));
                if (index === current)
                    return;
                void start(() => api.setTurnPick({ projectId: project.id, key, index }), { reload: true }, { key: KEY_TURN_PICK(key), label: T("正在切出「{n0}」第 {n1} 帧…", { n0: LABEL_OF[key] ?? key, n1: index + 1 }) });
            };
            const nudge = (key, delta) => {
                const next = Math.min(total - 1, Math.max(0, Number(picks?.[key] ?? 0) + delta));
                commit(key, next);
            };
            // 两个方向被拖到同一帧时会叠在一起，往上错一层；顺序不变，只是看起来分明。
            const lanes = {};
            const used = [];
            [...DIRECTION_KEYS]
                .map((key) => ({ key, index: pickOf(key) }))
                .sort((a, b) => a.index - b.index)
                .forEach((item) => {
                let lane = 0;
                while (used.some((slot) => slot.lane === lane && Math.abs(slot.index - item.index) < 2))
                    lane++;
                used.push({ lane, index: item.index });
                lanes[item.key] = lane;
            });
            return h("div", { className: "SPR_axisWrap" }, h("div", {
                className: "SPR_axis",
                ref: trackRef,
                "data-dragging": drag === null ? undefined : "true",
                onPointerMove: (event) => {
                    if (drag === null)
                        return;
                    const index = indexFromEvent(event);
                    if (index !== drag.index)
                        setDrag({ key: drag.key, index });
                },
                onPointerUp: (event) => {
                    if (drag === null)
                        return;
                    const index = indexFromEvent(event);
                    const key = drag.key;
                    setDrag(null);
                    commit(key, index);
                },
                onPointerLeave: () => {
                    if (drag === null)
                        return;
                    setDrag(null);
                }
            }, h("img", {
                className: "SPR_axisStrip",
                src: assetUrl(project, project.turn?.frames?.strip, project.turn?.frames?.updatedAt),
                alt: T("整圈候选帧"),
                draggable: false
            }), DIRECTION_KEYS.map((key) => {
                const index = pickOf(key);
                const approved = images?.[key]?.approved === true;
                const active = drag !== null && drag.key === key;
                const time = duration > 0 && total > 0 ? (index * duration) / total : 0;
                return h("button", {
                    key,
                    type: "button",
                    className: "SPR_axisDot",
                    "data-active": active ? "true" : "false",
                    "data-approved": approved ? "true" : "false",
                    "data-dragging": busy === true ? "true" : undefined,
                    "data-testid": `turn-dot-${key}`,
                    style: { left: `${((index + 0.5) / Math.max(1, total)) * 100}%`, top: `${6 + (lanes[key] ?? 0) * 26}px` },
                    title: T("{n0}：第 {n1}/{n2} 帧（{n3} 秒）— 拖动改位置，←/→ 微调", { n0: LABEL_OF[key] ?? key, n1: index + 1, n2: total, n3: time.toFixed(2) }),
                    "aria-label": T("{n0} 第 {n1} 帧", { n0: LABEL_OF[key] ?? key, n1: index + 1 }),
                    onPointerDown: (event) => {
                        event.preventDefault();
                        setDrag({ key, index });
                        try {
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                        }
                        catch {
                            /* 指针捕获失败不影响拖动：move/up 挂在轴上 */
                        }
                    },
                    onKeyDown: (event) => {
                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                            return;
                        event.preventDefault();
                        nudge(key, event.key === "ArrowLeft" ? -1 : 1);
                    }
                }, h("span", { className: "SPR_axisDotLabel" }, shortLabelOf(key)), h("span", { className: "SPR_axisDotIndex" }, `${index + 1}`));
            })), h("div", { className: "SPR_axisRuler" }, h("span", null, T("0 秒")), h("span", { className: "SPR_axisRulerMid" }, total > 0
                ? T("共 {n0} 张候选帧 · 每张约 {n1} 秒 —— 拖动圆圈调整每个方向截在哪一帧", { n0: total, n1: (duration / total).toFixed(2) })
                : T("还没有候选帧：先点「生成转圈视频」，视频到手会自动抽帧")), h("span", null, T("{n0} 秒", { n0: duration.toFixed(2) }))));
        }
        /** 转圈截帧：转圈视频 → 候选帧 → 八圆圈时间轴 → 八张方向图。 */
        function TurnImageStage({ project, api, start, setNotice, tasks, savePrompts }) {
            const video = project.turn?.video ?? {};
            const frames = project.turn?.frames ?? {};
            const total = Array.isArray(frames.frames) ? frames.frames.length : 0;
            const duration = Number(frames.duration ?? 0);
            const picks = frames.picks ?? {};
            const [promptDraft, setPromptDraft] = React.useState(project.prompts?.turn ?? "");
            const [countDraft, setCountDraft] = React.useState(null);
            React.useEffect(() => {
                setPromptDraft(project.prompts?.turn ?? "");
            }, [project.prompts?.turn]);
            const videoRunning = video.status === "running" || tasks.has(KEY_TURN_VIDEO);
            const videoLabel = tasks.label(KEY_TURN_VIDEO) ?? (video.remoteStatus ?? T("正在生成转圈视频…"));
            // 「在切帧」= 本地刚点下去 / 宿主那批抽帧还在跑。抽帧是 kick 型调用，
            // 一提交就返回，真正的活（抽 32 张 + 切 8 张图）在后台，所以两者都要看。
            const hostFrames = hostJob(project, "turn:frames");
            const cutting = frames.status === "running" || tasks.has(KEY_TURN_FRAMES) || hostFrames !== undefined;
            const cutLabel = tasks.label(KEY_TURN_FRAMES) ?? (frames.status === "running" ? T("正在抽取候选帧…") : T("正在抽取候选帧并切出八个方向…"));
            const promptDirty = promptDraft !== (project.prompts?.turn ?? "");
            const frameCount = Number(countDraft ?? project.settings?.turnFrameCount ?? 32);
            const allApproved = DIRECTION_KEYS.every((key) => project.images?.[key]?.approved);
            const readyImages = DIRECTION_KEYS.filter((key) => project.images?.[key]?.file !== undefined).length;
            const stale = frames.stale === true;
            return h(React.Fragment, null, h("p", { className: "SPR_hint" }, T("先生成一段「角色原地匀速转一整圈」的视频（绿幕、保持原图风格、除旋转外不做任何动作），再按时间截出八个方向的帧。八个方向出自同一段视频，一致性比逐方向生图好得多；下面时间轴上的八个圆圈就是各自的截帧位置，随便拖。")), h("textarea", {
                className: "SPR_area",
                value: promptDraft,
                "data-testid": "turn-prompt",
                onChange: (event) => setPromptDraft(event.target.value)
            }), h("div", { className: "SPR_toolbar" }, h(Btn, { disabled: !promptDirty, onClick: () => void savePrompts({ turn: promptDraft }) }, promptDirty ? T("保存转圈提示词") : T("转圈提示词已保存")), h(Btn, {
                onClick: () => void start(() => api.savePrompts({ projectId: project.id, resetTurnToDefault: true }), {
                    reload: true,
                    notice: T("转圈提示词已重置为默认模板"),
                    noticeKind: "ok"
                })
            }, T("重置为默认"))), h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                primary: video.file === undefined,
                busy: tasks.has(KEY_TURN_VIDEO),
                busyText: T("正在提交…"),
                disabled: project.source === null || videoRunning,
                onClick: () => void start(() => api.runTurnVideo({ projectId: project.id }), { reload: true }, {
                    key: KEY_TURN_VIDEO,
                    label: T("正在提交转圈视频任务…")
                })
            }, video.file === undefined
                ? T("生成转圈视频（计费一次）")
                : videoRunning
                    ? T("转圈视频生成中…")
                    : T("重新生成转圈视频（计费一次）")), h(BusyBtn, {
                busy: tasks.has(KEY_TURN_FRAMES),
                busyText: T("正在抽帧…"),
                disabled: video.file === undefined || cutting,
                onClick: () => void start(() => api.runTurnFrames({ projectId: project.id }), { reload: true }, {
                    key: KEY_TURN_FRAMES,
                    label: T("正在抽取候选帧并切出八个方向…")
                })
            }, total > 0 ? T("重新抽帧（当前 {n0} 张）", { n0: total }) : T("抽取候选帧")), h(NumField, {
                label: T("候选帧数（8~64）"),
                value: frameCount,
                min: TURN_FRAME_MIN,
                max: TURN_FRAME_MAX,
                onChange: (value) => setCountDraft(value)
            }), h(BusyBtn, {
                busy: tasks.has(KEY_TURN_FRAMES),
                busyText: T("正在抽帧…"),
                disabled: video.file === undefined || cutting || countDraft === null || countDraft === project.settings?.turnFrameCount,
                onClick: () => void start(() => api.runTurnFrames({ projectId: project.id, count: frameCount }), { reload: true, notice: T("已按 {n0} 张重抽候选帧", { n0: frameCount }), noticeKind: "ok" }, {
                    key: KEY_TURN_FRAMES,
                    label: T("正在按 {n0} 张重抽候选帧…", { n0: frameCount })
                })
            }, T("应用帧数")), h("span", { className: "SPR_refRow" }, project.settings?.turnFrameCount === frameCount ? T("当前 {n0} 张", { n0: project.settings?.turnFrameCount ?? "—" }) : T("未应用（当前 {n0} 张）", { n0: project.settings?.turnFrameCount ?? "—" }))), h("div", { className: "SPR_toolbar" }, h(Btn, {
                disabled: total === 0 || cutting,
                onClick: () => void start(() => api.resetTurnPicks({ projectId: project.id }), { reload: true, notice: T("八个圆圈已回到默认等分位置"), noticeKind: "ok" })
            }, T("重置八个圆圈")), h(Btn, {
                disabled: total === 0 || cutting,
                title: T("转圈方向决定默认位置怎么排；拖动过的圆圈以你的位置为准"),
                onClick: () => void start(() => api.resetTurnPicks({ projectId: project.id, direction: project.turn?.direction === "ccw" ? "cw" : "ccw" }), {
                    reload: true,
                    notice: project.turn?.direction === "ccw" ? T("已改为顺时针并重排八个圆圈") : T("已改为逆时针并重排八个圆圈"),
                    noticeKind: "ok"
                })
            }, project.turn?.direction === "ccw" ? T("转圈方向：逆时针（点一下换向）") : T("转圈方向：顺时针（点一下换向）")), h(Btn, {
                on: allApproved,
                disabled: readyImages === 0,
                onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "images", approved: !allApproved }), { reload: true })
            }, allApproved ? T("取消全部通过") : T("全部标记通过")), h(BusyBadge, { show: videoRunning || cutting, text: videoRunning ? videoLabel : cutLabel })), video.file !== undefined
                ? h("div", { className: "SPR_videoWrap" }, h(MediaBox, {
                    overlay: videoRunning,
                    text: videoLabel,
                    children: h("video", {
                        className: "SPR_video SPR_videoTurn",
                        src: assetUrl(project, video.file, video.updatedAt),
                        controls: true,
                        preload: "metadata",
                        "data-testid": "turn-video"
                    })
                }))
                : h("div", { className: "SPR_thumbEmpty", style: { aspectRatio: "16/9" } }, videoRunning ? T("正在生成转圈视频…") : T("还没有转圈视频：点上面的「生成转圈视频」")), video.error !== undefined ? h("p", { className: "SPR_error" }, video.error) : null, h("div", { className: "SPR_refRow" }, T("首帧用的是{n0}：{n1}", { n0: video.firstFrame !== undefined && String(video.firstFrame).startsWith("images/") ? T("已生成的正面绿幕图") : T("上传的源图"), n1: video.firstFrame ?? "—" })), total > 0
                ? h(TurnAxis, {
                    project,
                    total,
                    duration,
                    picks,
                    images: project.images,
                    api,
                    start,
                    busy: cutting
                })
                : h("div", { className: "SPR_thumbEmpty", style: { marginTop: 10 } }, cutting ? T("正在抽取候选帧…") : stale ? T("候选帧已过期（转圈视频换过了）：点「重新抽帧」") : T("还没有候选帧")), frames.error !== undefined ? h("p", { className: "SPR_error" }, frames.error) : null, h("div", { className: "SPR_grid", style: { marginTop: 12 } }, DIRECTION_KEYS.map((key) => {
                const node = project.images?.[key];
                const index = Math.min(Math.max(0, total - 1), Math.max(0, Number(picks[key] ?? 0)));
                const queued = (tasks.has(KEY_TURN_FRAMES) || jobCovers(hostFrames, key)) && node?.status !== "error";
                const nodeBusy = node?.status === "running" || tasks.has(KEY_TURN_PICK(key)) || queued;
                const overlayText = tasks.label(KEY_TURN_PICK(key)) ?? (queued ? cutLabel : T("正在切出这一帧…"));
                return h("div", { key, className: "SPR_node", "data-busy": nodeBusy ? "true" : undefined }, h("div", { className: "SPR_nodeTop" }, h("span", { className: "SPR_nodeTitle" }, LABEL_OF[key] ?? key), nodeBusy ? h(Chip, { kind: "running", text: T("切帧中") }) : h(StatusChip, { node })), node?.file !== undefined
                    ? h(MediaBox, { overlay: nodeBusy, text: overlayText }, h("img", { className: "SPR_thumb", src: assetUrl(project, node.file, node.updatedAt ?? project.updatedAt), alt: LABEL_OF[key] ?? key }))
                    : h("div", { className: "SPR_thumbEmpty" }, nodeBusy ? T("正在切出这一帧…") : T("还没有这一方向的图")), node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null, h("span", { className: "SPR_refRow" }, total > 0
                    ? T("第 {n0}/{n1} 帧 · {n2} 秒", { n0: index + 1, n1: total, n2: ((index * duration) / Math.max(1, total)).toFixed(2) })
                    : T("等待候选帧")), h("div", { className: "SPR_btnRow" }, h(Btn, {
                    disabled: node?.status !== "ready" || nodeBusy,
                    on: node?.approved === true,
                    onClick: () => void start(() => api.setApproved({
                        projectId: project.id,
                        stage: "images",
                        key,
                        approved: node?.approved !== true
                    }), { reload: true })
                }, node?.approved === true ? T("已通过") : T("通过"))));
            })));
        }
        function renderImageStage(ctx) {
            const { project, api, promptDraft, setPromptDraft, promptOpen, setPromptOpen, savePrompts, start, setNotice, tasks } = ctx;
            const mode = imageModeOf(project);
            const modeBar = h(ImageModeBar, { project, api, start, mode });
            // 转圈截帧（默认）：整条链路都在 TurnImageStage 里，产物同样是 images/<方向>.png。
            if (mode === "turn") {
                return h(React.Fragment, null, modeBar, h(TurnImageStage, { project, api, start, setNotice, tasks, savePrompts }));
            }
            const allApproved = DIRECTION_KEYS.every((key) => project.images?.[key]?.approved);
            // 「一键生成全部」/「全部重新生成」提交后，八个方向都可能要重出图，
            // 在宿主状态回来之前先整体盖住，别让用户以为按钮没生效。
            const batch = tasks.has(KEY_IMG_ALL) || tasks.has(KEY_IMG_REGENERATE);
            const batchLabel = tasks.label(KEY_IMG_REGENERATE) ?? tasks.label(KEY_IMG_ALL) ?? T("正在生成绿幕图…");
            // 宿主侧那批生成还在跑（一次两个方向地慢慢做）：本地 pending 只多留 700ms，
            // 撑不住整批，按钮的置灰与徽章要看宿主这张表。
            const hostAll = hostJob(project, "images:all");
            const batchBusy = batch || hostAll !== undefined;
            const resetting = tasks.has(KEY_PROMPT_RESET);
            return h(React.Fragment, null, modeBar, h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                primary: true,
                busy: tasks.has(KEY_IMG_ALL),
                busyText: T("正在提交全部方向…"),
                // 宿主的这一批还在跑时按钮置灰：重复点只会被宿主拒绝，
                // 用户却会以为没反应（工具栏徽章已经写明在跑什么）。
                disabled: project.source === null || batchBusy,
                onClick: () => void start(() => api.runImages({ projectId: project.id }), { reload: true }, {
                    key: KEY_IMG_ALL,
                    label: T("正在提交全部方向…")
                })
            }, T("一键生成全部（跳过已通过的）")), h(BusyBtn, {
                busy: tasks.has(KEY_IMG_REGENERATE),
                busyText: T("正在提交全部重做…"),
                disabled: batchBusy,
                onClick: () => void start(() => api.runImages({ projectId: project.id, force: true }), { reload: true }, {
                    key: KEY_IMG_REGENERATE,
                    label: T("正在提交全部重做…")
                })
            }, T("全部重新生成")), h(Btn, {
                on: allApproved,
                disabled: batchBusy,
                onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "images", approved: !allApproved }), { reload: true })
            }, allApproved ? T("取消全部通过") : T("全部标记通过")), h(BusyBtn, {
                busy: resetting,
                busyText: T("正在重置…"),
                disabled: batchBusy,
                onClick: () => {
                    if (typeof window !== "undefined" && !window.confirm(T("把八个方向的生图提示词和视频提示词都重置为当前默认模板？你手改过的内容会丢失。")))
                        return;
                    void start(() => api.savePrompts({ projectId: project.id, resetImagesToDefault: true, resetVideoToDefault: true }), { reload: true, notice: T("提示词已重置为默认模板"), noticeKind: "ok" }, { key: KEY_PROMPT_RESET, label: T("正在重置提示词…") });
                }
            }, T("重置提示词为默认")), h(BusyBadge, { show: batchBusy, text: batchLabel }), project.source === null ? h("span", { className: "SPR_refRow" }, T("请先上传源图")) : null), h("div", { className: "SPR_grid" }, DIRECTIONS.map((direction) => {
                const node = project.images?.[direction.key];
                const draft = promptDraft[direction.key] ?? project.prompts?.images?.[direction.key] ?? "";
                const dirty = draft !== (project.prompts?.images?.[direction.key] ?? "");
                const open = promptOpen[direction.key] === true;
                // 这个方向在跑：宿主已标 running，或刚点了按钮、状态还没轮询回来。
                const taskKey = KEY_IMG_ONE(direction.key);
                // 批量提交时，**还没轮到的方向也要盖住**——否则旧图看着像「点了没反应」。
                // 两条路：本地刚点下去（批量 key），或宿主那批任务还在跑且覆盖了这个方向。
                const waiting = (batch && node?.status !== "running" && !tasks.has(taskKey)) ||
                    (jobCovers(hostAll, direction.key) && node?.status !== "error");
                const nodeBusy = node?.status === "running" || tasks.has(taskKey) || waiting;
                const withPromptKey = `${taskKey}:prompt`;
                const overlayText = tasks.label(taskKey) ?? (waiting ? batchLabel : T("正在生成…"));
                return h("div", { key: direction.key, className: "SPR_node", "data-stale": node?.stale === true ? "true" : "false", "data-busy": nodeBusy ? "true" : undefined }, h("div", { className: "SPR_nodeTop" }, h("span", { className: "SPR_nodeTitle" }, direction.label), nodeBusy ? h(Chip, { kind: "running", text: T("生成中") }) : h(StatusChip, { node })), node?.file !== undefined
                    ? h(MediaBox, { overlay: nodeBusy, text: overlayText }, h("img", {
                        className: "SPR_thumb",
                        src: assetUrl(project, node.file, node.updatedAt ?? project.updatedAt),
                        alt: direction.label
                    }))
                    : h("div", { className: "SPR_thumbEmpty" }, nodeBusy ? T("正在生成…") : T("参考：{n0}", { n0: direction.refs.join(" + ") })), nodeBusy ? h(BusyBadge, { show: true, text: overlayText }) : null, node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null, node?.status === "ready" && node.elapsedMs !== undefined
                    ? h("span", { className: "SPR_refRow" }, T("用时 {n0} 秒 · {n1}", { n0: (node.elapsedMs / 1000).toFixed(1), n1: node.model ?? "" }))
                    : h("span", { className: "SPR_refRow" }, T("参考：{n0}", { n0: direction.refs.join(" + ") })), h("button", {
                    type: "button",
                    className: "SPR_miniBtn",
                    onClick: () => setPromptOpen({ ...promptOpen, [direction.key]: !open })
                }, open ? T("收起提示词 ▲") : T("编辑提示词 ▼")), open
                    ? h(React.Fragment, null, h("textarea", {
                        className: "SPR_area",
                        value: draft,
                        onChange: (event) => setPromptDraft({ ...promptDraft, [direction.key]: event.target.value })
                    }), h("div", { className: "SPR_btnRow" }, h(Btn, {
                        disabled: !dirty,
                        onClick: () => void savePrompts({ images: { [direction.key]: draft } })
                    }, dirty ? T("保存改动") : T("已保存")), h(BusyBtn, {
                        busy: tasks.has(withPromptKey),
                        busyText: T("正在提交…"),
                        onClick: () => void start(() => api.runImage({ projectId: project.id, key: direction.key, prompt: draft }), { reload: true }, { key: withPromptKey, label: T("正在用这段提示词生成「{n0}」…", { n0: direction.label }) })
                    }, T("用这段提示词生成"))))
                    : null, h("div", { className: "SPR_btnRow" }, h(BusyBtn, {
                    primary: node?.file === undefined,
                    busy: tasks.has(taskKey),
                    busyText: T("正在提交…"),
                    onClick: () => void start(() => api.runImage({ projectId: project.id, key: direction.key }), { reload: true }, {
                        key: taskKey,
                        label: T("正在生成「{n0}」…", { n0: direction.label })
                    })
                }, node?.file === undefined ? T("生成") : T("重新生成")), h(Btn, {
                    on: node?.approved === true,
                    disabled: node?.status !== "ready",
                    onClick: () => void start(() => api.setApproved({
                        projectId: project.id,
                        stage: "images",
                        key: direction.key,
                        approved: node?.approved !== true
                    }), { reload: true })
                }, node?.approved === true ? T("已通过") : T("通过"))));
            })));
        }
        // ── 阶段 2：视频 ─────────────────────────────────────────────────────
        const KEY_VIDEO_ONE = (key) => `video:${key}`;
        const KEY_VIDEO_ALL = "video:*all";
        const KEY_VIDEO_POLL = "video:*poll";
        function renderVideoStage(ctx) {
            const { project, videoPromptDraft, setVideoPromptDraft, savePrompts, start, setNotice, api, tasks } = ctx;
            const readyImages = DIRECTION_KEYS.filter((key) => project.images?.[key]?.file !== undefined);
            const promptDirty = videoPromptDraft !== (project.prompts?.video ?? "");
            const running = DIRECTION_KEYS.filter((key) => project.videos?.[key]?.status === "running");
            const allApproved = DIRECTION_KEYS.every((key) => project.videos?.[key]?.approved);
            // 宿主侧那次提交覆盖了哪些方向（批量提交是逐个方向提交的）；
            // 本地 pending 只多留 700ms，还没轮到的方向要靠它撑着。
            const hostSubmit = hostJob(project, "videos:submit");
            const submitting = tasks.any("video:*") || hostSubmit !== undefined;
            // 批量提交视频时八个方向都会重新出片，提交阶段先把预览整体盖住。
            const allBusy = tasks.has(KEY_VIDEO_ALL);
            const allLabel = tasks.label(KEY_VIDEO_ALL) ?? T("正在提交 8 个方向的视频任务…");
            return h(React.Fragment, null, h("p", { className: "SPR_hint" }, T("提示词要求「固定镜头、固定背景、原地走三步」。Hailuo 一段通常要 1~6 分钟，提交后可以离开这个页面。")), h("textarea", {
                className: "SPR_area",
                value: videoPromptDraft,
                onChange: (event) => setVideoPromptDraft(event.target.value)
            }), h("div", { className: "SPR_toolbar" }, h(Btn, { disabled: !promptDirty, onClick: () => void savePrompts({ video: videoPromptDraft }) }, promptDirty ? T("保存视频提示词") : T("视频提示词已保存")), h(BusyBtn, {
                primary: true,
                busy: tasks.has(KEY_VIDEO_ALL),
                busyText: T("正在提交 8 个方向…"),
                disabled: readyImages.length === 0 || submitting,
                onClick: () => void start(() => api.runVideos({ projectId: project.id }), { reload: true }, {
                    key: KEY_VIDEO_ALL,
                    label: T("正在提交全部方向…")
                })
            }, T("生成全部视频（{n0}/8 张绿幕图就绪）", { n0: readyImages.length })), h(BusyBtn, {
                busy: tasks.has(KEY_VIDEO_POLL),
                busyText: T("正在查询…"),
                onClick: () => void start(() => api.pollVideos({ projectId: project.id }), { reload: true }, {
                    key: KEY_VIDEO_POLL,
                    label: T("正在查询远端视频进度…")
                })
            }, T("立即刷新进度")), h(Btn, {
                on: allApproved,
                disabled: submitting,
                onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "videos", approved: !allApproved }), { reload: true })
            }, allApproved ? T("取消全部通过") : T("全部标记通过")), h(Btn, {
                danger: true,
                disabled: submitting,
                onClick: () => {
                    if (typeof window !== "undefined" && !window.confirm(T("清空所有视频与已抽的帧？绿幕图会保留。")))
                        return;
                    void start(() => api.clearVideos({ projectId: project.id }), { reload: true, notice: T("已清空视频与序列帧"), noticeKind: "ok" });
                }
            }, T("清空视频重来")), running.length > 0 ? h("span", { className: "SPR_refRow" }, T("{n0} 个任务进行中，界面会自动刷新", { n0: running.length })) : null), h("div", { className: "SPR_grid" }, DIRECTIONS.map((direction) => {
                const video = project.videos?.[direction.key];
                const image = project.images?.[direction.key];
                const taskKey = KEY_VIDEO_ONE(direction.key);
                // 还没轮到的方向：本地批量提交（allBusy），或宿主那批提交覆盖了它。
                const waiting = (allBusy && video?.status !== "running" && !tasks.has(taskKey)) ||
                    (jobCovers(hostSubmit, direction.key) && video?.status !== "error");
                const nodeBusy = video?.status === "running" || tasks.has(taskKey) || waiting;
                const overlayText = tasks.label(taskKey) ?? (waiting ? allLabel : T("正在生成视频…"));
                return h("div", { key: direction.key, className: "SPR_node", "data-busy": nodeBusy ? "true" : undefined }, h("div", { className: "SPR_nodeTop" }, h("span", { className: "SPR_nodeTitle" }, direction.label), nodeBusy ? h(Chip, { kind: "running", text: T("生成中") }) : h(StatusChip, { node: video })), video?.file !== undefined
                    ? h(MediaBox, { overlay: nodeBusy || waiting, text: overlayText }, h("video", {
                        className: "SPR_video",
                        src: assetUrl(project, video.file, video.updatedAt ?? project.updatedAt),
                        controls: true,
                        preload: "metadata"
                    }))
                    : image?.file !== undefined
                        ? h(MediaBox, { overlay: nodeBusy || waiting, text: overlayText }, h("img", { className: "SPR_thumb", src: assetUrl(project, image.file, image.updatedAt), alt: direction.label }))
                        : h("div", { className: "SPR_thumbEmpty" }, T("还没有绿幕图")), nodeBusy || waiting ? h(BusyBadge, { show: true, text: overlayText }) : null, video?.remoteStatus !== undefined ? h("span", { className: "SPR_refRow" }, T("远端状态：{n0}", { n0: video.remoteStatus })) : null, video?.error !== undefined ? h("p", { className: "SPR_error" }, video.error) : null, h("div", { className: "SPR_btnRow" }, h(BusyBtn, {
                    primary: video?.file === undefined && image?.file !== undefined,
                    busy: tasks.has(taskKey),
                    busyText: T("正在提交…"),
                    disabled: image?.file === undefined,
                    onClick: () => void start(() => api.runVideos({
                        projectId: project.id,
                        keys: [direction.key],
                        // 已经有成片时，这一次点击是「重新生成」：必须显式告诉宿主
                        // 作废旧视频与它抽出来的帧再提交。不带这个标记时宿主会把
                        // ready 的方向当成「已完成」跳过，界面只看到转一圈就结束，
                        // 真正的失败原因只留在日志里。
                        regenerate: video?.file !== undefined
                    }), { reload: true }, {
                        key: taskKey,
                        label: T("正在生成「{n0}」视频…", { n0: direction.label })
                    })
                }, video?.file === undefined ? T("生成视频") : T("重新生成")), h(Btn, {
                    on: video?.approved === true,
                    disabled: video?.status !== "ready",
                    onClick: () => void start(() => api.setApproved({
                        projectId: project.id,
                        stage: "videos",
                        key: direction.key,
                        approved: video?.approved !== true
                    }), { reload: true })
                }, video?.approved === true ? T("已通过") : T("通过"))));
            })));
        }
        /**
         * 某一段行走视频的选帧轴。圆圈个数 = 输出帧数，拖到候选条带的哪一格，
         * 那一张输出帧就用那一格。松手才提交，和转圈截帧的八圆圈是同一套交互。
         */
        function FramePickAxis({ project, directionKey, total, duration, picks, api, start, busy }) {
            const trackRef = React.useRef(null);
            const [drag, setDrag] = React.useState(null);
            const pickOf = (slot) => {
                if (drag !== null && drag.slot === slot)
                    return drag.index;
                return Math.min(total - 1, Math.max(0, Number(picks?.[slot] ?? 0)));
            };
            const indexFromEvent = (event) => {
                const node = trackRef.current;
                if (node === null || total <= 0)
                    return 0;
                const rect = node.getBoundingClientRect();
                if (rect.width <= 0)
                    return 0;
                const fraction = clamp01((event.clientX - rect.left) / rect.width);
                return Math.min(total - 1, Math.max(0, Math.round(fraction * total - 0.5)));
            };
            const commit = (slot, index) => {
                const current = Math.min(total - 1, Math.max(0, Number(picks?.[slot] ?? 0)));
                if (index === current)
                    return;
                void start(() => api.setFramePick({ projectId: project.id, key: directionKey, slot, index }), { reload: true }, { key: `frames:slot:${directionKey}:${slot}`, label: T("正在切出第 {n0} 帧…", { n0: slot + 1 }) });
            };
            const nudge = (slot, delta) => {
                const next = Math.min(total - 1, Math.max(0, Number(picks?.[slot] ?? 0) + delta));
                commit(slot, next);
            };
            const lanes = {};
            const used = [];
            picks.forEach((_, slot) => {
                const index = pickOf(slot);
                let lane = 0;
                while (used.some((item) => item.lane === lane && Math.abs(item.index - index) < 2))
                    lane++;
                used.push({ lane, index });
                lanes[slot] = lane;
            });
            const candidates = project.frames?.[directionKey]?.candidates ?? {};
            return h("div", { className: "SPR_axisWrap" }, h("div", {
                className: "SPR_axis",
                ref: trackRef,
                "data-dragging": drag === null ? undefined : "true",
                onPointerMove: (event) => {
                    if (drag === null)
                        return;
                    const index = indexFromEvent(event);
                    if (index !== drag.index)
                        setDrag({ slot: drag.slot, index });
                },
                onPointerUp: (event) => {
                    if (drag === null)
                        return;
                    const index = indexFromEvent(event);
                    const slot = drag.slot;
                    setDrag(null);
                    commit(slot, index);
                },
                onPointerLeave: () => {
                    if (drag === null)
                        return;
                    setDrag(null);
                }
            }, h("img", {
                className: "SPR_axisStrip",
                src: assetUrl(project, candidates.strip, candidates.updatedAt),
                alt: T("候选帧"),
                draggable: false
            }), picks.map((_, slot) => {
                const index = pickOf(slot);
                const active = drag !== null && drag.slot === slot;
                const time = duration > 0 && total > 0 ? (index * duration) / total : 0;
                return h("button", {
                    key: slot,
                    type: "button",
                    className: "SPR_axisDot",
                    "data-active": active ? "true" : "false",
                    "data-testid": `frame-dot-${directionKey}-${slot}`,
                    style: { left: `${((index + 0.5) / Math.max(1, total)) * 100}%`, top: `${6 + (lanes[slot] ?? 0) * 26}px` },
                    title: T("第 {n0} 帧：候选第 {n1}/{n2}（{n3} 秒）— 拖动改位置，←/→ 微调", { n0: slot + 1, n1: index + 1, n2: total, n3: time.toFixed(2) }),
                    "aria-label": T("第 {n0} 帧，候选第 {n1}", { n0: slot + 1, n1: index + 1 }),
                    onPointerDown: (event) => {
                        if (busy === true)
                            return;
                        event.preventDefault();
                        setDrag({ slot, index });
                        try {
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                        }
                        catch {
                            /* 指针捕获失败不影响拖动 */
                        }
                    },
                    onKeyDown: (event) => {
                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                            return;
                        event.preventDefault();
                        nudge(slot, event.key === "ArrowLeft" ? -1 : 1);
                    }
                }, h("span", { className: "SPR_axisDotLabel" }, String(slot + 1)), h("span", { className: "SPR_axisDotIndex" }, String(index + 1)));
            })), h("div", { className: "SPR_axisRuler" }, h("span", null, T("0 秒")), h("span", { className: "SPR_axisRulerMid" }, T("共 {n0} 张候选帧 · {n1} 个圆圈 —— 拖动圆圈决定每一张输出帧截在哪", { n0: total, n1: picks.length })), h("span", null, T("{n0} 秒", { n0: duration.toFixed(2) }))));
        }
        function FramePickPanel({ project, direction, api, start, tasks, countDraft, setCountDraft }) {
            const node = project.frames?.[direction.key] ?? {};
            const candidates = node.candidates ?? {};
            const total = Array.isArray(candidates.frames) ? candidates.frames.length : 0;
            const duration = Number(candidates.duration ?? node.duration ?? 0);
            const picks = Array.isArray(candidates.picks) ? candidates.picks : [];
            const frameCount = Number(countDraft ?? candidates.rawFrameCount ?? 32);
            const taskKey = `frames:pick:${direction.key}`;
            const hostPick = hostJob(project, taskKey);
            const cutting = candidates.status === "running" || tasks.has(taskKey) || hostPick !== undefined;
            const video = project.videos?.[direction.key];
            return h("div", { className: "SPR_pickPanel", "data-testid": `frame-pick-${direction.key}` }, h("div", { className: "SPR_pickHead" }, h("span", { className: "SPR_nodeTitle" }, T("手动选帧 · {n0}", { n0: direction.label })), h("span", { className: "SPR_refRow" }, T("只影响这一段视频。圆圈个数跟「每段视频抽帧数」走，拖到哪一格就截哪一格。"))), video?.file !== undefined
                ? h("video", {
                    className: "SPR_video",
                    src: assetUrl(project, video.file, video.updatedAt),
                    controls: true,
                    preload: "metadata"
                })
                : null, h("div", { className: "SPR_toolbar" }, h(NumField, {
                label: T("候选帧数（8~64）"),
                value: frameCount,
                min: TURN_FRAME_MIN,
                max: TURN_FRAME_MAX,
                onChange: (value) => setCountDraft(value)
            }), h(BusyBtn, {
                busy: tasks.has(taskKey),
                busyText: T("正在抽候选帧…"),
                disabled: cutting && !tasks.has(taskKey),
                onClick: () => void start(() => api.prepareFramePick({ projectId: project.id, key: direction.key, count: frameCount }), { reload: true, notice: T("已按 {n0} 张候选帧重抽「{n1}」", { n0: frameCount, n1: direction.label }), noticeKind: "ok" }, { key: taskKey, label: T("正在抽取「{n0}」的候选帧…", { n0: direction.label }) })
            }, total > 0 ? T("重新抽取候选帧") : T("抽取候选帧")), h(BusyBtn, {
                busy: tasks.has(`frames:slot:${direction.key}:reset`),
                busyText: T("正在重置…"),
                disabled: total === 0 || cutting,
                onClick: () => void start(() => api.resetFramePicks({ projectId: project.id, key: direction.key }), { reload: true, notice: T("圆圈已回到等分位置"), noticeKind: "ok" }, { key: `frames:slot:${direction.key}:reset`, label: T("正在重置「{n0}」的选帧…", { n0: direction.label }) })
            }, T("重置为等分")), h(BusyBadge, { show: cutting, text: tasks.label(taskKey) ?? T("正在抽取候选帧…") })), total > 0
                ? h(FramePickAxis, {
                    project,
                    directionKey: direction.key,
                    total,
                    duration,
                    picks,
                    api,
                    start,
                    busy: cutting
                })
                : h("div", { className: "SPR_thumbEmpty" }, cutting ? T("正在抽取候选帧…") : T("还没有候选帧")), candidates.error !== undefined ? h("p", { className: "SPR_error" }, candidates.error) : null);
        }
        // ── 阶段 3：抽帧 ─────────────────────────────────────────────────────
        const KEY_FRAMES_ONE = (key) => `frames:${key}`;
        const KEY_FRAMES_ALL = "frames:*all";
        const KEY_FRAMES_PICK = (key) => `frames:pick:${key}`;
        function renderFrameStage(ctx) {
            const { project, start, api, settingsDraft, saveSettings, tasks } = ctx;
            // 选帧草稿必须放在独立组件里。这里是普通函数，而且只在切到「提取序列帧」
            // 时才被调用；直接 useState 会算进 StudioPanel，前后两次渲染的 Hook 数量对不上。
            return h(FrameStage, { project, start, api, settingsDraft, saveSettings, tasks });
        }
        function FrameStage({ project, start, api, settingsDraft, saveSettings, tasks }) {
            const readyVideos = DIRECTION_KEYS.filter((key) => project.videos?.[key]?.file !== undefined);
            const allApproved = DIRECTION_KEYS.every((key) => project.frames?.[key]?.approved);
            const draft = settingsDraft ?? project.settings ?? {};
            // 宿主侧那次抽帧任务盖住了哪些方向。批量抽帧是「一次两个方向」慢慢做的，
            // 本地 pending 表只多留 700ms，盖不住还没轮到的那六个方向——只看它就会
            // 出现「先转圈、紧接着变回尚未抽帧、过一阵才出结果」。
            const [pickKey, setPickKey] = React.useState(null);
            const [pickCount, setPickCount] = React.useState(null);
            const hostExtract = hostJob(project, "frames:extract");
            const hostPicking = Array.isArray(project.jobs) && project.jobs.some((job) => typeof job?.key === "string" && job.key.startsWith("frames:pick:"));
            const extracting = tasks.any("frames:*") || tasks.any("frames:pick:") || hostExtract !== undefined || hostPicking;
            const batchLabel = tasks.label(KEY_FRAMES_ALL) ?? T("正在抽取全部序列帧…");
            return h(React.Fragment, null, h("div", { className: "SPR_fields" }, h(NumField, {
                label: T("单格宽（px）"),
                value: draft.cellWidth ?? 256,
                min: 16,
                max: 2048,
                onChange: (value) => saveSettings({ cellWidth: value })
            }), h(NumField, {
                label: T("单格高（px）"),
                value: draft.cellHeight ?? 256,
                min: 16,
                max: 2048,
                onChange: (value) => saveSettings({ cellHeight: value })
            }), h(NumField, {
                label: T("每段视频抽帧数"),
                value: draft.frameCount ?? 8,
                min: 1,
                max: 64,
                onChange: (value) => saveSettings({ frameCount: value })
            }), h(NumField, {
                label: T("抽帧工作尺寸（长边 px）"),
                value: draft.workingLongEdge ?? 768,
                min: 128,
                max: 2048,
                onChange: (value) => saveSettings({ workingLongEdge: value })
            }), h(NumField, {
                label: T("并发数"),
                value: draft.concurrency ?? 3,
                min: 1,
                max: 8,
                onChange: (value) => saveSettings({ concurrency: value })
            })), h("p", { className: "SPR_hint" }, T("抽帧抽到的是「工作尺寸」（长边上限），不是最终格子尺寸。自动裁剪、统一缩放和像素量化都在第 4 步做，这样八个方向才能共享同一个裁剪框、脚底对齐同一条基线。改完这里需要重新抽帧。") +
                T("「提取全部」对每一段视频用同一套等分；要某一段单独挑帧，点那张卡片上的「手动选帧」，拖圆圈即可（和转圈截帧一样）。") +
                T("预览带是**双击看大图**：格子尺寸只有 256px，看不清动作和抠像质量。")), h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                primary: true,
                busy: tasks.has(KEY_FRAMES_ALL),
                busyText: T("正在抽取全部序列帧…"),
                disabled: readyVideos.length === 0 || extracting,
                onClick: () => void start(() => api.runFrames({ projectId: project.id }), { reload: true }, {
                    key: KEY_FRAMES_ALL,
                    label: T("正在抽取全部序列帧…")
                })
            }, T("提取全部序列帧（{n0}/8 段视频就绪）", { n0: readyVideos.length })), h(Btn, {
                on: allApproved,
                disabled: extracting,
                onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "frames", approved: !allApproved }), { reload: true })
            }, allApproved ? T("取消全部通过") : T("全部标记通过")), h(BusyBadge, { show: extracting, text: tasks.label(KEY_FRAMES_ALL) ?? T("正在抽帧…") })), h("div", { className: "SPR_grid" }, DIRECTIONS.flatMap((direction) => {
                const node = project.frames?.[direction.key];
                const taskKey = KEY_FRAMES_ONE(direction.key);
                // 这一批还没轮到 / 产物还没出来的方向也要盖着。两条路：本地刚点下去
                // （批量 key 在远程调用返回后还会多留 700ms，覆盖「下一次轮询还没回来」
                // 的那一下），以及宿主任务表（整段任务都在）。已经报错的方向不盖，
                // 否则失败原因被遮罩挡住，看着像还在跑。
                const hostPick = hostJob(project, KEY_FRAMES_PICK(direction.key));
                const queued = (tasks.has(KEY_FRAMES_ALL) || jobCovers(hostExtract, direction.key) || jobCovers(hostPick, direction.key)) && node?.status !== "error";
                const nodeBusy = node?.status === "running" || tasks.has(taskKey) || tasks.has(KEY_FRAMES_PICK(direction.key)) || tasks.any(`frames:slot:${direction.key}:`) || queued;
                const overlayText = tasks.label(taskKey) ?? (queued ? batchLabel : undefined) ?? T("正在抽取序列帧…");
                return [
                    h("div", { key: direction.key, className: "SPR_node", "data-busy": nodeBusy ? "true" : undefined }, h("div", { className: "SPR_nodeTop" }, h("span", { className: "SPR_nodeTitle" }, direction.label), nodeBusy ? h(Chip, { kind: "running", text: T("抽帧中") }) : h(StatusChip, { node })), node?.strip !== undefined
                        ? h(MediaBox, { overlay: nodeBusy, text: overlayText }, h(ZoomableImage, {
                            className: "SPR_thumb",
                            src: assetUrl(project, node.strip, node.updatedAt),
                            alt: T("{n0} 序列帧", { n0: direction.label }),
                            caption: T("{n0} · {n1} 帧 · 视频 {n2} 秒（点「×」/ 背景 / Esc 关闭）", { n0: direction.label, n1: node.frames?.length ?? 0, n2: (node.duration ?? 0).toFixed(2) })
                        }))
                        : h("div", { className: "SPR_thumbEmpty" }, nodeBusy ? T("正在抽帧…") : T("尚未抽帧")), nodeBusy ? h(BusyBadge, { show: true, text: overlayText }) : null, node?.duration !== undefined
                        ? h("span", { className: "SPR_refRow" }, T("{n0} 帧 · 视频 {n1} 秒", { n0: node.frames?.length ?? 0, n1: node.duration.toFixed(2) }))
                        : null, (node?.candidates?.frames?.length ?? 0) > 0
                        ? h("span", { className: "SPR_refRow" }, T("手动选帧 · {n0} 个圆圈 / {n1} 张候选", { n0: node.candidates.picks?.length ?? 0, n1: node.candidates.frames.length }))
                        : null, node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null, h("div", { className: "SPR_btnRow" }, h(BusyBtn, {
                        primary: node?.status !== "ready",
                        busy: tasks.has(taskKey),
                        busyText: T("正在抽帧…"),
                        disabled: project.videos?.[direction.key]?.file === undefined || tasks.has(KEY_FRAMES_PICK(direction.key)) || hostPick !== undefined,
                        onClick: () => void start(() => api.runFrames({ projectId: project.id, keys: [direction.key] }), { reload: true }, {
                            key: taskKey,
                            label: T("正在抽取「{n0}」序列帧…", { n0: direction.label })
                        })
                    }, node?.status === "ready" ? T("重新抽帧") : T("抽取")), h(BusyBtn, {
                        busy: tasks.has(KEY_FRAMES_PICK(direction.key)),
                        busyText: T("正在抽候选帧…"),
                        disabled: project.videos?.[direction.key]?.file === undefined || (nodeBusy && !tasks.has(KEY_FRAMES_PICK(direction.key))),
                        onClick: () => {
                            if (pickKey === direction.key) {
                                setPickKey(null);
                                return;
                            }
                            setPickKey(direction.key);
                            setPickCount(null);
                            const ready = (project.frames?.[direction.key]?.candidates?.frames?.length ?? 0) > 0;
                            if (!ready) {
                                void start(() => api.prepareFramePick({ projectId: project.id, key: direction.key }), { reload: true }, {
                                    key: KEY_FRAMES_PICK(direction.key),
                                    label: T("正在抽取「{n0}」的候选帧…", { n0: direction.label })
                                });
                            }
                        }
                    }, pickKey === direction.key ? T("收起选帧") : (node?.candidates?.frames?.length ?? 0) > 0 ? T("调整选帧") : T("手动选帧")), h(Btn, {
                        on: node?.approved === true,
                        disabled: node?.status !== "ready",
                        onClick: () => void start(() => api.setApproved({
                            projectId: project.id,
                            stage: "frames",
                            key: direction.key,
                            approved: node?.approved !== true
                        }), { reload: true })
                    }, node?.approved === true ? T("已通过") : T("通过")))),
                    pickKey === direction.key
                        ? h(FramePickPanel, {
                            key: `${direction.key}-pick`,
                            project,
                            direction,
                            api,
                            start,
                            tasks,
                            countDraft: pickCount,
                            setCountDraft: setPickCount
                        })
                        : null
                ].filter(Boolean);
            })));
        }
        // ── 阶段 4：合成整图 ─────────────────────────────────────────────────
        const KEY_SHEET_COMPOSE = "sheet:compose";
        const KEY_SHEET_REKEY = "sheet:rekey";
        const KEY_SHEET_SAVE = "sheet:save";
        function renderSheetStage(ctx) {
            const { project, settingsDraft, setSettingsDraft, saveSettings, start, api, tasks } = ctx;
            const draft = settingsDraft ?? project.settings ?? {};
            // 用户会问「第 3 步不是已经抠过了吗」，所以这里把两处抠像的分工讲清楚：
            // 第 3 步抠的是**每个方向的预览带**（顺手把整图也合出来），第 4 步在同样的
            // 帧缓存上重抠一遍，只是为了让上面那十个参数改完立刻生效、不必重新抽帧。
            // 两处读的是同一份 raw.bin、同一套参数，所以结果永远一致。
            const rowOrder = Array.isArray(draft.rowOrder) && draft.rowOrder.length > 0 ? draft.rowOrder : DIRECTION_KEYS;
            const framesReady = DIRECTION_KEYS.filter((key) => project.frames?.[key]?.status === "ready").length;
            // 合成整图是本地 CPU 重活，宿主侧会标 running；重抠像同样走这个状态。
            const composing = project.sheet?.status === "running" || tasks.has(KEY_SHEET_COMPOSE) || tasks.has(KEY_SHEET_REKEY);
            const keyed = project.sheet?.backgroundFraction;
            const composeLabel = tasks.label(KEY_SHEET_REKEY) ?? tasks.label(KEY_SHEET_COMPOSE) ?? T("正在抠绿幕并合成整图…");
            const moveRow = (index, delta) => {
                const next = [...rowOrder];
                const target = index + delta;
                if (target < 0 || target >= next.length)
                    return;
                const tmp = next[index];
                next[index] = next[target];
                next[target] = tmp;
                setSettingsDraft({ ...draft, rowOrder: next });
                void saveSettings({ rowOrder: next });
            };
            return h(React.Fragment, null, h("p", { className: "SPR_hint" }, T("抠像在这里会**再跑一次**：第 3 步那次抠的是每个方向的预览带（顺便把整图合出来），这里重抠是为了让下面这些参数改完立刻生效——两次读的是同一份帧缓存（raw.bin）、同一套参数，所以结果一致。") +
                T("改完参数会自动重新抠像并合成整图，不需要重新抽帧。")), h("div", { className: "SPR_fields" }, h(NumField, {
                label: T("整图单格宽（px）"),
                value: draft.cellWidth ?? 256,
                min: 16,
                max: 2048,
                onChange: (value) => {
                    setSettingsDraft({ ...draft, cellWidth: value });
                    void saveSettings({ cellWidth: value });
                }
            }), h(NumField, {
                label: T("整图单格高（px）"),
                value: draft.cellHeight ?? 256,
                min: 16,
                max: 2048,
                onChange: (value) => {
                    setSettingsDraft({ ...draft, cellHeight: value });
                    void saveSettings({ cellHeight: value });
                }
            }), h(NumField, {
                label: T("像素块边长（0/1 = 关闭）"),
                value: draft.pixelSize ?? 0,
                min: 0,
                max: 32,
                onChange: (value) => setSettingsDraft({ ...draft, pixelSize: value })
            }), h(NumField, {
                label: T("背景分割容差（0 = 只认绿色）"),
                value: draft.bgTolerance ?? 90,
                min: 0,
                max: 120,
                onChange: (value) => setSettingsDraft({ ...draft, bgTolerance: value })
            }), h(NumField, {
                label: T("抠像下限（绿色优势）"),
                value: draft.keyLow ?? 14,
                min: 0,
                max: 255,
                onChange: (value) => setSettingsDraft({ ...draft, keyLow: value })
            }), h(NumField, {
                label: T("抠像上限（绿色优势）"),
                value: draft.keyHigh ?? 80,
                min: 1,
                max: 255,
                onChange: (value) => setSettingsDraft({ ...draft, keyHigh: value })
            }), h(NumField, {
                label: T("去绿溢出 0~1"),
                value: draft.despill ?? 0.65,
                min: 0,
                max: 1,
                step: 0.05,
                onChange: (value) => setSettingsDraft({ ...draft, despill: value })
            }), h(NumField, {
                label: T("边缘收缩（px）"),
                value: draft.edgeShrink ?? 0,
                min: 0,
                max: 8,
                onChange: (value) => setSettingsDraft({ ...draft, edgeShrink: value })
            }), h(NumField, {
                label: T("自动裁剪填充比例 0.5~1"),
                value: draft.fillRatio ?? 0.94,
                min: 0.5,
                max: 1,
                step: 0.02,
                onChange: (value) => setSettingsDraft({ ...draft, fillRatio: value })
            }), h(NumField, {
                label: T("底部留白（px）"),
                value: draft.bottomMargin ?? 2,
                min: 0,
                max: 64,
                onChange: (value) => setSettingsDraft({ ...draft, bottomMargin: value })
            }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("自动裁剪到角色包围盒")), h("select", {
                className: "SPR_input",
                value: draft.autoCrop === false ? "off" : "on",
                onChange: (event) => {
                    const autoCrop = event.target.value === "on";
                    setSettingsDraft({ ...draft, autoCrop });
                    void saveSettings({ autoCrop });
                }
            }, h("option", { value: "on" }, T("开启（推荐：角色填满格子，八个方向缩放一致）")), h("option", { value: "off" }, T("关闭（用整帧画面）"))))), h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                busy: tasks.has(KEY_SHEET_SAVE),
                busyText: T("正在保存并合成…"),
                disabled: framesReady === 0 || composing,
                onClick: () => void start(() => saveSettings({
                    keyLow: draft.keyLow,
                    keyHigh: draft.keyHigh,
                    despill: draft.despill,
                    bgTolerance: draft.bgTolerance,
                    edgeShrink: draft.edgeShrink,
                    pixelSize: draft.pixelSize,
                    autoCrop: draft.autoCrop !== false,
                    fillRatio: draft.fillRatio,
                    bottomMargin: draft.bottomMargin,
                    cellWidth: draft.cellWidth,
                    cellHeight: draft.cellHeight
                }), { reload: true }, { key: KEY_SHEET_SAVE, label: T("正在保存并重新合成…") })
            }, T("保存并重新合成")), h(BusyBtn, {
                busy: tasks.has(KEY_SHEET_REKEY),
                busyText: T("正在重跑抠像…"),
                disabled: framesReady === 0 || composing,
                onClick: () => void start(() => api.rekey({ projectId: project.id }), { reload: true }, {
                    key: KEY_SHEET_REKEY,
                    label: T("正在重跑抠像并重新合成…")
                })
            }, T("只重跑抠像并重新合成")), h(BusyBtn, {
                primary: true,
                busy: tasks.has(KEY_SHEET_COMPOSE),
                busyText: T("正在合成整图…"),
                disabled: framesReady === 0 || composing,
                onClick: () => void start(() => api.compose({ projectId: project.id }), { reload: true }, {
                    key: KEY_SHEET_COMPOSE,
                    label: T("正在抠绿幕并合成整图…")
                })
            }, T("合成整图（{n0}/8 组帧就绪）", { n0: framesReady })), h(BusyBadge, { show: composing, text: composeLabel }), project.sheet?.file !== undefined
                ? h("a", {
                    className: "SPR_btn",
                    href: assetUrl(project, project.sheet.file, project.sheet.generatedAt),
                    download: `${project.name}-8dir.png`,
                    style: { textDecoration: "none" },
                    "aria-disabled": composing ? "true" : undefined,
                    onClick: composing ? (event) => event.preventDefault() : undefined
                }, T("下载整图"))
                : null, h(Btn, {
                on: project.sheet?.approved === true,
                disabled: project.sheet?.status !== "ready" || composing,
                onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "sheet", approved: project.sheet?.approved !== true }), { reload: true })
            }, project.sheet?.approved === true ? T("整图已通过") : T("整图通过"))), project.sheet?.error !== undefined ? h("p", { className: "SPR_error" }, project.sheet.error) : null, h("div", { style: { display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" } }, h("div", { className: "SPR_rowOrder" }, h("span", { className: "SPR_fieldLabel" }, T("行序（第 1 行在最上方）")), rowOrder.map((key, index) => h("div", { key: `${key}-${index}`, className: "SPR_rowOrderItem" }, h("span", { className: "SPR_rowOrderIdx" }, String(index + 1)), h("span", { className: "SPR_rowOrderName" }, LABEL_OF[key] ?? key), h("button", { type: "button", className: "SPR_miniBtn", disabled: index === 0 || composing, onClick: () => moveRow(index, -1) }, "↑"), h("button", { type: "button", className: "SPR_miniBtn", disabled: index === rowOrder.length - 1 || composing, onClick: () => moveRow(index, 1) }, "↓")))), h("div", { style: { flex: 1, minWidth: 300 } }, project.sheet?.file !== undefined
                ? h(React.Fragment, null, h("p", { className: "SPR_hint" }, T("输出 {n0}×{n1} 像素 · 单格 {n2}×{n3} · 每行 {n4} 帧", { n0: project.sheet.width, n1: project.sheet.height, n2: draft.cellWidth, n3: draft.cellHeight, n4: draft.frameCount ?? 8 }) +
                    (keyed === undefined ? "" : T(" · 抠掉的背景占 {n0}%", { n0: (keyed * 100).toFixed(1) })) +
                    ((project.sheet?.borderSamplesDropped ?? 0) > 0
                        ? T(" · 边框采样排除了 {n0} 个不属于背景主色的点（角色贴边）", { n0: project.sheet.borderSamplesDropped })
                        : "")), h("div", { className: "SPR_sheetWrap", style: { position: "relative" } }, h(ZoomableImage, {
                    className: "SPR_sheet",
                    src: assetUrl(project, project.sheet.file, project.sheet.generatedAt),
                    alt: T("整图"),
                    style: { visibility: composing ? "hidden" : undefined },
                    caption: T("整图 {n0}×{n1} · 单格 {n2}×{n3}（点「×」/ 背景 / Esc 关闭）", { n0: project.sheet.width, n1: project.sheet.height, n2: draft.cellWidth, n3: draft.cellHeight })
                }), h(LoadingOverlay, { show: composing, text: composeLabel, sub: T("本地抠像 + 合成，不上传") })))
                : h("div", { style: { position: "relative", minHeight: 160 } }, h("p", { className: "SPR_empty" }, composing ? T("正在生成第一张整图…") : framesReady === 0 ? T("请先完成第 3 步的抽帧") : T("还没有合成整图")), h(LoadingOverlay, { show: composing, text: composeLabel })))));
        }
        // ── ⑤ 行走预览：WASD / 方向键操控角色在白色区域里走 ────────────────────
        const STAGE_W = 960;
        const STAGE_H = 520;
        /**
         * 把整图当精灵表用 canvas 现场播放。
         *
         * 位置、按键、帧计数这些每帧都在变的东西放在 ref 里（不进 React state），
         * 只有 HUD 文案限流回写 state——否则 60fps 的重渲染会把界面拖垮。
         */
        function WalkPreview(props) {
            const project = props.project;
            const tasks = props.tasks;
            const canvasRef = React.useRef(null);
            const boxRef = React.useRef(null);
            const imgRef = React.useRef(null);
            const rafRef = React.useRef(0);
            const keysRef = React.useRef({ up: false, down: false, left: false, right: false });
            const posRef = React.useRef({ x: STAGE_W / 2, y: STAGE_H - 8, dirKey: "front", frame: 0, acc: 0 });
            const liveRef = React.useRef({ scale: 1.6, speed: 170, grid: true });
            const hudAtRef = React.useRef(0);
            const [scale, setScale] = React.useState(1.6);
            const [speed, setSpeed] = React.useState(170);
            const [animSpeed, setAnimSpeed] = React.useState(1);
            const [grid, setGrid] = React.useState(true);
            const [focused, setFocused] = React.useState(false);
            const [hud, setHud] = React.useState({ compass: "S", moving: false });
            const settings = project?.settings ?? {};
            const sheet = project?.sheet;
            const ready = sheet?.status === "ready" && typeof sheet.file === "string";
            /**
             * 切图必须按**整图自己记录的**行序与格子参数，不能按当前 settings。
             *
             * 用户改了行序（或格子尺寸）而整图还没重新合成时，两者会不一致；
             * 那时按 settings 去查行号就会切到错误的方向——表现出来正是
             * 「向北走却画了正面的图」。宿主现在会在设置变更后自动重新合成，
             * 但预览仍以整图记录为准，这样即使中途也能切对。
             */
            const sheetOrder = Array.isArray(sheet?.rowOrder) && sheet.rowOrder.length > 0 ? sheet.rowOrder.map(String) : null;
            const settingsOrder = Array.isArray(settings.rowOrder) && settings.rowOrder.length > 0 ? settings.rowOrder : DIRECTION_KEYS;
            const rowOrder = sheetOrder ?? settingsOrder;
            const cellWidth = Number.isFinite(sheet?.cellWidth) ? sheet.cellWidth : settings.cellWidth ?? 256;
            const cellHeight = Number.isFinite(sheet?.cellHeight) ? sheet.cellHeight : settings.cellHeight ?? 256;
            const frameCount = Math.max(1, Number.isFinite(sheet?.frameCount) ? sheet.frameCount : settings.frameCount ?? 8);
            const sheetUrl = ready ? `${project.assetBase}${sheet.file}?v=${sheet.generatedAt ?? 0}` : null;
            const rowKey = rowOrder.join(",");
            // 整图的行序和当前设置对不上 → 说明刚改过、正在重新合成
            const orderStale = sheetOrder !== null && sheetOrder.join(",") !== settingsOrder.join(",");
            // 整图正在重新合成 / 正在换新图：预览上的画面已经不是当前设置的了。
            const rebuilding = sheet?.status === "running" ||
                tasks?.has(KEY_SHEET_COMPOSE) === true ||
                tasks?.has(KEY_SHEET_REKEY) === true ||
                tasks?.has(KEY_SHEET_SAVE) === true;
            const rebuildingText = tasks?.label(KEY_SHEET_REKEY) ?? tasks?.label(KEY_SHEET_COMPOSE) ?? T("正在重新合成整图…");
            const [sheetLoaded, setSheetLoaded] = React.useState(false);
            liveRef.current.scale = scale;
            liveRef.current.speed = speed;
            liveRef.current.animSpeed = animSpeed;
            liveRef.current.grid = grid;
            // 整图加载（带版本号，重新合成后自动换新图）
            React.useEffect(() => {
                setSheetLoaded(false);
                if (sheetUrl === null) {
                    imgRef.current = null;
                    return undefined;
                }
                let cancelled = false;
                const image = new Image();
                image.onload = () => {
                    if (cancelled)
                        return;
                    imgRef.current = image;
                    setSheetLoaded(true);
                };
                image.src = sheetUrl;
                return () => {
                    cancelled = true;
                    imgRef.current = null;
                };
            }, [sheetUrl]);
            // 主循环
            React.useEffect(() => {
                const canvas = canvasRef.current;
                if (canvas === null)
                    return undefined;
                const g = canvas.getContext("2d");
                let last = performance.now();
                const tick = (now) => {
                    rafRef.current = requestAnimationFrame(tick);
                    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
                    last = now;
                    const live = liveRef.current;
                    const keys = keysRef.current;
                    const pos = posRef.current;
                    const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
                    const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
                    const moving = dx !== 0 || dy !== 0;
                    const spriteW = Math.max(16, cellWidth * live.scale);
                    const spriteH = Math.max(16, cellHeight * live.scale);
                    if (moving) {
                        const next = directionKeyFor(dx, dy);
                        if (next !== null)
                            pos.dirKey = next;
                        const length = Math.hypot(dx, dy);
                        const distance = live.speed * dt;
                        pos.x += (dx / length) * distance;
                        pos.y += (dy / length) * distance;
                        // 帧推进按**走过的距离**而不是时间，步频才和移动速度对得上。
                        // 「播放速度」只缩放这个阈值——值越大，同样距离里翻过的帧越多，
                        // 也就是步子迈得更快，但角色本身的移动速度完全不受影响。
                        pos.acc += distance;
                        const perFrame = Math.max(2, (cellWidth * 0.16) / Math.max(0.1, live.animSpeed));
                        while (pos.acc >= perFrame) {
                            pos.acc -= perFrame;
                            pos.frame = (pos.frame + 1) % frameCount;
                        }
                    }
                    else {
                        pos.frame = 0;
                        pos.acc = 0;
                    }
                    // 以「脚底中心」为锚点，限制在白色区域里
                    pos.x = Math.min(STAGE_W - spriteW / 2, Math.max(spriteW / 2, pos.x));
                    pos.y = Math.min(STAGE_H - 4, Math.max(spriteH, pos.y));
                    g.fillStyle = "#ffffff";
                    g.fillRect(0, 0, STAGE_W, STAGE_H);
                    if (live.grid) {
                        g.strokeStyle = "rgba(0,0,0,0.06)";
                        g.lineWidth = 1;
                        g.beginPath();
                        for (let x = 0; x <= STAGE_W; x += 40) {
                            g.moveTo(x + 0.5, 0);
                            g.lineTo(x + 0.5, STAGE_H);
                        }
                        for (let y = 0; y <= STAGE_H; y += 40) {
                            g.moveTo(0, y + 0.5);
                            g.lineTo(STAGE_W, y + 0.5);
                        }
                        g.stroke();
                    }
                    const image = imgRef.current;
                    const row = rowOrder.indexOf(pos.dirKey);
                    if (image !== null && row >= 0) {
                        g.imageSmoothingEnabled = false;
                        g.drawImage(image, pos.frame * cellWidth, row * cellHeight, cellWidth, cellHeight, Math.round(pos.x - spriteW / 2), Math.round(pos.y - spriteH), spriteW, spriteH);
                    }
                    if (now - hudAtRef.current > 150) {
                        hudAtRef.current = now;
                        setHud({ compass: COMPASS_OF[pos.dirKey] ?? pos.dirKey, moving });
                    }
                };
                rafRef.current = requestAnimationFrame(tick);
                return () => cancelAnimationFrame(rafRef.current);
            }, [sheetUrl, rowKey, cellWidth, cellHeight, frameCount]);
            const handleKey = (down) => (event) => {
                const axis = KEY_AXIS[event.key.toLowerCase()];
                if (axis === undefined)
                    return;
                event.preventDefault();
                keysRef.current[axis] = down;
            };
            const reset = () => {
                posRef.current = { x: STAGE_W / 2, y: STAGE_H - 8, dirKey: "front", frame: 0, acc: 0 };
                keysRef.current = { up: false, down: false, left: false, right: false };
            };
            if (!ready) {
                return h("p", { className: "SPR_empty" }, T("还没有可播放的整图。先完成第 ④ 步合成，再回到这里用 WASD 走一走。"));
            }
            return h(React.Fragment, null, h("div", { className: "SPR_fields" }, h(NumField, {
                label: T("角色缩放倍率"),
                value: scale,
                min: 0.3,
                max: 4,
                step: 0.1,
                onChange: setScale
            }), h(NumField, {
                label: T("移动速度（像素/秒）"),
                value: speed,
                min: 40,
                max: 600,
                step: 10,
                onChange: setSpeed
            }), h(NumField, {
                label: T("播放速度（倍，只影响步频）"),
                value: animSpeed,
                min: 0.25,
                max: 4,
                step: 0.25,
                onChange: setAnimSpeed
            }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("背景参考网格")), h("select", { className: "SPR_input", value: grid ? "on" : "off", onChange: (event) => setGrid(event.target.value === "on") }, h("option", { value: "on" }, T("显示（更容易看出在移动）")), h("option", { value: "off" }, T("关闭（纯白）"))))), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: reset }, T("回到中间")), h("span", { className: "SPR_refRow" }, T("当前朝向：{n0}（{n1}） · {n2}", { n0: hud.compass, n1: LABEL_OF[posRef.current.dirKey] ?? "", n2: hud.moving ? T("行走中") : T("站立") })), orderStale
                ? h("span", { className: "SPR_refRow" }, T("· 整图是按旧行序生成的，正在重新合成…"))
                : null, h("span", { className: "SPR_spacer" }), h("span", { className: "SPR_refRow" }, focused ? T("已获得键盘焦点") : T("点击画面后即可操控"))), h("div", {
                ref: boxRef,
                className: "SPR_stage",
                "data-focused": focused ? "true" : "false",
                tabIndex: 0,
                onClick: () => {
                    if (boxRef.current !== null)
                        boxRef.current.focus();
                },
                onFocus: () => setFocused(true),
                onBlur: () => {
                    setFocused(false);
                    keysRef.current = { up: false, down: false, left: false, right: false };
                },
                onKeyDown: handleKey(true),
                onKeyUp: handleKey(false)
            }, h("canvas", { ref: canvasRef, className: "SPR_canvas", width: STAGE_W, height: STAGE_H }), focused ? null : h("div", { className: "SPR_stageHint" }, T("点击这里，然后用 WASD 或 ↑↓←→ 操控角色")), h(LoadingOverlay, {
                show: rebuilding || (ready && !sheetLoaded),
                text: rebuilding ? rebuildingText : T("正在载入整图…")
            }), h("div", { className: "SPR_hud" }, h("span", { className: "SPR_hudDir" }, hud.compass), h("span", null, hud.moving ? T("行走") : T("站立")))), h("p", { className: "SPR_hint" }, T("方向按屏幕方位映射：按 ↑ 向北走（背对镜头）、↓ 向南走（正对镜头）、← 向西、→ 向东；斜向同时按两个键。"), h("br"), T("「播放速度」只改步频快慢，不影响角色移动速度；「移动速度」只改走得多快，不影响动画帧率。切图用的是整图自己记录的行序，所以改完行序即使还没重新合成，预览也不会取错方向。")));
        }
        // ── 公共小工具 ──────────────────────────────────────────────────────
        /** 把 File 读成不带 data: 前缀的 base64。 */
        function readFileBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const text = String(reader.result ?? "");
                    resolve(text.slice(text.indexOf(",") + 1));
                };
                reader.onerror = () => reject(new Error(T("读取文件失败")));
                reader.readAsDataURL(file);
            });
        }
        /** 一个「拖进来或点按钮选文件」的上传区。 */
        function UploadBox({ label, accept, multiple, onFiles, busy }) {
            const [over, setOver] = React.useState(false);
            const inputRef = React.useRef(null);
            const handle = (files) => {
                const list = Array.from(files ?? []);
                if (list.length > 0)
                    void onFiles(list);
            };
            return h(React.Fragment, null, h("div", {
                className: "SPR_drop",
                "data-over": over ? "true" : "false",
                "data-busy": busy === true ? "true" : undefined,
                onDragOver: (event) => {
                    event.preventDefault();
                    setOver(true);
                },
                onDragLeave: () => setOver(false),
                onDrop: (event) => {
                    event.preventDefault();
                    setOver(false);
                    handle(event.dataTransfer?.files);
                }
            }, busy === true
                ? h("span", { style: { display: "inline-flex", alignItems: "center", gap: 7, justifyContent: "center" } }, h("span", { className: "SPR_spinSm" }), T("正在上传…"))
                : label), h("div", { className: "SPR_toolbar" }, h(BusyBtn, { onClick: () => inputRef.current?.click(), busy: busy === true, busyText: T("正在上传…") }, T("选择文件")), h("input", {
                ref: inputRef,
                type: "file",
                accept,
                multiple: multiple === true,
                style: { display: "none" },
                onChange: (event) => {
                    handle(event.target.files);
                    event.target.value = "";
                }
            })));
        }
        /** 抠像参数表单（三个模块共用同一套字段）。 */
        function KeyingFields({ draft, onChange }) {
            return h("div", { className: "SPR_fields" }, h(NumField, { label: T("抠像下限（绿色优势）"), value: draft.keyLow ?? 14, min: 0, max: 255, onChange: (v) => onChange({ keyLow: v }) }), h(NumField, { label: T("抠像上限（绿色优势）"), value: draft.keyHigh ?? 80, min: 1, max: 255, onChange: (v) => onChange({ keyHigh: v }) }), h(NumField, { label: T("去绿溢出 0~1"), value: draft.despill ?? 0.65, min: 0, max: 1, step: 0.05, onChange: (v) => onChange({ despill: v }) }), h(NumField, { label: T("背景分割容差（0 = 只认绿色）"), value: draft.bgTolerance ?? 90, min: 0, max: 160, onChange: (v) => onChange({ bgTolerance: v }) }), h(NumField, { label: T("边缘收缩（px）"), value: draft.edgeShrink ?? 0, min: 0, max: 8, onChange: (v) => onChange({ edgeShrink: v }) }));
        }
        /** 一份任务/项目列表（左侧栏）。 */
        function JobSidebar({ title, items, activeId, onSelect, onCreate, renderMeta }) {
            return h("div", { className: "SPR_side" }, h("div", { className: "SPR_sideTitle" }, T("{n0}（{n1}）", { n0: title, n1: items.length })), items.length === 0 ? h("p", { className: "SPR_hint" }, T("还没有内容，点右上角新建一个。")) : null, items.map((item) => h("button", {
                key: item.id,
                type: "button",
                className: "SPR_projItem",
                "data-active": item.id === activeId ? "true" : "false",
                onClick: () => onSelect(item.id)
            }, h("span", { className: "SPR_projName" }, item.name), h("span", { className: "SPR_projMeta" }, renderMeta(item)))), items.length === 0 ? h(Btn, { onClick: onCreate, primary: true }, T("新建")) : null);
        }
        // ── 模块六 · 地图编辑器（导入 tileset）────────────────────────────────
        //
        // 与模块五的根本区别：**宿主是唯一渲染器**。
        // 界面拿到的不是坐标公式，而是一份绘制计划（每项 = 用哪块图、画在哪个像素），
        // canvas 只负责把计划执行出来；导出 PNG 执行的是同一份计划。于是
        // 「预览 = 导出」是构造出来的，而不是靠调试去对齐两套坐标口径。
        //
        // 界面里**唯一**复刻的宿主逻辑是命中测试（`MAP_pointToCell` 等三个函数），
        // 那是鼠标点击必需的；宿主真实现见 `src/mapgeom.ts`，
        // `scripts/verify-map-client.mjs` 拿它做黄金对照逐点比对。
        //
        // ⚠️ 变体挑选 / 自动过渡 / 层高换算 / 裁剪偏移**都不在这里**：那些全在宿主。
        // 一旦在界面里再写一遍，就回到了旧模块那条「预览与出图两套口径」的老路。
        /** chunk 边长（对齐宿主 `mapgeom.MAP_CHUNK_SIZE`）。 */
        const MAP_CHUNK = 32;
        /** 像素 → 格子。**与宿主 `mapgeom.pointToCell` 同构**。 */
        function MAP_pointToCell(layout, x, y) {
            if (layout.grid.kind === "square") {
                const c = Math.floor(x / layout.grid.tileWidth);
                const r = Math.floor(y / layout.grid.tileHeight);
                return { r, c, inMap: r >= 0 && c >= 0 && r < layout.rows && c < layout.cols };
            }
            const u = (x - layout.centerX) / layout.stepX;
            const v = (y - layout.centerY) / layout.stepY;
            const c = Math.round((v + u) / 2);
            const r = Math.round((v - u) / 2);
            return { r, c, inMap: r >= 0 && c >= 0 && r < layout.rows && c < layout.cols };
        }
        /** 格子锚点（贴图锚点落地的点）。**与宿主 `mapgeom.cellAnchor` 同构**。 */
        function MAP_cellAnchor(layout, r, c) {
            if (layout.grid.kind === "square") {
                return { x: c * layout.grid.tileWidth + layout.grid.tileWidth / 2, y: (r + 1) * layout.grid.tileHeight };
            }
            return {
                x: layout.centerX + (c - r) * layout.stepX,
                y: layout.centerY + (c + r) * layout.stepY + layout.grid.tileHeight / 2
            };
        }
        function MAP_cellTopLeft(layout, r, c, width, height, anchorX = 0.5, anchorY = 1) {
            const anchor = MAP_cellAnchor(layout, r, c);
            return { x: anchor.x - width * anchorX, y: anchor.y - height * anchorY };
        }
        /**
         * 两格之间的直线（拖动补间不能漏格）。
         * **与宿主 `mapdoc.lineCells` 同构**，黄金对照同样覆盖它。
         */
        function MAP_lineCells(r0, c0, r1, c1) {
            const out = [];
            let r = Math.round(r0);
            let c = Math.round(c0);
            const rEnd = Math.round(r1);
            const cEnd = Math.round(c1);
            const dr = Math.abs(rEnd - r);
            const dc = Math.abs(cEnd - c);
            const sr = r < rEnd ? 1 : -1;
            const sc = c < cEnd ? 1 : -1;
            let err = dr - dc;
            for (;;) {
                out.push({ r, c });
                if (r === rEnd && c === cEnd)
                    break;
                const e2 = 2 * err;
                if (e2 > -dc) {
                    err -= dc;
                    r += sr;
                }
                if (e2 < dr) {
                    err += dr;
                    c += sc;
                }
                if (out.length > 20000)
                    break;
            }
            return out;
        }
        function MAP_chunkOf(r, c) {
            return { cx: Math.floor(c / MAP_CHUNK), cy: Math.floor(r / MAP_CHUNK) };
        }
        function MAP_chunkKey(chunk) {
            return `${chunk.cx},${chunk.cy}`;
        }
        /** 视口（地图像素坐标）覆盖到哪些 chunk。 */
        function MAP_visibleChunks(layout, view) {
            const corners = [
                [view.x, view.y],
                [view.x + view.w, view.y],
                [view.x, view.y + view.h],
                [view.x + view.w, view.y + view.h]
            ].map(([x, y]) => MAP_pointToCell(layout, x, y));
            const rMin = Math.max(0, Math.min.apply(null, corners.map((hit) => hit.r)) - MAP_CHUNK);
            const rMax = Math.min(layout.rows - 1, Math.max.apply(null, corners.map((hit) => hit.r)) + MAP_CHUNK);
            const cMin = Math.max(0, Math.min.apply(null, corners.map((hit) => hit.c)) - MAP_CHUNK);
            const cMax = Math.min(layout.cols - 1, Math.max.apply(null, corners.map((hit) => hit.c)) + MAP_CHUNK);
            const keys = [];
            for (let cy = Math.floor(rMin / MAP_CHUNK); cy <= Math.floor(rMax / MAP_CHUNK); cy++) {
                for (let cx = Math.floor(cMin / MAP_CHUNK); cx <= Math.floor(cMax / MAP_CHUNK); cx++)
                    keys.push(`${cx},${cy}`);
            }
            return keys;
        }
        /** 图块序号 → { 图集, 源矩形 }（宿主给的 legend）。 */
        function MAP_legendMap(view) {
            const map = new Map();
            for (const entry of view.legend || [])
                map.set(entry.index, entry);
            return map;
        }
        /** 把宿主回传的 chunk 补丁写进缓存。 */
        function MAP_mergePatches(chunks, patches) {
            const next = new Map(chunks);
            for (const patch of patches || [])
                next.set(patch.key, patch.ops || []);
            return next;
        }
        function MapModule(props) {
            useLocaleTick();
            const api = props.api;
            const [projects, setProjects] = React.useState([]);
            const [projectId, setProjectId] = React.useState(null);
            const [view, setView] = React.useState(null);
            const [stage, setStage] = React.useState("assets");
            const [notice, setNotice] = React.useState(null);
            const [busy, setBusy] = React.useState(false);
            const [activeLayerId, setActiveLayerId] = React.useState(null);
            const [brush, setBrush] = React.useState(null);
            const [tool, setTool] = React.useState("paint");
            const [zoom, setZoom] = React.useState(1);
            const [pan, setPan] = React.useState({ x: 0, y: 0 });
            const [zoomMode, setZoomMode] = React.useState("fit");
            const [chunks, setChunks] = React.useState(new Map());
            const [selectedTilesetId, setSelectedTilesetId] = React.useState(null);
            const [selectedTileIds, setSelectedTileIds] = React.useState([]);
            /** 图集切分草稿（每张图集一份）。 */
            const [sliceDraft, setSliceDraft] = React.useState({});
            /** 族草稿（整份）。 */
            const [familyDraft, setFamilyDraft] = React.useState(null);
            /** 导出选项。 */
            const [exportScale, setExportScale] = React.useState(1);
            const [exportFormats, setExportFormats] = React.useState({ pngMerged: true, pngLayers: true, json: true, tiled: true });
            const [newMapName, setNewMapName] = React.useState("");
            const imageRefs = React.useRef({});
            const canvasRef = React.useRef(null);
            const wrapRef = React.useRef(null);
            const strokeRef = React.useRef(null);
            const flushTimer = React.useRef(null);
            const pendingOps = React.useRef([]);
            /**
             * 当前这一笔的 id（一次按下 → 抬起算一笔）。
             *
             * 拖动时 op 每 ~60ms 提交一次，带上同一个 id 宿主才会把它并成**一条**历史 ——
             * 否则一次拖拽要按好几次撤销才回得去。
             */
            const strokeId = React.useRef(0);
            const [viewport, setViewport] = React.useState({ w: 640, h: 420 });
            const [ghost, setGhost] = React.useState(null);
            /**
             * 「矩形填充」开关。
             *
             * ⚠️ 必须自己一个 state，**不能挂在 `ghost` 上**：ghost 是跟着指针走的瞬时
             * 状态（指针移出画布就 null），挂在它上面的勾选框会变成「点不动」——
             * 真机实测：勾选框看着能点，点完状态不变（onChange 里被 `prev === null` 吞掉）。
             */
            const [rectFilled, setRectFilled] = React.useState(false);
            const [imagesReady, setImagesReady] = React.useState(0);
            const [planWarnings, setPlanWarnings] = React.useState([]);
            const intent = useStudioIntent();
            /**
             * 实验性进入提示。
             *
             * ⚠️ Hook 必须在**任何提前 return 之前**（下面 `project === null` 那条早返回
             * 会绕过它）—— 顺序一变就是 React error #310，整块白屏。
             */
            const [gateOpen, setGateOpen] = React.useState(experimentalGateMuted.map !== true);
            const closeGate = React.useCallback(() => setGateOpen(false), []);
            const project = React.useMemo(() => (view === null ? null : view), [view]);
            const doc = project === null ? null : project.doc;
            const layout = doc === null || doc === undefined ? null : doc.layout;
            const layerOf = (id) => (doc === null ? undefined : (doc.layers || []).find((layer) => layer.id === id));
            const activeLayer = activeLayerId !== null && layerOf(activeLayerId) !== undefined ? layerOf(activeLayerId) : doc === null ? undefined : (doc.layers || [])[0];
            const legend = React.useMemo(() => (project === null ? new Map() : MAP_legendMap(project)), [project]);
            const assetBase = project === null ? "" : project.assetBase;
            const withApi = React.useCallback(async (fn, options) => {
                if (api === undefined) {
                    setNotice({ kind: "error", text: T("远程服务尚未挂载完成，请稍候再试") });
                    return undefined;
                }
                try {
                    const value = await fn();
                    if (options !== undefined && options.notice !== undefined)
                        setNotice({ kind: "info", text: options.notice });
                    return value;
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                    return undefined;
                }
            }, [api]);
            const loadProject = React.useCallback(async (id, mapId) => {
                if (api === undefined || id === null)
                    return;
                try {
                    const next = await api.getMapProject(mapId === undefined ? { projectId: id } : { projectId: id, mapId });
                    setView(next);
                    setChunks(new Map());
                    setProjectId(next.id);
                    const layers = (next.doc && next.doc.layers) || [];
                    setActiveLayerId(layers.length > 0 ? layers[0].id : null);
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api]);
            const loadList = React.useCallback(async () => {
                if (api === undefined)
                    return;
                try {
                    const result = await api.listMapProjects();
                    setProjects(result.projects || []);
                    if (projectId === null && result.projects && result.projects.length > 0)
                        await loadProject(result.projects[0].id);
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api, projectId, loadProject]);
            React.useEffect(() => {
                void loadList();
            }, [loadList]);
            // 深链接：`?dsh-gmm=1&module=map&job=<项目 id>&stage=paint`
            // （项目 id 走 jobId 字段，与 tile 同一套约定，见宿主 links.ts 的 OpenIntent）
            React.useEffect(() => {
                if (intent === null || intent.module !== "map")
                    return;
                if (typeof intent.stage === "string" && MAP_STAGES.some((entry) => entry.key === intent.stage))
                    setStage(intent.stage);
                if (typeof intent.jobId === "string" && intent.jobId !== "")
                    void loadProject(intent.jobId);
            }, [intent, loadProject]);
            const mapId = doc === null || doc === undefined ? null : doc.id;
            /**
             * 作业进行中就轮询。
             *
             * 验收预览 / 导出是宿主上的异步作业（`runMapPreview` / `runMapExport` 只回
             * `started`），提交完那次重读拿到的还是「进行中」，此后**再没有人刷新**：
             * 表现是顶部「任务进行中…」一直挂着、导出文件列表永远是空的。
             * 真机实测：文件其实早就写到磁盘了，点一下「刷新状态」才全部出现。
             * 模块⑤与②③④都有这个轮询，这里补上（`busy` 转 false 时 effect 自己收尾）。
             */
            const projectBusy = view !== null && view.busy === true;
            React.useEffect(() => {
                if (projectBusy !== true || projectId === null)
                    return;
                const timer = setInterval(() => {
                    void loadProject(projectId, mapId);
                }, 1500);
                return () => clearInterval(timer);
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [projectBusy, projectId, mapId, loadProject]);
            // ── 计划 chunk 的按需拉取 ────────────────────────────────────────────
            const requestChunks = React.useCallback(async (keys) => {
                if (api === undefined || projectId === null || mapId === null)
                    return;
                const missing = keys.filter((key) => !chunks.has(key));
                if (missing.length === 0)
                    return;
                try {
                    const plan = await api.mapPlan({ projectId, mapId, chunks: missing });
                    setChunks((prev) => {
                        const next = new Map(prev);
                        for (const chunk of plan.chunks || [])
                            next.set(chunk.key, chunk.ops || []);
                        for (const key of missing)
                            if (!next.has(key))
                                next.set(key, []);
                        return next;
                    });
                    setPlanWarnings(plan.warnings || []);
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api, projectId, mapId, chunks]);
            /**
             * 自动选中第一张图集。
             *
             * `selectedTilesetId` 默认是 `null`，而「③ 地图」的调色板与图集卡片上的
             * 「给『族』按顺序分配掩码」都依赖它 —— 不自动选，用户点分配掩码会**静默没反应**
             * （真机实测：上传图集 → 加族 → 点分配掩码，覆盖率一直是 0/47，界面连报错都没有）。
             * 依赖写成 id 串：只在图集增删时重挑，用户手动把调色板选回「选择图集…」不会被反复覆盖。
             */
            const tilesetIds = (view === null ? [] : view.tilesets).map((entry) => entry.id).join(",");
            React.useEffect(() => {
                const list = view === null ? [] : view.tilesets;
                setSelectedTilesetId((prev) => (prev !== null && list.some((entry) => entry.id === prev) ? prev : list.length > 0 ? list[0].id : null));
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [tilesetIds]);
            // ── 画布：视口渲染（大地图也不卡）─────────────────────────────────────
            const draw = React.useCallback(() => {
                const canvas = canvasRef.current;
                if (canvas === null || canvas === undefined || layout === null || doc === null || doc === undefined)
                    return;
                const ctx = canvas.getContext("2d");
                if (ctx === null || ctx === undefined)
                    return;
                const width = Math.max(1, Math.round(viewport.w));
                const height = Math.max(1, Math.round(viewport.h));
                /**
                 * 按 devicePixelRatio 放大 backing store。
                 *
                 * 不放大时在 Retina 上每个地图像素只占 1 个物理像素 → 整张图发糊
                 * （像素画尤其明显）。坐标仍然按 CSS 像素记，倍率进 transform，
                 * 所以计划里的目标坐标**一个都不用改**（drawImage 的入参保持原样）。
                 */
                const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
                const backingWidth = Math.round(width * dpr);
                const backingHeight = Math.round(height * dpr);
                if (canvas.width !== backingWidth)
                    canvas.width = backingWidth;
                if (canvas.height !== backingHeight)
                    canvas.height = backingHeight;
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, backingWidth, backingHeight);
                ctx.imageSmoothingEnabled = false;
                const scale = zoom * dpr;
                ctx.setTransform(scale, 0, 0, scale, -pan.x * scale, -pan.y * scale);
                const rectOf = (index) => legend.get(index);
                /**
                 * 帧统计。
                 *
                 * `window.__mapDebug = true` 时把「这一帧为什么画/没画出东西」记在
                 * `window.__mapDrawStats` 上 —— 自检与真机验收都靠它定位
                 * 「画布是空的」这类问题（是没拉到计划、还是缺图源、还是坐标算飞了）。
                 * 默认关掉，正常使用不产生任何额外开销。
                 */
                const debug = window.__mapDebug === true;
                const stats = debug ? { keys: [], cached: 0, drawn: 0, noLegend: 0, noImage: 0, first: null } : null;
                for (const key of MAP_visibleChunks(layout, { x: pan.x, y: pan.y, w: width / zoom, h: height / zoom })) {
                    if (stats !== null)
                        stats.keys.push(key);
                    const ops = chunks.get(key);
                    if (ops === undefined)
                        continue;
                    if (stats !== null)
                        stats.cached += ops.length;
                    for (const op of ops) {
                        const entry = rectOf(op.t);
                        if (entry === undefined) {
                            if (stats !== null)
                                stats.noLegend++;
                            continue;
                        }
                        const image = imageRefs.current[entry.tilesetId];
                        if (image === undefined || image === null) {
                            if (stats !== null)
                                stats.noImage++;
                            continue;
                        }
                        if (stats !== null) {
                            stats.drawn++;
                            if (stats.first === null)
                                stats.first = { t: op.t, x: op.x, y: op.y, ts: entry.tilesetId };
                        }
                        ctx.globalAlpha = op.a === undefined ? 1 : op.a;
                        ctx.drawImage(image, entry.rect.x, entry.rect.y, entry.rect.width, entry.rect.height, op.x, op.y, entry.rect.width, entry.rect.height);
                    }
                }
                if (stats !== null) {
                    window.__mapDrawStats = stats;
                }
                ctx.globalAlpha = 1;
                if (ghost !== null && ghost.length > 0) {
                    ctx.fillStyle = ghost.ok === false ? "rgba(240,80,80,0.35)" : "rgba(80,220,120,0.32)";
                    for (const cell of ghost.cells) {
                        if (layout.grid.kind === "square") {
                            const topLeft = MAP_cellTopLeft(layout, cell.r, cell.c, layout.grid.tileWidth, layout.grid.tileHeight);
                            ctx.fillRect(topLeft.x, topLeft.y, layout.grid.tileWidth, layout.grid.tileHeight);
                            continue;
                        }
                        const center = MAP_cellAnchor(layout, cell.r, cell.c);
                        const halfW = layout.grid.tileWidth / 2;
                        const halfH = layout.grid.tileHeight / 2;
                        ctx.beginPath();
                        ctx.moveTo(center.x, center.y - layout.grid.tileHeight);
                        ctx.lineTo(center.x + halfW, center.y - halfH);
                        ctx.lineTo(center.x, center.y);
                        ctx.lineTo(center.x - halfW, center.y - halfH);
                        ctx.closePath();
                        ctx.fill();
                    }
                }
            }, [layout, doc, viewport, zoom, pan, chunks, legend, ghost]);
            React.useEffect(() => {
                draw();
            }, [draw, imagesReady]);
            // 视口变化 / 平移缩放后按需补齐 chunk
            React.useEffect(() => {
                if (layout === null)
                    return;
                const keys = MAP_visibleChunks(layout, { x: pan.x, y: pan.y, w: viewport.w / zoom, h: viewport.h / zoom });
                void requestChunks(keys);
            }, [layout, pan, viewport, zoom, requestChunks]);
            // 容器尺寸变化 → 视口跟着变（否则右下角永远画不到）
            React.useEffect(() => {
                const element = wrapRef.current;
                if (element === null || element === undefined)
                    return;
                const measure = () => {
                    const rect = element.getBoundingClientRect();
                    setViewport({ w: Math.max(160, Math.round(rect.width)), h: 420 });
                };
                measure();
                if (typeof ResizeObserver !== "function")
                    return;
                const observer = new ResizeObserver(measure);
                observer.observe(element);
                return () => observer.disconnect();
            }, [projectId, stage]);
            // 「适应窗口」缩放：整张地图塞进画布
            React.useEffect(() => {
                if (zoomMode !== "fit" || doc === null || doc === undefined)
                    return;
                const bounds = doc.bounds;
                if (bounds === undefined || bounds.width <= 0)
                    return;
                const scale = Math.min(1, Math.min(viewport.w / bounds.width, viewport.h / bounds.height));
                setZoom(scale > 0 ? scale : 1);
                setPan({ x: bounds.originX, y: bounds.originY });
            }, [zoomMode, doc, viewport]);
            // ── 编辑：op 批量提交 ────────────────────────────────────────────────
            const flushOps = React.useCallback(async () => {
                if (flushTimer.current !== null) {
                    clearTimeout(flushTimer.current);
                    flushTimer.current = null;
                }
                const ops = pendingOps.current;
                if (ops.length === 0 || api === undefined || projectId === null || mapId === null)
                    return;
                pendingOps.current = [];
                // 调试钩子：`window.__mapDebug = true` 时记下每次提交的笔画 id 与条数
                // （「一次拖拽被拆成好几步撤销」就是靠它定位的）
                if (window.__mapDebug === true) {
                    const log = (window.__mapOpsLog = window.__mapOpsLog ?? []);
                    log.push({ stroke: ops[0]?.stroke ?? null, count: ops.length });
                    if (log.length > 200)
                        log.shift();
                }
                try {
                    const result = await api.applyMapOps({ projectId, mapId, ops, stroke: ops[0]?.stroke });
                    setChunks((prev) => MAP_mergePatches(prev, result.patches));
                    setView((prev) => (prev === null ? prev : { ...prev, doc: { ...prev.doc, canUndo: result.canUndo, canRedo: result.canRedo } }));
                    if (result.skipped !== undefined && result.skipped.length > 0) {
                        setNotice({ kind: "error", text: result.skipped.slice(0, 2).join("；") });
                    }
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api, projectId, mapId]);
            const queueOps = React.useCallback((ops, immediate) => {
                const stroke = `s${++strokeId.current}`;
                const stamped = ops.map((op) => ({ ...op, stroke }));
                // ⚠️ 同一笔的多次 flush 必须共用同一个 id：拖动时的中间批次要沿用
                // 当前笔画的 id，只有新按下时才换新的。
                const key = immediate === true ? stroke : (currentStroke.current ?? stroke);
                currentStroke.current = immediate === true ? null : key;
                pendingOps.current = pendingOps.current.concat(stamped.map((op) => ({ ...op, stroke: key })));
                if (immediate === true) {
                    void flushOps();
                    return;
                }
                if (flushTimer.current !== null)
                    return;
                flushTimer.current = setTimeout(() => {
                    flushTimer.current = null;
                    void flushOps();
                }, 60);
            }, [flushOps]);
            const cellFromEvent = React.useCallback((event) => {
                const canvas = canvasRef.current;
                if (canvas === null || layout === null)
                    return null;
                const rect = canvas.getBoundingClientRect();
                const x = (event.clientX - rect.left) / zoom + pan.x;
                const y = (event.clientY - rect.top) / zoom + pan.y;
                const hit = MAP_pointToCell(layout, x, y);
                return hit.inMap ? hit : null;
            }, [layout, zoom, pan]);
            /** 当前拖拽笔画的 id（null = 没有正在进行的笔画）。 */
            const currentStroke = React.useRef(null);
            /**
             * 某个工具要不要先选笔刷。
             *
             * ⚠️ **橡皮不需要笔刷**（它就是把格子清空）。以前这条判断是
             * `activeLayer === undefined || brush === null`，于是刚进面板、还没点过调色板时
             * 拿橡皮在画布上拖，**一点反应都没有也不报错**（真机实测）。
             */
            const needsBrush = (name) => name === "paint" || name === "fill" || name === "rect";
            const warnNoBrush = () => {
                if (brush === null) {
                    setNotice({ kind: "error", text: T("先选一块图当笔刷：点调色板里的图块，或点上面的族胶囊。") });
                    return true;
                }
                return false;
            };
            const strokePaint = (from, to) => {
                if (activeLayer === undefined)
                    return;
                if (needsBrush(tool) && warnNoBrush())
                    return;
                const cells = from === null ? [to] : MAP_lineCells(from.r, from.c, to.r, to.c);
                const tile = tool === "erase" ? 0 : (brush === null ? 0 : brush.tile);
                queueOps([
                    { kind: "paint", layerId: activeLayer.id, cells: cells.map((cell) => ({ r: cell.r, c: cell.c, tile })) }
                ]);
            };
            const onPointerDown = (event) => {
                if (layout === null || doc === null || doc === undefined)
                    return;
                const hit = cellFromEvent(event);
                if (hit === null)
                    return;
                if (event.button === 1 || event.shiftKey === true) {
                    strokeRef.current = { mode: "pan", clientX: event.clientX, clientY: event.clientY, pan: { ...pan } };
                    return;
                }
                if (tool === "fill") {
                    if (activeLayer === undefined)
                        return;
                    if (warnNoBrush())
                        return;
                    queueOps([{ kind: "fill", layerId: activeLayer.id, r: hit.r, c: hit.c, tile: brush.tile }], true);
                    return;
                }
                if (tool === "rect") {
                    if (warnNoBrush())
                        return;
                    strokeRef.current = { mode: "rect", from: hit };
                    setGhost({ cells: [hit], ok: true });
                    return;
                }
                if (tool === "pick") {
                    const chunk = MAP_chunkOf(hit.r, hit.c);
                    const ops = chunks.get(MAP_chunkKey(chunk)) || [];
                    const found = ops.find((op) => op.r === hit.r && op.c === hit.c);
                    if (found !== undefined)
                        setBrush({ tile: found.t });
                    return;
                }
                currentStroke.current = null;
                strokeRef.current = { mode: "paint", from: hit };
                strokePaint(null, hit);
                setGhost({ cells: [hit], ok: true });
            };
            const onPointerMove = (event) => {
                if (layout === null)
                    return;
                const hit = cellFromEvent(event);
                const stroke = strokeRef.current;
                if (stroke !== null && stroke !== undefined && stroke.mode === "pan") {
                    setPan({ x: stroke.pan.x - (event.clientX - stroke.clientX) / zoom, y: stroke.pan.y - (event.clientY - stroke.clientY) / zoom });
                    return;
                }
                if (stroke !== null && stroke !== undefined && stroke.mode === "rect" && hit !== null) {
                    const r0 = Math.min(stroke.from.r, hit.r);
                    const r1 = Math.max(stroke.from.r, hit.r);
                    const c0 = Math.min(stroke.from.c, hit.c);
                    const c1 = Math.max(stroke.from.c, hit.c);
                    const cells = [];
                    for (let r = r0; r <= r1; r++) {
                        for (let c = c0; c <= c1; c++) {
                            // 描边模式只高亮边框，所见即所得（否则预览比实际涂的多一圈）
                            if (rectFilled !== true && r !== r0 && r !== r1 && c !== c0 && c !== c1)
                                continue;
                            cells.push({ r, c });
                        }
                    }
                    setGhost({ cells, ok: true });
                    return;
                }
                if (hit === null) {
                    setGhost(null);
                    return;
                }
                if (stroke !== null && stroke !== undefined && stroke.mode === "paint") {
                    strokePaint(stroke.from, hit);
                    stroke.from = hit;
                }
                setGhost({ cells: [hit], ok: true });
            };
            const onPointerUp = () => {
                const stroke = strokeRef.current;
                strokeRef.current = null;
                currentStroke.current = null;
                if (stroke !== null && stroke !== undefined && stroke.mode === "rect" && ghost !== null && activeLayer !== undefined) {
                    const cells = ghost.cells;
                    if (cells.length > 0) {
                        const r0 = Math.min.apply(null, cells.map((cell) => cell.r));
                        const r1 = Math.max.apply(null, cells.map((cell) => cell.r));
                        const c0 = Math.min.apply(null, cells.map((cell) => cell.c));
                        const c1 = Math.max.apply(null, cells.map((cell) => cell.c));
                        if (warnNoBrush())
                            return;
                        const tile = brush.tile;
                        queueOps([{ kind: "rect", layerId: activeLayer.id, r0, c0, r1, c1, tile, filled: rectFilled }], true);
                    }
                }
                void flushOps();
            };
            const onWheel = (event) => {
                if (event.ctrlKey !== true && event.metaKey !== true && event.altKey !== true)
                    return;
                event.preventDefault();
                const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
                const next = Math.min(8, Math.max(0.12, zoom * factor));
                const canvas = canvasRef.current;
                if (canvas !== null) {
                    const rect = canvas.getBoundingClientRect();
                    const mapX = (event.clientX - rect.left) / zoom + pan.x;
                    const mapY = (event.clientY - rect.top) / zoom + pan.y;
                    setPan({ x: mapX - (event.clientX - rect.left) / next, y: mapY - (event.clientY - rect.top) / next });
                }
                setZoom(next);
                setZoomMode("free");
            };
            // 键盘：撤销 / 重做 / 工具切换（挂在 window 上，切走模块时解绑）
            React.useEffect(() => {
                const onKey = (event) => {
                    if (event.target !== null && event.target !== undefined && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName || ""))
                        return;
                    const meta = event.metaKey === true || event.ctrlKey === true;
                    if (meta && (event.key === "z" || event.key === "Z")) {
                        event.preventDefault();
                        void (event.shiftKey === true ? doRedo() : doUndo());
                        return;
                    }
                    if (meta && (event.key === "y" || event.key === "Y")) {
                        event.preventDefault();
                        void doRedo();
                        return;
                    }
                    if (meta)
                        return;
                    if (event.key === "b")
                        setTool("paint");
                    else if (event.key === "e")
                        setTool("erase");
                    else if (event.key === "g")
                        setTool("fill");
                    else if (event.key === "r")
                        setTool("rect");
                    else if (event.key === "i")
                        setTool("pick");
                };
                window.addEventListener("keydown", onKey);
                return () => window.removeEventListener("keydown", onKey);
            });
            const doUndo = async () => {
                if (api === undefined || projectId === null || mapId === null)
                    return;
                const result = await withApi(() => api.mapUndo({ projectId, mapId }));
                if (result === undefined)
                    return;
                setChunks((prev) => MAP_mergePatches(prev, result.patches));
                setView((prev) => (prev === null ? prev : { ...prev, doc: { ...prev.doc, canUndo: result.canUndo, canRedo: result.canRedo } }));
            };
            const doRedo = async () => {
                if (api === undefined || projectId === null || mapId === null)
                    return;
                const result = await withApi(() => api.mapRedo({ projectId, mapId }));
                if (result === undefined)
                    return;
                setChunks((prev) => MAP_mergePatches(prev, result.patches));
                setView((prev) => (prev === null ? prev : { ...prev, doc: { ...prev.doc, canUndo: result.canUndo, canRedo: result.canRedo } }));
            };
            const createProject = async () => {
                const name = askNewName(T("新地图项目的名字"), T("我的地图"));
                if (name === null)
                    return;
                await withApi(async () => {
                    const created = await api.createMapProject({ name, grid: { kind: "square", tileWidth: 32, tileHeight: 32, heightStep: 16 } });
                    setProjects((prev) => [{ id: created.id, name: created.name, updatedAt: created.updatedAt }, ...prev]);
                    await loadProject(created.id);
                    setStage("assets");
                });
            };
            const renameProject = async () => {
                if (project === null)
                    return;
                // eslint-disable-next-line no-alert
                const next = typeof window === "undefined" ? null : window.prompt(T("新的项目名"), project.name);
                if (next === null || next.trim() === "")
                    return;
                const result = await withApi(() => api.saveMapProject({ projectId: project.id, name: next.trim() }), { notice: T("已重命名") });
                if (result === undefined)
                    return;
                await loadList();
                await loadProject(project.id);
            };
            const importFiles = async (files) => {
                if (files === undefined || files.length === 0 || projectId === null)
                    return;
                setBusy(true);
                try {
                    for (const file of files) {
                        const base64 = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
                            reader.onerror = () => reject(new Error(T("读文件失败")));
                            reader.readAsDataURL(file);
                        });
                        await withApi(() => api.importMapTileset({ projectId, name: file.name, data: base64 }), {
                            notice: T("已导入 {n0}", { n0: file.name })
                        });
                    }
                    await loadProject(projectId, mapId);
                }
                finally {
                    setBusy(false);
                }
            };
            const saveSlice = async (tilesetId) => {
                const draft = sliceDraft[tilesetId];
                if (draft === undefined)
                    return;
                const result = await withApi(() => api.saveMapTileset({
                    projectId,
                    tilesetId,
                    slice: {
                        mode: draft.mode,
                        tileWidth: draft.tileWidth,
                        tileHeight: draft.tileHeight,
                        offsetX: draft.offsetX,
                        offsetY: draft.offsetY,
                        spacingX: draft.spacingX,
                        spacingY: draft.spacingY
                    }
                }));
                if (result !== undefined) {
                    if (result.warnings !== undefined && result.warnings.length > 0)
                        setNotice({ kind: "error", text: result.warnings.join("；") });
                    await loadProject(projectId, mapId);
                }
            };
            const patchTiles = async (tilesetId, patches) => {
                const result = await withApi(() => api.saveMapTileset({ projectId, tilesetId, tiles: patches }));
                if (result !== undefined)
                    await loadProject(projectId, mapId);
            };
            const assignMasksInOrder = async (familyId, scheme) => {
                if (selectedTilesetId === null)
                    return;
                const tileset = project.tilesets.find((entry) => entry.id === selectedTilesetId);
                if (tileset === undefined)
                    return;
                const masks = (project.autotileMasks && project.autotileMasks[scheme]) || [0];
                const patches = tileset.preview.tiles.slice(0, masks.length).map((tile, index) => ({ id: tile.id, familyId, mask: masks[index], weight: 1 }));
                await patchTiles(selectedTilesetId, patches);
                setNotice({ kind: "info", text: T("已按顺序给前 {n0} 块分配掩码", { n0: String(patches.length) }) });
            };
            const saveFamilies = async () => {
                if (familyDraft === null)
                    return;
                const result = await withApi(() => api.saveMapFamilies({ projectId, families: familyDraft }));
                if (result !== undefined) {
                    if (result.warnings !== undefined && result.warnings.length > 0)
                        setNotice({ kind: "error", text: result.warnings.join("；") });
                    await loadProject(projectId, mapId);
                }
            };
            const saveDocStructure = async (patch) => {
                const result = await withApi(() => api.saveMapDoc({ projectId, mapId, ...patch }));
                if (result !== undefined) {
                    if (result.warnings !== undefined && result.warnings.length > 0)
                        setNotice({ kind: "info", text: result.warnings.join("；") });
                    await loadProject(projectId, mapId);
                }
            };
            const switchMap = async (nextMapId) => {
                await loadProject(projectId, nextMapId);
            };
            const runPreview = async () => {
                const started = await withApi(() => api.runMapPreview({ projectId, mapId }));
                if (started !== undefined && started.started === true)
                    await loadProject(projectId, mapId);
            };
            const runExport = async () => {
                const started = await withApi(() => api.runMapExport({ projectId, mapId, scale: exportScale, formats: exportFormats }));
                if (started !== undefined && started.started === true)
                    await loadProject(projectId, mapId);
            };
            // ⚠️ 所有 Hook 必须在上面；下面才开始早退（React #310，整个面板白屏）
            if (project === null) {
                return h("div", { className: "SPR_moduleBody" }, gateOpen ? h(MapExperimentalDialog, { onClose: closeGate }) : null, h("div", { className: "SPR_empty" }, T("还没有地图项目。")), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: createProject, primary: true }, T("新建地图项目")), projects.length > 0
                    ? h("select", {
                        className: "SPR_select",
                        value: "",
                        onChange: (event) => {
                            if (event.target.value !== "")
                                void loadProject(event.target.value);
                        }
                    }, h("option", { value: "" }, T("选择已有项目…")), projects.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name)))
                    : null), notice === null ? null : h("div", { className: `SPR_notice SPR_notice-${notice.kind}` }, notice.text));
            }
            /**
             * 阶段条。
             *
             * ⚠️ 用**模块五同款**的 `.SPR_steps` / `.SPR_step` / `.SPR_stepMark`
             * （见 `SPR_step` 的 CSS 定义），别自造类名：
             *  · 自造 `SPR_stages` / `SPR_stageTab` 的话一个 CSS 规则都没有，阶段条会塌成
             *    几个 58px 宽的小按钮，文字全叠在一起；
             *  · 更坑的是 `SPR_stageHint` —— 那个类**已经存在**，是「绝对定位铺满容器」的
             *    蒙层样式（给八方向图的 WASD 预览用的）。复用它会把所有阶段说明**叠在面板
             *    正中间**，整个面板看着就是坏的（真机实测：整屏只剩中间一行叠字）。
             * 阶段说明改放 `title`（悬停）+ 内容区顶部一行 `.SPR_hint`。
             */
            const stageTabs = h("div", { className: "SPR_steps" }, MAP_STAGES.map((entry) => {
                const state = (project.stages ?? {})[entry.key] ?? { status: "idle" };
                return h("button", {
                    key: entry.key,
                    type: "button",
                    className: `SPR_step${stage === entry.key ? " SPR_step-active" : ""} SPR_step-${state.status}`,
                    title: entry.hint,
                    "data-stage": entry.key,
                    onClick: () => setStage(entry.key)
                }, entry.title, state.status === "done" ? h("span", { className: "SPR_stepMark" }, "✓") : null, state.status === "error" ? h("span", { className: "SPR_stepMark" }, "!") : null);
            }));
            const stageHintLine = h("p", { className: "SPR_hint" }, (MAP_STAGES.find((entry) => entry.key === stage) ?? MAP_STAGES[0]).hint);
            const tilesets = project.tilesets || [];
            const families = project.families || [];
            const maps = project.maps || [];
            const coverage = project.coverage || [];
            const palette = (() => {
                if (selectedTilesetId === null)
                    return null;
                const tileset = tilesets.find((entry) => entry.id === selectedTilesetId);
                if (tileset === undefined)
                    return null;
                return h("div", { className: "SPR_mePaletteWrap" }, h("div", { className: "SPR_mePalette", style: mapPaletteBox(tileset.imageWidth, tileset.imageHeight) }, h("img", { className: "SPR_mePaletteImg", src: `${assetBase}${tileset.file}`, alt: tileset.name }), tileset.preview.tiles.map((tile) => h("button", {
                    key: tile.id,
                    type: "button",
                    className: "SPR_mePaletteCell",
                    style: {
                        left: mapPct(tile.rect.x, tileset.imageWidth),
                        top: mapPct(tile.rect.y, tileset.imageHeight),
                        width: mapPct(tile.rect.width, tileset.imageWidth),
                        height: mapPct(tile.rect.height, tileset.imageHeight),
                        background: tile.familyId === undefined ? "transparent" : "rgba(120,200,255,0.16)"
                    },
                    title: `${tile.name} · ${tile.familyId === undefined ? T("未分组") : tile.familyId}${tile.mask === undefined ? "" : ` · mask ${tile.mask}`}`,
                    onClick: () => {
                        setBrush({ tile: tile.index });
                        setSelectedTileIds([tile.id]);
                    }
                }))), h("p", { className: "SPR_meHint" }, T("点一块图作为笔刷（序号 {n0}）。带底色的是已归族的块。", { n0: brush === null ? "-" : String(brush.tile) })));
            })();
            const familyRow = h("div", { className: "SPR_meFamilyRow" }, families.map((family) => {
                const first = tilesets
                    .flatMap((tileset) => tileset.preview.tiles)
                    .find((tile) => tile.familyId === family.id);
                const row = coverage.find((entry) => entry.familyId === family.id);
                return h("button", {
                    key: family.id,
                    type: "button",
                    className: "SPR_meFamilyChip",
                    "data-ok": row !== undefined && row.missing.length === 0 ? "true" : undefined,
                    title: row === undefined ? "" : T("{n0} / {n1} 个掩码已配", { n0: String(row.assigned), n1: String(row.expected) }),
                    onClick: () => {
                        if (first !== undefined)
                            setBrush({ tile: first.index });
                        if (first !== undefined)
                            setSelectedTilesetId(tilesetOfTile(first.index));
                    }
                }, h("span", { className: "SPR_meFamilyDot", style: { background: family.color || "#888" } }), family.name, row === undefined || row.autotile === "single"
                    ? null
                    : h("span", { className: "SPR_meFamilyCount" }, `${row.assigned}/${row.expected}`));
            }));
            function tilesetOfTile(index) {
                for (const tileset of tilesets) {
                    const start = tileset.preview.tiles.length > 0 ? tileset.preview.tiles[0].index : 0;
                    if (index >= start && index < start + tileset.preview.tiles.length)
                        return tileset.id;
                }
                return null;
            }
            const editor = h("div", { className: "SPR_meEditorWrap", ref: wrapRef }, h("div", { className: "SPR_meToolbar" }, h("span", { className: "SPR_meToolLabel" }, T("工具")), ["paint", "erase", "fill", "rect", "pick"].map((key) => h(Btn, { key, on: tool === key, onClick: () => setTool(key), title: MAP_TOOL_HINTS[key] }, MAP_TOOL_LABELS[key])), h("span", { className: "SPR_meToolLabel" }, T("撤销/重做")), h(Btn, { onClick: () => void doUndo(), disabled: doc.canUndo !== true }, T("撤销")), h(Btn, { onClick: () => void doRedo(), disabled: doc.canRedo !== true }, T("重做")), h("span", { className: "SPR_meToolLabel" }, T("缩放")), h(Btn, { onClick: () => { setZoomMode("fit"); }, on: zoomMode === "fit" }, T("适应窗口")), h(Btn, { onClick: () => { setZoomMode("free"); setZoom(1); } }, "100%"), h("span", { className: "SPR_meZoom" }, `${Math.round(zoom * 100)}%`)), activeLayer === undefined
                ? null
                : h("div", { className: "SPR_meToolbar" }, h("span", { className: "SPR_meToolLabel" }, T("当前图层")), h("span", { className: "SPR_meLayerName" }, activeLayer.name), h("label", { className: "SPR_meCheck" }, h("input", {
                    type: "checkbox",
                    checked: rectFilled,
                    "data-testid": "map-rect-filled",
                    onChange: (event) => setRectFilled(event.target.checked)
                }), T("矩形填充"))), h("canvas", {
                ref: canvasRef,
                className: "SPR_meCanvas",
                "data-testid": "map-canvas",
                onPointerDown,
                onPointerMove,
                onPointerUp,
                onPointerLeave: () => { setGhost(null); onPointerUp(); },
                onWheel,
                onContextMenu: (event) => event.preventDefault()
            }), planWarnings.length === 0 ? null : h("p", { className: "SPR_meWarn" }, planWarnings.join("；")));
            const layerList = h("div", { className: "SPR_meLayerList" }, (doc.layers || []).map((layer, index) => h("div", {
                key: layer.id,
                className: "SPR_meLayerRow",
                "data-active": activeLayer !== undefined && activeLayer.id === layer.id ? "true" : undefined
            }, h("button", { type: "button", className: "SPR_meLayerPick", onClick: () => setActiveLayerId(layer.id) }, layer.name), h("label", { className: "SPR_meCheck" }, h("input", {
                type: "checkbox",
                checked: layer.visible,
                onChange: (event) => void saveDocStructure({ layers: [{ id: layer.id, visible: event.target.checked }] })
            }), T("显示")), h("label", { className: "SPR_meCheck" }, h("input", {
                type: "checkbox",
                checked: layer.locked,
                onChange: (event) => void saveDocStructure({ layers: [{ id: layer.id, locked: event.target.checked }] })
            }), T("锁定")), h(NumField, {
                label: T("高度"),
                value: layer.heightOffset,
                step: 0.5,
                onChange: (value) => void saveDocStructure({ layers: [{ id: layer.id, heightOffset: value }] })
            }), h(NumField, {
                label: T("不透明度%"),
                value: Math.round(layer.opacity * 100),
                min: 0,
                max: 100,
                onChange: (value) => void saveDocStructure({ layers: [{ id: layer.id, opacity: value / 100 }] })
            }), h(Btn, { onClick: () => void saveDocStructure({ moveLayer: { id: layer.id, toIndex: index - 1 } }), disabled: index === 0, title: T("上移") }, "↑"), h(Btn, { onClick: () => void saveDocStructure({ moveLayer: { id: layer.id, toIndex: index + 1 } }), disabled: index === doc.layers.length - 1, title: T("下移") }, "↓"), h(Btn, { danger: true, onClick: () => void saveDocStructure({ removeLayerId: layer.id }) }, T("删除")))), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => void saveDocStructure({ addLayer: { kind: "decor", name: T("装饰") } }) }, T("加装饰层")), h(Btn, { onClick: () => void saveDocStructure({ addLayer: { kind: "object", name: T("建筑") } }) }, T("加建筑层")), h(Btn, { onClick: () => void saveDocStructure({ addLayer: { kind: "overlay", name: T("覆盖") } }) }, T("加覆盖层"))));
            const mapList = h("div", { className: "SPR_meMapList" }, maps.map((entry) => h("button", {
                key: entry.id,
                type: "button",
                className: "SPR_meMapChip",
                "data-active": mapId === entry.id ? "true" : undefined,
                onClick: () => void switchMap(entry.id)
            }, `${entry.name} · ${entry.cols}×${entry.rows}`)), h("input", {
                className: "SPR_input",
                placeholder: T("新地图名字"),
                value: newMapName,
                onChange: (event) => setNewMapName(event.target.value)
            }), h(Btn, {
                onClick: () => void withApi(async () => {
                    const created = await api.createMapDoc({ projectId, name: newMapName === "" ? T("新地图") : newMapName, cols: 32, rows: 32 });
                    setNewMapName("");
                    await loadProject(projectId, created.doc.id);
                })
            }, T("新建地图")), h(Btn, { onClick: () => void withApi(() => api.duplicateMapDoc({ projectId, mapId })) }, T("复制当前地图")), h(Btn, { danger: true, onClick: () => void withApi(() => api.deleteMapDoc({ projectId, mapId })) }, T("删除当前地图")));
            const stageAssets = h("div", { className: "SPR_meStage" }, h("div", { className: "SPR_meCard" }, h("h4", null, T("导入图集")), h("p", { className: "SPR_meHint" }, T("导入你自己的 tileset 图（PNG / JPEG / WebP）。原图会原样保存，切分参数随便改都能重切。")), h("input", {
                type: "file",
                accept: "image/*",
                multiple: true,
                "data-testid": "map-tileset-input",
                disabled: busy,
                onChange: (event) => {
                    const files = event.target.files;
                    void importFiles(files === null ? [] : Array.from(files));
                    event.target.value = "";
                }
            }), busy ? h("p", { className: "SPR_meHint" }, T("正在导入…")) : null), tilesets.map((tileset) => {
                const draft = sliceDraft[tileset.id] || {
                    mode: tileset.slice.mode,
                    tileWidth: tileset.slice.tileWidth,
                    tileHeight: tileset.slice.tileHeight,
                    offsetX: tileset.slice.offsetX,
                    offsetY: tileset.slice.offsetY,
                    spacingX: tileset.slice.spacingX,
                    spacingY: tileset.slice.spacingY
                };
                const setDraft = (patch) => setSliceDraft((prev) => ({ ...prev, [tileset.id]: { ...draft, ...patch } }));
                return h("div", { key: tileset.id, className: "SPR_meCard", "data-tileset": tileset.id }, h("div", { className: "SPR_meCardHead" }, h("h4", null, `${tileset.name} · ${tileset.imageWidth}×${tileset.imageHeight} · ${tileset.tileCount} ${T("块")}`), h(Btn, { on: selectedTilesetId === tileset.id, onClick: () => setSelectedTilesetId(tileset.id) }, T("选为调色板")), h(Btn, { danger: true, onClick: () => void withApi(() => api.removeMapTileset({ projectId, tilesetId: tileset.id })) }, T("移除图集"))), h("div", { className: "SPR_meSliceRow" }, h(NumField, { label: T("格宽"), value: draft.tileWidth, min: 1, max: 1024, onChange: (value) => setDraft({ tileWidth: value }) }), h(NumField, { label: T("格高"), value: draft.tileHeight, min: 1, max: 1024, onChange: (value) => setDraft({ tileHeight: value }) }), h(NumField, { label: T("左边距"), value: draft.offsetX, min: 0, max: 512, onChange: (value) => setDraft({ offsetX: value }) }), h(NumField, { label: T("上边距"), value: draft.offsetY, min: 0, max: 512, onChange: (value) => setDraft({ offsetY: value }) }), h(NumField, { label: T("横向间距"), value: draft.spacingX, min: 0, max: 64, onChange: (value) => setDraft({ spacingX: value }) }), h(NumField, { label: T("纵向间距"), value: draft.spacingY, min: 0, max: 64, onChange: (value) => setDraft({ spacingY: value }) }), h(Btn, { primary: true, onClick: () => void saveSlice(tileset.id) }, T("应用切分"))), h("p", { className: "SPR_meHint" }, T("切分建议：{n0}", {
                    n0: (tileset.suggestions || []).slice(0, 4).map((item) => item.label).join("；") || T("没有能整除的常见尺寸，请手动填")
                })), h("div", { className: "SPR_mePalette", style: mapPaletteBox(tileset.imageWidth, tileset.imageHeight) }, h("img", { className: "SPR_mePaletteImg", src: `${assetBase}${tileset.file}`, alt: tileset.name }), tileset.preview.gridLinesX.map((x, index) => h("div", { key: `x${index}`, className: "SPR_meGridV", style: { left: mapPct(x, tileset.imageWidth) } })), tileset.preview.gridLinesY.map((y, index) => h("div", { key: `y${index}`, className: "SPR_meGridH", style: { top: mapPct(y, tileset.imageHeight) } })), tileset.preview.tiles.map((tile) => h("button", {
                    key: tile.id,
                    type: "button",
                    className: "SPR_mePaletteCell",
                    "data-selected": selectedTileIds.includes(tile.id) ? "true" : undefined,
                    style: {
                        left: mapPct(tile.rect.x, tileset.imageWidth),
                        top: mapPct(tile.rect.y, tileset.imageHeight),
                        width: mapPct(tile.rect.width, tileset.imageWidth),
                        height: mapPct(tile.rect.height, tileset.imageHeight)
                    },
                    title: `${tile.name}${tile.familyId === undefined ? "" : ` · ${tile.familyId}`}${tile.mask === undefined ? "" : ` · mask ${tile.mask}`}`,
                    onClick: () => setSelectedTileIds((prev) => (prev.includes(tile.id) ? prev.filter((id) => id !== tile.id) : prev.concat(tile.id)))
                }))), tileset.preview.warnings.length === 0 ? null : h("p", { className: "SPR_meWarn" }, tileset.preview.warnings.join("；")), h("div", { className: "SPR_toolbar" }, h("span", { className: "SPR_meHint" }, T("选中 {n0} 块", { n0: String(selectedTileIds.length) })), families.length === 0
                    ? null
                    : families.map((family) => h(Btn, {
                        key: family.id,
                        onClick: () => void patchTiles(tileset.id, selectedTileIds.map((id) => ({ id, familyId: family.id }))),
                        disabled: selectedTileIds.length === 0
                    }, T("归入「{n0}」", { n0: family.name }))), h(Btn, { onClick: () => void patchTiles(tileset.id, selectedTileIds.map((id) => ({ id, familyId: undefined, mask: undefined }))), disabled: selectedTileIds.length === 0 }, T("清空分组"))), families.length === 0
                    ? null
                    : h("div", { className: "SPR_toolbar" }, families.map((family) => h(Btn, {
                        key: family.id,
                        onClick: () => void assignMasksInOrder(family.id, family.autotile)
                    }, T("给「{n0}」按顺序分配掩码", { n0: family.name })))));
            }));
            const stageRules = h("div", { className: "SPR_meStage" }, h("div", { className: "SPR_meCard" }, h("h4", null, T("地形族与自动过渡")), h("p", { className: "SPR_meHint" }, T("优先级大的族会朝优先级小的邻居长过渡块（草地 < 土路 < 水）。缺掩码的地方会回退成最近的一块，并在下面标出来。")), h("div", { className: "SPR_meFamilyEdit" }, (familyDraft === null ? families : familyDraft).map((family, index) => h("div", { key: family.id || `f${index}`, className: "SPR_meFamilyEditRow" }, h("input", {
                className: "SPR_input SPR_meName",
                value: family.name,
                onChange: (event) => {
                    const next = (familyDraft === null ? families : familyDraft).slice();
                    next[index] = { ...next[index], name: event.target.value };
                    setFamilyDraft(next);
                }
            }), h("select", {
                className: "SPR_select",
                value: family.autotile,
                onChange: (event) => {
                    const next = (familyDraft === null ? families : familyDraft).slice();
                    next[index] = { ...next[index], autotile: event.target.value };
                    setFamilyDraft(next);
                }
            }, MAP_AUTOTILE_SCHEMES.map((scheme) => h("option", { key: scheme.key, value: scheme.key }, scheme.title))), h(NumField, {
                label: T("优先级"),
                value: family.priority,
                onChange: (value) => {
                    const next = (familyDraft === null ? families : familyDraft).slice();
                    next[index] = { ...next[index], priority: value };
                    setFamilyDraft(next);
                }
            }), h(Btn, {
                danger: true,
                onClick: () => {
                    const next = (familyDraft === null ? families : familyDraft).filter((entry) => entry.id !== family.id);
                    setFamilyDraft(next);
                }
            }, T("移除"))))), h("div", { className: "SPR_toolbar" }, h(Btn, {
                onClick: () => {
                    const next = (familyDraft === null ? families : familyDraft).slice();
                    next.push({ id: `f${Date.now().toString(36)}`, name: T("新族"), autotile: "blob47", priority: next.length, color: "#3f9b2f" });
                    setFamilyDraft(next);
                }
            }, T("加一个族")), h(Btn, { primary: true, onClick: () => void saveFamilies(), disabled: familyDraft === null }, T("保存族")))), h("div", { className: "SPR_meCard" }, h("h4", null, T("掩码覆盖率")), coverage.length === 0
                ? h("p", { className: "SPR_meHint" }, T("还没有族。先加一个族，再把图块归进去。"))
                : h("div", { className: "SPR_meCoverage" }, coverage.map((row) => h("div", { key: row.familyId, className: "SPR_meCoverageRow", "data-ok": row.missing.length === 0 ? "true" : undefined }, h("span", { className: "SPR_meName" }, row.name), h("span", null, `${row.assigned}/${row.expected}`), row.missing.length === 0 ? h("span", { className: "SPR_meOk" }, T("完整")) : h("span", { className: "SPR_meBad" }, T("缺 {n0} 块", { n0: String(row.missing.length) }))))), project.previews.length === 0
                ? null
                : h("div", { className: "SPR_meShots" }, project.previews.map((relative) => h("a", { key: relative, href: `${assetBase}${relative}`, target: "_blank", rel: "noreferrer" }, h("img", { className: "SPR_meShot", src: `${assetBase}${relative}`, alt: relative })))), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => void runPreview(), busy: project.busy === true }, T("生成验收预览图")), h(Btn, { onClick: () => void withApi(() => api.revealMapProject({ projectId })) }, T("在访达中打开项目目录")))));
            const stagePaint = h("div", { className: "SPR_meStage" }, h("div", { className: "SPR_meCard" }, h("h4", null, T("地图")), mapList, layerList), h("div", { className: "SPR_meCard" }, h("h4", null, T("调色板")), h("select", {
                className: "SPR_select",
                value: selectedTilesetId === null ? "" : selectedTilesetId,
                onChange: (event) => setSelectedTilesetId(event.target.value === "" ? null : event.target.value)
            }, h("option", { value: "" }, T("选择图集…")), tilesets.map((tileset) => h("option", { key: tileset.id, value: tileset.id }, tileset.name))), familyRow, palette), 
            // 隐藏的图源：canvas 用它们当 drawImage 的源（避免 new Image 与克隆两份缓存）
            h("div", { style: { display: "none" } }, tilesets.map((tileset) => h("img", {
                key: tileset.id,
                // `data-tileset` 是画布归因用的：canvas 那边只拿到图源对象，
                // 自检要靠这个属性把「这次 drawImage 用的是哪张图集」对上 host 的 legend
                "data-tileset": tileset.id,
                ref: (node) => {
                    imageRefs.current[tileset.id] = node;
                },
                src: `${assetBase}${tileset.file}`,
                alt: "",
                onLoad: () => setImagesReady((value) => value + 1)
            }))), editor);
            const stageExport = h("div", { className: "SPR_meStage" }, h("div", { className: "SPR_meCard" }, h("h4", null, T("导出")), h("p", { className: "SPR_meHint" }, T("全部本地计算，不花钱。导出目录是自包含的：图集 PNG 会一起复制过去，Tiled 直接能打开。")), h("div", { className: "SPR_meToolbar" }, [["pngMerged", T("合并 PNG（map.png）")], ["pngLayers", T("分层 PNG")], ["json", T("自有 JSON")], ["tiled", T("Tiled .tmj/.tsj")]].map(([key, label]) => h("label", { key, className: "SPR_meCheck" }, h("input", {
                type: "checkbox",
                checked: exportFormats[key] === true,
                onChange: (event) => setExportFormats((prev) => ({ ...prev, [key]: event.target.checked }))
            }), label)), h("select", { className: "SPR_select", value: String(exportScale), onChange: (event) => setExportScale(Number(event.target.value)) }, [1, 2, 3, 4].map((value) => h("option", { key: value, value: String(value) }, `${value}×`))), h(Btn, { primary: true, onClick: () => void runExport(), busy: project.busy === true }, T("导出")), h(Btn, { onClick: () => void withApi(() => api.revealMapProject({ projectId })) }, T("在访达中打开"))), project.exportFiles.length === 0
                ? h("p", { className: "SPR_meHint" }, T("还没有导出过。"))
                : h("ul", { className: "SPR_meFileList" }, project.exportFiles.map((file) => h("li", { key: file }, h("a", { href: `${assetBase}${project.exportBase}${file}`, target: "_blank", rel: "noreferrer" }, file))))));
            return h("div", { className: "SPR_moduleBody", "data-module": "map" }, gateOpen ? h(MapExperimentalDialog, { onClose: closeGate }) : null, h("div", { className: "SPR_toolbar" }, h("strong", null, project.name), h("select", {
                className: "SPR_select",
                value: projectId,
                onChange: (event) => void loadProject(event.target.value)
            }, projects.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name))), h(Btn, { onClick: createProject }, T("新建")), h(Btn, { onClick: () => void renameProject() }, T("重命名")), h(Btn, { onClick: () => void loadProject(projectId, mapId) }, T("刷新状态")), project.busy === true ? h("span", { className: "SPR_meBusy" }, T("任务进行中…")) : null), stageTabs, stageHintLine, notice === null ? null : h("div", { className: `SPR_notice SPR_notice-${notice.kind}` }, notice.text), project.warnings.length === 0
                ? null
                : h("ul", { className: "SPR_meWarnings" }, project.warnings.map((text, index) => h("li", { key: index }, text))), stage === "assets" ? stageAssets : stage === "rules" ? stageRules : stage === "paint" ? stagePaint : stageExport);
        }
        // ── 模块②：图片生成 ─────────────────────────────────────────────────
        /** 模块②的 pending key：整批生成、单张重生成、抠像、上传、新建任务。 */
        const K_IMG_JOB = "img:job";
        const K_IMG_ITEM = (index) => `img:item:${index}`;
        const K_IMG_KEY = "img:key";
        const K_IMG_UPLOAD = "img:upload";
        const K_IMG_CREATE = "img:create";
        /**
         * 模块五 · 地图地块生成。
         *
         * 与其它模块最大的不同：**几何由本地代码保证**。
         * 菱形模板是本地渲染的（严格 2:1 等距），AI 只负责把菱形内部填成指定地貌；
         * 生成完之后再本地量一次、仿射对齐到标准菱形。所以每一步都要把
         * 「几何报告」摆出来给用户看 —— 那是判断这批地块能不能拼起来的第一依据。
         */
        function TileModule(props) {
            useLocaleTick();
            const api = props.api;
            const [projects, setProjects] = React.useState([]);
            const [projectId, setProjectId] = React.useState(null);
            const [project, setProject] = React.useState(null);
            const [notice, setNotice] = React.useState(null);
            const [stage, setStage] = React.useState("generate");
            const [styleDraft, setStyleDraft] = React.useState("");
            const [nameDraft, setNameDraft] = React.useState("");
            const [mapRows, setMapRows] = React.useState(14);
            const [mapCols, setMapCols] = React.useState(14);
            const [mapSeed, setMapSeed] = React.useState(20261004);
            const [decorDensity, setDecorDensity] = React.useState(0.08);
            const [creating, setCreating] = React.useState(false);
            /**
             * 实验性进入提示：TileModule 就是「进入了模块⑤」，页签切换与深链接都会
             * 重新挂载它，所以放在这里等于「每次进入都弹」；勾过「本次会话不再提示」就不弹。
             *
             * ⚠️ Hook 必须在**任何提前 return 之前**（下面 `project === null` 那条
             * 早返回会绕过它）—— 顺序一变就是 React error #310，整块白屏。
             * `verify-tile-client.mjs` 的 Hook 顺序契约会拦。
             */
            const [gateOpen, setGateOpen] = React.useState(experimentalGateMuted.tile !== true);
            const closeGate = React.useCallback(() => setGateOpen(false), []);
            /** 正在编辑哪个地块（key）；null = 没有在编辑。 */
            const [editingKey, setEditingKey] = React.useState(null);
            /** 该地块的草稿（点「保存」才提交，避免每敲一个字就作废产物）。 */
            const [itemDraft, setItemDraft] = React.useState(null);
            /** 新增地块的草稿；non-null 时显示新增表单。 */
            const [newItem, setNewItem] = React.useState(null);
            /** 地图笔刷：选中的地块 key（点格子就刷它）。 */
            const [brushKey, setBrushKey] = React.useState(null);
            /** 正在编辑的地图格子（"r,c"）与其草稿。 */
            const [cellKey, setCellKey] = React.useState(null);
            /** 地图布局草稿（点格子/擦除都只改它，点「保存布局」才提交）。 */
            const [mapDraft, setMapDraft] = React.useState(null);
            /**
             * 光标停在哪一格（`"r,c"`）。
             *
             * 红警盖房子那种「幽灵预览」要用它：选了 2×2 的建筑笔刷后，
             * 鼠标移到哪就把**整块占格**高亮出来，并当场告诉用户能不能放
             * —— 只高亮一格的话，用户根本不知道这一下会盖多大一片。
             */
            const [hoverCell, setHoverCell] = React.useState(null);
            /**
             * 撤销 / 重做栈。
             *
             * 放在 `useRef` 里而不是 `useState`：它只在提交草稿时读写，
             * 不需要触发重渲染，放 state 里只会多一个 Hook 槽位、还容易漏同步。
             *
             * 跨格摆放已经在改结构了 —— 误放一栋 2×2 却只能「放弃修改」整份丢掉重来，
             * 那是不能接受的。
             *
             * ⚠️ **必须放在所有 `return` 之前**。组件下面有个 `if (project === null) return`，
             * 把 Hook 放到它后面会让「有没有项目」改变 Hook 数量 —— React 直接抛
             * error #310（Rendered more hooks than during the previous render），
             * 整个面板白屏。实测踩过。
             */
            const historyRef = React.useRef({ stack: [], index: -1 });
            /**
             * 建筑贴图的**实测尺寸标定**：`{ 'r,c': { top: px, left: px } }`（1× 未裁坐标）。
             *
             * 为什么需要：界面算包围盒要知道贴图的自然高宽比，而那是异步才知道的；
             * 它只能拿 `preview.buildings[].ratio` 估。估出来的高度与真贴图差一截时
             * （尤其**刚放下、还没保存**的那栋 —— 它不在 preview 里，只能按比例 1 估），
             * `trimTop` 就跟着变，表现是**整张预览在保存前后跳一下**
             * （真机反馈的「保存后中世纪房屋上移一格」）。
             *
             * 所以贴图加载完就量一次真实尺寸，把包围盒修正成跟宿主一致的精确值，
             * 并按项目缓存，避免每帧重测。
             */
            const spriteCalibRef = React.useRef({ project: null, map: {} });
            /** 标定完成后 +1，逼一次重渲染让包围盒用上真尺寸。 */
            const [calibTick, setCalibTick] = React.useState(0);
            const tasks = usePendingTasks();
            const intent = useStudioIntent();
            React.useEffect(() => {
                if (intent === null)
                    return;
                if (intent.module === "tile" && typeof intent.jobId === "string")
                    setProjectId(intent.jobId);
                if (intent.module === "tile" && typeof intent.stage === "string")
                    setStage(intent.stage);
            }, [intent]);
            const busy = project !== null && project.job !== null && project.job !== undefined && project.job.running !== null;
            /**
             * 「这一张」是不是本次作业的目标。
             *
             * ⚠️ 单张重跑的按钮必须按**这一张**判忙，不能按整个项目判忙。
             * 以前每个「重跑」都绑 `busy`（= 项目里有任何作业在跑），于是点一张重跑，
             * **整屏按钮一起转圈、一起变灰**，看着就像所有地块都在重跑 ——
             * 宿主其实只跑了那一张（`job.targets` 只有 `key#vN`）。
             * 判据用 `job.running`：它就是当前正在处理的那个 `key#vN`。
             */
            const isVariantRunning = (key, index) => busy && project.job?.running === `${key}#v${index + 1}`;
            /** 这一张在本次作业的目标里吗（含还没轮到的）—— 「排队中」用它。 */
            const isVariantTargeted = (key, index) => busy === true && (project.job?.targets ?? []).includes(`${key}#v${index + 1}`);
            const refreshProjects = React.useCallback(async () => {
                try {
                    const result = await api.listTileProjects();
                    setProjects(result.projects ?? []);
                    return result.projects ?? [];
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                    return [];
                }
            }, [api]);
            /**
             * 重新读项目。
             *
             * ⚠️ 这个函数会被**轮询**调用（有任务在跑时每 1.5 秒一次），所以它**绝不能**
             * 重置编辑草稿 —— 否则用户正在涂的地图布局、正在改的提示词会被定时器冲掉。
             * 实测踩过：拼完图 `load()` 一跑，界面上的可点格子就整片消失了。
             * 「切项目时清草稿」由下面的 effect 按 projectId 变化来做。
             */
            const reload = React.useCallback(async (id) => {
                if (id === null)
                    return;
                try {
                    const next = await api.getTileProject(id);
                    setProject(next);
                    setStyleDraft((current) => (current === "" ? (next.style ?? "") : current));
                    setMapRows(next.map?.rows ?? 14);
                    setMapCols(next.map?.cols ?? 14);
                    setMapSeed(next.map?.seed ?? 20261004);
                    setBrushKey((current) => {
                        const keys = (next.items ?? []).map((item) => item.key);
                        if (current === "__erase__")
                            return current;
                        return current !== null && keys.includes(current) ? current : (keys[0] ?? null);
                    });
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api]);
            /** 切项目时把草稿清干净，免得把 A 项目的编辑存到 B 项目。 */
            const load = React.useCallback(async (id) => {
                setEditingKey(null);
                setItemDraft(null);
                setNewItem(null);
                setCellKey(null);
                setMapDraft(null);
                setHoverCell(null);
                setNameDraft("");
                setStyleDraft("");
                await reload(id);
            }, [reload]);
            React.useEffect(() => { void refreshProjects(); }, [refreshProjects]);
            React.useEffect(() => { void load(projectId); }, [projectId, load]);
            // 有任务在跑时轮询：进度要能自己往前走，不能等用户手动刷新。
            // ⚠️ 这里必须用 `reload`（不动草稿）而不是 `load`（清草稿）——
            // 用 load 的话每 1.5 秒就会把用户正在涂的地图布局冲掉。
            React.useEffect(() => {
                if (!busy)
                    return undefined;
                const timer = setInterval(() => { void reload(projectId); }, 1500);
                return () => clearInterval(timer);
            }, [busy, projectId, reload]);
            /**
             * 键盘交互 —— 常见地图编辑器都有的那几件。
             *
             * 只在**编辑态**生效（`mapDraft !== null`），而且光标在输入框里时一律让路：
             * 不然用户在地图格子里打字（重命名之类）时按 Esc / Ctrl+Z 会误伤。
             *
             * 撤销/重做的实现先从这个 effect 里内联，别去调下面定义的 `undoSave`——
             * 那些 const 在早退之后，而**这个 effect 必须在早退之前**
             * （Hook 顺序，见 `verify-client.mjs` 的「Hook 全在早退之前」契约）。
             */
            React.useEffect(() => {
                if (typeof window === "undefined")
                    return undefined;
                const onKey = (event) => {
                    if (mapDraft === null)
                        return;
                    const tag = String(event.target?.tagName ?? "").toLowerCase();
                    if (tag === "input" || tag === "textarea" || tag === "select")
                        return;
                    if (event.key === "Escape") {
                        // Esc：收起幽灵预览 + 放下笔刷（等于「我不放了」）
                        setHoverCell(null);
                        setBrushKey(null);
                        return;
                    }
                    const meta = event.ctrlKey || event.metaKey;
                    if (!meta)
                        return;
                    const key = String(event.key ?? "").toLowerCase();
                    const isUndo = key === "z" && !event.shiftKey;
                    const isRedo = (key === "z" && event.shiftKey) || key === "y";
                    if (!isUndo && !isRedo)
                        return;
                    const h = historyRef.current;
                    const target = isRedo ? h.index + 1 : h.index - 1;
                    if (target < 0 || target >= h.stack.length)
                        return;
                    event.preventDefault();
                    h.index = target;
                    setMapDraft(h.stack[target]);
                    setNotice({ kind: "info", text: isRedo ? T("已重做。") : T("已撤销。") });
                };
                window.addEventListener("keydown", onKey);
                return () => window.removeEventListener("keydown", onKey);
            }, [mapDraft]);
            /**
             * 贴图加载完就把**真尺寸**记下来（给包围盒用）。
             *
             * ⚠️ 必须在 effect 里做，不能在 `ref` 回调里 `setState` ——
             * `ref` 回调发生在渲染阶段，在渲染期改状态会触发 React 警告甚至死循环。
             * 这里读 DOM 上那几张建筑贴图的自然尺寸，变了才记，并在渲染后同步一次。
             *
             * ⚠️ 这个 Hook 也必须在 `if (project === null)` **之前**
             * （Hook 顺序契约，见 `verify-client.mjs`）；所以它读的是渲染闭包里的
             * `mapDraft` / `project`，而不是下面那些派生常量。
             */
            React.useLayoutEffect(() => {
                if (typeof document === "undefined")
                    return;
                const store = spriteCalibRef.current;
                if (store.project !== project?.id) {
                    store.project = project?.id ?? null;
                    store.map = {};
                }
                let dirty = false;
                for (const bd of mapDraft?.buildings ?? []) {
                    const el = document.querySelector(`img[data-sprite="${bd.r},${bd.c}"]`);
                    const nw = el?.naturalWidth ?? 0;
                    const nh = el?.naturalHeight ?? 0;
                    if (nw <= 0 || nh <= 0)
                        continue;
                    const key = `${bd.r},${bd.c}`;
                    const prev = store.map[key];
                    if (prev !== undefined && prev.naturalW === nw && prev.naturalH === nh)
                        continue;
                    store.map[key] = { naturalW: nw, naturalH: nh };
                    dirty = true;
                }
                if (dirty)
                    setCalibTick((n) => n + 1);
            }, [project, mapDraft]);
            const run = React.useCallback(async (label, fn) => {
                setNotice(null);
                try {
                    const result = await tasks.run(`tile:${label}`, label, fn);
                    if (result !== undefined && result !== null && typeof result === "object" && "started" in result && result.started === false) {
                        setNotice({ kind: "error", text: result.reason ?? T("任务没有启动") });
                    }
                    // 用 reload（不清草稿）：保存一个地块之后，用户可能还在涂地图布局
                    await reload(projectId);
                    await refreshProjects();
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [tasks, reload, projectId, refreshProjects]);
            const createProject = React.useCallback(async () => {
                setCreating(true);
                setNotice(null);
                try {
                    const created = await api.createTileProject({ name: nameDraft.trim() === "" ? T("未命名地图") : nameDraft.trim() });
                    setProjectId(created.id);
                    setStage("generate");
                    await refreshProjects();
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
                finally {
                    setCreating(false);
                }
            }, [api, nameDraft, refreshProjects]);
            // ── 顶部：项目选择 / 新建 ──────────────────────────────────────────
            const header = h("div", { className: "SPR_tileHeader" }, h("span", { className: "SPR_fieldLabel" }, T("项目")), h("select", {
                className: "SPR_input",
                value: projectId ?? "",
                onChange: (event) => setProjectId(event.target.value === "" ? null : event.target.value)
            }, h("option", { value: "" }, T("（未选择）")), projects.map((entry) => h("option", { key: entry.id, value: entry.id }, `${entry.name} · ${entry.generatedCount}/${entry.expectedCount}`))), h("input", {
                className: "SPR_input",
                placeholder: T("新项目名称"),
                value: nameDraft,
                onChange: (event) => setNameDraft(event.target.value)
            }), h(BusyBtn, {
                busy: creating,
                className: "SPR_btn",
                onClick: () => void createProject()
            }, T("新建项目")), project === null ? null : h("span", { className: "SPR_muted" }, T("已生成 {n0} / {n1}，已验收 {n2}", {
                n0: project.progress?.generated ?? 0,
                n1: project.progress?.expected ?? 0,
                n2: project.progress?.approved ?? 0
            })));
            if (project === null) {
                return h("div", { className: "SPR_module" }, gateOpen ? h(TileExperimentalDialog, { onClose: closeGate }) : null, h(ExperimentalBar, null), header, h("div", { className: "SPR_empty" }, T("还没有地图地块项目——取个名字点「新建项目」开始。")), notice === null ? null : h("div", { className: `SPR_notice SPR_notice-${notice.kind}` }, notice.text));
            }
            // ── 步骤条 ────────────────────────────────────────────────────────
            const steps = h("div", { className: "SPR_steps" }, TILE_STAGES.map((entry) => {
                const state = project.stages?.[entry.key] ?? { status: "idle" };
                return h("button", {
                    key: entry.key,
                    type: "button",
                    className: `SPR_step${stage === entry.key ? " SPR_step-active" : ""} SPR_step-${state.status}`,
                    title: entry.hint,
                    onClick: () => setStage(entry.key)
                }, entry.title, state.status === "done" ? h("span", { className: "SPR_stepMark" }, "✓") : null, state.status === "error" ? h("span", { className: "SPR_stepMark" }, "!") : null);
            }));
            // ── 参考图（原「① 模板」）──────────────────────────────────────────
            //
            // ★ 这一步**已经不是独立阶段了** —— 点「生成全部地块」时宿主会按当前
            // 占格形状自动渲染参考图，形状/格子尺寸没变就直接复用上次那份
            // （一次渲染 120~390ms、约 14MB，十几个变体每次现渲染就是几十秒白等）。
            //
            // 这里只做**只读预览**：让你在花钱之前看一眼「模型会照着什么画」。
            // 几何错了看这张图最快 —— 这个模块的错好几次都是这么发现的。
            const templatePanel = h("div", { className: "SPR_templatePanel" }, h("div", { className: "SPR_row" }, h("span", { className: "SPR_fieldLabel" }, T("参考图（自动生成，免费）")), h("span", { className: "SPR_muted" }, T("按②里每个地块的占格形状渲染；改了形状或格子尺寸，下次生成时自动重做"))), 
            // ⚠️ 这里**不能**用 `onError` 把图 `display:none` 掉。
            // 一旦被隐藏，之后即使生成好了也不会再显示（浏览器不会重跑 onError）。
            // 正确做法：按文件**在不在**决定渲不渲染，`onError` 只做「标灰」提示。
            //
            // ★ 文件名一律读**宿主列出来的那份**（`project.templates`），界面不写死。
            // 写死 `cell.png` + `grid2x2.png` 会把 3×1 / L 形的参考图藏起来，
            // 用户以为「只支持 1×1 和 2×2」。
            //
            // ★★ 但**只有磁盘上真有的**才能挂 `<img>`（`templatesPresent`）。
            // 期望清单里的文件可能还没落盘 —— 给它挂 `<img>` 就是一次 404，
            // 面板上全是裂图（实测：用户报的「参考图是裂的」就是这个）。
            // 没落盘的显示成「待生成」占位块。
            //
            // 版本参数用宿主的 `templateRev` 而不是 `project.updatedAt`：
            // 图片 404 之后浏览器会把**那次失败也缓存住**，而「只是图片 404」时
            // `updatedAt` 不会变 —— 于是生成完了图还是裂的。
            // `templateRev` 每次作业结束换一个值，强制浏览器重新取一次。
            (project.templates ?? []).length > 0
                ? h("div", { className: "SPR_row SPR_templateRow" }, ...(project.templates ?? []).map((name) => {
                    const label = templateLabel(name);
                    if (!(project.templatesPresent ?? []).includes(name)) {
                        return h("div", {
                            key: name,
                            className: "SPR_tileAsset SPR_tileAsset-pending",
                            "data-template": name,
                            "data-pending": "1",
                            title: T("还没生成 —— 点「生成全部地块」时会自动渲染")
                        }, h("div", { className: "SPR_thumb SPR_thumb-pending" }, T("待生成")), h("span", { className: "SPR_muted" }, label));
                    }
                    return h("div", {
                        key: name,
                        className: "SPR_tileAsset",
                        "data-template": name
                    }, h("img", {
                        className: "SPR_thumb",
                        src: `${project.assetBase}template/${name}?v=${encodeURIComponent(project.templateRev ?? "")}`,
                        alt: name,
                        onError: (event) => { event.target.setAttribute("data-broken", "1"); }
                    }), h("span", { className: "SPR_muted" }, label));
                }))
                : h("p", { className: "SPR_muted" }, busy
                    ? T("正在准备参考图…")
                    : T("还没有参考图 —— 点「生成全部地块」时会自动渲染（免费）。")));
            // ── 地块清单的增 / 删 / 改 ────────────────────────────────────────
            //
            // 全部通过 `saveTileProject({items})` 提交，宿主侧 `mergeTileItems` 负责
            // 「保留已生成的变体、只作废提示词真的变了的那些」。所以这里只管把
            // 完整的 items 列表拼出来 —— **必须带上 `variants`**，否则宿主认为
            // 这是个没有产物的新条目（早期版本就是这么把已生成的图弄丢的）。
            /** 把界面上的 items 整理成宿主能合并的形状（保留产物与不在编辑中的字段）。 */
            const itemsForSave = (overrides = {}) => project.items.map((item) => {
                const source = overrides[item.key] ?? item;
                return {
                    key: source.key,
                    label: source.label,
                    kind: source.kind,
                    family: source.family,
                    footprint: source.footprint,
                    // ★ 形状必须一起提交：宿主按它算包围菱形与摆放，
                    // 只给 footprint（包围矩形）L 形会退化成方块。
                    shape: source.shape ?? shapeOfKey(source.key),
                    content: source.content,
                    mode: source.mode,
                    variantCount: source.variantCount,
                    variants: item.variants
                };
            });
            const startEdit = (item) => {
                setEditingKey(item.key);
                setNewItem(null);
                setItemDraft({
                    key: item.key,
                    label: item.label ?? "",
                    kind: item.kind ?? "terrain",
                    family: item.family ?? item.key,
                    footprint: [...(item.footprint ?? [1, 1])],
                    shape: shapeOfKey(item.key),
                    content: item.content ?? "",
                    mode: item.mode ?? "template",
                    variantCount: Math.max(1, item.variantCount ?? 1)
                });
            };
            /**
             * 保存一个地块的编辑。
             * ⚠️ 改 `key` 等于**换了个地块**：旧 key 的产物不能直接搬过去（宿主按 key 合并），
             * 所以这里把 key 做成只读展示，要改 key 就删掉重建。
             */
            const saveItem = async () => {
                if (itemDraft === null)
                    return;
                const next = itemsForSave({ [itemDraft.key]: itemDraft });
                const promptChanged = itemDraft.content !== project.items.find((i) => i.key === itemDraft.key)?.content
                    || itemDraft.mode !== project.items.find((i) => i.key === itemDraft.key)?.mode;
                await api.saveTileProject({ projectId: project.id, items: next });
                setNotice({
                    kind: "info",
                    text: promptChanged
                        ? T("已保存「{n0}」——提示词变了，这个地块的产物已作废，需要重跑", { n0: itemDraft.label || itemDraft.key })
                        : T("已保存「{n0}」——提示词没变，产物保住了", { n0: itemDraft.label || itemDraft.key })
                });
                setEditingKey(null);
                setItemDraft(null);
            };
            const deleteItem = async (item) => {
                const next = project.items
                    .filter((entry) => entry.key !== item.key)
                    .map((entry) => ({
                    key: entry.key, label: entry.label, kind: entry.kind, family: entry.family,
                    footprint: entry.footprint, content: entry.content, mode: entry.mode,
                    variantCount: entry.variantCount, variants: entry.variants
                }));
                if (next.length === 0) {
                    setNotice({ kind: "error", text: T("至少要留一个地块") });
                    return;
                }
                await api.saveTileProject({ projectId: project.id, items: next });
                if (editingKey === item.key) {
                    setEditingKey(null);
                    setItemDraft(null);
                }
                setNotice({ kind: "info", text: T("已删除「{n0}」", { n0: item.label }) });
            };
            /** 新增地块：key 必须唯一且是「英文小写 / 数字 / 下划线」，它会被当文件名用。 */
            const addItem = async () => {
                if (newItem === null)
                    return;
                const key = String(newItem.key ?? "").trim();
                if (!/^[a-z][a-z0-9_]{1,23}$/.test(key)) {
                    setNotice({ kind: "error", text: T("地块标识只能用英文小写字母开头，后接小写字母 / 数字 / 下划线（2~24 位）——它会当文件名用") });
                    return;
                }
                if (project.items.some((item) => item.key === key)) {
                    setNotice({ kind: "error", text: T("已经有同名地块了：{n0}", { n0: key }) });
                    return;
                }
                const next = [
                    ...project.items.map((entry) => ({
                        key: entry.key, label: entry.label, kind: entry.kind, family: entry.family,
                        footprint: entry.footprint, content: entry.content, mode: entry.mode,
                        variantCount: entry.variantCount, variants: entry.variants
                    })),
                    {
                        key,
                        label: newItem.label?.trim() === "" ? key : newItem.label,
                        kind: newItem.kind,
                        family: newItem.family?.trim() === "" ? key : newItem.family,
                        footprint: newItem.footprint,
                        shape: newItem.shape ?? shapeFromRect(newItem.footprint[0], newItem.footprint[1]),
                        content: newItem.content ?? "",
                        mode: newItem.mode,
                        variantCount: Math.max(1, newItem.variantCount ?? 1),
                        variants: []
                    }
                ];
                await api.saveTileProject({ projectId: project.id, items: next });
                setNewItem(null);
                setNotice({ kind: "info", text: T("已新增地块「{n0}」", { n0: key }) });
            };
            const resetItems = async () => {
                await api.saveTileProject({ projectId: project.id, resetItemsToDefault: true });
                setEditingKey(null);
                setItemDraft(null);
                setNewItem(null);
                setNotice({ kind: "info", text: T("已恢复默认地块清单（已生成的地块会作废）") });
            };
            /** 一个地块卡片的可编辑表单。 */
            const itemEditor = () => {
                if (itemDraft === null)
                    return null;
                const set = (patch) => setItemDraft((draft) => ({ ...draft, ...patch }));
                const original = project.items.find((item) => item.key === itemDraft.key);
                const promptChanged = original !== undefined &&
                    (original.content !== itemDraft.content || original.mode !== itemDraft.mode);
                return h("div", { className: "SPR_tileEditor" }, h("div", { className: "SPR_tileEditorRow" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("标识（key，只读）")), h("input", { className: "SPR_input", value: itemDraft.key, readOnly: true, disabled: true })), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("名称")), h("input", {
                    className: "SPR_input",
                    value: itemDraft.label,
                    onChange: (event) => set({ label: event.target.value })
                })), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("用途")), h("select", {
                    className: "SPR_input",
                    value: itemDraft.kind,
                    onChange: (event) => {
                        const kind = event.target.value;
                        // 换用途时把生成方式也带到一个合理默认，省得用户自己配错
                        set({ kind, mode: kind === "decor" ? "plain" : kind === "building" ? "grid2x2" : "template" });
                    }
                }, h("option", { value: "terrain" }, T("地形（占 1 格）")), h("option", { value: "decor" }, T("装饰（占 1 格、按锚点摆放）")), h("option", { value: "building" }, T("建筑（跨格）")))), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("生成方式")), h("select", {
                    className: "SPR_input",
                    value: itemDraft.mode,
                    onChange: (event) => set({ mode: event.target.value })
                }, h("option", { value: "template" }, T("模板填充（地形）")), h("option", { value: "plain" }, T("白底单图（装饰）")), h("option", { value: "grid2x2" }, T("2×2 地基网格（建筑）"))))), h("div", { className: "SPR_tileEditorRow" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("变体数（每个变体一次计费调用）")), h(NumField, {
                    className: "SPR_input SPR_input-num",
                    value: itemDraft.variantCount, min: 1, max: 6, step: 1,
                    onChange: (next) => set({ variantCount: Math.max(1, Math.min(6, next)) })
                })), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("类别（铺图时按它随机抽变体）")), h("input", {
                    className: "SPR_input",
                    value: itemDraft.family,
                    onChange: (event) => set({ family: event.target.value })
                })), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("占格形状（点格子增删，支持 L 形）")), h(ShapeEditor, {
                    shape: itemDraft.shape ?? shapeFromRect(itemDraft.footprint[0], itemDraft.footprint[1]),
                    onChange: (next) => set({ shape: next, footprint: footprintOfShape(next) })
                }))), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("生成提示词（只描述「菱形里面是什么」；形状 / 角度 / 透视由代码保证，不要写）")), h("textarea", {
                    className: "SPR_input SPR_tilePrompt",
                    rows: 4,
                    value: itemDraft.content,
                    onChange: (event) => set({ content: event.target.value })
                })), promptChanged
                    ? h("div", { className: "SPR_tileBadge SPR_tileBadge-warn" }, T("提示词与生成方式有改动 —— 保存后这个地块的已生成产物会作废（重跑要花钱）"))
                    : h("div", { className: "SPR_muted" }, T("只改名称 / 类别 / 变体数不会作废产物")), 
                // 实时预览最终会发给模型的提示词：用户能看见「统一画风」被追加在末尾
                h("details", { className: "SPR_tilePromptPreview" }, h("summary", null, T("看最终提示词")), h("pre", null, buildTilePromptPreview(itemDraft, styleDraft))), h("div", { className: "SPR_row" }, h("button", {
                    type: "button",
                    className: "SPR_btn SPR_btn-primary",
                    onClick: () => void run(T("保存地块"), saveItem)
                }, T("保存")), h("button", {
                    type: "button",
                    className: "SPR_btn",
                    onClick: () => { setEditingKey(null); setItemDraft(null); }
                }, T("取消")), h("button", {
                    type: "button",
                    className: "SPR_btn",
                    onClick: () => void run(T("移除地块"), () => deleteItem(original ?? { key: itemDraft.key, label: itemDraft.label }))
                }, T("删除这个地块"))));
            };
            // ── ② 生成 ────────────────────────────────────────────────────────
            const geomBadge = (variant) => {
                const report = variant.report;
                if (variant.error !== undefined)
                    return h("span", { className: "SPR_tileBadge SPR_tileBadge-bad" }, T("失败"));
                if (report === undefined)
                    return null;
                if (report.mode === "template")
                    return h("span", { className: "SPR_tileBadge SPR_tileBadge-warn" }, T("模板几何"));
                const ratio = report.ratioMeasured;
                if (typeof ratio !== "number")
                    return h("span", { className: "SPR_tileBadge" }, "—");
                const off = Math.abs(ratio - 2);
                const cls = off <= 0.02 ? "SPR_tileBadge-ok" : off <= 0.05 ? "SPR_tileBadge" : "SPR_tileBadge-warn";
                return h("span", { className: `SPR_tileBadge ${cls}` }, `2:1 · ${ratio.toFixed(3)}`);
            };
            /**
             * 实时预览「最终会发给模型的提示词」。
             *
             * 刻意在客户端复刻一份 `buildTilePrompt`（`src/tilegen.ts`）的形状：
             * 浏览器半区是经典脚本，不能 import 宿主代码。两边的一致性由
             * `verify-tile-client.mjs` 断言（它比对同一份 items + style 下两侧的前缀）。
             * 前缀文案不要求逐字相同（那会把界面和宿主焊死），但**结构**必须一致：
             * 地形 = 固定前缀 + 内容 + 画风；装饰 = 白底单图前缀；建筑 = 地基说明。
             */
            const buildTilePromptPreview = (draft, style) => {
                const tail = String(style ?? "").trim() === "" ? "" : ` ${String(style).trim()}`;
                if (draft.kind === "decor" || draft.mode === "plain") {
                    return `画一个斜45度等轴测（isometric）视角的游戏装饰物贴图，正交投影，观察者从画面下方看。` +
                        `正方形画布，装饰物居中，纯白色背景，画面里只有这一个东西：${draft.content}${tail}`;
                }
                if (draft.kind === "building" || draft.mode === "grid2x2") {
                    // ★ 形状描述必须按**这个地块自己的形状**算，不能写死「2x2 共 4 格」。
                    // 曾经写死了：用户新加一个 3×1 的围墙，预览里仍然写着 2x2 ——
                    // 预览与实际提示词对不上，用户以为形状没生效。
                    // 与宿主 `tilegen.describeShape` 同一条逻辑（矩形不写）。
                    const shape = draft.shape ?? shapeFromRect(draft.footprint?.[0] ?? 1, draft.footprint?.[1] ?? 1);
                    const note = describeShapePreview(shape);
                    return `参考图是一张斜45度等轴测（isometric）的建筑施工参考图。\n` +
                        `图中：浅灰色的菱形是建筑的**地基**，洋红色线是地基的边界，\n` +
                        `蓝色的线框是从地基四个角**垂直向上**拉出来的立方体。\n` +
                        `请画一栋**立体的建筑**：${draft.content}` +
                        (note === undefined ? "" : `\n${note}`) +
                        `\n视角是斜45度等轴测俯视（观察者从画面下方看）……\n` +
                        `像素画风，色彩明快饱和，干净色块，无文字、无数字、无边框、无阴影。`;
                }
                return `参考图里那个洋红色菱形就是地块的确切形状与位置。请只把菱形内部填成下面的内容。\n` +
                    `硬性要求：菱形的四个顶点、四条边、大小、位置必须与参考图完全一致；……\n\n` +
                    `内容：${draft.content}${tail}`;
            };
            const generateStage = h("div", { className: "SPR_tileStage" }, h("p", { className: "SPR_hint" }, T("生成一个变体 = 一次 Seedream 调用。参考图按每个地块的占格形状自动渲染，不用手动准备。")), templatePanel, h("div", { className: "SPR_row" }, h("span", { className: "SPR_fieldLabel" }, T("统一画风")), h("input", {
                className: "SPR_input SPR_input-wide",
                value: styleDraft,
                onChange: (event) => setStyleDraft(event.target.value)
            }), h(BusyBtn, {
                busy: busy || tasks.active,
                className: "SPR_btn",
                onClick: () => void run(T("保存画风"), async () => {
                    await api.saveTileProject({ projectId: project.id, style: styleDraft });
                })
            }, T("保存画风")), h("span", { className: "SPR_muted" }, T("改画风会让已生成的地块全部作废（重跑要花钱）"))), h("div", { className: "SPR_row" }, h(BusyBtn, {
                busy: busy,
                className: "SPR_btn SPR_btn-primary",
                onClick: () => void run(T("生成全部"), () => api.runTileItems({ projectId: project.id }))
            }, T("生成全部地块")), h(BusyBtn, {
                busy: busy,
                className: "SPR_btn",
                onClick: () => void run(T("补缺"), async () => {
                    const missing = project.items.filter((item) => item.variants.length === 0).map((item) => item.key);
                    if (missing.length === 0)
                        return { started: false, reason: T("所有地块都已经生成过了") };
                    return api.runTileItems({ projectId: project.id, keys: missing });
                })
            }, T("只补没生成的")), h("button", {
                type: "button",
                className: "SPR_btn",
                onClick: () => {
                    setNewItem({
                        key: "", label: "", kind: "terrain", family: "",
                        footprint: [1, 1], content: "", mode: "template", variantCount: 1
                    });
                    setEditingKey(null);
                    setItemDraft(null);
                }
            }, T("＋ 新增地块")), h(BusyBtn, {
                busy: busy,
                className: "SPR_btn",
                onClick: () => void run(T("恢复默认清单"), resetItems)
            }, T("恢复默认清单")), busy ? h(BusyBtn, {
                busy: false,
                className: "SPR_btn",
                onClick: () => void run(T("停止"), () => api.cancelTileJob({ projectId: project.id }))
            }, T("停止")) : null), 
            // 新增地块表单
            newItem === null ? null : h("div", { className: "SPR_tileEditor" }, h("div", { className: "SPR_tileEditorRow" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("标识（英文小写，会当文件名）")), h("input", {
                className: "SPR_input",
                placeholder: "rock3",
                value: newItem.key,
                onChange: (event) => setNewItem({ ...newItem, key: event.target.value })
            })), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("名称")), h("input", {
                className: "SPR_input",
                placeholder: T("灰色岩壁"),
                value: newItem.label,
                onChange: (event) => setNewItem({ ...newItem, label: event.target.value })
            })), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("用途")), h("select", {
                className: "SPR_input",
                value: newItem.kind,
                onChange: (event) => {
                    const kind = event.target.value;
                    setNewItem({ ...newItem, kind, mode: kind === "decor" ? "plain" : kind === "building" ? "grid2x2" : "template" });
                }
            }, h("option", { value: "terrain" }, T("地形（占 1 格）")), h("option", { value: "decor" }, T("装饰（占 1 格、按锚点摆放）")), h("option", { value: "building" }, T("建筑（跨格）")))), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("变体数（每个变体一次计费调用）")), h(NumField, {
                className: "SPR_input SPR_input-num",
                value: newItem.variantCount, min: 1, max: 6, step: 1,
                onChange: (next) => setNewItem({ ...newItem, variantCount: Math.max(1, Math.min(6, next)) })
            })), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("类别（铺图时按它随机抽变体）")), h("input", {
                className: "SPR_input",
                placeholder: newItem.key === "" ? T("留空即用标识") : newItem.key,
                value: newItem.family,
                onChange: (event) => setNewItem({ ...newItem, family: event.target.value })
            }))), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("生成提示词（只描述「菱形里面是什么」）")), h("textarea", {
                className: "SPR_input SPR_tilePrompt",
                rows: 3,
                value: newItem.content,
                onChange: (event) => setNewItem({ ...newItem, content: event.target.value })
            })), h("div", { className: "SPR_row" }, h("button", {
                type: "button",
                className: "SPR_btn SPR_btn-primary",
                onClick: () => void run(T("新增地块"), addItem)
            }, T("新增")), h("button", { type: "button", className: "SPR_btn", onClick: () => setNewItem(null) }, T("取消")))), 
            // 进度条由模块顶部统一渲染（`TileProgressBar`，行内、不遮挡），
            // 这里不再重复一份 —— 重复会出现两条进度、还会让「正在生成」字样对不上。
            h("div", { className: "SPR_tileGrid" }, project.items.map((item) => h("div", {
                key: item.key,
                className: `SPR_tileCard${editingKey === item.key ? " SPR_tileCard-editing" : ""}`
            }, h("div", { className: "SPR_tileCardHead" }, h("span", { className: "SPR_tileCardTitle" }, item.label), h("span", { className: "SPR_muted" }, `${item.kind} · ${item.variantCount} 张 · ${item.family}`)), 
            // 编辑态：整张卡片换成表单（缩略图仍在上面的验收阶段可看）
            editingKey === item.key
                ? itemEditor()
                : h("div", { className: "SPR_row" }, h("button", {
                    type: "button",
                    className: "SPR_btn SPR_btn-mini",
                    onClick: () => startEdit(item)
                }, T("编辑")), h("button", {
                    type: "button",
                    className: "SPR_btn SPR_btn-mini",
                    onClick: () => void run(T("删除"), () => deleteItem(item))
                }, T("删除"))), h("div", { className: "SPR_tileThumbs" }, Array.from({ length: Math.max(1, item.variantCount) }).map((_, index) => {
                const variant = item.variants[index];
                const ready = variant !== undefined && variant.cell !== undefined;
                return h("div", { key: index, className: "SPR_tileThumb" }, ready
                    ? h("img", {
                        className: "SPR_thumb",
                        src: `${project.assetBase}${variant.cell}?v=${encodeURIComponent(project.updatedAt ?? "")}`,
                        alt: `${item.key}-${index}`
                    })
                    : h("div", { className: "SPR_thumb SPR_thumb-empty" }, isVariantTargeted(item.key, index) ? T("排队中") : T("待生成")), ready ? geomBadge(variant) : null, ready ? h(BusyBtn, {
                    busy: isVariantRunning(item.key, index),
                    busyText: T("重跑中…"),
                    className: "SPR_btn SPR_btn-mini",
                    onClick: () => void run(T("重跑"), () => api.runTileItem({ projectId: project.id, key: item.key, variant: index }))
                }, T("重跑")) : null);
            }))))));
            // ── ③ 验收 ────────────────────────────────────────────────────────
            const reviewStage = h("div", { className: "SPR_tileStage" }, h("p", { className: "SPR_hint" }, T("逐项看成品与几何报告。几何正常的地块拼起来不会有缝；标「模板几何」说明这张没量准，建议重跑。")), h("div", { className: "SPR_tileGrid" }, project.items.map((item) => h("div", { key: item.key, className: "SPR_tileCard" }, h("div", { className: "SPR_tileCardHead" }, h("span", { className: "SPR_tileCardTitle" }, item.label), item.variants.length === 0 ? h("span", { className: "SPR_tileBadge SPR_tileBadge-warn" }, T("未生成")) : null), h("div", { className: "SPR_tileThumbs" }, item.variants.map((variant) => h("div", { key: variant.index, className: "SPR_tileThumb" }, variant.cell === undefined
                ? h("div", { className: "SPR_thumb SPR_thumb-empty" }, variant.error ?? T("失败"))
                : h(ZoomableImage, {
                    className: "SPR_thumb",
                    src: `${project.assetBase}${variant.cell}?v=${encodeURIComponent(project.updatedAt ?? "")}`,
                    alt: `${item.key}-${variant.index}`,
                    caption: `#${variant.index + 1}`
                }), geomBadge(variant), variant.cell === undefined ? null : h("div", { className: "SPR_row" }, h("button", {
                type: "button",
                className: `SPR_btn SPR_btn-mini${variant.approved === true ? " SPR_btn-on" : ""}`,
                onClick: () => void run(T("验收"), async () => {
                    await api.setTileApproved({
                        projectId: project.id, key: item.key, variant: variant.index,
                        approved: variant.approved !== true
                    });
                })
            }, variant.approved === true ? T("已通过") : T("通过")), h(BusyBtn, {
                busy: isVariantRunning(item.key, variant.index),
                busyText: T("重跑中…"),
                className: "SPR_btn SPR_btn-mini",
                onClick: () => void run(T("重跑"), () => api.runTileItem({ projectId: project.id, key: item.key, variant: variant.index }))
            }, T("重跑"))))))))));
            // ── ④ 拼图 ────────────────────────────────────────────────────────
            const numberField = (label, value, setValue, min, max, step) => h("label", { className: "SPR_field SPR_field-inline" }, h("span", { className: "SPR_fieldLabel" }, label), h(NumField, { className: "SPR_input SPR_input-num", value, min, max, step, onChange: (next) => setValue(next) }));
            /**
             * 地图布局草稿 —— **三层分开存**：
             *   · `ground[r][c]`：地面地块键（空格 = 空地）
             *   · `decor["r,c"]`：装饰键（与地面**独立**，所以树下面照样有草地）
             *   · `buildings`：跨格建筑（锚点 + 占格 + 垫底地面）
             *
             * 为什么要有草稿：宿主每次 `saveTileMapCells` 都会作废下游（拼出来的图）。
             * 用户连续涂十几格如果每次都提交，就变成十几次往返 + 十几次作废。
             * 所以涂改只改草稿，点「保存布局」才提交一次。
             *
             * ⚠️ 以前是**单层**的：一格只存一个键。于是「刷一棵树」等于把草地换成树
             * （树下面没有草地），而 2×2 的建筑也只能占一格。
             */
            const ensureMapDraft = () => {
                if (mapDraft !== null)
                    return mapDraft;
                const rows = Math.max(1, mapRows);
                const cols = Math.max(1, mapCols);
                /**
                 * 没指定地面时这一格该铺什么。
                 *
                 * ⚠️ **不能留空**。老项目（以及用户曾经用手涂过树 / 建筑的那些格）里
                 * `cells` 存的可能是**装饰或建筑的键** —— 拼图那边这些格子照样铺着地面，
                 * 但界面草稿若直接丢成空串，预览里就出现一个个**白色菱形洞**，
                 * 而「开始编辑布局」打开的正是这份草稿。实测踩过：13 个 tree 格变成白洞。
                 */
                const groundFill = firstTerrainKey() ?? "";
                const ground = [];
                const decorFromCells = {};
                for (let r = 0; r < rows; r++) {
                    const row = [];
                    for (let c = 0; c < cols; c++) {
                        const key = project.map?.cells?.[r]?.[c] ?? "";
                        if (key === "") {
                            row.push("");
                            continue;
                        }
                        if (kindOf(key) === "terrain") {
                            row.push(key);
                            continue;
                        }
                        // 装饰键（老项目手涂的）：**升格成装饰** + 底下补默认地面。
                        // 只补地面会把用户涂的那棵树弄丢；只留装饰则预览里是个白洞。
                        if (kindOf(key) === "decor")
                            decorFromCells[`${r},${c}`] = key;
                        row.push(groundFill);
                    }
                    ground.push(row);
                }
                const decor = {};
                for (const [pos, entry] of Object.entries(project.preview?.decor ?? {})) {
                    const at = pos.split(",");
                    const r = Number.parseInt(at[0], 10);
                    const c = Number.parseInt(at[1], 10);
                    if (!Number.isFinite(r) || !Number.isFinite(c))
                        continue;
                    if (r >= rows || c >= cols)
                        continue;
                    // ⚠️ 草稿里存的是**地块键**（`tree`），不是贴图路径。
                    // 存路径的话后面按键查变体会查不到，装饰**一个都画不出来**，
                    // 而且不报错（实测：预览里树全丢了）。
                    const key = keyOfVariant(String(entry[1]));
                    if (key !== "")
                        decor[pos] = key;
                }
                // 从 `cells` 里升格出来的装饰（老项目手涂的树）优先于记录里的
                for (const [pos, key] of Object.entries(decorFromCells))
                    decor[pos] = key;
                const buildings = (project.preview?.buildings ?? []).map((b) => {
                    const meta = buildingMetaOf(b);
                    // 形状优先取宿主给的那份；老数据没有就按 fw/fh 兜成矩形。
                    const shape = Array.isArray(b.shape) && b.shape.length > 0
                        ? b.shape.map(([r, c]) => [Number(r), Number(c)])
                        : shapeFromRect(b.fw, b.fh);
                    return {
                        r: b.r, c: b.c, fw: b.fw, fh: b.fh, key: keyOfVariant(b.cell), under: defaultUnder(),
                        shape, ratio: meta.ratio, baseFraction: meta.baseFraction
                    };
                });
                // ★ 老数据的建筑占格是**空串**（旧版 `place()` 会把它清空）。
                // 这里补上默认地面 —— 不补的话界面会一直给它们叠那块纯色垫底
                // （真机上就是「建筑拖着塑料板」），而且用户得先手动保存一次才会好。
                for (const b of buildings) {
                    for (const [dr, dc] of b.shape) {
                        const row = ground[b.r + dr];
                        if (row === undefined)
                            continue;
                        if (row[b.c + dc] === "")
                            row[b.c + dc] = b.under !== "" ? b.under : groundFill;
                    }
                }
                const draft = { ground, decor, buildings };
                // 第一份草稿也进历史（index 0）—— 撤销到根就该看到「刚打开编辑」的样子
                commitDraft(draft);
                return draft;
            };
            /** 贴图相对路径 → 地块键（反查 `preview.cells`）。 */
            const keyOfVariant = (rel) => {
                for (const [key, list] of previewEntries()) {
                    if (list.includes(rel))
                        return key;
                }
                return "";
            };
            /** 把 `preview.cells` 规整成 `[键, 贴图数组][]`（宿主给的是 `unknown`）。 */
            const previewEntries = () => {
                const raw = project.preview?.cells ?? {};
                const out = [];
                for (const key of Object.keys(raw)) {
                    const list = raw[key];
                    if (Array.isArray(list))
                        out.push([key, list.filter((x) => typeof x === "string")]);
                }
                return out;
            };
            const kindOf = (key) => project.preview?.kinds?.[key] ?? "";
            /**
             * 某地块的**形状**（相对锚点的格子集合）。
             *
             * ⚠️ 优先读 `preview.shapes`（宿主按 `shapeOf` 统一给的）；没有才按老的
             * `footprints` 矩形兜底。**别直接按 `footprints` 铺格子** —— 那只是包围矩形，
             * L 形会多占格、点到的格子和涂到的错位。
             */
            const shapeOfKey = (key) => {
                const raw = project.preview?.shapes?.[key];
                if (Array.isArray(raw) && raw.length > 0) {
                    return raw.filter((p) => Array.isArray(p) && p.length >= 2)
                        .map((p) => [Number(p[0]), Number(p[1])]);
                }
                const [fw, fh] = project.preview?.footprints?.[key] ?? [1, 1];
                const out = [];
                for (let r = 0; r < Math.max(1, fh); r++) {
                    for (let c = 0; c < Math.max(1, fw); c++)
                        out.push([r, c]);
                }
                return out;
            };
            /** 形状的包围矩形 `[列, 行]`（只用于文案 / 兼容展示）。 */
            const footprintOf = (key) => project.preview?.footprints?.[key] ?? [1, 1];
            /** 布局里第一个有贴图的地面地块键（用来补「这格没写地面」的洞）。 */
            const firstTerrainKey = () => {
                for (const [key, list] of previewEntries()) {
                    if ((project.preview?.kinds?.[key] ?? "") === "terrain" && list.length > 0)
                        return key;
                }
                return null;
            };
            /** 建筑底面垫底用哪种地面**地块键**（不是贴图路径）。 */
            const defaultUnder = () => firstTerrainKey() ?? "";
            /**
             * 建筑贴图的「自然高 / 宽」与底面比例。
             *
             * ⚠️ **优先读草稿里那份，其次才是 `preview.buildings`**。
             * `preview` 反映的是**已保存**的布局；用户刚用笔刷放下一栋楼时，
             * 它还不在这份列表里 —— 于是包围盒只能拿默认值（ratio=1、bf=0.5）估，
             * 估出来的高度和真贴图差一截，`trimTop` 就跟着变，
             * 表现就是**整张预览在保存前后位移**（真机反馈的「房子上移一格」）。
             * 所以放下楼时要把这两个值记进草稿，量包围盒时先用它。
             */
            const buildingMetaOf = (bd) => {
                if (typeof bd?.ratio === "number" && typeof bd?.baseFraction === "number") {
                    return { ratio: bd.ratio, baseFraction: bd.baseFraction };
                }
                const found = (project.preview?.buildings ?? []).find((e) => e.r === bd?.r && e.c === bd?.c);
                return {
                    ratio: typeof found?.ratio === "number" ? found.ratio : 1,
                    baseFraction: typeof found?.baseFraction === "number" ? found.baseFraction : 0.5
                };
            };
            /** 拆楼时把占格补回它原来的垫底地面；没有就退回默认地面。 */
            const underKeyOf = (building) => building.under ?? defaultUnder();
            /** 取某栋建筑贴图的实测尺寸（没量过就返回 undefined）。 */
            const calibFor = (bd) => {
                const store = spriteCalibRef.current;
                if (store.project !== project.id) {
                    store.project = project.id;
                    store.map = {};
                }
                return store.map[`${bd.r},${bd.c}`];
            };
            /**
             * 形状的底面中心相对**锚点格中心**的偏移（叠层坐标，已乘 `scale`）。
             *
             * ⚠️ 与宿主 `tilemap.shapeBaseOffset` **逐字同构**：
             * 取 `(c−r)` 与 `(c+r)` 的极差、各自除以 2，再乘步长。
             * 别改成「各格中心平均」或「(fw−1) 那版」—— 非矩形会偏、非正方形差半格。
             */
            const shapeOffsetOf = (shape, stepX, stepY) => {
                if (!Array.isArray(shape) || shape.length === 0)
                    return { dx: 0, dy: 0 };
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (const [r, c] of shape) {
                    const x = c - r;
                    const y = c + r;
                    if (x < minX)
                        minX = x;
                    if (x > maxX)
                        maxX = x;
                    if (y < minY)
                        minY = y;
                    if (y > maxY)
                        maxY = y;
                }
                return {
                    dx: ((minX + maxX) / 2) * stepX,
                    dy: ((minY + maxY) / 2) * stepY
                };
            };
            /** 形状的包围菱形宽度（1× 像素）= x 极差 · cellW/2 + cellW。 */
            const shapeDiamondWidthOf = (shape, cellW) => {
                if (!Array.isArray(shape) || shape.length === 0)
                    return cellW;
                let minX = Infinity, maxX = -Infinity;
                for (const [r, c] of shape) {
                    const x = c - r;
                    if (x < minX)
                        minX = x;
                    if (x > maxX)
                        maxX = x;
                }
                return (maxX - minX) * (cellW / 2) + cellW;
            };
            /** 换一份草稿并记一笔历史。**所有改动草稿的地方都该走它**，否则撤销会跳步。 */
            function commitDraft(draft) {
                const h = historyRef.current;
                // 截断 redo 分支：撤销之后又画了新东西，原来那条「未来」就作废了
                h.stack = h.stack.slice(0, h.index + 1);
                h.stack.push(draft);
                // 只留最近 60 步：每步都是整份快照（14×14 也就 196 个短字符串）
                if (h.stack.length > 60)
                    h.stack = h.stack.slice(h.stack.length - 60);
                h.index = h.stack.length - 1;
                setMapDraft(draft);
            }
            const undoSave = () => {
                const h = historyRef.current;
                if (h.index <= 0)
                    return false;
                h.index -= 1;
                setMapDraft(h.stack[h.index]);
                setNotice({ kind: "info", text: T("已撤销。") });
                return true;
            };
            const redoSave = () => {
                const h = historyRef.current;
                if (h.index >= h.stack.length - 1)
                    return false;
                h.index += 1;
                setMapDraft(h.stack[h.index]);
                setNotice({ kind: "info", text: T("已重做。") });
                return true;
            };
            const canUndo = historyRef.current.index > 0;
            const canRedo = historyRef.current.index < historyRef.current.stack.length - 1;
            const draftRows = mapDraft?.ground?.length ?? 0;
            const draftCols = mapDraft?.ground?.[0]?.length ?? 0;
            /** 笔刷的用途（`terrain` / `decor` / `building`），空笔刷返回 `""`。 */
            const brushKind = () => brushKey === null || brushKey === "__erase__" ? "" : kindOf(brushKey);
            /** 建筑笔刷的**形状**。非建筑笔刷恒为单格。 */
            const brushShape = () => {
                if (brushKind() !== "building" || brushKey === null)
                    return [[0, 0]];
                return shapeOfKey(brushKey);
            };
            /** 形状的包围矩形（只用于文案）。 */
            const shapeBounds = (shape) => {
                let fw = 1;
                let fh = 1;
                for (const [r, c] of shape) {
                    if (c + 1 > fw)
                        fw = c + 1;
                    if (r + 1 > fh)
                        fh = r + 1;
                }
                return [fw, fh];
            };
            /** 建筑笔刷的占格（包围矩形）。非建筑笔刷恒为 `[1, 1]`。 */
            const brushFootprint = () => {
                if (brushKind() !== "building" || brushKey === null)
                    return [1, 1];
                return footprintOf(brushKey);
            };
            /**
             * 落点校验 —— 红警盖房子那套：**先看能不能放，再决定画成绿的还是红的**。
             *
             * 不校验直接放的话，拼图会在放置阶段把它跳过 ——
             * 界面上看着楼在那儿，出图却没有（预览与成品对不上，用户会以为丢东西）。
             *
             * ⚠️ 越界要按**形状的每个格子**判，不能只看包围矩形：
             * L 形的包围矩形可能超出地图、但它真正的格子都还在里面。
             */
            const placementOk = (r, c) => {
                const draft = ensureMapDraft();
                const shape = brushShape();
                const [fw, fh] = shapeBounds(shape);
                const rows = draft.ground.length;
                const cols = draft.ground[0]?.length ?? 0;
                if (!Number.isFinite(r) || !Number.isFinite(c))
                    return { ok: false, reason: T("超出地图范围") };
                const outside = shape.some(([dr, dc]) => r + dr < 0 || c + dc < 0 || r + dr >= rows || c + dc >= cols);
                if (outside) {
                    return { ok: false, reason: T("放不下：占 {n0}×{n1} 格，这里会超出边界", { n0: fw, n1: fh }) };
                }
                if (brushKind() === "building") {
                    // 压到别的建筑：按**格子集合**判，包围矩形相交不算数
                    const mine = new Set(shape.map(([dr, dc]) => `${r + dr},${c + dc}`));
                    const clash = draft.buildings.find((b) => {
                        const bShape = shapeFromDraftBuilding(b);
                        return bShape.some(([dr, dc]) => mine.has(`${b.r + dr},${b.c + dc}`));
                    });
                    if (clash !== undefined) {
                        return { ok: false, reason: T("放不下：会压到 ({n0},{n1}) 那栋建筑", { n0: clash.r, n1: clash.c }) };
                    }
                }
                return { ok: true, reason: "" };
            };
            /** 草稿里某栋建筑的形状（新版直接带 `shape`，老数据按 fw/fh 兜底）。 */
            const shapeFromDraftBuilding = (b) => {
                if (Array.isArray(b?.shape) && b.shape.length > 0)
                    return b.shape;
                const out = [];
                for (let r = 0; r < Math.max(1, b?.fh ?? 1); r++) {
                    for (let c = 0; c < Math.max(1, b?.fw ?? 1); c++)
                        out.push([r, c]);
                }
                return out;
            };
            /** 占格里的所有格子（放预览高亮用）。按**形状**取，不是包围矩形。 */
            const footprintCells = (r, c) => brushShape().map(([dr, dc]) => `${r + dr},${c + dc}`);
            /**
             * 拆掉压在 (r,c) 上的建筑。返回**是否拆掉了**。
             *
             * ⚠️ 这是「大格子铺了之后清不掉」的正解：用户拿地面/装饰笔刷去点一栋楼时，
             * 期望的是**把那块地方收回来**，而不是在地基下面偷偷改草地（楼还杵在那儿，
             * 看着就像「清不掉」）。所以任何笔刷点到建筑占格，都先把那栋楼拆掉。
             */
            const liftBuildingAt = (r, c, ground, decor) => {
                const draft = ensureMapDraft();
                // 按**形状的格子集合**判命中，不能按包围矩形 —— L 形的凹口不属于它，
                // 在凹口上涂地面不该把那栋楼拆掉。
                const hit = draft.buildings.filter((b) => shapeFromDraftBuilding(b).some(([dr, dc]) => b.r + dr === r && b.c + dc === c));
                for (const b of hit) {
                    // 占格补回默认草地，否则拆完留下一个洞
                    for (const [dr, dc] of shapeFromDraftBuilding(b)) {
                        if (ground[b.r + dr]?.[b.c + dc] !== undefined)
                            ground[b.r + dr][b.c + dc] = underKeyOf(b);
                        delete decor[`${b.r + dr},${b.c + dc}`];
                    }
                }
                return { hit, rest: draft.buildings.filter((b) => !hit.includes(b)) };
            };
            /**
             * 涂一格。按笔刷的**用途**决定写哪一层 —— 这是「树下面有草地」和
             * 「2×2 建筑占 2×2 格」的关键。
             */
            const paint = (r, c, key) => {
                const draft = ensureMapDraft();
                const ground = draft.ground.map((row) => [...row]);
                const decor = { ...draft.decor };
                if (ground[r] === undefined || ground[r][c] === undefined)
                    return;
                // 橡皮擦：把这一格**彻底清干净**。压在这儿的建筑整块拆掉（红警里拆楼）。
                if (key === "") {
                    const { rest } = liftBuildingAt(r, c, ground, decor);
                    ground[r][c] = "";
                    delete decor[`${r},${c}`];
                    commitDraft({ ground, decor, buildings: rest });
                    setCellKey(`${r},${c}`);
                    return;
                }
                const kind = kindOf(key);
                if (kind === "decor") {
                    // 装饰只动装饰层：草地原样留着。
                    // ⚠️ 存的是**地块键**（`tree`），不是贴图路径 —— 宿主按 key#index 查变体，
                    // 存路径的话两份数据对不上，重载后装饰会静默消失。
                    const { rest } = liftBuildingAt(r, c, ground, decor);
                    decor[`${r},${c}`] = key;
                    commitDraft({ ground, decor, buildings: rest });
                }
                else if (kind === "building") {
                    const verdict = placementOk(r, c);
                    if (!verdict.ok) {
                        setNotice({ kind: "error", text: verdict.reason });
                        return;
                    }
                    const shape = brushShape();
                    const [fw, fh] = shapeBounds(shape);
                    const mine = new Set(shape.map(([dr, dc]) => `${r + dr},${c + dc}`));
                    // 先拆掉压在占格上的旧楼（同一块地重放 = 换一栋）。
                    // ⚠️ 按**格子集合**判重叠：包围矩形相交不算数（L 形能塞进凹口）。
                    let buildings = draft.buildings.filter((b) => !shapeFromDraftBuilding(b).some(([dr, dc]) => mine.has(`${b.r + dr},${b.c + dc}`)));
                    const under = defaultUnder();
                    // ★ 把**贴图的自然高宽比与底面比例**一起记进草稿。
                    //
                    // 量包围盒要用它们。只在 `preview.buildings` 里查是不够的 ——
                    // 那份反映的是**已保存**的布局，刚放下的这栋还没进去，
                    // 于是包围盒拿默认值估，`trimTop` 与保存后不一致，整张预览就位移。
                    const meta = buildingMetaOf({ r, c });
                    buildings = [...buildings, {
                            r, c, fw, fh, key, under, shape,
                            ratio: meta.ratio, baseFraction: meta.baseFraction
                        }];
                    // 占格铺**真实地面**（不是清空）。
                    //
                    // 清空的话这一格什么都不铺，建筑底面菱形的四个角是透明的，露出来的
                    // 就是那块纯色垫底 —— 和周围有纹理的草地格格不入（看着像拖了块塑料板）。
                    // 铺上地面之后建筑贴图盖上去，边角自然和草地接上。宿主 `place()` 同口径。
                    for (const [dr, dc] of shape) {
                        if (ground[r + dr]?.[c + dc] !== undefined)
                            ground[r + dr][c + dc] = under;
                        delete decor[`${r + dr},${c + dc}`];
                    }
                    commitDraft({ ground, decor, buildings });
                }
                else {
                    // 地面（含未知键）：只动地面层；压在建筑上的话先把楼收回来
                    const { rest } = liftBuildingAt(r, c, ground, decor);
                    ground[r][c] = key;
                    delete decor[`${r},${c}`];
                    commitDraft({ ground, decor, buildings: rest });
                }
                setCellKey(`${r},${c}`);
            };
            /** 按草稿尺寸重建布局（改行 / 列时用）。**保留已有内容**，只裁 / 扩。 */
            const resizeDraft = (rows, cols) => {
                const current = mapDraft ?? ensureMapDraft();
                const ground = [];
                for (let r = 0; r < rows; r++) {
                    const row = [];
                    for (let c = 0; c < cols; c++)
                        row.push(current.ground?.[r]?.[c] ?? "");
                    ground.push(row);
                }
                const decor = {};
                for (const [pos, rel] of Object.entries(current.decor ?? {})) {
                    const at = pos.split(",");
                    const r = Number.parseInt(at[0], 10);
                    const c = Number.parseInt(at[1], 10);
                    if (r < rows && c < cols)
                        decor[pos] = rel;
                }
                // 超出新边界的建筑丢掉（留着会让拼图跳过它，预览与出图就不一致了）
                const buildings = (current.buildings ?? []).filter((b) => b.r + b.fh <= rows && b.c + b.fw <= cols);
                commitDraft({ ground, decor, buildings });
            };
            const saveMapDraft = async () => {
                const draft = mapDraft;
                if (draft === null)
                    return;
                await api.saveTileMapCells({
                    projectId: project.id,
                    cells: draft.ground,
                    seed: mapSeed,
                    decor: draft.decor,
                    layouts: draft.buildings.map((b) => ({
                        r: b.r, c: b.c, width: b.fw, height: b.fh, key: b.key, under: b.under,
                        // ★ 形状要一起回传：宿主按它铺占格 / 拼图，只给宽高会退化成矩形
                        // （L 形会被当成 2×2 的方块铺满）。
                        shape: shapeFromDraftBuilding(b)
                    }))
                });
                setNotice({ kind: "info", text: T("布局已保存。点「铺成地图」重新出图。") });
            };
            /**
             * 把**地面层**整片刷成指定类别（「全刷成当前笔刷」/「全部清空」）。
             *
             * 只动地面：刷满草地不该顺手把装饰和建筑抹掉（那是用户另外摆的东西）。
             * 只有「全部清空」才三层一起清。
             */
            const fillDraft = (key) => {
                const rows = Math.max(1, mapRows);
                const cols = Math.max(1, mapCols);
                const current = mapDraft ?? ensureMapDraft();
                const ground = [];
                for (let r = 0; r < rows; r++) {
                    const row = [];
                    for (let c = 0; c < cols; c++)
                        row.push(key);
                    ground.push(row);
                }
                commitDraft({
                    ground,
                    decor: key === "" ? {} : { ...current.decor },
                    buildings: key === "" ? [] : current.buildings
                });
            };
            /** 预览里叠一层可点的格子。用 CSS 等距定位，跟拼图用的是同一套步长。 */
            const mapCellGrid = () => {
                if (mapDraft === null)
                    return null;
                const cw = project.settings?.cellWidth ?? 64;
                const ch = project.settings?.cellHeight ?? 96;
                const rows = mapDraft.ground.length;
                const cols = mapDraft.ground[0]?.length ?? 0;
                // 拼图放大 2 倍交付（见宿主 runMapStage 的 upscale），预览图也是放大后的，
                // 所以叠层也要 ×2。这里的公式与宿主 `tileLayout` / `tileOriginAt`
                // （src/tilemap.ts）**逐字对应** —— 浏览器半区不能 import 宿主代码，
                // 一致性由 verify-tile-client.mjs 断言（它拿宿主的 tileOriginAt 比对同一组坐标）。
                const scale = 2;
                const stepX = (cw / 2) * scale;
                const stepY = (cw / 4) * scale; // 菱形高 / 2 = cellWidth / 4，不是 cellHeight / 4
                const originX = (rows - 1) * stepX;
                const originY = ch * scale; // 最上面那格的上方留一个单元格高
                // ── 裁剪矩形：与宿主 `measureAssemblyBounds` **逐字同构** ──────────
                //
                // ⚠️ 别再依赖 `project.map.pixel` 来对齐。它是宿主机算出来的**缓存**，
                // 只在拼图那一刻正确；用户一涂改（尤其放/挪一栋高过一格建筑）布局就变了，
                // 而缓存还是旧的 —— 于是叠层与预览图错位，表现就是
                // 「保存后房子上移一格」「点到的格子和涂到的不是同一格」。
                //
                // 现在两边用同一个**几何公式**各算一遍：宿主拿它裁剪并上报，
                // 界面拿它对齐。公式只跟网格与「哪些格有地面/装饰/建筑」有关，
                // 是当前草稿的纯函数，所以永远同步。
                const groundInset = Math.round(ch / 3); // 地面菱形在单元格里的上边距（1×）
                const diamondH = Math.round(cw / 2); // 菱形高（1×）
                let bLeft = Infinity, bTop = Infinity, bRight = -Infinity, bBottom = -Infinity;
                const putBox = (x, y, w, h) => {
                    if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0)
                        return;
                    if (x < bLeft)
                        bLeft = x;
                    if (y < bTop)
                        bTop = y;
                    if (x + w > bRight)
                        bRight = x + w;
                    if (y + h > bBottom)
                        bBottom = y + h;
                };
                const occByBuilding = new Map();
                for (const bd of mapDraft.buildings) {
                    for (const [dr, dc] of shapeFromDraftBuilding(bd)) {
                        occByBuilding.set(`${bd.r + dr},${bd.c + dc}`, bd);
                    }
                }
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const ox = originX + (c - r) * stepX; // 交付尺寸（2×）
                        const oy = originY + (c + r) * stepY;
                        const key = mapDraft.ground[r]?.[c] ?? "";
                        if (key !== "") {
                            const insetX = ((cw - diamondH * 2) / 2) * scale;
                            putBox(ox - insetX, oy + groundInset * scale, cw * scale, diamondH * scale);
                        }
                        const dec = mapDraft.decor[`${r},${c}`];
                        if (typeof dec === "string" && dec !== "" && !occByBuilding.has(`${r},${c}`)) {
                            putBox(ox, oy, cw * scale, ch * scale);
                        }
                    }
                }
                for (const bd of mapDraft.buildings) {
                    const bShape = shapeFromDraftBuilding(bd);
                    const ox = originX + (bd.c - bd.r) * stepX;
                    const oy = originY + (bd.c + bd.r) * stepY;
                    // ★ 底心与包围菱形都按**形状**算，与宿主 `shapeBaseOffset` /
                    // `shapeDiamondHalf` 同一条公式（浏览器半区不能 import 宿主代码）。
                    // ⚠️ 别用 `((fw−1)·stepX)/2` 那版：非正方形会差半格，L 形差更多。
                    const bOff = shapeOffsetOf(bShape, stepX, stepY);
                    const baseX = ox + (cw * scale) / 2 + bOff.dx;
                    const baseY = oy + (ch * scale) / 2 + bOff.dy;
                    const info = buildingMetaOf(bd);
                    const w = shapeDiamondWidthOf(bShape, cw) * scale;
                    // ★ 优先用**实测**尺寸（贴图加载过就有了），没有才用比例估。
                    // 这是「保存前后不跳」的关键：宿主量的是真贴图，界面必须也对齐真贴图。
                    const calib = calibFor(bd);
                    const naturalW = calib?.naturalW ?? 0;
                    const naturalH = calib?.naturalH ?? 0;
                    const hgt = Math.max(1, Math.round(naturalH > 0 ? (w * naturalH) / naturalW : w * info.ratio));
                    const bf = info.baseFraction;
                    putBox(Math.round(baseX - w / 2), Math.round(baseY - bf * hgt), w, hgt);
                    // 垫底：**逐格**（与宿主 `assembleMap` 同口径）。
                    // 画一个大菱形会把 L 形的凹口也涂上。
                    // ⚠️ 单格菱形**半宽 = cellW/2**（整格宽），写成 cellW/4 就只算了一半，
                    // 包围盒会偏小、裁剪时切掉边缘。
                    const cellHalfW = (cw / 2) * scale;
                    const cellHalfH = cellHalfW / 2;
                    for (const [dr, dc] of bShape) {
                        const cx2 = ox + (cw * scale) / 2 + (dc - dr) * stepX;
                        const cy2 = oy + (ch * scale) / 2 + (dc + dr) * stepY;
                        putBox(Math.ceil(cx2 - cellHalfW), Math.floor(cy2 - cellHalfH), Math.floor(cx2 + cellHalfW) - Math.ceil(cx2 - cellHalfW) + 1, Math.ceil(cy2 + cellHalfH) - Math.floor(cy2 - cellHalfH) + 1);
                    }
                }
                const hasBounds = Number.isFinite(bLeft) && bRight > bLeft && bBottom > bTop;
                const trimLeft = hasBounds ? Math.floor(bLeft) : 0;
                const trimTop = hasBounds ? Math.floor(bTop) : 0;
                const canvasW = hasBounds ? Math.ceil(bRight) - trimLeft : Math.ceil((cols + rows) * stepX + cw * scale);
                const canvasH = hasBounds ? Math.ceil(bBottom) - trimTop : Math.ceil((rows + cols) * stepY + ch * 2 * scale);
                // 缩放到容器宽度：叠层是「交付尺寸」（2 倍），14×14 有 1792px 宽，
                // 不缩放就只能看见左上角。上限 1（不放大），下限 0.1（极端大地图也别缩成点）。
                const fit = Math.max(0.1, Math.min(1, 900 / canvasW));
                const fitW = Math.round(canvasW * fit);
                const fitH = Math.round(canvasH * fit);
                /**
                 * 即时预览：把「地面 → 装饰 → 建筑」三层按等距位置摆上去，
                 * 顺序与宿主 `assembleMap` 一致（远的先画、近的盖住远的）。
                 *
                 * 三层都读**草稿**（不是成品），所以涂一格立刻变；
                 * 而草稿本身是从成品加载来的，所以刚点开看到的就是刚才那张图。
                 * 变体下标用与宿主**同一个** `pickVariantIndex`（位置 + 种子），
                 * 所以预览挑到的变体和出图完全一样。
                 */
                const pv = project.preview ?? {};
                const pvCells = pv.cells ?? {};
                const seed = typeof mapSeed === "number" ? mapSeed : (project.map?.seed ?? 0);
                const artUrl = (rel) => `${project.assetBase}${rel}?v=${encodeURIComponent(project.updatedAt ?? "")}`;
                /** 与宿主 `tilemap.pickVariantIndex` 逐字同构（浏览器半区不能 import 宿主代码）。 */
                const pickVariantIndex = (s, r, c, count) => {
                    if (count <= 1)
                        return 0;
                    let h = (s ^ 0x9e3779b9) >>> 0;
                    h = Math.imul(h ^ (r + 0x85ebca6b), 0xc2b2ae35) >>> 0;
                    h = Math.imul(h ^ (c + 0x27d4eb2f), 0x165667b1) >>> 0;
                    h = (h ^ (h >>> 15)) >>> 0;
                    return h % count;
                };
                /**
                 * 装饰的地面线（1× 像素）—— 与宿主 `tilegeom.decorAnchorY` **同一公式**：
                 * `round(cellHeight/2 + diamondHeight/2 − diamondHeight/4 − 2)`，
                 * 其中 `diamondHeight = cellWidth/2`。64×96 → 54。
                 */
                const decorAnchor = Math.round(ch / 2 + cw / 4 - cw / 8 - 2);
                const variantArt = (key, r, c) => {
                    const list = pvCells[key];
                    if (list === undefined || list.length === 0)
                        return null;
                    return list[pickVariantIndex(seed, r, c, list.length)];
                };
                const under = [];
                const layers = [];
                const decor = [];
                const builds = [];
                const cells = [];
                // 建筑底面的垫底。
                //
                // ⚠️ 只在占格地面**没铺满**时才需要它：占格现在铺着真地面，
                // 底面菱形的四角由邻格的草地盖住，再叠一块裁成菱形的贴图反而会在
                // 草地上压出一个边界硬朗的菱形（原来那块「塑料板」就是这么来的）。
                // 所以逐格检查：谁缺地面，就给它垫一块。
                const groundCovered = new Set();
                for (const b of mapDraft.buildings) {
                    for (let dr = 0; dr < b.fh; dr++) {
                        for (let dc = 0; dc < b.fw; dc++) {
                            const key = mapDraft.ground[b.r + dr]?.[b.c + dc];
                            if (typeof key === "string" && key !== "")
                                groundCovered.add(`${b.r + dr},${b.c + dc}`);
                        }
                    }
                }
                for (const b of mapDraft.buildings) {
                    const missing = [];
                    for (const [dr, dc] of shapeFromDraftBuilding(b)) {
                        if (!groundCovered.has(`${b.r + dr},${b.c + dc}`))
                            missing.push(`${b.r + dr},${b.c + dc}`);
                    }
                    if (missing.length === 0 || b.under === "")
                        continue;
                    const x = Math.round(originX + (b.c - b.r) * stepX) - trimLeft;
                    const y = Math.round(originY + (b.c + b.r) * stepY) - trimTop;
                    const bShape = shapeFromDraftBuilding(b);
                    const w = shapeDiamondWidthOf(bShape, cw) * scale;
                    const hh = w / 2;
                    // 占格菱形的中心 —— 建筑贴图的底面落在这里，垫底也要跟着落在这里。
                    // 用锚点格中心的话垫底会往左上偏半格，建筑看着像浮在半空。
                    const bOff = shapeOffsetOf(bShape, stepX, stepY);
                    const baseX = x + (cw * scale) / 2 + bOff.dx;
                    const baseY = y + (ch * scale) / 2 + bOff.dy;
                    // 垫底的草贴图：先按地块键查第一张（草通常只有一个变体）
                    const underArt = (project.preview?.cells?.[b.under] ?? [])[0] ?? b.under;
                    under.push(h("img", {
                        key: `u${b.r},${b.c}`,
                        className: "SPR_mapArt SPR_mapUnder",
                        src: artUrl(underArt),
                        alt: `under ${b.r},${b.c}`,
                        style: {
                            left: `${baseX - w / 2}px`,
                            top: `${baseY - hh / 2}px`,
                            width: `${w}px`, height: `${hh}px`,
                            clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"
                        }
                    }));
                }
                // 被建筑占掉的格子不画地面（与宿主口径一致：建筑单独 blit）
                const occupiedByBuilding = new Set();
                for (const b of mapDraft.buildings) {
                    for (let dr = 0; dr < b.fh; dr++) {
                        for (let dc = 0; dc < b.fw; dc++)
                            occupiedByBuilding.add(`${b.r + dr},${b.c + dc}`);
                    }
                }
                // ── 幽灵预览的几何：光标格 + 笔刷占格 + 落点校验 ──────────────
                const ghostCells = new Set(); // 元素是 "r,c"
                let ghostOk = true;
                let ghostReason = "";
                if (hoverCell !== null) {
                    const at = hoverCell.split(",");
                    const hr = Number(at[0]);
                    const hc = Number(at[1]);
                    const verdict = placementOk(hr, hc);
                    ghostOk = verdict.ok;
                    ghostReason = verdict.reason;
                    for (const cell of footprintCells(hr, hc))
                        ghostCells.add(cell);
                }
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const key = mapDraft.ground[r][c];
                        const x = Math.round(originX + (c - r) * stepX) - trimLeft;
                        const y = Math.round(originY + (c + r) * stepY) - trimTop;
                        const occupied = occupiedByBuilding.has(`${r},${c}`);
                        // ⚠️ 建筑占格**照画地面**（不再因为 occupied 就跳过）。
                        // 宿主 `place()` 现在也把占格铺回默认地面，两边必须一致：
                        // 占格空着的话建筑底面菱形的四个角会露出纯色垫底，
                        // 和周围有纹理的草地格格不入。
                        const art = key === "" ? null : variantArt(key, r, c);
                        if (art !== null) {
                            layers.push(h("img", {
                                key: `a${r},${c}`,
                                className: "SPR_mapArt",
                                src: artUrl(art),
                                alt: `${r},${c} ${key}`,
                                style: { left: `${x}px`, top: `${y}px`, width: `${cw * scale}px`, height: `${ch * scale}px` }
                            }));
                        }
                        // 装饰：与地面**独立**的一层，所以树下面照样有草地。
                        //
                        // ⚠️ 装饰贴图是**整格画布**（`cellWidth × cellHeight`），不是「一张树的图」。
                        // 宿主 `regularizeDecorSprite` 已经把它**居中 + 落地**地合成进那一格了：
                        //   `left = round(cellW/2 − 贴图宽/2)`、`top = decorAnchorY − 贴图高`
                        // 所以宿主 `assembleMap` 只需 `blit(sprite, cellX, cellY)` —— 直接贴整格。
                        //
                        // 界面必须**同样直接贴整格、绝不再居中一次**：
                        // 再加 `translateX(-50%)` 就是把已经居中的内容又左移半格，整排装饰偏出去。
                        //
                        // 这里错过两次，方向相反，判据只有一条 ——
                        // **贴图铺满整格，左上角对齐格子左上角**：
                        //   · 锚点写成「格子底边」→ 整排往上升；
                        //   · 以为要自己居中 → 加了 `translateX(-50%)` → 整排左移半格。
                        const decKey = mapDraft.decor[`${r},${c}`];
                        if (typeof decKey === "string" && decKey !== "" && !occupied) {
                            const decArt = variantArt(decKey, r, c);
                            if (decArt !== null) {
                                decor.push(h("img", {
                                    key: `d${r},${c}`,
                                    className: "SPR_mapDecor",
                                    src: artUrl(decArt),
                                    alt: `decor ${r},${c}`,
                                    style: {
                                        left: `${x}px`, top: `${y}px`,
                                        width: `${cw * scale}px`, height: `${ch * scale}px`
                                    }
                                }));
                            }
                        }
                        cells.push(h("button", {
                            key: `${r},${c}`,
                            type: "button",
                            className: `SPR_mapCell${key === "" ? " SPR_mapCell-empty" : ""}${cellKey === `${r},${c}` ? " SPR_mapCell-active" : ""}${ghostCells.has(`${r},${c}`) ? (ghostOk ? " SPR_mapCell-ghostOk" : " SPR_mapCell-ghostBad") : ""}`,
                            style: {
                                left: `${x}px`, top: `${y}px`,
                                width: `${cw * scale}px`, height: `${ch * scale}px`,
                                // 只让菱形那部分可点：菱形在单元格里位于 y ∈ [1/3, 2/3]
                                clipPath: "polygon(50% 33.3%, 100% 50%, 50% 66.7%, 0% 50%)"
                            },
                            title: ghostCells.has(`${r},${c}`) && !ghostOk
                                ? `${r},${c} · ${ghostReason}`
                                : `${r},${c} · ${key === "" ? T("空格") : key}`,
                            onMouseEnter: () => setHoverCell(`${r},${c}`),
                            onFocus: () => setHoverCell(`${r},${c}`),
                            onClick: () => paint(r, c, brushKey === "__erase__" ? "" : (brushKey ?? ""))
                        }, h("span", { className: "SPR_mapCellLabel" }, key === "" ? "" : key.slice(0, 4))));
                    }
                }
                // ★ 红警盖房子那种「幽灵预览」：光标停在哪，就把**整块占格**画出来。
                //
                // 只高亮一格时，选了 2×2 建筑的用户根本不知道这一下会盖多大一片。
                // 能放画绿、不能放画红（越界 / 压到别的建筑），并在格子的 title 里写明原因。
                //
                // ⚠️ 只画占格那几块（`ghostCells`），**不要另画一圈外框** ——
                // 两者会叠在同一个容器里越堆越多（实测同一批格子被画了 5 遍，
                // 并且因为共用 `builds` 还被当成建筑重复了一遍）。
                const ghost = [];
                if (ghostCells.size > 0) {
                    ghost.push(h("div", {
                        key: "ghost",
                        className: `SPR_mapGhost${ghostOk ? " SPR_mapGhost-ok" : " SPR_mapGhost-bad"}`,
                        style: { left: "0px", top: "0px", width: `${canvasW}px`, height: `${canvasH}px` }
                    }, ...Array.from(ghostCells, (cell) => {
                        const at = cell.split(",");
                        const gr = Number(at[0]);
                        const gc = Number(at[1]);
                        return h("div", {
                            key: `g${cell}`,
                            className: "SPR_mapGhostCell",
                            style: {
                                left: `${Math.round(originX + (gc - gr) * stepX) - trimLeft}px`,
                                top: `${Math.round(originY + (gc + gr) * stepY) - trimTop}px`,
                                width: `${cw * scale}px`, height: `${ch * scale}px`
                            }
                        });
                    })));
                }
                // ★ 跨格建筑：按**占格**摆，不是按一格。
                // 以前预览把建筑当 1×1 地块画，所以「本应该 2×2 的房屋只占一格」。
                //
                // 尺寸要靠图片的**自然宽高**才知道（宿主没传，传了也要靠 JS 算），
                // 这里交给浏览器：图片按目标底面宽 / 自然宽 做 `scale`，
                // 再按 `baseFraction` 把底面中心对到锚点格中心 —— 这正是宿主
                // `regularizeBuilding` + `assembleMap` 那两步的 CSS 等价写法。
                const buildWidth = (shape) => shapeDiamondWidthOf(shape, cw) * scale;
                for (const b of mapDraft.buildings) {
                    const x = Math.round(originX + (b.c - b.r) * stepX) - trimLeft;
                    const y = Math.round(originY + (b.c + b.r) * stepY) - trimTop;
                    const bShape = shapeFromDraftBuilding(b);
                    // 底面中心 = **形状的包围菱形**中心（不是锚点格中心，2×2 时差半格）
                    const bOff = shapeOffsetOf(bShape, stepX, stepY);
                    const anchorX = x + (cw * scale) / 2 + bOff.dx;
                    const anchorY2 = y + (ch * scale) / 2 + bOff.dy;
                    const art = variantArt(b.key, b.r, b.c);
                    if (art === null)
                        continue;
                    const bf = buildingMetaOf(b).baseFraction;
                    builds.push(h("div", {
                        key: `b${b.r},${b.c}`,
                        className: "SPR_mapBuild",
                        style: { left: "0px", top: "0px", width: `${canvasW}px`, height: `${canvasH}px` }
                    }, h("img", {
                        className: "SPR_mapBuildImg",
                        src: artUrl(art),
                        alt: `building ${b.r},${b.c}`,
                        // 让标定用的 effect 能按位置找回这张图（量它的真实尺寸）
                        "data-sprite": `${b.r},${b.c}`,
                        "data-w": String(buildWidth(bShape)),
                        "data-bx": String(anchorX),
                        "data-by": String(anchorY2),
                        "data-bf": String(typeof bf === "number" ? bf : 0.5),
                        "data-cw": String(cw * scale),
                        ref: (el) => {
                            if (el === null)
                                return;
                            const fit = () => {
                                const nw = el.naturalWidth || 1;
                                const nh = el.naturalHeight || 1;
                                const bf = Number(el.dataset.bf) || 0.5;
                                const k = (Number(el.dataset.w) || nw) / nw;
                                // transform-origin 设在「底面中心」：缩放时底面中心不动，
                                // 于是只要把左上角摆到「底面中心 − 底面中心在贴图里的偏移」即可。
                                el.style.transformOrigin = `${nw / 2}px ${bf * nh}px`;
                                el.style.transform = `scale(${k})`;
                                el.style.left = `${(Number(el.dataset.bx) || 0) - nw / 2}px`;
                                el.style.top = `${(Number(el.dataset.by) || 0) - bf * nh}px`;
                            };
                            if (el.complete)
                                fit();
                            else
                                el.addEventListener("load", fit, { once: true });
                        }
                    })));
                }
                return h("div", { className: "SPR_mapEditorWrap" }, h("p", { className: "SPR_muted" }, T("下面的预览就是当前草稿：涂一格立刻变，不用先保存。")), 
                // 等比缩放到容器宽度，让整张图一眼看得见。
                // 不缩放的话 14×14 的叠层宽 1792px，只能看见左上角一小块 ——
                // 「拼的时候就能预览」也就无从谈起。
                h("div", {
                    className: "SPR_mapEditorFit",
                    style: { width: `${fitW}px`, height: `${fitH}px` }
                }, h("div", {
                    className: "SPR_mapEditorScaler",
                    style: { width: `${canvasW}px`, height: `${canvasH}px`, transform: `scale(${fit})` }
                }, h("div", {
                    className: "SPR_mapEditorCanvas",
                    style: { width: `${canvasW}px`, height: `${canvasH}px` },
                    // 光标移出画布就收起幽灵预览（否则它一直挂在最后停的那一格）
                    onMouseLeave: () => setHoverCell(null),
                    /**
                     * 滚轮切笔刷 —— 地图编辑器的老习惯：手不用离开地图就能换笔。
                     * `deltaY < 0`（向上滚）往前进一格，向下滚往后退。
                     * **只有按住 Ctrl 才接管**：普通滚动要留给页面本身，否则用户
                     * 想上下翻面板却被吞掉，体验更差。
                     */
                    onWheel: (event) => {
                        if (!event.ctrlKey)
                            return;
                        const list = ["__erase__", ...project.items.map((it) => it.key)];
                        if (list.length === 0)
                            return;
                        const at = list.indexOf(brushKey);
                        const step = event.deltaY > 0 ? -1 : 1;
                        const next = list[(at + step + list.length) % list.length];
                        event.preventDefault();
                        setBrushKey(next);
                    }
                }, under, layers, decor, builds, ghost, cells))));
            };
            const mapStage = h("div", { className: "SPR_tileStage" }, h("p", { className: "SPR_hint" }, T("铺图全在本地：按等距网格铺、按类别随机抽变体、按 (r+c) 顺序遮挡。同种子 + 同布局 = 逐像素一致。也可以手动改：挑一个地块当笔刷，点格子涂上去。")), h("div", { className: "SPR_row" }, numberField(T("行"), mapRows, (next) => { setMapRows(next); resizeDraft(next, mapCols); }, 1, 64, 1), numberField(T("列"), mapCols, (next) => { setMapCols(next); resizeDraft(mapRows, next); }, 1, 64, 1), numberField(T("种子"), mapSeed, setMapSeed, 0, 999999999, 1), numberField(T("装饰密度"), decorDensity, setDecorDensity, 0, 1, 0.01)), h("div", { className: "SPR_row" }, h(BusyBtn, {
                busy: busy,
                className: "SPR_btn SPR_btn-primary",
                onClick: () => void run(T("拼图"), () => api.runTileMap({
                    projectId: project.id, rows: mapRows, cols: mapCols, seed: mapSeed,
                    fill: project.items[0]?.key ?? "grass", decorDensity
                }))
            }, T("铺成地图（免费）")), h(BusyBtn, {
                busy: busy,
                className: "SPR_btn",
                onClick: () => void run(T("换种子"), () => api.runTileMap({
                    projectId: project.id, rows: mapRows, cols: mapCols,
                    seed: Math.floor(Math.random() * 1000000),
                    fill: project.items[0]?.key ?? "grass", decorDensity
                }))
            }, T("换个种子重铺"))), 
            // ── 手动编辑布局 ────────────────────────────────────────────────
            h("div", { className: "SPR_tileEditor" }, h("div", { className: "SPR_tileEditorRow" }, h("span", { className: "SPR_fieldLabel" }, T("笔刷（点格子刷上去）")), h("div", { className: "SPR_mapBrush" }, 
            // 按用途分组：点「地面」只换草皮、点「装饰」是**加**一棵树（草地还在）、
            // 点「建筑」按它的占格整块放下。混在一起会让用户以为刷树会把草顶掉。
            ...["terrain", "decor", "building"].map((kind) => h("span", { key: kind, className: "SPR_mapBrushGroup" }, h("span", { className: "SPR_mapBrushLabel" }, kind === "terrain" ? T("地面") : kind === "decor" ? T("装饰") : T("建筑")), ...project.items.filter((item) => item.kind === kind).map((item) => h("button", {
                key: item.key,
                type: "button",
                className: `SPR_btn SPR_btn-mini${brushKey === item.key ? " SPR_btn-on" : ""}`,
                onClick: () => setBrushKey(item.key),
                title: kind === "building"
                    ? T("{n0} · 占 {n1}×{n2} 格", { n0: item.key, n1: item.footprint[0], n2: item.footprint[1] })
                    : `${item.key} · ${item.family}`
            }, item.label)))), h("button", {
                type: "button",
                className: `SPR_btn SPR_btn-mini${brushKey === "__erase__" ? " SPR_btn-on" : ""}`,
                onClick: () => setBrushKey("__erase__")
            }, T("橡皮擦")))), mapDraft === null
                ? h("div", { className: "SPR_row" }, h("button", { type: "button", className: "SPR_btn", onClick: () => { ensureMapDraft(); setNotice({ kind: "info", text: T("已取出当前布局，开始涂改（改完点「保存布局」）") }); } }, T("开始编辑布局")))
                : h("div", { className: "SPR_tileEditorRow" }, h("button", { type: "button", className: "SPR_btn", disabled: !canUndo, onClick: () => undoSave() }, T("撤销")), h("button", { type: "button", className: "SPR_btn", disabled: !canRedo, onClick: () => redoSave() }, T("重做")), h("button", { type: "button", className: "SPR_btn", onClick: () => fillDraft(brushKey === "__erase__" ? "" : (brushKey ?? "")) }, T("全刷成当前笔刷")), h("button", { type: "button", className: "SPR_btn", onClick: () => fillDraft("") }, T("全部清空")), h("button", { type: "button", className: "SPR_btn SPR_btn-primary", onClick: () => void run(T("保存布局"), saveMapDraft) }, T("保存布局")), h("button", { type: "button", className: "SPR_btn", onClick: () => { setMapDraft(null); setCellKey(null); setHoverCell(null); } }, T("放弃修改")), h("span", { className: "SPR_muted" }, cellKey === null
                    ? T("共 {n0} 行 × {n1} 列", { n0: draftRows, n1: draftCols })
                    : T("正在编辑 {n0} · 当前是「{n1}」", {
                        n0: cellKey,
                        n1: (() => {
                            const at = cellKey.split(",");
                            const key = mapDraft.ground?.[Number(at[0])]?.[Number(at[1])] ?? "";
                            return key === "" ? T("空格") : key;
                        })()
                    }))), mapDraft === null ? null : mapCellGrid(), h("p", { className: "SPR_muted" }, T("涂改只改草稿，点「保存布局」才写回项目；之后再点「铺成地图」出图。手动改布局不会作废已生成的地块。")), mapDraft === null ? null : h("p", { className: "SPR_muted" }, T("快捷键：Ctrl+Z 撤销 / Ctrl+Shift+Z 重做；Esc 放下笔刷；在地图上按住 Ctrl 滚轮切笔刷。"))), 
            // ⚠️ 判据是 `map.png`（宿主真实给的字段），**不是** `map.ready`。
            // 宿主从来没算过 `ready`，所以写成 `map.ready === true` 时**拼好的地图
            // 永远不显示**，界面一直停在「还没有拼图」——而且不报任何错。
            // 实测踩过。verify-tile-client.mjs 现在会断言「已有 png 时必须显示预览」。
            typeof project.map?.png === "string"
                ? h("div", { className: "SPR_row" }, h(ZoomableImage, {
                    className: "SPR_tileMap",
                    src: `${project.assetBase}${project.map.png}?v=${encodeURIComponent(project.updatedAt ?? "")}`,
                    alt: T("地图"),
                    caption: `${project.map.cols}×${project.map.rows} · seed ${project.map.seed}`
                }))
                : h("div", { className: "SPR_empty" }, T("还没有拼图——点「铺成地图」立刻看到结果（不花钱）。")));
            // ── ⑤ 导出 ────────────────────────────────────────────────────────
            const exportStage = h("div", { className: "SPR_tileStage" }, h("p", { className: "SPR_hint" }, T("导出地块包（每张 PNG）+ 地图 PNG + 布局 JSON。全部本地计算。")), h("div", { className: "SPR_row" }, h(BusyBtn, {
                busy: busy,
                className: "SPR_btn SPR_btn-primary",
                onClick: () => void run(T("导出"), () => api.runTileExport({ projectId: project.id }))
            }, T("导出到 export/")), h("button", {
                type: "button",
                className: "SPR_btn",
                onClick: () => void api.revealTileProject({ projectId: project.id }).catch((error) => setNotice({ kind: "error", text: msg(error) }))
            }, T("打开产物目录"))));
            const stageBody = stage === "generate" ? generateStage
                : stage === "review" ? reviewStage
                    : stage === "map" ? mapStage
                        : exportStage;
            return h("div", { className: "SPR_module" }, gateOpen ? h(TileExperimentalDialog, { onClose: closeGate }) : null, h(ExperimentalBar, null), header, steps, notice === null ? null : h("div", { className: `SPR_notice SPR_notice-${notice.kind}` }, notice.text), 
            // ⚠️ 进度提示必须是**行内、不遮挡**的，不能盖住整个面板。
            //
            // 这里原来用 `LoadingOverlay`（`position:absolute; inset:0`）盖在整块面板上，
            // 生成一个地块要几十秒，期间用户既进不了别的阶段、也没法去别的模块干活 ——
            // 而「取消」按钮本身也被盖住了，等于点了停不下来。
            //
            // 现在换成一条细进度条 + 一行文字，跟着文档流走：
            // 它不拦点击，用户可以去别的页签、别的阶段，回来进度还在。
            // 需要「看到就放心」的地方（缩略图、遮罩）仍用 LoadingOverlay。
            busy ? h(TileProgressBar, {
                job: project.job,
                text: T("正在生成地块…")
            }) : null, stageBody);
        }
        function ImageModule(props) {
            useLocaleTick();
            const api = props.api;
            const [jobs, setJobs] = React.useState([]);
            const [jobId, setJobId] = React.useState(null);
            const [job, setJob] = React.useState(null);
            const [notice, setNotice] = React.useState(null);
            const [uploading, setUploading] = React.useState(false);
            const [promptDraft, setPromptDraft] = React.useState("");
            const [suffixDraft, setSuffixDraft] = React.useState("");
            const [settingsDraft, setSettingsDraft] = React.useState({});
            const [keyingDraft, setKeyingDraft] = React.useState({});
            const globalConfig = useGlobalConfig(api);
            // 「正在调用接口」的记账表（上传走自己的 uploading 状态，不在这里）。
            const tasks = usePendingTasks();
            // 深链接：切到某一个图片任务。
            const intent = useStudioIntent();
            React.useEffect(() => {
                if (intent === null)
                    return;
                if (intent.module === "image" && typeof intent.jobId === "string")
                    setJobId(intent.jobId);
            }, [intent]);
            const busy = (job !== null && (job.items ?? []).some((item) => item.status === "running")) || tasks.active;
            const refresh = React.useCallback(async () => {
                try {
                    const result = await api.listImageJobs();
                    setJobs(result.jobs ?? []);
                    return result.jobs ?? [];
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                    return [];
                }
            }, [api]);
            const load = React.useCallback(async (id) => {
                if (id === null)
                    return;
                try {
                    const next = await api.getImageJob(id);
                    setJob(next);
                    setPromptDraft(next.prompt ?? "");
                    setSuffixDraft(next.suffix ?? "");
                    setSettingsDraft({ ...(next.settings ?? {}) });
                    setKeyingDraft({ ...(next.keying ?? {}) });
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api]);
            React.useEffect(() => {
                void (async () => {
                    const list = await refresh();
                    if (list.length > 0)
                        setJobId((current) => current ?? list[0].id);
                })();
            }, [refresh]);
            React.useEffect(() => {
                if (jobId !== null)
                    void load(jobId);
            }, [jobId, load]);
            React.useEffect(() => {
                if (!busy || jobId === null)
                    return undefined;
                const timer = setInterval(() => void load(jobId), 2500);
                return () => clearInterval(timer);
            }, [busy, jobId, load]);
            /**
             * 跑一次远程调用。`feedback`（可选）给出 pending 的 key 与文案，
             * 界面据此在对应预览上盖 loading、把按钮变成转圈。
             */
            const run = async (fn, okText = undefined, feedback = undefined) => {
                const invoke = async () => {
                    try {
                        const value = await fn();
                        if (okText !== undefined)
                            setNotice({ kind: "ok", text: okText });
                        if (jobId !== null)
                            await load(jobId);
                        await refresh();
                        return value;
                    }
                    catch (error) {
                        setNotice({ kind: "error", text: msg(error) });
                        return undefined;
                    }
                };
                if (feedback === undefined)
                    return invoke();
                return tasks.run(feedback.key, feedback.label, invoke);
            };
            const create = async () => {
                const name = askNewName(T("新图片任务的名字"), T("图片 {n0}", { n0: new Date().toLocaleString("zh-CN", { hour12: false }) }));
                if (name === null)
                    return;
                await run(async () => {
                    const created = await api.createImageJob({ name });
                    await refresh();
                    setJobId(created.jobId);
                }, T("已新建图片任务"), { key: K_IMG_CREATE, label: T("正在新建任务…") });
            };
            const saveJob = (patch) => run(() => api.saveImageJob({ jobId: job.id, ...patch }), T("已保存"));
            const del = async () => {
                if (job === null)
                    return;
                if (typeof window !== "undefined" && !window.confirm(T("删除任务「{n0}」？目录会被整个移除。", { n0: job.name })))
                    return;
                await run(async () => {
                    await api.deleteImageJob({ jobId: job.id });
                    const list = await refresh();
                    setJobId(list.length > 0 ? list[0].id : null);
                    if (list.length === 0)
                        setJob(null);
                }, T("已删除"));
            };
            const upload = async (files, kind) => {
                setUploading(true);
                // 上传本身也要有反馈：走同一个 tasks 表，key 固定成上传中的那批。
                await tasks.run(K_IMG_UPLOAD, T("正在上传 {n0} 个文件…", { n0: files.length }), async () => {
                    try {
                        for (const file of files) {
                            const data = await readFileBase64(file);
                            if (kind === "ref")
                                await api.uploadImageRef({ jobId: job.id, name: file.name, data });
                            else
                                await api.addImageItem({ jobId: job.id, name: file.name, data });
                        }
                        await load(job.id);
                    }
                    catch (error) {
                        setNotice({ kind: "error", text: msg(error) });
                    }
                    finally {
                        setUploading(false);
                    }
                });
            };
            return h(React.Fragment, null, h("div", { className: "SPR_body" }, h(JobSidebar, {
                title: T("图片任务"),
                items: jobs,
                activeId: jobId,
                onSelect: setJobId,
                onCreate: create,
                renderMeta: (item) => T("{n0} 张 · 抠像 {n1}", { n0: item.ready, n1: item.keyed })
            }), h("div", { className: "SPR_main" }, notice !== null
                ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text, h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, T("关闭"))))
                : null, h("div", { className: "SPR_toolbar" }, h(BusyBtn, { onClick: create, primary: true, busy: tasks.has(K_IMG_CREATE), busyText: T("正在新建…") }, T("新建任务")), job !== null ? h(Btn, { onClick: del, danger: true }, T("删除任务")) : null, h(BusyBadge, { show: tasks.active, text: tasks.label(K_IMG_JOB) ?? tasks.label(K_IMG_KEY) ?? tasks.label(K_IMG_UPLOAD) ?? tasks.firstLabel ?? T("正在调用接口…") })), job === null
                ? h("p", { className: "SPR_empty" }, T("请选择或新建一个图片任务"))
                : h(React.Fragment, null, h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("① 提示词"))), h("p", { className: "SPR_hint" }, T("统一附加提示词会接在主提示词后面，用来写跨批次的共同要求。")), h("textarea", {
                    className: "SPR_area",
                    placeholder: T("描述你要生成的图片…"),
                    value: promptDraft,
                    onChange: (event) => setPromptDraft(event.target.value),
                    onBlur: () => {
                        if (promptDraft !== (job.prompt ?? ""))
                            void saveJob({ prompt: promptDraft });
                    }
                }), h("textarea", {
                    className: "SPR_area",
                    style: { minHeight: 60 },
                    placeholder: T("统一附加提示词（可留空）"),
                    value: suffixDraft,
                    onChange: (event) => setSuffixDraft(event.target.value),
                    onBlur: () => {
                        if (suffixDraft !== (job.suffix ?? ""))
                            void saveJob({ suffix: suffixDraft });
                    }
                }), h("div", { className: "SPR_fields" }, h(GlobalModelField, { label: T("生图模型"), value: globalConfig?.arkModel ?? settingsDraft.model }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("尺寸")), h("input", { className: "SPR_input", value: settingsDraft.size ?? "", onChange: (event) => setSettingsDraft({ ...settingsDraft, size: event.target.value }), onBlur: () => void saveJob({ settings: settingsDraft }) })), h(NumField, { label: T("生成张数（1~8）"), value: settingsDraft.count ?? 1, min: 1, max: 8, onChange: (v) => { setSettingsDraft({ ...settingsDraft, count: v }); void saveJob({ settings: { ...settingsDraft, count: v } }); } })), h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                    primary: true,
                    busy: tasks.has(K_IMG_JOB),
                    busyText: T("正在生成 {n0} 张…", { n0: settingsDraft.count ?? 1 }),
                    disabled: promptDraft.trim() === "" || tasks.has(K_IMG_JOB),
                    onClick: () => void run(() => api.runImageJob({ jobId: job.id }), T("已开始生成 {n0} 张", { n0: settingsDraft.count ?? 1 }), { key: K_IMG_JOB, label: T("正在生成 {n0} 张图片…", { n0: settingsDraft.count ?? 1 }) })
                }, T("生成 {n0} 张", { n0: settingsDraft.count ?? 1 })), h("span", { className: "SPR_refRow" }, T("按 Seedream 刊例约 0.2 元/张，实际以方舟账单为准")))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("② 参考图（可留空）"))), h("p", { className: "SPR_hint" }, T("最多 10 张。有参考图时走图生图；引用多张时可在提示词里写「图一」「图二」。")), h(UploadBox, { label: T("把参考图拖到这里"), accept: "image/*", multiple: true, busy: uploading || tasks.has(K_IMG_UPLOAD), onFiles: (files) => void upload(files, "ref") }), (job.refs ?? []).length === 0
                    ? null
                    : h("div", { className: "SPR_grid" }, (job.refs ?? []).map((ref) => h("div", { key: ref.file, className: "SPR_node" }, h("img", { className: "SPR_thumb", src: `${job.assetBase}${ref.file}?v=${job.updatedAt}`, alt: ref.name }), h("span", { className: "SPR_refRow" }, ref.name), h("div", { className: "SPR_btnRow" }, h(Btn, { danger: true, onClick: () => void run(() => api.removeImageRef({ jobId: job.id, file: ref.file }), T("已移除参考图")) }, T("移除"))))))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("③ 绿幕抠图"))), h("p", { className: "SPR_hint" }, T("开启后每张生成完会自动抠一遍；也可以上传已有图片只做抠像。")), h("div", { className: "SPR_toolbar" }, h("select", {
                    className: "SPR_input",
                    style: { width: 220 },
                    value: keyingDraft.enabled ? "on" : "off",
                    onChange: (event) => {
                        const enabled = event.target.value === "on";
                        setKeyingDraft({ ...keyingDraft, enabled });
                        void saveJob({ keying: { enabled } });
                    }
                }, h("option", { value: "off" }, T("不抠像")), h("option", { value: "on" }, T("自动抠绿幕输出 PNG"))), h(BusyBtn, {
                    busy: tasks.has(K_IMG_KEY),
                    busyText: T("正在抠像…"),
                    onClick: () => void run(() => api.keyImageJob({ jobId: job.id }), T("已开始抠像"), {
                        key: K_IMG_KEY,
                        label: T("正在抠绿幕…")
                    })
                }, T("按当前参数重新抠像"))), h(KeyingFields, { draft: keyingDraft, onChange: (patch) => { const next = { ...keyingDraft, ...patch }; setKeyingDraft(next); void saveJob({ keying: patch }); } }), h(UploadBox, { label: T("上传一张已有图片，直接抠成透明 PNG"), accept: "image/*", multiple: false, busy: uploading || tasks.has(K_IMG_UPLOAD), onFiles: (files) => void upload(files, "item") }), tasks.has(K_IMG_UPLOAD) ? h(BusyBadge, { show: true, text: tasks.label(K_IMG_UPLOAD) }) : null), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("④ 结果（{n0} 张）", { n0: (job.items ?? []).length }))), h(ReviewModeBar, { api, module: "image", id: job.id, mode: job.reviewMode, onChanged: () => void load(job.id) }), (job.items ?? []).length === 0
                    ? h("p", { className: "SPR_empty" }, T("还没有图片"))
                    : h("div", { className: "SPR_grid" }, (job.items ?? []).map((item, index) => {
                        const itemKey = K_IMG_ITEM(index);
                        const itemBusy = item.status === "running" || tasks.has(itemKey);
                        // 生成的原图（未抠像时就是唯一产物）也要能存下来：
                        // 之前只有「抠像结果」给了下载链接，抠像关掉后整张卡片
                        // 只剩 通过 / 重新生成 / 删除，用户只能右键另存。
                        const rawExt = typeof item.file === "string" && item.file.includes(".")
                            ? item.file.slice(item.file.lastIndexOf(".") + 1).toLowerCase()
                            : "png";
                        // 整批生成时，还没轮到的那些也要盖住（否则旧图看着像「没反应」）
                        const waiting = item.status !== "running" && tasks.has(K_IMG_JOB);
                        const keyingNow = item.status !== "running" && tasks.has(K_IMG_KEY);
                        const overlay = itemBusy || keyingNow || waiting;
                        const overlayText = tasks.label(itemKey) ??
                            (keyingNow ? T("正在抠绿幕…") : waiting ? tasks.label(K_IMG_JOB) ?? T("正在生成…") : T("正在生成…"));
                        return h("div", { key: index, className: "SPR_node", "data-busy": overlay ? "true" : undefined }, h("div", { className: "SPR_nodeTop" }, h("span", { className: "SPR_nodeTitle" }, T("第 {n0} 张", { n0: index + 1 })), overlay ? h(Chip, { kind: "running", text: T("生成中") }) : h(StatusChip, { node: item }), item.source === "uploaded" ? h(Chip, { kind: "empty", text: T("上传") }) : null), h(MediaBox, { overlay, text: overlayText }, item.keyedFile !== undefined
                            ? h("img", { className: "SPR_thumb", src: `${job.assetBase}${item.keyedFile}?v=${item.updatedAt}`, alt: T("抠像结果") })
                            : item.file !== undefined
                                ? h("img", { className: "SPR_thumb", src: `${job.assetBase}${item.file}?v=${item.updatedAt}`, alt: T("生成结果") })
                                : h("div", { className: "SPR_thumbEmpty" }, overlay ? T("生成中…") : T("等待生成"))), overlay ? h(BusyBadge, { show: true, text: overlayText }) : null, item.backgroundFraction !== undefined
                            ? h("span", { className: "SPR_refRow" }, T("背景占比 {n0}%", { n0: (item.backgroundFraction * 100).toFixed(0) }))
                            : null, item.error !== undefined ? h("p", { className: "SPR_error" }, item.error) : null, h("div", { className: "SPR_btnRow" }, h(ApproveBtn, {
                            approved: item.approved === true,
                            disabled: overlay || item.status !== "ready",
                            onToggle: () => void run(() => api.saveImageJob({ jobId: job.id, index, approved: item.approved !== true }), item.approved === true ? T("已取消通过") : T("已标记通过"))
                        }), item.file !== undefined
                            ? h("a", { className: "SPR_btn", href: `${job.assetBase}${item.file}`, download: `image-${index + 1}.${rawExt}`, style: { textDecoration: "none" } }, T("下载原图"))
                            : null, item.keyedFile !== undefined
                            ? h("a", { className: "SPR_btn", href: `${job.assetBase}${item.keyedFile}`, download: `keyed-${index + 1}.png`, style: { textDecoration: "none" } }, T("下载 PNG"))
                            : null, item.source === "generated"
                            ? h(BusyBtn, {
                                busy: tasks.has(itemKey),
                                busyText: T("正在提交…"),
                                onClick: () => void run(() => api.runImageJob({ jobId: job.id, count: index + 1 }), T("已重新生成"), {
                                    key: itemKey,
                                    label: T("正在重新生成第 {n0} 张…", { n0: index + 1 })
                                })
                            }, T("重新生成"))
                            : null, h(Btn, { danger: true, disabled: overlay, onClick: () => void run(() => api.removeImageItem({ jobId: job.id, index }), T("已删除")) }, T("删除"))));
                    }))), h(JobLogPanel, { job })))));
        }
        // ── 模块③：序列帧生成 ───────────────────────────────────────────────
        /** 模块③的 pending key：视频、抽帧、抠像、合成、上传、新建任务。 */
        const K_SEQ_VIDEO = "seq:video";
        const K_SEQ_FRAMES = "seq:frames";
        const K_SEQ_KEY = "seq:key";
        const K_SEQ_COMPOSE = "seq:compose";
        const K_SEQ_UPLOAD = "seq:upload";
        const K_SEQ_CREATE = "seq:create";
        const K_SEQ_POLL = "seq:poll";
        function SequenceModule(props) {
            useLocaleTick();
            const api = props.api;
            const [jobs, setJobs] = React.useState([]);
            const [jobId, setJobId] = React.useState(null);
            const [job, setJob] = React.useState(null);
            const [notice, setNotice] = React.useState(null);
            const [uploading, setUploading] = React.useState(false);
            const [promptDraft, setPromptDraft] = React.useState("");
            const [suffixDraft, setSuffixDraft] = React.useState("");
            const [settingsDraft, setSettingsDraft] = React.useState({});
            const [keyingDraft, setKeyingDraft] = React.useState({});
            const globalConfig = useGlobalConfig(api);
            // 「正在调用接口」的记账表：宿主状态没落盘时，遮罩靠它撑住。
            const tasks = usePendingTasks();
            // 深链接：切到某一个序列帧任务。
            const intent = useStudioIntent();
            React.useEffect(() => {
                if (intent === null)
                    return;
                if (intent.module === "sequence" && typeof intent.jobId === "string")
                    setJobId(intent.jobId);
            }, [intent]);
            // 时长与分辨率档位跟着全局模型走（优云智算版 H3 多 1080P、可到 30 秒）。
            const modelCaps = globalConfig?.minimaxCapabilities ?? {
                protocol: "v2",
                resolutions: ["768P", "2K", "1080P", "480P"],
                durationMin: 1,
                durationMax: 30
            };
            const effectiveModel = globalConfig?.minimaxModel ?? settingsDraft.model ?? "";
            const effectiveResolution = modelCaps.resolutions.includes(settingsDraft.resolution)
                ? settingsDraft.resolution
                : modelCaps.resolutions[0];
            // 视频、抽帧、抠像/合成任一在跑就保持轮询。
            // 抽帧是后台任务，只刷新一次会一直停在「还没有序列帧」上（实测踩过）。
            const running = (job !== null &&
                (job.video?.status === "running" || job.frames?.status === "running" || job.sheet?.status === "running")) ||
                tasks.active;
            const refresh = React.useCallback(async () => {
                try {
                    const result = await api.listSequenceJobs();
                    setJobs(result.jobs ?? []);
                    return result.jobs ?? [];
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                    return [];
                }
            }, [api]);
            const load = React.useCallback(async (id) => {
                if (id === null)
                    return;
                try {
                    const next = await api.getSequenceJob(id);
                    setJob(next);
                    setPromptDraft(next.prompt ?? "");
                    setSuffixDraft(next.suffix ?? "");
                    setSettingsDraft({ ...(next.settings ?? {}) });
                    setKeyingDraft({ ...(next.keying ?? {}) });
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api]);
            const jobIdRef = React.useRef(null);
            React.useEffect(() => {
                jobIdRef.current = jobId;
            }, [jobId]);
            React.useEffect(() => {
                void (async () => {
                    const list = await refresh();
                    if (list.length > 0)
                        setJobId((current) => current ?? list[0].id);
                })();
            }, [refresh]);
            React.useEffect(() => {
                if (jobId !== null)
                    void load(jobId);
            }, [jobId, load]);
            React.useEffect(() => {
                if (!running || jobId === null)
                    return undefined;
                const timer = setInterval(() => void load(jobId), 5000);
                return () => clearInterval(timer);
            }, [running, jobId, load]);
            /**
             * 跑一次远程调用。`feedback`（可选）给出 pending 的 key 与文案，
             * 界面据此在对应预览上盖 loading、把按钮变成转圈。
             */
            const run = async (fn, okText = undefined, feedback = undefined) => {
                const invoke = async () => {
                    try {
                        const value = await fn();
                        if (okText !== undefined)
                            setNotice({ kind: "ok", text: okText });
                        if (jobId !== null)
                            await load(jobId);
                        await refresh();
                        return value;
                    }
                    catch (error) {
                        setNotice({ kind: "error", text: msg(error) });
                        return undefined;
                    }
                };
                if (feedback === undefined)
                    return invoke();
                return tasks.run(feedback.key, feedback.label, invoke);
            };
            /**
             * 启动一个宿主侧「后台任务」（提交视频 / 抽帧 / 抠像 / 合成）。
             * 这些 RPC 是异步启动的——返回时任务状态可能还没落盘，只刷新一次就会
             * 一直停在上一次的结果上（实测：抽帧完成后界面仍显示「还没有序列帧」）。
             * 所以启动后再补几次刷新，直到宿主把 running / ready 写进任务。
             */
            const kickAndWatch = async (fn, okText = undefined, feedback = undefined) => {
                const id = job.id;
                const value = await run(fn, okText, feedback);
                for (const delay of [1200, 3000, 5500, 9000]) {
                    setTimeout(() => {
                        if (jobIdRef.current === id)
                            void load(id);
                    }, delay);
                }
                return value;
            };
            const create = async () => {
                const name = askNewName(T("新序列帧任务的名字"), T("序列帧 {n0}", { n0: new Date().toLocaleString("zh-CN", { hour12: false }) }));
                if (name === null)
                    return;
                await run(async () => {
                    const created = await api.createSequenceJob({ name });
                    await refresh();
                    setJobId(created.jobId);
                }, T("已新建序列帧任务"), { key: K_SEQ_CREATE, label: T("正在新建任务…") });
            };
            const saveJob = (patch) => run(() => api.saveSequenceJob({ jobId: job.id, ...patch }), undefined);
            const del = async () => {
                if (job === null)
                    return;
                if (typeof window !== "undefined" && !window.confirm(T("删除任务「{n0}」？目录会被整个移除。", { n0: job.name })))
                    return;
                await run(async () => {
                    await api.deleteSequenceJob({ jobId: job.id });
                    const list = await refresh();
                    setJobId(list.length > 0 ? list[0].id : null);
                    if (list.length === 0)
                        setJob(null);
                }, T("已删除"));
            };
            const uploadRef = async (files, kind) => {
                setUploading(true);
                await tasks.run(K_SEQ_UPLOAD, T("正在上传 {n0} 个文件…", { n0: files.length }), async () => {
                    try {
                        for (const file of files) {
                            const data = await readFileBase64(file);
                            await api.uploadSequenceRef({ jobId: job.id, kind, name: file.name, data });
                        }
                        await load(job.id);
                    }
                    catch (error) {
                        setNotice({ kind: "error", text: msg(error) });
                    }
                    finally {
                        setUploading(false);
                    }
                });
            };
            const frameUrls = React.useMemo(() => {
                if (job === null)
                    return [];
                const list = (job.frames?.keyed ?? []).length > 0 ? job.frames.keyed : job.frames?.files ?? [];
                return list.map((file) => `${job.assetBase}${file}?v=${job.frames?.updatedAt ?? job.updatedAt}`);
            }, [job]);
            // ── 「正在调用接口」的派生状态 ──────────────────────────────────────
            // 三段各有一块要盖遮罩的预览区：视频、序列帧/条图、合成结果。
            const videoBusy = job?.video?.status === "running" || tasks.has(K_SEQ_VIDEO);
            const videoText = tasks.label(K_SEQ_VIDEO) ?? T("视频生成中…（H3 通常 1~6 分钟，可以离开本页）");
            const framesBusy = job?.frames?.status === "running" || tasks.has(K_SEQ_FRAMES);
            const framesText = tasks.label(K_SEQ_FRAMES) ?? T("正在抽帧…");
            const composing = job?.sheet?.status === "running" || tasks.has(K_SEQ_KEY) || tasks.has(K_SEQ_COMPOSE);
            const composeText = tasks.label(K_SEQ_KEY) ?? tasks.label(K_SEQ_COMPOSE) ?? T("正在抠像并合成条图…");
            return h(React.Fragment, null, h("div", { className: "SPR_body" }, h(JobSidebar, {
                title: T("序列帧任务"),
                items: jobs,
                activeId: jobId,
                onSelect: setJobId,
                onCreate: create,
                renderMeta: (item) => T("{n0} {n1} {n2}", { n0: item.videoReady ? T("视频✓") : T("视频·"), n1: item.frameReady ? T("帧✓") : T("帧·"), n2: item.sheetReady ? T("合成✓") : T("合成·") })
            }), h("div", { className: "SPR_main" }, notice !== null
                ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text, h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, T("关闭"))))
                : null, h("div", { className: "SPR_toolbar" }, h(BusyBtn, { onClick: create, primary: true, busy: tasks.has(K_SEQ_CREATE), busyText: T("正在新建…") }, T("新建任务")), job !== null ? h(Btn, { onClick: del, danger: true }, T("删除任务")) : null, h(BusyBadge, { show: tasks.active, text: tasks.firstLabel ?? T("正在调用接口…") })), job === null
                ? h("p", { className: "SPR_empty" }, T("请选择或新建一个序列帧任务"))
                : h(React.Fragment, null, h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("① 视频输入"))), h("p", { className: "SPR_hint" }, T("平台规定两种模式互斥：首尾帧模式以一张图作为起始画面；多模态参考模式用参考图+参考视频来约束风格与动作。")), h("div", { className: "SPR_toolbar" }, h("select", {
                    className: "SPR_input",
                    style: { width: 260 },
                    value: job.mode,
                    onChange: (event) => void run(() => api.saveSequenceJob({ jobId: job.id, mode: event.target.value }), undefined)
                }, h("option", { value: "frames" }, T("首尾帧模式（上传首帧图）")), h("option", { value: "reference" }, T("多模态参考模式（参考图 / 参考视频）")))), job.mode === "frames"
                    ? h(React.Fragment, null, h("span", { className: "SPR_fieldLabel" }, T("首帧图（必填）")), h(RefRow, { job, frame: job.refs.firstFrame, kind: "firstFrame", api, reload: load, setNotice }), h("span", { className: "SPR_fieldLabel" }, T("尾帧图（选填）")), h(RefRow, { job, frame: job.refs.lastFrame, kind: "lastFrame", api, reload: load, setNotice }), h(UploadBox, { label: T("把首帧图拖到这里"), accept: "image/*", busy: uploading || tasks.has(K_SEQ_UPLOAD), onFiles: (files) => void uploadRef(files, "firstFrame") }))
                    : h(React.Fragment, null, h("span", { className: "SPR_fieldLabel" }, T("参考图（{n0}/9）", { n0: (job.refs.referenceImages ?? []).length })), h("div", { className: "SPR_grid" }, (job.refs.referenceImages ?? []).map((ref) => h("div", { key: ref.file, className: "SPR_node" }, h("img", { className: "SPR_thumb", src: `${job.assetBase}${ref.file}?v=${job.updatedAt}`, alt: ref.name }), h("div", { className: "SPR_btnRow" }, h(Btn, { danger: true, onClick: () => void run(() => api.removeSequenceRef({ jobId: job.id, kind: "referenceImage", file: ref.file }), T("已移除")) }, T("移除")))))), h(UploadBox, { label: T("把参考图拖到这里"), accept: "image/*", multiple: true, busy: uploading || tasks.has(K_SEQ_UPLOAD), onFiles: (files) => void uploadRef(files, "referenceImage") }), h("span", { className: "SPR_fieldLabel" }, T("参考视频（{n0}/3，每段 2~15 秒，单文件 ≤ 40MB）", { n0: (job.refs.referenceVideos ?? []).length })), h("div", { className: "SPR_toolbar" }, (job.refs.referenceVideos ?? []).map((ref) => h(Btn, { key: ref.file, danger: true, onClick: () => void run(() => api.removeSequenceRef({ jobId: job.id, kind: "referenceVideo", file: ref.file }), T("已移除")) }, T("移除 {n0}", { n0: ref.name })))), h(UploadBox, { label: T("把参考视频拖到这里"), accept: "video/*", multiple: true, busy: uploading || tasks.has(K_SEQ_UPLOAD), onFiles: (files) => void uploadRef(files, "referenceVideo") }))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("② 提示词与参数"))), h("textarea", {
                    className: "SPR_area",
                    value: promptDraft,
                    onChange: (event) => setPromptDraft(event.target.value),
                    onBlur: () => { if (promptDraft !== (job.prompt ?? ""))
                        void saveJob({ prompt: promptDraft }); }
                }), h("textarea", {
                    className: "SPR_area",
                    style: { minHeight: 60 },
                    placeholder: T("统一附加提示词（可留空）"),
                    value: suffixDraft,
                    onChange: (event) => setSuffixDraft(event.target.value),
                    onBlur: () => { if (suffixDraft !== (job.suffix ?? ""))
                        void saveJob({ suffix: suffixDraft }); }
                }), h("div", { className: "SPR_fields" }, h(GlobalModelField, { label: T("视频模型"), value: effectiveModel }), h(NumField, { label: T("时长（秒，{n0}~{n1}）", { n0: modelCaps.durationMin, n1: modelCaps.durationMax }), value: settingsDraft.duration ?? 5, min: modelCaps.durationMin, max: modelCaps.durationMax, onChange: (v) => { setSettingsDraft({ ...settingsDraft, duration: v }); void saveJob({ settings: { ...settingsDraft, duration: v } }); } }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("分辨率")), h("select", { className: "SPR_input", value: effectiveResolution, onChange: (event) => { setSettingsDraft({ ...settingsDraft, resolution: event.target.value }); void saveJob({ settings: { ...settingsDraft, resolution: event.target.value } }); } }, modelCaps.resolutions.map((value) => h("option", { key: value, value }, value))))), h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                    primary: true,
                    busy: tasks.has(K_SEQ_VIDEO),
                    busyText: T("正在提交视频任务…"),
                    disabled: promptDraft.trim() === "" || tasks.has(K_SEQ_VIDEO),
                    onClick: () => void kickAndWatch(() => api.runSequenceVideo({ jobId: job.id }), T("已提交视频任务，可离开本页"), {
                        key: K_SEQ_VIDEO,
                        label: T("正在提交视频任务…")
                    })
                }, job.video?.status === "ready" ? T("重新生成视频") : T("生成视频")), h(BusyBtn, {
                    busy: tasks.has(K_SEQ_POLL),
                    busyText: T("正在查询…"),
                    onClick: () => void kickAndWatch(() => run(() => api.pollSequenceVideo({ jobId: job.id })), undefined, { key: K_SEQ_POLL, label: T("正在查询远端进度…") })
                }, T("立即刷新进度")), h(Btn, { danger: true, disabled: videoBusy, onClick: () => void run(() => api.clearSequenceVideo({ jobId: job.id }), T("已清空视频与帧")) }, T("清空视频重来")), h("span", { className: "SPR_refRow" }, T("H3 768P 按 0.5 元/秒刊例计费"))), h("div", { className: "SPR_toolbar" }, h("span", { className: "SPR_refRow" }, T("状态：{n0} {n1} {n2}", { n0: job.video?.status ?? "empty", n1: job.video?.remoteStatus ?? "", n2: job.video?.error ?? "" })), h(BusyBadge, { show: videoBusy, text: videoText })), h("div", { style: { position: "relative", minHeight: job.video?.file === undefined ? 90 : undefined } }, job.video?.file !== undefined
                    ? h(MediaBox, { overlay: videoBusy, text: videoText }, h("video", { className: "SPR_video", src: `${job.assetBase}${job.video.file}?v=${job.video.updatedAt}`, controls: true, preload: "metadata" }))
                    : videoBusy
                        ? h("div", { className: "SPR_thumbEmpty", style: { minHeight: 90 } }, videoText)
                        : null, job.video?.file === undefined ? h(LoadingOverlay, { show: videoBusy, text: videoText }) : null)), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("③ 序列帧提取"))), h("div", { className: "SPR_fields" }, h(NumField, { label: T("提取张数"), value: settingsDraft.frameCount ?? 8, min: 1, max: 64, onChange: (v) => { setSettingsDraft({ ...settingsDraft, frameCount: v }); void saveJob({ settings: { ...settingsDraft, frameCount: v } }); } }), h(NumField, { label: T("抽帧工作尺寸（长边 px）"), value: settingsDraft.longEdge ?? 768, min: 128, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, longEdge: v }); void saveJob({ settings: { ...settingsDraft, longEdge: v } }); } }), h(NumField, { label: T("单格宽（px）"), value: settingsDraft.cellWidth ?? 256, min: 16, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, cellWidth: v }); void saveJob({ settings: { ...settingsDraft, cellWidth: v } }); } }), h(NumField, { label: T("单格高（px）"), value: settingsDraft.cellHeight ?? 256, min: 16, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, cellHeight: v }); void saveJob({ settings: { ...settingsDraft, cellHeight: v } }); } }), h(NumField, { label: T("像素块边长（0/1 = 关闭）"), value: settingsDraft.pixelSize ?? 0, min: 0, max: 32, onChange: (v) => { setSettingsDraft({ ...settingsDraft, pixelSize: v }); void saveJob({ settings: { ...settingsDraft, pixelSize: v } }); } })), h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                    primary: true,
                    busy: tasks.has(K_SEQ_FRAMES),
                    busyText: T("正在抽帧…"),
                    disabled: job.video?.file === undefined || framesBusy,
                    onClick: () => void kickAndWatch(() => api.runSequenceFrames({ jobId: job.id }), T("已开始抽帧"), {
                        key: K_SEQ_FRAMES,
                        label: T("正在抽帧…")
                    })
                }, T("按当前张数抽帧（{n0} 张）", { n0: settingsDraft.frameCount ?? 8 })), job.frames?.stale === true ? h(Chip, { kind: "stale", text: T("参数已变，需重抽") }) : null, h(BusyBadge, { show: framesBusy, text: framesText }), h("span", { className: "SPR_refRow" }, job.frames?.duration !== undefined ? T("视频时长 {n0} 秒 · {n1} 帧", { n0: job.frames.duration.toFixed(2), n1: job.frames.files.length }) : ""))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("④ 绿幕抠像与合成"))), h(KeyingFields, { draft: keyingDraft, onChange: (patch) => { const next = { ...keyingDraft, ...patch }; setKeyingDraft(next); void saveJob({ keying: patch }); } }), h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                    busy: tasks.has(K_SEQ_KEY),
                    busyText: T("正在重新抠像…"),
                    disabled: framesBusy,
                    onClick: () => void kickAndWatch(() => api.keySequenceFrames({ jobId: job.id }), T("已开始重新抠像"), {
                        key: K_SEQ_KEY,
                        label: T("正在重新抠像…")
                    })
                }, T("重新抠像")), h(BusyBtn, {
                    busy: tasks.has(K_SEQ_COMPOSE),
                    busyText: T("正在合成条图…"),
                    disabled: framesBusy,
                    onClick: () => void kickAndWatch(() => api.composeSequence({ jobId: job.id }), T("已合成"), {
                        key: K_SEQ_COMPOSE,
                        label: T("正在合成横向条图…")
                    })
                }, T("合成横向条图")), job.sheet?.file !== undefined
                    ? h("a", { className: "SPR_btn", href: `${job.assetBase}${job.sheet.file}?v=${job.sheet.updatedAt}`, download: `${job.name}-strip.png`, style: { textDecoration: "none" } }, T("下载条图"))
                    : null), h("div", { style: { position: "relative" } }, frameUrls.length === 0
                    ? h("p", { className: "SPR_empty" }, framesBusy ? T("正在处理序列帧…") : T("还没有序列帧"))
                    : h(SequencePlayer, { urls: frameUrls }), h(LoadingOverlay, { show: framesBusy, text: framesText })), job.sheet?.file !== undefined
                    ? h("div", { className: "SPR_sheetWrap", style: { position: "relative" } }, h("img", { className: "SPR_sheet", src: `${job.assetBase}${job.sheet.file}?v=${job.sheet.updatedAt}`, alt: T("序列帧条图"), style: { visibility: composing ? "hidden" : undefined } }), h(LoadingOverlay, { show: composing, text: composeText }))
                    : null, frameUrls.length === 0
                    ? null
                    : h("div", { className: "SPR_frames" }, frameUrls.map((url, index) => h(ZoomableImage, {
                        key: index,
                        className: "SPR_frame",
                        src: url,
                        alt: T("第 {n0} 帧", { n0: index + 1 }),
                        caption: T("第 {n0} / {n1} 帧（点「×」/ 背景 / Esc 关闭）", { n0: index + 1, n1: frameUrls.length })
                    })))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, T("⑤ 验收"))), h("p", { className: "SPR_hint" }, T("三步各自打「通过」。对话里的 agent 读写同一份标记：选「每一步人工审核」时，它会等你通过才继续。")), h(ReviewModeBar, { api, module: "sequence", id: job.id, mode: job.reviewMode, onChanged: () => void load(job.id) }), [
                    { step: "video", title: T("① 生成视频"), node: job.video },
                    { step: "frames", title: T("② 抽帧 + 抠像"), node: job.frames },
                    { step: "sheet", title: T("③ 横向条图"), node: job.sheet }
                ].map((entry) => h("div", { key: entry.step, className: "SPR_toolbar", style: { margin: "4px 0" } }, h("span", { className: "SPR_nodeTitle", style: { minWidth: 120 } }, entry.title), h(StatusChip, { node: entry.node }), h(ApproveBtn, {
                    approved: entry.node?.approved === true,
                    disabled: entry.node?.status !== "ready",
                    onToggle: () => void run(() => api.saveSequenceJob({ jobId: job.id, step: entry.step, approved: entry.node?.approved !== true }), entry.node?.approved === true ? T("已取消通过") : T("已标记通过"))
                })))), h(JobLogPanel, { job })))));
        }
        /** 单张参考图/首尾帧的展示行。 */
        function RefRow(props) {
            // ⚠️ 这里的 prop 不能叫 `ref`：React 会把名为 ref 的 prop 特殊处理（不进 props），
            // 函数组件里 `props.ref` 恒为 undefined，界面就会永远显示「未上传」——
            // 看起来像「选了图没反应」，实测踩过。
            const { job, frame, kind, api, reload, setNotice } = props;
            if (frame === undefined)
                return h("span", { className: "SPR_refRow" }, T("未上传"));
            return h("div", { className: "SPR_toolbar" }, h("img", { className: "SPR_thumbMd", src: `${job.assetBase}${frame.file}?v=${job.updatedAt}`, alt: frame.name }), h("span", { className: "SPR_refRow" }, frame.name), h(Btn, {
                danger: true,
                onClick: async () => {
                    try {
                        await api.removeSequenceRef({ jobId: job.id, kind });
                        await reload(job.id);
                    }
                    catch (error) {
                        setNotice({ kind: "error", text: msg(error) });
                    }
                }
            }, T("移除")));
        }
        /** 序列帧播放预览：把抠好的帧按 fps 循环播出来。 */
        function SequencePlayer(props) {
            const urls = props.urls;
            const canvasRef = React.useRef(null);
            const imagesRef = React.useRef([]);
            const rafRef = React.useRef(0);
            const liveRef = React.useRef({ fps: 12, scale: 1 });
            const [fps, setFps] = React.useState(12);
            const [scale, setScale] = React.useState(1);
            const [playing, setPlaying] = React.useState(true);
            const [loaded, setLoaded] = React.useState(0);
            const playingRef = React.useRef(true);
            const key = urls.join("|");
            liveRef.current.fps = fps;
            liveRef.current.scale = scale;
            playingRef.current = playing;
            React.useEffect(() => {
                let cancelled = false;
                const images = [];
                let done = 0;
                urls.forEach((url, index) => {
                    const image = new Image();
                    image.onload = () => {
                        done++;
                        if (!cancelled)
                            setLoaded(done);
                    };
                    image.onerror = () => {
                        done++;
                        if (!cancelled)
                            setLoaded(done);
                    };
                    image.src = url;
                    images[index] = image;
                });
                imagesRef.current = images;
                setLoaded(0);
                return () => {
                    cancelled = true;
                    imagesRef.current = [];
                };
            }, [key]);
            React.useEffect(() => {
                const canvas = canvasRef.current;
                if (canvas === null)
                    return undefined;
                const g = canvas.getContext("2d");
                let frame = 0;
                let last = performance.now();
                const tick = (now) => {
                    rafRef.current = requestAnimationFrame(tick);
                    const live = liveRef.current;
                    const images = imagesRef.current.filter((image) => image !== undefined && image.naturalWidth > 0);
                    if (images.length === 0)
                        return;
                    const interval = 1000 / Math.max(1, live.fps);
                    if (playingRef.current && now - last >= interval) {
                        last = now;
                        frame = (frame + 1) % images.length;
                    }
                    const image = images[frame % images.length];
                    const w = Math.round(image.naturalWidth * live.scale);
                    const h2 = Math.round(image.naturalHeight * live.scale);
                    canvas.width = w;
                    canvas.height = h2;
                    g.fillStyle = "#ffffff";
                    g.fillRect(0, 0, w, h2);
                    g.imageSmoothingEnabled = live.scale < 1;
                    g.drawImage(image, 0, 0, w, h2);
                };
                rafRef.current = requestAnimationFrame(tick);
                return () => cancelAnimationFrame(rafRef.current);
            }, [key]);
            return h(React.Fragment, null, h("div", { className: "SPR_fields" }, h(NumField, { label: T("播放帧率（fps）"), value: fps, min: 1, max: 30, onChange: setFps }), h(NumField, { label: T("预览缩放"), value: scale, min: 0.2, max: 2, step: 0.1, onChange: setScale }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("播放")), h("select", { className: "SPR_input", value: playing ? "on" : "off", onChange: (event) => setPlaying(event.target.value === "on") }, h("option", { value: "on" }, T("播放中")), h("option", { value: "off" }, T("暂停"))))), h("p", { className: "SPR_hint" }, T("已载入 {n0}/{n1} 帧。这是抠像后的帧按顺序循环播放的效果，用来判断动作连贯性和抠像边缘是否稳定。", { n0: loaded, n1: urls.length })), h("div", { className: "SPR_player" }, h("canvas", { ref: canvasRef, className: "SPR_canvasPlayer" })));
        }
        /**
         * 任务日志面板。
         *
         * 从「一条平铺的日志」升级成结构化视图，加了两件真正省时间的事：
         *
         *  1. **把「开始 X」与它之后的「X 完成 / 失败」配成一条**，并附上耗时。
         *     原样平铺时，一次生图会刷出两三条互不相邻的记录（中间夹着别的阶段），
         *     「这一步到底跑了多久、成没成」要靠人自己拼时间戳——实测排查一次拆件失败时
         *     就是这么来回翻的。
         *  2. **级别筛选 + 关键字**。日志里绝大多数是 info，出问题时真正要看的是
         *     那几条 warn/error；40 条一屏根本翻不到。
         */
        function JobLogPanel({ job }) {
            const [level, setLevel] = React.useState("all");
            const [query, setQuery] = React.useState("");
            const raw = Array.isArray(job?.log) ? job.log : [];
            if (raw.length === 0)
                return null;
            const paired = [];
            let open = null;
            for (const entry of raw) {
                if (typeof entry?.message !== "string")
                    continue;
                if (/^开始/.test(entry.message)) {
                    // 上一条还没闭合就再来一条「开始」：把它单独留下，不要吞掉。
                    if (open !== null)
                        paired.push(open);
                    open = entry;
                    continue;
                }
                if (open !== null && /完成|失败/.test(entry.message)) {
                    paired.push({
                        at: entry.at,
                        level: entry.level,
                        message: T("{n0} → {n1}", { n0: open.message.replace(/^开始/, ""), n1: entry.message }),
                        startedAt: open.at,
                        elapsed: Math.max(0, entry.at - open.at)
                    });
                    open = null;
                    continue;
                }
                paired.push(entry);
            }
            if (open !== null)
                paired.push(open);
            const wanted = level === "all" ? null : level === "warn" ? (e) => e.level !== "info" : (e) => e.level === "error";
            const filtered = paired.filter((entry) => (wanted === null || wanted(entry)) && (query === "" || String(entry.message).includes(query)));
            const entries = filtered.slice(-40).reverse();
            const counts = paired.reduce((acc, entry) => { acc[entry.level] = (acc[entry.level] ?? 0) + 1; return acc; }, {});
            const formatElapsed = (ms) => (ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`);
            return h("div", { className: "SPR_log", "data-testid": "rig-log" }, h("div", { className: "SPR_logHead" }, h("span", { className: "SPR_fieldLabel" }, T("运行日志（{n0} 条{n1}）", { n0: paired.length, n1: counts.error ? T(" · {n0} 错误", { n0: counts.error }) : counts.warn ? T(" · {n0} 警告", { n0: counts.warn }) : "" })), h("span", { className: "SPR_logFilters" }, h(Btn, { on: level === "all", "data-testid": "rig-log-all", onClick: () => setLevel("all") }, T("全部")), h(Btn, { on: level === "warn", "data-testid": "rig-log-warn", onClick: () => setLevel("warn") }, T("警告+（{n0}）", { n0: (counts.warn ?? 0) + (counts.error ?? 0) })), h(Btn, { on: level === "error", "data-testid": "rig-log-error", onClick: () => setLevel("error") }, T("错误（{n0}）", { n0: counts.error ?? 0 })), h("input", {
                className: "SPR_input",
                style: { width: 130 },
                placeholder: T("搜关键字…"),
                "data-testid": "rig-log-query",
                value: query,
                onChange: (event) => setQuery(event.target.value)
            }))), entries.length === 0
                ? h("p", { className: "SPR_hint" }, filtered.length === 0 && paired.length > 0 ? T("当前筛选下没有日志。") : "")
                : h("ul", { className: "SPR_logList" }, entries.map((entry, index) => h("li", { key: `${entry.at}-${index}`, "data-level": entry.level }, h("span", { className: "SPR_logTime" }, new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })), h("span", null, entry.message), entry.elapsed === undefined ? null : h("span", { className: "SPR_logElapsed" }, T("（{n0}）", { n0: formatElapsed(entry.elapsed) }))))));
        }
        function renderLog(project) {
            const entries = Array.isArray(project.log) ? project.log.slice(-40).reverse() : [];
            if (entries.length === 0)
                return null;
            return h("div", { className: "SPR_log" }, h("span", { className: "SPR_fieldLabel" }, T("运行日志")), h("ul", { className: "SPR_logList" }, entries.map((entry, index) => h("li", { key: index, "data-level": entry.level }, h("span", { className: "SPR_logTime" }, new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })), h("span", null, entry.message)))));
        }
        // ── 模块④：骨骼动画生成 ──────────────────────────────────────────────
        //
        // 四个阶段各自独立可重跑，和八方向图的手感一致：
        //   ① 拆件   —— 生图模型把角色拆成部件（**唯一花钱的一步**），也可以直接上传部件
        //   ② 装配   —— 多尺度模板匹配把部件摆回参考姿态，出对比图供肉眼验收、可拖动微调
        //   ③ 骨骼   —— 自动推骨骼层级 + 六个动画预设，出 skeleton.json 与可播放预览
        //   ④ 图集   —— 打包 Spine 纹理图集
        //
        // 设计上刻意让「重跑」便宜：②③④ 全是本地计算，失败一两个部件只重跑那几个。
        /** 内置动画预设（与宿主 src/spine.ts 的 RIG_ANIMATIONS 一致）。 */
        const RIG_ANIMATIONS = ["idle", "walk", "run", "wave", "jump", "attack"];
        /**
         * 语义角色与中文名（与宿主 src/rigsemantics.ts 的 RIG_ROLES / ROLE_LABELS 一致）。
         *
         * 浏览器半区是经典脚本、不能 import，所以这里必然是**一份拷贝**。
         * `scripts/verify-tools.mjs` 有一条契约把两边逐项比对，防止悄悄漂移——
         * 这正是 RIG_ANIMATIONS 已经在用的做法。
         */
        function make_RIG_ROLES() {
            return [
                { key: "head", label: T("头部") },
                { key: "neck", label: T("脖子") },
                { key: "torso", label: T("躯干") },
                { key: "hip", label: T("胯部") },
                { key: "upperArm", label: T("上臂") },
                { key: "lowerArm", label: T("小臂") },
                { key: "hand", label: T("手") },
                { key: "upperLeg", label: T("大腿") },
                { key: "lowerLeg", label: T("小腿") },
                { key: "foot", label: T("脚") },
                { key: "hair", label: T("头发") },
                { key: "cloth", label: T("衣料") },
                { key: "accessory", label: T("配饰") },
                { key: "weapon", label: T("武器") }
            ];
        }
        let RIG_ROLES = make_RIG_ROLES();
        function make_RIG_STAGES() {
            return [
                { key: "parts", title: T("① 拆件"), hint: T("生图模型把角色拆成独立部件（这一步花钱，只跑一次；也可以直接上传部件 PNG）") },
                { key: "layout", title: T("② 装配定位"), hint: T("把部件摆回参考姿态；本地计算，免费，可以逐件重跑或手工拖动") },
                { key: "rig", title: T("③ 骨骼与动画"), hint: T("自动推骨骼层级 + 待机/行走/奔跑/挥手/跳跃/攻击，直接播放验收") },
                { key: "atlas", title: T("④ 图集"), hint: T("打包成 Spine 纹理图集（.png + .atlas），可直接导入引擎") }
            ];
        }
        let RIG_STAGES = make_RIG_STAGES();
        const K_RIG_JOB = "rig:job";
        const K_RIG_SHEET = "rig:sheet";
        const K_RIG_SEGMENT = "rig:segment";
        /** 拆件质检：与分割共用一把锁（两者都在部件刚建出来之后跑）。 */
        const K_RIG_QA = K_RIG_SEGMENT;
        const K_RIG_LAYOUT = "rig:layout";
        const K_RIG_BONES = "rig:bones";
        const K_RIG_ATLAS = "rig:atlas";
        const K_RIG_CREATE = "rig:create";
        /** AI 逐部件重绘（花钱，几十秒）。 */
        const K_RIG_REDRAW = "rig:redraw";
        /** 后台任务的 pending 文案：宿主在跑什么，界面就直说什么。 */
        function make_RIG_BUSY_LABEL() {
            return {
                [K_RIG_JOB]: T("正在刷新…"),
                [K_RIG_SHEET]: T("正在拆件生图…"),
                [K_RIG_SEGMENT]: T("正在分割部件…"),
                [K_RIG_LAYOUT]: T("正在装配定位…"),
                [K_RIG_BONES]: T("正在生成骨骼…"),
                [K_RIG_ATLAS]: T("正在打包图集…"),
                [K_RIG_REDRAW]: T("正在重绘部件…"),
                [K_RIG_CREATE]: T("正在创建任务…")
            };
        }
        let RIG_BUSY_LABEL = make_RIG_BUSY_LABEL();
        function rigStageOf(job, key) {
            return (job.stages ?? []).find((entry) => entry.stage === key) ?? { stage: key, status: "empty" };
        }
        /** 部件卡片：逐件验收 / 隐藏 / 删除 / 重新定位。 */
        function RigPartCard({ part, busy, onApprove, onHide, onRemove, onRetry, onSelect, onRename, selected }) {
            return h("div", { className: "SPR_rigCard", "data-approved": part.approved === true ? "true" : undefined, "data-hidden": part.hidden === true ? "true" : undefined }, h("div", { className: "SPR_rigCardName" }, h("span", null, part.label ?? part.name), h(StatusChip, { node: part })), part.url !== null && part.url !== undefined ? h("img", { className: "SPR_rigCardImg", src: part.url, alt: part.name }) : null, h("div", { className: "SPR_rigCardMeta" }, `${part.width ?? "?"}×${part.height ?? "?"}`, part.placed ? T(" · 已定位") : part.status === "ready" ? T(" · 未定位") : "", typeof part.score === "number" ? T(" · 相似度 {n0}", { n0: part.score }) : "", part.manual ? T(" · 手工调整") : ""), 
            // 低置信度必须一眼可见：平涂/低细节美术上，模板匹配很难分辨形状相同的
            // 部件（左右肢、同色衣料），自动结果只是初值，要提醒用户逐个核对。
            part.status === "ready" && (part.placed !== true || (typeof part.score === "number" && part.score < 0.5))
                ? h("div", { className: "SPR_rigCardMeta", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } }, part.placed !== true ? T("自动定位没找到，请手工拖到正确位置") : T("相似度偏低，建议核对或拖一下"))
                : null, part.error ? h("div", { className: "SPR_rigCardMeta", style: { color: "var(--dsw-alias-state-error-primary)" } }, part.error) : null, h("div", { className: "SPR_rigCardBtns" }, h(Btn, { onClick: onSelect, on: selected }, T("选中")), h(Btn, { onClick: onApprove, on: part.approved === true }, part.approved ? T("已通过") : T("通过")), h(Btn, { onClick: onRetry, disabled: busy || part.status !== "ready" }, T("重新定位")), h(Btn, { onClick: onRename }, T("改名")), h(Btn, { onClick: onHide }, part.hidden ? T("取消隐藏") : T("隐藏")), h(Btn, { onClick: onRemove, danger: true }, T("删除"))));
        }
        // ── 手动装配编辑器 ──────────────────────────────────────────────────
        //
        // 自动定位只保证「大致对」，收尾必须靠人。这里把装配页做成一个真正的分层编辑器：
        //
        //   · **拖拽**：画布上直接拖部件；四角/四边手柄缩放；部件栏里的部件拖进画布即放置
        //   · **键盘**：方向键微调 1px（Shift = 10px），Delete 收回部件，Esc 取消选中
        //   · **吸附**：拖动时自动吸附到其它部件的边/中线与画布中线，并画出参考线
        //   · **图层**：置顶/置底/上移/下移，画出层级列表
        //   · **撤销/重做**：每一次落位都进历史栈（Ctrl+Z / Ctrl+Shift+Z）
        //   · **配置**：选中部件的 x/y/宽/高/旋转/层级数值精调，宽高可锁等比
        //
        // 关键实现选择：画布是**客户端自己叠出来的**（每层一个 <img>），不是等宿主回传
        // 合成图。拖动时只有本地 state 变化，松手才提交一次批量改动——否则每拖一帧都要
        // 一次往返 + 一次重出合成图（要解码参考图与全部部件），手感会烂掉。
        /**
         * 语义编辑面板（阶段①.5）。
         *
         * 为什么它必须存在：骨架的**父级与锚点**以前完全由「部件叫什么名字」隐式决定
         * （宿主按名字查固定表）。这让「名字」承担了它承担不起的责任——模型没按网格摆、
         * 或者角色不是标准人形时，用户只能靠改名来间接影响骨架，而改名又会连带动画、
         * 甚至让已经摆好的装配失效。
         *
         * 现在语义是显式数据：这里改一次角色/父级/锚点，骨架立刻跟着变，
         * 而**已经做好的装配不会被作废**（宿主只作废骨骼与图集）。
         *
         * 表里只列 ready 的部件；每个字段改了就打一次 `setRigSemantics`，并把来源记成
         * `human`——这样「这块人看过」是数据事实，而不是靠人记。
         */
        function RigSemanticsPanel({ job, api, run, activeKey }) {
            const parts = (job.parts ?? []).filter((part) => part.status === "ready");
            if (parts.length === 0)
                return null;
            const sem = job.semantics ?? { errors: [], warnings: [], ok: true, ready: false, confirmed: false, count: 0 };
            const names = parts.map((part) => part.name);
            const patch = (name, fields) => void run(async () => {
                const result = await api.setRigSemantics({ jobId: job.id, parts: [{ name, ...fields }], by: "human" });
                if (result?.ok === false) {
                    throw new Error((result.errors ?? []).map((issue) => issue.message).join("；") || T("语义校验失败"));
                }
                return result;
            }, T("已更新「{n0}」的语义", { n0: name }), activeKey);
            const anchorField = (part, key, index) => h(NumField, {
                key: `${part.name}:${key}:${index}`,
                label: T("{n0}{n1}", { n0: key === "proximal" ? T("近端") : T("远端"), n1: index === 0 ? "x" : "y" }),
                value: (part[key] ?? [0, 0])[index],
                min: 0,
                max: 1,
                step: 0.05,
                onChange: (value) => {
                    const next = [(part[key] ?? [0, 0])[0], (part[key] ?? [0, 0])[1]];
                    next[index] = value;
                    patch(part.name, { [key]: next });
                }
            });
            return h("div", { className: "SPR_rigStage", "data-testid": "rig-semantics", style: { marginTop: 12 } }, h("div", { className: "SPR_rigStageHead" }, h("span", { className: "SPR_rigStageHint", style: { flex: 1 } }, T("语义（角色 / 父级 / 锚点）：决定骨骼挂在谁身上、骨骼从部件的哪一端伸到哪一端。改这里不会动②里已经摆好的位置，只会重算③骨骼。"))), sem.errors.length > 0
                ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-error-primary)" } }, T("语义有 {n0} 处错误：", { n0: sem.errors.length }) + sem.errors.map((e) => T("{n0} {n1}", { n0: e.name || T("整体"), n1: e.message })).join(T("；")))
                : null, sem.warnings.length > 0
                ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } }, T("提示：") + sem.warnings.map((w) => T("{n0} {n1}", { n0: w.name || T("整体"), n1: w.message })).join(T("；")))
                : null, sem.errors.length === 0 && sem.warnings.length === 0
                ? h("p", { className: "SPR_hint" }, sem.ready ? T("语义已就绪，无结构问题。") : T("还没有可用部件。"))
                : null, h("div", { style: { marginTop: 8, overflowX: "auto" } }, h("table", { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse" } }, h("thead", null, h("tr", null, h("th", { style: { textAlign: "left" } }, T("部件")), h("th", { style: { textAlign: "left" } }, T("角色")), h("th", { style: { textAlign: "left" } }, T("父级")), h("th", { style: { textAlign: "left" } }, T("近端锚点")), h("th", { style: { textAlign: "left" } }, T("远端锚点")), h("th", { style: { textAlign: "left" } }, T("来源")))), h("tbody", null, parts.map((part) => h("tr", { key: part.name, "data-testid": `rig-sem-row-${part.name}` }, h("td", { style: { paddingRight: 8 } }, part.label ?? part.name), h("td", { style: { paddingRight: 8 } }, h("select", {
                className: "SPR_input",
                "data-testid": `rig-sem-role-${part.name}`,
                value: part.role ?? "accessory",
                onChange: (event) => patch(part.name, { role: event.target.value })
            }, RIG_ROLES.map((role) => h("option", { key: role.key, value: role.key }, role.label)))), h("td", { style: { paddingRight: 8 } }, h("select", {
                className: "SPR_input",
                "data-testid": `rig-sem-parent-${part.name}`,
                value: part.parent ?? "",
                onChange: (event) => patch(part.name, { parent: event.target.value === "" ? null : event.target.value })
            }, h("option", { value: "" }, T("（挂 root）")), names.filter((name) => name !== part.name).map((name) => h("option", { key: name, value: name }, name)))), h("td", { style: { paddingRight: 8, whiteSpace: "nowrap" } }, anchorField(part, "proximal", 0), anchorField(part, "proximal", 1)), h("td", { style: { paddingRight: 8, whiteSpace: "nowrap" } }, anchorField(part, "distal", 0), anchorField(part, "distal", 1)), h("td", { style: { whiteSpace: "nowrap" } }, part.semanticsSource === "human" ? T("人工") : part.semanticsSource === "ai" ? "AI" : T("默认"))))))));
        }
        /**
         * 骨骼编辑器（阶段③）——三通道模型的界面。
         *
         * 这里改的是**手工偏移 `offset`**，不是绑定姿势 `origin`：
         *   - `origin` 由②的装配位置 + 语义层的锚点算出来，每次重跑②或改语义都会被重算；
         *   - `offset` 只属于人，**任何自动重跑都不碰它**。
         *
         * 所以「重新推骨骼」不会丢掉这里调过的偏置，而「清除偏移」就是回到
         * AI/几何推出来的姿势——这正是方案里「AI 重新想一遍不会抹掉人的工作」那条。
         *
         * 三根数字：位移 x/y（部件像素）与旋转（度）。全零的条目宿主会自动删掉，
         * 所以「改回 0」等于「没调过」，不需要额外的开关。
         */
        function RigBoneEditor({ job, api, run, busy, activeKey }) {
            const bones = job.rig?.boneList ?? [];
            const offsets = job.rig?.boneOffsets ?? {};
            if (bones.length === 0) {
                return h("p", { className: "SPR_hint", style: { marginTop: 10 } }, T("还没有骨骼。先点上面的「生成骨骼与动画」——生成之后这里可以逐根微调。"));
            }
            const manualCount = Object.keys(offsets).length;
            const patch = (name, fields) => void run(() => api.setRigBoneOffsets({ jobId: job.id, bones: [{ name, ...fields }], by: "human" }), T("已调整「{n0}」", { n0: name }), activeKey);
            return h("div", { "data-testid": "rig-bone-editor", style: { marginTop: 12 } }, h("h3", { style: { fontSize: 13, margin: "0 0 4px" } }, T("骨骼手工偏移（{n0}）", { n0: manualCount > 0 ? T("已调 {n0} 根", { n0: manualCount }) : T("未调整") })), h("p", { className: "SPR_hint", style: { marginTop: 0 } }, T("这里调的是「你相对绑定姿势改了多少」，不会被重新推骨骼覆盖。位移单位是参考图像素，旋转是度。全零即视为未调整。")), h("div", { style: { marginTop: 8, maxHeight: 320, overflowY: "auto" } }, h("table", { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse" } }, h("thead", null, h("tr", null, h("th", { style: { textAlign: "left" } }, T("骨骼")), h("th", { style: { textAlign: "left" } }, T("父级")), h("th", { style: { textAlign: "left" } }, T("绑定姿势")), h("th", { style: { textAlign: "left" } }, T("手工位移 x")), h("th", { style: { textAlign: "left" } }, T("手工位移 y")), h("th", { style: { textAlign: "left" } }, T("手工旋转")), h("th", null, ""))), h("tbody", null, bones.filter((bone) => bone.name !== "root").map((bone) => {
                const offset = offsets[bone.name] ?? {};
                return h("tr", { key: bone.name, "data-testid": `rig-bone-row-${bone.name}` }, h("td", { style: { paddingRight: 8 } }, bone.name), h("td", { style: { paddingRight: 8, opacity: 0.7 } }, bone.parent ?? "root"), h("td", { style: { paddingRight: 8, opacity: 0.7, whiteSpace: "nowrap" } }, `${Math.round(bone.x)},${Math.round(bone.y)} · ${Math.round(bone.rotation)}°`), h("td", { style: { paddingRight: 8 } }, h(NumField, {
                    label: "",
                    value: offset.x ?? 0,
                    step: 1,
                    onChange: (value) => patch(bone.name, { x: value })
                })), h("td", { style: { paddingRight: 8 } }, h(NumField, {
                    label: "",
                    value: offset.y ?? 0,
                    step: 1,
                    onChange: (value) => patch(bone.name, { y: value })
                })), h("td", { style: { paddingRight: 8 } }, h(NumField, {
                    label: "",
                    value: offset.rotation ?? 0,
                    step: 1,
                    onChange: (value) => patch(bone.name, { rotation: value })
                })), h("td", null, offsets[bone.name] === undefined
                    ? h("span", { style: { opacity: 0.4 } }, "—")
                    : h("button", {
                        type: "button",
                        className: "SPR_miniBtn",
                        "data-testid": `rig-bone-reset-${bone.name}`,
                        onClick: () => void run(() => api.resetRigBoneOffsets({ jobId: job.id, names: [bone.name] }), T("已清除「{n0}」的手工偏移", { n0: bone.name }), activeKey)
                    }, T("清除"))));
            })))), manualCount > 0
                ? h("div", { className: "SPR_toolbar", style: { marginTop: 8 } }, h(BusyBtn, {
                    busy: busy,
                    busyText: T("清除中…"),
                    onClick: () => void run(() => api.resetRigBoneOffsets({ jobId: job.id }), T("已清除全部手工骨骼偏移"), activeKey)
                }, T("清除全部手工偏移（{n0} 根）", { n0: manualCount })))
                : null);
        }
        /**
         * 动画参数面板（阶段③）。
         *
         * v1 的六个预设把每一帧的角度写死在宿主源码里，「走路幅度小一点」只能改代码。
         * 这里给出两个旋钮——**幅度**（统一缩放旋转与位移）与**时长**（一个循环多久）——
         * 它们覆盖了绝大多数真实诉求，而且比一整套 K 帧编辑器便宜得多。
         *
         * 参数作用在**简写**上（归一化 curve 的阶段），时间与数值一起缩放之后再绝对化，
         * 所以控制点仍然落在正确的区间里；这个顺序在宿主侧有注释与测试盯着。
         */
        function RigAnimationPanel({ job, api, run, busy, activeKey }) {
            const presets = job.rig?.animationPresets ?? [];
            const settings = job.rig?.animationSettings ?? {};
            if (presets.length === 0)
                return null;
            const changed = Object.keys(settings).length;
            const patch = (id, fields) => void run(() => api.setRigAnimationSettings({ jobId: job.id, animations: [{ id, ...fields }], by: "human" }), T("已调整「{n0}」的动画参数", { n0: id }), activeKey);
            return h("div", { "data-testid": "rig-animation-panel", style: { marginTop: 12 } }, h("h3", { style: { fontSize: 13, margin: "0 0 4px" } }, T("动画参数（{n0}）", { n0: changed > 0 ? T("已调 {n0} 个", { n0: changed }) : T("全部为预设默认值") })), h("p", { className: "SPR_hint", style: { marginTop: 0 } }, T("幅度统一缩放旋转与位移（1 = 预设原样）；时长是一个循环的秒数。改完点上面的「生成骨骼与动画」重算。")), h("table", { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 } }, h("thead", null, h("tr", null, h("th", { style: { textAlign: "left" } }, T("动作")), h("th", { style: { textAlign: "left" } }, T("时长（秒）")), h("th", { style: { textAlign: "left" } }, T("幅度")), h("th", { style: { textAlign: "left" } }, T("状态")), h("th", null, ""))), h("tbody", null, presets.map((preset) => h("tr", { key: preset.id, "data-testid": `rig-anim-row-${preset.id}` }, h("td", { style: { paddingRight: 8 } }, T("{n0}（{n1}）", { n0: preset.label, n1: preset.id })), h("td", { style: { paddingRight: 8 } }, h(NumField, {
                label: "",
                value: preset.duration,
                min: 0.1,
                max: 10,
                step: 0.1,
                onChange: (value) => patch(preset.id, { duration: value })
            })), h("td", { style: { paddingRight: 8 } }, h(NumField, {
                label: "",
                value: preset.amplitude,
                min: 0.1,
                max: 4,
                step: 0.1,
                onChange: (value) => patch(preset.id, { amplitude: value })
            })), h("td", { style: { paddingRight: 8, opacity: 0.8 } }, (preset.enabled ? T("会生成") : T("未勾选")) +
                (preset.duration !== preset.defaultDuration ? T(" · 预设 {n0}s", { n0: preset.defaultDuration }) : "")), h("td", null, settings[preset.id] === undefined
                ? h("span", { style: { opacity: 0.4 } }, "—")
                : h("button", {
                    type: "button",
                    className: "SPR_miniBtn",
                    "data-testid": `rig-anim-reset-${preset.id}`,
                    onClick: () => void run(() => api.resetRigAnimationSettings({ jobId: job.id, ids: [preset.id] }), T("已重置「{n0}」", { n0: preset.id }), activeKey)
                }, T("重置"))))))), changed > 0
                ? h("div", { className: "SPR_toolbar", style: { marginTop: 8 } }, h(BusyBtn, {
                    busy: busy,
                    busyText: T("重置中…"),
                    onClick: () => void run(() => api.resetRigAnimationSettings({ jobId: job.id }), T("已重置全部动画参数"), activeKey)
                }, T("重置全部（{n0} 个）", { n0: changed })))
                : null);
        }
        /** 关键帧里每种轨道要编辑哪些数值字段（简写里旋转叫 `angle`）。 */
        const TRACK_VALUE_KEYS = { rotate: ["angle"], translate: ["x", "y"], scale: ["x", "y"] };
        function make_TRACK_LABELS() {
            return { rotate: T("旋转"), translate: T("位移"), scale: T("缩放") };
        }
        let TRACK_LABELS = make_TRACK_LABELS();
        /** 缓动预设。控制点是**归一化**的 4 个数（首尾锚点隐含为 0,0 / 1,1）。 */
        function make_EASING_PRESETS() {
            return [
                { id: "linear", label: T("线性"), curve: null },
                { id: "ease", label: "Ease", curve: [0.25, 0, 0.75, 1] },
                { id: "in", label: "EaseIn", curve: [0.42, 0, 1, 1] },
                { id: "out", label: "EaseOut", curve: [0, 0, 0.58, 1] },
                { id: "fast", label: "EaseFast", curve: [0.4, 0, 0.2, 1] },
                { id: "step", label: T("阶跃"), curve: "stepped" }
            ];
        }
        let EASING_PRESETS = make_EASING_PRESETS();
        function easingNameOf(curve) {
            if (curve === "stepped")
                return "step";
            if (curve === null || curve === undefined)
                return "linear";
            const found = EASING_PRESETS.find((preset) => Array.isArray(preset.curve) && preset.curve.length === 4 &&
                preset.curve.every((value, index) => Math.abs(value - curve[index]) < 1e-6));
            return found === undefined ? "custom" : found.id;
        }
        /** 在一条时间轴上按线性插值取某一时刻的值（用于「在空处加帧」时的初值）。 */
        function sampleTrack(frames, time, keys) {
            if (frames.length === 0)
                return null;
            if (time <= frames[0].time)
                return { ...frames[0] };
            const last = frames[frames.length - 1];
            if (time >= last.time)
                return { ...last };
            for (let i = 0; i + 1 < frames.length; i++) {
                const a = frames[i];
                const b = frames[i + 1];
                if (time < a.time || time > b.time)
                    continue;
                const span = b.time - a.time;
                const t = span <= 0 ? 0 : (time - a.time) / span;
                const frame = { time, curve: b.curve ?? null };
                for (const key of keys)
                    frame[key] = Number(((a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * t).toFixed(4));
                return frame;
            }
            return { ...last };
        }
        /**
         * 时间轴与关键帧编辑器（阶段⑥：动画从「参数」变成「数据」）。
         *
         * 三个取舍值得说明：
         *  1. **逐台取、整份存**。取一台动画走 `getRigAnimation`，改完整份写回
         *     `saveRigAnimation`。不做逐帧 patch——时间轴的增删改互相牵连
         *     （删一帧会同时改两个段的缓动归属），服务端再解析一遍 patch
         *     等于把同一套语义实现两遍。
         *  2. **落地时机跟着鼠标**。拖动关键帧时只改本地草稿，松手才提交；
         *     文字框失焦才提交。这与装配台一致（拖动跟手、提交少而完整）。
         *  3. **浏览器半区不自己求值**。预览仍在宿主生成的 iframe 里（它自带
         *     贝塞尔插值与骨骼叠加）。编辑提交后靠给 iframe 换一个 `?v=` 强制重载，
         *     而不是在客户端重写一套求值器——那正是方案里点名要避免的「两套实现」。
         */
        function RigTimelineEditor({ job, api, run, busy, activeKey, onRebuild }) {
            const presets = job.rig?.animationPresets ?? [];
            const customIds = job.rig?.customAnimations ?? [];
            const [animId, setAnimId] = React.useState(presets.length > 0 ? presets[0].id : "");
            const [draft, setDraft] = React.useState(null);
            const [selected, setSelected] = React.useState(null);
            const [loading, setLoading] = React.useState(false);
            const [autoRebuild, setAutoRebuild] = React.useState(true);
            const trackRef = React.useRef(null);
            const dragRef = React.useRef(null);
            const load = React.useCallback(async (id) => {
                if (id === "")
                    return;
                setLoading(true);
                try {
                    const data = await api.getRigAnimation({ jobId: job.id, id });
                    setDraft(data);
                    setSelected(null);
                }
                finally {
                    setLoading(false);
                }
            }, [api, job.id]);
            React.useEffect(() => {
                void load(animId);
            }, [animId, load, job.rig?.status]);
            /** 提交整份时间轴。`rebuild` 为真时顺带重算骨骼（本地、免费）以刷新预览。 */
            const commit = (next, label, rebuild) => {
                setDraft(next);
                void run(async () => {
                    await api.saveRigAnimation({ jobId: job.id, id: next.id, animation: next });
                    if (rebuild)
                        await api.runRigBones({ jobId: job.id });
                }, label, activeKey);
            };
            /** 复制一份可改的轨道表。 */
            const withBones = (mutate) => {
                const next = { ...draft, bones: JSON.parse(JSON.stringify(draft.bones)) };
                mutate(next.bones);
                next.updatedAt = undefined;
                return next;
            };
            const selectedFrame = (() => {
                if (selected === null || draft === null)
                    return null;
                const frames = draft.bones[selected.bone]?.[selected.kind];
                if (frames === undefined || frames[selected.index] === undefined)
                    return null;
                return { frames, frame: frames[selected.index] };
            })();
            const setFrame = (patch, label, rebuild) => {
                if (selected === null || draft === null)
                    return;
                const next = withBones((bones) => {
                    const frames = bones[selected.bone][selected.kind];
                    const frame = { ...frames[selected.index], ...patch };
                    frames[selected.index] = frame;
                    if (patch.time !== undefined) {
                        // 时间改了要重排，否则「时间递增」这条不变量当场就破了。
                        frames.sort((a, b) => a.time - b.time);
                        setSelected({ ...selected, index: frames.indexOf(frame) });
                    }
                });
                commit(next, label, rebuild);
            };
            const addFrame = (bone, kind, time) => {
                if (draft === null)
                    return;
                const keys = TRACK_VALUE_KEYS[kind];
                const frames = draft.bones[bone]?.[kind] ?? [];
                const base = sampleTrack(frames, time, keys) ?? { time, curve: null };
                const frame = { ...base, time: Number(time.toFixed(4)), curve: null };
                const next = withBones((bones) => {
                    bones[bone] = bones[bone] ?? {};
                    const list = bones[bone][kind] ?? [];
                    list.push(frame);
                    list.sort((a, b) => a.time - b.time);
                    // 末帧永远不携带 curve（它描述的是「以本帧为起点」的那一段）。
                    list[list.length - 1].curve = null;
                    bones[bone][kind] = list;
                });
                setSelected({ bone, kind, index: next.bones[bone][kind].indexOf(frame) });
                commit(next, T("已在「{n0}/{n1}」加了一帧", { n0: bone, n1: TRACK_LABELS[kind] }), autoRebuild && onRebuild !== undefined);
            };
            const removeFrame = (bone, kind, index) => {
                if (draft === null)
                    return;
                const frames = draft.bones[bone]?.[kind] ?? [];
                // 首帧（0 秒）是每条轨道的锚：没有它，0 → 首帧之间就是一段未定义的静默区。
                if (index === 0)
                    return;
                if (frames.length <= 2)
                    return;
                const next = withBones((bones) => {
                    const list = bones[bone][kind];
                    list.splice(index, 1);
                    list[list.length - 1].curve = null;
                });
                setSelected(null);
                commit(next, T("已删除「{n0}/{n1}」的第 {n2} 帧", { n0: bone, n1: TRACK_LABELS[kind], n2: index + 1 }), autoRebuild && onRebuild !== undefined);
            };
            const addTrack = (bone, kind) => {
                if (draft === null)
                    return;
                if (draft.bones[bone]?.[kind] !== undefined)
                    return;
                const keys = TRACK_VALUE_KEYS[kind];
                const start = { time: 0, curve: null };
                for (const key of keys)
                    start[key] = kind === "scale" ? 1 : 0;
                const end = { time: Number(draft.duration.toFixed(4)), curve: null };
                for (const key of keys)
                    end[key] = start[key];
                const next = withBones((bones) => {
                    bones[bone] = bones[bone] ?? {};
                    bones[bone][kind] = [start, end];
                });
                commit(next, T("已为「{n0}」加一条{n1}轨道", { n0: bone, n1: TRACK_LABELS[kind] }), false);
            };
            const removeTrack = (bone, kind) => {
                if (draft === null)
                    return;
                const next = withBones((bones) => {
                    delete bones[bone][kind];
                    if (Object.keys(bones[bone]).length === 0)
                        delete bones[bone];
                });
                setSelected(null);
                commit(next, T("已删除「{n0}/{n1}」轨道", { n0: bone, n1: TRACK_LABELS[kind] }), autoRebuild && onRebuild !== undefined);
            };
            // 拖动关键帧：单击选中，拖动改时间，松手才提交。
            React.useEffect(() => {
                if (dragRef.current === null)
                    return undefined;
                const move = (event) => {
                    const node = trackRef.current;
                    const drag = dragRef.current;
                    if (node === null || drag === null)
                        return;
                    // **手抖不算拖动**。少了这个阈值，单击选中就会把关键帧的时间改到鼠标位置——
                    // 实测：点一下 `walk` 里 0.6s 的帧，它当场变成 0.401s（那条轨道的 lane 与
                    // 鼠标位置换算出来的值）。用户只是"选中想改数值"，结果位置先跑了。
                    if (Math.abs(event.clientX - drag.startX) < 4)
                        return;
                    const rect = node.getBoundingClientRect();
                    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
                    setDraft((current) => {
                        if (current === null)
                            return current;
                        const bones = JSON.parse(JSON.stringify(current.bones));
                        const frames = bones[drag.bone][drag.kind];
                        // 不能越过左右邻居：帧顺序变了，「哪一段携带哪个缓动」就全乱了。
                        const lower = drag.index === 0 ? 0 : frames[drag.index - 1].time + 1e-3;
                        const upper = drag.index === frames.length - 1 ? current.duration : frames[drag.index + 1].time - 1e-3;
                        const time = Math.min(upper, Math.max(lower, ratio * current.duration));
                        frames[drag.index] = { ...frames[drag.index], time: Number(time.toFixed(4)) };
                        return { ...current, bones };
                    });
                };
                const up = () => {
                    const drag = dragRef.current;
                    dragRef.current = null;
                    if (drag === null)
                        return;
                    setDraft((current) => {
                        if (current !== null) {
                            void run(() => api.saveRigAnimation({ jobId: job.id, id: current.id, animation: current }), T("已移动「{n0}/{n1}」的关键帧", { n0: drag.bone, n1: TRACK_LABELS[drag.kind] }), activeKey);
                        }
                        return current;
                    });
                };
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
                return () => {
                    window.removeEventListener("mousemove", move);
                    window.removeEventListener("mouseup", up);
                };
            }, [draft, api, job.id, run, activeKey]);
            if (presets.length === 0)
                return null;
            const tracks = draft === null
                ? []
                : Object.entries(draft.bones).flatMap(([bone, kinds]) => Object.entries(kinds).map(([kind, frames]) => ({ bone, kind, frames })));
            return h("div", { "data-testid": "rig-timeline", style: { marginTop: 12 } }, h("h3", { style: { fontSize: 13, margin: "0 0 4px" } }, T("时间轴与关键帧")), h("p", { className: "SPR_hint", style: { marginTop: 0 } }, T("选一台动画后可以加/删/拖关键帧、改数值与缓动。提交后这台动画就以这份数据为准（参数滑杆不再影响它），") +
                T("「还原」可以退回预设。")), h("div", { className: "SPR_rigEditorRow" }, h("span", { className: "SPR_refRow" }, T("动作")), presets.map((preset) => h(Btn, {
                key: preset.id,
                on: animId === preset.id,
                onClick: () => setAnimId(preset.id),
                "data-testid": `rig-tl-anim-${preset.id}`
            }, T("{n0}{n1}", { n0: preset.label, n1: customIds.includes(preset.id) ? T(" ·已改") : "" })))), draft === null
                ? h("p", { className: "SPR_hint" }, loading ? T("读取中…") : T("选择一台动画开始编辑。"))
                : h("div", null, h("div", { className: "SPR_rigEditorRow" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("循环时长（秒）")), h("input", {
                    className: "SPR_input",
                    type: "number",
                    min: 0.1,
                    max: 10,
                    step: 0.1,
                    value: draft.duration,
                    "data-testid": "rig-tl-duration",
                    onChange: (event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value > 0) {
                            commit({ ...draft, duration: Math.min(10, value) }, T("已把「{n0}」的时长改为 {n1}s", { n0: animId, n1: value }), false);
                        }
                    }
                })), h(Btn, {
                    on: draft.loop === true,
                    "data-testid": "rig-tl-loop",
                    onClick: () => commit({ ...draft, loop: draft.loop !== true }, draft.loop === true ? T("已设为不循环") : T("已设为循环"), false)
                }, draft.loop === true ? T("循环") : T("一次性")), h(Chip, { kind: customIds.includes(animId) ? "ready" : "idle", text: customIds.includes(animId) ? T("已改为手工数据") : T("预设（改动后转为数据）") }), customIds.includes(animId)
                    ? h(Btn, {
                        "data-testid": "rig-tl-revert",
                        onClick: () => void run(async () => {
                            await api.resetRigAnimation({ jobId: job.id, id: animId });
                            const data = await api.getRigAnimation({ jobId: job.id, id: animId });
                            setDraft(data);
                            setSelected(null);
                            if (autoRebuild && onRebuild !== undefined)
                                await api.runRigBones({ jobId: job.id });
                        }, T("已还原「{n0}」到预设", { n0: animId }), activeKey)
                    }, T("还原到预设"))
                    : null), 
                // ── 轨道 ────────────────────────────────────────────────
                tracks.length === 0
                    ? h("p", { className: "SPR_hint" }, T("这台动画在当前部件集下没有任何轨道（预设依赖的骨骼都不存在）。"))
                    : h("div", { className: "SPR_tlWrap", "data-testid": "rig-tl-track" }, h("div", { className: "SPR_tlRuler" }, [0, 0.25, 0.5, 0.75, 1].map((ratio) => h("span", { key: ratio, className: "SPR_tlTick", style: { left: `${ratio * 100}%` } }, `${(ratio * draft.duration).toFixed(2)}s`))), tracks.map((track, trackIndex) => h("div", { key: `${track.bone}/${track.kind}`, className: "SPR_tlRow" }, h("span", { className: "SPR_tlName", title: `${track.bone} · ${TRACK_LABELS[track.kind]}` }, `${track.bone}`, h("em", { className: "SPR_tlKind" }, TRACK_LABELS[track.kind])), h("div", {
                        className: "SPR_tlLane",
                        ref: trackIndex === 0 ? trackRef : undefined,
                        onDoubleClick: (event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
                            addFrame(track.bone, track.kind, ratio * draft.duration);
                        }
                    }, track.frames.map((frame, index) => {
                        const isSelected = selected !== null && selected.bone === track.bone &&
                            selected.kind === track.kind && selected.index === index;
                        return h("button", {
                            key: index,
                            type: "button",
                            className: "SPR_tlKey",
                            "data-selected": isSelected ? "true" : undefined,
                            "data-first": index === 0 ? "true" : undefined,
                            style: { left: `${(frame.time / Math.max(0.0001, draft.duration)) * 100}%` },
                            title: `${frame.time.toFixed(2)}s`,
                            onMouseDown: (event) => {
                                event.preventDefault();
                                setSelected({ bone: track.bone, kind: track.kind, index });
                                if (index > 0)
                                    dragRef.current = { bone: track.bone, kind: track.kind, index, startX: event.clientX };
                            }
                        });
                    })), h("button", {
                        type: "button",
                        className: "SPR_miniBtn",
                        title: T("删除这条轨道"),
                        "data-testid": `rig-tl-del-track-${track.bone}-${track.kind}`,
                        onClick: () => removeTrack(track.bone, track.kind)
                    }, "×")))), 
                // ── 选中帧的编辑 ────────────────────────────────────────
                selectedFrame === null
                    ? h("p", { className: "SPR_hint", style: { marginTop: 8 } }, T("点一个关键帧来改它；在轨道空白处**双击**加一帧。首帧（0 秒）不能删——它是每条轨道的锚。"))
                    : h("div", { className: "SPR_tlEdit", "data-testid": "rig-tl-edit" }, h("strong", null, T("{n0} · {n1} · 第 {n2} 帧", { n0: selected.bone, n1: TRACK_LABELS[selected.kind], n2: selected.index + 1 })), h(NumField, {
                        label: T("时间(s)"),
                        value: selectedFrame.frame.time,
                        min: 0,
                        max: draft.duration,
                        step: 0.01,
                        onChange: (value) => setFrame({ time: value }, T("已改「{n0}」的关键帧时间", { n0: selected.bone }), false)
                    }), TRACK_VALUE_KEYS[selected.kind].map((key) => h(NumField, {
                        key,
                        label: key === "angle" ? T("角度") : key,
                        value: selectedFrame.frame[key] ?? 0,
                        step: 1,
                        onChange: (value) => setFrame({ [key]: value }, T("已改「{n0}/{n1}」的{n2}", { n0: selected.bone, n1: TRACK_LABELS[selected.kind], n2: key }), autoRebuild && onRebuild !== undefined)
                    })), h("div", { className: "SPR_rigEditorRow" }, h("span", { className: "SPR_refRow" }, T("缓动")), EASING_PRESETS.map((preset) => h(Btn, {
                        key: preset.id,
                        on: easingNameOf(selectedFrame.frame.curve) === preset.id,
                        "data-testid": `rig-tl-ease-${preset.id}`,
                        onClick: () => setFrame({ curve: Array.isArray(preset.curve) ? [...preset.curve] : preset.curve }, T("已把「{n0}」的缓动改为 {n1}", { n0: selected.bone, n1: preset.label }), autoRebuild && onRebuild !== undefined)
                    }, preset.label))), h("div", { className: "SPR_rigEditorRow" }, h(Btn, {
                        danger: true,
                        disabled: selected.index === 0 || selectedFrame.frames.length <= 2,
                        "data-testid": "rig-tl-del-frame",
                        onClick: () => removeFrame(selected.bone, selected.kind, selected.index)
                    }, T("删除这一帧")), h("span", { className: "SPR_hint" }, selected.index === 0 ? T("首帧是轨道锚点，不能删") : (selectedFrame.frames.length <= 2 ? T("每条轨道至少留两帧") : "")))), 
                // ── 加轨道 ──────────────────────────────────────────────
                h("div", { className: "SPR_rigEditorRow", style: { marginTop: 8 } }, h("span", { className: "SPR_refRow" }, T("加轨道")), h("select", {
                    className: "SPR_input",
                    "data-testid": "rig-tl-add-bone",
                    value: draft.__addBone ?? (draft.boneOrder?.[0] ?? ""),
                    onChange: (event) => setDraft({ ...draft, __addBone: event.target.value })
                }, (draft.boneOrder ?? []).map((name) => h("option", { key: name, value: name }, name))), ["rotate", "translate", "scale"].map((kind) => h(Btn, {
                    key: kind,
                    "data-testid": `rig-tl-add-${kind}`,
                    onClick: () => addTrack(draft.__addBone ?? (draft.boneOrder?.[0] ?? ""), kind)
                }, `+ ${TRACK_LABELS[kind]}`))), h("div", { className: "SPR_rigEditorRow", style: { marginTop: 8 } }, h(Btn, {
                    on: autoRebuild,
                    "data-testid": "rig-tl-autorebuild",
                    onClick: () => setAutoRebuild(!autoRebuild)
                }, autoRebuild ? T("改完自动重算预览：开") : T("改完自动重算预览：关")), h(Btn, { onClick: () => void load(animId) }, T("重新读取")), h("span", { className: "SPR_hint" }, T("重算是本地计算，免费")))));
        }
        /**
         * 拆件质检面板（阶段①②之间）。
         *
         * 它解决的问题是「拆件看起来成功了，但其实不可用」：实测同一部位会被画进多个
         * 网格格子（4 段大腿、4 只鞋、3 条袖子），而网格位置决定部件名——名字错了，
         * 靠名字推的骨架从第一根骨头起就是错的。这件事原本要等到装配完、看见
         * 「头长在脚上」才发现，那时已经花掉一次生图调用和一轮手工排查。
         *
         * 放在所有阶段之前：它同时管「拆件可不可信」与「装配准不准」，而这两件事
         * 分属①②两个阶段，塞进任一个阶段里都会让另一处看不到。
         */
        function RigQaPanel({ job, api, run, busy, activeKey }) {
            const qa = job.qa;
            if (qa === null || qa === undefined)
                return null;
            const errors = (qa.issues ?? []).filter((issue) => issue.level === "error");
            const warnings = (qa.issues ?? []).filter((issue) => issue.level !== "error");
            return h("div", { className: "SPR_rigStage", "data-testid": "rig-qa", "data-ok": qa.ok ? "true" : "false" }, h("div", { className: "SPR_rigStageHead" }, h("span", { className: "SPR_rigStageTitle" }, T("拆件质检")), h(Chip, { kind: qa.ok ? "ready" : "error", text: qa.ok ? T("可信度 {n0}%", { n0: Math.round(qa.score * 100) }) : T("不可信（{n0}%）", { n0: Math.round(qa.score * 100) }) }), h("span", { className: "SPR_rigStageHint" }, qa.summary)), errors.length === 0 && warnings.length === 0
                ? h("p", { className: "SPR_hint" }, T("没有发现重复件，装配相似度也在正常范围。"))
                : h("ul", { className: "SPR_qaList" }, [...errors, ...warnings].map((issue, index) => h("li", { key: index, "data-level": issue.level, "data-code": issue.code }, h("span", { className: "SPR_qaMsg" }, issue.message), issue.suggestion === undefined ? null : h("span", { className: "SPR_qaFix" }, `→ ${issue.suggestion}`)))), h("div", { className: "SPR_rigEditorRow", style: { marginTop: 8 } }, h(BusyBtn, {
                busy: busy,
                busyText: T("质检中…"),
                "data-testid": "rig-qa-rerun",
                onClick: () => void run(() => api.runRigQa({ jobId: job.id }), T("已重跑拆件质检"), activeKey)
            }, T("重新质检")), 
            // 「参考图里大致有几个独立部位」只能靠看图判断，所以留成手填——给不出就不做这项判断。
            h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("参考图里大约几个部位")), h("input", {
                className: "SPR_input",
                type: "number",
                min: 1,
                max: 200,
                "data-testid": "rig-qa-expected",
                defaultValue: qa.expectedParts ?? "",
                placeholder: T("看图填，可留空"),
                onBlur: (event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value) || value <= 0)
                        return;
                    void run(() => api.runRigQa({ jobId: job.id, expectedParts: value }), T("已按「{n0} 个部位」重新质检", { n0: value }), activeKey);
                }
            })), h("span", { className: "SPR_hint" }, T("填了它就能判断「部件数是不是多出来了」——多出来的多半是重复件"))));
        }
        /**
         * IK 约束编辑器（M5）。
         *
         * 「把一只手约束到目标点，拖动目标点时手跟随」——约束本身在这里设，
         * 而**拖动在预览页里做**（那里有真实的求值器，改一个数字看不出来对不对）。
         * 所以这个面板刻意做得很薄：选链末端、起个目标名、调弯曲方向与软 IK 权重，
         * 剩下的事交给上面那个预览的拖拽。
         */
        function RigConstraintPanel({ job, api, run, busy, activeKey }) {
            const constraints = job.rig?.constraints ?? [];
            const boneChoices = (job.rig?.boneList ?? []).map((bone) => bone.name).filter((name) => name !== "root");
            const [bone, setBone] = React.useState("");
            const [chain, setChain] = React.useState(1);
            if (boneChoices.length === 0)
                return null;
            const currentBone = bone === "" ? boneChoices[boneChoices.length - 1] : bone;
            const write = (patches, label) => void run(async () => {
                await api.setRigConstraints({ jobId: job.id, constraints: patches, by: "human" });
                // 约束是结构改动 → 骨架必须重算，否则预览里那个目标点根本不存在。
                await api.runRigBones({ jobId: job.id });
            }, label, activeKey);
            return h("div", { "data-testid": "rig-constraints", style: { marginTop: 12 } }, h("h3", { style: { fontSize: 13, margin: "0 0 4px" } }, T("IK 约束（{n0}）", { n0: constraints.length > 0 ? T("{n0} 条", { n0: constraints.length }) : T("无") })), h("p", { className: "SPR_hint", style: { marginTop: 0 } }, T("把一条骨骼链约束到一个**可拖的目标点**：在下面的预览里拖那个青色菱形，手就跟着走。") +
                T("链长 1 = 末端骨 + 它的父级（两骨余弦定理）；权重小于 1 是软 IK。")), constraints.length > 0
                ? h("table", { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 } }, h("thead", null, h("tr", null, h("th", { style: { textAlign: "left" } }, T("名称")), h("th", { style: { textAlign: "left" } }, T("链末端骨骼")), h("th", { style: { textAlign: "left" } }, T("目标点")), h("th", { style: { textAlign: "left" } }, T("链长")), h("th", { style: { textAlign: "left" } }, T("弯曲")), h("th", { style: { textAlign: "left" } }, T("权重")), h("th", null, ""))), h("tbody", null, constraints.map((entry) => h("tr", { key: entry.name, "data-testid": `rig-ik-row-${entry.name}` }, h("td", null, entry.name), h("td", null, entry.bone), h("td", null, entry.target), h("td", null, h(NumField, {
                    label: "",
                    value: entry.chain,
                    min: 1,
                    max: 1,
                    step: 1,
                    onChange: (value) => write([{ name: entry.name, bone: entry.bone, target: entry.target, chain: value, bendPositive: entry.bendPositive, weight: entry.weight }], T("已改「{n0}」的链长", { n0: entry.name }))
                })), h("td", null, h(Btn, {
                    on: entry.bendPositive === true,
                    "data-testid": `rig-ik-bend-${entry.name}`,
                    onClick: () => write([{ name: entry.name, bone: entry.bone, target: entry.target, chain: entry.chain, bendPositive: entry.bendPositive !== true, weight: entry.weight }], T("已切换弯曲方向"))
                }, entry.bendPositive === true ? T("正向") : T("反向"))), h("td", null, h(NumField, {
                    label: "",
                    value: entry.weight,
                    min: 0,
                    max: 1,
                    step: 0.1,
                    onChange: (value) => write([{ name: entry.name, bone: entry.bone, target: entry.target, chain: entry.chain, bendPositive: entry.bendPositive, weight: value }], T("已把「{n0}」的权重改为 {n1}", { n0: entry.name, n1: value }))
                })), h("td", null, h(Btn, {
                    danger: true,
                    "data-testid": `rig-ik-del-${entry.name}`,
                    onClick: () => void run(async () => {
                        await api.resetRigConstraints({ jobId: job.id, names: [entry.name] });
                        await api.runRigBones({ jobId: job.id });
                    }, T("已删除约束「{n0}」", { n0: entry.name }), activeKey)
                }, T("删除")))))))
                : null, h("div", { className: "SPR_rigEditorRow", style: { marginTop: 8 } }, h("span", { className: "SPR_refRow" }, T("加约束")), h("select", {
                className: "SPR_input",
                "data-testid": "rig-ik-bone",
                value: currentBone,
                onChange: (event) => setBone(event.target.value)
            }, boneChoices.map((name) => h("option", { key: name, value: name }, name))), h(NumField, { label: T("链长"), value: chain, min: 1, max: 4, step: 1, onChange: setChain }), h(Btn, {
                primary: true,
                "data-testid": "rig-ik-add",
                onClick: () => {
                    const name = `ik-${currentBone}`;
                    write([{ name, bone: currentBone, target: `${name}-target`, chain, bendPositive: true, weight: 1 }], T("已为「{n0}」加 IK 约束", { n0: currentBone }));
                }
            }, T("加到这条链上")), h("span", { className: "SPR_hint" }, T("目标点会自动补一根骨骼，位置就在链末端"))), constraints.length > 0
                ? h("div", { className: "SPR_rigEditorRow" }, h(Btn, {
                    "data-testid": "rig-ik-clear",
                    onClick: () => void run(async () => {
                        await api.resetRigConstraints({ jobId: job.id });
                        await api.runRigBones({ jobId: job.id });
                    }, T("已清空全部 IK 约束"), activeKey)
                }, T("清空全部")))
                : null);
        }
        /**
         * 蒙皮网格与 FFD 变形面板（M5 的 L1 / L3）。
         *
         * 面板刻意做得很薄：网格密度、摆幅、循环时长、固定端四个旋钮 + 一个「给裙摆加飘动」
         * 的快捷键。**逐帧拖顶点**的编辑器不在这里——那要在对齐了网格的画布上做，
         * 而画布在预览 iframe 里；先让「裙摆飘起来」有个一键入口，比先做全套编辑器更有用。
         */
        function RigMeshPanel({ job, api, run, busy, activeKey }) {
            const meshes = job.rig?.meshes ?? {};
            const deforms = job.rig?.deforms ?? {};
            const boneNames = (job.rig?.boneList ?? []).map((bone) => bone.name).filter((name) => name !== "root");
            const [pick, setPick] = React.useState("");
            if (boneNames.length === 0)
                return null;
            const targets = Object.keys(meshes);
            const current = pick === "" ? (targets[0] ?? boneNames[boneNames.length - 1]) : pick;
            const sizeOf = (name) => {
                const part = job.parts.find((entry) => entry.name === name);
                return Math.max(8, Math.round(Math.min(part?.width ?? 80, part?.height ?? 80) * 0.08));
            };
            const write = (name, patch) => void run(async () => {
                await api.setRigMesh({ jobId: job.id, meshes: [{ name, ...patch }], by: "human" });
                // 网格会改变附件的**类型**（region → mesh），骨骼与图集都得重做。
                await api.runRigBones({ jobId: job.id });
            }, T("已更新「{n0}」的网格", { n0: name }), activeKey);
            return h("div", { "data-testid": "rig-mesh", style: { marginTop: 12 } }, h("h3", { style: { fontSize: 13, margin: "0 0 4px" } }, T("蒙皮网格（{n0}）", { n0: targets.length > 0 ? T("{n0} 个部件已细分", { n0: targets.length }) : T("无") })), h("p", { className: "SPR_hint", style: { marginTop: 0 } }, T("把部件切成网格之后就能对顶点做 FFD 变形——裙摆、披风、长发这类「上缘不动、下缘甩出去」") +
                T("用刚体骨骼是动不出来的。网格是规则三角化，密度越高越软，预览也越吃性能。")), targets.length > 0
                ? h("table", { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 } }, h("thead", null, h("tr", null, h("th", { style: { textAlign: "left" } }, T("部件")), h("th", { style: { textAlign: "left" } }, T("列=行")), h("th", { style: { textAlign: "left" } }, T("摆幅")), h("th", { style: { textAlign: "left" } }, T("循环(s)")), h("th", { style: { textAlign: "left" } }, T("固定端")), h("th", null, ""))), h("tbody", null, targets.map((name) => {
                    const spec = meshes[name];
                    const wave = deforms[name];
                    return h("tr", { key: name, "data-testid": `rig-mesh-row-${name}` }, h("td", null, name), h("td", null, h(NumField, {
                        label: "", value: spec.cols, min: 1, max: 16, step: 1,
                        onChange: (value) => write(name, { cols: value, rows: value })
                    })), h("td", null, wave === undefined
                        ? h("button", {
                            type: "button", className: "SPR_miniBtn",
                            "data-testid": `rig-mesh-wave-${name}`,
                            onClick: () => write(name, { deform: { amplitude: sizeOf(name) } })
                        }, T("加飘动"))
                        : h(NumField, {
                            label: "", value: wave.amplitude, min: 0, max: 200, step: 1,
                            onChange: (value) => write(name, { deform: { ...wave, amplitude: value } })
                        })), h("td", null, wave === undefined ? h("span", { style: { opacity: 0.4 } }, "—")
                        : h(NumField, {
                            label: "", value: wave.duration, min: 0.2, max: 6, step: 0.1,
                            onChange: (value) => write(name, { deform: { ...wave, duration: value } })
                        })), h("td", null, wave === undefined ? h("span", { style: { opacity: 0.4 } }, "—")
                        : h("select", {
                            className: "SPR_input",
                            "data-testid": `rig-mesh-anchor-${name}`,
                            value: wave.anchor,
                            onChange: (event) => write(name, { deform: { ...wave, anchor: event.target.value } })
                        }, h("option", { value: "top" }, T("上缘")), h("option", { value: "bottom" }, T("下缘")), h("option", { value: "none" }, T("整体")))), h("td", null, h(Btn, {
                        danger: true,
                        "data-testid": `rig-mesh-del-${name}`,
                        onClick: () => void run(async () => {
                            await api.resetRigMesh({ jobId: job.id, names: [name] });
                            await api.runRigBones({ jobId: job.id });
                        }, T("已取消「{n0}」的网格", { n0: name }), activeKey)
                    }, T("取消"))));
                })))
                : null, h("div", { className: "SPR_rigEditorRow", style: { marginTop: 8 } }, h("span", { className: "SPR_refRow" }, T("加网格")), h("select", {
                className: "SPR_input",
                "data-testid": "rig-mesh-pick",
                value: current,
                onChange: (event) => setPick(event.target.value)
            }, boneNames.map((name) => h("option", { key: name, value: name }, name))), h(Btn, {
                primary: true,
                "data-testid": "rig-mesh-add",
                onClick: () => write(current, { cols: 6, rows: 6 })
            }, T("细分这个部件")), 
            // 一键入口：用户想的是「让裙摆飘起来」，不是「给我一个 6×6 网格」。
            h(Btn, {
                "data-testid": "rig-mesh-skirt",
                onClick: () => {
                    const skirt = boneNames.find((name) => name === "hip") ?? boneNames[boneNames.length - 1];
                    write(skirt, { cols: 6, rows: 6, deform: { amplitude: 12, cycles: 1, direction: 0, anchor: "top", duration: 1.6 } });
                }
            }, T("给裙摆加飘动")), h("span", { className: "SPR_hint" }, T("网格与变形都是本地计算，免费"))), targets.length > 0
                ? h("div", { className: "SPR_rigEditorRow" }, h(Btn, {
                    "data-testid": "rig-mesh-clear",
                    onClick: () => void run(async () => {
                        await api.resetRigMesh({ jobId: job.id });
                        await api.runRigBones({ jobId: job.id });
                    }, T("已清除全部网格与变形"), activeKey)
                }, T("清空全部")))
                : null);
        }
        /**
         * Path 约束面板（M5）。
         *
         * 「沿一条折线铺开一串骨」的用户想的是「让尾巴/辫子沿着这条曲线」，不是「给我
         * 一串坐标」。所以这里不让人手输点：选一根**末端骨** + 链长，默认路径就沿着
         * 这些部件的近端锚点生成；要更细的形状再走脚本/对话入口改 points。
         */
        function RigPathPanel({ job, api, run, busy, activeKey }) {
            const paths = job.rig?.paths ?? {};
            const boneList = job.rig?.boneList ?? [];
            const boneNames = boneList.map((bone) => bone.name).filter((name) => name !== "root");
            const [tip, setTip] = React.useState("");
            const [depth, setDepth] = React.useState(2);
            const [spacing, setSpacing] = React.useState(0);
            if (boneNames.length === 0)
                return null;
            const currentTip = tip === "" ? boneNames[boneNames.length - 1] : tip;
            // 从末端骨沿父级往上取 count 根，再反转成「从根到末端」——Spine 与 DragonBones
            // 都按这个顺序理解骨链。
            const chainOf = (name, count) => {
                const out = [name];
                let cursor = name;
                for (let i = 0; i < count; i++) {
                    const bone = boneList.find((entry) => entry.name === cursor);
                    if (bone?.parent === undefined || bone.parent === "root")
                        break;
                    cursor = bone.parent;
                    out.unshift(cursor);
                }
                return out;
            };
            // 路径点用部件的**近端锚点**（顶端中点）——骨骼原点就落在那里。
            //
            // 位置取自 `layout.items` 而**不是** `parts`：后者只有尺寸没有坐标，拿它算会得到
            // 一串 NaN，然后被 wire 的 z.number() 挡下（表现是「点了按钮没反应、也没报错」）。
            const pointsOf = (chain) => chain.flatMap((name) => {
                const item = job.layout?.items?.[name];
                if (item === undefined)
                    return [];
                return [Math.round(item.x + item.width / 2), Math.round(item.y)];
            });
            const write = (name, patch, label) => void run(async () => {
                await api.setRigPath({ jobId: job.id, paths: [{ name, ...patch }], by: "human" });
                await api.runRigBones({ jobId: job.id });
            }, label, activeKey);
            const entries = Object.entries(paths);
            return h("div", { "data-testid": "rig-paths", style: { marginTop: 12 } }, h("h3", { style: { fontSize: 13, margin: "0 0 4px" } }, T("Path 约束（{n0}）", { n0: entries.length > 0 ? T("{n0} 条", { n0: entries.length }) : T("无") })), h("p", { className: "SPR_hint", style: { marginTop: 0 } }, T("把一串骨骼沿折线按弧长铺开——尾巴、辫子这类「长度远超单根骨」的部件用它。") +
                T("间距 0 表示均匀铺满整条路径；大于 0 就是固定间距，骨骼只覆盖路径的一段。")), entries.length > 0
                ? h("table", { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 } }, h("thead", null, h("tr", null, h("th", { style: { textAlign: "left" } }, T("名称")), h("th", { style: { textAlign: "left" } }, T("骨链")), h("th", { style: { textAlign: "left" } }, T("间距")), h("th", { style: { textAlign: "left" } }, T("旋转混合")), h("th", null, ""))), h("tbody", null, entries.map(([name, entry]) => h("tr", { key: name, "data-testid": `rig-path-row-${name}` }, h("td", null, name), h("td", { style: { maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" } }, entry.bones.join(" → ")), h("td", null, h(NumField, {
                    label: "", value: entry.spacing, min: 0, max: 400, step: 1,
                    onChange: (value) => write(name, { points: entry.points, bones: entry.bones, spacing: value, translateMix: entry.translateMix, rotateMix: entry.rotateMix }, T("已改「{n0}」的间距", { n0: name }))
                })), h("td", null, h(NumField, {
                    label: "", value: entry.rotateMix, min: 0, max: 1, step: 0.1,
                    onChange: (value) => write(name, { points: entry.points, bones: entry.bones, spacing: entry.spacing, translateMix: entry.translateMix, rotateMix: value }, T("已改「{n0}」的旋转混合", { n0: name }))
                })), h("td", null, h(Btn, {
                    danger: true,
                    "data-testid": `rig-path-del-${name}`,
                    onClick: () => void run(async () => {
                        await api.resetRigPath({ jobId: job.id, names: [name] });
                        await api.runRigBones({ jobId: job.id });
                    }, T("已删除路径「{n0}」", { n0: name }), activeKey)
                }, T("删除")))))))
                : null, h("div", { className: "SPR_rigEditorRow", style: { marginTop: 8 } }, h("span", { className: "SPR_refRow" }, T("加路径")), h("select", {
                className: "SPR_input",
                "data-testid": "rig-path-tip",
                value: currentTip,
                onChange: (event) => setTip(event.target.value)
            }, boneNames.map((name) => h("option", { key: name, value: name }, name))), h(NumField, { label: T("链长"), value: depth, min: 1, max: 6, step: 1, onChange: setDepth }), h(NumField, { label: T("间距"), value: spacing, min: 0, max: 400, step: 1, onChange: setSpacing }), h(Btn, {
                primary: true,
                "data-testid": "rig-path-add",
                onClick: () => {
                    const chain = chainOf(currentTip, depth);
                    const points = pointsOf(chain);
                    if (points.length < 4)
                        return;
                    write(`path-${currentTip}`, { points, bones: chain, spacing, translateMix: 1, rotateMix: 1 }, T("已沿「{n0}」加路径", { n0: chain.join(" → ") }));
                }
            }, T("沿这条链加路径")), h("span", { className: "SPR_hint" }, T("默认路径沿这些部件的近端锚点生成"))), entries.length > 0
                ? h("div", { className: "SPR_rigEditorRow" }, h(Btn, {
                    "data-testid": "rig-path-clear",
                    onClick: () => void run(async () => {
                        await api.resetRigPath({ jobId: job.id });
                        await api.runRigBones({ jobId: job.id });
                    }, T("已清空全部路径约束"), activeKey)
                }, T("清空全部")))
                : null);
        }
        /** 一行滑杆（换色面板用）。 */
        function RangeRow({ label, value, min, max, step, onChange }) {
            return h("label", { className: "SPR_field", style: { minWidth: 150 } }, h("span", { className: "SPR_fieldLabel" }, `${label} ${value}`), h("input", {
                type: "range",
                min,
                max,
                step: step === undefined ? 1 : step,
                value,
                style: { width: "100%" },
                onChange: (event) => onChange(Number(event.target.value))
            }));
        }
        /** 换色草稿的默认值（1 = 原样）。 */
        const IDENTITY_TINT = { hue: 0, saturation: 1, lightness: 0, brightness: 0, contrast: 1 };
        /** 把换色草稿表达成 CSS filter，用在缩略图上做**即时预览**。 */
        function tintToCssFilter(tint) {
            const parts = [];
            if (tint.hue)
                parts.push(`hue-rotate(${tint.hue}deg)`);
            if (tint.saturation !== 1)
                parts.push(`saturate(${tint.saturation})`);
            if (tint.brightness)
                parts.push(`brightness(${1 + tint.brightness})`);
            if (tint.contrast !== 1)
                parts.push(`contrast(${tint.contrast})`);
            return parts.length === 0 ? undefined : parts.join(" ");
        }
        /**
         * 贴图变体面板（阶段①，服务阶段②之后的一切）。
         *
         * 参考项目 reskin-app 把「回退原图」做成了一个特例（一个小 JSON + 重打包时查表），
         * 而且它的滑杆只存在内存里、**画布上看不到变化**（只在 export 时才烘焙）。
         * 这里做成通用机制：
         *   - 每一次换色 / 上传替换都**新增一个版本**，永不覆盖原图；
         *   - 「换回原版」就是切 `activeTexture`，成本为零；
         *   - 拖动滑杆时缩略图用 CSS filter **即时预览**，点「应用」才落成新版本。
         *
         * 之所以最终是「烤成新版本」而不是每次渲染实时算：渲染发生在浏览器（预览）
         * 与宿主（合成图/图集）两处，各自实现一遍着色只会让两边漂移。
         */
        function RigTexturePanel({ job, api, run, busy, activeKey, selected, onSelect, keyBusy }) {
            const parts = (job.parts ?? []).filter((part) => part.status === "ready");
            const [draft, setDraft] = React.useState(IDENTITY_TINT);
            const [target, setTarget] = React.useState(null);
            const [redrawPrompt, setRedrawPrompt] = React.useState("");
            if (parts.length === 0)
                return null;
            const current = target !== null && parts.some((part) => part.name === target)
                ? target
                : (selected !== null && parts.some((part) => part.name === selected) ? selected : parts[0].name);
            const part = parts.find((entry) => entry.name === current);
            const versions = part?.versions ?? [];
            const activeVersion = part?.activeTexture ?? versions[versions.length - 1]?.v ?? 1;
            const isIdentity = JSON.stringify(draft) === JSON.stringify(IDENTITY_TINT);
            const pick = (name) => {
                setTarget(name);
                if (onSelect !== undefined)
                    onSelect(name);
            };
            const applyTint = () => void run(() => api.tintRigParts({ jobId: job.id, names: [current], tint: draft, by: "human", note: describeTint(draft) }), T("已给「{n0}」换色（新增一版）", { n0: current }), activeKey);
            return h("div", { className: "SPR_rigStage", "data-testid": "rig-texture-panel", style: { marginTop: 12 } }, h("div", { className: "SPR_rigStageHead" }, h("span", { className: "SPR_rigStageTitle" }, T("贴图变体")), h("span", { className: "SPR_rigStageHint", style: { flex: 1 } }, T("每一次换色 / 上传替换都新增一个版本，永不覆盖原图；「换回原版」就是切版本。"))), h("div", { className: "SPR_rigEditorRow", style: { marginTop: 8 } }, h("span", { className: "SPR_refRow" }, T("部件")), h("select", {
                className: "SPR_input",
                "data-testid": "rig-texture-part",
                value: current,
                onChange: (event) => pick(event.target.value)
            }, parts.map((entry) => h("option", { key: entry.name, value: entry.name }, entry.label ?? entry.name))), h("span", { className: "SPR_hint" }, T("当前 v{n0}{n1}", { n0: activeVersion, n1: noteSuffix(versions.find((v) => v.v === activeVersion)?.note) }))), 
            // 版本列表：点一下切过去，这就是「回退原版」。
            h("div", { className: "SPR_rigEditorRow", "data-testid": "rig-texture-versions" }, h("span", { className: "SPR_refRow" }, T("版本")), versions.map((version) => h("span", { key: version.v, className: "SPR_refRow", style: { display: "inline-flex", alignItems: "center", gap: 4 } }, h("button", {
                type: "button",
                className: "SPR_miniBtn",
                "data-testid": `rig-tex-v${version.v}`,
                "data-active": version.v === activeVersion ? "true" : "false",
                style: version.v === activeVersion ? { borderColor: "var(--dsw-alias-state-business-primary)" } : undefined,
                onClick: () => void run(() => api.setRigTextureVersion({ jobId: job.id, name: current, version: version.v }), T("已切到 v{n0}", { n0: version.v }), activeKey)
            }, `v${version.v}${noteSuffix(version.note)}`), versions.length > 1 && version.v !== activeVersion
                ? h("button", {
                    type: "button",
                    className: "SPR_miniBtn",
                    title: T("删除这一版"),
                    onClick: () => void run(() => api.removeRigTextureVersion({ jobId: job.id, name: current, version: version.v }), T("已删除 v{n0}", { n0: version.v }), activeKey)
                }, "×")
                : null))), 
            // 即时预览 + 换色滑杆
            h("div", { className: "SPR_rigEditorRow", style: { alignItems: "flex-start", marginTop: 8 } }, part?.url !== null && part?.url !== undefined
                ? h("img", {
                    src: part.url,
                    alt: current,
                    "data-testid": "rig-texture-preview",
                    style: {
                        width: 110,
                        height: 110,
                        objectFit: "contain",
                        border: "1px solid var(--dsw-alias-border-l2)",
                        borderRadius: 8,
                        filter: tintToCssFilter(draft)
                    }
                })
                : null, h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, flex: 1 } }, h(RangeRow, { label: T("色相"), value: draft.hue, min: -180, max: 180, step: 5, onChange: (value) => setDraft({ ...draft, hue: value }) }), h(RangeRow, { label: T("饱和度"), value: draft.saturation, min: 0, max: 3, step: 0.1, onChange: (value) => setDraft({ ...draft, saturation: value }) }), h(RangeRow, { label: T("明度"), value: draft.lightness, min: -1, max: 1, step: 0.05, onChange: (value) => setDraft({ ...draft, lightness: value }) }), h(RangeRow, { label: T("亮度"), value: draft.brightness, min: -1, max: 1, step: 0.05, onChange: (value) => setDraft({ ...draft, brightness: value }) }), h(RangeRow, { label: T("对比"), value: draft.contrast, min: 0, max: 3, step: 0.1, onChange: (value) => setDraft({ ...draft, contrast: value }) }))), h("div", { className: "SPR_rigEditorRow" }, h(BusyBtn, {
                busy: busy,
                busyText: T("换色中…"),
                primary: true,
                disabled: isIdentity,
                "data-testid": "rig-texture-apply",
                onClick: applyTint
            }, T("应用换色（新增一版）")), h(Btn, { onClick: () => setDraft(IDENTITY_TINT), disabled: isIdentity }, T("重置滑杆")), h("label", { className: "SPR_refRow", style: { display: "inline-flex", gap: 6, alignItems: "center" } }, T("上传替换"), h("input", {
                type: "file",
                accept: "image/png,image/jpeg,image/webp",
                "data-testid": "rig-texture-upload",
                onChange: (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file === undefined)
                        return;
                    const reader = new FileReader();
                    reader.onload = () => {
                        const raw = String(reader.result ?? "");
                        const base64 = raw.slice(raw.indexOf(",") + 1);
                        void run(() => api.uploadRigTexture({ jobId: job.id, name: current, data: base64, note: T("手工上传") }), T("已上传「{n0}」的新贴图", { n0: current }), activeKey);
                    };
                    reader.readAsDataURL(file);
                }
            })), h("span", { className: "SPR_hint" }, isIdentity ? "" : T("滑杆只是预览，点「应用换色」才落成新版本"))), 
            // AI 重绘：**花钱**，所以按钮文案直说，并且可以随时切回上一版。
            h("div", { className: "SPR_rigEditorRow", style: { marginTop: 6 } }, h("input", {
                className: "SPR_input",
                style: { flex: 1, minWidth: 180 },
                "data-testid": "rig-redraw-prompt",
                placeholder: T("想让这块变成什么样？（例如「换成深蓝色布料」「加上金属高光」）"),
                value: redrawPrompt,
                onChange: (event) => setRedrawPrompt(event.target.value)
            }), h(BusyBtn, {
                busy: keyBusy(K_RIG_REDRAW),
                busyText: T("正在重绘…"),
                disabled: redrawPrompt.trim() === "" || busy,
                "data-testid": "rig-redraw-run",
                onClick: () => void run(() => api.runRigRedraw({ jobId: job.id, name: current, prompt: redrawPrompt.trim() }), T("已提交 AI 重绘（会花钱）"), K_RIG_REDRAW)
            }, T("AI 重绘这一块（会花钱）")), h("span", { className: "SPR_hint" }, T("重绘结果是一版新的贴图：轮廓按原样裁回，不满意切回上一版即可"))));
        }
        /** 把草稿说成人话，写进版本的 note（回退时能看懂哪一版是什么）。 */
        function describeTint(tint) {
            const bits = [];
            if (tint.hue)
                bits.push(T("色相{n0}{n1}°", { n0: tint.hue > 0 ? "+" : "", n1: tint.hue }));
            if (tint.saturation !== 1)
                bits.push(T("饱和×{n0}", { n0: tint.saturation }));
            if (tint.lightness)
                bits.push(T("明度{n0}{n1}", { n0: tint.lightness > 0 ? "+" : "", n1: tint.lightness }));
            if (tint.brightness)
                bits.push(T("亮度{n0}{n1}", { n0: tint.brightness > 0 ? "+" : "", n1: tint.brightness }));
            if (tint.contrast !== 1)
                bits.push(T("对比×{n0}", { n0: tint.contrast }));
            return bits.join(" ") || T("换色");
        }
        /**
         * 版本说明的后缀。
         *
         * ⚠️ 宿主视图对可选字符串写的是 `?? null`，所以这里**必须同时容忍 null 与
         * undefined**。只判 `=== undefined` 的话，界面上会原样显示「v1 · null」——
         * 这类「字段存在但值为 null」的坑在本项目踩过不止一次。
         */
        function noteSuffix(note) {
            return typeof note === "string" && note.trim() !== "" ? ` · ${note}` : "";
        }
        /** 装配台的缩放范围与每档滚轮的倍率。 */
        const RIG_ZOOM_MIN = 0.25;
        const RIG_ZOOM_MAX = 6;
        const RIG_ZOOM_STEP = 1.12;
        const RIG_HANDLES = [["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0],
            ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1],
            ["sw", 0, 1], ["w", 0, 0.5]
        ];
        const RIG_SNAP_PX = 6;
        function RigAssemblyEditor({ job, api, run, busy, activeKey }) {
            const canvasW = Math.max(1, job.canvas?.width ?? 1);
            const canvasH = Math.max(1, job.canvas?.height ?? 1);
            const serverItems = job.layout?.items ?? {};
            const scaleHint = job.layout?.hint ?? 0.5;
            const [draft, setDraft] = React.useState({});
            const [selected, setSelected] = React.useState(null);
            const [drag, setDrag] = React.useState(null);
            const [zoom, setZoom] = React.useState(1);
            const [pan, setPan] = React.useState(null);
            const [spaceDown, setSpaceDown] = React.useState(false);
            const [stageWidth, setStageWidth] = React.useState(0);
            const [showReference, setShowReference] = React.useState(false);
            const [showBoxes, setShowBoxes] = React.useState(true);
            const [snapEnabled, setSnapEnabled] = React.useState(true);
            const [guides, setGuides] = React.useState([]);
            const [history, setHistory] = React.useState([]);
            const [future, setFuture] = React.useState([]);
            const [lockRatio, setLockRatio] = React.useState(true);
            const wrapRef = React.useRef(null);
            const stageRef = React.useRef(null);
            // 换了任务：本地草稿、撤销栈、重做栈一起清掉。
            React.useEffect(() => {
                setDraft({});
                setHistory([]);
                setFuture([]);
            }, [job.id]);
            // 服务器状态变了（提交完成）就把本地草稿清掉，以服务端结果为准。
            //
            // **但这里不能顺手清历史**：`commit()` 自己就会写盘并让 `updatedAt` 变化，
            // 早先把两个 effect 合成一个、依赖 [job.id, job.updatedAt]，结果是每提交一次
            // 就立刻清空撤销栈——「撤销」按钮永远是灰的，Ctrl+Z 也永远没反应。
            React.useEffect(() => {
                setDraft({});
            }, [job.updatedAt]);
            // 本地草稿里写的 `placed` 是「操作意图」，而决定图层显隐、已放置计数的是
            // `matched`（宿主也是读 `placed` 再写回 `matched` 的，见 riggen.saveRigLayoutItems）。
            // 不在合并时对齐这两个键，Delete 收回、从部件栏拖入这类**纯本地**改动就完全看不出效果：
            // commit 写了 placed，过滤条件读的却是 matched。宿主回包之前界面一动不动，
            // 而一旦通信失败（比如宿主半区还没重启）用户就会以为整个手动装配是坏的。
            const withLocalIntent = (local) => local === undefined || local.placed === undefined ? local : { ...local, matched: local.placed !== false };
            /** 合并后的摆放表：服务器结果 + 本地未提交的改动。 */
            const items = React.useMemo(() => {
                const merged = {};
                for (const part of job.parts ?? []) {
                    const base = serverItems[part.name];
                    const local = withLocalIntent(draft[part.name]);
                    if (base === undefined && local === undefined)
                        continue;
                    merged[part.name] = {
                        x: 0, y: 0, width: 1, height: 1, rotation: 0, z: 0, matched: true, manual: false,
                        ...(base ?? defaultItemOf(part, scaleHint)),
                        ...(local ?? {})
                    };
                }
                for (const [name, raw] of Object.entries(draft)) {
                    if (merged[name] !== undefined)
                        continue;
                    const part = (job.parts ?? []).find((entry) => entry.name === name);
                    if (part === undefined)
                        continue;
                    merged[name] = { ...defaultItemOf(part, scaleHint), ...withLocalIntent(raw) };
                }
                return merged;
            }, [job.parts, serverItems, draft, scaleHint]);
            const placedNames = Object.keys(items)
                .filter((name) => items[name].matched !== false)
                .sort((a, b) => (items[a].z ?? 0) - (items[b].z ?? 0) || a.localeCompare(b));
            const unplaced = (job.parts ?? []).filter((part) => part.status === "ready" && items[part.name]?.matched === false);
            const notYetPlaced = (job.parts ?? []).filter((part) => part.status === "ready" && items[part.name] === undefined);
            React.useEffect(() => {
                const measure = () => {
                    if (stageRef.current !== null)
                        setStageWidth(stageRef.current.clientWidth);
                };
                measure();
                window.addEventListener("resize", measure);
                return () => window.removeEventListener("resize", measure);
            }, []);
            // 「适应」要同时按宽和高算：只按宽的话，一张 550×978 的立绘在宽屏上会被放到
            // 两倍宽、远超舞台可见高度，用户看到的是「画布一半在屏幕外」，连部件栏拖进去
            // 都找不到落点。舞台的可见高度按视口估一个 62%（与 CSS 的 max-height 对齐）。
            const stageHeight = typeof window === "undefined" ? 0 : window.innerHeight * 0.62;
            const fitScale = stageWidth > 0 && canvasH > 0
                ? Math.min(stageWidth / canvasW, stageHeight > 0 ? stageHeight / canvasH : Number.POSITIVE_INFINITY)
                : 0;
            const scale = fitScale * zoom;
            const selectedItem = selected === null ? undefined : items[selected];
            const selectedPart = selected === null ? undefined : (job.parts ?? []).find((part) => part.name === selected);
            // ── 视图：滚轮以光标为锚缩放，空格/中键拖动平移 ──────────────────
            //
            // 平移**不引入额外的变换层**，而是直接用舞台自身的滚动：这样坐标系只有
            // 一个（`scale`），命中测试、对齐参考线、拖拽全都不用改；
            // 代价是要正确处理「缩放后把同一个画布点重新对齐回光标」。
            const zoomRef = React.useRef(1);
            zoomRef.current = zoom;
            const stageNode = () => stageRef.current;
            const pendingScroll = React.useRef(null);
            React.useEffect(() => {
                const node = stageNode();
                const pending = pendingScroll.current;
                if (node === null || pending === null)
                    return;
                pendingScroll.current = null;
                if ("fit" in pending) {
                    node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
                    node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
                    return;
                }
                // 把同一个内容点重新压回光标位置——少了这一步，缩放会以左上角为
                // 锚点，光标底下的东西会跑掉。
                node.scrollLeft = pending.localX * pending.ratio - pending.offsetX;
                node.scrollTop = pending.localY * pending.ratio - pending.offsetY;
            }, [zoom]);
            const zoomAt = React.useCallback((factor, clientX, clientY) => {
                const stageEl = stageNode();
                const current = zoomRef.current;
                const next = Math.min(RIG_ZOOM_MAX, Math.max(RIG_ZOOM_MIN, current * factor));
                if (stageEl === null || Math.abs(next - current) < 1e-4) {
                    zoomRef.current = next;
                    setZoom(next);
                    return;
                }
                const rect = stageEl.getBoundingClientRect();
                // 光标下的点在**可滚动内容**里的位置（含 padding）。
                pendingScroll.current = {
                    localX: clientX - rect.left + stageEl.scrollLeft,
                    localY: clientY - rect.top + stageEl.scrollTop,
                    offsetX: clientX - rect.left,
                    offsetY: clientY - rect.top,
                    ratio: next / current
                };
                zoomRef.current = next;
                setZoom(next);
            }, []);
            /** 以舞台中心为锚缩放（给 +/− 按钮用；滚轮走 `zoomAt` 的光标锚点）。 */
            const zoomCenter = (factor) => {
                const stageEl = stageNode();
                if (stageEl === null)
                    return;
                const rect = stageEl.getBoundingClientRect();
                zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
            };
            const fitView = React.useCallback(() => {
                pendingScroll.current = { fit: true };
                if (Math.abs(zoomRef.current - 1) < 1e-4) {
                    // 已经在 100%：`setZoom` 不会产生状态变化，`useEffect([zoom])` 不会重跑，
                    // 所以这里得自己把「居中」落地（拖着看过之后点适应窗口就靠它）。
                    const node = stageNode();
                    pendingScroll.current = null;
                    if (node !== null) {
                        node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
                        node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
                    }
                    return;
                }
                zoomRef.current = 1;
                setZoom(1);
            }, []);
            // 滚轮缩放：React 的 onWheel 是**被动**注册的，在里面 preventDefault 无效
            // （浏览器会警告且滚动照旧），所以这里手工挂一个 `{ passive: false }` 监听。
            React.useEffect(() => {
                const stageEl = stageNode();
                if (stageEl === null)
                    return undefined;
                const onWheel = (event) => {
                    event.preventDefault();
                    zoomAt(event.deltaY < 0 ? RIG_ZOOM_STEP : 1 / RIG_ZOOM_STEP, event.clientX, event.clientY);
                };
                stageEl.addEventListener("wheel", onWheel, { passive: false });
                return () => stageEl.removeEventListener("wheel", onWheel);
            }, [zoomAt]);
            // 空格按住 = 平移模式（与各家编辑器一致）。输入框里不能抢空格。
            React.useEffect(() => {
                const typing = () => {
                    const el = document.activeElement;
                    return el !== null && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true);
                };
                const down = (event) => {
                    if (event.code !== "Space" || typing())
                        return;
                    event.preventDefault();
                    setSpaceDown(true);
                };
                const up = (event) => {
                    if (event.code === "Space")
                        setSpaceDown(false);
                };
                window.addEventListener("keydown", down);
                window.addEventListener("keyup", up);
                return () => {
                    window.removeEventListener("keydown", down);
                    window.removeEventListener("keyup", up);
                };
            }, []);
            React.useEffect(() => {
                if (pan === null)
                    return undefined;
                const move = (event) => {
                    const node = stageNode();
                    if (node === null)
                        return;
                    node.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX);
                    node.scrollTop = pan.scrollTop - (event.clientY - pan.clientY);
                };
                const up = () => setPan(null);
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
                return () => {
                    window.removeEventListener("mousemove", move);
                    window.removeEventListener("mouseup", up);
                };
            }, [pan]);
            /** 画布坐标（参考图像素）。 */
            const toCanvas = (clientX, clientY) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                if (rect === undefined || rect === null || scale <= 0)
                    return { x: 0, y: 0 };
                return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
            };
            /** 把一批部件「当前」的状态抓成一份快照（进历史栈 / 重做栈用）。 */
            const captureSnapshot = (names) => {
                const snapshot = {};
                for (const name of names)
                    snapshot[name] = items[name] ?? null;
                return snapshot;
            };
            /** 提交一次改动：进历史栈 + 批量写回。 */
            const commit = (patches, label) => {
                if (patches.length === 0)
                    return;
                setHistory((stack) => [...stack.slice(-49), captureSnapshot(patches.map((patch) => patch.name))]);
                setFuture([]);
                const merged = {};
                for (const patch of patches)
                    merged[patch.name] = { ...(draft[patch.name] ?? {}), ...patch };
                setDraft((current) => ({ ...current, ...merged }));
                void run(() => api.saveRigLayoutItems({ jobId: job.id, items: patches.map((patch) => ({ name: patch.name, ...patch })) }), label, activeKey);
            };
            /** 撤销 / 重做：把某一批部件的状态整体换回去。 */
            const applySnapshot = (snapshot, label) => {
                const patches = [];
                for (const [name, item] of Object.entries(snapshot)) {
                    if (item === null || item === undefined)
                        continue;
                    patches.push({ name, x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation, z: item.z, placed: item.matched !== false });
                }
                if (patches.length === 0)
                    return;
                const merged = {};
                for (const patch of patches)
                    merged[patch.name] = { ...(draft[patch.name] ?? {}), ...patch };
                setDraft((current) => ({ ...current, ...merged }));
                void run(() => api.saveRigLayoutItems({ jobId: job.id, items: patches }), label, activeKey);
            };
            const undo = () => {
                if (history.length === 0)
                    return;
                const last = history[history.length - 1];
                // 先把「现在这一刻」记进重做栈。历史栈里存的是**改动前**的快照，
                // 早先直接把 `last` 也塞进重做栈，重做时还原的还是改动前那一份
                // ——点重做等于又撤一次，表现就是重做按钮毫无反应。
                const current = captureSnapshot(Object.keys(last));
                setHistory((stack) => stack.slice(0, -1));
                setFuture((stack) => [...stack, current]);
                applySnapshot(last, T("已撤销"));
            };
            const redo = () => {
                if (future.length === 0)
                    return;
                const next = future[future.length - 1];
                const current = captureSnapshot(Object.keys(next));
                setFuture((stack) => stack.slice(0, -1));
                setHistory((stack) => [...stack, current]);
                applySnapshot(next, T("已重做"));
            };
            // ── 拖动：移动 / 缩放 ───────────────────────────────────────────
            React.useEffect(() => {
                // 只处理「移动 / 缩放」。**不能把 "place" 也吃进来**：这个 effect 注册得更早，
                // 它的 mouseup 会先跑并把 drag 置空，React 随即同步重渲染、把后面那个
                // 「从部件栏拖进画布」的 mouseup 监听器当清理函数摘掉——于是拖放永远不生效。
                if (drag === null || (drag.kind !== "move" && drag.kind !== "resize"))
                    return undefined;
                const onMove = (event) => {
                    const point = toCanvas(event.clientX, event.clientY);
                    setDrag((current) => {
                        if (current === null)
                            return current;
                        const dx = point.x - current.startX;
                        const dy = point.y - current.startY;
                        const next = { ...current, dx, dy, shift: event.shiftKey };
                        return next;
                    });
                    event.preventDefault();
                };
                const onUp = () => {
                    const current = drag;
                    setDrag(null);
                    setGuides([]);
                    const base = items[current.name];
                    if (base === undefined)
                        return;
                    const patch = current.kind === "move" ? movePatch(base, current) : resizePatch(base, current);
                    if (patch === null)
                        return;
                    commit([{ name: current.name, ...patch }], current.kind === "move" ? T("已移动「{n0}」", { n0: current.name }) : T("已缩放「{n0}」", { n0: current.name }));
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
                return () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                };
            }, [drag, items, draft, selected, snapEnabled]);
            /** 拖动中的实时几何（未提交）。 */
            const geometryOf = (name) => {
                const base = items[name];
                if (base === undefined)
                    return undefined;
                if (drag === null || drag.name !== name)
                    return base;
                if (drag.kind === "move") {
                    let x = base.x + drag.dx;
                    let y = base.y + drag.dy;
                    if (drag.shift) {
                        if (Math.abs(drag.dx) > Math.abs(drag.dy))
                            y = base.y;
                        else
                            x = base.x;
                    }
                    const snapped = snapEnabled ? applySnap({ ...base, x, y }, name, items) : { box: { ...base, x, y }, guides: [] };
                    return { ...base, x: snapped.box.x, y: snapped.box.y };
                }
                const resized = resizeBox(base, drag);
                return resized;
            };
            // 拖动时算吸附参考线（放在 effect 里，避免在 render 中 setState）。
            React.useEffect(() => {
                if (drag === null || drag.kind !== "move" || !snapEnabled) {
                    setGuides([]);
                    return;
                }
                const base = items[drag.name];
                if (base === undefined)
                    return;
                const candidate = { ...base, x: base.x + drag.dx, y: base.y + drag.dy };
                const snapped = applySnap(candidate, drag.name, items);
                setGuides(snapped.guides);
            }, [drag, items, snapEnabled]);
            // ── 键盘 ────────────────────────────────────────────────────────
            React.useEffect(() => {
                const onKey = (event) => {
                    const tag = event.target?.tagName;
                    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
                        return;
                    const meta = event.metaKey || event.ctrlKey;
                    if (meta && event.key.toLowerCase() === "z") {
                        event.preventDefault();
                        if (event.shiftKey)
                            redo();
                        else
                            undo();
                        return;
                    }
                    // Ctrl/Cmd+0 = 适应窗口（与浏览器「重置缩放」同键位）。
                    if (meta && event.key === "0") {
                        event.preventDefault();
                        fitView();
                        return;
                    }
                    if (selected === null)
                        return;
                    const base = items[selected];
                    if (base === undefined)
                        return;
                    const step = event.shiftKey ? 10 : 1;
                    const move = (dx, dy) => {
                        event.preventDefault();
                        commit([{ name: selected, x: base.x + dx, y: base.y + dy }], T("已微调「{n0}」", { n0: selected }));
                    };
                    if (event.key === "ArrowLeft")
                        move(-step, 0);
                    else if (event.key === "ArrowRight")
                        move(step, 0);
                    else if (event.key === "ArrowUp")
                        move(0, -step);
                    else if (event.key === "ArrowDown")
                        move(0, step);
                    else if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault();
                        commit([{ name: selected, placed: false }], T("已收回「{n0}」", { n0: selected }));
                    }
                    else if (event.key === "Escape")
                        setSelected(null);
                };
                window.addEventListener("keydown", onKey);
                return () => window.removeEventListener("keydown", onKey);
            }, [selected, items, draft, history, future, fitView]);
            // ── 部件栏拖进画布 ──────────────────────────────────────────────
            const startPaletteDrag = (part, event) => {
                event.preventDefault();
                setDrag({
                    kind: "place",
                    name: part.name,
                    startX: 0,
                    startY: 0,
                    dx: 0,
                    dy: 0,
                    clientX: event.clientX,
                    clientY: event.clientY
                });
            };
            React.useEffect(() => {
                if (drag === null || drag.kind !== "place")
                    return undefined;
                const onUp = (event) => {
                    setDrag(null);
                    const rect = wrapRef.current?.getBoundingClientRect();
                    if (rect === undefined || rect === null)
                        return;
                    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
                    if (!inside)
                        return;
                    const part = (job.parts ?? []).find((entry) => entry.name === drag.name);
                    if (part === undefined)
                        return;
                    const existing = items[drag.name];
                    const width = existing?.width ?? Math.max(4, Math.round((part.width ?? 64) * scaleHint));
                    const height = existing?.height ?? Math.max(4, Math.round((part.height ?? 64) * scaleHint));
                    const point = toCanvas(event.clientX, event.clientY);
                    commit([{ name: drag.name, x: Math.round(point.x - width / 2), y: Math.round(point.y - height / 2), width, height, placed: true }], T("已放置「{n0}」", { n0: drag.name }));
                    setSelected(drag.name);
                };
                window.addEventListener("mouseup", onUp);
                return () => window.removeEventListener("mouseup", onUp);
            }, [drag, items, scaleHint, scale, draft]);
            // ── 缩放 / 图层 ────────────────────────────────────────────────
            const resizePatch = (base, current) => {
                const box = resizeBox(base, current);
                if (Math.round(box.x) === base.x && Math.round(box.y) === base.y && Math.round(box.width) === base.width && Math.round(box.height) === base.height)
                    return null;
                return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
            };
            function resizeBox(base, current) {
                const handle = current.handle ?? "se";
                const [hx, hy] = handlePosition(handle);
                // 对角固定不动，被拖的那条边跟着走。
                const left = base.x;
                const top = base.y;
                const right = base.x + base.width;
                const bottom = base.y + base.height;
                const minSize = 6;
                let x0 = left;
                let y0 = top;
                let x1 = right;
                let y1 = bottom;
                if (hx === 0)
                    x0 = left + current.dx;
                if (hx === 2)
                    x1 = right + current.dx;
                if (hy === 0)
                    y0 = top + current.dy;
                if (hy === 2)
                    y1 = bottom + current.dy;
                if (x1 - x0 < minSize) {
                    if (hx === 0)
                        x0 = x1 - minSize;
                    else
                        x1 = x0 + minSize;
                }
                if (y1 - y0 < minSize) {
                    if (hy === 0)
                        y0 = y1 - minSize;
                    else
                        y1 = y0 + minSize;
                }
                let width = x1 - x0;
                let height = y1 - y0;
                if (lockRatio && current.kind === "resize" && handle.length === 2) {
                    const ratio = base.height / Math.max(1, base.width);
                    // 角手柄保持等比：以变化更大的一边为准。
                    if (Math.abs(current.dx) > Math.abs(current.dy))
                        height = width * ratio;
                    else
                        width = height / ratio;
                    if (hx === 0)
                        x0 = x1 - width;
                    else
                        x1 = x0 + width;
                    if (hy === 0)
                        y0 = y1 - height;
                    else
                        y1 = y0 + height;
                }
                return { x: x0, y: y0, width, height };
            }
            function handlePosition(handle) {
                const found = RIG_HANDLES.find((entry) => entry[0] === handle);
                const hx = found === undefined ? 1 : Math.round(found[1] * 2);
                const hy = found === undefined ? 1 : Math.round(found[2] * 2);
                return [hx, hy];
            }
            function movePatch(base, current) {
                let x = base.x + current.dx;
                let y = base.y + current.dy;
                if (current.shift) {
                    if (Math.abs(current.dx) > Math.abs(current.dy))
                        y = base.y;
                    else
                        x = base.x;
                }
                const snapped = snapEnabled ? applySnap({ ...base, x, y }, current.name, items) : { box: { x, y } };
                const nextX = Math.round(snapped.box.x);
                const nextY = Math.round(snapped.box.y);
                if (nextX === base.x && nextY === base.y)
                    return null;
                return { x: nextX, y: nextY };
            }
            function applySnap(candidate, name, all) {
                const threshold = RIG_SNAP_PX / Math.max(0.0001, scale);
                const targets = [];
                for (const [other, item] of Object.entries(all)) {
                    if (other === name || item.matched === false)
                        continue;
                    targets.push({ x: [item.x, item.x + item.width / 2, item.x + item.width], y: [item.y, item.y + item.height / 2, item.y + item.height] });
                }
                targets.push({ x: [canvasW / 2], y: [canvasH / 2] });
                const lines = [];
                let best = { dx: null, dy: null, distX: threshold, distY: threshold };
                const mineX = [candidate.x, candidate.x + candidate.width / 2, candidate.x + candidate.width];
                const mineY = [candidate.y, candidate.y + candidate.height / 2, candidate.y + candidate.height];
                for (const target of targets) {
                    for (const tx of target.x) {
                        for (const mx of mineX) {
                            const dist = Math.abs(mx - tx);
                            if (dist < best.distX)
                                best = { ...best, dx: tx - mx, distX: dist };
                        }
                    }
                    for (const ty of target.y) {
                        for (const my of mineY) {
                            const dist = Math.abs(my - ty);
                            if (dist < best.distY)
                                best = { ...best, dy: ty - my, distY: dist };
                        }
                    }
                }
                const box = {
                    ...candidate,
                    x: best.dx === null ? candidate.x : candidate.x + best.dx,
                    y: best.dy === null ? candidate.y : candidate.y + best.dy
                };
                if (best.dx !== null)
                    lines.push({ axis: "x", at: box.x + (best.distX >= 0 ? 0 : 0) });
                return { box, guides: lines };
            }
            const changeZ = (name, mode) => {
                const ordered = Object.keys(items)
                    .filter((key) => items[key].matched !== false)
                    .sort((a, b) => (items[a].z ?? 0) - (items[b].z ?? 0));
                const index = ordered.indexOf(name);
                if (index < 0)
                    return;
                const reordered = [...ordered];
                reordered.splice(index, 1);
                if (mode === "front")
                    reordered.push(name);
                else if (mode === "back")
                    reordered.unshift(name);
                else if (mode === "up")
                    reordered.splice(Math.min(ordered.length - 1, index + 1), 0, name);
                else
                    reordered.splice(Math.max(0, index - 1), 0, name);
                const patches = reordered.map((key, position) => ({ name: key, z: position }));
                commit(patches, T("已调整图层顺序"));
            };
            const patchSelected = (patch, label) => {
                if (selected === null)
                    return;
                commit([{ name: selected, ...patch }], label);
            };
            if (placedNames.length === 0 && notYetPlaced.length === 0) {
                return h("p", { className: "SPR_hint" }, T("还没有可用部件，请先在第 ① 步拆件或上传部件 PNG。"));
            }
            return h("div", { className: "SPR_asm" }, 
            // ── 工具条 ────────────────────────────────────────────────
            h("div", { className: "SPR_asmBar" }, h("span", { className: "SPR_asmGroup" }, h("span", { className: "SPR_fieldLabel" }, T("缩放")), h(Btn, { onClick: () => zoomCenter(1 / RIG_ZOOM_STEP), title: T("缩小") }, "−"), h(Btn, { onClick: fitView, "data-testid": "rig-asm-fit", title: T("适应窗口（Ctrl/Cmd+0）") }, `${Math.round(zoom * 100)}%`), h(Btn, { onClick: () => zoomCenter(RIG_ZOOM_STEP), title: T("放大") }, "+")), h("span", { className: "SPR_asmGroup" }, h(Btn, { on: showReference, onClick: () => setShowReference((v) => !v), title: T("把参考图叠在下面，方便对位") }, T("参考图底图")), h(Btn, { on: showBoxes, onClick: () => setShowBoxes((v) => !v) }, T("显示边框")), h(Btn, { on: snapEnabled, onClick: () => setSnapEnabled((v) => !v), title: T("拖动时吸附到其它部件的边与中线") }, T("吸附")), h(Btn, { on: lockRatio, onClick: () => setLockRatio((v) => !v), title: T("拖角手柄时保持宽高比") }, T("锁等比"))), h("span", { className: "SPR_asmGroup" }, h(Btn, { onClick: undo, disabled: history.length === 0 }, T("撤销{n0}", { n0: history.length > 0 ? `(${history.length})` : "" })), h(Btn, { onClick: redo, disabled: future.length === 0 }, T("重做"))), h("span", { className: "SPR_spacer" }), h("span", { className: "SPR_asmHint" }, T("已放置 {n0}/{n1}　·　拖部件移动、拖角缩放、方向键微调 1px（Shift 10px）、Delete 收回、滚轮缩放、空格拖动平移", { n0: placedNames.length, n1: (job.parts ?? []).filter((part) => part.status === "ready").length }))), h("div", { className: "SPR_asmBody" }, 
            // ── 画布 ──────────────────────────────────────────────
            h("div", {
                className: "SPR_asmStage",
                ref: stageRef,
                "data-pan": spaceDown ? "true" : undefined,
                "data-panning": pan !== null ? "true" : undefined,
                "data-testid": "rig-asm-stage",
                onMouseDown: (event) => {
                    // 空格按住或中键 = 平移。平移期间不能让后面那些拖拽逻辑接手。
                    if (spaceDown || event.button === 1) {
                        event.preventDefault();
                        const node = stageNode();
                        if (node === null)
                            return;
                        setPan({ clientX: event.clientX, clientY: event.clientY, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop });
                    }
                }
            }, h("div", {
                className: "SPR_asmCanvas",
                ref: wrapRef,
                onMouseDown: (event) => {
                    if (event.target === event.currentTarget)
                        setSelected(null);
                },
                style: { width: canvasW * scale, height: canvasH * scale }
            }, showReference && job.sourceUrl !== null
                ? h("img", { className: "SPR_asmRef", src: job.sourceUrl, alt: "reference", draggable: false })
                : null, placedNames.map((name) => {
                const box = geometryOf(name) ?? items[name];
                const part = (job.parts ?? []).find((entry) => entry.name === name);
                if (part?.url === null || part?.url === undefined)
                    return null;
                return h("img", {
                    key: `layer:${name}`,
                    className: "SPR_asmLayer",
                    src: part.url,
                    alt: name,
                    draggable: false,
                    style: {
                        left: box.x * scale,
                        top: box.y * scale,
                        width: Math.max(1, box.width * scale),
                        height: Math.max(1, box.height * scale),
                        transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
                        opacity: part.hidden === true ? 0.25 : 1
                    }
                });
            }), guides.map((guide, index) => h("div", { key: `guide:${index}`, className: "SPR_asmGuide", style: { left: guide.at * scale } })), showBoxes
                ? placedNames.map((name) => {
                    const box = geometryOf(name) ?? items[name];
                    const isSelected = selected === name;
                    return h("div", {
                        key: `box:${name}`,
                        className: "SPR_rigBox",
                        "data-selected": isSelected ? "true" : undefined,
                        style: { left: box.x * scale, top: box.y * scale, width: Math.max(6, box.width * scale), height: Math.max(6, box.height * scale) },
                        onMouseDown: (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSelected(name);
                            const point = toCanvas(event.clientX, event.clientY);
                            setDrag({ kind: "move", name, startX: point.x, startY: point.y, dx: 0, dy: 0 });
                        }
                    }, isSelected
                        ? RIG_HANDLES.map(([handle, fx, fy]) => h("span", {
                            key: handle,
                            className: "SPR_asmHandle",
                            "data-handle": handle,
                            style: { left: `${fx * 100}%`, top: `${fy * 100}%` },
                            onMouseDown: (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const point = toCanvas(event.clientX, event.clientY);
                                setDrag({ kind: "resize", name, handle, startX: point.x, startY: point.y, dx: 0, dy: 0 });
                            }
                        }))
                        : null, h("span", { className: "SPR_rigBoxLabel" }, (job.parts ?? []).find((p) => p.name === name)?.label ?? name));
                })
                : null)), 
            // ── 右侧：部件栏 + 参数 ─────────────────────────────────
            h("div", { className: "SPR_asmSide" }, h("div", { className: "SPR_sideTitle" }, T("未放置（{n0}）· 拖进画布", { n0: unplaced.length + notYetPlaced.length })), h("div", { className: "SPR_asmPalette" }, [...unplaced, ...notYetPlaced].map((part) => h("div", {
                key: `palette:${part.name}`,
                className: "SPR_asmChip",
                onMouseDown: (event) => startPaletteDrag(part, event)
            }, part.url !== null && part.url !== undefined ? h("img", { src: part.url, alt: part.name, draggable: false }) : null, h("span", null, part.label ?? part.name))), unplaced.length + notYetPlaced.length === 0 ? h("p", { className: "SPR_hint" }, T("全部部件都已放置。")) : null), selectedItem !== undefined && selected !== null
                ? h("div", { className: "SPR_asmPanel" }, h("div", { className: "SPR_sideTitle" }, T("选中：{n0}", { n0: selectedPart?.label ?? selected })), h("div", { className: "SPR_asmFields" }, h(NumField, { label: "x", value: selectedItem.x, onChange: (value) => patchSelected({ x: value }, T("已修改 x")) }), h(NumField, { label: "y", value: selectedItem.y, onChange: (value) => patchSelected({ y: value }, T("已修改 y")) }), h(NumField, { label: T("宽"), value: selectedItem.width, min: 1, onChange: (value) => patchSelected(lockRatio ? { width: value, height: Math.round((value * selectedItem.height) / Math.max(1, selectedItem.width)) } : { width: value }, T("已修改宽度")) }), h(NumField, { label: T("高"), value: selectedItem.height, min: 1, onChange: (value) => patchSelected(lockRatio ? { height: value, width: Math.round((value * selectedItem.width) / Math.max(1, selectedItem.height)) } : { height: value }, T("已修改高度")) }), h(NumField, { label: T("旋转"), value: selectedItem.rotation, step: 5, onChange: (value) => patchSelected({ rotation: value }, T("已旋转")) }), h(NumField, { label: T("层级"), value: selectedItem.z, onChange: (value) => patchSelected({ z: value }, T("已修改层级")) })), h("div", { className: "SPR_asmRow" }, h(Btn, { onClick: () => changeZ(selected, "front") }, T("置顶")), h(Btn, { onClick: () => changeZ(selected, "up") }, T("上移")), h(Btn, { onClick: () => changeZ(selected, "down") }, T("下移")), h(Btn, { onClick: () => changeZ(selected, "back") }, T("置底"))), h("div", { className: "SPR_asmRow" }, h(Btn, { onClick: () => patchSelected({ width: selectedItem.height, height: selectedItem.width }, T("已交换宽高")) }, T("宽高互换")), h(BusyBtn, {
                    busy: busy,
                    busyText: T("重定位中…"),
                    onClick: () => void run(() => api.runRigLayout({ jobId: job.id, names: [selected] }), T("已重新自动定位「{n0}」", { n0: selected }), activeKey)
                }, T("这块重新自动定位")), h(Btn, { onClick: () => commit([{ name: selected, placed: false }], T("已收回「{n0}」", { n0: selected })), danger: true }, T("收回部件"))), selectedItem.matched === false
                    ? h("p", { className: "SPR_hint" }, T("这块目前是「未放置」状态：拖到画布上或点上面的数值确认即可放回。"))
                    : null)
                : h("div", { className: "SPR_asmPanel" }, h("p", { className: "SPR_hint" }, T("在画布上点一个部件，这里会出现它的精确参数与图层操作。"))), h("div", { className: "SPR_asmPanel" }, h("div", { className: "SPR_sideTitle" }, T("图层（从下到上）")), h("ol", { className: "SPR_asmLayers" }, placedNames.slice().reverse().map((name) => h("li", {
                key: `layer-row:${name}`,
                "data-active": selected === name ? "true" : "false",
                onClick: () => setSelected(name)
            }, h("span", null, (job.parts ?? []).find((p) => p.name === name)?.label ?? name), h("span", { className: "SPR_asmLayerBtns" }, h("button", { type: "button", className: "SPR_miniBtn", onClick: (event) => { event.stopPropagation(); changeZ(name, "up"); } }, "↑"), h("button", { type: "button", className: "SPR_miniBtn", onClick: (event) => { event.stopPropagation(); changeZ(name, "down"); } }, "↓")))))))));
        }
        /** 部件还没有任何摆放记录时，按它的原始像素尺寸 × 全局缩放先验给一个默认框。 */
        function defaultItemOf(part, hint) {
            const width = Math.max(4, Math.round((part.width ?? 64) * hint));
            const height = Math.max(4, Math.round((part.height ?? 64) * hint));
            return { x: 0, y: 0, width, height, rotation: 0, z: 0, matched: true, manual: false };
        }
        /**
         * 「本次会话不再提示」的选择（**按模块各记一份**）。
         *
         * 刻意放在 React 状态之外：切模块时组件会卸载重建，只有闭包变量才跨挂载
         * 记得住这次选择。刷新页面即恢复提示（会话级，不落盘、不写进任务数据）。
         *
         * ⚠️ 必须**按模块分开**：共用一个标志的话，用户在骨骼动画那边勾了
         * 「不再提示」，进 45° 地图地块时弹窗就再也不出现了 —— 两个模块的
         * 实验性说明内容完全不同，那样等于静默漏掉一次告知。
         */
        const experimentalGateMuted = { rig: false, tile: false, map: false };
        /**
         * 实验性说明弹窗（模块④ / ⑤ 共用）。
         *
         * 只解释现状 + 给共建入口，没有「继续 / 取消」这类功能性按钮——功能本身照常可用，
         * 这里拦的只是「不知情地把它当稳定功能用」。
         */
        function ExperimentalDialog({ moduleKey, title, ariaLabel, points, onClose }) {
            const [mute, setMute] = React.useState(false);
            const close = React.useCallback(() => {
                if (mute)
                    experimentalGateMuted[moduleKey] = true;
                onClose();
            }, [mute, moduleKey, onClose]);
            // Esc 关闭：弹窗盖住整个工作台，键盘退出是最低限度的礼貌。
            React.useEffect(() => {
                if (typeof window === "undefined")
                    return undefined;
                const onKey = (event) => {
                    if (event.key === "Escape")
                        close();
                };
                window.addEventListener("keydown", onKey);
                return () => window.removeEventListener("keydown", onKey);
            }, [close]);
            return h("div", {
                className: "SPR_gateMask",
                role: "dialog",
                "aria-modal": "true",
                "aria-label": ariaLabel,
                onClick: close
            }, h("div", { className: "SPR_gate", onClick: (event) => event.stopPropagation() }, h("div", { className: "SPR_gateHead" }, h("span", { className: "SPR_expTag" }, T("实验性")), h("span", { className: "SPR_gateTitle" }, title)), points.map((text, index) => h("p", { key: index, className: "SPR_gateBody" }, text)), h("a", { className: "SPR_link", href: EXPERIMENTAL_REPO, target: "_blank", rel: "noreferrer" }, EXPERIMENTAL_REPO), h("div", { className: "SPR_gateFoot" }, h("label", { className: "SPR_gateMute" }, h("input", { type: "checkbox", checked: mute, onChange: (event) => setMute(event.target.checked) }), T("本次会话不再提示")), h("a", { className: "SPR_btn", href: EXPERIMENTAL_REPO, target: "_blank", rel: "noreferrer" }, T("去 GitHub 仓库")), h(Btn, { onClick: close, primary: true, "data-testid": "rig-experimental-ok" }, T("我知道了")))));
        }
        /** 模块内常驻的实验性提示条：弹窗关掉之后，标记不能跟着消失。 */
        function ExperimentalBar() {
            return h("div", { className: "SPR_expBar" }, h("span", { className: "SPR_expTag" }, T("实验性")), h("span", { className: "SPR_expBarText" }, T("该模块功能尚不完善，仍在开发中；若你需要它，欢迎到")), h("a", { className: "SPR_link", href: EXPERIMENTAL_REPO, target: "_blank", rel: "noreferrer" }, T("GitHub 仓库")), h("span", { className: "SPR_expBarText" }, T("一起开发。")));
        }
        /** 进入模块④时的实验性说明弹窗（骨骼动画）。 */
        function RigExperimentalDialog({ onClose }) {
            return h(ExperimentalDialog, {
                moduleKey: "rig",
                title: T("骨骼动画生成仍在开发中"),
                ariaLabel: T("骨骼动画生成（实验性）"),
                points: RIG_EXPERIMENTAL_POINTS,
                onClose
            });
        }
        /** 进入模块⑤时的实验性说明弹窗（45° 地图地块）。 */
        function TileExperimentalDialog({ onClose }) {
            return h(ExperimentalDialog, {
                moduleKey: "tile",
                title: T("45°地图地块生成仍在开发中"),
                ariaLabel: T("45°地图地块生成（实验性）"),
                points: TILE_EXPERIMENTAL_POINTS,
                onClose
            });
        }
        /** 进入模块⑥时的实验性说明弹窗（地图编辑器）。 */
        function MapExperimentalDialog({ onClose }) {
            return h(ExperimentalDialog, {
                moduleKey: "map",
                title: T("地图编辑器仍在开发中"),
                ariaLabel: T("地图编辑器（实验性）"),
                points: MAP_EXPERIMENTAL_POINTS,
                onClose
            });
        }
        /**
         * 模块④的主体界面。
         *
         * 阶段之间用标签切换（和八方向图一致），但**每个阶段都自带状态、验收与重跑
         * 入口**：`parts` 逐件通过/隐藏/删除，`layout` 逐件拖动/重定位，`rig` 逐个动画
         * 播放，`atlas` 整体验收。深链接（`?dsh-gmm=1&module=rig&job=…&stage=…`）会直接
         * 落到对应阶段。
         */
        function RigModule(props) {
            useLocaleTick();
            const api = props.api;
            const [jobs, setJobs] = React.useState([]);
            const [jobId, setJobId] = React.useState(null);
            const [job, setJob] = React.useState(null);
            const [stage, setStage] = React.useState("parts");
            const [notice, setNotice] = React.useState(null);
            const [loading, setLoading] = React.useState(true);
            const [uploading, setUploading] = React.useState(false);
            const [selected, setSelected] = React.useState(null);
            const [showReference, setShowReference] = React.useState(true);
            // 实验性进入提示：RigModule 恰好就是「进入了模块④」，页签切换和深链接都会
            // 重新挂载它，所以放在这里等于「每次进入都弹」；勾过「本次会话不再提示」就不弹。
            const [gateOpen, setGateOpen] = React.useState(experimentalGateMuted.rig !== true);
            const closeGate = React.useCallback(() => setGateOpen(false), []);
            const [anim, setAnim] = React.useState("idle");
            const [promptDraft, setPromptDraft] = React.useState("");
            const [suffixDraft, setSuffixDraft] = React.useState("");
            const [settingsDraft, setSettingsDraft] = React.useState({});
            const globalConfig = useGlobalConfig(api);
            const tasks = usePendingTasks();
            const intent = useStudioIntent();
            React.useEffect(() => {
                if (intent === null)
                    return;
                if (intent.module === "rig" && typeof intent.jobId === "string")
                    setJobId(intent.jobId);
                if (typeof intent.stage === "string" && RIG_STAGES.some((entry) => entry.key === intent.stage))
                    setStage(intent.stage);
            }, [intent]);
            const stageEntry = job === null ? null : rigStageOf(job, stage);
            const stageBusy = stageEntry !== null && stageEntry.status === "running";
            const busy = (job !== null && (job.stages ?? []).some((entry) => entry.status === "running")) || tasks.active;
            const keyBusy = (key) => tasks.has(key);
            const PART_K = (name, action) => `rig:${action}:${name}`;
            /**
             * 刚提交过宿主任务 → 接下来这几秒保持轮询（时间戳，0 = 不额外轮询）。
             *
             * 为什么需要：`run()` 里的 `tasks.active` 在 `await fn()` 返回时就变回 false，
             * 而 `kick()` 是「登记后台任务后立即返回」——宿主写 `running` 落盘、以及本地任务
             * （推骨骼 / 装配 / 打图集，通常不到 1 秒）跑完，都发生在这一次 `load()` **之后**。
             * 于是 `busy` 一直是 false，轮询不启动，界面停在旧状态：表现为「点完按钮没反应、
             * 下一步的按钮还是灰的」，用户只能手动刷新页面（实测踩过：骨骼明明建好了，
             * ③ 还是没打勾）。所以提交成功后给一个短暂的「沉降窗口」。
             */
            const [settleUntil, setSettleUntil] = React.useState(0);
            const refresh = React.useCallback(async () => {
                if (api === undefined)
                    return [];
                try {
                    const result = await api.listRigJobs();
                    const list = result.jobs ?? [];
                    setJobs(list);
                    return list;
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                    return [];
                }
            }, [api]);
            const load = React.useCallback(async (id) => {
                if (api === undefined || id === null)
                    return;
                try {
                    const next = await api.getRigJob({ jobId: id });
                    // 宿主半区是进程启动时冻结的模块图：如果它还是旧版本，返回的是原始任务
                    // 而不是统一视图，界面会以各种「读不到字段」的形式坏掉。与其让用户对着
                    // 一个灰按钮猜，不如直说。
                    if (next !== null && next !== undefined && next.sourceUrl === undefined && (next.stages ?? []).every((entry) => entry.stage === undefined)) {
                        setNotice({ kind: "error", text: T("宿主半区版本过旧（缺少骨骼动画模块的字段）。请重启 DSH Desktop 后重试。") });
                        setJob(null);
                        return;
                    }
                    setJob(next);
                    setPromptDraft(next.prompts?.sheet ?? "");
                    setSuffixDraft(next.prompts?.suffix ?? "");
                    setSettingsDraft({ ...(next.settings ?? {}) });
                    setSelected((current) => (current !== null && (next.parts ?? []).some((part) => part.name === current) ? current : null));
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api]);
            React.useEffect(() => {
                void (async () => {
                    const list = await refresh();
                    setLoading(false);
                    if (list.length > 0)
                        setJobId((current) => current ?? list[0].id);
                })();
            }, [refresh]);
            React.useEffect(() => {
                if (jobId !== null)
                    void load(jobId);
            }, [jobId, load]);
            React.useEffect(() => {
                if (jobId === null)
                    return undefined;
                // 有任务在跑，或刚提交完还在「沉降窗口」里，都要继续刷新。
                if (!busy && Date.now() >= settleUntil)
                    return undefined;
                const timer = setInterval(() => void load(jobId), 2500);
                return () => clearInterval(timer);
            }, [busy, jobId, load, settleUntil]);
            const run = async (fn, okText = undefined, feedback = undefined) => {
                const invoke = async () => {
                    try {
                        const value = await fn();
                        if (okText !== undefined)
                            setNotice({ kind: "ok", text: okText });
                        // 提交成功就开一个沉降窗口：宿主可能还没把任务登记成 `running`
                        // （本地任务甚至可能已经跑完），只 load 一次会读到「什么都没发生」。
                        setSettleUntil(Date.now() + 6000);
                        if (jobId !== null)
                            await load(jobId);
                        await refresh();
                        return value;
                    }
                    catch (error) {
                        setNotice({ kind: "error", text: msg(error) });
                        return undefined;
                    }
                };
                if (feedback === undefined)
                    return invoke();
                const label = RIG_BUSY_LABEL[feedback] ?? (feedback.startsWith("rig:relayout") ? T("正在重新定位…") : T("正在处理…"));
                return tasks.run(feedback, label, invoke);
            };
            const createJob = async () => {
                const name = askNewName(T("新骨骼动画任务的名字"), T("新骨骼动画任务"));
                if (name === null)
                    return;
                await run(async () => {
                    const created = await api.createRigJob({ name });
                    await refresh();
                    setJobId(created.jobId);
                    setStage("parts");
                    return created;
                }, T("已新建骨骼动画任务"), K_RIG_CREATE);
            };
            const deleteJob = async () => {
                if (job === null)
                    return;
                if (typeof window !== "undefined" && !window.confirm(T("删除任务「{n0}」？产物文件会一并删除。", { n0: job.name })))
                    return;
                await run(async () => {
                    await api.deleteRigJob({ jobId: job.id });
                    const list = await refresh();
                    setJobId(list.length > 0 ? list[0].id : null);
                    if (list.length === 0)
                        setJob(null);
                });
            };
            const renameJob = async () => {
                if (job === null)
                    return;
                const next = typeof window === "undefined" ? null : window.prompt(T("新的任务名"), job.name);
                if (next === null || next.trim() === "")
                    return;
                await run(() => api.saveRigJob({ jobId: job.id, name: next.trim() }), T("已重命名"));
            };
            const uploadSource = async (files) => {
                const file = files[0];
                if (file === undefined || job === null)
                    return;
                setUploading(true);
                try {
                    const data = await readFileBase64(file);
                    await api.uploadRigSource({ jobId: job.id, name: file.name, data });
                    setNotice({ kind: "ok", text: T("已上传参考图：{n0}", { n0: file.name }) });
                    await load(job.id);
                    await refresh();
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
                finally {
                    setUploading(false);
                }
            };
            const uploadParts = async (files) => {
                if (job === null)
                    return;
                setUploading(true);
                try {
                    for (const file of files) {
                        const data = await readFileBase64(file);
                        await api.uploadRigPart({ jobId: job.id, name: file.name, data });
                    }
                    setNotice({ kind: "ok", text: T("已上传 {n0} 个部件（文件名即部件名）", { n0: files.length }) });
                    await load(job.id);
                    await refresh();
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
                finally {
                    setUploading(false);
                }
            };
            const saveSettings = () => run(() => api.saveRigJob({ jobId: job.id, sheetPrompt: promptDraft, suffix: suffixDraft, settings: settingsDraft }), T("已保存提示词与参数"));
            const selectedItem = job !== null && selected !== null ? (job.layout?.items ?? {})[selected] : undefined;
            if (api === undefined) {
                return h("div", { className: "SPR_rigPanel" }, h("p", { className: "SPR_hint" }, T("远程服务尚未挂载完成，请稍候…")));
            }
            const headerButtons = h(React.Fragment, null, h(Btn, { onClick: () => void refresh(), disabled: loading || keyBusy(K_RIG_JOB) }, T("刷新列表")), job !== null ? h(Btn, { onClick: () => void renameJob() }, T("重命名")) : null, job !== null ? h(Btn, { onClick: () => void deleteJob(), danger: true }, T("删除任务")) : null, h(BusyBtn, { onClick: () => void createJob(), busy: keyBusy(K_RIG_CREATE), busyText: T("创建中…"), primary: true }, T("新建任务")));
            return h("div", { className: "SPR_rigPanel" }, 
            // 弹窗是 position:fixed，放在这个滚动容器里也照样盖住整个工作台，
            // 不必为此把 RigModule 再包一层 Fragment。
            gateOpen ? h(RigExperimentalDialog, { onClose: closeGate }) : null, h(ExperimentalBar, null), h("div", { className: "SPR_toolbar" }, h("span", { className: "SPR_refRow" }, T("生图模型")), h("span", { className: "SPR_badge" }, globalConfig?.arkModel ?? job?.settings?.model ?? T("未配置")), h("span", { className: "SPR_refRow" }, T("（模型在「设置 → 游戏素材大师」里改）")), h("span", { className: "SPR_spacer" }), headerButtons), notice !== null
                ? h("div", { className: "SPR_notice", "data-kind": notice.kind === "error" ? "error" : "info" }, notice.text, h(Btn, { onClick: () => setNotice(null) }, T("关闭")))
                : null, h("div", { className: "SPR_modules" }, RIG_STAGES.map((entry) => {
                const info = job === null ? { status: "empty" } : rigStageOf(job, entry.key);
                const done = info.status === "ready";
                return h("button", {
                    key: entry.key,
                    type: "button",
                    className: "SPR_module",
                    "data-active": stage === entry.key ? "true" : "false",
                    onClick: () => setStage(entry.key)
                }, h("span", { className: "SPR_moduleTitle" }, `${done ? "✓ " : ""}${entry.title}`), h("span", { className: "SPR_moduleHint" }, info.status === "running" ? T("进行中…") : entry.hint));
            })), jobs.length === 0
                ? h("p", { className: "SPR_hint" }, loading ? T("正在读取任务…") : T("还没有骨骼动画任务，点右上角「新建任务」开始。"))
                : h(React.Fragment, null, h("div", { className: "SPR_toolbar", style: { flexWrap: "wrap" } }, h("span", { className: "SPR_refRow" }, T("任务")), h("select", { className: "SPR_input", style: { width: 260 }, value: jobId ?? "", onChange: (event) => setJobId(event.target.value) }, jobs.map((entry) => h("option", { key: entry.id, value: entry.id }, T("{n0}（部件 {n1}）", { n0: entry.name, n1: entry.partCount })))), job !== null ? h("span", { className: "SPR_badge" }, job.id) : null, stageBusy ? h(BusyBadge, { show: true, text: T("本阶段进行中…") }) : null), job === null
                    ? null
                    : h(React.Fragment, null, h(ReviewModeBar, { api, module: "rig", id: job.id, mode: job.reviewMode, onChanged: () => void load(job.id) }), h(RigQaPanel, { job, api, run, busy, activeKey: K_RIG_QA }), 
                    // ── 第 0 步：角色参考图 ────────────────────────────────
                    h("div", { className: "SPR_rigStage" }, h("div", { className: "SPR_rigStageHead" }, h("span", { className: "SPR_rigStageTitle" }, T("角色参考图")), h("span", { className: "SPR_rigStageHint" }, T("拆件、装配、骨骼都以这张整图为基准；建议用能看清全身、背景干净的角色立绘。")), job.sourceUrl !== null && job.sourceUrl !== undefined ? h(Chip, { kind: "ready", text: `${job.canvas?.width ?? "?"}×${job.canvas?.height ?? "?"}` }) : h(Chip, { kind: "empty", text: T("未上传") })), h("div", { className: "SPR_toolbar", style: { marginTop: 10 } }, h(UploadBox, { label: T("拖入角色整图（PNG / JPG）"), accept: "image/*", onFiles: (files) => void uploadSource(files), busy: uploading }), h(UploadBox, { label: T("拖入部件 PNG（可多选，文件名即部件名）"), accept: "image/*", multiple: true, onFiles: (files) => void uploadParts(files), busy: uploading })), job.sourceUrl !== null && job.sourceUrl !== undefined
                        ? h("img", { className: "SPR_rigCardImg", style: { height: 200, marginTop: 10 }, src: job.sourceUrl, alt: "reference" })
                        : null), 
                    // ── ① 拆件 ────────────────────────────────────────────
                    stage === "parts"
                        ? h("div", { className: "SPR_rigStage" }, h("div", { className: "SPR_rigStageHead" }, h("span", { className: "SPR_rigStageTitle" }, T("① 拆件")), h("span", { className: "SPR_rigStageHint" }, T("让生图模型把角色拆成摊平的部件图，再自动分割成逐件透明 PNG。**这一步花钱**，只跑一次；参数改了可以「重新分割」，不额外计费。")), h(StatusChip, { node: rigStageOf(job, "parts") })), h("div", { className: "SPR_rigEditorRow" }, h(BusyBtn, {
                            busy: keyBusy(K_RIG_SHEET),
                            busyText: T("正在拆件生图…"),
                            primary: true,
                            disabled: job.sourceUrl === null || job.sourceUrl === undefined || busy,
                            onClick: () => void run(() => api.runRigSheet({ jobId: job.id }), T("已提交拆件生图"), K_RIG_SHEET)
                        }, job.sheet?.status === "ready" ? T("重新生成拆件图（会花钱）") : T("生成拆件图（会花钱）")), h(BusyBtn, {
                            busy: keyBusy(K_RIG_SEGMENT),
                            busyText: T("正在分割…"),
                            disabled: job.sheet?.status !== "ready" || busy,
                            onClick: () => void run(() => api.runRigSegment({ jobId: job.id }), T("已提交重新分割"), K_RIG_SEGMENT)
                        }, T("用现有拆件图重新分割")), h(NumField, { label: T("网格列"), value: settingsDraft.gridColumns ?? 4, min: 1, max: 8, onChange: (value) => setSettingsDraft({ ...settingsDraft, gridColumns: value }) }), h(NumField, { label: T("网格行"), value: settingsDraft.gridRows ?? 4, min: 1, max: 8, onChange: (value) => setSettingsDraft({ ...settingsDraft, gridRows: value }) }), h(NumField, { label: T("底色容差"), value: settingsDraft.backgroundTolerance ?? 30, min: 1, max: 200, onChange: (value) => setSettingsDraft({ ...settingsDraft, backgroundTolerance: value }) }), h(NumField, { label: T("边缘羽化"), value: settingsDraft.feather ?? 26, min: 1, max: 200, onChange: (value) => setSettingsDraft({ ...settingsDraft, feather: value }) }), h(NumField, { label: T("最小面积"), value: settingsDraft.minArea ?? 0, min: 0, max: 100000, onChange: (value) => setSettingsDraft({ ...settingsDraft, minArea: value }) }), 
                        // 「边缘羽化」以前是「离底色多远才不透明」的斜率，浅色填充会
                        // 因此整片变半透明；现在它只作用于轮廓最外圈，内部一律不透明。
                        h("p", { className: "SPR_hint", style: { marginTop: 4, marginBottom: 0 } }, T("底色容差：与底色多接近算背景。边缘羽化：只决定轮廓最外圈那几个像素的软过渡，部件内部不会变半透明。")), h(Btn, { onClick: () => void saveSettings() }, T("保存参数与提示词"))), h("textarea", {
                            className: "SPR_input",
                            style: { width: "100%", minHeight: 110, marginTop: 10, fontFamily: "inherit", fontSize: 12 },
                            value: promptDraft,
                            placeholder: T("留空则使用内置的网格拆件提示词（要求模型按 4×4 网格摆放 16 个标准人形部件）"),
                            onChange: (event) => setPromptDraft(event.target.value)
                        }), h("textarea", {
                            className: "SPR_input",
                            style: { width: "100%", minHeight: 48, marginTop: 6, fontFamily: "inherit", fontSize: 12 },
                            value: suffixDraft,
                            placeholder: T("统一附加提示词（可留空）"),
                            onChange: (event) => setSuffixDraft(event.target.value)
                        }), job.sheet?.url !== null && job.sheet?.url !== undefined
                            ? h("div", { className: "SPR_rigCanvasWrap" }, h("img", { src: job.sheet.url, alt: "sheet" }), h(LoadingOverlay, { show: keyBusy(K_RIG_SHEET) || keyBusy(K_RIG_SEGMENT), text: keyBusy(K_RIG_SHEET) ? T("生图模型正在拆件…") : T("正在分割部件…") }))
                            : h("p", { className: "SPR_hint", style: { marginTop: 10 } }, job.sourceUrl === null || job.sourceUrl === undefined ? T("先上传角色参考图。") : T("还没有拆件图：点上面的「生成拆件图」，或者用上面的上传框直接给现成部件 PNG。")), (job.parts ?? []).length > 0
                            ? h("div", null, h("h3", { style: { fontSize: 13, margin: "14px 0 0" } }, T("部件（{n0}）——逐件验收，摆错的可单独重跑", { n0: job.parts.length })), h("div", { className: "SPR_rigGrid" }, job.parts.map((part) => h(RigPartCard, {
                                key: part.name,
                                part,
                                selected: selected === part.name,
                                busy,
                                onSelect: () => {
                                    setSelected(part.name);
                                    setStage("layout");
                                },
                                onApprove: () => void run(() => api.saveRigJob({ jobId: job.id, approved: part.approved !== true, stage: "parts", part: part.name })),
                                onHide: () => void run(() => api.setRigPartVisibility({ jobId: job.id, name: part.name, hidden: part.hidden !== true })),
                                onRemove: () => void run(() => api.removeRigPart({ jobId: job.id, name: part.name })),
                                onRename: () => {
                                    const next = typeof window === "undefined" ? null : window.prompt(T("把「{n0}」改成什么名字？\n（名字决定骨骼层级，标准名如 head / torso / hip / left-upper-arm / left-lower-leg / right-foot，见拆件提示词里的网格表）", { n0: part.name }), part.name);
                                    if (next === null || next.trim() === "" || next === part.name)
                                        return;
                                    void run(() => api.renameRigPart({ jobId: job.id, from: part.name, to: next.trim() }), T("已改名为「{n0}」", { n0: next.trim() }));
                                },
                                onRetry: () => void run(() => api.runRigLayout({ jobId: job.id, names: [part.name] }), T("已重新定位「{n0}」", { n0: part.name }), PART_K(part.name, "relayout"))
                            }))))
                            : null, h(RigSemanticsPanel, { job, api, run, activeKey: K_RIG_LAYOUT }), h(RigTexturePanel, {
                            job,
                            api,
                            run,
                            busy,
                            keyBusy,
                            activeKey: K_RIG_SEGMENT,
                            selected,
                            onSelect: setSelected
                        }), h("div", { className: "SPR_toolbar", style: { marginTop: 12 } }, h(Btn, {
                            onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "parts" }), T("第①步已通过")),
                            on: rigStageOf(job, "parts").approved === true,
                            disabled: (job.parts ?? []).filter((part) => part.status === "ready").length === 0
                        }, rigStageOf(job, "parts").approved === true ? T("第①步：已通过") : T("第①步：通过")), h(Btn, {
                            onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "parts" }))
                        }, T("取消通过")), h(Btn, { onClick: () => setStage("layout") }, T("下一步：装配定位 →"))))
                        : null, 
                    // ── ② 装配定位 ────────────────────────────────────────
                    stage === "layout"
                        ? h("div", { className: "SPR_rigStage" }, h("div", { className: "SPR_rigStageHead" }, h("span", { className: "SPR_rigStageTitle" }, T("② 装配定位")), h("span", { className: "SPR_rigStageHint" }, T("多尺度模板匹配把每个部件摆回参考姿态。**本地计算，免费**：失败或摆错只重跑那几个部件，不用整批重来。")), h(StatusChip, { node: rigStageOf(job, "layout") })), h("div", { className: "SPR_rigEditorRow" }, h(BusyBtn, {
                            busy: keyBusy(K_RIG_LAYOUT),
                            busyText: T("正在装配定位…"),
                            primary: true,
                            disabled: (job.parts ?? []).filter((part) => part.status === "ready").length === 0 || busy,
                            onClick: () => void run(() => api.runRigLayout({ jobId: job.id }), T("已提交装配定位（本地计算）"), K_RIG_LAYOUT)
                        }, T("重新装配全部部件")), h(BusyBtn, {
                            busy: keyBusy(K_RIG_LAYOUT),
                            busyText: T("正在重试…"),
                            disabled: (job.review?.unmatched ?? []).length === 0 || busy,
                            onClick: () => void run(() => api.runRigLayout({ jobId: job.id, names: job.review.unmatched }), T("已提交重试未命中的部件"), K_RIG_LAYOUT)
                        }, T("只重试未命中的 {n0} 个", { n0: (job.review?.unmatched ?? []).length })), h(Btn, { onClick: () => setShowReference((current) => !current), on: showReference }, showReference ? T("只显示合成图") : T("并排显示参考图"))), h(RigAssemblyEditor, { job, api, run, busy, activeKey: K_RIG_LAYOUT }), (job.review?.unmatched ?? []).length > 0
                            ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } }, T("这些部件没匹配上，请手工拖到正确位置：{n0}", { n0: job.review.unmatched.join(T("、")) }))
                            : null, h("div", { className: "SPR_toolbar", style: { marginTop: 12 } }, h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "layout" }), T("第②步已通过")), on: rigStageOf(job, "layout").approved === true, disabled: job.layout?.status !== "ready" }, rigStageOf(job, "layout").approved === true ? T("第②步：已通过") : T("第②步：通过")), h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "layout" })) }, T("取消通过")), h(Btn, { onClick: () => setStage("rig") }, T("下一步：骨骼与动画 →"))))
                        : null, 
                    // ── ③ 骨骼与动画 ──────────────────────────────────────
                    stage === "rig"
                        ? h("div", { className: "SPR_rigStage" }, h("div", { className: "SPR_rigStageHead" }, h("span", { className: "SPR_rigStageTitle" }, T("③ 骨骼与动画")), h("span", { className: "SPR_rigStageHint" }, T("按部件语义自动推骨骼层级，并生成六个动画预设。**本地计算，免费**。下面直接播放验收。")), h(StatusChip, { node: rigStageOf(job, "rig") })), h("div", { className: "SPR_rigEditorRow" }, h(BusyBtn, {
                            busy: keyBusy(K_RIG_BONES),
                            busyText: T("正在生成骨骼…"),
                            primary: true,
                            disabled: job.layout?.status !== "ready" || busy,
                            onClick: () => void run(() => api.runRigBones({ jobId: job.id }), T("已提交骨骼构建"), K_RIG_BONES)
                        }, T("生成骨骼与动画")), h("span", { className: "SPR_refRow" }, T("动画预设")), RIG_ANIMATIONS.map((name) => h("label", { key: name, className: "SPR_refRow", style: { display: "inline-flex", gap: 4, alignItems: "center" } }, h("input", {
                            type: "checkbox",
                            checked: (settingsDraft.animations ?? []).includes(name),
                            onChange: (event) => {
                                const current = new Set(settingsDraft.animations ?? []);
                                if (event.target.checked)
                                    current.add(name);
                                else
                                    current.delete(name);
                                setSettingsDraft({ ...settingsDraft, animations: RIG_ANIMATIONS.filter((entry) => current.has(entry)) });
                            }
                        }), name)), h(Btn, { onClick: () => void saveSettings() }, T("保存动画选择")), job.rig?.skeleton !== null && job.rig?.skeleton !== undefined ? h("a", { className: "SPR_link", href: job.rig.skeleton, download: "skeleton.json" }, T("下载 skeleton.json")) : null, job.rig?.preview !== null && job.rig?.preview !== undefined ? h("a", { className: "SPR_link", href: job.rig.preview, target: "_blank", rel: "noreferrer" }, T("新窗口打开预览")) : null), (job.rig?.warnings ?? []).length > 0
                            ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } }, T("骨骼告警：{n0}", { n0: job.rig.warnings.join(T("；")) }))
                            : null, job.rig?.preview !== null && job.rig?.preview !== undefined
                            ? h(React.Fragment, null, h("div", { className: "SPR_rigEditorRow" }, h("span", { className: "SPR_refRow" }, T("播放动画")), (job.rig.animations ?? []).map((name) => h(Btn, { key: name, on: anim === name, onClick: () => setAnim(name) }, name)), h("span", { className: "SPR_hint" }, T("预览里也能拖时间轴、开骨骼网格"))), h("iframe", {
                                className: "SPR_rigPreview",
                                // `?v=` 用 `rig.updatedAt` 做缓存破除：时间轴改完会重算骨骼，
                                // 快照一变 iframe 就重载，预览才能「立即反映」。
                                // 少了它 React 认为 src 没变、不重新挂载，预览会一直是旧的。
                                src: `${job.rig.preview}?v=${job.rig.updatedAt ?? 0}#${anim}`,
                                title: T("骨骼动画预览")
                            }))
                            : h("p", { className: "SPR_hint", style: { marginTop: 10 } }, job.layout?.status === "ready" ? T("点「生成骨骼与动画」得到 skeleton.json 与可播放预览。") : T("先完成第②步装配定位。")), h(RigAnimationPanel, { job, api, run, busy, activeKey: K_RIG_BONES }), h(RigTimelineEditor, { job, api, run, busy, activeKey: K_RIG_BONES, onRebuild: true }), h(RigConstraintPanel, { job, api, run, busy, activeKey: K_RIG_BONES }), h(RigMeshPanel, { job, api, run, busy, activeKey: K_RIG_BONES }), h(RigPathPanel, { job, api, run, busy, activeKey: K_RIG_BONES }), h(RigBoneEditor, { job, api, run, busy, activeKey: K_RIG_BONES }), 
                        // 两条导出路径同源：Spine 的 skeleton.json 与 DragonBones 的 _ske.json。
                        job.rig?.dragonBones?.skeleton !== null && job.rig?.dragonBones?.skeleton !== undefined
                            ? h("div", { className: "SPR_rigEditorRow", "data-testid": "rig-bones-db" }, h("span", { className: "SPR_refRow" }, T("DragonBones 骨架")), h("a", { className: "SPR_link", href: job.rig.dragonBones.skeleton, target: "_blank", rel: "noreferrer" }, "skeleton_ske.json"), h("span", { className: "SPR_hint" }, T("同一份骨架的 DragonBones 5.5 写法（Cocos / Egret / Laya 可直接加载）")))
                            : null, h("div", { className: "SPR_toolbar", style: { marginTop: 12 } }, h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "rig" }), T("第③步已通过")), on: rigStageOf(job, "rig").approved === true, disabled: job.rig?.status !== "ready" }, rigStageOf(job, "rig").approved === true ? T("第③步：已通过") : T("第③步：通过")), h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "rig" })) }, T("取消通过")), h(Btn, { onClick: () => setStage("atlas") }, T("下一步：图集 →"))))
                        : null, 
                    // ── ④ 图集 ────────────────────────────────────────────
                    stage === "atlas"
                        ? h("div", { className: "SPR_rigStage" }, h("div", { className: "SPR_rigStageHead" }, h("span", { className: "SPR_rigStageTitle" }, T("④ 图集")), h("span", { className: "SPR_rigStageHint" }, T("把部件按装配后的尺寸打包成 Spine 纹理图集。区域尺寸与 skeleton.json 里挂点的 width/height 一致，导入引擎不会错位。")), h(StatusChip, { node: rigStageOf(job, "atlas") })), h("div", { className: "SPR_rigEditorRow" }, h(BusyBtn, {
                            busy: keyBusy(K_RIG_ATLAS),
                            busyText: T("正在打包…"),
                            primary: true,
                            disabled: job.rig?.status !== "ready" || busy,
                            onClick: () => void run(() => api.runRigAtlas({ jobId: job.id }), T("已提交图集打包"), K_RIG_ATLAS)
                        }, T("打包纹理图集")), job.atlas?.text !== null && job.atlas?.text !== undefined ? h("a", { className: "SPR_link", href: job.atlas.text, target: "_blank", rel: "noreferrer" }, T("查看 skeleton.atlas")) : null, job.atlas?.image !== null && job.atlas?.image !== undefined ? h("a", { className: "SPR_link", href: job.atlas.image, download: "skeleton.png" }, T("下载 skeleton.png")) : null, job.atlas?.width !== undefined ? h(Chip, { kind: "ready", text: T("{n0}×{n1} · {n2} 区域{n3}", { n0: job.atlas.width, n1: job.atlas.height, n2: job.atlas.regions, n3: (job.atlas.pages ?? []).length > 1 ? T(" · {n0} 页", { n0: job.atlas.pages.length }) : "" }) }) : null), 
                        // 同一份图集的**两种描述**：Spine 的 .atlas 与 DragonBones 的 _tex.json。
                        // 两者必须是同一次装箱出来的——分开各装一次，坐标迟早对不上，
                        // 而运行时的表现只是「画错位」，不会有任何报错。
                        (job.atlas?.dragonBones ?? []).length > 0
                            ? h("div", { className: "SPR_rigEditorRow", "data-testid": "rig-atlas-db" }, h("span", { className: "SPR_refRow" }, T("DragonBones 贴图")), job.atlas.dragonBones.map((entry) => h("a", { key: entry.file, className: "SPR_link", href: entry.url, target: "_blank", rel: "noreferrer" }, entry.file.split("/").pop())))
                            : null, (job.atlas?.warnings ?? []).length > 0
                            ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } }, T("图集提示：{n0}", { n0: job.atlas.warnings.join(T("；")) }))
                            : null, job.atlas?.url !== null && job.atlas?.url !== undefined
                            ? h("div", { className: "SPR_rigAtlasWrap" }, h("img", { src: job.atlas.url, alt: "atlas" }))
                            : h("p", { className: "SPR_hint", style: { marginTop: 10 } }, job.rig?.status === "ready" ? T("点「打包纹理图集」生成 skeleton.png + skeleton.atlas。") : T("先完成第③步骨骼构建。")), 
                        // 多页图集：逐页给下载与预览（页名与 .atlas 第一行严格一致）。
                        (job.atlas?.pages ?? []).length > 1
                            ? h("div", { className: "SPR_rigEditorRow" }, h("span", { className: "SPR_refRow" }, T("分页")), job.atlas.pages.map((page) => h("a", { key: page.file, className: "SPR_link", href: `/${page.file}`, target: "_blank", rel: "noreferrer" }, T("{n0}（{n1}×{n2} · {n3} 区域）", { n0: page.file.split("/").pop(), n1: page.width, n2: page.height, n3: page.regions }))))
                            : null, h("div", { className: "SPR_toolbar", style: { marginTop: 12 } }, h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "atlas" }), T("第④步已通过")), on: rigStageOf(job, "atlas").approved === true, disabled: job.atlas?.status !== "ready" }, rigStageOf(job, "atlas").approved === true ? T("第④步：已通过") : T("第④步：通过")), h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "atlas" })) }, T("取消通过"))), h("p", { className: "SPR_hint", style: { marginTop: 10 } }, T("导入 Spine：把 skeleton.json、skeleton.atlas、skeleton.png 三个文件放在同一目录，打开 Spine 时选 skeleton.json 即可。")), h("p", { className: "SPR_hint", style: { marginTop: 4 } }, T("导入 DragonBones：把 export/dragonbones/skeleton_ske.json 与 atlas/skeleton_tex.json、atlas/skeleton.png 放同一目录后加载 .json 数据与纹理。")))
                        : null, h(JobLogPanel, { job }))));
        }
        // ── 设置页 ───────────────────────────────────────────────────────────
        function ConfigSection(props) {
            useLocaleTick();
            const api = props?.api;
            const [config, setConfig] = React.useState(null);
            const [arkKey, setArkKey] = React.useState("");
            const [minimaxKey, setMinimaxKey] = React.useState("");
            const [notice, setNotice] = React.useState(null);
            const [testing, setTesting] = React.useState(null);
            const load = React.useCallback(async () => {
                if (api === undefined)
                    return;
                try {
                    const next = await api.getConfig();
                    setConfig(next);
                    // 可见性是全插件共享的状态（侧栏菜单 / 工作台页签都订阅它），
                    // 每次读到配置就广播一次——包括保存后的重读。
                    publishHiddenModules(next?.hiddenModules);
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            }, [api]);
            React.useEffect(() => {
                void load();
            }, [load]);
            const run = async (fn, successText) => {
                if (api === undefined)
                    return;
                try {
                    const value = await fn();
                    setNotice({ kind: "ok", text: typeof successText === "function" ? successText(value) : successText });
                    await load();
                }
                catch (error) {
                    setNotice({ kind: "error", text: msg(error) });
                }
            };
            if (api === undefined || config === null) {
                return h("section", { className: "SPR_settings" }, h("p", { className: "SPR_hint" }, T("正在载入配置…")));
            }
            const patch = (values) => run(() => api.saveConfig(values), T("配置已保存"));
            /**
             * 功能管理：`hiddenModules` 的当前值（以宿主返回的为准）。
             *
             * 勾选立刻**乐观广播**一次，再落盘——工作台页签与侧栏菜单是另一个组件，
             * 等一个来回才变的话，用户会看到「勾了但菜单里还在」。
             */
            const hiddenNow = normalizeHiddenKeys(config.hiddenModules);
            const toggleFeature = (key, visible) => {
                const next = MODULES.map((entry) => entry.key).filter((item) => (item === key ? !visible : hiddenNow.includes(item)));
                publishHiddenModules(next);
                void patch({ hiddenModules: next });
            };
            // 模型能力决定分辨率档位与时长控件形态；切换模型后宿主会重新收敛，
            // 这里始终以「当前模型」的能力为准，避免下拉里出现非法档位。
            const minimaxCaps = config.minimaxCapabilitiesByModel?.[config.minimaxModel] ??
                config.minimaxCapabilities ?? {
                protocol: "v2",
                resolutions: ["2K", "768P"],
                durationMin: 4,
                durationMax: 15,
                note: ""
            };
            // 模型决定网关：选中「优云智算版 H3」时顺带把 Base URL 切到它的网关；
            // 从该模型切走时，若 Base URL 还停在优云智算网关，则还原成官方默认地址。
            const compshareModelId = config.minimaxCompshareModelId;
            const compshareBaseUrl = config.minimaxCompshareBaseUrl;
            const onModelChange = (nextModel) => {
                const values = { minimaxModel: nextModel };
                if (compshareModelId !== undefined && nextModel === compshareModelId) {
                    values.minimaxBaseUrl = compshareBaseUrl;
                }
                else if (config.minimaxModel === compshareModelId && config.minimaxBaseUrl === compshareBaseUrl) {
                    values.minimaxBaseUrl = config.defaults?.minimaxBaseUrl ?? "https://api.minimaxi.com";
                }
                void patch(values);
            };
            const usingCompshare = compshareModelId !== undefined && config.minimaxModel === compshareModelId;
            return h("section", { className: "SPR_settings" }, h("h2", { style: { margin: 0, fontSize: 15 } }, T("游戏素材大师")), h("p", { className: "SPR_hint" }, T("配置两家模型的 API Key 与整条流水线的默认参数。Key 只保存在本机 DSH 数据目录下的 game-material-master/config.json（真实路径见文末「数据位置」），界面里始终脱敏显示。")), notice !== null
                ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text)
                : null, h("div", { className: "SPR_settingsGroup" }, h("h3", null, T("火山方舟（生图）")), h("p", null, config.ffmpeg?.ok === true ? T("ffmpeg 可用：{n0}", { n0: config.ffmpeg.version }) : T("ffmpeg 不可用：{n0}", { n0: config.ffmpeg?.error ?? T("未知") })), h("div", { className: "SPR_keyRow" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("API Key {n0}", { n0: config.arkApiKeySet ? T("（已配置 {n0}）", { n0: config.arkApiKeyHint }) : T("（未配置）") })), h("input", {
                className: "SPR_input",
                type: "password",
                placeholder: config.arkApiKeySet ? T("留空表示不修改") : T("粘贴 ARK_API_KEY"),
                value: arkKey,
                onChange: (event) => setArkKey(event.target.value)
            })), h(Btn, { onClick: () => run(async () => { await api.saveConfig({ arkApiKey: arkKey }); setArkKey(""); }, T("火山方舟 Key 已保存")) }, T("保存 Key")), h(Btn, { disabled: !config.arkApiKeySet, onClick: () => run(() => api.saveConfig({ clearArkApiKey: true }), T("已清除火山方舟 Key")) }, T("清除"))), h("div", { className: "SPR_fields" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("生图模型")), h("select", {
                className: "SPR_input",
                value: config.arkModel,
                onChange: (event) => void patch({ arkModel: event.target.value })
            }, (config.arkModels ?? []).map((model) => h("option", { key: model.id, value: model.id }, T("{n0}（{n1}）", { n0: model.label, n1: model.id }))), (config.arkModels ?? []).some((model) => model.id === config.arkModel)
                ? null
                : h("option", { value: config.arkModel }, T("自定义：{n0}", { n0: config.arkModel })))), 
            /**
             * 部件重绘单独一个模型。
             *
             * 拆件与重绘对模型的要求不同：前者是「按提示词画一整张摊平图」，
             * 后者是「原地改这一小块、保持轮廓」。默认跟随主模型，
             * 需要时在这里单独指定。
             */
            h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("部件重绘模型")), h("select", {
                className: "SPR_input",
                "data-testid": "cfg-redraw-model",
                value: config.arkRedrawModel ?? "",
                onChange: (event) => void patch({ arkRedrawModel: event.target.value })
            }, h("option", { value: "" }, T("跟生图模型相同")), (config.arkModels ?? []).map((model) => h("option", { key: model.id, value: model.id }, T("{n0}（{n1}）", { n0: model.label, n1: model.id }))))), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("输出尺寸")), h("input", {
                className: "SPR_input",
                value: config.arkSize,
                onChange: (event) => void patch({ arkSize: event.target.value })
            })), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "Base URL"), h("input", {
                className: "SPR_input",
                value: config.arkBaseUrl,
                onChange: (event) => void patch({ arkBaseUrl: event.target.value })
            }))), h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                busy: testing === "ark",
                busyText: T("正在生成测试图…"),
                disabled: testing !== null || !config.arkApiKeySet,
                onClick: async () => {
                    setTesting("ark");
                    await run(() => api.testArk(), (value) => T("连接正常：{n0} 返回 {n1} 字节图片", { n0: value.model, n1: value.bytes }));
                    setTesting(null);
                }
            }, T("测试连接（会真实生成 1 张 1K 小图，产生少量费用）")))), h("div", { className: "SPR_settingsGroup" }, h("h3", null, T("MiniMax（图生视频）")), h("p", null, T("视频阶段使用图生视频（I2V）。建议用 MiniMax-Hailuo-02，镜头稳定性最好。")), h("div", { className: "SPR_keyRow" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("API Key {n0}", { n0: config.minimaxApiKeySet ? T("（已配置 {n0}）", { n0: config.minimaxApiKeyHint }) : T("（未配置）") })), h("input", {
                className: "SPR_input",
                type: "password",
                placeholder: config.minimaxApiKeySet ? T("留空表示不修改") : T("粘贴 MiniMax API Key"),
                value: minimaxKey,
                onChange: (event) => setMinimaxKey(event.target.value)
            })), h(Btn, { onClick: () => run(async () => { await api.saveConfig({ minimaxApiKey: minimaxKey }); setMinimaxKey(""); }, T("MiniMax Key 已保存")) }, T("保存 Key")), h(Btn, { disabled: !config.minimaxApiKeySet, onClick: () => run(() => api.saveConfig({ clearMinimaxApiKey: true }), T("已清除 MiniMax Key")) }, T("清除"))), h("div", { className: "SPR_fields" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("视频模型")), h("select", {
                className: "SPR_input",
                value: config.minimaxModel,
                onChange: (event) => onModelChange(event.target.value)
            }, (config.minimaxModels ?? []).map((model) => h("option", { key: model.id, value: model.id }, T("{n0}（{n1}）", { n0: model.label, n1: model.id }))), (config.minimaxModels ?? []).some((model) => model.id === config.minimaxModel)
                ? null
                : h("option", { value: config.minimaxModel }, T("自定义：{n0}", { n0: config.minimaxModel })))), 
            // 时长控件随模型切换：Hailuo 是 6/10 两档，H3 是 4~15 连续区间。
            minimaxCaps.durations !== undefined
                ? h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("时长（秒）")), h("select", {
                    className: "SPR_input",
                    value: config.minimaxDuration,
                    onChange: (event) => void patch({ minimaxDuration: Number(event.target.value) })
                }, minimaxCaps.durations.map((seconds) => h("option", { key: seconds, value: seconds }, T("{n0} 秒", { n0: seconds })))))
                : h(NumField, {
                    label: T("时长（秒，{n0}~{n1}）", { n0: minimaxCaps.durationMin, n1: minimaxCaps.durationMax }),
                    value: config.minimaxDuration,
                    min: minimaxCaps.durationMin,
                    max: minimaxCaps.durationMax,
                    onChange: (value) => void patch({ minimaxDuration: value })
                }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("分辨率")), h("select", {
                className: "SPR_input",
                value: config.minimaxResolution,
                onChange: (event) => void patch({ minimaxResolution: event.target.value })
            }, minimaxCaps.resolutions.map((value) => h("option", { key: value, value }, value)))), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, usingCompshare
                ? T("Base URL（优云智算版 H3 固定使用，无需修改）")
                : T("Base URL（主机根，不含 /v1、/v2）")), h("input", {
                className: "SPR_input",
                list: "SPR_minimax_hosts",
                value: config.minimaxBaseUrl,
                disabled: usingCompshare,
                onChange: (event) => void patch({ minimaxBaseUrl: event.target.value })
            }), h("datalist", { id: "SPR_minimax_hosts" }, (config.minimaxHosts ?? []).map((host) => h("option", { key: host.id, value: host.id }, host.label))), h("span", { className: "SPR_fieldLabel" }, T("当前协议：{n0}", { n0: minimaxCaps.protocol === "v2" ? T("v2（{n0}/v2/video_generation）", { n0: config.minimaxPathPrefix ?? "" }) : T("v1（{n0}/v1/video_generation）", { n0: config.minimaxPathPrefix ?? "" }) })))), h("div", { className: "SPR_toolbar" }, h(BusyBtn, {
                busy: testing === "minimax",
                busyText: T("正在校验…"),
                disabled: testing !== null || !config.minimaxApiKeySet,
                onClick: async () => {
                    setTesting("minimax");
                    await run(() => api.testMinimax(), (value) => T("连接正常：{n0}", { n0: value.model }));
                    setTesting(null);
                }
            }, T("测试连接（只校验 Key，不产生费用）")))), h("div", { className: "SPR_settingsGroup" }, h("h3", null, T("新建项目的默认参数")), h("p", null, T("这些值会成为每个新项目的初始设置，之后可在项目里单独调整。")), h("div", { className: "SPR_fields" }, h(NumField, {
                label: T("单格宽（px）"),
                value: config.cellWidth,
                min: 16,
                max: 2048,
                onChange: (value) => void patch({ cellWidth: value })
            }), h(NumField, {
                label: T("单格高（px）"),
                value: config.cellHeight,
                min: 16,
                max: 2048,
                onChange: (value) => void patch({ cellHeight: value })
            }), h(NumField, {
                label: T("每段视频抽帧数"),
                value: config.frameCount,
                min: 1,
                max: 64,
                onChange: (value) => void patch({ frameCount: value })
            }), h(NumField, {
                label: T("并发数"),
                value: config.concurrency,
                min: 1,
                max: 8,
                onChange: (value) => void patch({ concurrency: value })
            }), h(NumField, {
                label: T("抠像下限"),
                value: config.keyLow,
                min: 0,
                max: 255,
                onChange: (value) => void patch({ keyLow: value })
            }), h(NumField, {
                label: T("抠像上限"),
                value: config.keyHigh,
                min: 1,
                max: 255,
                onChange: (value) => void patch({ keyHigh: value })
            }), h(NumField, {
                label: T("去绿溢出"),
                value: config.despill,
                min: 0,
                max: 1,
                step: 0.05,
                onChange: (value) => void patch({ despill: value })
            }), h(NumField, {
                label: T("边缘收缩（px）"),
                value: config.edgeShrink,
                min: 0,
                max: 8,
                onChange: (value) => void patch({ edgeShrink: value })
            }), h(NumField, {
                label: T("背景分割容差（0 = 只认绿色）"),
                value: config.bgTolerance,
                min: 0,
                max: 160,
                onChange: (value) => void patch({ bgTolerance: value })
            }), h(NumField, {
                label: T("抽帧工作尺寸（长边 px）"),
                value: config.workingLongEdge,
                min: 128,
                max: 2048,
                onChange: (value) => void patch({ workingLongEdge: value })
            }), h(NumField, {
                label: T("像素块边长（0/1 = 关闭）"),
                value: config.pixelSize,
                min: 0,
                max: 32,
                onChange: (value) => void patch({ pixelSize: value })
            }), h(NumField, {
                label: T("自动裁剪填充比例"),
                value: config.fillRatio,
                min: 0.5,
                max: 1,
                step: 0.02,
                onChange: (value) => void patch({ fillRatio: value })
            }), h(NumField, {
                label: T("底部留白（px）"),
                value: config.bottomMargin,
                min: 0,
                max: 64,
                onChange: (value) => void patch({ bottomMargin: value })
            }))), h("div", { className: "SPR_settingsGroup" }, h("h3", null, T("功能管理")), h("p", null, T("隐藏不用的功能。隐藏后界面里不再出现它的页签与侧栏菜单项，对话里的 AI 也无法调用它（工具会直接报错）。随时可以再打开，已有的项目数据不会被删除。")), h("div", { className: "SPR_featureList" }, MODULES.map((entry) => {
                const isHidden = hiddenNow.includes(entry.key);
                return h("label", {
                    key: entry.key,
                    className: "SPR_featureRow",
                    "data-hidden": isHidden ? "true" : "false",
                    "data-feature": entry.key
                }, h("input", {
                    type: "checkbox",
                    className: "SPR_featureCheck",
                    "data-testid": `cfg-feature-${entry.key}`,
                    checked: !isHidden,
                    onChange: (event) => toggleFeature(entry.key, event.target.checked)
                }), h("span", { className: "SPR_featureText" }, h("span", { className: "SPR_featureTitle" }, entry.title, entry.experimental === true ? h("span", { className: "SPR_expTag" }, T("实验性")) : null), h("span", { className: "SPR_featureHint" }, entry.hint)), h("span", { className: "SPR_featureState" }, isHidden ? T("已隐藏") : T("显示中")));
            })), hiddenNow.length === 0
                ? h("p", { className: "SPR_hint" }, T("当前功能全部可见。"))
                : h("p", { className: "SPR_hint" }, T("已隐藏 {n0} 个功能：{n1}。隐藏的模块在对话里同样不可调用。", {
                    n0: hiddenNow.length,
                    n1: MODULES.filter((entry) => hiddenNow.includes(entry.key)).map((entry) => entry.title).join("、")
                }))), h("div", { className: "SPR_settingsGroup" }, h("h3", null, T("数据位置")), h("p", null, T("所有项目（源图、绿幕图、视频、序列帧、整图）都保存在："), h("code", null, config.dataRoot)), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => void run(() => api.saveConfig({}), T("已刷新")) }, T("重新读取配置")))));
        }
        // ── cordis 插件体 ────────────────────────────────────────────────────
        const inject = ["slots", "remote"];
        function apply(ctx) {
            // 界面文案跟随 DSH 的语言设置；服务不可用时安静地退回中文原文。
            attachI18n(ctx);
            // 样式随 fiber 生命周期注入/移除。
            ctx.effect(() => {
                if (typeof document === "undefined")
                    return () => { };
                const style = document.createElement("style");
                style.setAttribute("data-plugin", PACKAGE);
                style.textContent = CSS;
                document.head.appendChild(style);
                return () => {
                    style.remove();
                };
            }, `${PACKAGE}: styles`);
            const mount = ctx.remote.$mount(CONTRIBUTION);
            const call = async (method, payload) => {
                await mount;
                const remote = ctx.get(`remote.${SERVICE}`);
                if (remote === undefined)
                    throw new Error(T("gameStudio 远程服务不可用，请确认插件已启用"));
                const result = payload === undefined ? await remote[method]() : await remote[method](payload);
                if (result === null || typeof result !== "object" || result.ok !== true) {
                    const detail = result?.error;
                    throw new Error(detail === undefined ? T("{n0} 调用失败", { n0: method }) : `${detail.code ?? "ERROR"}: ${detail.message ?? ""}`);
                }
                return result.value;
            };
            const api = {
                getConfig: () => call("getConfig"),
                saveConfig: (payload) => call("saveConfig", payload),
                testArk: () => call("testArk"),
                testMinimax: () => call("testMinimax"),
                listProjects: () => call("listProjects"),
                createProject: (payload) => call("createProject", payload),
                // 内置默认提示词存在宿主侧，所以「读」和「重置为默认」都要把当前界面语言带过去：
                // getProject 借它把「从没改过」的提示词换成目标语言的默认值，
                // savePrompts 借它决定「重置为默认」重置成哪国话（`...payload` 在后，显式传的优先）。
                getProject: (projectId) => call("getProject", { projectId, lang: activeLang() }),
                deleteProject: (payload) => call("deleteProject", payload),
                renameProject: (payload) => call("renameProject", payload),
                uploadSource: (payload) => call("uploadSource", payload),
                savePrompts: (payload) => call("savePrompts", { lang: activeLang(), ...payload }),
                saveSettings: (payload) => call("saveSettings", payload),
                setApproved: (payload) => call("setApproved", payload),
                revealProject: (payload) => call("revealProject", payload),
                runImage: (payload) => call("runImage", payload),
                runImages: (payload) => call("runImages", payload),
                setImageMode: (payload) => call("setImageMode", payload),
                runTurnVideo: (payload) => call("runTurnVideo", payload),
                runTurnFrames: (payload) => call("runTurnFrames", payload),
                setTurnPick: (payload) => call("setTurnPick", payload),
                setTurnPicks: (payload) => call("setTurnPicks", payload),
                resetTurnPicks: (payload) => call("resetTurnPicks", payload),
                cutTurnFrames: (payload) => call("cutTurnFrames", payload),
                runVideos: (payload) => call("runVideos", payload),
                pollVideos: (payload) => call("pollVideos", payload),
                clearVideos: (payload) => call("clearVideos", payload),
                runFrames: (payload) => call("runFrames", payload),
                prepareFramePick: (payload) => call("prepareFramePick", payload),
                setFramePick: (payload) => call("setFramePick", payload),
                setFramePicks: (payload) => call("setFramePicks", payload),
                resetFramePicks: (payload) => call("resetFramePicks", payload),
                rekey: (payload) => call("rekey", payload),
                compose: (payload) => call("compose", payload),
                listImageJobs: () => call("listImageJobs"),
                createImageJob: (payload) => call("createImageJob", payload),
                getImageJob: (jobId) => call("getImageJob", { jobId }),
                deleteImageJob: (payload) => call("deleteImageJob", payload),
                saveImageJob: (payload) => call("saveImageJob", payload),
                uploadImageRef: (payload) => call("uploadImageRef", payload),
                removeImageRef: (payload) => call("removeImageRef", payload),
                addImageItem: (payload) => call("addImageItem", payload),
                removeImageItem: (payload) => call("removeImageItem", payload),
                runImageJob: (payload) => call("runImageJob", payload),
                keyImageJob: (payload) => call("keyImageJob", payload),
                listSequenceJobs: () => call("listSequenceJobs"),
                createSequenceJob: (payload) => call("createSequenceJob", payload),
                getSequenceJob: (jobId) => call("getSequenceJob", { jobId }),
                deleteSequenceJob: (payload) => call("deleteSequenceJob", payload),
                saveSequenceJob: (payload) => call("saveSequenceJob", payload),
                uploadSequenceRef: (payload) => call("uploadSequenceRef", payload),
                removeSequenceRef: (payload) => call("removeSequenceRef", payload),
                runSequenceVideo: (payload) => call("runSequenceVideo", payload),
                pollSequenceVideo: (payload) => call("pollSequenceVideo", payload),
                clearSequenceVideo: (payload) => call("clearSequenceVideo", payload),
                runSequenceFrames: (payload) => call("runSequenceFrames", payload),
                keySequenceFrames: (payload) => call("keySequenceFrames", payload),
                composeSequence: (payload) => call("composeSequence", payload),
                setReviewMode: (payload) => call("setReviewMode", payload),
                reportClientOrigin: (payload) => call("reportClientOrigin", payload),
                // 模块④：骨骼动画生成。
                // 注意：这张表必须与上面的 REMOTE_METHODS 逐条对应——REMOTE_METHODS 只负责
                // 向宿主的远程服务**声明**方法名，真正的方法体是在这里逐个挂到 api 上的。
                // 只加声明、忘了加这里，界面就会在调用时报 “api.xxx is not a function”。
                // scripts/verify-client.mjs 里有一条契约专门盯这件事。
                listRigJobs: () => call("listRigJobs"),
                createRigJob: (payload) => call("createRigJob", payload),
                getRigJob: (payload) => call("getRigJob", payload),
                deleteRigJob: (payload) => call("deleteRigJob", payload),
                saveRigJob: (payload) => call("saveRigJob", payload),
                uploadRigSource: (payload) => call("uploadRigSource", payload),
                uploadRigPart: (payload) => call("uploadRigPart", payload),
                removeRigPart: (payload) => call("removeRigPart", payload),
                renameRigPart: (payload) => call("renameRigPart", payload),
                setRigPartVisibility: (payload) => call("setRigPartVisibility", payload),
                saveRigLayoutItem: (payload) => call("saveRigLayoutItem", payload),
                saveRigLayoutItems: (payload) => call("saveRigLayoutItems", payload),
                setRigLayoutHints: (payload) => call("setRigLayoutHints", payload),
                setRigSemantics: (payload) => call("setRigSemantics", payload),
                setRigBoneOffsets: (payload) => call("setRigBoneOffsets", payload),
                resetRigBoneOffsets: (payload) => call("resetRigBoneOffsets", payload),
                setRigAnimationSettings: (payload) => call("setRigAnimationSettings", payload),
                resetRigAnimationSettings: (payload) => call("resetRigAnimationSettings", payload),
                getRigAnimation: (payload) => call("getRigAnimation", payload),
                saveRigAnimation: (payload) => call("saveRigAnimation", payload),
                resetRigAnimation: (payload) => call("resetRigAnimation", payload),
                runRigQa: (payload) => call("runRigQa", payload),
                setRigConstraints: (payload) => call("setRigConstraints", payload),
                resetRigConstraints: (payload) => call("resetRigConstraints", payload),
                setRigMesh: (payload) => call("setRigMesh", payload),
                resetRigMesh: (payload) => call("resetRigMesh", payload),
                setRigPath: (payload) => call("setRigPath", payload),
                resetRigPath: (payload) => call("resetRigPath", payload),
                tintRigParts: (payload) => call("tintRigParts", payload),
                uploadRigTexture: (payload) => call("uploadRigTexture", payload),
                setRigTextureVersion: (payload) => call("setRigTextureVersion", payload),
                removeRigTextureVersion: (payload) => call("removeRigTextureVersion", payload),
                runRigRedraw: (payload) => call("runRigRedraw", payload),
                runRigSheet: (payload) => call("runRigSheet", payload),
                runRigSegment: (payload) => call("runRigSegment", payload),
                runRigLayout: (payload) => call("runRigLayout", payload),
                runRigBones: (payload) => call("runRigBones", payload),
                runRigAtlas: (payload) => call("runRigAtlas", payload),
                // 地图地块生成
                listTileProjects: () => call("listTileProjects"),
                createTileProject: (payload) => call("createTileProject", { lang: activeLang(), ...payload }),
                // 清单 / 画风描述的默认值存在宿主侧，所以「读」和「重置为默认」都要把语言带过去
                getTileProject: (projectId) => call("getTileProject", { projectId, lang: activeLang() }),
                deleteTileProject: (payload) => call("deleteTileProject", payload),
                saveTileProject: (payload) => call("saveTileProject", { lang: activeLang(), ...payload }),
                runTileItems: (payload) => call("runTileItems", payload),
                runTileItem: (payload) => call("runTileItem", payload),
                setTileApproved: (payload) => call("setTileApproved", payload),
                runTileMap: (payload) => call("runTileMap", payload),
                saveTileMapCells: (payload) => call("saveTileMapCells", payload),
                runTileExport: (payload) => call("runTileExport", payload),
                cancelTileJob: (payload) => call("cancelTileJob", payload),
                revealTileProject: (payload) => call("revealTileProject", payload),
                // 地图编辑器（模块六）：全本地，没有一步收费
                listMapProjects: () => call("listMapProjects"),
                createMapProject: (payload) => call("createMapProject", { lang: activeLang(), ...payload }),
                getMapProject: (payload) => call("getMapProject", { lang: activeLang(), ...payload }),
                saveMapProject: (payload) => call("saveMapProject", payload),
                deleteMapProject: (payload) => call("deleteMapProject", payload),
                importMapTileset: (payload) => call("importMapTileset", payload),
                saveMapTileset: (payload) => call("saveMapTileset", payload),
                removeMapTileset: (payload) => call("removeMapTileset", payload),
                saveMapFamilies: (payload) => call("saveMapFamilies", payload),
                createMapDoc: (payload) => call("createMapDoc", payload),
                saveMapDoc: (payload) => call("saveMapDoc", payload),
                deleteMapDoc: (payload) => call("deleteMapDoc", payload),
                duplicateMapDoc: (payload) => call("duplicateMapDoc", payload),
                applyMapOps: (payload) => call("applyMapOps", payload),
                mapUndo: (payload) => call("mapUndo", payload),
                mapRedo: (payload) => call("mapRedo", payload),
                mapPlan: (payload) => call("mapPlan", payload),
                runMapPreview: (payload) => call("runMapPreview", payload),
                runMapExport: (payload) => call("runMapExport", payload),
                cancelMapJob: (payload) => call("cancelMapJob", payload),
                setMapApproved: (payload) => call("setMapApproved", payload),
                revealMapProject: (payload) => call("revealMapProject", payload)
            };
            // ── 深链接：会话里的链接点一下切到本插件页面 ─────────────────────
            // 拦截器与生命周期绑定：插件停止 / 更新时监听器一定被摘掉。
            ctx.effect(() => {
                const disposeInterceptor = installIntentInterceptor(ctx);
                return () => {
                    disposeInterceptor();
                    intentListeners.clear();
                    pendingIntent = null;
                };
            }, T("{n0}: 深链接拦截", { n0: PACKAGE }));
            // 上报 origin（宿主据此拼可点链接），并处理「直接以深链接打开」的兜底路径。
            ctx.effect(() => {
                reportClientOrigin(api);
                consumeUrlIntent(ctx);
                return () => { };
            }, T("{n0}: 深链接引导", { n0: PACKAGE }));
            // 侧栏全局面板图标；id 与 main 的 key 必须一致，点击即切到工作台。
            // 额外注入 api / studioCtx：图标右下角的菜单按钮要靠它们读可见性、
            // 并在选中某一项时切到对应模块（`openStudioIntent`）。
            ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
                name: "sidebar.panellist",
                id: GAME_STUDIO_PANEL_ID,
                order: 40,
                label: () => T("游戏素材大师"),
                inject: () => ({ api, studioCtx: ctx })
            }, StudioGlyph));
            ctx.slots.inject("main", () => ctx.slots.register({
                name: "main",
                key: GAME_STUDIO_PANEL_ID,
                inject: () => ({ api })
            }, StudioPanel));
            ctx.slots.inject("settings.section", () => ctx.slots.register({
                name: "settings.section",
                id: GAME_STUDIO_PANEL_ID,
                order: 18,
                label: () => T("游戏素材大师"),
                inject: () => ({ api })
            }, ConfigSection));
        }
        bundleModule.exports.apply = apply;
        bundleModule.exports.inject = inject;
        bundleModule.exports.GAME_STUDIO_PANEL_ID = GAME_STUDIO_PANEL_ID;
        // 仅测试用把手：三个模块组件在工厂闭包里，脚本要能拿出来单独渲染
        // （见 scripts/verify-feedback.mjs）。运行时没有任何调用点。
        /**
         * 给自检用的把手。
         *
         * `MAP_*` 那几个是**只读的坐标函数**：`verify-map-client.mjs` 拿宿主
         * `mapgeom` / `mapdoc` 的真实现做黄金对照逐点比对 —— 界面复刻的那部分几何
         * 必须有守门的，否则「预览与导出错位」会以静默的方式回来。
         */
        bundleModule.exports.__test = { StudioPanel, TileModule, ImageModule, SequenceModule, RigSemanticsPanel, MapModule, MapExperimentalDialog, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells, MAP_visibleChunks, MAP_chunkKey, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, NumField, ZoomableImage, CSS, subscribeIntent, parseIntents, openStudioIntent, OPEN_QUERY_KEY, StudioGlyph, StudioGlyphIcon, publishHiddenModules, useHiddenModules, visibleModulesOf, normalizeHiddenKeys, ConfigSection };
        return bundleModule.exports;
    }
});
