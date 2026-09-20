/**
 * 会话 → 界面的深链接（deep link）。
 *
 * 模型在回复里贴给用户一条 Markdown 超链接，用户点一下就把 Web GUI 切到
 * 「游戏素材大师」工作台，并直接落到对应的模块 / 项目 / 阶段上验收。
 *
 * 链接形态（故意做成普通 http(s) URL，理由见下）：
 *
 *   http://127.0.0.1:43120/?dsh-gmm=1&module=sprite&project=p1234&stage=videos
 *
 * 为什么必须是 http(s)：
 * 会话正文的 Markdown 渲染器对链接做了协议白名单（只放行 http/https/mailto，
 * 见 dsh-client-ui-primitives 的 sanitizeUrl），自定义 scheme 会被丢掉、
 * 连 <a> 都不生成，模型写了也点不动。
 *
 * 为什么带 origin：
 * 浏览器半区在 apply 时把自己真实的 `location.origin` 报给宿主（reportClientOrigin），
 * 宿主据此拼出可点链接。宿主自己并不知道对外 origin（可能被反代改写过）。
 * 没收到过上报时退化成 http://localhost —— 即使 origin 不对也没关系：
 * 浏览器半区装了一个捕获阶段的点击拦截器，只按 **路径与查询参数** 匹配，
 * 命中就 preventDefault 并原地切面板，根本不会发生跳转。
 *
 * 兜底：用户若用中键 / Ctrl+点击 强制新开标签页，链接会真的被浏览器打开，
 * 应用在 `/?dsh-gmm=…` 上正常启动，浏览器半区读取查询参数完成同样的切换。
 * 两条路径共用同一份 `OpenIntent`，所以行为一致。
 */
/** 深链接的查询参数名。浏览器半区（src/client.ts）里有一份同名常量，改动要同步。 */
export const OPEN_QUERY_KEY = "dsh-gmm";
/** 工作台在 `main` 槽里的 key，也是侧栏 `sidebar.panellist` 的 id。 */
export const PANEL_KEY = "gameStudio";
/** 三个模块的 key。 */
export const STUDIO_MODULES = ["sprite", "image", "sequence"];
/** 八方向图的四个阶段。 */
export const SPRITE_STAGES = ["images", "videos", "frames", "sheet"];
let clientOrigin = "";
/** 浏览器半区上报真实 origin。只接受 http(s)，其它一律忽略。 */
export function rememberClientOrigin(origin) {
    if (typeof origin !== "string")
        return false;
    let parsed;
    try {
        parsed = new URL(origin);
    }
    catch {
        return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return false;
    clientOrigin = parsed.origin;
    return true;
}
/** 已上报的 origin；没有就返回空串。 */
export function clientOriginOf() {
    return clientOrigin;
}
/**
 * 拼链接用的 origin。
 *
 * 没收到上报时给 `http://localhost`：这个值只影响「链接看起来像什么」，
 * 点击仍然由浏览器半区的拦截器按路径匹配处理，所以错也无害。
 */
export function originForLinks() {
    return clientOrigin === "" ? "http://localhost" : clientOrigin;
}
/** 只保留有意义的字段，保证同一次意图生成同一条链接（便于断言与去重）。 */
export function normalizeIntent(intent) {
    const out = {};
    if (intent === undefined)
        return out;
    if (intent.module !== undefined && STUDIO_MODULES.includes(intent.module)) {
        out.module = intent.module;
    }
    if (typeof intent.projectId === "string" && intent.projectId !== "")
        out.projectId = intent.projectId;
    if (typeof intent.jobId === "string" && intent.jobId !== "")
        out.jobId = intent.jobId;
    if (typeof intent.stage === "string" && intent.stage !== "")
        out.stage = intent.stage;
    if (typeof intent.direction === "string" && intent.direction !== "")
        out.direction = intent.direction;
    return out;
}
/** 意图 → 查询串（不含 `?`）。 */
export function intentQuery(intent) {
    const normalized = normalizeIntent(intent);
    const params = new URLSearchParams();
    params.set(OPEN_QUERY_KEY, "1");
    for (const key of ["module", "project", "job", "stage", "direction"]) {
        const value = key === "project" ? normalized.projectId : key === "job" ? normalized.jobId : normalized[key];
        if (value !== undefined)
            params.set(key, value);
    }
    return params.toString();
}
/** 拼出可点击的绝对链接。 */
export function buildOpenLink(intent, origin = originForLinks()) {
    return `${origin}/?${intentQuery(intent)}`;
}
/**
 * 解析查询串回意图。宿主侧只用于自检与测试——浏览器半区另有一份等价实现
 * （client.ts 是经典脚本，不能 import），两边靠 scripts/verify-tools.mjs 的
 * 文本契约钉住同名参数。
 */
export function parseIntentQuery(query) {
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    if (params.get(OPEN_QUERY_KEY) === null)
        return undefined;
    const intent = {};
    const module = params.get("module");
    if (module !== null && STUDIO_MODULES.includes(module))
        intent.module = module;
    const projectId = params.get("project");
    if (projectId !== null)
        intent.projectId = projectId;
    const jobId = params.get("job");
    if (jobId !== null)
        intent.jobId = jobId;
    const stage = params.get("stage");
    if (stage !== null)
        intent.stage = stage;
    const direction = params.get("direction");
    if (direction !== null)
        intent.direction = direction;
    return normalizeIntent(intent);
}
