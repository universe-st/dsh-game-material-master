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

(window as any).__ModuleLoader__.load({
  id: "dsh-game-material-master",
  factory: (require: any) => {
    const bundleModule = { exports: {} as any };
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

    // ── 远程贡献 ─────────────────────────────────────────────────────────
    // 与宿主 src/wire.ts 的 METHODS 必须一一对应；那份是唯一的真源。
    const codec = (symbol) => ({ mode: "strict", typeSymbol: symbol, schema: { parse: (value) => value } });

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
      ["runVideos", true],
      ["pollVideos", true],
      ["clearVideos", true],
      ["runFrames", true],
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
      ["runRigSheet", true],
      ["runRigSegment", true],
      ["runRigLayout", true],
      ["runRigBones", true],
      ["runRigAtlas", true]
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
    const DIRECTIONS = [
      { key: "front", compass: "S", label: "南 · 正对镜头", refs: ["源图"] },
      { key: "back", compass: "N", label: "北 · 背对镜头", refs: ["南"] },
      { key: "downLeft", compass: "SW", label: "西南 · 四分之三正面", refs: ["南"] },
      { key: "downRight", compass: "SE", label: "东南 · 四分之三正面", refs: ["南"] },
      { key: "upLeft", compass: "NW", label: "西北 · 四分之三背面", refs: ["北"] },
      { key: "upRight", compass: "NE", label: "东北 · 四分之三背面", refs: ["北"] },
      { key: "left", compass: "W", label: "西 · 左侧脸", refs: ["南", "北"] },
      { key: "right", compass: "E", label: "东 · 右侧脸", refs: ["南", "北"] }
    ];
    const DIRECTION_KEYS = DIRECTIONS.map((d) => d.key);
    const LABEL_OF = Object.fromEntries(DIRECTIONS.map((d) => [d.key, d.label]));
    const COMPASS_OF = Object.fromEntries(DIRECTIONS.map((d) => [d.key, d.compass]));

    /** 屏幕位移向量 → 方向 key。dy > 0 是往画面下方走（向南）。 */
    function directionKeyFor(dx, dy) {
      if (dx === 0 && dy === 0) return null;
      if (dy > 0) return dx > 0 ? "downRight" : dx < 0 ? "downLeft" : "front";
      if (dy < 0) return dx > 0 ? "upRight" : dx < 0 ? "upLeft" : "back";
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

    /** 四个功能模块。插件是「大师」，每个模块管一类素材。 */
    const MODULES = [
      { key: "sprite", title: "八方向图生成", hint: "一张设定图 → 8 方向 × 8 帧精灵图" },
      { key: "image", title: "图片生成", hint: "按提示词出图，可带参考图，支持抠绿幕导出 PNG" },
      { key: "sequence", title: "序列帧生成", hint: "图/视频参考生成视频 → 抽帧 → 抠像 → 合成与播放预览" },
      { key: "rig", title: "骨骼动画生成", hint: "拆件 → 装配定位 → 推骨骼与动画 → 打包 Spine 图集" }
    ];

    const STAGES = [
      { key: "images", title: "① 八方向绿幕图", hint: "以源图为基准，按依赖顺序生成八个方位的纯绿幕全身图" },
      { key: "videos", title: "② 行走动作视频", hint: "固定镜头、固定背景，让角色朝原方位原地走三步" },
      { key: "frames", title: "③ 提取序列帧", hint: "每段视频按时长平均抽帧，逐帧核对动作连贯性" },
      { key: "sheet", title: "④ 抠绿幕合成整图", hint: "剔除绿幕并按行序拼成一张精灵图" },
      { key: "preview", title: "⑤ 行走预览", hint: "用 WASD 或方向键操控角色，看看八方向接起来顺不顺" }
    ];

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
    const OPEN_MODULES = new Set(["sprite", "image", "sequence", "rig"]);
    /** 意图订阅者：三个模块组件都挂着，谁在挂载谁就被通知。 */
    const intentListeners = new Set<any>();
    /** 最近一次意图。晚挂载的组件（切模块后才渲染）订阅时立刻拿到它。 */
    let pendingIntent = null;

    function subscribeIntent(listener) {
      intentListeners.add(listener);
      if (pendingIntent !== null) listener(pendingIntent);
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
      } catch {
        return null;
      }
      if (!params.has(OPEN_QUERY_KEY)) return null;
      const intent: any = {};
      const module = params.get("module");
      if (module !== null && OPEN_MODULES.has(module)) intent.module = module;
      const projectId = params.get("project");
      if (projectId) intent.projectId = projectId;
      const jobId = params.get("job");
      if (jobId) intent.jobId = jobId;
      const stage = params.get("stage");
      if (stage) intent.stage = stage;
      const direction = params.get("direction");
      if (direction) intent.direction = direction;
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
        } catch {
          // 单个订阅者出错不该拖垮切换本身。
        }
      }
      const layout = ctx.get("layout");
      if (layout === undefined) return;
      try {
        layout.selectPanel(GAME_STUDIO_PANEL_ID);
      } catch {
        if (attempt < 20 && typeof window !== "undefined") {
          window.setTimeout(() => openStudioIntent(ctx, intent, attempt + 1), 150);
        }
      }
    }

    function intentOfAnchor(event) {
      if (event.button !== 0) return null;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null; // 让浏览器按用户意图新开标签页
      const target = event.target;
      if (target === null || target === undefined || typeof target.closest !== "function") return null;
      const anchor = target.closest("a[href]");
      if (anchor === null) return null;
      let url;
      try {
        url = new URL(anchor.getAttribute("href"), window.location.origin);
      } catch {
        return null;
      }
      return parseIntents(url.search);
    }

    /** 捕获阶段拦下深链接点击：原地切面板，不跳转、不新开标签。 */
    function installIntentInterceptor(ctx) {
      if (typeof document === "undefined" || typeof window === "undefined" || window.location === undefined) return () => {};
      const onClick = (event) => {
        if (event.defaultPrevented) return;
        let intent;
        try {
          intent = intentOfAnchor(event);
        } catch {
          return;
        }
        if (intent === null) return;
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
      if (typeof window === "undefined" || window.location === undefined) return;
      const intent = parseIntents(window.location.search);
      if (intent === null) return;
      try {
        const url = new URL(window.location.href);
        // 确认过 dsh-gmm 才走到这里，所以这几个键一定是本插件写的，一起清掉。
        for (const key of [OPEN_QUERY_KEY, "module", "project", "job", "stage", "direction"]) {
          url.searchParams.delete(key);
        }
        window.history.replaceState(null, "", url.toString());
      } catch {
        // 清不掉参数也不影响切换，忽略。
      }
      openStudioIntent(ctx, intent);
    }

    /**
     * 把真实 origin 报给宿主：宿主不知道对外地址（可能被反代改写），
     * 而模型要在回复里贴出可点的绝对链接。失败不影响任何功能。
     */
    function reportClientOrigin(api) {
      if (typeof window === "undefined" || window.location === undefined) return;
      const origin = window.location.origin;
      if (typeof origin !== "string" || origin === "" || origin === "null") return;
      void Promise.resolve(api.reportClientOrigin({ origin })).catch(() => undefined);
    }

    // ── 样式 ─────────────────────────────────────────────────────────────
    const CSS = `
.SPR_root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
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
.SPR_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:14px;margin-bottom:14px}
.SPR_cardHead{display:flex;align-items:baseline;gap:8px;margin-bottom:4px;flex-wrap:wrap}
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
.SPR_keyRow{display:flex;gap:8px;align-items:flex-end}
.SPR_keyRow .SPR_field{flex:1}
.SPR_badge{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}
.SPR_videoWrap{position:relative;width:100%}
.SPR_video{width:100%;border-radius:8px;display:block;background:#000}
.SPR_modules{display:flex;gap:8px;padding:10px 18px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;flex-wrap:wrap}
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
.SPR_asmBody{display:flex;gap:12px;align-items:flex-start}
.SPR_asmStage{flex:1;min-width:0;max-height:70vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:#fff;padding:8px;display:flex;justify-content:center}
.SPR_asmCanvas{position:relative;flex:none;background:#fff;background-image:linear-gradient(45deg,rgba(128,128,128,.12) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.12) 75%),linear-gradient(45deg,rgba(128,128,128,.12) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.12) 75%);background-size:20px 20px;background-position:0 0,10px 10px;user-select:none}
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
.SPR_spin{width:26px;height:26px;flex:none;border-radius:50%;border:2.5px solid rgba(255,255,255,.26);border-top-color:#fff;animation:SPR_spin .8s linear infinite}
.SPR_spinSm{width:13px;height:13px;flex:none;border-radius:50%;border:2px solid color-mix(in srgb, currentColor 30%, transparent);border-top-color:currentColor;animation:SPR_spin .8s linear infinite}
@keyframes SPR_spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.SPR_spin,.SPR_spinSm{animation-duration:2.4s}}
.SPR_thumbBox{position:relative}
.SPR_btn[data-busy=true]{display:inline-flex;align-items:center;gap:6px;cursor:progress}
.SPR_busyBadge{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:16px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary);white-space:nowrap;flex:none}
.SPR_busyBadge .SPR_spinSm{border-color:color-mix(in srgb, currentColor 26%, transparent);border-top-color:currentColor}
.SPR_drop[data-busy=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
`;

    // ── 小工具 ───────────────────────────────────────────────────────────
    function cls(...parts) {
      return parts.filter(Boolean).join(" ");
    }

    /** 从 unknown 的 catch 参数里取一条可读消息。 */
    function msg(error) {
      if (error instanceof Error) return error.message;
      if (error !== null && typeof error === "object" && typeof (error as any).message === "string") return (error as any).message;
      return String(error);
    }

    function statusKind(node) {
      if (node === undefined) return { kind: "empty", text: "未生成" };
      if (node.approved) return { kind: "approved", text: "已通过" };
      if (node.status === "running") return { kind: "running", text: "进行中" };
      if (node.status === "error") return { kind: "error", text: "失败" };
      if (node.status === "ready") {
        if (node.stale) return { kind: "stale", text: "需重做" };
        return { kind: "ready", text: "已完成" };
      }
      return { kind: "empty", text: "未生成" };
    }

    function Chip({ kind, text }) {
      return h("span", { className: "SPR_chip", "data-kind": kind }, text);
    }

    function StatusChip({ node }) {
      const info = statusKind(node);
      return h(Chip, { kind: info.kind, text: info.text });
    }

    function Btn({ children, onClick, disabled, primary, on, danger, title, busy }) {
      return h(
        "button",
        {
          type: "button",
          className: "SPR_btn",
          onClick,
          disabled: disabled === true,
          title,
          "data-primary": primary === true ? "true" : undefined,
          "data-on": on === true ? "true" : undefined,
          "data-danger": danger === true ? "true" : undefined,
          "data-busy": busy === true ? "true" : undefined,
          "aria-busy": busy === true ? "true" : undefined
        },
        children
      );
    }

    function NumField({ label, value, onChange, min, max, step }) {
      return h(
        "label",
        { className: "SPR_field" },
        h("span", { className: "SPR_fieldLabel" }, label),
        h("input", {
          className: "SPR_input",
          type: "number",
          value: value,
          min,
          max,
          step: step === undefined ? 1 : step,
          onChange: (event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }
        })
      );
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
            if (alive) setValue(next);
          } catch {
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
      return h(
        "label",
        { className: "SPR_field" },
        h("span", { className: "SPR_fieldLabel" }, label),
        h("input", { className: "SPR_input", value: value ?? "", readOnly: true, disabled: true }),
        h("span", { className: "SPR_fieldLabel" }, "跟随即「设置 → 游戏素材大师」")
      );
    }

    function assetUrl(project, relative, version) {
      if (project === null || relative === undefined || relative === null) return undefined;
      const base = project.assetBase ?? "";
      const suffix = version === undefined ? "" : `?v=${version}`;
      return `${base}${relative}${suffix}`;
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
          for (const id of timers) clearTimeout(id);
          timers.length = 0;
        };
      }, []);

      const release = React.useCallback((key) => {
        const id = setTimeout(() => {
          if (!aliveRef.current) return;
          setMap((current) => {
            if (current[key] === undefined) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
        }, TASK_HOLD_MS);
        timersRef.current.push(id);
      }, []);

      const run = React.useCallback(
        (key, label, fn) => {
          if (!aliveRef.current) return Promise.resolve(undefined);
          setMap((current) => (current[key] === label ? current : { ...current, [key]: label }));
          return Promise.resolve()
            .then(fn)
            .then(
              (value) => {
                release(key);
                return value;
              },
              (error) => {
                release(key);
                throw error;
              }
            );
        },
        [release]
      );

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
      if (show !== true) return null;
      return h(
        "div",
        { className: "SPR_ovl", role: "status", "aria-live": "polite", "aria-busy": "true" },
        h("span", { className: "SPR_spin" }),
        h("span", { className: "SPR_ovlText" }, text ?? "处理中…"),
        sub === undefined || sub === null ? null : h("span", { className: "SPR_ovlSub" }, sub)
      );
    }

    /**
     * 一张图 / 一段视频的预览位：内容 + 可选遮罩。
     * 原来各阶段的 `<img className="SPR_thumb">` 直接放在节点卡片里，
     * 现在统一包一层定位容器，遮罩才能正好盖住预览区。
     */
    function MediaBox({ overlay, text, className, children }) {
      return h(
        "div",
        { className: cls("SPR_thumbBox", className) },
        h("div", { style: { visibility: overlay === true ? "hidden" : undefined } }, children),
        h(LoadingOverlay, { show: overlay === true, text: text ?? "正在生成…" })
      );
    }

    /** 按钮级别的「正在跑」：转圈 + 文案，并把按钮本身置灰防重复点击。 */
    function BusyBtn({ busy, busyText, children, onClick, ...rest }) {
      return h(
        Btn,
        { ...rest, onClick, disabled: busy === true || rest.disabled === true, busy: busy === true },
        busy === true ? h("span", { className: "SPR_spinSm" }) : null,
        busy === true ? busyText ?? "处理中…" : children
      );
    }

    /** 工具栏上的状态徽章：有任务在跑时显示，同时兼作按钮区的位置占位。 */
    function BusyBadge({ show, text }) {
      if (show !== true) return null;
      return h(
        "span",
        { className: "SPR_busyBadge", role: "status", "aria-live": "polite" },
        h("span", { className: "SPR_spinSm" }),
        text ?? "正在处理…"
      );
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
        if (busy || next === "" || id === null || id === undefined) return;
        setBusy(true);
        try {
          await api.setReviewMode({ module, id, reviewMode: next });
          if (onChanged !== undefined) onChanged(next);
        } catch {
          // 失败就保持原值；下一次轮询会把宿主上的真实值带回来。
        } finally {
          setBusy(false);
        }
      };
      return h(
        "div",
        { className: "SPR_toolbar" },
        h("span", { className: "SPR_refRow" }, "审核模式"),
        h(
          "select",
          {
            className: "SPR_input",
            style: { width: 210 },
            value: mode ?? "",
            disabled: busy || id === null || id === undefined,
            onChange: (event) => void change(event.target.value)
          },
          h("option", { value: "" }, "未设置（对话里会先问）"),
          h("option", { value: "auto" }, "自动审核"),
          h("option", { value: "manual" }, "每一步人工审核")
        ),
        h(
          "span",
          { className: "SPR_refRow" },
          mode === "manual"
            ? "每一步产出后 agent 会贴出验收链接并停下来等你确认"
            : mode === "auto"
              ? "agent 自己检查每步产出后继续推进"
              : "还没定：对话里 agent 会先问你要哪种"
        )
      );
    }

    /** 单个产物的「通过 / 取消通过」。与对话里的 game_material_approve 同一份数据。 */
    function ApproveBtn(props) {
      const { approved, disabled, onToggle, idleText } = props;
      return h(
        Btn,
        { on: approved === true, disabled: disabled === true, onClick: onToggle },
        approved === true ? "已通过" : idleText ?? "通过"
      );
    }

    // ── 侧栏图标 ─────────────────────────────────────────────────────────
    function StudioGlyph(props) {
      const size = props?.size ?? 18;
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("rect", { x: 3.2, y: 3.2, width: 17.6, height: 17.6, rx: 3, stroke: "currentColor", strokeWidth: 1.6 }),
        h("rect", { x: 5.6, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }),
        h("rect", { x: 10.2, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 14.8, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }),
        h("rect", { x: 5.6, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 10.2, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.28 }),
        h("rect", { x: 14.8, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 5.6, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }),
        h("rect", { x: 10.2, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 14.8, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 })
      );
    }

    // ── 主体工作台 ───────────────────────────────────────────────────────
    function StudioPanel(props) {
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

      React.useEffect(() => {
        if (intent === null) return;
        if (typeof intent.module === "string") setModule(intent.module);
        if (typeof intent.projectId === "string") setProjectId(intent.projectId);
        if (typeof intent.stage === "string" && STAGES.some((item) => item.key === intent.stage)) setStage(intent.stage);
      }, [intent]);

      const busy = project !== null && ((project.jobs?.length ?? 0) > 0 ||
        DIRECTION_KEYS.some((key) => project.videos?.[key]?.status === "running"));
      // 轮询条件也要算上正在跑的这一次调用，否则点完按钮到 running 落盘之间不会刷新。
      const polling = busy || tasks.active;

      const refreshProjects = React.useCallback(async () => {
        if (api === undefined) return;
        try {
          const result = await api.listProjects();
          setProjects(result.projects ?? []);
          return result.projects ?? [];
        } catch (error) {
          setNotice({ kind: "error", text: msg(error) });
          return [];
        }
      }, [api]);

      const loadProject = React.useCallback(
        async (id) => {
          if (api === undefined || id === null) return;
          try {
            const next = await api.getProject(id);
            setProject(next);
            setPromptDraft({ ...(next.prompts?.images ?? {}) });
            setVideoPromptDraft(next.prompts?.video ?? "");
            setSettingsDraft({ ...(next.settings ?? {}) });
            setPromptOpen((current) => {
              const keys = Object.keys(current);
              if (keys.length > 0) return current;
              return {};
            });
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
          }
        },
        [api]
      );

      // 首次挂载：拉项目列表，自动选中最近一个。
      React.useEffect(() => {
        let cancelled = false;
        void (async () => {
          const list = await refreshProjects();
          if (cancelled) return;
          setLoading(false);
          if (list.length > 0) setProjectId((current) => current ?? list[0].id);
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
      }, [projectId, loadProject]);

      // 有任务在跑时轮询；跑完自动停。
      React.useEffect(() => {
        if (!polling || projectId === null) return undefined;
        const timer = setInterval(() => {
          void loadProject(projectId);
        }, 2500);
        return () => clearInterval(timer);
      }, [polling, projectId, loadProject]);

      // 视频阶段即便宿主侧在轮询，界面也要定期刷新任务状态。
      React.useEffect(() => {
        if (stage !== "videos" || projectId === null) return undefined;
        const timer = setInterval(() => {
          void loadProject(projectId);
        }, 5000);
        return () => clearInterval(timer);
      }, [stage, projectId, loadProject]);

      const withApi = React.useCallback(
        async (fn, options: any = {}) => {
          if (api === undefined) {
            setNotice({ kind: "error", text: "远程服务尚未挂载完成，请稍候再试" });
            return undefined;
          }
          try {
            const value = await fn();
            if (options.notice !== undefined) setNotice({ kind: options.noticeKind ?? "info", text: options.notice });
            if (options.reload === true && projectId !== null) await loadProject(projectId);
            return value;
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
            return undefined;
          }
        },
        [api, projectId, loadProject]
      );

      const createProject = () =>
        withApi(
          async () => {
            const created = await api.createProject({ name: `角色 ${new Date().toLocaleString("zh-CN", { hour12: false })}` });
            await refreshProjects();
            setProjectId(created.projectId);
          },
          { notice: "已创建新项目" }
        );

      const deleteCurrent = async () => {
        if (project === null) return;
        // eslint-disable-next-line no-alert
        if (typeof window !== "undefined" && !window.confirm(`确定删除项目「${project.name}」？项目目录会被整个移除，无法撤销。`)) return;
        await withApi(async () => {
          await api.deleteProject({ projectId: project.id });
          const list = await refreshProjects();
          setProjectId(list.length > 0 ? list[0].id : null);
          if (list.length === 0) setProject(null);
        });
      };

      const renameCurrent = async () => {
        if (project === null) return;
        // eslint-disable-next-line no-alert
        const next = typeof window === "undefined" ? null : window.prompt("新的项目名", project.name);
        if (next === null || next.trim() === "") return;
        await withApi(async () => {
          await api.renameProject({ projectId: project.id, name: next.trim() });
          await refreshProjects();
        }, { reload: true });
      };

      const uploadSource = React.useCallback(
        async (file) => {
          if (project === null || file === undefined || file === null) return;
          setSourceBusy(true);
          try {
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const text = String(reader.result ?? "");
                resolve(text.slice(text.indexOf(",") + 1));
              };
              reader.onerror = () => reject(new Error("读取文件失败"));
              reader.readAsDataURL(file);
            });
            await api.uploadSource({ projectId: project.id, name: file.name, data: base64 });
            setNotice({ kind: "ok", text: `已上传源图：${file.name}` });
            await loadProject(project.id);
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
          } finally {
            setSourceBusy(false);
          }
        },
        [api, project, loadProject]
      );

      const savePrompts = (patch) =>
        withApi(() => api.savePrompts({ projectId: project.id, ...patch }), {
          reload: true,
          notice: "提示词已保存",
          noticeKind: "ok"
        });

      const saveSettings = (patch) =>
        withApi(() => api.saveSettings({ projectId: project.id, settings: patch }), {
          reload: true,
          notice: "参数已保存",
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
      const start = async (fn, done, feedback?: any) => {
        const invoke = () => withApi(fn, done);
        const result =
          feedback === undefined
            ? await invoke()
            : await tasks.run(feedback.key, feedback.label, invoke);
        if (result !== null && typeof result === "object" && result.started === false) {
          setNotice({ kind: "info", text: result.reason ?? "任务没有启动" });
        }
        return result;
      };

      if (api === undefined) {
        return h("div", { className: "SPR_root" }, h("p", { className: "SPR_empty" }, "正在挂载游戏素材大师…"));
      }

      const activeStageIndex = STAGES.findIndex((s) => s.key === stage);
      const activeStage = STAGES[activeStageIndex < 0 ? 0 : activeStageIndex];

      return h(
        "div",
        { className: "SPR_root" },
        h(
          "div",
          { className: "SPR_head" },
          h("h2", null, "游戏素材大师"),
          h("span", { className: "SPR_headSub" }, "火山方舟 Seedream 生图 · MiniMax 图生视频 · 本地抠绿幕合成"),
          h("span", { className: "SPR_spacer" }),
          module === "sprite"
            ? h(
                React.Fragment,
                null,
                h(Btn, { onClick: () => void refreshProjects(), disabled: loading }, "刷新列表"),
                project !== null ? h(Btn, { onClick: renameCurrent }, "重命名") : null,
                project !== null ? h(Btn, { onClick: deleteCurrent, danger: true }, "删除项目") : null,
                h(Btn, { onClick: createProject, primary: true }, "新建项目")
              )
            : null
        ),
        h(
          "div",
          { className: "SPR_modules" },
          MODULES.map((entry) =>
            h(
              "button",
              {
                key: entry.key,
                type: "button",
                className: "SPR_module",
                "data-active": module === entry.key ? "true" : "false",
                onClick: () => setModule(entry.key)
              },
              h("span", { className: "SPR_moduleTitle" }, entry.title),
              h("span", { className: "SPR_moduleHint" }, entry.hint)
            )
          )
        ),
        module === "sprite"
          ? h(
          "div",
          { className: "SPR_body" },
          h(
            "div",
            { className: "SPR_side" },
            h("div", { className: "SPR_sideTitle" }, `项目（${projects.length}）`),
            projects.length === 0
              ? h("p", { className: "SPR_hint" }, "还没有项目，点右上角「新建项目」开始。")
              : projects.map((summary) =>
                  h(
                    "button",
                    {
                      key: summary.id,
                      type: "button",
                      className: "SPR_projItem",
                      "data-active": summary.id === projectId ? "true" : "false",
                      onClick: () => setProjectId(summary.id)
                    },
                    h("span", { className: "SPR_projName" }, summary.name),
                    h(
                      "span",
                      { className: "SPR_projMeta" },
                      `图 ${summary.imageReady}/8 · 视频 ${summary.videoReady}/8 · 帧 ${summary.framesReady}/8${summary.sheetReady ? " · 整图✓" : ""}`
                    )
                  )
                )
          ),
          h(
            "div",
            { className: "SPR_main" },
            notice !== null
              ? h(
                  "div",
                  { className: "SPR_note", "data-kind": notice.kind },
                  notice.text,
                  h(
                    "span",
                    { style: { marginLeft: 10 } },
                    h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, "关闭")
                  )
                )
              : null,
            project === null
              ? h("p", { className: "SPR_empty" }, loading ? "正在载入…" : "请选择或新建一个项目")
              : h(
                  React.Fragment,
                  null,
                  // 审核模式：与对话里的 game_material_reviewMode 是同一份数据。
                  h(ReviewModeBar, { api, module: "sprite", id: project.id, mode: project.reviewMode, onChanged: () => void loadProject(project.id) }),
                  h(
                    "div",
                    { className: "SPR_steps" },
                    STAGES.map((item, index) =>
                      h(
                        "button",
                        {
                          key: item.key,
                          type: "button",
                          className: "SPR_step",
                          "data-active": item.key === stage ? "true" : "false",
                          onClick: () => setStage(item.key)
                        },
                        h("span", {
                          className: "SPR_stepDot",
                          style: {
                            background: stageDone(project, item.key)
                              ? "var(--dsw-alias-state-success-primary)"
                              : "var(--dsw-alias-label-tertiary)"
                          }
                        }),
                        item.title
                      )
                    )
                  ),
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, activeStage.title)),
                    h("p", { className: "SPR_hint" }, activeStage.hint),
                    stage === "images"
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
                      : null,
                    stage === "videos"
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
                      : null,
                    stage === "frames"
                      ? renderFrameStage({ project, api, start, setNotice, loadProject, settingsDraft, saveSettings, tasks })
                      : null,
                    stage === "sheet"
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
                      : null,
                    stage === "preview" ? h(WalkPreview, { project, tasks }) : null
                  ),
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, "源图")),
                    h("p", { className: "SPR_hint" }, "上传角色的原始设定图。第一步的正面绿幕图会以它为唯一参考。"),
                    h(
                      "div",
                      { className: "SPR_sourceRow" },
                      project.source !== null
                        ? h("img", {
                            className: "SPR_sourcePreview",
                            src: assetUrl(project, project.source.file, project.updatedAt),
                            alt: "源图"
                          })
                        : h("div", { className: "SPR_thumbEmpty", style: { width: 132, height: 132, flex: "none" } }, "尚未上传源图"),
                      h(
                        "div",
                        { style: { flex: 1, minWidth: 240 } },
                        h(
                          "div",
                          {
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
                          },
                          sourceBusy ? "正在上传…" : "把图片拖到这里，或"
                        ),
                        h(
                          "div",
                          { className: "SPR_toolbar" },
                          h(
                            Btn,
                            { onClick: () => fileInputRef.current?.click(), disabled: sourceBusy, primary: project.source === null },
                            project.source === null ? "选择源图" : "更换源图"
                          ),
                          project.source !== null
                            ? h("span", { className: "SPR_refRow" }, project.source.name)
                            : null
                        ),
                        h("input", {
                          ref: fileInputRef,
                          type: "file",
                          accept: "image/*",
                          style: { display: "none" },
                          onChange: (event) => {
                            const file = event.target.files?.[0];
                            void uploadSource(file);
                            event.target.value = "";
                          }
                        })
                      )
                    )
                  ),
                  renderLog(project),
                  h(
                    "div",
                    { className: "SPR_toolbar" },
                    h(Btn, { onClick: () => void loadProject(project.id) }, "刷新状态"),
                    h(Btn, { onClick: () => void withApi(() => api.revealProject({ projectId: project.id })) }, "在访达中打开项目目录")
                  )
                )
          )
        )
          : module === "image"
            ? h(ImageModule, { api })
            : module === "sequence"
              ? h(SequenceModule, { api })
              : h(RigModule, { api })
      );
    }

    function stageDone(project, key) {
      if (key === "images") return DIRECTION_KEYS.every((k) => project.images?.[k]?.approved);
      if (key === "videos") return DIRECTION_KEYS.every((k) => project.videos?.[k]?.approved);
      if (key === "frames") return DIRECTION_KEYS.every((k) => project.frames?.[k]?.approved);
      if (key === "preview") return project.sheet?.approved === true;
      return project.sheet?.approved === true;
    }

    // ── 阶段 1：八方向绿幕图 ─────────────────────────────────────────────
    /** 阶段①的 pending key：单方向、批量、整批重新生成、重置提示词。 */
    const KEY_IMG_ONE = (key) => `image:${key}`;
    const KEY_IMG_ALL = "image:*all";
    const KEY_IMG_REGENERATE = "image:*regenerate";
    const KEY_PROMPT_RESET = "prompt:*reset";

    function renderImageStage(ctx) {
      const { project, api, promptDraft, setPromptDraft, promptOpen, setPromptOpen, savePrompts, start, setNotice, tasks } = ctx;
      const allApproved = DIRECTION_KEYS.every((key) => project.images?.[key]?.approved);
      // 「一键生成全部」/「全部重新生成」提交后，八个方向都可能要重出图，
      // 在宿主状态回来之前先整体盖住，别让用户以为按钮没生效。
      const batch = tasks.has(KEY_IMG_ALL) || tasks.has(KEY_IMG_REGENERATE);
      const batchLabel = tasks.label(KEY_IMG_REGENERATE) ?? tasks.label(KEY_IMG_ALL) ?? "正在生成绿幕图…";
      // 宿主侧那批生成还在跑（一次两个方向地慢慢做）：本地 pending 只多留 700ms，
      // 撑不住整批，按钮的置灰与徽章要看宿主这张表。
      const hostAll = hostJob(project, "images:all");
      const batchBusy = batch || hostAll !== undefined;
      const resetting = tasks.has(KEY_PROMPT_RESET);

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_toolbar" },
          h(
            BusyBtn,
            {
              primary: true,
              busy: tasks.has(KEY_IMG_ALL),
              busyText: "正在提交全部方向…",
              // 宿主的这一批还在跑时按钮置灰：重复点只会被宿主拒绝，
              // 用户却会以为没反应（工具栏徽章已经写明在跑什么）。
              disabled: project.source === null || batchBusy,
              onClick: () =>
                void start(() => api.runImages({ projectId: project.id }), { reload: true }, {
                  key: KEY_IMG_ALL,
                  label: "正在提交全部方向…"
                })
            },
            "一键生成全部（跳过已通过的）"
          ),
          h(
            BusyBtn,
            {
              busy: tasks.has(KEY_IMG_REGENERATE),
              busyText: "正在提交全部重做…",
              disabled: batchBusy,
              onClick: () =>
                void start(() => api.runImages({ projectId: project.id, force: true }), { reload: true }, {
                  key: KEY_IMG_REGENERATE,
                  label: "正在提交全部重做…"
                })
            },
            "全部重新生成"
          ),
          h(
            Btn,
            {
              on: allApproved,
              disabled: batchBusy,
              onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "images", approved: !allApproved }), { reload: true })
            },
            allApproved ? "取消全部通过" : "全部标记通过"
          ),
          h(
            BusyBtn,
            {
              busy: resetting,
              busyText: "正在重置…",
              disabled: batchBusy,
              onClick: () => {
                if (typeof window !== "undefined" && !window.confirm("把八个方向的生图提示词和视频提示词都重置为当前默认模板？你手改过的内容会丢失。")) return;
                void start(
                  () => api.savePrompts({ projectId: project.id, resetImagesToDefault: true, resetVideoToDefault: true }),
                  { reload: true, notice: "提示词已重置为默认模板", noticeKind: "ok" },
                  { key: KEY_PROMPT_RESET, label: "正在重置提示词…" }
                );
              }
            },
            "重置提示词为默认"
          ),
          h(BusyBadge, { show: batchBusy, text: batchLabel }),
          project.source === null ? h("span", { className: "SPR_refRow" }, "请先上传源图") : null
        ),
        h(
          "div",
          { className: "SPR_grid" },
          DIRECTIONS.map((direction) => {
            const node = project.images?.[direction.key];
            const draft = promptDraft[direction.key] ?? project.prompts?.images?.[direction.key] ?? "";
            const dirty = draft !== (project.prompts?.images?.[direction.key] ?? "");
            const open = promptOpen[direction.key] === true;
            // 这个方向在跑：宿主已标 running，或刚点了按钮、状态还没轮询回来。
            const taskKey = KEY_IMG_ONE(direction.key);
            // 批量提交时，**还没轮到的方向也要盖住**——否则旧图看着像「点了没反应」。
            // 两条路：本地刚点下去（批量 key），或宿主那批任务还在跑且覆盖了这个方向。
            const waiting =
              (batch && node?.status !== "running" && !tasks.has(taskKey)) ||
              (jobCovers(hostAll, direction.key) && node?.status !== "error");
            const nodeBusy = node?.status === "running" || tasks.has(taskKey) || waiting;
            const withPromptKey = `${taskKey}:prompt`;
            const overlayText = tasks.label(taskKey) ?? (waiting ? batchLabel : "正在生成…");
            return h(
              "div",
              { key: direction.key, className: "SPR_node", "data-stale": node?.stale === true ? "true" : "false", "data-busy": nodeBusy ? "true" : undefined },
              h(
                "div",
                { className: "SPR_nodeTop" },
                h("span", { className: "SPR_nodeTitle" }, direction.label),
                nodeBusy ? h(Chip, { kind: "running", text: "生成中" }) : h(StatusChip, { node })
              ),
              node?.file !== undefined
                ? h(
                    MediaBox,
                    { overlay: nodeBusy, text: overlayText },
                    h("img", {
                      className: "SPR_thumb",
                      src: assetUrl(project, node.file, node.updatedAt ?? project.updatedAt),
                      alt: direction.label
                    })
                  )
                : h(
                    "div",
                    { className: "SPR_thumbEmpty" },
                    nodeBusy ? "正在生成…" : `参考：${direction.refs.join(" + ")}`
                  ),
              nodeBusy ? h(BusyBadge, { show: true, text: overlayText }) : null,
              node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null,
              node?.status === "ready" && node.elapsedMs !== undefined
                ? h("span", { className: "SPR_refRow" }, `用时 ${(node.elapsedMs / 1000).toFixed(1)} 秒 · ${node.model ?? ""}`)
                : h("span", { className: "SPR_refRow" }, `参考：${direction.refs.join(" + ")}`),
              h(
                "button",
                {
                  type: "button",
                  className: "SPR_miniBtn",
                  onClick: () => setPromptOpen({ ...promptOpen, [direction.key]: !open })
                },
                open ? "收起提示词 ▲" : "编辑提示词 ▼"
              ),
              open
                ? h(
                    React.Fragment,
                    null,
                    h("textarea", {
                      className: "SPR_area",
                      value: draft,
                      onChange: (event) => setPromptDraft({ ...promptDraft, [direction.key]: event.target.value })
                    }),
                    h(
                      "div",
                      { className: "SPR_btnRow" },
                      h(
                        Btn,
                        {
                          disabled: !dirty,
                          onClick: () => void savePrompts({ images: { [direction.key]: draft } })
                        },
                        dirty ? "保存改动" : "已保存"
                      ),
                      h(
                        BusyBtn,
                        {
                          busy: tasks.has(withPromptKey),
                          busyText: "正在提交…",
                          onClick: () =>
                            void start(
                              () => api.runImage({ projectId: project.id, key: direction.key, prompt: draft }),
                              { reload: true },
                              { key: withPromptKey, label: `正在用这段提示词生成「${direction.label}」…` }
                            )
                        },
                        "用这段提示词生成"
                      )
                    )
                  )
                : null,
              h(
                "div",
                { className: "SPR_btnRow" },
                h(
                  BusyBtn,
                  {
                    primary: node?.file === undefined,
                    busy: tasks.has(taskKey),
                    busyText: "正在提交…",
                    onClick: () =>
                      void start(() => api.runImage({ projectId: project.id, key: direction.key }), { reload: true }, {
                        key: taskKey,
                        label: `正在生成「${direction.label}」…`
                      })
                  },
                  node?.file === undefined ? "生成" : "重新生成"
                ),
                h(
                  Btn,
                  {
                    on: node?.approved === true,
                    disabled: node?.status !== "ready",
                    onClick: () =>
                      void start(() =>
                        api.setApproved({
                          projectId: project.id,
                          stage: "images",
                          key: direction.key,
                          approved: node?.approved !== true
                        }), { reload: true })
                  },
                  node?.approved === true ? "已通过" : "通过"
                )
              )
            );
          })
        )
      );
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
      const allLabel = tasks.label(KEY_VIDEO_ALL) ?? "正在提交 8 个方向的视频任务…";

      return h(
        React.Fragment,
        null,
        h("p", { className: "SPR_hint" }, "提示词要求「固定镜头、固定背景、原地走三步」。Hailuo 一段通常要 1~6 分钟，提交后可以离开这个页面。"),
        h("textarea", {
          className: "SPR_area",
          value: videoPromptDraft,
          onChange: (event) => setVideoPromptDraft(event.target.value)
        }),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(Btn, { disabled: !promptDirty, onClick: () => void savePrompts({ video: videoPromptDraft }) }, promptDirty ? "保存视频提示词" : "视频提示词已保存"),
          h(
            BusyBtn,
            {
              primary: true,
              busy: tasks.has(KEY_VIDEO_ALL),
              busyText: "正在提交 8 个方向…",
              disabled: readyImages.length === 0 || submitting,
              onClick: () =>
                void start(() => api.runVideos({ projectId: project.id }), { reload: true }, {
                  key: KEY_VIDEO_ALL,
                  label: "正在提交全部方向…"
                })
            },
            `生成全部视频（${readyImages.length}/8 张绿幕图就绪）`
          ),
          h(
            BusyBtn,
            {
              busy: tasks.has(KEY_VIDEO_POLL),
              busyText: "正在查询…",
              onClick: () =>
                void start(() => api.pollVideos({ projectId: project.id }), { reload: true }, {
                  key: KEY_VIDEO_POLL,
                  label: "正在查询远端视频进度…"
                })
            },
            "立即刷新进度"
          ),
          h(
            Btn,
            {
              on: allApproved,
              disabled: submitting,
              onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "videos", approved: !allApproved }), { reload: true })
            },
            allApproved ? "取消全部通过" : "全部标记通过"
          ),
          h(
            Btn,
            {
              danger: true,
              disabled: submitting,
              onClick: () => {
                if (typeof window !== "undefined" && !window.confirm("清空所有视频与已抽的帧？绿幕图会保留。")) return;
                void start(() => api.clearVideos({ projectId: project.id }), { reload: true, notice: "已清空视频与序列帧", noticeKind: "ok" });
              }
            },
            "清空视频重来"
          ),
          running.length > 0 ? h("span", { className: "SPR_refRow" }, `${running.length} 个任务进行中，界面会自动刷新`) : null
        ),
        h(
          "div",
          { className: "SPR_grid" },
          DIRECTIONS.map((direction) => {
            const video = project.videos?.[direction.key];
            const image = project.images?.[direction.key];
            const taskKey = KEY_VIDEO_ONE(direction.key);
            // 还没轮到的方向：本地批量提交（allBusy），或宿主那批提交覆盖了它。
            const waiting =
              (allBusy && video?.status !== "running" && !tasks.has(taskKey)) ||
              (jobCovers(hostSubmit, direction.key) && video?.status !== "error");
            const nodeBusy = video?.status === "running" || tasks.has(taskKey) || waiting;
            const overlayText = tasks.label(taskKey) ?? (waiting ? allLabel : "正在生成视频…");
            return h(
              "div",
              { key: direction.key, className: "SPR_node", "data-busy": nodeBusy ? "true" : undefined },
              h(
                "div",
                { className: "SPR_nodeTop" },
                h("span", { className: "SPR_nodeTitle" }, direction.label),
                nodeBusy ? h(Chip, { kind: "running", text: "生成中" }) : h(StatusChip, { node: video })
              ),
              video?.file !== undefined
                ? h(
                    MediaBox,
                    { overlay: nodeBusy || waiting, text: overlayText },
                    h("video", {
                      className: "SPR_video",
                      src: assetUrl(project, video.file, video.updatedAt ?? project.updatedAt),
                      controls: true,
                      preload: "metadata"
                    })
                  )
                : image?.file !== undefined
                  ? h(
                      MediaBox,
                      { overlay: nodeBusy || waiting, text: overlayText },
                      h("img", { className: "SPR_thumb", src: assetUrl(project, image.file, image.updatedAt), alt: direction.label })
                    )
                  : h("div", { className: "SPR_thumbEmpty" }, "还没有绿幕图"),
              nodeBusy || waiting ? h(BusyBadge, { show: true, text: overlayText }) : null,
              video?.remoteStatus !== undefined ? h("span", { className: "SPR_refRow" }, `远端状态：${video.remoteStatus}`) : null,
              video?.error !== undefined ? h("p", { className: "SPR_error" }, video.error) : null,
              h(
                "div",
                { className: "SPR_btnRow" },
                h(
                  BusyBtn,
                  {
                    primary: video?.file === undefined && image?.file !== undefined,
                    busy: tasks.has(taskKey),
                    busyText: "正在提交…",
                    disabled: image?.file === undefined,
                    onClick: () =>
                      void start(
                        () =>
                          api.runVideos({
                            projectId: project.id,
                            keys: [direction.key],
                            // 已经有成片时，这一次点击是「重新生成」：必须显式告诉宿主
                            // 作废旧视频与它抽出来的帧再提交。不带这个标记时宿主会把
                            // ready 的方向当成「已完成」跳过，界面只看到转一圈就结束，
                            // 真正的失败原因只留在日志里。
                            regenerate: video?.file !== undefined
                          }),
                        { reload: true },
                        {
                          key: taskKey,
                          label: `正在生成「${direction.label}」视频…`
                        }
                      )
                  },
                  video?.file === undefined ? "生成视频" : "重新生成"
                ),
                h(
                  Btn,
                  {
                    on: video?.approved === true,
                    disabled: video?.status !== "ready",
                    onClick: () =>
                      void start(() =>
                        api.setApproved({
                          projectId: project.id,
                          stage: "videos",
                          key: direction.key,
                          approved: video?.approved !== true
                        }), { reload: true })
                  },
                  video?.approved === true ? "已通过" : "通过"
                )
              )
            );
          })
        )
      );
    }

    // ── 阶段 3：抽帧 ─────────────────────────────────────────────────────
    const KEY_FRAMES_ONE = (key) => `frames:${key}`;
    const KEY_FRAMES_ALL = "frames:*all";

    function renderFrameStage(ctx) {
      const { project, start, api, settingsDraft, saveSettings, tasks } = ctx;
      const readyVideos = DIRECTION_KEYS.filter((key) => project.videos?.[key]?.file !== undefined);
      const allApproved = DIRECTION_KEYS.every((key) => project.frames?.[key]?.approved);
      const draft = settingsDraft ?? project.settings ?? {};
      // 宿主侧那次抽帧任务盖住了哪些方向。批量抽帧是「一次两个方向」慢慢做的，
      // 本地 pending 表只多留 700ms，盖不住还没轮到的那六个方向——只看它就会
      // 出现「先转圈、紧接着变回尚未抽帧、过一阵才出结果」。
      const hostExtract = hostJob(project, "frames:extract");
      const extracting = tasks.any("frames:*") || hostExtract !== undefined;
      const batchLabel = tasks.label(KEY_FRAMES_ALL) ?? "正在抽取全部序列帧…";

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_fields" },
          h(NumField, {
            label: "单格宽（px）",
            value: draft.cellWidth ?? 256,
            min: 16,
            max: 2048,
            onChange: (value) => saveSettings({ cellWidth: value })
          }),
          h(NumField, {
            label: "单格高（px）",
            value: draft.cellHeight ?? 256,
            min: 16,
            max: 2048,
            onChange: (value) => saveSettings({ cellHeight: value })
          }),
          h(NumField, {
            label: "每段视频抽帧数",
            value: draft.frameCount ?? 8,
            min: 1,
            max: 64,
            onChange: (value) => saveSettings({ frameCount: value })
          }),
          h(NumField, {
            label: "抽帧工作尺寸（长边 px）",
            value: draft.workingLongEdge ?? 768,
            min: 128,
            max: 2048,
            onChange: (value) => saveSettings({ workingLongEdge: value })
          }),
          h(NumField, {
            label: "并发数",
            value: draft.concurrency ?? 3,
            min: 1,
            max: 8,
            onChange: (value) => saveSettings({ concurrency: value })
          })
        ),
        h("p", { className: "SPR_hint" }, "抽帧抽到的是「工作尺寸」（长边上限），不是最终格子尺寸。自动裁剪、统一缩放和像素量化都在第 4 步做，这样八个方向才能共享同一个裁剪框、脚底对齐同一条基线。改完这里需要重新抽帧。"),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(
            BusyBtn,
            {
              primary: true,
              busy: tasks.has(KEY_FRAMES_ALL),
              busyText: "正在抽取全部序列帧…",
              disabled: readyVideos.length === 0 || extracting,
              onClick: () =>
                void start(() => api.runFrames({ projectId: project.id }), { reload: true }, {
                  key: KEY_FRAMES_ALL,
                  label: "正在抽取全部序列帧…"
                })
            },
            `提取全部序列帧（${readyVideos.length}/8 段视频就绪）`
          ),
          h(
            Btn,
            {
              on: allApproved,
              disabled: extracting,
              onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "frames", approved: !allApproved }), { reload: true })
            },
            allApproved ? "取消全部通过" : "全部标记通过"
          ),
          h(BusyBadge, { show: extracting, text: tasks.label(KEY_FRAMES_ALL) ?? "正在抽帧…" })
        ),
        h(
          "div",
          { className: "SPR_grid" },
          DIRECTIONS.map((direction) => {
            const node = project.frames?.[direction.key];
            const taskKey = KEY_FRAMES_ONE(direction.key);
            // 这一批还没轮到 / 产物还没出来的方向也要盖着。两条路：本地刚点下去
            // （批量 key 在远程调用返回后还会多留 700ms，覆盖「下一次轮询还没回来」
            // 的那一下），以及宿主任务表（整段任务都在）。已经报错的方向不盖，
            // 否则失败原因被遮罩挡住，看着像还在跑。
            const queued =
              (tasks.has(KEY_FRAMES_ALL) || jobCovers(hostExtract, direction.key)) && node?.status !== "error";
            const nodeBusy = node?.status === "running" || tasks.has(taskKey) || queued;
            const overlayText = tasks.label(taskKey) ?? (queued ? batchLabel : undefined) ?? "正在抽取序列帧…";
            return h(
              "div",
              { key: direction.key, className: "SPR_node", "data-busy": nodeBusy ? "true" : undefined },
              h(
                "div",
                { className: "SPR_nodeTop" },
                h("span", { className: "SPR_nodeTitle" }, direction.label),
                nodeBusy ? h(Chip, { kind: "running", text: "抽帧中" }) : h(StatusChip, { node })
              ),
              node?.strip !== undefined
                ? h(
                    MediaBox,
                    { overlay: nodeBusy, text: overlayText },
                    h("img", { className: "SPR_thumb", src: assetUrl(project, node.strip, node.updatedAt), alt: `${direction.label} 序列帧` })
                  )
                : h(
                    "div",
                    { className: "SPR_thumbEmpty" },
                    nodeBusy ? "正在抽帧…" : "尚未抽帧"
                  ),
              nodeBusy ? h(BusyBadge, { show: true, text: overlayText }) : null,
              node?.duration !== undefined
                ? h("span", { className: "SPR_refRow" }, `${node.frames?.length ?? 0} 帧 · 视频 ${node.duration.toFixed(2)} 秒`)
                : null,
              node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null,
              h(
                "div",
                { className: "SPR_btnRow" },
                h(
                  BusyBtn,
                  {
                    primary: node?.status !== "ready",
                    busy: tasks.has(taskKey),
                    busyText: "正在抽帧…",
                    disabled: project.videos?.[direction.key]?.file === undefined,
                    onClick: () =>
                      void start(() => api.runFrames({ projectId: project.id, keys: [direction.key] }), { reload: true }, {
                        key: taskKey,
                        label: `正在抽取「${direction.label}」序列帧…`
                      })
                  },
                  node?.status === "ready" ? "重新抽帧" : "抽取"
                ),
                h(
                  Btn,
                  {
                    on: node?.approved === true,
                    disabled: node?.status !== "ready",
                    onClick: () =>
                      void start(() =>
                        api.setApproved({
                          projectId: project.id,
                          stage: "frames",
                          key: direction.key,
                          approved: node?.approved !== true
                        }), { reload: true })
                  },
                  node?.approved === true ? "已通过" : "通过"
                )
              )
            );
          })
        )
      );
    }

    // ── 阶段 4：合成整图 ─────────────────────────────────────────────────
    const KEY_SHEET_COMPOSE = "sheet:compose";
    const KEY_SHEET_REKEY = "sheet:rekey";
    const KEY_SHEET_SAVE = "sheet:save";

    function renderSheetStage(ctx) {
      const { project, settingsDraft, setSettingsDraft, saveSettings, start, api, tasks } = ctx;
      const draft = settingsDraft ?? project.settings ?? {};
      const rowOrder = Array.isArray(draft.rowOrder) && draft.rowOrder.length > 0 ? draft.rowOrder : DIRECTION_KEYS;
      const framesReady = DIRECTION_KEYS.filter((key) => project.frames?.[key]?.status === "ready").length;
      // 合成整图是本地 CPU 重活，宿主侧会标 running；重抠像同样走这个状态。
      const composing = project.sheet?.status === "running" || tasks.has(KEY_SHEET_COMPOSE) || tasks.has(KEY_SHEET_REKEY);
      const composeLabel = tasks.label(KEY_SHEET_REKEY) ?? tasks.label(KEY_SHEET_COMPOSE) ?? "正在抠绿幕并合成整图…";

      const moveRow = (index, delta) => {
        const next = [...rowOrder];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        const tmp = next[index];
        next[index] = next[target];
        next[target] = tmp;
        setSettingsDraft({ ...draft, rowOrder: next });
        void saveSettings({ rowOrder: next });
      };

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_fields" },
          h(NumField, {
            label: "整图单格宽（px）",
            value: draft.cellWidth ?? 256,
            min: 16,
            max: 2048,
            onChange: (value) => {
              setSettingsDraft({ ...draft, cellWidth: value });
              void saveSettings({ cellWidth: value });
            }
          }),
          h(NumField, {
            label: "整图单格高（px）",
            value: draft.cellHeight ?? 256,
            min: 16,
            max: 2048,
            onChange: (value) => {
              setSettingsDraft({ ...draft, cellHeight: value });
              void saveSettings({ cellHeight: value });
            }
          }),
          h(NumField, {
            label: "像素块边长（0/1 = 关闭）",
            value: draft.pixelSize ?? 0,
            min: 0,
            max: 32,
            onChange: (value) => setSettingsDraft({ ...draft, pixelSize: value })
          }),
          h(NumField, {
            label: "背景分割容差（0 = 只认绿色）",
            value: draft.bgTolerance ?? 90,
            min: 0,
            max: 120,
            onChange: (value) => setSettingsDraft({ ...draft, bgTolerance: value })
          }),
          h(NumField, {
            label: "抠像下限（绿色优势）",
            value: draft.keyLow ?? 14,
            min: 0,
            max: 255,
            onChange: (value) => setSettingsDraft({ ...draft, keyLow: value })
          }),
          h(NumField, {
            label: "抠像上限（绿色优势）",
            value: draft.keyHigh ?? 80,
            min: 1,
            max: 255,
            onChange: (value) => setSettingsDraft({ ...draft, keyHigh: value })
          }),
          h(NumField, {
            label: "去绿溢出 0~1",
            value: draft.despill ?? 0.65,
            min: 0,
            max: 1,
            step: 0.05,
            onChange: (value) => setSettingsDraft({ ...draft, despill: value })
          }),
          h(NumField, {
            label: "边缘收缩（px）",
            value: draft.edgeShrink ?? 0,
            min: 0,
            max: 8,
            onChange: (value) => setSettingsDraft({ ...draft, edgeShrink: value })
          }),
          h(NumField, {
            label: "自动裁剪填充比例 0.5~1",
            value: draft.fillRatio ?? 0.94,
            min: 0.5,
            max: 1,
            step: 0.02,
            onChange: (value) => setSettingsDraft({ ...draft, fillRatio: value })
          }),
          h(NumField, {
            label: "底部留白（px）",
            value: draft.bottomMargin ?? 2,
            min: 0,
            max: 64,
            onChange: (value) => setSettingsDraft({ ...draft, bottomMargin: value })
          }),
          h(
            "label",
            { className: "SPR_field" },
            h("span", { className: "SPR_fieldLabel" }, "自动裁剪到角色包围盒"),
            h(
              "select",
              {
                className: "SPR_input",
                value: draft.autoCrop === false ? "off" : "on",
                onChange: (event) => {
                  const autoCrop = event.target.value === "on";
                  setSettingsDraft({ ...draft, autoCrop });
                  void saveSettings({ autoCrop });
                }
              },
              h("option", { value: "on" }, "开启（推荐：角色填满格子，八个方向缩放一致）"),
              h("option", { value: "off" }, "关闭（用整帧画面）")
            )
          )
        ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(
            BusyBtn,
            {
              busy: tasks.has(KEY_SHEET_SAVE),
              busyText: "正在保存并合成…",
              disabled: framesReady === 0 || composing,
              onClick: () =>
                void start(
                  () => saveSettings({
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
                  }),
                  { reload: true },
                  { key: KEY_SHEET_SAVE, label: "正在保存并重新合成…" }
                )
            },
            "保存并重新合成"
          ),
          h(
            BusyBtn,
            {
              busy: tasks.has(KEY_SHEET_REKEY),
              busyText: "正在重跑抠像…",
              disabled: framesReady === 0 || composing,
              onClick: () =>
                void start(() => api.rekey({ projectId: project.id }), { reload: true }, {
                  key: KEY_SHEET_REKEY,
                  label: "正在重跑抠像并重新合成…"
                })
            },
            "只重跑抠像并重新合成"
          ),
          h(
            BusyBtn,
            {
              primary: true,
              busy: tasks.has(KEY_SHEET_COMPOSE),
              busyText: "正在合成整图…",
              disabled: framesReady === 0 || composing,
              onClick: () =>
                void start(() => api.compose({ projectId: project.id }), { reload: true }, {
                  key: KEY_SHEET_COMPOSE,
                  label: "正在抠绿幕并合成整图…"
                })
            },
            `合成整图（${framesReady}/8 组帧就绪）`
          ),
          h(BusyBadge, { show: composing, text: composeLabel }),
          project.sheet?.file !== undefined
            ? h(
                "a",
                {
                  className: "SPR_btn",
                  href: assetUrl(project, project.sheet.file, project.sheet.generatedAt),
                  download: `${project.name}-8dir.png`,
                  style: { textDecoration: "none" },
                  "aria-disabled": composing ? "true" : undefined,
                  onClick: composing ? (event) => event.preventDefault() : undefined
                },
                "下载整图"
              )
            : null,
          h(
            Btn,
            {
              on: project.sheet?.approved === true,
              disabled: project.sheet?.status !== "ready" || composing,
              onClick: () =>
                void start(() =>
                  api.setApproved({ projectId: project.id, stage: "sheet", approved: project.sheet?.approved !== true }), { reload: true })
            },
            project.sheet?.approved === true ? "整图已通过" : "整图通过"
          )
        ),
        project.sheet?.error !== undefined ? h("p", { className: "SPR_error" }, project.sheet.error) : null,
        h(
          "div",
          { style: { display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" } },
          h(
            "div",
            { className: "SPR_rowOrder" },
            h("span", { className: "SPR_fieldLabel" }, "行序（第 1 行在最上方）"),
            rowOrder.map((key, index) =>
              h(
                "div",
                { key: `${key}-${index}`, className: "SPR_rowOrderItem" },
                h("span", { className: "SPR_rowOrderIdx" }, String(index + 1)),
                h("span", { className: "SPR_rowOrderName" }, LABEL_OF[key] ?? key),
                h("button", { type: "button", className: "SPR_miniBtn", disabled: index === 0 || composing, onClick: () => moveRow(index, -1) }, "↑"),
                h("button", { type: "button", className: "SPR_miniBtn", disabled: index === rowOrder.length - 1 || composing, onClick: () => moveRow(index, 1) }, "↓")
              )
            )
          ),
          h(
            "div",
            { style: { flex: 1, minWidth: 300 } },
            project.sheet?.file !== undefined
              ? h(
                  React.Fragment,
                  null,
                  h(
                    "p",
                    { className: "SPR_hint" },
                    `输出 ${project.sheet.width}×${project.sheet.height} 像素 · 单格 ${draft.cellWidth}×${draft.cellHeight} · 每行 ${draft.frameCount ?? 8} 帧`
                  ),
                  h(
                    "div",
                    { className: "SPR_sheetWrap", style: { position: "relative" } },
                    h("img", {
                      className: "SPR_sheet",
                      src: assetUrl(project, project.sheet.file, project.sheet.generatedAt),
                      alt: "整图",
                      style: { visibility: composing ? "hidden" : undefined }
                    }),
                    h(LoadingOverlay, { show: composing, text: composeLabel, sub: "本地抠像 + 合成，不上传" })
                  )
                )
              : h(
                  "div",
                  { style: { position: "relative", minHeight: 160 } },
                  h("p", { className: "SPR_empty" }, composing ? "正在生成第一张整图…" : framesReady === 0 ? "请先完成第 3 步的抽帧" : "还没有合成整图"),
                  h(LoadingOverlay, { show: composing, text: composeLabel })
                )
          )
        )
      );
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
      const rebuilding =
        sheet?.status === "running" ||
        tasks?.has(KEY_SHEET_COMPOSE) === true ||
        tasks?.has(KEY_SHEET_REKEY) === true ||
        tasks?.has(KEY_SHEET_SAVE) === true;
      const rebuildingText = tasks?.label(KEY_SHEET_REKEY) ?? tasks?.label(KEY_SHEET_COMPOSE) ?? "正在重新合成整图…";
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
          if (cancelled) return;
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
        if (canvas === null) return undefined;
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
            if (next !== null) pos.dirKey = next;
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
          } else {
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
            g.drawImage(
              image,
              pos.frame * cellWidth,
              row * cellHeight,
              cellWidth,
              cellHeight,
              Math.round(pos.x - spriteW / 2),
              Math.round(pos.y - spriteH),
              spriteW,
              spriteH
            );
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
        if (axis === undefined) return;
        event.preventDefault();
        keysRef.current[axis] = down;
      };

      const reset = () => {
        posRef.current = { x: STAGE_W / 2, y: STAGE_H - 8, dirKey: "front", frame: 0, acc: 0 };
        keysRef.current = { up: false, down: false, left: false, right: false };
      };

      if (!ready) {
        return h(
          "p",
          { className: "SPR_empty" },
          "还没有可播放的整图。先完成第 ④ 步合成，再回到这里用 WASD 走一走。"
        );
      }

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_fields" },
          h(NumField, {
            label: "角色缩放倍率",
            value: scale,
            min: 0.3,
            max: 4,
            step: 0.1,
            onChange: setScale
          }),
          h(NumField, {
            label: "移动速度（像素/秒）",
            value: speed,
            min: 40,
            max: 600,
            step: 10,
            onChange: setSpeed
          }),
          h(NumField, {
            label: "播放速度（倍，只影响步频）",
            value: animSpeed,
            min: 0.25,
            max: 4,
            step: 0.25,
            onChange: setAnimSpeed
          }),
          h(
            "label",
            { className: "SPR_field" },
            h("span", { className: "SPR_fieldLabel" }, "背景参考网格"),
            h(
              "select",
              { className: "SPR_input", value: grid ? "on" : "off", onChange: (event) => setGrid(event.target.value === "on") },
              h("option", { value: "on" }, "显示（更容易看出在移动）"),
              h("option", { value: "off" }, "关闭（纯白）")
            )
          )
        ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(Btn, { onClick: reset }, "回到中间"),
          h(
            "span",
            { className: "SPR_refRow" },
            `当前朝向：${hud.compass}（${LABEL_OF[posRef.current.dirKey] ?? ""}） · ${hud.moving ? "行走中" : "站立"}`
          ),
          orderStale
            ? h("span", { className: "SPR_refRow" }, "· 整图是按旧行序生成的，正在重新合成…")
            : null,
          h("span", { className: "SPR_spacer" }),
          h("span", { className: "SPR_refRow" }, focused ? "已获得键盘焦点" : "点击画面后即可操控")
        ),
        h(
          "div",
          {
            ref: boxRef,
            className: "SPR_stage",
            "data-focused": focused ? "true" : "false",
            tabIndex: 0,
            onClick: () => {
              if (boxRef.current !== null) boxRef.current.focus();
            },
            onFocus: () => setFocused(true),
            onBlur: () => {
              setFocused(false);
              keysRef.current = { up: false, down: false, left: false, right: false };
            },
            onKeyDown: handleKey(true),
            onKeyUp: handleKey(false)
          },
          h("canvas", { ref: canvasRef, className: "SPR_canvas", width: STAGE_W, height: STAGE_H }),
          focused ? null : h("div", { className: "SPR_stageHint" }, "点击这里，然后用 WASD 或 ↑↓←→ 操控角色"),
          h(LoadingOverlay, {
            show: rebuilding || (ready && !sheetLoaded),
            text: rebuilding ? rebuildingText : "正在载入整图…"
          }),
          h(
            "div",
            { className: "SPR_hud" },
            h("span", { className: "SPR_hudDir" }, hud.compass),
            h("span", null, hud.moving ? "行走" : "站立")
          )
        ),
        h(
          "p",
          { className: "SPR_hint" },
          "方向按屏幕方位映射：按 ↑ 向北走（背对镜头）、↓ 向南走（正对镜头）、← 向西、→ 向东；斜向同时按两个键。",
          h("br"),
          "「播放速度」只改步频快慢，不影响角色移动速度；「移动速度」只改走得多快，不影响动画帧率。切图用的是整图自己记录的行序，所以改完行序即使还没重新合成，预览也不会取错方向。"
        )
      );
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
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
    }

    /** 一个「拖进来或点按钮选文件」的上传区。 */
    function UploadBox({ label, accept, multiple, onFiles, busy }) {
      const [over, setOver] = React.useState(false);
      const inputRef = React.useRef(null);
      const handle = (files) => {
        const list = Array.from(files ?? []);
        if (list.length > 0) void onFiles(list);
      };
      return h(
        React.Fragment,
        null,
        h(
          "div",
          {
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
          },
          busy === true
            ? h(
                "span",
                { style: { display: "inline-flex", alignItems: "center", gap: 7, justifyContent: "center" } },
                h("span", { className: "SPR_spinSm" }),
                "正在上传…"
              )
            : label
        ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(BusyBtn, { onClick: () => inputRef.current?.click(), busy: busy === true, busyText: "正在上传…" }, "选择文件"),
          h("input", {
            ref: inputRef,
            type: "file",
            accept,
            multiple: multiple === true,
            style: { display: "none" },
            onChange: (event) => {
              handle(event.target.files);
              event.target.value = "";
            }
          })
        )
      );
    }

    /** 抠像参数表单（三个模块共用同一套字段）。 */
    function KeyingFields({ draft, onChange }) {
      return h(
        "div",
        { className: "SPR_fields" },
        h(NumField, { label: "抠像下限（绿色优势）", value: draft.keyLow ?? 14, min: 0, max: 255, onChange: (v) => onChange({ keyLow: v }) }),
        h(NumField, { label: "抠像上限（绿色优势）", value: draft.keyHigh ?? 80, min: 1, max: 255, onChange: (v) => onChange({ keyHigh: v }) }),
        h(NumField, { label: "去绿溢出 0~1", value: draft.despill ?? 0.65, min: 0, max: 1, step: 0.05, onChange: (v) => onChange({ despill: v }) }),
        h(NumField, { label: "背景分割容差（0 = 只认绿色）", value: draft.bgTolerance ?? 90, min: 0, max: 160, onChange: (v) => onChange({ bgTolerance: v }) }),
        h(NumField, { label: "边缘收缩（px）", value: draft.edgeShrink ?? 0, min: 0, max: 8, onChange: (v) => onChange({ edgeShrink: v }) })
      );
    }

    /** 一份任务/项目列表（左侧栏）。 */
    function JobSidebar({ title, items, activeId, onSelect, onCreate, renderMeta }) {
      return h(
        "div",
        { className: "SPR_side" },
        h("div", { className: "SPR_sideTitle" }, `${title}（${items.length}）`),
        items.length === 0 ? h("p", { className: "SPR_hint" }, "还没有内容，点右上角新建一个。") : null,
        items.map((item) =>
          h(
            "button",
            {
              key: item.id,
              type: "button",
              className: "SPR_projItem",
              "data-active": item.id === activeId ? "true" : "false",
              onClick: () => onSelect(item.id)
            },
            h("span", { className: "SPR_projName" }, item.name),
            h("span", { className: "SPR_projMeta" }, renderMeta(item))
          )
        ),
        items.length === 0 ? h(Btn, { onClick: onCreate, primary: true }, "新建") : null
      );
    }

    // ── 模块②：图片生成 ─────────────────────────────────────────────────
    /** 模块②的 pending key：整批生成、单张重生成、抠像、上传、新建任务。 */
    const K_IMG_JOB = "img:job";
    const K_IMG_ITEM = (index) => `img:item:${index}`;
    const K_IMG_KEY = "img:key";
    const K_IMG_UPLOAD = "img:upload";
    const K_IMG_CREATE = "img:create";

    function ImageModule(props) {
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
        if (intent === null) return;
        if (intent.module === "image" && typeof intent.jobId === "string") setJobId(intent.jobId);
      }, [intent]);

      const busy = (job !== null && (job.items ?? []).some((item) => item.status === "running")) || tasks.active;

      const refresh = React.useCallback(async () => {
        try {
          const result = await api.listImageJobs();
          setJobs(result.jobs ?? []);
          return result.jobs ?? [];
        } catch (error) {
          setNotice({ kind: "error", text: msg(error) });
          return [];
        }
      }, [api]);

      const load = React.useCallback(async (id) => {
        if (id === null) return;
        try {
          const next = await api.getImageJob(id);
          setJob(next);
          setPromptDraft(next.prompt ?? "");
          setSuffixDraft(next.suffix ?? "");
          setSettingsDraft({ ...(next.settings ?? {}) });
          setKeyingDraft({ ...(next.keying ?? {}) });
        } catch (error) {
          setNotice({ kind: "error", text: msg(error) });
        }
      }, [api]);

      React.useEffect(() => {
        void (async () => {
          const list = await refresh();
          if (list.length > 0) setJobId((current) => current ?? list[0].id);
        })();
      }, [refresh]);

      React.useEffect(() => {
        if (jobId !== null) void load(jobId);
      }, [jobId, load]);

      React.useEffect(() => {
        if (!busy || jobId === null) return undefined;
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
            if (okText !== undefined) setNotice({ kind: "ok", text: okText });
            if (jobId !== null) await load(jobId);
            await refresh();
            return value;
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
            return undefined;
          }
        };
        if (feedback === undefined) return invoke();
        return tasks.run(feedback.key, feedback.label, invoke);
      };

      const create = () =>
        run(async () => {
          const created = await api.createImageJob({ name: `图片 ${new Date().toLocaleString("zh-CN", { hour12: false })}` });
          await refresh();
          setJobId(created.jobId);
        }, "已新建图片任务", { key: K_IMG_CREATE, label: "正在新建任务…" });

      const saveJob = (patch) => run(() => api.saveImageJob({ jobId: job.id, ...patch }), "已保存");

      const del = async () => {
        if (job === null) return;
        if (typeof window !== "undefined" && !window.confirm(`删除任务「${job.name}」？目录会被整个移除。`)) return;
        await run(async () => {
          await api.deleteImageJob({ jobId: job.id });
          const list = await refresh();
          setJobId(list.length > 0 ? list[0].id : null);
          if (list.length === 0) setJob(null);
        }, "已删除");
      };

      const upload = async (files, kind) => {
        setUploading(true);
        // 上传本身也要有反馈：走同一个 tasks 表，key 固定成上传中的那批。
        await tasks.run(K_IMG_UPLOAD, `正在上传 ${files.length} 个文件…`, async () => {
          try {
            for (const file of files) {
              const data = await readFileBase64(file);
              if (kind === "ref") await api.uploadImageRef({ jobId: job.id, name: file.name, data });
              else await api.addImageItem({ jobId: job.id, name: file.name, data });
            }
            await load(job.id);
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
          } finally {
            setUploading(false);
          }
        });
      };

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_body" },
          h(JobSidebar, {
            title: "图片任务",
            items: jobs,
            activeId: jobId,
            onSelect: setJobId,
            onCreate: create,
            renderMeta: (item) => `${item.ready} 张 · 抠像 ${item.keyed}`
          }),
          h(
            "div",
            { className: "SPR_main" },
            notice !== null
              ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text,
                  h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, "关闭")))
              : null,
            h(
              "div",
              { className: "SPR_toolbar" },
              h(BusyBtn, { onClick: create, primary: true, busy: tasks.has(K_IMG_CREATE), busyText: "正在新建…" }, "新建任务"),
              job !== null ? h(Btn, { onClick: del, danger: true }, "删除任务") : null,
              h(BusyBadge, { show: tasks.active, text: tasks.label(K_IMG_JOB) ?? tasks.label(K_IMG_KEY) ?? tasks.label(K_IMG_UPLOAD) ?? tasks.firstLabel ?? "正在调用接口…" })
            ),
            job === null
              ? h("p", { className: "SPR_empty" }, "请选择或新建一个图片任务")
              : h(
                  React.Fragment,
                  null,
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, "① 提示词")),
                    h("p", { className: "SPR_hint" }, "统一附加提示词会接在主提示词后面，用来写跨批次的共同要求。"),
                    h("textarea", {
                      className: "SPR_area",
                      placeholder: "描述你要生成的图片…",
                      value: promptDraft,
                      onChange: (event) => setPromptDraft(event.target.value),
                      onBlur: () => {
                        if (promptDraft !== (job.prompt ?? "")) void saveJob({ prompt: promptDraft });
                      }
                    }),
                    h("textarea", {
                      className: "SPR_area",
                      style: { minHeight: 60 },
                      placeholder: "统一附加提示词（可留空）",
                      value: suffixDraft,
                      onChange: (event) => setSuffixDraft(event.target.value),
                      onBlur: () => {
                        if (suffixDraft !== (job.suffix ?? "")) void saveJob({ suffix: suffixDraft });
                      }
                    }),
                    h(
                      "div",
                      { className: "SPR_fields" },
                      h(GlobalModelField, { label: "生图模型", value: globalConfig?.arkModel ?? settingsDraft.model }),
                      h(
                        "label",
                        { className: "SPR_field" },
                        h("span", { className: "SPR_fieldLabel" }, "尺寸"),
                        h("input", { className: "SPR_input", value: settingsDraft.size ?? "", onChange: (event) => setSettingsDraft({ ...settingsDraft, size: event.target.value }), onBlur: () => void saveJob({ settings: settingsDraft }) })
                      ),
                      h(NumField, { label: "生成张数（1~8）", value: settingsDraft.count ?? 1, min: 1, max: 8, onChange: (v) => { setSettingsDraft({ ...settingsDraft, count: v }); void saveJob({ settings: { ...settingsDraft, count: v } }); } })
                    ),
                    h(
                      "div",
                      { className: "SPR_toolbar" },
                      h(
                        BusyBtn,
                        {
                          primary: true,
                          busy: tasks.has(K_IMG_JOB),
                          busyText: `正在生成 ${settingsDraft.count ?? 1} 张…`,
                          disabled: promptDraft.trim() === "" || tasks.has(K_IMG_JOB),
                          onClick: () =>
                            void run(
                              () => api.runImageJob({ jobId: job.id }),
                              `已开始生成 ${settingsDraft.count ?? 1} 张`,
                              { key: K_IMG_JOB, label: `正在生成 ${settingsDraft.count ?? 1} 张图片…` }
                            )
                        },
                        `生成 ${settingsDraft.count ?? 1} 张`
                      ),
                      h("span", { className: "SPR_refRow" }, "按 Seedream 刊例约 0.2 元/张，实际以方舟账单为准")
                    )
                  ),
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, "② 参考图（可留空）")),
                    h("p", { className: "SPR_hint" }, "最多 10 张。有参考图时走图生图；引用多张时可在提示词里写「图一」「图二」。" ),
                    h(UploadBox, { label: "把参考图拖到这里", accept: "image/*", multiple: true, busy: uploading || tasks.has(K_IMG_UPLOAD), onFiles: (files) => void upload(files, "ref") }),
                    (job.refs ?? []).length === 0
                      ? null
                      : h(
                          "div",
                          { className: "SPR_grid" },
                          (job.refs ?? []).map((ref) =>
                            h(
                              "div",
                              { key: ref.file, className: "SPR_node" },
                              h("img", { className: "SPR_thumb", src: `${job.assetBase}${ref.file}?v=${job.updatedAt}`, alt: ref.name }),
                              h("span", { className: "SPR_refRow" }, ref.name),
                              h("div", { className: "SPR_btnRow" }, h(Btn, { danger: true, onClick: () => void run(() => api.removeImageRef({ jobId: job.id, file: ref.file }), "已移除参考图") }, "移除"))
                            )
                          )
                        )
                  ),
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, "③ 绿幕抠图")),
                    h("p", { className: "SPR_hint" }, "开启后每张生成完会自动抠一遍；也可以上传已有图片只做抠像。" ),
                    h(
                      "div",
                      { className: "SPR_toolbar" },
                      h(
                        "select",
                        {
                          className: "SPR_input",
                          style: { width: 220 },
                          value: keyingDraft.enabled ? "on" : "off",
                          onChange: (event) => {
                            const enabled = event.target.value === "on";
                            setKeyingDraft({ ...keyingDraft, enabled });
                            void saveJob({ keying: { enabled } });
                          }
                        },
                        h("option", { value: "off" }, "不抠像"),
                        h("option", { value: "on" }, "自动抠绿幕输出 PNG")
                      ),
                      h(
                        BusyBtn,
                        {
                          busy: tasks.has(K_IMG_KEY),
                          busyText: "正在抠像…",
                          onClick: () =>
                            void run(() => api.keyImageJob({ jobId: job.id }), "已开始抠像", {
                              key: K_IMG_KEY,
                              label: "正在抠绿幕…"
                            })
                        },
                        "按当前参数重新抠像"
                      )
                    ),
                    h(KeyingFields, { draft: keyingDraft, onChange: (patch) => { const next = { ...keyingDraft, ...patch }; setKeyingDraft(next); void saveJob({ keying: patch }); } }),
                    h(UploadBox, { label: "上传一张已有图片，直接抠成透明 PNG", accept: "image/*", multiple: false, busy: uploading || tasks.has(K_IMG_UPLOAD), onFiles: (files) => void upload(files, "item") }),
                    tasks.has(K_IMG_UPLOAD) ? h(BusyBadge, { show: true, text: tasks.label(K_IMG_UPLOAD) }) : null
                  ),
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, `④ 结果（${(job.items ?? []).length} 张）`)),
                    h(ReviewModeBar, { api, module: "image", id: job.id, mode: job.reviewMode, onChanged: () => void load(job.id) }),
                    (job.items ?? []).length === 0
                      ? h("p", { className: "SPR_empty" }, "还没有图片")
                      : h(
                          "div",
                          { className: "SPR_grid" },
                          (job.items ?? []).map((item, index) => {
                            const itemKey = K_IMG_ITEM(index);
                            const itemBusy = item.status === "running" || tasks.has(itemKey);
                            // 整批生成时，还没轮到的那些也要盖住（否则旧图看着像「没反应」）
                            const waiting = item.status !== "running" && tasks.has(K_IMG_JOB);
                            const keyingNow = item.status !== "running" && tasks.has(K_IMG_KEY);
                            const overlay = itemBusy || keyingNow || waiting;
                            const overlayText =
                              tasks.label(itemKey) ??
                              (keyingNow ? "正在抠绿幕…" : waiting ? tasks.label(K_IMG_JOB) ?? "正在生成…" : "正在生成…");
                            return h(
                              "div",
                              { key: index, className: "SPR_node", "data-busy": overlay ? "true" : undefined },
                              h(
                                "div",
                                { className: "SPR_nodeTop" },
                                h("span", { className: "SPR_nodeTitle" }, `第 ${index + 1} 张`),
                                overlay ? h(Chip, { kind: "running", text: "生成中" }) : h(StatusChip, { node: item }),
                                item.source === "uploaded" ? h(Chip, { kind: "empty", text: "上传" }) : null
                              ),
                              h(
                                MediaBox,
                                { overlay, text: overlayText },
                                item.keyedFile !== undefined
                                  ? h("img", { className: "SPR_thumb", src: `${job.assetBase}${item.keyedFile}?v=${item.updatedAt}`, alt: "抠像结果" })
                                  : item.file !== undefined
                                    ? h("img", { className: "SPR_thumb", src: `${job.assetBase}${item.file}?v=${item.updatedAt}`, alt: "生成结果" })
                                    : h("div", { className: "SPR_thumbEmpty" }, overlay ? "生成中…" : "等待生成")
                              ),
                              overlay ? h(BusyBadge, { show: true, text: overlayText }) : null,
                              item.backgroundFraction !== undefined
                                ? h("span", { className: "SPR_refRow" }, `背景占比 ${(item.backgroundFraction * 100).toFixed(0)}%`)
                                : null,
                              item.error !== undefined ? h("p", { className: "SPR_error" }, item.error) : null,
                              h(
                                "div",
                                { className: "SPR_btnRow" },
                                h(ApproveBtn, {
                                  approved: item.approved === true,
                                  disabled: overlay || item.status !== "ready",
                                  onToggle: () =>
                                    void run(
                                      () => api.saveImageJob({ jobId: job.id, index, approved: item.approved !== true }),
                                      item.approved === true ? "已取消通过" : "已标记通过"
                                    )
                                }),
                                item.keyedFile !== undefined
                                  ? h("a", { className: "SPR_btn", href: `${job.assetBase}${item.keyedFile}`, download: `keyed-${index + 1}.png`, style: { textDecoration: "none" } }, "下载 PNG")
                                  : null,
                                item.source === "generated"
                                  ? h(
                                      BusyBtn,
                                      {
                                        busy: tasks.has(itemKey),
                                        busyText: "正在提交…",
                                        onClick: () =>
                                          void run(() => api.runImageJob({ jobId: job.id, count: index + 1 }), "已重新生成", {
                                            key: itemKey,
                                            label: `正在重新生成第 ${index + 1} 张…`
                                          })
                                      },
                                      "重新生成"
                                    )
                                  : null,
                                h(Btn, { danger: true, disabled: overlay, onClick: () => void run(() => api.removeImageItem({ jobId: job.id, index }), "已删除") }, "删除")
                              )
                            );
                          })
                        )
                  ),
                  renderJobLog(job)
                )
          )
        ),
      );
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
        if (intent === null) return;
        if (intent.module === "sequence" && typeof intent.jobId === "string") setJobId(intent.jobId);
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
      const running =
        (job !== null &&
          (job.video?.status === "running" || job.frames?.status === "running" || job.sheet?.status === "running")) ||
        tasks.active;

      const refresh = React.useCallback(async () => {
        try {
          const result = await api.listSequenceJobs();
          setJobs(result.jobs ?? []);
          return result.jobs ?? [];
        } catch (error) {
          setNotice({ kind: "error", text: msg(error) });
          return [];
        }
      }, [api]);

      const load = React.useCallback(async (id) => {
        if (id === null) return;
        try {
          const next = await api.getSequenceJob(id);
          setJob(next);
          setPromptDraft(next.prompt ?? "");
          setSuffixDraft(next.suffix ?? "");
          setSettingsDraft({ ...(next.settings ?? {}) });
          setKeyingDraft({ ...(next.keying ?? {}) });
        } catch (error) {
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
          if (list.length > 0) setJobId((current) => current ?? list[0].id);
        })();
      }, [refresh]);

      React.useEffect(() => {
        if (jobId !== null) void load(jobId);
      }, [jobId, load]);

      React.useEffect(() => {
        if (!running || jobId === null) return undefined;
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
            if (okText !== undefined) setNotice({ kind: "ok", text: okText });
            if (jobId !== null) await load(jobId);
            await refresh();
            return value;
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
            return undefined;
          }
        };
        if (feedback === undefined) return invoke();
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
            if (jobIdRef.current === id) void load(id);
          }, delay);
        }
        return value;
      };

      const create = () =>
        run(async () => {
          const created = await api.createSequenceJob({ name: `序列帧 ${new Date().toLocaleString("zh-CN", { hour12: false })}` });
          await refresh();
          setJobId(created.jobId);
        }, "已新建序列帧任务", { key: K_SEQ_CREATE, label: "正在新建任务…" });

      const saveJob = (patch) => run(() => api.saveSequenceJob({ jobId: job.id, ...patch }), undefined);

      const del = async () => {
        if (job === null) return;
        if (typeof window !== "undefined" && !window.confirm(`删除任务「${job.name}」？目录会被整个移除。`)) return;
        await run(async () => {
          await api.deleteSequenceJob({ jobId: job.id });
          const list = await refresh();
          setJobId(list.length > 0 ? list[0].id : null);
          if (list.length === 0) setJob(null);
        }, "已删除");
      };

      const uploadRef = async (files, kind) => {
        setUploading(true);
        await tasks.run(K_SEQ_UPLOAD, `正在上传 ${files.length} 个文件…`, async () => {
          try {
            for (const file of files) {
              const data = await readFileBase64(file);
              await api.uploadSequenceRef({ jobId: job.id, kind, name: file.name, data });
            }
            await load(job.id);
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
          } finally {
            setUploading(false);
          }
        });
      };

      const frameUrls = React.useMemo(() => {
        if (job === null) return [];
        const list = (job.frames?.keyed ?? []).length > 0 ? job.frames.keyed : job.frames?.files ?? [];
        return list.map((file) => `${job.assetBase}${file}?v=${job.frames?.updatedAt ?? job.updatedAt}`);
      }, [job]);

      // ── 「正在调用接口」的派生状态 ──────────────────────────────────────
      // 三段各有一块要盖遮罩的预览区：视频、序列帧/条图、合成结果。
      const videoBusy = job?.video?.status === "running" || tasks.has(K_SEQ_VIDEO);
      const videoText = tasks.label(K_SEQ_VIDEO) ?? "视频生成中…（H3 通常 1~6 分钟，可以离开本页）";
      const framesBusy = job?.frames?.status === "running" || tasks.has(K_SEQ_FRAMES);
      const framesText = tasks.label(K_SEQ_FRAMES) ?? "正在抽帧…";
      const composing =
        job?.sheet?.status === "running" || tasks.has(K_SEQ_KEY) || tasks.has(K_SEQ_COMPOSE);
      const composeText = tasks.label(K_SEQ_KEY) ?? tasks.label(K_SEQ_COMPOSE) ?? "正在抠像并合成条图…";

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_body" },
          h(JobSidebar, {
            title: "序列帧任务",
            items: jobs,
            activeId: jobId,
            onSelect: setJobId,
            onCreate: create,
            renderMeta: (item) => `${item.videoReady ? "视频✓" : "视频·"} ${item.frameReady ? "帧✓" : "帧·"} ${item.sheetReady ? "合成✓" : "合成·"}`
          }),
          h(
            "div",
            { className: "SPR_main" },
            notice !== null
              ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text,
                  h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, "关闭")))
              : null,
            h(
              "div",
              { className: "SPR_toolbar" },
              h(BusyBtn, { onClick: create, primary: true, busy: tasks.has(K_SEQ_CREATE), busyText: "正在新建…" }, "新建任务"),
              job !== null ? h(Btn, { onClick: del, danger: true }, "删除任务") : null,
              h(BusyBadge, { show: tasks.active, text: tasks.firstLabel ?? "正在调用接口…" })
            ),
            job === null
              ? h("p", { className: "SPR_empty" }, "请选择或新建一个序列帧任务")
              : h(
                  React.Fragment,
                  null,
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, "① 视频输入")),
                    h("p", { className: "SPR_hint" }, "平台规定两种模式互斥：首尾帧模式以一张图作为起始画面；多模态参考模式用参考图+参考视频来约束风格与动作。" ),
                    h(
                      "div",
                      { className: "SPR_toolbar" },
                      h(
                        "select",
                        {
                          className: "SPR_input",
                          style: { width: 260 },
                          value: job.mode,
                          onChange: (event) => void run(() => api.saveSequenceJob({ jobId: job.id, mode: event.target.value }), undefined)
                        },
                        h("option", { value: "frames" }, "首尾帧模式（上传首帧图）"),
                        h("option", { value: "reference" }, "多模态参考模式（参考图 / 参考视频）")
                      )
                    ),
                    job.mode === "frames"
                      ? h(
                          React.Fragment,
                          null,
                          h("span", { className: "SPR_fieldLabel" }, "首帧图（必填）"),
                          h(RefRow, { job, frame: job.refs.firstFrame, kind: "firstFrame", api, reload: load, setNotice }),
                          h("span", { className: "SPR_fieldLabel" }, "尾帧图（选填）"),
                          h(RefRow, { job, frame: job.refs.lastFrame, kind: "lastFrame", api, reload: load, setNotice }),
                          h(UploadBox, { label: "把首帧图拖到这里", accept: "image/*", busy: uploading || tasks.has(K_SEQ_UPLOAD), onFiles: (files) => void uploadRef(files, "firstFrame") })
                        )
                      : h(
                          React.Fragment,
                          null,
                          h("span", { className: "SPR_fieldLabel" }, `参考图（${(job.refs.referenceImages ?? []).length}/9）`),
                          h(
                            "div",
                            { className: "SPR_grid" },
                            (job.refs.referenceImages ?? []).map((ref) =>
                              h(
                                "div",
                                { key: ref.file, className: "SPR_node" },
                                h("img", { className: "SPR_thumb", src: `${job.assetBase}${ref.file}?v=${job.updatedAt}`, alt: ref.name }),
                                h("div", { className: "SPR_btnRow" }, h(Btn, { danger: true, onClick: () => void run(() => api.removeSequenceRef({ jobId: job.id, kind: "referenceImage", file: ref.file }), "已移除") }, "移除"))
                              )
                            )
                          ),
                          h(UploadBox, { label: "把参考图拖到这里", accept: "image/*", multiple: true, busy: uploading || tasks.has(K_SEQ_UPLOAD), onFiles: (files) => void uploadRef(files, "referenceImage") }),
                          h("span", { className: "SPR_fieldLabel" }, `参考视频（${(job.refs.referenceVideos ?? []).length}/3，每段 2~15 秒，单文件 ≤ 40MB）`),
                          h(
                            "div",
                            { className: "SPR_toolbar" },
                            (job.refs.referenceVideos ?? []).map((ref) =>
                              h(Btn, { key: ref.file, danger: true, onClick: () => void run(() => api.removeSequenceRef({ jobId: job.id, kind: "referenceVideo", file: ref.file }), "已移除") }, `移除 ${ref.name}`)
                            )
                          ),
                          h(UploadBox, { label: "把参考视频拖到这里", accept: "video/*", multiple: true, busy: uploading || tasks.has(K_SEQ_UPLOAD), onFiles: (files) => void uploadRef(files, "referenceVideo") })
                        )
                  ),
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, "② 提示词与参数")),
                    h("textarea", {
                      className: "SPR_area",
                      value: promptDraft,
                      onChange: (event) => setPromptDraft(event.target.value),
                      onBlur: () => { if (promptDraft !== (job.prompt ?? "")) void saveJob({ prompt: promptDraft }); }
                    }),
                    h("textarea", {
                      className: "SPR_area",
                      style: { minHeight: 60 },
                      placeholder: "统一附加提示词（可留空）",
                      value: suffixDraft,
                      onChange: (event) => setSuffixDraft(event.target.value),
                      onBlur: () => { if (suffixDraft !== (job.suffix ?? "")) void saveJob({ suffix: suffixDraft }); }
                    }),
                    h(
                      "div",
                      { className: "SPR_fields" },
                      h(GlobalModelField, { label: "视频模型", value: effectiveModel }),
                      h(NumField, { label: `时长（秒，${modelCaps.durationMin}~${modelCaps.durationMax}）`, value: settingsDraft.duration ?? 5, min: modelCaps.durationMin, max: modelCaps.durationMax, onChange: (v) => { setSettingsDraft({ ...settingsDraft, duration: v }); void saveJob({ settings: { ...settingsDraft, duration: v } }); } }),
                      h(
                        "label",
                        { className: "SPR_field" },
                        h("span", { className: "SPR_fieldLabel" }, "分辨率"),
                        h(
                          "select",
                          { className: "SPR_input", value: effectiveResolution, onChange: (event) => { setSettingsDraft({ ...settingsDraft, resolution: event.target.value }); void saveJob({ settings: { ...settingsDraft, resolution: event.target.value } }); } },
                          modelCaps.resolutions.map((value) => h("option", { key: value, value }, value))
                        )
                      )
                    ),
                    h(
                      "div",
                      { className: "SPR_toolbar" },
                      h(
                        BusyBtn,
                        {
                          primary: true,
                          busy: tasks.has(K_SEQ_VIDEO),
                          busyText: "正在提交视频任务…",
                          disabled: promptDraft.trim() === "" || tasks.has(K_SEQ_VIDEO),
                          onClick: () =>
                            void kickAndWatch(() => api.runSequenceVideo({ jobId: job.id }), "已提交视频任务，可离开本页", {
                              key: K_SEQ_VIDEO,
                              label: "正在提交视频任务…"
                            })
                        },
                        job.video?.status === "ready" ? "重新生成视频" : "生成视频"
                      ),
                      h(
                        BusyBtn,
                        {
                          busy: tasks.has(K_SEQ_POLL),
                          busyText: "正在查询…",
                          onClick: () =>
                            void kickAndWatch(
                              () => run(() => api.pollSequenceVideo({ jobId: job.id })),
                              undefined,
                              { key: K_SEQ_POLL, label: "正在查询远端进度…" }
                            )
                        },
                        "立即刷新进度"
                      ),
                      h(Btn, { danger: true, disabled: videoBusy, onClick: () => void run(() => api.clearSequenceVideo({ jobId: job.id }), "已清空视频与帧") }, "清空视频重来"),
                      h("span", { className: "SPR_refRow" }, "H3 768P 按 0.5 元/秒刊例计费")
                    ),
                    h(
                      "div",
                      { className: "SPR_toolbar" },
                      h("span", { className: "SPR_refRow" }, `状态：${job.video?.status ?? "empty"} ${job.video?.remoteStatus ?? ""} ${job.video?.error ?? ""}`),
                      h(BusyBadge, { show: videoBusy, text: videoText })
                    ),
                    h(
                      "div",
                      { style: { position: "relative", minHeight: job.video?.file === undefined ? 90 : undefined } },
                      job.video?.file !== undefined
                        ? h(
                            MediaBox,
                            { overlay: videoBusy, text: videoText },
                            h("video", { className: "SPR_video", src: `${job.assetBase}${job.video.file}?v=${job.video.updatedAt}`, controls: true, preload: "metadata" })
                          )
                        : videoBusy
                          ? h("div", { className: "SPR_thumbEmpty", style: { minHeight: 90 } }, videoText)
                          : null,
                      job.video?.file === undefined ? h(LoadingOverlay, { show: videoBusy, text: videoText }) : null
                    )
                  ),
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, "③ 序列帧提取")),
                    h(
                      "div",
                      { className: "SPR_fields" },
                      h(NumField, { label: "提取张数", value: settingsDraft.frameCount ?? 8, min: 1, max: 64, onChange: (v) => { setSettingsDraft({ ...settingsDraft, frameCount: v }); void saveJob({ settings: { ...settingsDraft, frameCount: v } }); } }),
                      h(NumField, { label: "抽帧工作尺寸（长边 px）", value: settingsDraft.longEdge ?? 768, min: 128, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, longEdge: v }); void saveJob({ settings: { ...settingsDraft, longEdge: v } }); } }),
                      h(NumField, { label: "单格宽（px）", value: settingsDraft.cellWidth ?? 256, min: 16, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, cellWidth: v }); void saveJob({ settings: { ...settingsDraft, cellWidth: v } }); } }),
                      h(NumField, { label: "单格高（px）", value: settingsDraft.cellHeight ?? 256, min: 16, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, cellHeight: v }); void saveJob({ settings: { ...settingsDraft, cellHeight: v } }); } }),
                      h(NumField, { label: "像素块边长（0/1 = 关闭）", value: settingsDraft.pixelSize ?? 0, min: 0, max: 32, onChange: (v) => { setSettingsDraft({ ...settingsDraft, pixelSize: v }); void saveJob({ settings: { ...settingsDraft, pixelSize: v } }); } })
                    ),
                    h(
                      "div",
                      { className: "SPR_toolbar" },
                      h(
                        BusyBtn,
                        {
                          primary: true,
                          busy: tasks.has(K_SEQ_FRAMES),
                          busyText: "正在抽帧…",
                          disabled: job.video?.file === undefined || framesBusy,
                          onClick: () =>
                            void kickAndWatch(() => api.runSequenceFrames({ jobId: job.id }), "已开始抽帧", {
                              key: K_SEQ_FRAMES,
                              label: "正在抽帧…"
                            })
                        },
                        `按当前张数抽帧（${settingsDraft.frameCount ?? 8} 张）`
                      ),
                      job.frames?.stale === true ? h(Chip, { kind: "stale", text: "参数已变，需重抽" }) : null,
                      h(BusyBadge, { show: framesBusy, text: framesText }),
                      h("span", { className: "SPR_refRow" }, job.frames?.duration !== undefined ? `视频时长 ${job.frames.duration.toFixed(2)} 秒 · ${job.frames.files.length} 帧` : "")
                    )
                  ),
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, "④ 绿幕抠像与合成")),
                    h(KeyingFields, { draft: keyingDraft, onChange: (patch) => { const next = { ...keyingDraft, ...patch }; setKeyingDraft(next); void saveJob({ keying: patch }); } }),
                    h(
                      "div",
                      { className: "SPR_toolbar" },
                      h(
                        BusyBtn,
                        {
                          busy: tasks.has(K_SEQ_KEY),
                          busyText: "正在重新抠像…",
                          disabled: framesBusy,
                          onClick: () =>
                            void kickAndWatch(() => api.keySequenceFrames({ jobId: job.id }), "已开始重新抠像", {
                              key: K_SEQ_KEY,
                              label: "正在重新抠像…"
                            })
                        },
                        "重新抠像"
                      ),
                      h(
                        BusyBtn,
                        {
                          busy: tasks.has(K_SEQ_COMPOSE),
                          busyText: "正在合成条图…",
                          disabled: framesBusy,
                          onClick: () =>
                            void kickAndWatch(() => api.composeSequence({ jobId: job.id }), "已合成", {
                              key: K_SEQ_COMPOSE,
                              label: "正在合成横向条图…"
                            })
                        },
                        "合成横向条图"
                      ),
                      job.sheet?.file !== undefined
                        ? h("a", { className: "SPR_btn", href: `${job.assetBase}${job.sheet.file}?v=${job.sheet.updatedAt}`, download: `${job.name}-strip.png`, style: { textDecoration: "none" } }, "下载条图")
                        : null
                    ),
                    h(
                      "div",
                      { style: { position: "relative" } },
                      frameUrls.length === 0
                        ? h("p", { className: "SPR_empty" }, framesBusy ? "正在处理序列帧…" : "还没有序列帧")
                        : h(SequencePlayer, { urls: frameUrls }),
                      h(LoadingOverlay, { show: framesBusy, text: framesText })
                    ),
                    job.sheet?.file !== undefined
                      ? h(
                          "div",
                          { className: "SPR_sheetWrap", style: { position: "relative" } },
                          h("img", { className: "SPR_sheet", src: `${job.assetBase}${job.sheet.file}?v=${job.sheet.updatedAt}`, alt: "序列帧条图", style: { visibility: composing ? "hidden" : undefined } }),
                          h(LoadingOverlay, { show: composing, text: composeText })
                        )
                      : null,
                    frameUrls.length === 0
                      ? null
                      : h(
                          "div",
                          { className: "SPR_frames" },
                          frameUrls.map((url, index) => h("img", { key: index, className: "SPR_frame", src: url, alt: `第 ${index + 1} 帧` }))
                        )
                  ),
                  h(
                    "div",
                    { className: "SPR_card" },
                    h("div", { className: "SPR_cardHead" }, h("h3", null, "⑤ 验收")),
                    h("p", { className: "SPR_hint" }, "三步各自打「通过」。对话里的 agent 读写同一份标记：选「每一步人工审核」时，它会等你通过才继续。" ),
                    h(ReviewModeBar, { api, module: "sequence", id: job.id, mode: job.reviewMode, onChanged: () => void load(job.id) }),
                    [
                      { step: "video", title: "① 生成视频", node: job.video },
                      { step: "frames", title: "② 抽帧 + 抠像", node: job.frames },
                      { step: "sheet", title: "③ 横向条图", node: job.sheet }
                    ].map((entry) =>
                      h(
                        "div",
                        { key: entry.step, className: "SPR_toolbar", style: { margin: "4px 0" } },
                        h("span", { className: "SPR_nodeTitle", style: { minWidth: 120 } }, entry.title),
                        h(StatusChip, { node: entry.node }),
                        h(ApproveBtn, {
                          approved: entry.node?.approved === true,
                          disabled: entry.node?.status !== "ready",
                          onToggle: () =>
                            void run(
                              () => api.saveSequenceJob({ jobId: job.id, step: entry.step, approved: entry.node?.approved !== true }),
                              entry.node?.approved === true ? "已取消通过" : "已标记通过"
                            )
                        })
                      )
                    )
                  ),
                  renderJobLog(job)
                )
          )
        ),
      );
    }

    /** 单张参考图/首尾帧的展示行。 */
    function RefRow(props) {
      // ⚠️ 这里的 prop 不能叫 `ref`：React 会把名为 ref 的 prop 特殊处理（不进 props），
      // 函数组件里 `props.ref` 恒为 undefined，界面就会永远显示「未上传」——
      // 看起来像「选了图没反应」，实测踩过。
      const { job, frame, kind, api, reload, setNotice } = props;
      if (frame === undefined) return h("span", { className: "SPR_refRow" }, "未上传");
      return h(
        "div",
        { className: "SPR_toolbar" },
        h("img", { className: "SPR_thumbMd", src: `${job.assetBase}${frame.file}?v=${job.updatedAt}`, alt: frame.name }),
        h("span", { className: "SPR_refRow" }, frame.name),
        h(
          Btn,
          {
            danger: true,
            onClick: async () => {
              try {
                await api.removeSequenceRef({ jobId: job.id, kind });
                await reload(job.id);
              } catch (error) {
                setNotice({ kind: "error", text: msg(error) });
              }
            }
          },
          "移除"
        )
      );
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
            if (!cancelled) setLoaded(done);
          };
          image.onerror = () => {
            done++;
            if (!cancelled) setLoaded(done);
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
        if (canvas === null) return undefined;
        const g = canvas.getContext("2d");
        let frame = 0;
        let last = performance.now();
        const tick = (now) => {
          rafRef.current = requestAnimationFrame(tick);
          const live = liveRef.current;
          const images = imagesRef.current.filter((image) => image !== undefined && image.naturalWidth > 0);
          if (images.length === 0) return;
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

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_fields" },
          h(NumField, { label: "播放帧率（fps）", value: fps, min: 1, max: 30, onChange: setFps }),
          h(NumField, { label: "预览缩放", value: scale, min: 0.2, max: 2, step: 0.1, onChange: setScale }),
          h(
            "label",
            { className: "SPR_field" },
            h("span", { className: "SPR_fieldLabel" }, "播放"),
            h(
              "select",
              { className: "SPR_input", value: playing ? "on" : "off", onChange: (event) => setPlaying(event.target.value === "on") },
              h("option", { value: "on" }, "播放中"),
              h("option", { value: "off" }, "暂停")
            )
          )
        ),
        h("p", { className: "SPR_hint" }, `已载入 ${loaded}/${urls.length} 帧。这是抠像后的帧按顺序循环播放的效果，用来判断动作连贯性和抠像边缘是否稳定。`),
        h("div", { className: "SPR_player" }, h("canvas", { ref: canvasRef, className: "SPR_canvasPlayer" }))
      );
    }

    /** 任务日志（三个模块共用的样式）。 */
    function renderJobLog(job) {
      const entries = Array.isArray(job?.log) ? job.log.slice(-40).reverse() : [];
      if (entries.length === 0) return null;
      return h(
        "div",
        { className: "SPR_log" },
        h("span", { className: "SPR_fieldLabel" }, "运行日志"),
        h(
          "ul",
          { className: "SPR_logList" },
          entries.map((entry, index) =>
            h(
              "li",
              { key: index, "data-level": entry.level },
              h("span", { className: "SPR_logTime" }, new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })),
              h("span", null, entry.message)
            )
          )
        )
      );
    }

    function renderLog(project) {
      const entries = Array.isArray(project.log) ? project.log.slice(-40).reverse() : [];
      if (entries.length === 0) return null;
      return h(
        "div",
        { className: "SPR_log" },
        h("span", { className: "SPR_fieldLabel" }, "运行日志"),
        h(
          "ul",
          { className: "SPR_logList" },
          entries.map((entry, index) =>
            h(
              "li",
              { key: index, "data-level": entry.level },
              h("span", { className: "SPR_logTime" }, new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })),
              h("span", null, entry.message)
            )
          )
        )
      );
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
    const RIG_ROLES = [
      { key: "head", label: "头部" },
      { key: "neck", label: "脖子" },
      { key: "torso", label: "躯干" },
      { key: "hip", label: "胯部" },
      { key: "upperArm", label: "上臂" },
      { key: "lowerArm", label: "小臂" },
      { key: "hand", label: "手" },
      { key: "upperLeg", label: "大腿" },
      { key: "lowerLeg", label: "小腿" },
      { key: "foot", label: "脚" },
      { key: "hair", label: "头发" },
      { key: "cloth", label: "衣料" },
      { key: "accessory", label: "配饰" },
      { key: "weapon", label: "武器" }
    ];

    const RIG_STAGES = [
      { key: "parts", title: "① 拆件", hint: "生图模型把角色拆成独立部件（这一步花钱，只跑一次；也可以直接上传部件 PNG）" },
      { key: "layout", title: "② 装配定位", hint: "把部件摆回参考姿态；本地计算，免费，可以逐件重跑或手工拖动" },
      { key: "rig", title: "③ 骨骼与动画", hint: "自动推骨骼层级 + 待机/行走/奔跑/挥手/跳跃/攻击，直接播放验收" },
      { key: "atlas", title: "④ 图集", hint: "打包成 Spine 纹理图集（.png + .atlas），可直接导入引擎" }
    ];

    const K_RIG_JOB = "rig:job";
    const K_RIG_SHEET = "rig:sheet";
    const K_RIG_SEGMENT = "rig:segment";
    const K_RIG_LAYOUT = "rig:layout";
    const K_RIG_BONES = "rig:bones";
    const K_RIG_ATLAS = "rig:atlas";
    const K_RIG_CREATE = "rig:create";

    /** 后台任务的 pending 文案：宿主在跑什么，界面就直说什么。 */
    const RIG_BUSY_LABEL = {
      [K_RIG_JOB]: "正在刷新…",
      [K_RIG_SHEET]: "正在拆件生图…",
      [K_RIG_SEGMENT]: "正在分割部件…",
      [K_RIG_LAYOUT]: "正在装配定位…",
      [K_RIG_BONES]: "正在生成骨骼…",
      [K_RIG_ATLAS]: "正在打包图集…",
      [K_RIG_CREATE]: "正在创建任务…"
    };

    function rigStageOf(job, key) {
      return (job.stages ?? []).find((entry) => entry.stage === key) ?? { stage: key, status: "empty" };
    }

    /** 部件卡片：逐件验收 / 隐藏 / 删除 / 重新定位。 */
    function RigPartCard({ part, busy, onApprove, onHide, onRemove, onRetry, onSelect, onRename, selected }) {
      return h(
        "div",
        { className: "SPR_rigCard", "data-approved": part.approved === true ? "true" : undefined, "data-hidden": part.hidden === true ? "true" : undefined },
        h(
          "div",
          { className: "SPR_rigCardName" },
          h("span", null, part.label ?? part.name),
          h(StatusChip, { node: part })
        ),
        part.url !== null && part.url !== undefined ? h("img", { className: "SPR_rigCardImg", src: part.url, alt: part.name }) : null,
        h(
          "div",
          { className: "SPR_rigCardMeta" },
          `${part.width ?? "?"}×${part.height ?? "?"}`,
          part.placed ? " · 已定位" : part.status === "ready" ? " · 未定位" : "",
          typeof part.score === "number" ? ` · 相似度 ${part.score}` : "",
          part.manual ? " · 手工调整" : ""
        ),
        // 低置信度必须一眼可见：平涂/低细节美术上，模板匹配很难分辨形状相同的
        // 部件（左右肢、同色衣料），自动结果只是初值，要提醒用户逐个核对。
        part.status === "ready" && (part.placed !== true || (typeof part.score === "number" && part.score < 0.5))
          ? h("div", { className: "SPR_rigCardMeta", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } },
              part.placed !== true ? "自动定位没找到，请手工拖到正确位置" : "相似度偏低，建议核对或拖一下")
          : null,
        part.error ? h("div", { className: "SPR_rigCardMeta", style: { color: "var(--dsw-alias-state-error-primary)" } }, part.error) : null,
        h(
          "div",
          { className: "SPR_rigCardBtns" },
          h(Btn, { onClick: onSelect, on: selected }, "选中"),
          h(Btn, { onClick: onApprove, on: part.approved === true }, part.approved ? "已通过" : "通过"),
          h(Btn, { onClick: onRetry, disabled: busy || part.status !== "ready" }, "重新定位"),
          h(Btn, { onClick: onRename }, "改名"),
          h(Btn, { onClick: onHide }, part.hidden ? "取消隐藏" : "隐藏"),
          h(Btn, { onClick: onRemove, danger: true }, "删除")
        )
      );
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
      if (parts.length === 0) return null;
      const sem = job.semantics ?? { errors: [], warnings: [], ok: true, ready: false, confirmed: false, count: 0 };
      const names = parts.map((part) => part.name);

      const patch = (name, fields) =>
        void run(
          () => api.setRigSemantics({ jobId: job.id, parts: [{ name, ...fields }], by: "human" }),
          `已更新「${name}」的语义`,
          activeKey
        );

      const anchorField = (part, key, index) =>
        h(NumField, {
          key: `${part.name}:${key}:${index}`,
          label: `${key === "proximal" ? "近端" : "远端"}${index === 0 ? "x" : "y"}`,
          value: (part[key] ?? [0, 0])[index],
          min: 0,
          max: 1,
          step: 0.05,
          onChange: (value) => {
            const next = [ (part[key] ?? [0, 0])[0], (part[key] ?? [0, 0])[1] ];
            next[index] = value;
            patch(part.name, { [key]: next });
          }
        });

      return h(
        "div",
        { className: "SPR_rigStage", "data-testid": "rig-semantics", style: { marginTop: 12 } },
        h(
          "div",
          { className: "SPR_rigStageHead" },
          h("span", { className: "SPR_rigStageHint", style: { flex: 1 } },
            "语义（角色 / 父级 / 锚点）：决定骨骼挂在谁身上、骨骼从部件的哪一端伸到哪一端。改这里不会动②里已经摆好的位置，只会重算③骨骼。")
        ),
        sem.errors.length > 0
          ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-error-primary)" } },
              `语义有 ${sem.errors.length} 处错误：` + sem.errors.map((e) => `${e.name || "整体"} ${e.message}`).join("；"))
          : null,
        sem.warnings.length > 0
          ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } },
              `提示：` + sem.warnings.map((w) => `${w.name || "整体"} ${w.message}`).join("；"))
          : null,
        sem.errors.length === 0 && sem.warnings.length === 0
          ? h("p", { className: "SPR_hint" }, sem.ready ? "语义已就绪，无结构问题。" : "还没有可用部件。")
          : null,
        h(
          "div",
          { style: { marginTop: 8, overflowX: "auto" } },
          h(
            "table",
            { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse" } },
            h("thead", null,
              h("tr", null,
                h("th", { style: { textAlign: "left" } }, "部件"),
                h("th", { style: { textAlign: "left" } }, "角色"),
                h("th", { style: { textAlign: "left" } }, "父级"),
                h("th", { style: { textAlign: "left" } }, "近端锚点"),
                h("th", { style: { textAlign: "left" } }, "远端锚点"),
                h("th", { style: { textAlign: "left" } }, "来源")
              )
            ),
            h("tbody", null,
              parts.map((part) =>
                h(
                  "tr",
                  { key: part.name, "data-testid": `rig-sem-row-${part.name}` },
                  h("td", { style: { paddingRight: 8 } }, part.label ?? part.name),
                  h("td", { style: { paddingRight: 8 } },
                    h("select", {
                      className: "SPR_input",
                      "data-testid": `rig-sem-role-${part.name}`,
                      value: part.role ?? "accessory",
                      onChange: (event) => patch(part.name, { role: event.target.value })
                    }, RIG_ROLES.map((role) => h("option", { key: role.key, value: role.key }, role.label)))
                  ),
                  h("td", { style: { paddingRight: 8 } },
                    h("select", {
                      className: "SPR_input",
                      "data-testid": `rig-sem-parent-${part.name}`,
                      value: part.parent ?? "",
                      onChange: (event) => patch(part.name, { parent: event.target.value === "" ? null : event.target.value })
                    },
                      h("option", { value: "" }, "（挂 root）"),
                      names.filter((name) => name !== part.name).map((name) => h("option", { key: name, value: name }, name))
                    )
                  ),
                  h("td", { style: { paddingRight: 8, whiteSpace: "nowrap" } },
                    anchorField(part, "proximal", 0), anchorField(part, "proximal", 1)
                  ),
                  h("td", { style: { paddingRight: 8, whiteSpace: "nowrap" } },
                    anchorField(part, "distal", 0), anchorField(part, "distal", 1)
                  ),
                  h("td", { style: { whiteSpace: "nowrap" } },
                    part.semanticsSource === "human" ? "人工" : part.semanticsSource === "ai" ? "AI" : "默认"
                  )
                )
              )
            )
          )
        )
      );
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
        return h("p", { className: "SPR_hint", style: { marginTop: 10 } },
          "还没有骨骼。先点上面的「生成骨骼与动画」——生成之后这里可以逐根微调。");
      }
      const manualCount = Object.keys(offsets).length;

      const patch = (name, fields) =>
        void run(
          () => api.setRigBoneOffsets({ jobId: job.id, bones: [{ name, ...fields }], by: "human" }),
          `已调整「${name}」`,
          activeKey
        );

      return h(
        "div",
        { "data-testid": "rig-bone-editor", style: { marginTop: 12 } },
        h("h3", { style: { fontSize: 13, margin: "0 0 4px" } },
          `骨骼手工偏移（${manualCount > 0 ? `已调 ${manualCount} 根` : "未调整"}）`),
        h("p", { className: "SPR_hint", style: { marginTop: 0 } },
          "这里调的是「你相对绑定姿势改了多少」，不会被重新推骨骼覆盖。位移单位是参考图像素，旋转是度。全零即视为未调整。"),
        h(
          "div",
          { style: { marginTop: 8, maxHeight: 320, overflowY: "auto" } },
          h(
            "table",
            { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse" } },
            h("thead", null,
              h("tr", null,
                h("th", { style: { textAlign: "left" } }, "骨骼"),
                h("th", { style: { textAlign: "left" } }, "父级"),
                h("th", { style: { textAlign: "left" } }, "绑定姿势"),
                h("th", { style: { textAlign: "left" } }, "手工位移 x"),
                h("th", { style: { textAlign: "left" } }, "手工位移 y"),
                h("th", { style: { textAlign: "left" } }, "手工旋转"),
                h("th", null, "")
              )
            ),
            h("tbody", null,
              bones.filter((bone) => bone.name !== "root").map((bone) => {
                const offset = offsets[bone.name] ?? {};
                return h(
                  "tr",
                  { key: bone.name, "data-testid": `rig-bone-row-${bone.name}` },
                  h("td", { style: { paddingRight: 8 } }, bone.name),
                  h("td", { style: { paddingRight: 8, opacity: 0.7 } }, bone.parent ?? "root"),
                  h("td", { style: { paddingRight: 8, opacity: 0.7, whiteSpace: "nowrap" } },
                    `${Math.round(bone.x)},${Math.round(bone.y)} · ${Math.round(bone.rotation)}°`),
                  h("td", { style: { paddingRight: 8 } },
                    h(NumField, {
                      label: "",
                      value: offset.x ?? 0,
                      step: 1,
                      onChange: (value) => patch(bone.name, { x: value })
                    })
                  ),
                  h("td", { style: { paddingRight: 8 } },
                    h(NumField, {
                      label: "",
                      value: offset.y ?? 0,
                      step: 1,
                      onChange: (value) => patch(bone.name, { y: value })
                    })
                  ),
                  h("td", { style: { paddingRight: 8 } },
                    h(NumField, {
                      label: "",
                      value: offset.rotation ?? 0,
                      step: 1,
                      onChange: (value) => patch(bone.name, { rotation: value })
                    })
                  ),
                  h("td", null,
                    offsets[bone.name] === undefined
                      ? h("span", { style: { opacity: 0.4 } }, "—")
                      : h("button", {
                          type: "button",
                          className: "SPR_miniBtn",
                          "data-testid": `rig-bone-reset-${bone.name}`,
                          onClick: () => void run(
                            () => api.resetRigBoneOffsets({ jobId: job.id, names: [bone.name] }),
                            `已清除「${bone.name}」的手工偏移`,
                            activeKey
                          )
                        }, "清除")
                  )
                );
              })
            )
          )
        ),
        manualCount > 0
          ? h(
              "div",
              { className: "SPR_toolbar", style: { marginTop: 8 } },
              h(
                BusyBtn,
                {
                  busy: busy,
                  busyText: "清除中…",
                  onClick: () => void run(
                    () => api.resetRigBoneOffsets({ jobId: job.id }),
                    "已清除全部手工骨骼偏移",
                    activeKey
                  )
                },
                `清除全部手工偏移（${manualCount} 根）`
              )
            )
          : null
      );
    }

    const RIG_HANDLES = [
      ["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0],
      ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1],
      ["sw", 0, 1], ["w", 0, 0.5]
    ];
    const RIG_SNAP_PX = 6;

    function RigAssemblyEditor({ job, api, run, busy, activeKey }) {
      const canvasW = Math.max(1, job.canvas?.width ?? 1);
      const canvasH = Math.max(1, job.canvas?.height ?? 1);
      const serverItems = job.layout?.items ?? {};
      const scaleHint = job.layout?.hint ?? 0.5;

      const [draft, setDraft] = React.useState({} as any);
      const [selected, setSelected] = React.useState(null);
      const [drag, setDrag] = React.useState(null as any);
      const [zoom, setZoom] = React.useState(1);
      const [stageWidth, setStageWidth] = React.useState(0);
      const [showReference, setShowReference] = React.useState(false);
      const [showBoxes, setShowBoxes] = React.useState(true);
      const [snapEnabled, setSnapEnabled] = React.useState(true);
      const [guides, setGuides] = React.useState([] as any[]);
      const [history, setHistory] = React.useState([] as any[]);
      const [future, setFuture] = React.useState([] as any[]);
      const [lockRatio, setLockRatio] = React.useState(true);
      const wrapRef = React.useRef(null);
      const stageRef = React.useRef(null);

      // 服务器状态变了（提交完成 / 换了任务）就把本地草稿清掉，避免旧草稿盖住新结果。
      React.useEffect(() => {
        setDraft({});
        setHistory([]);
        setFuture([]);
      }, [job.id, job.updatedAt]);

      // 本地草稿里写的 `placed` 是「操作意图」，而决定图层显隐、已放置计数的是
      // `matched`（宿主也是读 `placed` 再写回 `matched` 的，见 riggen.saveRigLayoutItems）。
      // 不在合并时对齐这两个键，Delete 收回、从部件栏拖入这类**纯本地**改动就完全看不出效果：
      // commit 写了 placed，过滤条件读的却是 matched。宿主回包之前界面一动不动，
      // 而一旦通信失败（比如宿主半区还没重启）用户就会以为整个手动装配是坏的。
      const withLocalIntent = (local: any) =>
        local === undefined || local.placed === undefined ? local : { ...local, matched: local.placed !== false };

      /** 合并后的摆放表：服务器结果 + 本地未提交的改动。 */
      const items: any = React.useMemo(() => {
        const merged = {};
        for (const part of job.parts ?? []) {
          const base = serverItems[part.name];
          const local = withLocalIntent(draft[part.name]);
          if (base === undefined && local === undefined) continue;
          merged[part.name] = {
            x: 0, y: 0, width: 1, height: 1, rotation: 0, z: 0, matched: true, manual: false,
            ...(base ?? defaultItemOf(part, scaleHint)),
            ...(local ?? {})
          };
        }
        for (const [name, raw] of Object.entries(draft as Record<string, any>)) {
          if (merged[name] !== undefined) continue;
          const part = (job.parts ?? []).find((entry) => entry.name === name);
          if (part === undefined) continue;
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
          if (stageRef.current !== null) setStageWidth(stageRef.current.clientWidth);
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
      }, []);

      // 「适应」要同时按宽和高算：只按宽的话，一张 550×978 的立绘在宽屏上会被放到
      // 两倍宽、远超舞台可见高度，用户看到的是「画布一半在屏幕外」，连部件栏拖进去
      // 都找不到落点。舞台的可见高度按视口估一个 62%（与 CSS 的 max-height 对齐）。
      const stageHeight = typeof window === "undefined" ? 0 : window.innerHeight * 0.62;
      const fitScale =
        stageWidth > 0 && canvasH > 0
          ? Math.min(stageWidth / canvasW, stageHeight > 0 ? stageHeight / canvasH : Number.POSITIVE_INFINITY)
          : 0;
      const scale = fitScale * zoom;
      const selectedItem = selected === null ? undefined : items[selected];
      const selectedPart = selected === null ? undefined : (job.parts ?? []).find((part) => part.name === selected);

      /** 画布坐标（参考图像素）。 */
      const toCanvas = (clientX: number, clientY: number) => {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (rect === undefined || rect === null || scale <= 0) return { x: 0, y: 0 };
        return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
      };

      /** 提交一次改动：进历史栈 + 批量写回。 */
      const commit = (patches: any[], label: any) => {
        if (patches.length === 0) return;
        const snapshot: any = {};
        for (const patch of patches) snapshot[patch.name] = items[patch.name] ?? null;
        setHistory((stack) => [...stack.slice(-49), snapshot]);
        setFuture([]);
        const merged: any = {};
        for (const patch of patches) merged[patch.name] = { ...(draft[patch.name] ?? {}), ...patch };
        setDraft((current: any) => ({ ...current, ...merged }));
        void run(
          () => api.saveRigLayoutItems({ jobId: job.id, items: patches.map((patch) => ({ name: patch.name, ...patch })) }),
          label,
          activeKey
        );
      };

      /** 撤销 / 重做：把某一批部件的状态整体换回去。 */
      const applySnapshot = (snapshot: any) => {
        const patches: any[] = [];
        for (const [name, item] of Object.entries(snapshot as Record<string, any>)) {
          if (item === null || item === undefined) continue;
          patches.push({ name, x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation, z: item.z, placed: item.matched !== false });
        }
        if (patches.length === 0) return;
        const merged: any = {};
        for (const patch of patches) merged[patch.name] = { ...(draft[patch.name] ?? {}), ...patch };
        setDraft((current: any) => ({ ...current, ...merged }));
        void run(() => api.saveRigLayoutItems({ jobId: job.id, items: patches }), "已撤销", activeKey);
      };
      const undo = () => {
        if (history.length === 0) return;
        const last = history[history.length - 1];
        setHistory((stack) => stack.slice(0, -1));
        setFuture((stack) => [...stack, last]);
        applySnapshot(last);
      };
      const redo = () => {
        if (future.length === 0) return;
        const next = future[future.length - 1];
        setFuture((stack) => stack.slice(0, -1));
        setHistory((stack) => [...stack, next]);
        applySnapshot(next);
      };

      // ── 拖动：移动 / 缩放 ───────────────────────────────────────────
      React.useEffect(() => {
        // 只处理「移动 / 缩放」。**不能把 "place" 也吃进来**：这个 effect 注册得更早，
        // 它的 mouseup 会先跑并把 drag 置空，React 随即同步重渲染、把后面那个
        // 「从部件栏拖进画布」的 mouseup 监听器当清理函数摘掉——于是拖放永远不生效。
        if (drag === null || (drag.kind !== "move" && drag.kind !== "resize")) return undefined;
        const onMove = (event: any) => {
          const point = toCanvas(event.clientX, event.clientY);
          setDrag((current) => {
            if (current === null) return current;
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
          if (base === undefined) return;
          const patch = current.kind === "move" ? movePatch(base, current) : resizePatch(base, current);
          if (patch === null) return;
          commit([{ name: current.name, ...patch }], current.kind === "move" ? `已移动「${current.name}」` : `已缩放「${current.name}」`);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
      }, [drag, items, draft, selected, snapEnabled]);

      /** 拖动中的实时几何（未提交）。 */
      const geometryOf = (name: string): any => {
        const base = items[name];
        if (base === undefined) return undefined;
        if (drag === null || drag.name !== name) return base;
        if (drag.kind === "move") {
          let x = base.x + drag.dx;
          let y = base.y + drag.dy;
          if (drag.shift) {
            if (Math.abs(drag.dx) > Math.abs(drag.dy)) y = base.y;
            else x = base.x;
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
        if (base === undefined) return;
        const candidate = { ...base, x: base.x + drag.dx, y: base.y + drag.dy };
        const snapped = applySnap(candidate, drag.name, items);
        setGuides(snapped.guides);
      }, [drag, items, snapEnabled]);

      // ── 键盘 ────────────────────────────────────────────────────────
      React.useEffect(() => {
        const onKey = (event: any) => {
          const tag = event.target?.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
          const meta = event.metaKey || event.ctrlKey;
          if (meta && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
            return;
          }
          if (selected === null) return;
          const base = items[selected];
          if (base === undefined) return;
          const step = event.shiftKey ? 10 : 1;
          const move = (dx, dy) => {
            event.preventDefault();
            commit([{ name: selected, x: base.x + dx, y: base.y + dy }], `已微调「${selected}」`);
          };
          if (event.key === "ArrowLeft") move(-step, 0);
          else if (event.key === "ArrowRight") move(step, 0);
          else if (event.key === "ArrowUp") move(0, -step);
          else if (event.key === "ArrowDown") move(0, step);
          else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            commit([{ name: selected, placed: false }], `已收回「${selected}」`);
          } else if (event.key === "Escape") setSelected(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [selected, items, draft, history, future]);

      // ── 部件栏拖进画布 ──────────────────────────────────────────────
      const startPaletteDrag = (part: any, event: any) => {
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
        if (drag === null || drag.kind !== "place") return undefined;
        const onUp = (event: any) => {
          setDrag(null);
          const rect = wrapRef.current?.getBoundingClientRect();
          if (rect === undefined || rect === null) return;
          const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
          if (!inside) return;
          const part = (job.parts ?? []).find((entry) => entry.name === drag.name);
          if (part === undefined) return;
          const existing = items[drag.name];
          const width = existing?.width ?? Math.max(4, Math.round((part.width ?? 64) * scaleHint));
          const height = existing?.height ?? Math.max(4, Math.round((part.height ?? 64) * scaleHint));
          const point = toCanvas(event.clientX, event.clientY);
          commit(
            [{ name: drag.name, x: Math.round(point.x - width / 2), y: Math.round(point.y - height / 2), width, height, placed: true }],
            `已放置「${drag.name}」`
          );
          setSelected(drag.name);
        };
        window.addEventListener("mouseup", onUp);
        return () => window.removeEventListener("mouseup", onUp);
      }, [drag, items, scaleHint, scale, draft]);

      // ── 缩放 / 图层 ────────────────────────────────────────────────
      const resizePatch = (base: any, current: any): any => {
        const box = resizeBox(base, current);
        if (Math.round(box.x) === base.x && Math.round(box.y) === base.y && Math.round(box.width) === base.width && Math.round(box.height) === base.height) return null;
        return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
      };
      function resizeBox(base: any, current: any): any {
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
        if (hx === 0) x0 = left + current.dx;
        if (hx === 2) x1 = right + current.dx;
        if (hy === 0) y0 = top + current.dy;
        if (hy === 2) y1 = bottom + current.dy;
        if (x1 - x0 < minSize) {
          if (hx === 0) x0 = x1 - minSize;
          else x1 = x0 + minSize;
        }
        if (y1 - y0 < minSize) {
          if (hy === 0) y0 = y1 - minSize;
          else y1 = y0 + minSize;
        }
        let width = x1 - x0;
        let height = y1 - y0;
        if (lockRatio && current.kind === "resize" && handle.length === 2) {
          const ratio = base.height / Math.max(1, base.width);
          // 角手柄保持等比：以变化更大的一边为准。
          if (Math.abs(current.dx) > Math.abs(current.dy)) height = width * ratio;
          else width = height / ratio;
          if (hx === 0) x0 = x1 - width;
          else x1 = x0 + width;
          if (hy === 0) y0 = y1 - height;
          else y1 = y0 + height;
        }
        return { x: x0, y: y0, width, height };
      }
      function handlePosition(handle: string): [number, number] {
        const found: any = RIG_HANDLES.find((entry: any) => entry[0] === handle);
        const hx = found === undefined ? 1 : Math.round(found[1] * 2);
        const hy = found === undefined ? 1 : Math.round(found[2] * 2);
        return [hx, hy];
      }
      function movePatch(base: any, current: any): any {
        let x = base.x + current.dx;
        let y = base.y + current.dy;
        if (current.shift) {
          if (Math.abs(current.dx) > Math.abs(current.dy)) y = base.y;
          else x = base.x;
        }
        const snapped = snapEnabled ? applySnap({ ...base, x, y }, current.name, items) : { box: { x, y } };
        const nextX = Math.round(snapped.box.x);
        const nextY = Math.round(snapped.box.y);
        if (nextX === base.x && nextY === base.y) return null;
        return { x: nextX, y: nextY };
      }
      function applySnap(candidate: any, name: string, all: any): any {
        const threshold = RIG_SNAP_PX / Math.max(0.0001, scale);
        const targets: any[] = [];
        for (const [other, item] of Object.entries(all as Record<string, any>)) {
          if (other === name || item.matched === false) continue;
          targets.push({ x: [item.x, item.x + item.width / 2, item.x + item.width], y: [item.y, item.y + item.height / 2, item.y + item.height] });
        }
        targets.push({ x: [canvasW / 2], y: [canvasH / 2] });
        const lines: any[] = [];
        let best: any = { dx: null, dy: null, distX: threshold, distY: threshold };
        const mineX = [candidate.x, candidate.x + candidate.width / 2, candidate.x + candidate.width];
        const mineY = [candidate.y, candidate.y + candidate.height / 2, candidate.y + candidate.height];
        for (const target of targets as any[]) {
          for (const tx of target.x) {
            for (const mx of mineX) {
              const dist = Math.abs(mx - tx);
              if (dist < best.distX) best = { ...best, dx: tx - mx, distX: dist };
            }
          }
          for (const ty of target.y) {
            for (const my of mineY) {
              const dist = Math.abs(my - ty);
              if (dist < best.distY) best = { ...best, dy: ty - my, distY: dist };
            }
          }
        }
        const box: any = {
          ...candidate,
          x: best.dx === null ? candidate.x : candidate.x + best.dx,
          y: best.dy === null ? candidate.y : candidate.y + best.dy
        };
        if (best.dx !== null) lines.push({ axis: "x", at: box.x + (best.distX >= 0 ? 0 : 0) });
        return { box, guides: lines };
      }

      const changeZ = (name: string, mode: string) => {
        const ordered = Object.keys(items)
          .filter((key) => items[key].matched !== false)
          .sort((a, b) => (items[a].z ?? 0) - (items[b].z ?? 0));
        const index = ordered.indexOf(name);
        if (index < 0) return;
        const reordered = [...ordered];
        reordered.splice(index, 1);
        if (mode === "front") reordered.push(name);
        else if (mode === "back") reordered.unshift(name);
        else if (mode === "up") reordered.splice(Math.min(ordered.length - 1, index + 1), 0, name);
        else reordered.splice(Math.max(0, index - 1), 0, name);
        const patches = reordered.map((key, position) => ({ name: key, z: position }));
        commit(patches, "已调整图层顺序");
      };

      const patchSelected = (patch: any, label: any) => {
        if (selected === null) return;
        commit([{ name: selected, ...patch }], label);
      };

      if (placedNames.length === 0 && notYetPlaced.length === 0) {
        return h("p", { className: "SPR_hint" }, "还没有可用部件，请先在第 ① 步拆件或上传部件 PNG。");
      }

      return h(
        "div",
        { className: "SPR_asm" },
        // ── 工具条 ────────────────────────────────────────────────
        h(
          "div",
          { className: "SPR_asmBar" },
          h("span", { className: "SPR_asmGroup" },
            h("span", { className: "SPR_fieldLabel" }, "缩放"),
            h(Btn, { onClick: () => setZoom((z) => Math.max(0.25, z - 0.25)), title: "缩小" }, "−"),
            h(Btn, { onClick: () => setZoom(1) }, `${Math.round(zoom * 100)}%`),
            h(Btn, { onClick: () => setZoom((z) => Math.min(4, z + 0.25)), title: "放大" }, "+")
          ),
          h("span", { className: "SPR_asmGroup" },
            h(Btn, { on: showReference, onClick: () => setShowReference((v) => !v), title: "把参考图叠在下面，方便对位" }, "参考图底图"),
            h(Btn, { on: showBoxes, onClick: () => setShowBoxes((v) => !v) }, "显示边框"),
            h(Btn, { on: snapEnabled, onClick: () => setSnapEnabled((v) => !v), title: "拖动时吸附到其它部件的边与中线" }, "吸附"),
            h(Btn, { on: lockRatio, onClick: () => setLockRatio((v) => !v), title: "拖角手柄时保持宽高比" }, "锁等比")
          ),
          h("span", { className: "SPR_asmGroup" },
            h(Btn, { onClick: undo, disabled: history.length === 0 }, `撤销${history.length > 0 ? `(${history.length})` : ""}`),
            h(Btn, { onClick: redo, disabled: future.length === 0 }, "重做")
          ),
          h("span", { className: "SPR_spacer" }),
          h("span", { className: "SPR_asmHint" },
            `已放置 ${placedNames.length}/${(job.parts ?? []).filter((part) => part.status === "ready").length}　·　拖部件移动、拖角缩放、方向键微调 1px（Shift 10px）、Delete 收回`)
        ),

        h(
          "div",
          { className: "SPR_asmBody" },
          // ── 画布 ──────────────────────────────────────────────
          h(
            "div",
            { className: "SPR_asmStage", ref: stageRef },
            h(
              "div",
              {
                className: "SPR_asmCanvas",
                ref: wrapRef,
                onMouseDown: (event: any) => {
                  if (event.target === event.currentTarget) setSelected(null);
                },
                style: { width: canvasW * scale, height: canvasH * scale }
              },
              showReference && job.sourceUrl !== null
                ? h("img", { className: "SPR_asmRef", src: job.sourceUrl, alt: "reference", draggable: false })
                : null,
              placedNames.map((name) => {
                const box = geometryOf(name) ?? items[name];
                const part = (job.parts ?? []).find((entry) => entry.name === name);
                if (part?.url === null || part?.url === undefined) return null;
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
              }),
              guides.map((guide, index) =>
                h("div", { key: `guide:${index}`, className: "SPR_asmGuide", style: { left: guide.at * scale } })
              ),
              showBoxes
                ? placedNames.map((name) => {
                    const box = geometryOf(name) ?? items[name];
                    const isSelected = selected === name;
                    return h(
                      "div",
                      {
                        key: `box:${name}`,
                        className: "SPR_rigBox",
                        "data-selected": isSelected ? "true" : undefined,
                        style: { left: box.x * scale, top: box.y * scale, width: Math.max(6, box.width * scale), height: Math.max(6, box.height * scale) },
                        onMouseDown: (event: any) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelected(name);
                          const point = toCanvas(event.clientX, event.clientY);
                          setDrag({ kind: "move", name, startX: point.x, startY: point.y, dx: 0, dy: 0 });
                        }
                      },
                      isSelected
                        ? RIG_HANDLES.map(([handle, fx, fy]: any) =>
                            h("span", {
                              key: handle,
                              className: "SPR_asmHandle",
                              "data-handle": handle,
                              style: { left: `${fx * 100}%`, top: `${fy * 100}%` },
                              onMouseDown: (event: any) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const point = toCanvas(event.clientX, event.clientY);
                                setDrag({ kind: "resize", name, handle, startX: point.x, startY: point.y, dx: 0, dy: 0 });
                              }
                            })
                          )
                        : null,
                      h("span", { className: "SPR_rigBoxLabel" }, (job.parts ?? []).find((p) => p.name === name)?.label ?? name)
                    );
                  })
                : null
            )
          ),

          // ── 右侧：部件栏 + 参数 ─────────────────────────────────
          h(
            "div",
            { className: "SPR_asmSide" },
            h("div", { className: "SPR_sideTitle" }, `未放置（${unplaced.length + notYetPlaced.length}）· 拖进画布`),
            h(
              "div",
              { className: "SPR_asmPalette" },
              [...unplaced, ...notYetPlaced].map((part) =>
                h(
                  "div",
                  {
                    key: `palette:${part.name}`,
                    className: "SPR_asmChip",
                    onMouseDown: (event: any) => startPaletteDrag(part, event)
                  },
                  part.url !== null && part.url !== undefined ? h("img", { src: part.url, alt: part.name, draggable: false }) : null,
                  h("span", null, part.label ?? part.name)
                )
              ),
              unplaced.length + notYetPlaced.length === 0 ? h("p", { className: "SPR_hint" }, "全部部件都已放置。") : null
            ),

            selectedItem !== undefined && selected !== null
              ? h(
                  "div",
                  { className: "SPR_asmPanel" },
                  h("div", { className: "SPR_sideTitle" }, `选中：${selectedPart?.label ?? selected}`),
                  h(
                    "div",
                    { className: "SPR_asmFields" },
                    h(NumField, { label: "x", value: selectedItem.x, onChange: (value) => patchSelected({ x: value }, "已修改 x") }),
                    h(NumField, { label: "y", value: selectedItem.y, onChange: (value) => patchSelected({ y: value }, "已修改 y") }),
                    h(NumField, { label: "宽", value: selectedItem.width, min: 1, onChange: (value) => patchSelected(lockRatio ? { width: value, height: Math.round((value * selectedItem.height) / Math.max(1, selectedItem.width)) } : { width: value }, "已修改宽度") }),
                    h(NumField, { label: "高", value: selectedItem.height, min: 1, onChange: (value) => patchSelected(lockRatio ? { height: value, width: Math.round((value * selectedItem.width) / Math.max(1, selectedItem.height)) } : { height: value }, "已修改高度") }),
                    h(NumField, { label: "旋转", value: selectedItem.rotation, step: 5, onChange: (value) => patchSelected({ rotation: value }, "已旋转") }),
                    h(NumField, { label: "层级", value: selectedItem.z, onChange: (value) => patchSelected({ z: value }, "已修改层级") })
                  ),
                  h(
                    "div",
                    { className: "SPR_asmRow" },
                    h(Btn, { onClick: () => changeZ(selected, "front") }, "置顶"),
                    h(Btn, { onClick: () => changeZ(selected, "up") }, "上移"),
                    h(Btn, { onClick: () => changeZ(selected, "down") }, "下移"),
                    h(Btn, { onClick: () => changeZ(selected, "back") }, "置底")
                  ),
                  h(
                    "div",
                    { className: "SPR_asmRow" },
                    h(Btn, { onClick: () => patchSelected({ width: selectedItem.height, height: selectedItem.width }, "已交换宽高") }, "宽高互换"),
                    h(
                      BusyBtn,
                      {
                        busy: busy,
                        busyText: "重定位中…",
                        onClick: () => void run(() => api.runRigLayout({ jobId: job.id, names: [selected] }), `已重新自动定位「${selected}」`, activeKey)
                      },
                      "这块重新自动定位"
                    ),
                    h(Btn, { onClick: () => commit([{ name: selected, placed: false }], `已收回「${selected}」`), danger: true }, "收回部件")
                  ),
                  selectedItem.matched === false
                    ? h("p", { className: "SPR_hint" }, "这块目前是「未放置」状态：拖到画布上或点上面的数值确认即可放回。")
                    : null
                )
              : h("div", { className: "SPR_asmPanel" }, h("p", { className: "SPR_hint" }, "在画布上点一个部件，这里会出现它的精确参数与图层操作。")),

            h(
              "div",
              { className: "SPR_asmPanel" },
              h("div", { className: "SPR_sideTitle" }, "图层（从下到上）"),
              h(
                "ol",
                { className: "SPR_asmLayers" },
                placedNames.slice().reverse().map((name) =>
                  h(
                    "li",
                    {
                      key: `layer-row:${name}`,
                      "data-active": selected === name ? "true" : "false",
                      onClick: () => setSelected(name)
                    },
                    h("span", null, (job.parts ?? []).find((p) => p.name === name)?.label ?? name),
                    h(
                      "span",
                      { className: "SPR_asmLayerBtns" },
                      h("button", { type: "button", className: "SPR_miniBtn", onClick: (event) => { event.stopPropagation(); changeZ(name, "up"); } }, "↑"),
                      h("button", { type: "button", className: "SPR_miniBtn", onClick: (event) => { event.stopPropagation(); changeZ(name, "down"); } }, "↓")
                    )
                  )
                )
              )
            )
          )
        )
      );
    }

    /** 部件还没有任何摆放记录时，按它的原始像素尺寸 × 全局缩放先验给一个默认框。 */
    function defaultItemOf(part: any, hint: number): any {
      const width = Math.max(4, Math.round((part.width ?? 64) * hint));
      const height = Math.max(4, Math.round((part.height ?? 64) * hint));
      return { x: 0, y: 0, width, height, rotation: 0, z: 0, matched: true, manual: false };
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
      const [anim, setAnim] = React.useState("idle");
      const [promptDraft, setPromptDraft] = React.useState("");
      const [suffixDraft, setSuffixDraft] = React.useState("");
      const [settingsDraft, setSettingsDraft] = React.useState({});
      const globalConfig = useGlobalConfig(api);
      const tasks = usePendingTasks();
      const intent = useStudioIntent();

      React.useEffect(() => {
        if (intent === null) return;
        if (intent.module === "rig" && typeof intent.jobId === "string") setJobId(intent.jobId);
        if (typeof intent.stage === "string" && RIG_STAGES.some((entry) => entry.key === intent.stage)) setStage(intent.stage);
      }, [intent]);

      const stageEntry = job === null ? null : rigStageOf(job, stage);
      const stageBusy = stageEntry !== null && stageEntry.status === "running";
      const busy = (job !== null && (job.stages ?? []).some((entry) => entry.status === "running")) || tasks.active;
      const keyBusy = (key) => tasks.has(key);
      const PART_K = (name, action) => `rig:${action}:${name}`;

      const refresh = React.useCallback(async () => {
        if (api === undefined) return [];
        try {
          const result = await api.listRigJobs();
          const list = result.jobs ?? [];
          setJobs(list);
          return list;
        } catch (error) {
          setNotice({ kind: "error", text: msg(error) });
          return [];
        }
      }, [api]);

      const load = React.useCallback(
        async (id) => {
          if (api === undefined || id === null) return;
          try {
            const next = await api.getRigJob({ jobId: id });
            // 宿主半区是进程启动时冻结的模块图：如果它还是旧版本，返回的是原始任务
            // 而不是统一视图，界面会以各种「读不到字段」的形式坏掉。与其让用户对着
            // 一个灰按钮猜，不如直说。
            if (next !== null && next !== undefined && next.sourceUrl === undefined && (next.stages ?? []).every((entry) => entry.stage === undefined)) {
              setNotice({ kind: "error", text: "宿主半区版本过旧（缺少骨骼动画模块的字段）。请重启 DSH Desktop 后重试。" });
              setJob(null);
              return;
            }
            setJob(next);
            setPromptDraft(next.prompts?.sheet ?? "");
            setSuffixDraft(next.prompts?.suffix ?? "");
            setSettingsDraft({ ...(next.settings ?? {}) });
            setSelected((current) => (current !== null && (next.parts ?? []).some((part) => part.name === current) ? current : null));
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
          }
        },
        [api]
      );

      React.useEffect(() => {
        void (async () => {
          const list = await refresh();
          setLoading(false);
          if (list.length > 0) setJobId((current) => current ?? list[0].id);
        })();
      }, [refresh]);

      React.useEffect(() => {
        if (jobId !== null) void load(jobId);
      }, [jobId, load]);

      React.useEffect(() => {
        if (!busy || jobId === null) return undefined;
        const timer = setInterval(() => void load(jobId), 2500);
        return () => clearInterval(timer);
      }, [busy, jobId, load]);

      const run = async (fn, okText = undefined, feedback = undefined) => {
        const invoke = async () => {
          try {
            const value = await fn();
            if (okText !== undefined) setNotice({ kind: "ok", text: okText });
            if (jobId !== null) await load(jobId);
            await refresh();
            return value;
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
            return undefined;
          }
        };
        if (feedback === undefined) return invoke();
        const label = RIG_BUSY_LABEL[feedback] ?? (feedback.startsWith("rig:relayout") ? "正在重新定位…" : "正在处理…");
        return tasks.run(feedback, label, invoke);
      };

      const createJob = () =>
        run(
          async () => {
            const created = await api.createRigJob({ name: "新骨骼动画任务" });
            await refresh();
            setJobId(created.jobId);
            setStage("parts");
            return created;
          },
          "已新建骨骼动画任务",
          K_RIG_CREATE
        );

      const deleteJob = async () => {
        if (job === null) return;
        if (typeof window !== "undefined" && !window.confirm(`删除任务「${job.name}」？产物文件会一并删除。`)) return;
        await run(async () => {
          await api.deleteRigJob({ jobId: job.id });
          const list = await refresh();
          setJobId(list.length > 0 ? list[0].id : null);
          if (list.length === 0) setJob(null);
        });
      };

      const renameJob = async () => {
        if (job === null) return;
        const next = typeof window === "undefined" ? null : window.prompt("新的任务名", job.name);
        if (next === null || next.trim() === "") return;
        await run(() => api.saveRigJob({ jobId: job.id, name: next.trim() }), "已重命名");
      };

      const uploadSource = async (files) => {
        const file = files[0];
        if (file === undefined || job === null) return;
        setUploading(true);
        try {
          const data = await readFileBase64(file);
          await api.uploadRigSource({ jobId: job.id, name: file.name, data });
          setNotice({ kind: "ok", text: `已上传参考图：${file.name}` });
          await load(job.id);
          await refresh();
        } catch (error) {
          setNotice({ kind: "error", text: msg(error) });
        } finally {
          setUploading(false);
        }
      };

      const uploadParts = async (files) => {
        if (job === null) return;
        setUploading(true);
        try {
          for (const file of files) {
            const data = await readFileBase64(file);
            await api.uploadRigPart({ jobId: job.id, name: file.name, data });
          }
          setNotice({ kind: "ok", text: `已上传 ${files.length} 个部件（文件名即部件名）` });
          await load(job.id);
          await refresh();
        } catch (error) {
          setNotice({ kind: "error", text: msg(error) });
        } finally {
          setUploading(false);
        }
      };

      const saveSettings = () =>
        run(
          () => api.saveRigJob({ jobId: job.id, sheetPrompt: promptDraft, suffix: suffixDraft, settings: settingsDraft }),
          "已保存提示词与参数"
        );

      const selectedItem = job !== null && selected !== null ? (job.layout?.items ?? {})[selected] : undefined;

      if (api === undefined) {
        return h("div", { className: "SPR_rigPanel" }, h("p", { className: "SPR_hint" }, "远程服务尚未挂载完成，请稍候…"));
      }

      const headerButtons = h(
        React.Fragment,
        null,
        h(Btn, { onClick: () => void refresh(), disabled: loading || keyBusy(K_RIG_JOB) }, "刷新列表"),
        job !== null ? h(Btn, { onClick: () => void renameJob() }, "重命名") : null,
        job !== null ? h(Btn, { onClick: () => void deleteJob(), danger: true }, "删除任务") : null,
        h(BusyBtn, { onClick: () => void createJob(), busy: keyBusy(K_RIG_CREATE), busyText: "创建中…", primary: true }, "新建任务")
      );

      return h(
        "div",
        { className: "SPR_rigPanel" },
        h(
          "div",
          { className: "SPR_toolbar" },
          h("span", { className: "SPR_refRow" }, "生图模型"),
          h("span", { className: "SPR_badge" }, globalConfig?.arkModel ?? job?.settings?.model ?? "未配置"),
          h("span", { className: "SPR_refRow" }, "（模型在「设置 → 游戏素材大师」里改）"),
          h("span", { className: "SPR_spacer" }),
          headerButtons
        ),
        notice !== null
          ? h(
              "div",
              { className: "SPR_notice", "data-kind": notice.kind === "error" ? "error" : "info" },
              notice.text,
              h(Btn, { onClick: () => setNotice(null) }, "关闭")
            )
          : null,
        h(
          "div",
          { className: "SPR_modules" },
          RIG_STAGES.map((entry) => {
            const info = job === null ? { status: "empty" } : rigStageOf(job, entry.key);
            const done = info.status === "ready";
            return h(
              "button",
              {
                key: entry.key,
                type: "button",
                className: "SPR_module",
                "data-active": stage === entry.key ? "true" : "false",
                onClick: () => setStage(entry.key)
              },
              h("span", { className: "SPR_moduleTitle" }, `${done ? "✓ " : ""}${entry.title}`),
              h("span", { className: "SPR_moduleHint" }, info.status === "running" ? "进行中…" : entry.hint)
            );
          })
        ),
        jobs.length === 0
          ? h("p", { className: "SPR_hint" }, loading ? "正在读取任务…" : "还没有骨骼动画任务，点右上角「新建任务」开始。")
          : h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "SPR_toolbar", style: { flexWrap: "wrap" } },
                h("span", { className: "SPR_refRow" }, "任务"),
                h(
                  "select",
                  { className: "SPR_input", style: { width: 260 }, value: jobId ?? "", onChange: (event) => setJobId(event.target.value) },
                  jobs.map((entry) => h("option", { key: entry.id, value: entry.id }, `${entry.name}（部件 ${entry.partCount}）`))
                ),
                job !== null ? h("span", { className: "SPR_badge" }, job.id) : null,
                stageBusy ? h(BusyBadge, { show: true, text: "本阶段进行中…" }) : null
              ),
              job === null
                ? null
                : h(
                    React.Fragment,
                    null,
                    h(ReviewModeBar, { api, module: "rig", id: job.id, mode: job.reviewMode, onChanged: () => void load(job.id) }),

                    // ── 第 0 步：角色参考图 ────────────────────────────────
                    h(
                      "div",
                      { className: "SPR_rigStage" },
                      h(
                        "div",
                        { className: "SPR_rigStageHead" },
                        h("span", { className: "SPR_rigStageTitle" }, "角色参考图"),
                        h("span", { className: "SPR_rigStageHint" }, "拆件、装配、骨骼都以这张整图为基准；建议用能看清全身、背景干净的角色立绘。"),
                        job.sourceUrl !== null && job.sourceUrl !== undefined ? h(Chip, { kind: "ready", text: `${job.canvas?.width ?? "?"}×${job.canvas?.height ?? "?"}` }) : h(Chip, { kind: "empty", text: "未上传" })
                      ),
                      h(
                        "div",
                        { className: "SPR_toolbar", style: { marginTop: 10 } },
                        h(UploadBox, { label: "拖入角色整图（PNG / JPG）", accept: "image/*", onFiles: (files) => void uploadSource(files), busy: uploading }),
                        h(UploadBox, { label: "拖入部件 PNG（可多选，文件名即部件名）", accept: "image/*", multiple: true, onFiles: (files) => void uploadParts(files), busy: uploading })
                      ),
                      job.sourceUrl !== null && job.sourceUrl !== undefined
                        ? h("img", { className: "SPR_rigCardImg", style: { height: 200, marginTop: 10 }, src: job.sourceUrl, alt: "reference" })
                        : null
                    ),

                    // ── ① 拆件 ────────────────────────────────────────────
                    stage === "parts"
                      ? h(
                          "div",
                          { className: "SPR_rigStage" },
                          h(
                            "div",
                            { className: "SPR_rigStageHead" },
                            h("span", { className: "SPR_rigStageTitle" }, "① 拆件"),
                            h("span", { className: "SPR_rigStageHint" }, "让生图模型把角色拆成摊平的部件图，再自动分割成逐件透明 PNG。**这一步花钱**，只跑一次；参数改了可以「重新分割」，不额外计费。"),
                            h(StatusChip, { node: rigStageOf(job, "parts") })
                          ),
                          h(
                            "div",
                            { className: "SPR_rigEditorRow" },
                            h(
                              BusyBtn,
                              {
                                busy: keyBusy(K_RIG_SHEET),
                                busyText: "正在拆件生图…",
                                primary: true,
                                disabled: job.sourceUrl === null || job.sourceUrl === undefined || busy,
                                onClick: () => void run(() => api.runRigSheet({ jobId: job.id }), "已提交拆件生图", K_RIG_SHEET)
                              },
                              job.sheet?.status === "ready" ? "重新生成拆件图（会花钱）" : "生成拆件图（会花钱）"
                            ),
                            h(
                              BusyBtn,
                              {
                                busy: keyBusy(K_RIG_SEGMENT),
                                busyText: "正在分割…",
                                disabled: job.sheet?.status !== "ready" || busy,
                                onClick: () => void run(() => api.runRigSegment({ jobId: job.id }), "已提交重新分割", K_RIG_SEGMENT)
                              },
                              "用现有拆件图重新分割"
                            ),
                            h(NumField, { label: "网格列", value: settingsDraft.gridColumns ?? 4, min: 1, max: 8, onChange: (value) => setSettingsDraft({ ...settingsDraft, gridColumns: value }) }),
                            h(NumField, { label: "网格行", value: settingsDraft.gridRows ?? 4, min: 1, max: 8, onChange: (value) => setSettingsDraft({ ...settingsDraft, gridRows: value }) }),
                            h(NumField, { label: "底色容差", value: settingsDraft.backgroundTolerance ?? 30, min: 1, max: 200, onChange: (value) => setSettingsDraft({ ...settingsDraft, backgroundTolerance: value }) }),
                            h(NumField, { label: "边缘羽化", value: settingsDraft.feather ?? 26, min: 1, max: 200, onChange: (value) => setSettingsDraft({ ...settingsDraft, feather: value }) }),
                            h(NumField, { label: "最小面积", value: settingsDraft.minArea ?? 0, min: 0, max: 100000, onChange: (value) => setSettingsDraft({ ...settingsDraft, minArea: value }) }),
                            // 「边缘羽化」以前是「离底色多远才不透明」的斜率，浅色填充会
                            // 因此整片变半透明；现在它只作用于轮廓最外圈，内部一律不透明。
                            h("p", { className: "SPR_hint", style: { marginTop: 4, marginBottom: 0 } },
                              "底色容差：与底色多接近算背景。边缘羽化：只决定轮廓最外圈那几个像素的软过渡，部件内部不会变半透明。"),
                            h(Btn, { onClick: () => void saveSettings() }, "保存参数与提示词")
                          ),
                          h("textarea", {
                            className: "SPR_input",
                            style: { width: "100%", minHeight: 110, marginTop: 10, fontFamily: "inherit", fontSize: 12 },
                            value: promptDraft,
                            placeholder: "留空则使用内置的网格拆件提示词（要求模型按 4×4 网格摆放 16 个标准人形部件）",
                            onChange: (event) => setPromptDraft(event.target.value)
                          }),
                          h("textarea", {
                            className: "SPR_input",
                            style: { width: "100%", minHeight: 48, marginTop: 6, fontFamily: "inherit", fontSize: 12 },
                            value: suffixDraft,
                            placeholder: "统一附加提示词（可留空）",
                            onChange: (event) => setSuffixDraft(event.target.value)
                          }),
                          job.sheet?.url !== null && job.sheet?.url !== undefined
                            ? h(
                                "div",
                                { className: "SPR_rigCanvasWrap" },
                                h("img", { src: job.sheet.url, alt: "sheet" }),
                                h(LoadingOverlay, { show: keyBusy(K_RIG_SHEET) || keyBusy(K_RIG_SEGMENT), text: keyBusy(K_RIG_SHEET) ? "生图模型正在拆件…" : "正在分割部件…" })
                              )
                            : h("p", { className: "SPR_hint", style: { marginTop: 10 } }, job.sourceUrl === null || job.sourceUrl === undefined ? "先上传角色参考图。" : "还没有拆件图：点上面的「生成拆件图」，或者用上面的上传框直接给现成部件 PNG。"),
                          (job.parts ?? []).length > 0
                            ? h(
                                "div",
                                null,
                                h("h3", { style: { fontSize: 13, margin: "14px 0 0" } }, `部件（${job.parts.length}）——逐件验收，摆错的可单独重跑`),
                                h(
                                  "div",
                                  { className: "SPR_rigGrid" },
                                  job.parts.map((part) =>
                                    h(RigPartCard, {
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
                                        const next = typeof window === "undefined" ? null : window.prompt(
                                          `把「${part.name}」改成什么名字？\n（名字决定骨骼层级，标准名如 head / torso / hip / left-upper-arm / left-lower-leg / right-foot，见拆件提示词里的网格表）`,
                                          part.name
                                        );
                                        if (next === null || next.trim() === "" || next === part.name) return;
                                        void run(() => api.renameRigPart({ jobId: job.id, from: part.name, to: next.trim() }), `已改名为「${next.trim()}」`);
                                      },
                                      onRetry: () =>
                                        void run(
                                          () => api.runRigLayout({ jobId: job.id, names: [part.name] }),
                                          `已重新定位「${part.name}」`,
                                          PART_K(part.name, "relayout")
                                        )
                                    })
                                  )
                                )
                              )
                            : null,
                          h(RigSemanticsPanel, { job, api, run, activeKey: K_RIG_LAYOUT }),
                          h(
                            "div",
                            { className: "SPR_toolbar", style: { marginTop: 12 } },
                            h(Btn, {
                              onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "parts" }), "第①步已通过"),
                              on: rigStageOf(job, "parts").approved === true,
                              disabled: (job.parts ?? []).filter((part) => part.status === "ready").length === 0
                            }, rigStageOf(job, "parts").approved === true ? "第①步：已通过" : "第①步：通过"),
                            h(Btn, {
                              onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "parts" }))
                            }, "取消通过"),
                            h(Btn, { onClick: () => setStage("layout") }, "下一步：装配定位 →")
                          )
                        )
                      : null,

                    // ── ② 装配定位 ────────────────────────────────────────
                    stage === "layout"
                      ? h(
                          "div",
                          { className: "SPR_rigStage" },
                          h(
                            "div",
                            { className: "SPR_rigStageHead" },
                            h("span", { className: "SPR_rigStageTitle" }, "② 装配定位"),
                            h("span", { className: "SPR_rigStageHint" }, "多尺度模板匹配把每个部件摆回参考姿态。**本地计算，免费**：失败或摆错只重跑那几个部件，不用整批重来。"),
                            h(StatusChip, { node: rigStageOf(job, "layout") })
                          ),
                          h(
                            "div",
                            { className: "SPR_rigEditorRow" },
                            h(
                              BusyBtn,
                              {
                                busy: keyBusy(K_RIG_LAYOUT),
                                busyText: "正在装配定位…",
                                primary: true,
                                disabled: (job.parts ?? []).filter((part) => part.status === "ready").length === 0 || busy,
                                onClick: () => void run(() => api.runRigLayout({ jobId: job.id }), "已提交装配定位（本地计算）", K_RIG_LAYOUT)
                              },
                              "重新装配全部部件"
                            ),
                            h(
                              BusyBtn,
                              {
                                busy: keyBusy(K_RIG_LAYOUT),
                                busyText: "正在重试…",
                                disabled: (job.review?.unmatched ?? []).length === 0 || busy,
                                onClick: () => void run(() => api.runRigLayout({ jobId: job.id, names: job.review.unmatched }), "已提交重试未命中的部件", K_RIG_LAYOUT)
                              },
                              `只重试未命中的 ${(job.review?.unmatched ?? []).length} 个`
                            ),
                            h(Btn, { onClick: () => setShowReference((current) => !current), on: showReference }, showReference ? "只显示合成图" : "并排显示参考图")
                          ),
                          h(RigAssemblyEditor, { job, api, run, busy, activeKey: K_RIG_LAYOUT }),
                          (job.review?.unmatched ?? []).length > 0
                            ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } }, `这些部件没匹配上，请手工拖到正确位置：${job.review.unmatched.join("、")}`)
                            : null,
                          h(
                            "div",
                            { className: "SPR_toolbar", style: { marginTop: 12 } },
                            h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "layout" }), "第②步已通过"), on: rigStageOf(job, "layout").approved === true, disabled: job.layout?.status !== "ready" }, rigStageOf(job, "layout").approved === true ? "第②步：已通过" : "第②步：通过"),
                            h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "layout" })) }, "取消通过"),
                            h(Btn, { onClick: () => setStage("rig") }, "下一步：骨骼与动画 →")
                          )
                        )
                      : null,

                    // ── ③ 骨骼与动画 ──────────────────────────────────────
                    stage === "rig"
                      ? h(
                          "div",
                          { className: "SPR_rigStage" },
                          h(
                            "div",
                            { className: "SPR_rigStageHead" },
                            h("span", { className: "SPR_rigStageTitle" }, "③ 骨骼与动画"),
                            h("span", { className: "SPR_rigStageHint" }, "按部件语义自动推骨骼层级，并生成六个动画预设。**本地计算，免费**。下面直接播放验收。"),
                            h(StatusChip, { node: rigStageOf(job, "rig") })
                          ),
                          h(
                            "div",
                            { className: "SPR_rigEditorRow" },
                            h(
                              BusyBtn,
                              {
                                busy: keyBusy(K_RIG_BONES),
                                busyText: "正在生成骨骼…",
                                primary: true,
                                disabled: job.layout?.status !== "ready" || busy,
                                onClick: () => void run(() => api.runRigBones({ jobId: job.id }), "已提交骨骼构建", K_RIG_BONES)
                              },
                              "生成骨骼与动画"
                            ),
                            h("span", { className: "SPR_refRow" }, "动画预设"),
                            RIG_ANIMATIONS.map((name) =>
                              h(
                                "label",
                                { key: name, className: "SPR_refRow", style: { display: "inline-flex", gap: 4, alignItems: "center" } },
                                h("input", {
                                  type: "checkbox",
                                  checked: (settingsDraft.animations ?? []).includes(name),
                                  onChange: (event) => {
                                    const current = new Set(settingsDraft.animations ?? []);
                                    if (event.target.checked) current.add(name);
                                    else current.delete(name);
                                    setSettingsDraft({ ...settingsDraft, animations: RIG_ANIMATIONS.filter((entry) => current.has(entry)) });
                                  }
                                }),
                                name
                              )
                            ),
                            h(Btn, { onClick: () => void saveSettings() }, "保存动画选择"),
                            job.rig?.skeleton !== null && job.rig?.skeleton !== undefined ? h("a", { className: "SPR_link", href: job.rig.skeleton, download: "skeleton.json" }, "下载 skeleton.json") : null,
                            job.rig?.preview !== null && job.rig?.preview !== undefined ? h("a", { className: "SPR_link", href: job.rig.preview, target: "_blank", rel: "noreferrer" }, "新窗口打开预览") : null
                          ),
                          (job.rig?.warnings ?? []).length > 0
                            ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } }, `骨骼告警：${job.rig.warnings.join("；")}`)
                            : null,
                          job.rig?.preview !== null && job.rig?.preview !== undefined
                            ? h(
                                React.Fragment,
                                null,
                                h(
                                  "div",
                                  { className: "SPR_rigEditorRow" },
                                  h("span", { className: "SPR_refRow" }, "播放动画"),
                                  (job.rig.animations ?? []).map((name) =>
                                    h(Btn, { key: name, on: anim === name, onClick: () => setAnim(name) }, name)
                                  ),
                                  h("span", { className: "SPR_hint" }, "预览里也能拖时间轴、开骨骼网格")
                                ),
                                h("iframe", { className: "SPR_rigPreview", src: `${job.rig.preview}#${anim}`, title: "骨骼动画预览" })
                              )
                            : h("p", { className: "SPR_hint", style: { marginTop: 10 } }, job.layout?.status === "ready" ? "点「生成骨骼与动画」得到 skeleton.json 与可播放预览。" : "先完成第②步装配定位。"),
                          h(RigBoneEditor, { job, api, run, busy, activeKey: K_RIG_BONES }),
                          h(
                            "div",
                            { className: "SPR_toolbar", style: { marginTop: 12 } },
                            h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "rig" }), "第③步已通过"), on: rigStageOf(job, "rig").approved === true, disabled: job.rig?.status !== "ready" }, rigStageOf(job, "rig").approved === true ? "第③步：已通过" : "第③步：通过"),
                            h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "rig" })) }, "取消通过"),
                            h(Btn, { onClick: () => setStage("atlas") }, "下一步：图集 →")
                          )
                        )
                      : null,

                    // ── ④ 图集 ────────────────────────────────────────────
                    stage === "atlas"
                      ? h(
                          "div",
                          { className: "SPR_rigStage" },
                          h(
                            "div",
                            { className: "SPR_rigStageHead" },
                            h("span", { className: "SPR_rigStageTitle" }, "④ 图集"),
                            h("span", { className: "SPR_rigStageHint" }, "把部件按装配后的尺寸打包成 Spine 纹理图集。区域尺寸与 skeleton.json 里挂点的 width/height 一致，导入引擎不会错位。"),
                            h(StatusChip, { node: rigStageOf(job, "atlas") })
                          ),
                          h(
                            "div",
                            { className: "SPR_rigEditorRow" },
                            h(
                              BusyBtn,
                              {
                                busy: keyBusy(K_RIG_ATLAS),
                                busyText: "正在打包…",
                                primary: true,
                                disabled: job.rig?.status !== "ready" || busy,
                                onClick: () => void run(() => api.runRigAtlas({ jobId: job.id }), "已提交图集打包", K_RIG_ATLAS)
                              },
                              "打包纹理图集"
                            ),
                            job.atlas?.text !== null && job.atlas?.text !== undefined ? h("a", { className: "SPR_link", href: job.atlas.text, target: "_blank", rel: "noreferrer" }, "查看 skeleton.atlas") : null,
                            job.atlas?.image !== null && job.atlas?.image !== undefined ? h("a", { className: "SPR_link", href: job.atlas.image, download: "skeleton.png" }, "下载 skeleton.png") : null,
                            job.atlas?.width !== undefined ? h(Chip, { kind: "ready", text: `${job.atlas.width}×${job.atlas.height} · ${job.atlas.regions} 区域` }) : null
                          ),
                          job.atlas?.url !== null && job.atlas?.url !== undefined
                            ? h("div", { className: "SPR_rigAtlasWrap" }, h("img", { src: job.atlas.url, alt: "atlas" }))
                            : h("p", { className: "SPR_hint", style: { marginTop: 10 } }, job.rig?.status === "ready" ? "点「打包纹理图集」生成 skeleton.png + skeleton.atlas。" : "先完成第③步骨骼构建。"),
                          h(
                            "div",
                            { className: "SPR_toolbar", style: { marginTop: 12 } },
                            h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "atlas" }), "第④步已通过"), on: rigStageOf(job, "atlas").approved === true, disabled: job.atlas?.status !== "ready" }, rigStageOf(job, "atlas").approved === true ? "第④步：已通过" : "第④步：通过"),
                            h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "atlas" })) }, "取消通过")
                          ),
                          h("p", { className: "SPR_hint", style: { marginTop: 10 } }, "导入 Spine：把 skeleton.json、skeleton.atlas、skeleton.png 三个文件放在同一目录，打开 Spine 时选 skeleton.json 即可。")
                        )
                      : null,

                    renderJobLog(job)
                  )
            )
      );
    }

    // ── 设置页 ───────────────────────────────────────────────────────────
    function ConfigSection(props) {
      const api = props?.api;
      const [config, setConfig] = React.useState(null);
      const [arkKey, setArkKey] = React.useState("");
      const [minimaxKey, setMinimaxKey] = React.useState("");
      const [notice, setNotice] = React.useState(null);
      const [testing, setTesting] = React.useState(null);

      const load = React.useCallback(async () => {
        if (api === undefined) return;
        try {
          setConfig(await api.getConfig());
        } catch (error) {
          setNotice({ kind: "error", text: msg(error) });
        }
      }, [api]);

      React.useEffect(() => {
        void load();
      }, [load]);

      const run = async (fn, successText) => {
        if (api === undefined) return;
        try {
          const value = await fn();
          setNotice({ kind: "ok", text: typeof successText === "function" ? successText(value) : successText });
          await load();
        } catch (error) {
          setNotice({ kind: "error", text: msg(error) });
        }
      };

      if (api === undefined || config === null) {
        return h("section", { className: "SPR_settings" }, h("p", { className: "SPR_hint" }, "正在载入配置…"));
      }

      const patch = (values) => run(() => api.saveConfig(values), "配置已保存");

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
        const values: Record<string, unknown> = { minimaxModel: nextModel };
        if (compshareModelId !== undefined && nextModel === compshareModelId) {
          values.minimaxBaseUrl = compshareBaseUrl;
        } else if (config.minimaxModel === compshareModelId && config.minimaxBaseUrl === compshareBaseUrl) {
          values.minimaxBaseUrl = config.defaults?.minimaxBaseUrl ?? "https://api.minimaxi.com";
        }
        void patch(values);
      };
      const usingCompshare = compshareModelId !== undefined && config.minimaxModel === compshareModelId;

      return h(
        "section",
        { className: "SPR_settings" },
        h("h2", { style: { margin: 0, fontSize: 15 } }, "游戏素材大师"),
        h("p", { className: "SPR_hint" }, "配置两家模型的 API Key 与整条流水线的默认参数。Key 只保存在本机 DSH 数据目录下的 game-material-master/config.json（真实路径见文末「数据位置」），界面里始终脱敏显示。"),

        notice !== null
          ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text)
          : null,

        h(
          "div",
          { className: "SPR_settingsGroup" },
          h("h3", null, "火山方舟（生图）"),
          h("p", null, config.ffmpeg?.ok === true ? `ffmpeg 可用：${config.ffmpeg.version}` : `ffmpeg 不可用：${config.ffmpeg?.error ?? "未知"}`),
          h(
            "div",
            { className: "SPR_keyRow" },
            h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, `API Key ${config.arkApiKeySet ? `（已配置 ${config.arkApiKeyHint}）` : "（未配置）"}`),
              h("input", {
                className: "SPR_input",
                type: "password",
                placeholder: config.arkApiKeySet ? "留空表示不修改" : "粘贴 ARK_API_KEY",
                value: arkKey,
                onChange: (event) => setArkKey(event.target.value)
              })
            ),
            h(Btn, { onClick: () => run(async () => { await api.saveConfig({ arkApiKey: arkKey }); setArkKey(""); }, "火山方舟 Key 已保存") }, "保存 Key"),
            h(Btn, { disabled: !config.arkApiKeySet, onClick: () => run(() => api.saveConfig({ clearArkApiKey: true }), "已清除火山方舟 Key") }, "清除")
          ),
          h(
            "div",
            { className: "SPR_fields" },
            h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, "生图模型"),
              h(
                "select",
                {
                  className: "SPR_input",
                  value: config.arkModel,
                  onChange: (event) => void patch({ arkModel: event.target.value })
                },
                (config.arkModels ?? []).map((model) =>
                  h("option", { key: model.id, value: model.id }, `${model.label}（${model.id}）`)
                ),
                (config.arkModels ?? []).some((model) => model.id === config.arkModel)
                  ? null
                  : h("option", { value: config.arkModel }, `自定义：${config.arkModel}`)
              )
            ),
            h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, "输出尺寸"),
              h("input", {
                className: "SPR_input",
                value: config.arkSize,
                onChange: (event) => void patch({ arkSize: event.target.value })
              })
            ),
            h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, "Base URL"),
              h("input", {
                className: "SPR_input",
                value: config.arkBaseUrl,
                onChange: (event) => void patch({ arkBaseUrl: event.target.value })
              })
            )
          ),
          h(
            "div",
            { className: "SPR_toolbar" },
            h(
              BusyBtn,
              {
                busy: testing === "ark",
                busyText: "正在生成测试图…",
                disabled: testing !== null || !config.arkApiKeySet,
                onClick: async () => {
                  setTesting("ark");
                  await run(() => api.testArk(), (value) => `连接正常：${value.model} 返回 ${value.bytes} 字节图片`);
                  setTesting(null);
                }
              },
              "测试连接（会真实生成 1 张 1K 小图，产生少量费用）"
            )
          )
        ),

        h(
          "div",
          { className: "SPR_settingsGroup" },
          h("h3", null, "MiniMax（图生视频）"),
          h("p", null, "视频阶段使用图生视频（I2V）。建议用 MiniMax-Hailuo-02，镜头稳定性最好。"),
          h(
            "div",
            { className: "SPR_keyRow" },
            h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, `API Key ${config.minimaxApiKeySet ? `（已配置 ${config.minimaxApiKeyHint}）` : "（未配置）"}`),
              h("input", {
                className: "SPR_input",
                type: "password",
                placeholder: config.minimaxApiKeySet ? "留空表示不修改" : "粘贴 MiniMax API Key",
                value: minimaxKey,
                onChange: (event) => setMinimaxKey(event.target.value)
              })
            ),
            h(Btn, { onClick: () => run(async () => { await api.saveConfig({ minimaxApiKey: minimaxKey }); setMinimaxKey(""); }, "MiniMax Key 已保存") }, "保存 Key"),
            h(Btn, { disabled: !config.minimaxApiKeySet, onClick: () => run(() => api.saveConfig({ clearMinimaxApiKey: true }), "已清除 MiniMax Key") }, "清除")
          ),
          h(
            "div",
            { className: "SPR_fields" },
            h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, "视频模型"),
              h(
                "select",
                {
                  className: "SPR_input",
                  value: config.minimaxModel,
                  onChange: (event) => onModelChange(event.target.value)
                },
                (config.minimaxModels ?? []).map((model) =>
                  h("option", { key: model.id, value: model.id }, `${model.label}（${model.id}）`)
                ),
                (config.minimaxModels ?? []).some((model) => model.id === config.minimaxModel)
                  ? null
                  : h("option", { value: config.minimaxModel }, `自定义：${config.minimaxModel}`)
              )
            ),
            // 时长控件随模型切换：Hailuo 是 6/10 两档，H3 是 4~15 连续区间。
            minimaxCaps.durations !== undefined
              ? h(
                  "label",
                  { className: "SPR_field" },
                  h("span", { className: "SPR_fieldLabel" }, "时长（秒）"),
                  h(
                    "select",
                    {
                      className: "SPR_input",
                      value: config.minimaxDuration,
                      onChange: (event) => void patch({ minimaxDuration: Number(event.target.value) })
                    },
                    minimaxCaps.durations.map((seconds) =>
                      h("option", { key: seconds, value: seconds }, `${seconds} 秒`)
                    )
                  )
                )
              : h(NumField, {
                  label: `时长（秒，${minimaxCaps.durationMin}~${minimaxCaps.durationMax}）`,
                  value: config.minimaxDuration,
                  min: minimaxCaps.durationMin,
                  max: minimaxCaps.durationMax,
                  onChange: (value) => void patch({ minimaxDuration: value })
                }),
            h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, "分辨率"),
              h(
                "select",
                {
                  className: "SPR_input",
                  value: config.minimaxResolution,
                  onChange: (event) => void patch({ minimaxResolution: event.target.value })
                },
                minimaxCaps.resolutions.map((value) => h("option", { key: value, value }, value))
              )
            ),
            h(
              "label",
              { className: "SPR_field" },
              h(
                "span",
                { className: "SPR_fieldLabel" },
                usingCompshare
                  ? "Base URL（优云智算版 H3 固定使用，无需修改）"
                  : "Base URL（主机根，不含 /v1、/v2）"
              ),
              h("input", {
                className: "SPR_input",
                list: "SPR_minimax_hosts",
                value: config.minimaxBaseUrl,
                disabled: usingCompshare,
                onChange: (event) => void patch({ minimaxBaseUrl: event.target.value })
              }),
              h(
                "datalist",
                { id: "SPR_minimax_hosts" },
                (config.minimaxHosts ?? []).map((host) => h("option", { key: host.id, value: host.id }, host.label))
              ),
              h(
                "span",
                { className: "SPR_fieldLabel" },
                `当前协议：${minimaxCaps.protocol === "v2" ? `v2（${config.minimaxPathPrefix ?? ""}/v2/video_generation）` : `v1（${config.minimaxPathPrefix ?? ""}/v1/video_generation）`}`
              )
            )
          ),
          h(
            "div",
            { className: "SPR_toolbar" },
            h(
              BusyBtn,
              {
                busy: testing === "minimax",
                busyText: "正在校验…",
                disabled: testing !== null || !config.minimaxApiKeySet,
                onClick: async () => {
                  setTesting("minimax");
                  await run(() => api.testMinimax(), (value) => `连接正常：${value.model}`);
                  setTesting(null);
                }
              },
              "测试连接（只校验 Key，不产生费用）"
            )
          )
        ),

        h(
          "div",
          { className: "SPR_settingsGroup" },
          h("h3", null, "新建项目的默认参数"),
          h("p", null, "这些值会成为每个新项目的初始设置，之后可在项目里单独调整。"),
          h(
            "div",
            { className: "SPR_fields" },
            h(NumField, {
              label: "单格宽（px）",
              value: config.cellWidth,
              min: 16,
              max: 2048,
              onChange: (value) => void patch({ cellWidth: value })
            }),
            h(NumField, {
              label: "单格高（px）",
              value: config.cellHeight,
              min: 16,
              max: 2048,
              onChange: (value) => void patch({ cellHeight: value })
            }),
            h(NumField, {
              label: "每段视频抽帧数",
              value: config.frameCount,
              min: 1,
              max: 64,
              onChange: (value) => void patch({ frameCount: value })
            }),
            h(NumField, {
              label: "并发数",
              value: config.concurrency,
              min: 1,
              max: 8,
              onChange: (value) => void patch({ concurrency: value })
            }),
            h(NumField, {
              label: "抠像下限",
              value: config.keyLow,
              min: 0,
              max: 255,
              onChange: (value) => void patch({ keyLow: value })
            }),
            h(NumField, {
              label: "抠像上限",
              value: config.keyHigh,
              min: 1,
              max: 255,
              onChange: (value) => void patch({ keyHigh: value })
            }),
            h(NumField, {
              label: "去绿溢出",
              value: config.despill,
              min: 0,
              max: 1,
              step: 0.05,
              onChange: (value) => void patch({ despill: value })
            }),
            h(NumField, {
              label: "边缘收缩（px）",
              value: config.edgeShrink,
              min: 0,
              max: 8,
              onChange: (value) => void patch({ edgeShrink: value })
            }),
            h(NumField, {
              label: "背景分割容差（0 = 只认绿色）",
              value: config.bgTolerance,
              min: 0,
              max: 160,
              onChange: (value) => void patch({ bgTolerance: value })
            }),
            h(NumField, {
              label: "抽帧工作尺寸（长边 px）",
              value: config.workingLongEdge,
              min: 128,
              max: 2048,
              onChange: (value) => void patch({ workingLongEdge: value })
            }),
            h(NumField, {
              label: "像素块边长（0/1 = 关闭）",
              value: config.pixelSize,
              min: 0,
              max: 32,
              onChange: (value) => void patch({ pixelSize: value })
            }),
            h(NumField, {
              label: "自动裁剪填充比例",
              value: config.fillRatio,
              min: 0.5,
              max: 1,
              step: 0.02,
              onChange: (value) => void patch({ fillRatio: value })
            }),
            h(NumField, {
              label: "底部留白（px）",
              value: config.bottomMargin,
              min: 0,
              max: 64,
              onChange: (value) => void patch({ bottomMargin: value })
            })
          )
        ),

        h(
          "div",
          { className: "SPR_settingsGroup" },
          h("h3", null, "数据位置"),
          h(
            "p",
            null,
            "所有项目（源图、绿幕图、视频、序列帧、整图）都保存在：" ,
            h("code", null, config.dataRoot)
          ),
          h(
            "div",
            { className: "SPR_toolbar" },
            h(Btn, { onClick: () => void run(() => api.saveConfig({}), "已刷新") }, "重新读取配置")
          )
        )
      );
    }

    // ── cordis 插件体 ────────────────────────────────────────────────────
    const inject = ["slots", "remote"];

    function apply(ctx) {
      // 样式随 fiber 生命周期注入/移除。
      ctx.effect(() => {
        if (typeof document === "undefined") return () => {};
        const style = document.createElement("style");
        style.setAttribute("data-plugin", PACKAGE);
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => {
          style.remove();
        };
      }, `${PACKAGE}: styles`);

      const mount = ctx.remote.$mount(CONTRIBUTION);

      const call = async (method, payload?: any) => {
        await mount;
        const remote = ctx.get(`remote.${SERVICE}`);
        if (remote === undefined) throw new Error("gameStudio 远程服务不可用，请确认插件已启用");
        const result = payload === undefined ? await remote[method]() : await remote[method](payload);
        if (result === null || typeof result !== "object" || result.ok !== true) {
          const detail = result?.error;
          throw new Error(detail === undefined ? `${method} 调用失败` : `${detail.code ?? "ERROR"}: ${detail.message ?? ""}`);
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
        getProject: (projectId) => call("getProject", { projectId }),
        deleteProject: (payload) => call("deleteProject", payload),
        renameProject: (payload) => call("renameProject", payload),
        uploadSource: (payload) => call("uploadSource", payload),
        savePrompts: (payload) => call("savePrompts", payload),
        saveSettings: (payload) => call("saveSettings", payload),
        setApproved: (payload) => call("setApproved", payload),
        revealProject: (payload) => call("revealProject", payload),
        runImage: (payload) => call("runImage", payload),
        runImages: (payload) => call("runImages", payload),
        runVideos: (payload) => call("runVideos", payload),
        pollVideos: (payload) => call("pollVideos", payload),
        clearVideos: (payload) => call("clearVideos", payload),
        runFrames: (payload) => call("runFrames", payload),
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
        runRigSheet: (payload) => call("runRigSheet", payload),
        runRigSegment: (payload) => call("runRigSegment", payload),
        runRigLayout: (payload) => call("runRigLayout", payload),
        runRigBones: (payload) => call("runRigBones", payload),
        runRigAtlas: (payload) => call("runRigAtlas", payload)
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
      }, `${PACKAGE}: 深链接拦截`);

      // 上报 origin（宿主据此拼可点链接），并处理「直接以深链接打开」的兜底路径。
      ctx.effect(() => {
        reportClientOrigin(api);
        consumeUrlIntent(ctx);
        return () => {};
      }, `${PACKAGE}: 深链接引导`);

      // 侧栏全局面板图标；id 与 main 的 key 必须一致，点击即切到工作台。
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: GAME_STUDIO_PANEL_ID,
            order: 40,
            label: () => "游戏素材大师"
          },
          StudioGlyph
        )
      );

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: GAME_STUDIO_PANEL_ID,
            inject: () => ({ api })
          },
          StudioPanel
        )
      );

      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: GAME_STUDIO_PANEL_ID,
            order: 18,
            label: () => "游戏素材大师",
            inject: () => ({ api })
          },
          ConfigSection
        )
      );
    }

    bundleModule.exports.apply = apply;
    bundleModule.exports.inject = inject;
    bundleModule.exports.GAME_STUDIO_PANEL_ID = GAME_STUDIO_PANEL_ID;
    // 仅测试用把手：三个模块组件在工厂闭包里，脚本要能拿出来单独渲染
    // （见 scripts/verify-feedback.mjs）。运行时没有任何调用点。
    bundleModule.exports.__test = { StudioPanel, ImageModule, SequenceModule, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, CSS, subscribeIntent, parseIntents, openStudioIntent, OPEN_QUERY_KEY };
    return bundleModule.exports;
  }
});
