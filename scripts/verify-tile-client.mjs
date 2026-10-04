/**
 * 地图地块模块 · 浏览器半区真渲染自检。
 *
 * 沿用 `verify-feedback.mjs` 的思路：把 `lib/client.js` **真的加载起来**，
 * 用假 React（Hook 按槽位取值）与假 `__ModuleLoader__` 抓住插件体，
 * 然后把 `TileModule` 真渲染出来断言元素树。
 *
 * 为什么要有它：`verify-client.mjs` 只是**读文本**做契约检查，
 * 组件里写成 `project.map.rows`（`map` 是 undefined）这类问题它一条都抓不到 ——
 * 那只有在真渲染时才会抛 `TypeError`，而用户那边表现为「点了模块⑤白屏」。
 *
 * 重点覆盖：
 *   · 五个阶段都能渲染，不抛异常
 *   · 没选项目时给空态，不崩
 *   · 有任务在跑时**遮罩必须出现**，并且**还没轮到的格子要显示「排队中」**
 *     （不盖遮罩时界面看着完全正常，只是「点了没反应」，用户会反复点 —— 每次都真实计费）
 *   · 几何角标：量准了显示比例，回退模板几何要显示「模板几何」警告
 *   · 空闲时一个遮罩都不能有
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = process.argv[2] ?? fileURLToPath(new URL("../lib/client.js", import.meta.url));

let checks = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) checks++;
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── 假 React：createElement 产出纯对象，Hook 按槽位取值 ──────────────────
const HOOK = { slots: [], cursor: 0 };

const ReactStub = {
  Fragment: Symbol.for("react.fragment"),
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children };
  },
  useState(initial) {
    const index = HOOK.cursor++;
    if (process.env.TRACE_HOOKS === "1") {
      console.log(`  hook #${index} = ${JSON.stringify(HOOK.slots[index])?.slice(0, 60)}`);
    }
    const value = HOOK.slots[index];
    return [value === undefined ? (typeof initial === "function" ? initial() : initial) : value, () => {}];
  },
  useRef(initial) {
    const index = HOOK.cursor++;
    if (process.env.TRACE_HOOKS === "1") console.log(`  useRef #${index}`);
    return { current: initial };
  },
  useEffect() {},
  useLayoutEffect() {},
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
  useContext() {
    return undefined;
  }
};

// ── 加载产物 ─────────────────────────────────────────────────────────────
const source = readFileSync(target, "utf8");
const LOADED = [];
const windowStub = {
  __ModuleLoader__: {
    load(registration) {
      LOADED.push(registration);
    }
  },
  location: { origin: "http://127.0.0.1:19387", search: "", href: "http://127.0.0.1:19387/" },
  history: {
    replaceState(_state, _title, url) {
      const next = new URL(url, windowStub.location.href);
      windowStub.location.href = next.toString();
      windowStub.location.search = next.search;
    }
  },
  setTimeout: (fn) => {
    fn();
    return 0;
  },
  addEventListener() {},
  removeEventListener() {}
};
const CLICK_LISTENERS = [];
globalThis.document = {
  head: { appendChild() {}, removeChild() {} },
  createElement: () => ({ setAttribute() {}, remove() {}, style: {}, textContent: "" }),
  addEventListener(type, listener) {
    if (type === "click") CLICK_LISTENERS.push(listener);
  },
  removeEventListener(type, listener) {
    const index = CLICK_LISTENERS.indexOf(listener);
    if (index >= 0) CLICK_LISTENERS.splice(index, 1);
  }
};
// 定时器：TileModule 在跑任务时会 setInterval 轮询
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

function report() {
  console.log("");
  console.log(`共 ${checks} 项检查，失败 ${failures.length} 项${failures.length === 0 ? "。" : "：" + failures.join("、")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

try {
  new Function("window", "require", source)(windowStub, (name) => {
    if (name === "react") return ReactStub;
    throw new Error(`未预期的 require(${name})`);
  });
} catch (error) {
  check("浏览器束可加载", false, String(error?.message ?? error));
  report();
}
check("浏览器束可加载", true);
check("注册了唯一插件体", LOADED.length === 1, `${LOADED.length} 个 load()`);
if (LOADED.length !== 1) report();

let bundle;
try {
  bundle = LOADED[0].factory((name) => {
    if (name === "react") return ReactStub;
    throw new Error(`未预期的 require(${name})`);
  });
} catch (error) {
  check("factory 可执行", false, String(error?.message ?? error));
  report();
}
check("factory 可执行", true);

const REGISTERED = {};
const fakeCtx = {
  effect(fn) {
    return fn();
  },
  get(name) {
    if (name === "layout") return { selectPanel() {} };
    return undefined;
  },
  slots: {
    inject(name, fn) {
      return fn();
    },
    register(options, component) {
      REGISTERED[options.name] = component;
      return () => {};
    }
  },
  remote: { $mount: () => Promise.resolve() }
};
try {
  bundle.apply(fakeCtx);
} catch (error) {
  check("apply 可执行", false, String(error?.message ?? error));
  report();
}
check("apply 可执行", true);

const { TileModule } = bundle.__test ?? {};
check("产物带出 TileModule（__test 把手）", typeof TileModule === "function", typeof TileModule);
if (typeof TileModule !== "function") report();

// ── 元素树工具 ───────────────────────────────────────────────────────────
function collect(node, predicate, out = [], seen = new Set()) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out, seen);
    return out;
  }
  if (seen.has(node)) return out;
  seen.add(node);
  if (predicate(node)) out.push(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) collect(child, predicate, out, seen);
  }
  for (const value of Object.values(node.props ?? {})) {
    if (value !== null && typeof value === "object") collect(value, predicate, out, seen);
  }
  if (typeof node.type === "function") {
    const children = Array.isArray(node.children)
      ? node.children.filter((child) => child !== null && child !== undefined)
      : [];
    const props = { ...(node.props ?? {}) };
    if (children.length === 1) props.children = children[0];
    else if (children.length > 1) props.children = children;
    collect(node.type(props), predicate, out, seen);
  }
  return out;
}
const byClass = (tree, className) => collect(tree, (node) => node.props?.className === className);
/**
 * 按「类名里含有一段」匹配。
 *
 * 组件里的类名经常是拼出来的（`` `SPR_step${stage === key ? " SPR_step-active" : ""}` ``），
 * 用全等匹配会一个都找不到 —— 于是断言失败，而界面其实是好的。
 */
