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
            ["composeSequence", true]
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
        /** 三个功能模块。插件是「大师」，每个模块管一类素材。 */
        const MODULES = [
            { key: "sprite", title: "八方向图生成", hint: "一张设定图 → 8 方向 × 8 帧精灵图" },
            { key: "image", title: "图片生成", hint: "按提示词出图，可带参考图，支持抠绿幕导出 PNG" },
            { key: "sequence", title: "序列帧生成", hint: "图/视频参考生成视频 → 抽帧 → 抠像 → 合成与播放预览" }
        ];
        const STAGES = [
            { key: "images", title: "① 八方向绿幕图", hint: "以源图为基准，按依赖顺序生成八个方位的纯绿幕全身图" },
            { key: "videos", title: "② 行走动作视频", hint: "固定镜头、固定背景，让角色朝原方位原地走三步" },
            { key: "frames", title: "③ 提取序列帧", hint: "每段视频按时长平均抽帧，逐帧核对动作连贯性" },
            { key: "sheet", title: "④ 抠绿幕合成整图", hint: "剔除绿幕并按行序拼成一张精灵图" },
            { key: "preview", title: "⑤ 行走预览", hint: "用 WASD 或方向键操控角色，看看八方向接起来顺不顺" }
        ];
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
        function statusKind(node) {
            if (node === undefined)
                return { kind: "empty", text: "未生成" };
            if (node.approved)
                return { kind: "approved", text: "已通过" };
            if (node.status === "running")
                return { kind: "running", text: "进行中" };
            if (node.status === "error")
                return { kind: "error", text: "失败" };
            if (node.status === "ready") {
                if (node.stale)
                    return { kind: "stale", text: "需重做" };
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
        function Btn({ children, onClick, disabled, primary, on, danger, title }) {
            return h("button", {
                type: "button",
                className: "SPR_btn",
                onClick,
                disabled: disabled === true,
                title,
                "data-primary": primary === true ? "true" : undefined,
                "data-on": on === true ? "true" : undefined,
                "data-danger": danger === true ? "true" : undefined
            }, children);
        }
        function NumField({ label, value, onChange, min, max, step }) {
            return h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, label), h("input", {
                className: "SPR_input",
                type: "number",
                value: value,
                min,
                max,
                step: step === undefined ? 1 : step,
                onChange: (event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next))
                        onChange(next);
                }
            }));
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
            return h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, label), h("input", { className: "SPR_input", value: value ?? "", readOnly: true, disabled: true }), h("span", { className: "SPR_fieldLabel" }, "跟随即「设置 → 游戏素材大师」"));
        }
        function assetUrl(project, relative, version) {
            if (project === null || relative === undefined || relative === null)
                return undefined;
            const base = project.assetBase ?? "";
            const suffix = version === undefined ? "" : `?v=${version}`;
            return `${base}${relative}${suffix}`;
        }
        // ── 侧栏图标 ─────────────────────────────────────────────────────────
        function StudioGlyph(props) {
            const size = props?.size ?? 18;
            return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, h("rect", { x: 3.2, y: 3.2, width: 17.6, height: 17.6, rx: 3, stroke: "currentColor", strokeWidth: 1.6 }), h("rect", { x: 5.6, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }), h("rect", { x: 10.2, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }), h("rect", { x: 14.8, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }), h("rect", { x: 5.6, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }), h("rect", { x: 10.2, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.28 }), h("rect", { x: 14.8, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }), h("rect", { x: 5.6, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }), h("rect", { x: 10.2, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }), h("rect", { x: 14.8, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }));
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
            const busy = project !== null && ((project.jobs?.length ?? 0) > 0 ||
                DIRECTION_KEYS.some((key) => project.videos?.[key]?.status === "running"));
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
            }, [projectId, loadProject]);
            // 有任务在跑时轮询；跑完自动停。
            React.useEffect(() => {
                if (!busy || projectId === null)
                    return undefined;
                const timer = setInterval(() => {
                    void loadProject(projectId);
                }, 2500);
                return () => clearInterval(timer);
            }, [busy, projectId, loadProject]);
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
                    setNotice({ kind: "error", text: "远程服务尚未挂载完成，请稍候再试" });
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
            const createProject = () => withApi(async () => {
                const created = await api.createProject({ name: `角色 ${new Date().toLocaleString("zh-CN", { hour12: false })}` });
                await refreshProjects();
                setProjectId(created.projectId);
            }, { notice: "已创建新项目" });
            const deleteCurrent = async () => {
                if (project === null)
                    return;
                // eslint-disable-next-line no-alert
                if (typeof window !== "undefined" && !window.confirm(`确定删除项目「${project.name}」？项目目录会被整个移除，无法撤销。`))
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
                const next = typeof window === "undefined" ? null : window.prompt("新的项目名", project.name);
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
                        reader.onerror = () => reject(new Error("读取文件失败"));
                        reader.readAsDataURL(file);
                    });
                    await api.uploadSource({ projectId: project.id, name: file.name, data: base64 });
                    setNotice({ kind: "ok", text: `已上传源图：${file.name}` });
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
                notice: "提示词已保存",
                noticeKind: "ok"
            });
            const saveSettings = (patch) => withApi(() => api.saveSettings({ projectId: project.id, settings: patch }), {
                reload: true,
                notice: "参数已保存",
                noticeKind: "ok"
            });
            /**
             * 启动一个后台任务。
             * `started: false` 表示宿主拒绝了这次启动（例如同一任务已在跑）——
             * 这不算错误，但必须让用户看见原因，否则点按钮像是没反应。
             */
            const start = async (fn, done) => {
                const result = await withApi(fn, done);
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
            return h("div", { className: "SPR_root" }, h("div", { className: "SPR_head" }, h("h2", null, "游戏素材大师"), h("span", { className: "SPR_headSub" }, "火山方舟 Seedream 生图 · MiniMax 图生视频 · 本地抠绿幕合成"), h("span", { className: "SPR_spacer" }), module === "sprite"
                ? h(React.Fragment, null, h(Btn, { onClick: () => void refreshProjects(), disabled: loading }, "刷新列表"), project !== null ? h(Btn, { onClick: renameCurrent }, "重命名") : null, project !== null ? h(Btn, { onClick: deleteCurrent, danger: true }, "删除项目") : null, h(Btn, { onClick: createProject, primary: true }, "新建项目"))
                : null), h("div", { className: "SPR_modules" }, MODULES.map((entry) => h("button", {
                key: entry.key,
                type: "button",
                className: "SPR_module",
                "data-active": module === entry.key ? "true" : "false",
                onClick: () => setModule(entry.key)
            }, h("span", { className: "SPR_moduleTitle" }, entry.title), h("span", { className: "SPR_moduleHint" }, entry.hint)))), module === "sprite"
                ? h("div", { className: "SPR_body" }, h("div", { className: "SPR_side" }, h("div", { className: "SPR_sideTitle" }, `项目（${projects.length}）`), projects.length === 0
                    ? h("p", { className: "SPR_hint" }, "还没有项目，点右上角「新建项目」开始。")
                    : projects.map((summary) => h("button", {
                        key: summary.id,
                        type: "button",
                        className: "SPR_projItem",
                        "data-active": summary.id === projectId ? "true" : "false",
                        onClick: () => setProjectId(summary.id)
                    }, h("span", { className: "SPR_projName" }, summary.name), h("span", { className: "SPR_projMeta" }, `图 ${summary.imageReady}/8 · 视频 ${summary.videoReady}/8 · 帧 ${summary.framesReady}/8${summary.sheetReady ? " · 整图✓" : ""}`)))), h("div", { className: "SPR_main" }, notice !== null
                    ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text, h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, "关闭")))
                    : null, project === null
                    ? h("p", { className: "SPR_empty" }, loading ? "正在载入…" : "请选择或新建一个项目")
                    : h(React.Fragment, null, h("div", { className: "SPR_steps" }, STAGES.map((item, index) => h("button", {
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
                    }), item.title))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, activeStage.title)), h("p", { className: "SPR_hint" }, activeStage.hint), stage === "images"
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
                            loadProject
                        })
                        : null, stage === "videos"
                        ? renderVideoStage({ project, videoPromptDraft, setVideoPromptDraft, savePrompts, start, setNotice, loadProject })
                        : null, stage === "frames"
                        ? renderFrameStage({ project, start, setNotice, loadProject, settingsDraft, saveSettings })
                        : null, stage === "sheet"
                        ? renderSheetStage({ project, settingsDraft, setSettingsDraft, saveSettings, start, setNotice, loadProject })
                        : null, stage === "preview" ? h(WalkPreview, { project }) : null), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, "源图")), h("p", { className: "SPR_hint" }, "上传角色的原始设定图。第一步的正面绿幕图会以它为唯一参考。"), h("div", { className: "SPR_sourceRow" }, project.source !== null
                        ? h("img", {
                            className: "SPR_sourcePreview",
                            src: assetUrl(project, project.source.file, project.updatedAt),
                            alt: "源图"
                        })
                        : h("div", { className: "SPR_thumbEmpty", style: { width: 132, height: 132, flex: "none" } }, "尚未上传源图"), h("div", { style: { flex: 1, minWidth: 240 } }, h("div", {
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
                    }, sourceBusy ? "正在上传…" : "把图片拖到这里，或"), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => fileInputRef.current?.click(), disabled: sourceBusy, primary: project.source === null }, project.source === null ? "选择源图" : "更换源图"), project.source !== null
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
                    })))), renderLog(project), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => void loadProject(project.id) }, "刷新状态"), h(Btn, { onClick: () => void withApi(() => api.revealProject({ projectId: project.id })) }, "在访达中打开项目目录")))))
                : module === "image"
                    ? h(ImageModule, { api })
                    : h(SequenceModule, { api }));
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
        function renderImageStage(ctx) {
            const { project, api, promptDraft, setPromptDraft, promptOpen, setPromptOpen, savePrompts, start, setNotice } = ctx;
            const allApproved = DIRECTION_KEYS.every((key) => project.images?.[key]?.approved);
            return h(React.Fragment, null, h("div", { className: "SPR_toolbar" }, h(Btn, {
                primary: true,
                disabled: project.source === null,
                onClick: () => void start(() => api.runImages({ projectId: project.id }), { reload: true })
            }, "一键生成全部（跳过已通过的）"), h(Btn, { onClick: () => void start(() => api.runImages({ projectId: project.id, force: true }), { reload: true }) }, "全部重新生成"), h(Btn, {
                on: allApproved,
                onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "images", approved: !allApproved }), { reload: true })
            }, allApproved ? "取消全部通过" : "全部标记通过"), h(Btn, {
                onClick: () => {
                    if (typeof window !== "undefined" && !window.confirm("把八个方向的生图提示词和视频提示词都重置为当前默认模板？你手改过的内容会丢失。"))
                        return;
                    void start(() => api.savePrompts({ projectId: project.id, resetImagesToDefault: true, resetVideoToDefault: true }), { reload: true, notice: "提示词已重置为默认模板", noticeKind: "ok" });
                }
            }, "重置提示词为默认"), project.source === null ? h("span", { className: "SPR_refRow" }, "请先上传源图") : null), h("div", { className: "SPR_grid" }, DIRECTIONS.map((direction) => {
                const node = project.images?.[direction.key];
                const draft = promptDraft[direction.key] ?? project.prompts?.images?.[direction.key] ?? "";
                const dirty = draft !== (project.prompts?.images?.[direction.key] ?? "");
                const open = promptOpen[direction.key] === true;
                return h("div", { key: direction.key, className: "SPR_node", "data-stale": node?.stale === true ? "true" : "false" }, h("div", { className: "SPR_nodeTop" }, h("span", { className: "SPR_nodeTitle" }, direction.label), h(StatusChip, { node })), node?.file !== undefined
                    ? h("img", {
                        className: "SPR_thumb",
                        src: assetUrl(project, node.file, node.updatedAt ?? project.updatedAt),
                        alt: direction.label
                    })
                    : h("div", { className: "SPR_thumbEmpty" }, node?.status === "running" ? "正在生成…" : `参考：${direction.refs.join(" + ")}`), node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null, node?.status === "ready" && node.elapsedMs !== undefined
                    ? h("span", { className: "SPR_refRow" }, `用时 ${(node.elapsedMs / 1000).toFixed(1)} 秒 · ${node.model ?? ""}`)
                    : h("span", { className: "SPR_refRow" }, `参考：${direction.refs.join(" + ")}`), h("button", {
                    type: "button",
                    className: "SPR_miniBtn",
                    onClick: () => setPromptOpen({ ...promptOpen, [direction.key]: !open })
                }, open ? "收起提示词 ▲" : "编辑提示词 ▼"), open
                    ? h(React.Fragment, null, h("textarea", {
                        className: "SPR_area",
                        value: draft,
                        onChange: (event) => setPromptDraft({ ...promptDraft, [direction.key]: event.target.value })
                    }), h("div", { className: "SPR_btnRow" }, h(Btn, {
                        disabled: !dirty,
                        onClick: () => void savePrompts({ images: { [direction.key]: draft } })
                    }, dirty ? "保存改动" : "已保存"), h(Btn, {
                        onClick: () => void start(() => api.runImage({ projectId: project.id, key: direction.key, prompt: draft }), { reload: true })
                    }, "用这段提示词生成")))
                    : null, h("div", { className: "SPR_btnRow" }, h(Btn, { primary: node?.file === undefined, onClick: () => void start(() => api.runImage({ projectId: project.id, key: direction.key }), { reload: true }) }, node?.file === undefined ? "生成" : "重新生成"), h(Btn, {
                    on: node?.approved === true,
                    disabled: node?.status !== "ready",
                    onClick: () => void start(() => api.setApproved({
                        projectId: project.id,
                        stage: "images",
                        key: direction.key,
                        approved: node?.approved !== true
                    }), { reload: true })
                }, node?.approved === true ? "已通过" : "通过")));
            })));
        }
        // ── 阶段 2：视频 ─────────────────────────────────────────────────────
        function renderVideoStage(ctx) {
            const { project, videoPromptDraft, setVideoPromptDraft, savePrompts, start, setNotice, api } = ctx;
            const readyImages = DIRECTION_KEYS.filter((key) => project.images?.[key]?.file !== undefined);
            const promptDirty = videoPromptDraft !== (project.prompts?.video ?? "");
            const running = DIRECTION_KEYS.filter((key) => project.videos?.[key]?.status === "running");
            const allApproved = DIRECTION_KEYS.every((key) => project.videos?.[key]?.approved);
            return h(React.Fragment, null, h("p", { className: "SPR_hint" }, "提示词要求「固定镜头、固定背景、原地走三步」。Hailuo 一段通常要 1~6 分钟，提交后可以离开这个页面。"), h("textarea", {
                className: "SPR_area",
                value: videoPromptDraft,
                onChange: (event) => setVideoPromptDraft(event.target.value)
            }), h("div", { className: "SPR_toolbar" }, h(Btn, { disabled: !promptDirty, onClick: () => void savePrompts({ video: videoPromptDraft }) }, promptDirty ? "保存视频提示词" : "视频提示词已保存"), h(Btn, {
                primary: true,
                disabled: readyImages.length === 0,
                onClick: () => void start(() => api.runVideos({ projectId: project.id }), { reload: true })
            }, `生成全部视频（${readyImages.length}/8 张绿幕图就绪）`), h(Btn, { onClick: () => void start(() => api.pollVideos({ projectId: project.id }), { reload: true }) }, "立即刷新进度"), h(Btn, {
                on: allApproved,
                onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "videos", approved: !allApproved }), { reload: true })
            }, allApproved ? "取消全部通过" : "全部标记通过"), h(Btn, {
                danger: true,
                onClick: () => {
                    if (typeof window !== "undefined" && !window.confirm("清空所有视频与已抽的帧？绿幕图会保留。"))
                        return;
                    void start(() => api.clearVideos({ projectId: project.id }), { reload: true, notice: "已清空视频与序列帧", noticeKind: "ok" });
                }
            }, "清空视频重来"), running.length > 0 ? h("span", { className: "SPR_refRow" }, `${running.length} 个任务进行中，界面会自动刷新`) : null), h("div", { className: "SPR_grid" }, DIRECTIONS.map((direction) => {
                const video = project.videos?.[direction.key];
                const image = project.images?.[direction.key];
                return h("div", { key: direction.key, className: "SPR_node" }, h("div", { className: "SPR_nodeTop" }, h("span", { className: "SPR_nodeTitle" }, direction.label), h(StatusChip, { node: video })), video?.file !== undefined
                    ? h("video", {
                        className: "SPR_video",
                        src: assetUrl(project, video.file, video.updatedAt ?? project.updatedAt),
                        controls: true,
                        preload: "metadata"
                    })
                    : image?.file !== undefined
                        ? h("img", { className: "SPR_thumb", src: assetUrl(project, image.file, image.updatedAt), alt: direction.label })
                        : h("div", { className: "SPR_thumbEmpty" }, "还没有绿幕图"), video?.remoteStatus !== undefined ? h("span", { className: "SPR_refRow" }, `远端状态：${video.remoteStatus}`) : null, video?.error !== undefined ? h("p", { className: "SPR_error" }, video.error) : null, h("div", { className: "SPR_btnRow" }, h(Btn, {
                    primary: video?.file === undefined && image?.file !== undefined,
                    disabled: image?.file === undefined,
                    onClick: () => void start(() => api.runVideos({ projectId: project.id, keys: [direction.key] }), { reload: true })
                }, video?.file === undefined ? "生成视频" : "重新生成"), h(Btn, {
                    on: video?.approved === true,
                    disabled: video?.status !== "ready",
                    onClick: () => void start(() => api.setApproved({
                        projectId: project.id,
                        stage: "videos",
                        key: direction.key,
                        approved: video?.approved !== true
                    }), { reload: true })
                }, video?.approved === true ? "已通过" : "通过")));
            })));
        }
        // ── 阶段 3：抽帧 ─────────────────────────────────────────────────────
        function renderFrameStage(ctx) {
            const { project, start, api, settingsDraft, saveSettings } = ctx;
            const readyVideos = DIRECTION_KEYS.filter((key) => project.videos?.[key]?.file !== undefined);
            const allApproved = DIRECTION_KEYS.every((key) => project.frames?.[key]?.approved);
            const draft = settingsDraft ?? project.settings ?? {};
            return h(React.Fragment, null, h("div", { className: "SPR_fields" }, h(NumField, {
                label: "单格宽（px）",
                value: draft.cellWidth ?? 256,
                min: 16,
                max: 2048,
                onChange: (value) => saveSettings({ cellWidth: value })
            }), h(NumField, {
                label: "单格高（px）",
                value: draft.cellHeight ?? 256,
                min: 16,
                max: 2048,
                onChange: (value) => saveSettings({ cellHeight: value })
            }), h(NumField, {
                label: "每段视频抽帧数",
                value: draft.frameCount ?? 8,
                min: 1,
                max: 64,
                onChange: (value) => saveSettings({ frameCount: value })
            }), h(NumField, {
                label: "抽帧工作尺寸（长边 px）",
                value: draft.workingLongEdge ?? 768,
                min: 128,
                max: 2048,
                onChange: (value) => saveSettings({ workingLongEdge: value })
            }), h(NumField, {
                label: "并发数",
                value: draft.concurrency ?? 3,
                min: 1,
                max: 8,
                onChange: (value) => saveSettings({ concurrency: value })
            })), h("p", { className: "SPR_hint" }, "抽帧抽到的是「工作尺寸」（长边上限），不是最终格子尺寸。自动裁剪、统一缩放和像素量化都在第 4 步做，这样八个方向才能共享同一个裁剪框、脚底对齐同一条基线。改完这里需要重新抽帧。"), h("div", { className: "SPR_toolbar" }, h(Btn, {
                primary: true,
                disabled: readyVideos.length === 0,
                onClick: () => void start(() => api.runFrames({ projectId: project.id }), { reload: true })
            }, `提取全部序列帧（${readyVideos.length}/8 段视频就绪）`), h(Btn, {
                on: allApproved,
                onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "frames", approved: !allApproved }), { reload: true })
            }, allApproved ? "取消全部通过" : "全部标记通过")), h("div", { className: "SPR_grid" }, DIRECTIONS.map((direction) => {
                const node = project.frames?.[direction.key];
                return h("div", { key: direction.key, className: "SPR_node" }, h("div", { className: "SPR_nodeTop" }, h("span", { className: "SPR_nodeTitle" }, direction.label), h(StatusChip, { node })), node?.strip !== undefined
                    ? h("img", { className: "SPR_thumb", src: assetUrl(project, node.strip, node.updatedAt), alt: `${direction.label} 序列帧` })
                    : h("div", { className: "SPR_thumbEmpty" }, "尚未抽帧"), node?.duration !== undefined
                    ? h("span", { className: "SPR_refRow" }, `${node.frames?.length ?? 0} 帧 · 视频 ${node.duration.toFixed(2)} 秒`)
                    : null, node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null, h("div", { className: "SPR_btnRow" }, h(Btn, {
                    primary: node?.status !== "ready",
                    disabled: project.videos?.[direction.key]?.file === undefined,
                    onClick: () => void start(() => api.runFrames({ projectId: project.id, keys: [direction.key] }), { reload: true })
                }, node?.status === "ready" ? "重新抽帧" : "抽取"), h(Btn, {
                    on: node?.approved === true,
                    disabled: node?.status !== "ready",
                    onClick: () => void start(() => api.setApproved({
                        projectId: project.id,
                        stage: "frames",
                        key: direction.key,
                        approved: node?.approved !== true
                    }), { reload: true })
                }, node?.approved === true ? "已通过" : "通过")));
            })));
        }
        // ── 阶段 4：合成整图 ─────────────────────────────────────────────────
        function renderSheetStage(ctx) {
            const { project, settingsDraft, setSettingsDraft, saveSettings, start, api } = ctx;
            const draft = settingsDraft ?? project.settings ?? {};
            const rowOrder = Array.isArray(draft.rowOrder) && draft.rowOrder.length > 0 ? draft.rowOrder : DIRECTION_KEYS;
            const framesReady = DIRECTION_KEYS.filter((key) => project.frames?.[key]?.status === "ready").length;
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
            return h(React.Fragment, null, h("div", { className: "SPR_fields" }, h(NumField, {
                label: "整图单格宽（px）",
                value: draft.cellWidth ?? 256,
                min: 16,
                max: 2048,
                onChange: (value) => {
                    setSettingsDraft({ ...draft, cellWidth: value });
                    void saveSettings({ cellWidth: value });
                }
            }), h(NumField, {
                label: "整图单格高（px）",
                value: draft.cellHeight ?? 256,
                min: 16,
                max: 2048,
                onChange: (value) => {
                    setSettingsDraft({ ...draft, cellHeight: value });
                    void saveSettings({ cellHeight: value });
                }
            }), h(NumField, {
                label: "像素块边长（0/1 = 关闭）",
                value: draft.pixelSize ?? 0,
                min: 0,
                max: 32,
                onChange: (value) => setSettingsDraft({ ...draft, pixelSize: value })
            }), h(NumField, {
                label: "背景分割容差（0 = 只认绿色）",
                value: draft.bgTolerance ?? 90,
                min: 0,
                max: 120,
                onChange: (value) => setSettingsDraft({ ...draft, bgTolerance: value })
            }), h(NumField, {
                label: "抠像下限（绿色优势）",
                value: draft.keyLow ?? 14,
                min: 0,
                max: 255,
                onChange: (value) => setSettingsDraft({ ...draft, keyLow: value })
            }), h(NumField, {
                label: "抠像上限（绿色优势）",
                value: draft.keyHigh ?? 80,
                min: 1,
                max: 255,
                onChange: (value) => setSettingsDraft({ ...draft, keyHigh: value })
            }), h(NumField, {
                label: "去绿溢出 0~1",
                value: draft.despill ?? 0.65,
                min: 0,
                max: 1,
                step: 0.05,
                onChange: (value) => setSettingsDraft({ ...draft, despill: value })
            }), h(NumField, {
                label: "边缘收缩（px）",
                value: draft.edgeShrink ?? 0,
                min: 0,
                max: 8,
                onChange: (value) => setSettingsDraft({ ...draft, edgeShrink: value })
            }), h(NumField, {
                label: "自动裁剪填充比例 0.5~1",
                value: draft.fillRatio ?? 0.94,
                min: 0.5,
                max: 1,
                step: 0.02,
                onChange: (value) => setSettingsDraft({ ...draft, fillRatio: value })
            }), h(NumField, {
                label: "底部留白（px）",
                value: draft.bottomMargin ?? 2,
                min: 0,
                max: 64,
                onChange: (value) => setSettingsDraft({ ...draft, bottomMargin: value })
            }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "自动裁剪到角色包围盒"), h("select", {
                className: "SPR_input",
                value: draft.autoCrop === false ? "off" : "on",
                onChange: (event) => {
                    const autoCrop = event.target.value === "on";
                    setSettingsDraft({ ...draft, autoCrop });
                    void saveSettings({ autoCrop });
                }
            }, h("option", { value: "on" }, "开启（推荐：角色填满格子，八个方向缩放一致）"), h("option", { value: "off" }, "关闭（用整帧画面）")))), h("div", { className: "SPR_toolbar" }, h(Btn, {
                onClick: () => void saveSettings({
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
                })
            }, "保存并重新合成"), h(Btn, {
                disabled: framesReady === 0,
                onClick: () => void start(() => api.rekey({ projectId: project.id }), { reload: true })
            }, "只重跑抠像并重新合成"), h(Btn, {
                primary: true,
                disabled: framesReady === 0,
                onClick: () => void start(() => api.compose({ projectId: project.id }), { reload: true })
            }, `合成整图（${framesReady}/8 组帧就绪）`), project.sheet?.file !== undefined
                ? h("a", {
                    className: "SPR_btn",
                    href: assetUrl(project, project.sheet.file, project.sheet.generatedAt),
                    download: `${project.name}-8dir.png`,
                    style: { textDecoration: "none" }
                }, "下载整图")
                : null, h(Btn, {
                on: project.sheet?.approved === true,
                disabled: project.sheet?.status !== "ready",
                onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "sheet", approved: project.sheet?.approved !== true }), { reload: true })
            }, project.sheet?.approved === true ? "整图已通过" : "整图通过")), project.sheet?.error !== undefined ? h("p", { className: "SPR_error" }, project.sheet.error) : null, h("div", { style: { display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" } }, h("div", { className: "SPR_rowOrder" }, h("span", { className: "SPR_fieldLabel" }, "行序（第 1 行在最上方）"), rowOrder.map((key, index) => h("div", { key: `${key}-${index}`, className: "SPR_rowOrderItem" }, h("span", { className: "SPR_rowOrderIdx" }, String(index + 1)), h("span", { className: "SPR_rowOrderName" }, LABEL_OF[key] ?? key), h("button", { type: "button", className: "SPR_miniBtn", disabled: index === 0, onClick: () => moveRow(index, -1) }, "↑"), h("button", { type: "button", className: "SPR_miniBtn", disabled: index === rowOrder.length - 1, onClick: () => moveRow(index, 1) }, "↓")))), h("div", { style: { flex: 1, minWidth: 300 } }, project.sheet?.file !== undefined
                ? h(React.Fragment, null, h("p", { className: "SPR_hint" }, `输出 ${project.sheet.width}×${project.sheet.height} 像素 · 单格 ${draft.cellWidth}×${draft.cellHeight} · 每行 ${draft.frameCount ?? 8} 帧`), h("div", { className: "SPR_sheetWrap" }, h("img", {
                    className: "SPR_sheet",
                    src: assetUrl(project, project.sheet.file, project.sheet.generatedAt),
                    alt: "整图"
                })))
                : h("p", { className: "SPR_empty" }, framesReady === 0 ? "请先完成第 3 步的抽帧" : "还没有合成整图"))));
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
            liveRef.current.scale = scale;
            liveRef.current.speed = speed;
            liveRef.current.animSpeed = animSpeed;
            liveRef.current.grid = grid;
            // 整图加载（带版本号，重新合成后自动换新图）
            React.useEffect(() => {
                if (sheetUrl === null) {
                    imgRef.current = null;
                    return undefined;
                }
                let cancelled = false;
                const image = new Image();
                image.onload = () => {
                    if (!cancelled)
                        imgRef.current = image;
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
                return h("p", { className: "SPR_empty" }, "还没有可播放的整图。先完成第 ④ 步合成，再回到这里用 WASD 走一走。");
            }
            return h(React.Fragment, null, h("div", { className: "SPR_fields" }, h(NumField, {
                label: "角色缩放倍率",
                value: scale,
                min: 0.3,
                max: 4,
                step: 0.1,
                onChange: setScale
            }), h(NumField, {
                label: "移动速度（像素/秒）",
                value: speed,
                min: 40,
                max: 600,
                step: 10,
                onChange: setSpeed
            }), h(NumField, {
                label: "播放速度（倍，只影响步频）",
                value: animSpeed,
                min: 0.25,
                max: 4,
                step: 0.25,
                onChange: setAnimSpeed
            }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "背景参考网格"), h("select", { className: "SPR_input", value: grid ? "on" : "off", onChange: (event) => setGrid(event.target.value === "on") }, h("option", { value: "on" }, "显示（更容易看出在移动）"), h("option", { value: "off" }, "关闭（纯白）")))), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: reset }, "回到中间"), h("span", { className: "SPR_refRow" }, `当前朝向：${hud.compass}（${LABEL_OF[posRef.current.dirKey] ?? ""}） · ${hud.moving ? "行走中" : "站立"}`), orderStale
                ? h("span", { className: "SPR_refRow" }, "· 整图是按旧行序生成的，正在重新合成…")
                : null, h("span", { className: "SPR_spacer" }), h("span", { className: "SPR_refRow" }, focused ? "已获得键盘焦点" : "点击画面后即可操控")), h("div", {
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
            }, h("canvas", { ref: canvasRef, className: "SPR_canvas", width: STAGE_W, height: STAGE_H }), focused ? null : h("div", { className: "SPR_stageHint" }, "点击这里，然后用 WASD 或 ↑↓←→ 操控角色"), h("div", { className: "SPR_hud" }, h("span", { className: "SPR_hudDir" }, hud.compass), h("span", null, hud.moving ? "行走" : "站立"))), h("p", { className: "SPR_hint" }, "方向按屏幕方位映射：按 ↑ 向北走（背对镜头）、↓ 向南走（正对镜头）、← 向西、→ 向东；斜向同时按两个键。", h("br"), "「播放速度」只改步频快慢，不影响角色移动速度；「移动速度」只改走得多快，不影响动画帧率。切图用的是整图自己记录的行序，所以改完行序即使还没重新合成，预览也不会取错方向。"));
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
                if (list.length > 0)
                    void onFiles(list);
            };
            return h(React.Fragment, null, h("div", {
                className: "SPR_drop",
                "data-over": over ? "true" : "false",
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
            }, busy ? "正在上传…" : label), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => inputRef.current?.click(), disabled: busy === true }, "选择文件"), h("input", {
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
            return h("div", { className: "SPR_fields" }, h(NumField, { label: "抠像下限（绿色优势）", value: draft.keyLow ?? 14, min: 0, max: 255, onChange: (v) => onChange({ keyLow: v }) }), h(NumField, { label: "抠像上限（绿色优势）", value: draft.keyHigh ?? 80, min: 1, max: 255, onChange: (v) => onChange({ keyHigh: v }) }), h(NumField, { label: "去绿溢出 0~1", value: draft.despill ?? 0.65, min: 0, max: 1, step: 0.05, onChange: (v) => onChange({ despill: v }) }), h(NumField, { label: "背景分割容差（0 = 只认绿色）", value: draft.bgTolerance ?? 90, min: 0, max: 160, onChange: (v) => onChange({ bgTolerance: v }) }), h(NumField, { label: "边缘收缩（px）", value: draft.edgeShrink ?? 0, min: 0, max: 8, onChange: (v) => onChange({ edgeShrink: v }) }));
        }
        /** 一份任务/项目列表（左侧栏）。 */
        function JobSidebar({ title, items, activeId, onSelect, onCreate, renderMeta }) {
            return h("div", { className: "SPR_side" }, h("div", { className: "SPR_sideTitle" }, `${title}（${items.length}）`), items.length === 0 ? h("p", { className: "SPR_hint" }, "还没有内容，点右上角新建一个。") : null, items.map((item) => h("button", {
                key: item.id,
                type: "button",
                className: "SPR_projItem",
                "data-active": item.id === activeId ? "true" : "false",
                onClick: () => onSelect(item.id)
            }, h("span", { className: "SPR_projName" }, item.name), h("span", { className: "SPR_projMeta" }, renderMeta(item)))), items.length === 0 ? h(Btn, { onClick: onCreate, primary: true }, "新建") : null);
        }
        // ── 模块②：图片生成 ─────────────────────────────────────────────────
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
            const busy = job !== null && (job.items ?? []).some((item) => item.status === "running");
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
            const run = async (fn, okText = undefined) => {
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
            const create = () => run(async () => {
                const created = await api.createImageJob({ name: `图片 ${new Date().toLocaleString("zh-CN", { hour12: false })}` });
                await refresh();
                setJobId(created.jobId);
            }, "已新建图片任务");
            const saveJob = (patch) => run(() => api.saveImageJob({ jobId: job.id, ...patch }), "已保存");
            const del = async () => {
                if (job === null)
                    return;
                if (typeof window !== "undefined" && !window.confirm(`删除任务「${job.name}」？目录会被整个移除。`))
                    return;
                await run(async () => {
                    await api.deleteImageJob({ jobId: job.id });
                    const list = await refresh();
                    setJobId(list.length > 0 ? list[0].id : null);
                    if (list.length === 0)
                        setJob(null);
                }, "已删除");
            };
            const upload = async (files, kind) => {
                setUploading(true);
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
            };
            return h(React.Fragment, null, h("div", { className: "SPR_body" }, h(JobSidebar, {
                title: "图片任务",
                items: jobs,
                activeId: jobId,
                onSelect: setJobId,
                onCreate: create,
                renderMeta: (item) => `${item.ready} 张 · 抠像 ${item.keyed}`
            }), h("div", { className: "SPR_main" }, notice !== null
                ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text, h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, "关闭")))
                : null, h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: create, primary: true }, "新建任务"), job !== null ? h(Btn, { onClick: del, danger: true }, "删除任务") : null), job === null
                ? h("p", { className: "SPR_empty" }, "请选择或新建一个图片任务")
                : h(React.Fragment, null, h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, "① 提示词")), h("p", { className: "SPR_hint" }, "统一附加提示词会接在主提示词后面，用来写跨批次的共同要求。"), h("textarea", {
                    className: "SPR_area",
                    placeholder: "描述你要生成的图片…",
                    value: promptDraft,
                    onChange: (event) => setPromptDraft(event.target.value),
                    onBlur: () => {
                        if (promptDraft !== (job.prompt ?? ""))
                            void saveJob({ prompt: promptDraft });
                    }
                }), h("textarea", {
                    className: "SPR_area",
                    style: { minHeight: 60 },
                    placeholder: "统一附加提示词（可留空）",
                    value: suffixDraft,
                    onChange: (event) => setSuffixDraft(event.target.value),
                    onBlur: () => {
                        if (suffixDraft !== (job.suffix ?? ""))
                            void saveJob({ suffix: suffixDraft });
                    }
                }), h("div", { className: "SPR_fields" }, h(GlobalModelField, { label: "生图模型", value: globalConfig?.arkModel ?? settingsDraft.model }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "尺寸"), h("input", { className: "SPR_input", value: settingsDraft.size ?? "", onChange: (event) => setSettingsDraft({ ...settingsDraft, size: event.target.value }), onBlur: () => void saveJob({ settings: settingsDraft }) })), h(NumField, { label: "生成张数（1~8）", value: settingsDraft.count ?? 1, min: 1, max: 8, onChange: (v) => { setSettingsDraft({ ...settingsDraft, count: v }); void saveJob({ settings: { ...settingsDraft, count: v } }); } })), h("div", { className: "SPR_toolbar" }, h(Btn, {
                    primary: true,
                    disabled: promptDraft.trim() === "",
                    onClick: () => void run(() => api.runImageJob({ jobId: job.id }), `已开始生成 ${settingsDraft.count ?? 1} 张`)
                }, `生成 ${settingsDraft.count ?? 1} 张`), h("span", { className: "SPR_refRow" }, "按 Seedream 刊例约 0.2 元/张，实际以方舟账单为准"))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, "② 参考图（可留空）")), h("p", { className: "SPR_hint" }, "最多 10 张。有参考图时走图生图；引用多张时可在提示词里写「图一」「图二」。"), h(UploadBox, { label: "把参考图拖到这里", accept: "image/*", multiple: true, busy: uploading, onFiles: (files) => void upload(files, "ref") }), (job.refs ?? []).length === 0
                    ? null
                    : h("div", { className: "SPR_grid" }, (job.refs ?? []).map((ref) => h("div", { key: ref.file, className: "SPR_node" }, h("img", { className: "SPR_thumb", src: `${job.assetBase}${ref.file}?v=${job.updatedAt}`, alt: ref.name }), h("span", { className: "SPR_refRow" }, ref.name), h("div", { className: "SPR_btnRow" }, h(Btn, { danger: true, onClick: () => void run(() => api.removeImageRef({ jobId: job.id, file: ref.file }), "已移除参考图") }, "移除")))))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, "③ 绿幕抠图")), h("p", { className: "SPR_hint" }, "开启后每张生成完会自动抠一遍；也可以上传已有图片只做抠像。"), h("div", { className: "SPR_toolbar" }, h("select", {
                    className: "SPR_input",
                    style: { width: 220 },
                    value: keyingDraft.enabled ? "on" : "off",
                    onChange: (event) => {
                        const enabled = event.target.value === "on";
                        setKeyingDraft({ ...keyingDraft, enabled });
                        void saveJob({ keying: { enabled } });
                    }
                }, h("option", { value: "off" }, "不抠像"), h("option", { value: "on" }, "自动抠绿幕输出 PNG")), h(Btn, { onClick: () => void run(() => api.keyImageJob({ jobId: job.id }), "已开始抠像") }, "按当前参数重新抠像")), h(KeyingFields, { draft: keyingDraft, onChange: (patch) => { const next = { ...keyingDraft, ...patch }; setKeyingDraft(next); void saveJob({ keying: patch }); } }), h(UploadBox, { label: "上传一张已有图片，直接抠成透明 PNG", accept: "image/*", multiple: false, busy: uploading, onFiles: (files) => void upload(files, "item") })), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, `④ 结果（${(job.items ?? []).length} 张）`)), (job.items ?? []).length === 0
                    ? h("p", { className: "SPR_empty" }, "还没有图片")
                    : h("div", { className: "SPR_grid" }, (job.items ?? []).map((item, index) => h("div", { key: index, className: "SPR_node" }, h("div", { className: "SPR_nodeTop" }, h("span", { className: "SPR_nodeTitle" }, `第 ${index + 1} 张`), h(StatusChip, { node: item }), item.source === "uploaded" ? h(Chip, { kind: "empty", text: "上传" }) : null), item.keyedFile !== undefined
                        ? h("img", { className: "SPR_thumb", src: `${job.assetBase}${item.keyedFile}?v=${item.updatedAt}`, alt: "抠像结果" })
                        : item.file !== undefined
                            ? h("img", { className: "SPR_thumb", src: `${job.assetBase}${item.file}?v=${item.updatedAt}`, alt: "生成结果" })
                            : h("div", { className: "SPR_thumbEmpty" }, item.status === "running" ? "生成中…" : "等待生成"), item.backgroundFraction !== undefined
                        ? h("span", { className: "SPR_refRow" }, `背景占比 ${(item.backgroundFraction * 100).toFixed(0)}%`)
                        : null, item.error !== undefined ? h("p", { className: "SPR_error" }, item.error) : null, h("div", { className: "SPR_btnRow" }, item.keyedFile !== undefined
                        ? h("a", { className: "SPR_btn", href: `${job.assetBase}${item.keyedFile}`, download: `keyed-${index + 1}.png`, style: { textDecoration: "none" } }, "下载 PNG")
                        : null, item.source === "generated"
                        ? h(Btn, { onClick: () => void run(() => api.runImageJob({ jobId: job.id, count: index + 1 }), "已重新生成") }, "重新生成")
                        : null, h(Btn, { danger: true, onClick: () => void run(() => api.removeImageItem({ jobId: job.id, index }), "已删除") }, "删除")))))), renderJobLog(job)))));
        }
        // ── 模块③：序列帧生成 ───────────────────────────────────────────────
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
            const running = job !== null &&
                (job.video?.status === "running" || job.frames?.status === "running" || job.sheet?.status === "running");
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
            const run = async (fn, okText = undefined) => {
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
            /**
             * 启动一个宿主侧「后台任务」（提交视频 / 抽帧 / 抠像 / 合成）。
             * 这些 RPC 是异步启动的——返回时任务状态可能还没落盘，只刷新一次就会
             * 一直停在上一次的结果上（实测：抽帧完成后界面仍显示「还没有序列帧」）。
             * 所以启动后再补几次刷新，直到宿主把 running / ready 写进任务。
             */
            const kickAndWatch = async (fn, okText = undefined) => {
                const id = job.id;
                const value = await run(fn, okText);
                for (const delay of [1200, 3000, 5500, 9000]) {
                    setTimeout(() => {
                        if (jobIdRef.current === id)
                            void load(id);
                    }, delay);
                }
                return value;
            };
            const create = () => run(async () => {
                const created = await api.createSequenceJob({ name: `序列帧 ${new Date().toLocaleString("zh-CN", { hour12: false })}` });
                await refresh();
                setJobId(created.jobId);
            }, "已新建序列帧任务");
            const saveJob = (patch) => run(() => api.saveSequenceJob({ jobId: job.id, ...patch }), undefined);
            const del = async () => {
                if (job === null)
                    return;
                if (typeof window !== "undefined" && !window.confirm(`删除任务「${job.name}」？目录会被整个移除。`))
                    return;
                await run(async () => {
                    await api.deleteSequenceJob({ jobId: job.id });
                    const list = await refresh();
                    setJobId(list.length > 0 ? list[0].id : null);
                    if (list.length === 0)
                        setJob(null);
                }, "已删除");
            };
            const uploadRef = async (files, kind) => {
                setUploading(true);
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
            };
            const frameUrls = React.useMemo(() => {
                if (job === null)
                    return [];
                const list = (job.frames?.keyed ?? []).length > 0 ? job.frames.keyed : job.frames?.files ?? [];
                return list.map((file) => `${job.assetBase}${file}?v=${job.frames?.updatedAt ?? job.updatedAt}`);
            }, [job]);
            return h(React.Fragment, null, h("div", { className: "SPR_body" }, h(JobSidebar, {
                title: "序列帧任务",
                items: jobs,
                activeId: jobId,
                onSelect: setJobId,
                onCreate: create,
                renderMeta: (item) => `${item.videoReady ? "视频✓" : "视频·"} ${item.frameReady ? "帧✓" : "帧·"} ${item.sheetReady ? "合成✓" : "合成·"}`
            }), h("div", { className: "SPR_main" }, notice !== null
                ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text, h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, "关闭")))
                : null, h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: create, primary: true }, "新建任务"), job !== null ? h(Btn, { onClick: del, danger: true }, "删除任务") : null), job === null
                ? h("p", { className: "SPR_empty" }, "请选择或新建一个序列帧任务")
                : h(React.Fragment, null, h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, "① 视频输入")), h("p", { className: "SPR_hint" }, "平台规定两种模式互斥：首尾帧模式以一张图作为起始画面；多模态参考模式用参考图+参考视频来约束风格与动作。"), h("div", { className: "SPR_toolbar" }, h("select", {
                    className: "SPR_input",
                    style: { width: 260 },
                    value: job.mode,
                    onChange: (event) => void run(() => api.saveSequenceJob({ jobId: job.id, mode: event.target.value }), undefined)
                }, h("option", { value: "frames" }, "首尾帧模式（上传首帧图）"), h("option", { value: "reference" }, "多模态参考模式（参考图 / 参考视频）"))), job.mode === "frames"
                    ? h(React.Fragment, null, h("span", { className: "SPR_fieldLabel" }, "首帧图（必填）"), h(RefRow, { job, frame: job.refs.firstFrame, kind: "firstFrame", api, reload: load, setNotice }), h("span", { className: "SPR_fieldLabel" }, "尾帧图（选填）"), h(RefRow, { job, frame: job.refs.lastFrame, kind: "lastFrame", api, reload: load, setNotice }), h(UploadBox, { label: "把首帧图拖到这里", accept: "image/*", busy: uploading, onFiles: (files) => void uploadRef(files, "firstFrame") }))
                    : h(React.Fragment, null, h("span", { className: "SPR_fieldLabel" }, `参考图（${(job.refs.referenceImages ?? []).length}/9）`), h("div", { className: "SPR_grid" }, (job.refs.referenceImages ?? []).map((ref) => h("div", { key: ref.file, className: "SPR_node" }, h("img", { className: "SPR_thumb", src: `${job.assetBase}${ref.file}?v=${job.updatedAt}`, alt: ref.name }), h("div", { className: "SPR_btnRow" }, h(Btn, { danger: true, onClick: () => void run(() => api.removeSequenceRef({ jobId: job.id, kind: "referenceImage", file: ref.file }), "已移除") }, "移除"))))), h(UploadBox, { label: "把参考图拖到这里", accept: "image/*", multiple: true, busy: uploading, onFiles: (files) => void uploadRef(files, "referenceImage") }), h("span", { className: "SPR_fieldLabel" }, `参考视频（${(job.refs.referenceVideos ?? []).length}/3，每段 2~15 秒，单文件 ≤ 40MB）`), h("div", { className: "SPR_toolbar" }, (job.refs.referenceVideos ?? []).map((ref) => h(Btn, { key: ref.file, danger: true, onClick: () => void run(() => api.removeSequenceRef({ jobId: job.id, kind: "referenceVideo", file: ref.file }), "已移除") }, `移除 ${ref.name}`))), h(UploadBox, { label: "把参考视频拖到这里", accept: "video/*", multiple: true, busy: uploading, onFiles: (files) => void uploadRef(files, "referenceVideo") }))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, "② 提示词与参数")), h("textarea", {
                    className: "SPR_area",
                    value: promptDraft,
                    onChange: (event) => setPromptDraft(event.target.value),
                    onBlur: () => { if (promptDraft !== (job.prompt ?? ""))
                        void saveJob({ prompt: promptDraft }); }
                }), h("textarea", {
                    className: "SPR_area",
                    style: { minHeight: 60 },
                    placeholder: "统一附加提示词（可留空）",
                    value: suffixDraft,
                    onChange: (event) => setSuffixDraft(event.target.value),
                    onBlur: () => { if (suffixDraft !== (job.suffix ?? ""))
                        void saveJob({ suffix: suffixDraft }); }
                }), h("div", { className: "SPR_fields" }, h(GlobalModelField, { label: "视频模型", value: effectiveModel }), h(NumField, { label: `时长（秒，${modelCaps.durationMin}~${modelCaps.durationMax}）`, value: settingsDraft.duration ?? 5, min: modelCaps.durationMin, max: modelCaps.durationMax, onChange: (v) => { setSettingsDraft({ ...settingsDraft, duration: v }); void saveJob({ settings: { ...settingsDraft, duration: v } }); } }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "分辨率"), h("select", { className: "SPR_input", value: effectiveResolution, onChange: (event) => { setSettingsDraft({ ...settingsDraft, resolution: event.target.value }); void saveJob({ settings: { ...settingsDraft, resolution: event.target.value } }); } }, modelCaps.resolutions.map((value) => h("option", { key: value, value }, value))))), h("div", { className: "SPR_toolbar" }, h(Btn, {
                    primary: true,
                    disabled: promptDraft.trim() === "",
                    onClick: () => void kickAndWatch(() => api.runSequenceVideo({ jobId: job.id }), "已提交视频任务，可离开本页")
                }, job.video?.status === "ready" ? "重新生成视频" : "生成视频"), h(Btn, { onClick: () => void run(() => api.pollSequenceVideo({ jobId: job.id })) }, "立即刷新进度"), h(Btn, { danger: true, onClick: () => void run(() => api.clearSequenceVideo({ jobId: job.id }), "已清空视频与帧") }, "清空视频重来"), h("span", { className: "SPR_refRow" }, "H3 768P 按 0.5 元/秒刊例计费")), h("div", { className: "SPR_toolbar" }, h("span", { className: "SPR_refRow" }, `状态：${job.video?.status ?? "empty"} ${job.video?.remoteStatus ?? ""} ${job.video?.error ?? ""}`)), job.video?.file !== undefined
                    ? h("video", { className: "SPR_video", src: `${job.assetBase}${job.video.file}?v=${job.video.updatedAt}`, controls: true, preload: "metadata" })
                    : null), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, "③ 序列帧提取")), h("div", { className: "SPR_fields" }, h(NumField, { label: "提取张数", value: settingsDraft.frameCount ?? 8, min: 1, max: 64, onChange: (v) => { setSettingsDraft({ ...settingsDraft, frameCount: v }); void saveJob({ settings: { ...settingsDraft, frameCount: v } }); } }), h(NumField, { label: "抽帧工作尺寸（长边 px）", value: settingsDraft.longEdge ?? 768, min: 128, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, longEdge: v }); void saveJob({ settings: { ...settingsDraft, longEdge: v } }); } }), h(NumField, { label: "单格宽（px）", value: settingsDraft.cellWidth ?? 256, min: 16, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, cellWidth: v }); void saveJob({ settings: { ...settingsDraft, cellWidth: v } }); } }), h(NumField, { label: "单格高（px）", value: settingsDraft.cellHeight ?? 256, min: 16, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, cellHeight: v }); void saveJob({ settings: { ...settingsDraft, cellHeight: v } }); } }), h(NumField, { label: "像素块边长（0/1 = 关闭）", value: settingsDraft.pixelSize ?? 0, min: 0, max: 32, onChange: (v) => { setSettingsDraft({ ...settingsDraft, pixelSize: v }); void saveJob({ settings: { ...settingsDraft, pixelSize: v } }); } })), h("div", { className: "SPR_toolbar" }, h(Btn, { primary: true, disabled: job.video?.file === undefined, onClick: () => void kickAndWatch(() => api.runSequenceFrames({ jobId: job.id }), "已开始抽帧") }, `按当前张数抽帧（${settingsDraft.frameCount ?? 8} 张）`), job.frames?.stale === true ? h(Chip, { kind: "stale", text: "参数已变，需重抽" }) : null, h("span", { className: "SPR_refRow" }, job.frames?.duration !== undefined ? `视频时长 ${job.frames.duration.toFixed(2)} 秒 · ${job.frames.files.length} 帧` : ""))), h("div", { className: "SPR_card" }, h("div", { className: "SPR_cardHead" }, h("h3", null, "④ 绿幕抠像与合成")), h(KeyingFields, { draft: keyingDraft, onChange: (patch) => { const next = { ...keyingDraft, ...patch }; setKeyingDraft(next); void saveJob({ keying: patch }); } }), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => void kickAndWatch(() => api.keySequenceFrames({ jobId: job.id }), "已开始重新抠像") }, "重新抠像"), h(Btn, { onClick: () => void kickAndWatch(() => api.composeSequence({ jobId: job.id }), "已合成") }, "合成横向条图"), job.sheet?.file !== undefined
                    ? h("a", { className: "SPR_btn", href: `${job.assetBase}${job.sheet.file}?v=${job.sheet.updatedAt}`, download: `${job.name}-strip.png`, style: { textDecoration: "none" } }, "下载条图")
                    : null), frameUrls.length === 0
                    ? h("p", { className: "SPR_empty" }, "还没有序列帧")
                    : h(SequencePlayer, { urls: frameUrls }), job.sheet?.file !== undefined
                    ? h("div", { className: "SPR_sheetWrap" }, h("img", { className: "SPR_sheet", src: `${job.assetBase}${job.sheet.file}?v=${job.sheet.updatedAt}`, alt: "序列帧条图" }))
                    : null, frameUrls.length === 0
                    ? null
                    : h("div", { className: "SPR_frames" }, frameUrls.map((url, index) => h("img", { key: index, className: "SPR_frame", src: url, alt: `第 ${index + 1} 帧` })))), renderJobLog(job)))));
        }
        /** 单张参考图/首尾帧的展示行。 */
        function RefRow(props) {
            // ⚠️ 这里的 prop 不能叫 `ref`：React 会把名为 ref 的 prop 特殊处理（不进 props），
            // 函数组件里 `props.ref` 恒为 undefined，界面就会永远显示「未上传」——
            // 看起来像「选了图没反应」，实测踩过。
            const { job, frame, kind, api, reload, setNotice } = props;
            if (frame === undefined)
                return h("span", { className: "SPR_refRow" }, "未上传");
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
            }, "移除"));
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
            return h(React.Fragment, null, h("div", { className: "SPR_fields" }, h(NumField, { label: "播放帧率（fps）", value: fps, min: 1, max: 30, onChange: setFps }), h(NumField, { label: "预览缩放", value: scale, min: 0.2, max: 2, step: 0.1, onChange: setScale }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "播放"), h("select", { className: "SPR_input", value: playing ? "on" : "off", onChange: (event) => setPlaying(event.target.value === "on") }, h("option", { value: "on" }, "播放中"), h("option", { value: "off" }, "暂停")))), h("p", { className: "SPR_hint" }, `已载入 ${loaded}/${urls.length} 帧。这是抠像后的帧按顺序循环播放的效果，用来判断动作连贯性和抠像边缘是否稳定。`), h("div", { className: "SPR_player" }, h("canvas", { ref: canvasRef, className: "SPR_canvasPlayer" })));
        }
        /** 任务日志（三个模块共用的样式）。 */
        function renderJobLog(job) {
            const entries = Array.isArray(job?.log) ? job.log.slice(-40).reverse() : [];
            if (entries.length === 0)
                return null;
            return h("div", { className: "SPR_log" }, h("span", { className: "SPR_fieldLabel" }, "运行日志"), h("ul", { className: "SPR_logList" }, entries.map((entry, index) => h("li", { key: index, "data-level": entry.level }, h("span", { className: "SPR_logTime" }, new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })), h("span", null, entry.message)))));
        }
        function renderLog(project) {
            const entries = Array.isArray(project.log) ? project.log.slice(-40).reverse() : [];
            if (entries.length === 0)
                return null;
            return h("div", { className: "SPR_log" }, h("span", { className: "SPR_fieldLabel" }, "运行日志"), h("ul", { className: "SPR_logList" }, entries.map((entry, index) => h("li", { key: index, "data-level": entry.level }, h("span", { className: "SPR_logTime" }, new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })), h("span", null, entry.message)))));
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
                if (api === undefined)
                    return;
                try {
                    setConfig(await api.getConfig());
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
            return h("section", { className: "SPR_settings" }, h("h2", { style: { margin: 0, fontSize: 15 } }, "游戏素材大师"), h("p", { className: "SPR_hint" }, "配置两家模型的 API Key 与整条流水线的默认参数。Key 只保存在本机 DSH 数据目录下的 game-material-master/config.json（真实路径见文末「数据位置」），界面里始终脱敏显示。"), notice !== null
                ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text)
                : null, h("div", { className: "SPR_settingsGroup" }, h("h3", null, "火山方舟（生图）"), h("p", null, config.ffmpeg?.ok === true ? `ffmpeg 可用：${config.ffmpeg.version}` : `ffmpeg 不可用：${config.ffmpeg?.error ?? "未知"}`), h("div", { className: "SPR_keyRow" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, `API Key ${config.arkApiKeySet ? `（已配置 ${config.arkApiKeyHint}）` : "（未配置）"}`), h("input", {
                className: "SPR_input",
                type: "password",
                placeholder: config.arkApiKeySet ? "留空表示不修改" : "粘贴 ARK_API_KEY",
                value: arkKey,
                onChange: (event) => setArkKey(event.target.value)
            })), h(Btn, { onClick: () => run(async () => { await api.saveConfig({ arkApiKey: arkKey }); setArkKey(""); }, "火山方舟 Key 已保存") }, "保存 Key"), h(Btn, { disabled: !config.arkApiKeySet, onClick: () => run(() => api.saveConfig({ clearArkApiKey: true }), "已清除火山方舟 Key") }, "清除")), h("div", { className: "SPR_fields" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "生图模型"), h("select", {
                className: "SPR_input",
                value: config.arkModel,
                onChange: (event) => void patch({ arkModel: event.target.value })
            }, (config.arkModels ?? []).map((model) => h("option", { key: model.id, value: model.id }, `${model.label}（${model.id}）`)), (config.arkModels ?? []).some((model) => model.id === config.arkModel)
                ? null
                : h("option", { value: config.arkModel }, `自定义：${config.arkModel}`))), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "输出尺寸"), h("input", {
                className: "SPR_input",
                value: config.arkSize,
                onChange: (event) => void patch({ arkSize: event.target.value })
            })), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "Base URL"), h("input", {
                className: "SPR_input",
                value: config.arkBaseUrl,
                onChange: (event) => void patch({ arkBaseUrl: event.target.value })
            }))), h("div", { className: "SPR_toolbar" }, h(Btn, {
                disabled: testing !== null || !config.arkApiKeySet,
                onClick: async () => {
                    setTesting("ark");
                    await run(() => api.testArk(), (value) => `连接正常：${value.model} 返回 ${value.bytes} 字节图片`);
                    setTesting(null);
                }
            }, testing === "ark" ? "正在生成测试图…" : "测试连接（会真实生成 1 张 1K 小图，产生少量费用）"))), h("div", { className: "SPR_settingsGroup" }, h("h3", null, "MiniMax（图生视频）"), h("p", null, "视频阶段使用图生视频（I2V）。建议用 MiniMax-Hailuo-02，镜头稳定性最好。"), h("div", { className: "SPR_keyRow" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, `API Key ${config.minimaxApiKeySet ? `（已配置 ${config.minimaxApiKeyHint}）` : "（未配置）"}`), h("input", {
                className: "SPR_input",
                type: "password",
                placeholder: config.minimaxApiKeySet ? "留空表示不修改" : "粘贴 MiniMax API Key",
                value: minimaxKey,
                onChange: (event) => setMinimaxKey(event.target.value)
            })), h(Btn, { onClick: () => run(async () => { await api.saveConfig({ minimaxApiKey: minimaxKey }); setMinimaxKey(""); }, "MiniMax Key 已保存") }, "保存 Key"), h(Btn, { disabled: !config.minimaxApiKeySet, onClick: () => run(() => api.saveConfig({ clearMinimaxApiKey: true }), "已清除 MiniMax Key") }, "清除")), h("div", { className: "SPR_fields" }, h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "视频模型"), h("select", {
                className: "SPR_input",
                value: config.minimaxModel,
                onChange: (event) => onModelChange(event.target.value)
            }, (config.minimaxModels ?? []).map((model) => h("option", { key: model.id, value: model.id }, `${model.label}（${model.id}）`)), (config.minimaxModels ?? []).some((model) => model.id === config.minimaxModel)
                ? null
                : h("option", { value: config.minimaxModel }, `自定义：${config.minimaxModel}`))), 
            // 时长控件随模型切换：Hailuo 是 6/10 两档，H3 是 4~15 连续区间。
            minimaxCaps.durations !== undefined
                ? h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "时长（秒）"), h("select", {
                    className: "SPR_input",
                    value: config.minimaxDuration,
                    onChange: (event) => void patch({ minimaxDuration: Number(event.target.value) })
                }, minimaxCaps.durations.map((seconds) => h("option", { key: seconds, value: seconds }, `${seconds} 秒`))))
                : h(NumField, {
                    label: `时长（秒，${minimaxCaps.durationMin}~${minimaxCaps.durationMax}）`,
                    value: config.minimaxDuration,
                    min: minimaxCaps.durationMin,
                    max: minimaxCaps.durationMax,
                    onChange: (value) => void patch({ minimaxDuration: value })
                }), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, "分辨率"), h("select", {
                className: "SPR_input",
                value: config.minimaxResolution,
                onChange: (event) => void patch({ minimaxResolution: event.target.value })
            }, minimaxCaps.resolutions.map((value) => h("option", { key: value, value }, value)))), h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, usingCompshare
                ? "Base URL（优云智算版 H3 固定使用，无需修改）"
                : "Base URL（主机根，不含 /v1、/v2）"), h("input", {
                className: "SPR_input",
                list: "SPR_minimax_hosts",
                value: config.minimaxBaseUrl,
                disabled: usingCompshare,
                onChange: (event) => void patch({ minimaxBaseUrl: event.target.value })
            }), h("datalist", { id: "SPR_minimax_hosts" }, (config.minimaxHosts ?? []).map((host) => h("option", { key: host.id, value: host.id }, host.label))), h("span", { className: "SPR_fieldLabel" }, `当前协议：${minimaxCaps.protocol === "v2" ? `v2（${config.minimaxPathPrefix ?? ""}/v2/video_generation）` : `v1（${config.minimaxPathPrefix ?? ""}/v1/video_generation）`}`))), h("div", { className: "SPR_toolbar" }, h(Btn, {
                disabled: testing !== null || !config.minimaxApiKeySet,
                onClick: async () => {
                    setTesting("minimax");
                    await run(() => api.testMinimax(), (value) => `连接正常：${value.model}`);
                    setTesting(null);
                }
            }, testing === "minimax" ? "正在校验…" : "测试连接（只校验 Key，不产生费用）"))), h("div", { className: "SPR_settingsGroup" }, h("h3", null, "新建项目的默认参数"), h("p", null, "这些值会成为每个新项目的初始设置，之后可在项目里单独调整。"), h("div", { className: "SPR_fields" }, h(NumField, {
                label: "单格宽（px）",
                value: config.cellWidth,
                min: 16,
                max: 2048,
                onChange: (value) => void patch({ cellWidth: value })
            }), h(NumField, {
                label: "单格高（px）",
                value: config.cellHeight,
                min: 16,
                max: 2048,
                onChange: (value) => void patch({ cellHeight: value })
            }), h(NumField, {
                label: "每段视频抽帧数",
                value: config.frameCount,
                min: 1,
                max: 64,
                onChange: (value) => void patch({ frameCount: value })
            }), h(NumField, {
                label: "并发数",
                value: config.concurrency,
                min: 1,
                max: 8,
                onChange: (value) => void patch({ concurrency: value })
            }), h(NumField, {
                label: "抠像下限",
                value: config.keyLow,
                min: 0,
                max: 255,
                onChange: (value) => void patch({ keyLow: value })
            }), h(NumField, {
                label: "抠像上限",
                value: config.keyHigh,
                min: 1,
                max: 255,
                onChange: (value) => void patch({ keyHigh: value })
            }), h(NumField, {
                label: "去绿溢出",
                value: config.despill,
                min: 0,
                max: 1,
                step: 0.05,
                onChange: (value) => void patch({ despill: value })
            }), h(NumField, {
                label: "边缘收缩（px）",
                value: config.edgeShrink,
                min: 0,
                max: 8,
                onChange: (value) => void patch({ edgeShrink: value })
            }), h(NumField, {
                label: "背景分割容差（0 = 只认绿色）",
                value: config.bgTolerance,
                min: 0,
                max: 160,
                onChange: (value) => void patch({ bgTolerance: value })
            }), h(NumField, {
                label: "抽帧工作尺寸（长边 px）",
                value: config.workingLongEdge,
                min: 128,
                max: 2048,
                onChange: (value) => void patch({ workingLongEdge: value })
            }), h(NumField, {
                label: "像素块边长（0/1 = 关闭）",
                value: config.pixelSize,
                min: 0,
                max: 32,
                onChange: (value) => void patch({ pixelSize: value })
            }), h(NumField, {
                label: "自动裁剪填充比例",
                value: config.fillRatio,
                min: 0.5,
                max: 1,
                step: 0.02,
                onChange: (value) => void patch({ fillRatio: value })
            }), h(NumField, {
                label: "底部留白（px）",
                value: config.bottomMargin,
                min: 0,
                max: 64,
                onChange: (value) => void patch({ bottomMargin: value })
            }))), h("div", { className: "SPR_settingsGroup" }, h("h3", null, "数据位置"), h("p", null, "所有项目（源图、绿幕图、视频、序列帧、整图）都保存在：", h("code", null, config.dataRoot)), h("div", { className: "SPR_toolbar" }, h(Btn, { onClick: () => void run(() => api.saveConfig({}), "已刷新") }, "重新读取配置"))));
        }
        // ── cordis 插件体 ────────────────────────────────────────────────────
        const inject = ["slots", "remote"];
        function apply(ctx) {
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
                    throw new Error("gameStudio 远程服务不可用，请确认插件已启用");
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
                composeSequence: (payload) => call("composeSequence", payload)
            };
            // 侧栏全局面板图标；id 与 main 的 key 必须一致，点击即切到工作台。
            ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
                name: "sidebar.panellist",
                id: "gameStudio",
                order: 40,
                label: () => "游戏素材大师"
            }, StudioGlyph));
            ctx.slots.inject("main", () => ctx.slots.register({
                name: "main",
                key: "gameStudio",
                inject: () => ({ api })
            }, StudioPanel));
            ctx.slots.inject("settings.section", () => ctx.slots.register({
                name: "settings.section",
                id: "gameStudio",
                order: 18,
                label: () => "游戏素材大师",
                inject: () => ({ api })
            }, ConfigSection));
        }
        bundleModule.exports.apply = apply;
        bundleModule.exports.inject = inject;
        bundleModule.exports.GAME_STUDIO_PANEL_ID = "gameStudio";
        return bundleModule.exports;
    }
});