const byClassPart = (tree, part) =>
  collect(tree, (node) => typeof node.props?.className === "string" && node.props.className.split(/\s+/).includes(part));
// 遮罩也要用「含有一段」匹配：LoadingOverlay 渲染出的类名是 `SPR_ovl` 加拼接后缀，
// 全等匹配会数到 0 个 —— 那会让「有任务在跑时遮罩出现了吗」这条断言假失败，
// 而界面其实是对的。假失败比没有断言更糟：它会让人去改没坏的东西。
const overlays = (tree) => byClassPart(tree, "SPR_ovl");
const textOf = (node) => {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.children ?? []);
};
const overlayText = (tree) => overlays(tree).map(textOf).join(" | ");
const allText = (tree) => textOf(tree);
const byType = (tree, type) => collect(tree, (node) => node.type === type);

// ── 假 API：所有调用都记下来，断言「点了真的调了对应方法」 ────────────────
const CALLS = [];
function makeApi(overrides = {}) {
  const record = (name) => (payload) => {
    CALLS.push({ name, payload });
    return Promise.resolve(overrides[name] ?? { ok: true });
  };
  return {
    listTileProjects: record("listTileProjects"),
    createTileProject: record("createTileProject"),
    getTileProject: record("getTileProject"),
    deleteTileProject: record("deleteTileProject"),
    saveTileProject: record("saveTileProject"),
    runTileTemplate: record("runTileTemplate"),
    runTileItems: record("runTileItems"),
    runTileItem: record("runTileItem"),
    setTileApproved: record("setTileApproved"),
    runTileMap: record("runTileMap"),
    saveTileMapCells: record("saveTileMapCells"),
    runTileExport: record("runTileExport"),
    cancelTileJob: record("cancelTileJob"),
    revealTileProject: record("revealTileProject")
  };
}
const api = makeApi();

/** 与 `usePendingTasks()` 的返回面一致。 */
function makeTasks(activeKeys = []) {
  const map = {};
  for (const key of activeKeys) map[key] = key;
  return {
    map,
    run: (key, label, fn) => fn(),
    has: (key) => map[key] !== undefined,
    label: (key) => map[key],
    any: (prefix) => Object.keys(map).some((key) => key.startsWith(prefix)),
    keys: (prefix) => Object.keys(map).filter((key) => key.startsWith(prefix)),
    active: Object.keys(map).length > 0,
    firstLabel: Object.values(map)[0]
  };
}

const SETTINGS = { cellWidth: 64, cellHeight: 96 };
const TILE_KEYS = ["template", "generate", "review", "map", "export"];

function makeItem(overrides = {}) {
  return {
    key: "grass",
    label: "草地",
    kind: "terrain",
    family: "grass",
    footprint: [1, 1],
    content: "鲜绿色的短草地。",
    mode: "template",
    variantCount: 2,
    variants: [
      { index: 0, cell: "cell/grass.v1.png", report: { mode: "measured", ratioMeasured: 2.0021, scale: [0.03, 0.03] }, approved: true },
      { index: 1, cell: "cell/grass.v2.png", report: { mode: "template", fallbackReason: "测量不可信", scale: [0.03, 0.03] } }
    ],
    ...overrides
  };
}

function makeProject(overrides = {}) {
  return {
    id: "tabc123",
    name: "测试地图",
    assetBase: "/dsh-game-material-master/tile-assets/tabc123/",
    style: "像素画风，色彩明快饱和。",
    settings: SETTINGS,
    createdAt: "2026-10-04T00:00:00.000Z",
    updatedAt: "2026-10-04T01:00:00.000Z",
    items: [makeItem()],
    // map 只用宿主**真实会发**的字段。曾经这里多写了一个 `ready: true`，
    // 于是「地图预览」那条断言在界面读 `map.ready` 时依然通过 ——
    // 而真机上宿主从不发 `ready`，拼好的地图永远不显示、界面一直停在
    // 「还没有拼图」。夹具比宿主「更宽容」会让测试变成假绿，
    // 所以这里刻意只放 rows / cols / seed / cells / decor / buildings / png / json。
    map: { rows: 14, cols: 14, seed: 20261004, cells: [], decor: {}, buildings: [], png: "map/map.png", json: "map/map.json" },
    stages: {
      template: { status: "done" },
      generate: { status: "done" },
      review: { status: "idle" },
      map: { status: "done" },
      export: { status: "idle" }
    },
    job: null,
    progress: { generated: 2, expected: 2, approved: 1 },
    logs: [],
    ...overrides
  };
}

/**
 * 按 Hook 顺序渲染 TileModule。
 *
 * ⚠️ 槽位表必须与组件里 Hook 的**调用顺序与个数**严格一致，
 * 错位不会报错，只会把 `stage` 读成别的值 —— 于是断言看着通过、其实测的是别的状态。
 * 这里用一条断言把个数钉住（见下面的「Hook 槽位」）。
 */
// 23 = useLocaleTick(1) + 组件自身 18 个 useState + usePendingTasks(useState + 2×useRef)
//      + useStudioIntent(useState)。effect / callback 不占状态槽。
// **新增状态时这个数字必须跟着改** —— 它是「槽位没串位」的唯一护栏。
const EXPECTED_HOOKS = 23;
function renderTile(project, options = {}) {
  const { projects = [], stage = "template", styleDraft, nameDraft, ...drafts } = options;
  HOOK.slots = [
    0,                        // 0  useLocaleTick
    projects.map((p) => ({ id: p.id, name: p.name, generatedCount: 2, expectedCount: 2 })), // 1 projects
    project === null ? null : project.id, // 2 projectId
    project,                  // 3 project
    null,                     // 4 notice
    stage,                    // 5 stage
    styleDraft ?? (project?.style ?? ""), // 6 styleDraft
    nameDraft ?? (project?.name ?? ""),   // 7 nameDraft
    14,                       // 8  mapRows
    14,                       // 9 mapCols
    20261004,                 // 10 mapSeed
    0.08,                     // 11 decorDensity
    false,                    // 12 creating
    // 13~18：编辑相关草稿（未编辑时全是 null）
    drafts.editingKey ?? null,
    drafts.itemDraft ?? null,
    drafts.newItem ?? null,
    drafts.brushKey ?? null,
    drafts.cellKey ?? null,
    drafts.mapDraft ?? null,
    // 19~22 是 usePendingTasks / useStudioIntent 内部的状态槽，测试没法从外面注入
    undefined, undefined, undefined, undefined
  ];
  HOOK.cursor = 0;
  const tree = TileModule({ api });
  return { tree, hooks: HOOK.cursor };
}

// ═══════════════════════════════════════════════════════════════════════════
section("没选项目时的空态");
// ═══════════════════════════════════════════════════════════════════════════
{
  const { tree, hooks } = renderTile(null, { projects: [makeProject()] });
  check("空态能渲染，不抛异常", tree !== undefined && tree !== null);
  check("Hook 槽位对齐", hooks === EXPECTED_HOOKS, `调用 ${hooks} 个 Hook，期望 ${EXPECTED_HOOKS}`);
  check("空态给出引导文案", allText(tree).includes("还没有地图地块项目"), allText(tree).slice(0, 160));
  check("空态不显示步骤条", byClass(tree, "SPR_steps").length === 0);
  check("空态没有遮罩", overlays(tree).length === 0);
  check("空态仍有「新建项目」按钮", allText(tree).includes("新建项目"));
}

// ═══════════════════════════════════════════════════════════════════════════
section("五个阶段都能渲染（每个都不能白屏）");
// ═══════════════════════════════════════════════════════════════════════════
{
  for (const stage of TILE_KEYS) {
    let tree;
    let error;
    try {
      tree = renderTile(makeProject(), { stage }).tree;
    } catch (caught) {
      error = caught;
    }
    check(`阶段 ${stage} 渲染不抛异常`, error === undefined, error === undefined ? "" : String(error?.message ?? error));
    if (tree === undefined) continue;
    check(`阶段 ${stage} 产出了内容`, allText(tree).length > 20, `${allText(tree).length} 字符`);
    check(`阶段 ${stage} 渲染了 5 个步骤按钮`, byClassPart(tree, "SPR_step").length === 5, `${byClassPart(tree, "SPR_step").length} 个`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section("① 模板阶段");
// ═══════════════════════════════════════════════════════════════════════════
{
  const { tree } = renderTile(makeProject(), { stage: "template" });
  check("有「生成模板（免费）」按钮", allText(tree).includes("生成模板（免费）"));
  check("明确标注不花钱", allText(tree).includes("本地计算，不花钱"));
  const images = byType(tree, "img");
  check("展示两张模板图（单格 + 2×2 网格）", images.length >= 2, `${images.length} 张`);
  check("模板图走 assetBase 相对路径",
    images.some((node) => String(node.props.src).startsWith("/dsh-game-material-master/tile-assets/tabc123/template/")),
    images.map((n) => n.props.src).join(", "));
  check("空闲时没有遮罩", overlays(tree).length === 0, `${overlays(tree).length} 个`);
}

// ═══════════════════════════════════════════════════════════════════════════
section("② 生成阶段：几何角标与排队遮罩");
// ═══════════════════════════════════════════════════════════════════════════
{
  const { tree } = renderTile(makeProject(), { stage: "generate" });
  check("有「生成全部地块」按钮", allText(tree).includes("生成全部地块"));
  check("有「只补没生成的」按钮", allText(tree).includes("只补没生成的"));
  check("提示了计费", allText(tree).includes("一次 Seedream 调用"));
  check("警告改画风会作废已生成的地块", allText(tree).includes("全部作废"));

  // 几何角标：量准了显示 2:1，回退模板几何要显示警告
  const badges = byClassPart(tree, "SPR_tileBadge").map(textOf).filter((t) => t !== "");
  check("量准的地块显示 2:1 比例角标", badges.some((t) => t.includes("2:1")), badges.join(" | "));
  check("回退模板几何的地块显示「模板几何」", badges.some((t) => t.includes("模板几何")), badges.join(" | "));
  const goodBadge = byClassPart(tree, "SPR_tileBadge-ok");
  check("量准的角标用 ok 样式", goodBadge.length >= 1, `${goodBadge.length} 个`);
  const warnBadge = byClassPart(tree, "SPR_tileBadge-warn");
  check("回退的角标用 warn 样式", warnBadge.length >= 1, `${warnBadge.length} 个`);

  // 难度最高的那条：任务在跑时，还没轮到的格子必须显示「排队中」+ 出现遮罩
  const running = makeProject({ job: { projectId: "tabc123", kind: "generate", targets: ["grass#v1", "grass#v2"], done: [], running: "grass#v1", startedAt: Date.now() } });
  const busyTree = renderTile(running, { stage: "generate" }).tree;
  check("有任务在跑时出现遮罩", overlays(busyTree).length >= 1, `${overlays(busyTree).length} 个`);
  check("遮罩文案是「正在生成地块…」", overlayText(busyTree).includes("正在生成地块"), overlayText(busyTree));
  check("显示正在生成哪一张", allText(busyTree).includes("grass#v1"), allText(busyTree).slice(0, 200));
  check("在跑时给出「停止」按钮", allText(busyTree).includes("停止"));

  // 「排队中」要在地块**还没生成**且它的目标在本次作业里时才出现 ——
  // 上面那份数据两个变体都已经就绪，所以看不到排队态。这里专门造一份空的。
  const pending = makeProject({
    items: [makeItem({ variants: [] })],
    job: { projectId: "tabc123", kind: "generate", targets: ["grass#v1", "grass#v2"], done: [], running: "grass#v1", startedAt: Date.now() }
  });
  const pendingTree = renderTile(pending, { stage: "generate" }).tree;
  check("还没轮到的格子显示「排队中」", allText(pendingTree).includes("排队中"), allText(pendingTree).slice(0, 240));
  check("排队中的格子是可辨识的空态（SPR_thumb-empty）",
    byClassPart(pendingTree, "SPR_thumb-empty").length >= 1,
    `${byClassPart(pendingTree, "SPR_thumb-empty").length} 个`);
  check("同一次作业里所有未生成的格子都算排队（2 个）",
    (allText(pendingTree).match(/排队中/g) ?? []).length === 2,
    `${(allText(pendingTree).match(/排队中/g) ?? []).length} 个`);

  const idle = renderTile(makeProject(), { stage: "generate" });
  check("空闲时一个遮罩都没有", overlays(idle.tree).length === 0, `${overlays(idle.tree).length} 个`);
}

// ═══════════════════════════════════════════════════════════════════════════
section("③ 验收阶段");
// ═══════════════════════════════════════════════════════════════════════════
{
  const { tree } = renderTile(makeProject(), { stage: "review" });
  check("有「通过」按钮", allText(tree).includes("通过"));
  check("已通过的变体显示「已通过」", allText(tree).includes("已通过"));
  check("每个变体都有「重跑」", allText(tree).includes("重跑"));
  check("验收阶段也有几何角标", byClassPart(tree, "SPR_tileBadge").length >= 2, `${byClassPart(tree, "SPR_tileBadge").length} 个`);

  const empty = renderTile(makeProject({ items: [makeItem({ variants: [] })] }), { stage: "review" }).tree;
  check("没有产物时显示「未生成」而不是崩", allText(empty).includes("未生成"));
}

// ═══════════════════════════════════════════════════════════════════════════
section("④ 拼图阶段");
// ═══════════════════════════════════════════════════════════════════════════
{
  const { tree } = renderTile(makeProject(), { stage: "map" });
  check("有「铺成地图（免费）」按钮", allText(tree).includes("铺成地图（免费）"));
  check("有「换个种子重铺」按钮", allText(tree).includes("换个种子重铺"));
  check("四个参数（行/列/种子/装饰密度）都在",
    ["行", "列", "种子", "装饰密度"].every((label) => allText(tree).includes(label)));
  check("说明同种子逐像素一致", allText(tree).includes("逐像素一致"));
  const mapImages = byType(tree, "img").filter((node) => node.props.className === "SPR_tileMap");
  check("已拼图时显示地图预览", mapImages.length === 1, `${mapImages.length} 张`);
  check("地图预览用的是 map.png（宿主真实字段）",
    mapImages.length === 1 && String(mapImages[0].props.src).includes("/map/map.png"),
    mapImages.length === 1 ? String(mapImages[0].props.src) : "(无)");
  check("地图预览的 URL 里没有反斜杠",
    mapImages.length === 1 && !String(mapImages[0].props.src).includes("\\"),
    mapImages.length === 1 ? String(mapImages[0].props.src) : "(无)");
  // caption 只在双击放大后的弹窗里渲染（ZoomableImage 的常态输出里没有），
  // 所以这里不去断言它 —— 该断言的是「预览真的指向 map.png，且 URL 干净」。
  check("地图预览的 alt 是「地图」", mapImages.length === 1 && mapImages[0].props.alt === "地图",
    mapImages.length === 1 ? String(mapImages[0].props.alt) : "(无)");

  // 没拼过图时：既没有 png、也没有 ready —— 必须给空态而不是残留的裂图
  const noMap = renderTile(makeProject({ map: { rows: 14, cols: 14, seed: 1, cells: [], decor: {}, buildings: [] } }), { stage: "map" }).tree;
  check("没拼图时给空态引导", allText(noMap).includes("还没有拼图"));
  check("没拼图时不显示地图预览",
    byType(noMap, "img").filter((node) => node.props.className === "SPR_tileMap").length === 0);
}

section("头部进度不能是 0 / 0（宿主必须算 progress）");
{
  // 真机踩过：界面读 `project.progress`，而宿主没算这个字段 →
  // 头部永远显示「已生成 0 / 0，已验收 0」，跟实际产物对不上。
  const withProgress = renderTile(makeProject(), { stage: "template" }).tree;
  check("头部显示宿主给的进度", allText(withProgress).includes("已生成 2 / 2"), allText(withProgress).slice(0, 200));
  const withoutProgress = renderTile(makeProject({ progress: undefined }), { stage: "template" }).tree;
  check("宿主没给 progress 时退化成 0 / 0（说明这个字段确实被读了）",
    allText(withoutProgress).includes("已生成 0 / 0"), allText(withoutProgress).slice(0, 200));
}

// ═══════════════════════════════════════════════════════════════════════════
section("⑤ 导出阶段");
// ═══════════════════════════════════════════════════════════════════════════
{
  const { tree } = renderTile(makeProject(), { stage: "export" });
  check("有「导出到 export/」按钮", allText(tree).includes("导出到 export/"));
  check("有「打开产物目录」按钮", allText(tree).includes("打开产物目录"));
  check("说明了导出内容", allText(tree).includes("布局 JSON"));
}

// ═══════════════════════════════════════════════════════════════════════════
section("② 生成阶段：地块清单的增 / 删 / 改");
// ═══════════════════════════════════════════════════════════════════════════
{
  const { tree } = renderTile(makeProject(), { stage: "generate" });
  check("每个地块卡片有「编辑」按钮", (allText(tree).match(/编辑/g) ?? []).length >= 1);
  check("每个地块卡片有「删除」按钮", (allText(tree).match(/删除/g) ?? []).length >= 1);
  check("有「＋ 新增地块」按钮", allText(tree).includes("＋ 新增地块"));
  check("有「恢复默认清单」按钮", allText(tree).includes("恢复默认清单"));
  check("卡片上显示了类别（family）", allText(tree).includes("grass"), allText(tree).slice(0, 200));

  // 编辑态：表单里的字段必须都在，而且提示词要能改
  const draft = {
    key: "grass", label: "草地", kind: "terrain", family: "grass", footprint: [1, 1],
    content: "改过的内容描述", mode: "template", variantCount: 3
  };
  const editing = renderTile(makeProject(), { stage: "generate", editingKey: "grass", itemDraft: draft }).tree;
  const editingText = allText(editing);
  check("编辑态显示标识（只读）", editingText.includes("标识（key，只读）"));
  check("编辑态有用途下拉", editingText.includes("地形（占 1 格）") && editingText.includes("装饰（占 1 格、按锚点摆放）"));
  check("编辑态有生成方式下拉",
    editingText.includes("模板填充（地形）") && editingText.includes("2×2 地基网格（建筑）"));
  check("编辑态有变体数", editingText.includes("变体数（每个变体一次计费调用）"));
  check("编辑态有类别（family）", editingText.includes("类别（铺图时按它随机抽变体）"));
  check("编辑态有占格", editingText.includes("占格 列 × 行"));
  check("编辑态有提示词 textarea", byType(editing, "textarea").length >= 1);
  check("提示词 textarea 里是草稿内容",
    byType(editing, "textarea").some((node) => node.props.value === "改过的内容描述"));
  check("编辑态有「看最终提示词」折叠区", editingText.includes("看最终提示词"));
  check("提示词预览里含草稿内容",
    byType(editing, "pre").some((node) => textOf(node).includes("改过的内容描述")),
    byType(editing, "pre").map(textOf).join(" | ").slice(0, 120));
  check("提示词预览里含统一画风",
    byType(editing, "pre").some((node) => textOf(node).includes("像素画风")),
    byType(editing, "pre").map(textOf).join(" | ").slice(0, 120));
  check("编辑态有保存 / 取消 / 删除三个动作",
    editingText.includes("保存") && editingText.includes("取消") && editingText.includes("删除这个地块"));

  // 「提示词变了会作废」必须在界面上说清楚 —— 这是花钱的事
  const promptChanged = renderTile(makeProject(), { stage: "generate", editingKey: "grass", itemDraft: draft }).tree;
  check("提示词改动时给出作废警告",
    allText(promptChanged).includes("保存后这个地块的已生成产物会作废"),
    allText(promptChanged).slice(-260));

  // 只改变体数时不该出现作废警告
  const samePrompt = renderTile(makeProject(), {
    stage: "generate", editingKey: "grass",
    itemDraft: { ...draft, content: "鲜绿色的短草地。", variantCount: 3 }
  }).tree;
  check("只改变体数时不显示作废警告",
    !allText(samePrompt).includes("保存后这个地块的已生成产物会作废") &&
    allText(samePrompt).includes("只改名称 / 类别 / 变体数不会作废产物"));

  // 新增表单
  const adding = renderTile(makeProject(), {
    stage: "generate",
    newItem: { key: "", label: "", kind: "terrain", family: "", footprint: [1, 1], content: "", mode: "template", variantCount: 1 }
  }).tree;
  check("新增表单有标识 / 名称 / 用途", allText(adding).includes("标识（英文小写，会当文件名）") &&
    allText(adding).includes("名称") && allText(adding).includes("用途"));
  check("新增表单有「新增」按钮", allText(adding).includes("新增"));
  // 新增时必须能一次把变体数与类别定下来，否则用户加完还得再进编辑态改一遍
  check("新增表单有变体数", allText(adding).includes("变体数（每个变体一次计费调用）"));
  check("新增表单有类别（family）", allText(adding).includes("类别（铺图时按它随机抽变体）"));
  check("新增表单有生成提示词 textarea", byType(adding, "textarea").length === 1);
  check("新增表单的三个输入框都在（标识 / 名称 / 类别）",
    byType(adding, "input").filter((n) => n.props.type !== "number").length >= 3,
    `${byType(adding, "input").filter((n) => n.props.type !== "number").length} 个文本框`);

  // 编辑态下不该同时显示「编辑」按钮（否则用户会点错）
  check("编辑态下卡片本身不再显示「编辑」按钮",
    byClassPart(editing, "SPR_tileEditor").length >= 1 &&
    !byClassPart(editing, "SPR_tileCard-editing").some((card) => textOf(card).includes("编辑")));
}

// ═══════════════════════════════════════════════════════════════════════════
section("④ 拼图阶段：手动编辑布局");
// ═══════════════════════════════════════════════════════════════════════════
{
  const cells = [
    ["grass", "grass", "grass"],
    ["grass", "", "dirt"],
    ["rock", "grass", "grass"]
  ];
  const withDraft = renderTile(makeProject({ map: { rows: 3, cols: 3, seed: 5, cells, decor: {}, buildings: [] } }), {
    stage: "map", brushKey: "dirt", mapDraft: cells.map((row) => [...row])
  }).tree;
  const text = allText(withDraft);
  check("未开始编辑时给「开始编辑布局」入口",
    allText(renderTile(makeProject(), { stage: "map", mapDraft: null }).tree).includes("开始编辑布局"));
  check("编辑态显示笔刷区", text.includes("笔刷（点格子刷上去）"));
  check("笔刷里有每个地块", byClassPart(withDraft, "SPR_btn-mini").length >= 2);
  check("笔刷里有橡皮擦", text.includes("橡皮擦"));
  check("编辑态有「保存布局」", text.includes("保存布局"));
  check("编辑态有「全部清空」", text.includes("全部清空"));
  check("编辑态有「全刷成当前笔刷」", text.includes("全刷成当前笔刷"));
  check("编辑态有「放弃修改」", text.includes("放弃修改"));

  // 可点的格子：3×3 = 9 个
  const cellNodes = byClassPart(withDraft, "SPR_mapCell");
  check("渲染出 3×3 = 9 个可点格子", cellNodes.length === 9, `${cellNodes.length} 个`);
  check("空格子带 SPR_mapCell-empty 标记",
    byClassPart(withDraft, "SPR_mapCell-empty").length === 1,
    `${byClassPart(withDraft, "SPR_mapCell-empty").length} 个`);
  check("每个格子都有 onClick（真的能涂）",
    cellNodes.every((node) => typeof node.props.onClick === "function"));
  check("格子的 title 是「行,列 · 地块」",
    cellNodes.every((node) => /^\d+,\d+ · /.test(String(node.props.title))),
    String(cellNodes[0]?.props.title));
  check("格子用 clipPath 裁成菱形（只有菱形可点）",
    cellNodes.every((node) => String(node.props.style?.clipPath ?? "").includes("polygon")),
    String(cellNodes[0]?.props.style?.clipPath));
  check("格子的类名带 SPR_mapCellLabel 子节点",
    cellNodes.every((node) => collect(node, (n) => n.props?.className === "SPR_mapCellLabel").length === 1));

  // ★ 叠层坐标必须与宿主 `tileOriginAt` **逐点一致**。
  // 这是「点到的格子 = 看到的格子」的唯一保证：浏览器半区不能 import 宿主代码，
  // 只能各写一份公式，所以必须在这里拿宿主的实现比对。
  // 实测踩过：界面那份把 originY 写成 `cellH/2*scale`，叠层整整偏了半个格子。
  {
    const host = await import("../lib/tilemap.js");
    const settings = { cellWidth: 64, cellHeight: 96 };
    const layout = host.tileLayout(settings, 3, 3, 2);
    // 夹具里带上宿主真实会写的 `map.pixel`（裁剪偏移 + 交付尺寸）
    const trim = { left: 40, top: 128, width: layout.canvasW - 80, height: layout.canvasH - 200, scale: 2 };
    const withTrim = renderTile(
      makeProject({ map: { rows: 3, cols: 3, seed: 5, cells, decor: {}, buildings: [], png: "map/map.png", pixel: trim } }),
      { stage: "map", brushKey: "dirt", mapDraft: cells.map((row) => [...row]) }
    ).tree;
    const trimCells = byClassPart(withTrim, "SPR_mapCell");
    const mismatches = [];
    for (const [r, c] of [[0, 0], [0, 2], [2, 0], [1, 1], [2, 2]]) {
      const want = host.tileOriginAt(layout, r, c);
      const node = trimCells.find((n) => n.props.title.startsWith(`${r},${c} · `));
      const got = { x: Number.parseFloat(node.props.style.left), y: Number.parseFloat(node.props.style.top) };
      // 叠层坐标 = 未裁坐标 − 裁剪偏移
      if (got.x !== want.x - trim.left || got.y !== want.y - trim.top) {
        mismatches.push(`(${r},${c}) 界面 ${got.x},${got.y} vs 期望 ${want.x - trim.left},${want.y - trim.top}`);
      }
    }
    check("叠层坐标 = 宿主 tileOriginAt − 裁剪偏移", mismatches.length === 0, mismatches.join(" | "));
    check("叠层画布尺寸用的是 map.pixel 的交付尺寸",
      Number.parseFloat(byClassPart(withTrim, "SPR_mapEditorCanvas")[0]?.props.style.width) === trim.width &&
      Number.parseFloat(byClassPart(withTrim, "SPR_mapEditorCanvas")[0]?.props.style.height) === trim.height,
      `界面 ${byClassPart(withTrim, "SPR_mapEditorCanvas")[0]?.props.style.width}×${byClassPart(withTrim, "SPR_mapEditorCanvas")[0]?.props.style.height}` +
      ` vs 期望 ${trim.width}×${trim.height}`);
    check("stepY 用的是菱形高（cellWidth/4）而不是 cellHeight/4",
      layout.stepY === (64 / 4) * 2 && layout.stepY !== (96 / 4) * 2,
      `stepY=${layout.stepY}`);
    // 老项目没有 map.pixel，此时偏移按 0 处理（不能崩、也不能凭空移位）
    const plain = host.tileOriginAt(layout, 0, 0);
    check("没有 map.pixel 时按未裁坐标对齐（老项目不崩）",
      Number.parseFloat(cellNodes[0]?.props.style.left) === plain.x &&
      Number.parseFloat(cellNodes[0]?.props.style.top) === plain.y,
      `界面 ${cellNodes[0]?.props.style.left},${cellNodes[0]?.props.style.top} vs ${plain.x},${plain.y}`);
  }

  // 说明要写清「涂改只改草稿、不作废产物」
  check("说明写明手动改布局不作废地块",
    text.includes("手动改布局不会作废已生成的地块") && text.includes("涂改只改草稿"));

  // 没开始编辑时不渲染叠层
  const notEditing = renderTile(makeProject({ map: { rows: 3, cols: 3, seed: 5, cells, decor: {}, buildings: [] } }), {
    stage: "map", mapDraft: null
  }).tree;
  check("未开始编辑时不渲染可点格子", byClassPart(notEditing, "SPR_mapCell").length === 0);

  // ★ 回归：轮询不能把草稿冲掉。
  // `load()`（清草稿）会被轮询调用，一旦轮询走的是它，用户正在涂的布局每 1.5 秒
  // 就被清一次 —— 实测表现是「拼完图可点格子整片消失」。
  // 这里直接读源码：轮询那个 effect 里必须是 reload，不是 load。
  {
    const source = readFileSync(target, "utf8");
    const pollEffect = /if \(!busy\)[\s\S]{0,400}?setInterval\(\(\) => \{ void (\w+)\(projectId\)/.exec(source);
    check("轮询用的是 reload（不清草稿）而不是 load", pollEffect !== null && pollEffect[1] === "reload",
      pollEffect === null ? "没匹配到轮询 effect" : `用的是 ${pollEffect[1]}`);
    check("存在独立的 reload（不清草稿的重读）", /const reload = React\.useCallback/.test(source));
    check("load 里会清地图草稿（切项目时用）",
      /const load = React\.useCallback[\s\S]{0,400}?setMapDraft\(null\)/.test(source));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section("点击真的调用对应远程方法");
// ═══════════════════════════════════════════════════════════════════════════
{
  const click = (tree, label) => {
    const hit = collect(tree, (node) => {
      if (typeof node.props?.onClick !== "function") return false;
      const texts = [textOf(node.children ?? [])].flat().join("");
      return texts.includes(label);
    });
    if (hit.length === 0) return false;
    hit[0].props.onClick({ target: {} });
    return true;
  };

  CALLS.length = 0;
  const t = renderTile(makeProject(), { stage: "template" }).tree;
  const clicked = click(t, "生成模板");
  check("点到「生成模板」按钮", clicked);
  await new Promise((r) => setTimeout(r, 20));
  check("点击后调用了 runTileTemplate",
    CALLS.some((c) => c.name === "runTileTemplate" && c.payload?.projectId === "tabc123"),
    CALLS.map((c) => c.name).join(", "));
  check("runTileTemplate 带上了正确的 projectId",
    CALLS.find((c) => c.name === "runTileTemplate")?.payload?.projectId === "tabc123");

  CALLS.length = 0;
  const g = renderTile(makeProject(), { stage: "map" }).tree;
  click(g, "铺成地图");
  await new Promise((r) => setTimeout(r, 20));
  const mapCall = CALLS.find((c) => c.name === "runTileMap");
  check("点击「铺成地图」调用了 runTileMap", mapCall !== undefined, CALLS.map((c) => c.name).join(", "));
  check("runTileMap 带上了行/列/种子/装饰密度",
    mapCall?.payload?.rows === 14 && mapCall?.payload?.cols === 14 &&
    mapCall?.payload?.seed === 20261004 && typeof mapCall?.payload?.decorDensity === "number",
    JSON.stringify(mapCall?.payload));

  CALLS.length = 0;
  const e = renderTile(makeProject(), { stage: "export" }).tree;
  click(e, "导出到 export/");
  await new Promise((r) => setTimeout(r, 20));
  check("点击导出调用了 runTileExport", CALLS.some((c) => c.name === "runTileExport"), CALLS.map((c) => c.name).join(", "));
}

console.log("\n" + "═".repeat(60));
report();
