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
const HOOK = { slots: [], refs: [], cursor: 0 };

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
    // ⚠️ ref 必须**跨渲染保持同一个对象**（真 React 就是这样）。
    // 每次返回新对象的话，写进 `.current` 的东西下一次渲染就没了 ——
    // 依赖 ref 存状态的功能（比如地图编辑器的撤销栈）在这里会看起来完全坏掉，
    // 而真机上其实是好的（假绿的反面：假红）。
    if (HOOK.refs[index] === undefined) HOOK.refs[index] = { current: initial };
    return HOOK.refs[index];
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
const TILE_KEYS = ["generate", "review", "map", "export"];

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
    // 参考图预览：宿主真实会发**两个**清单 —— 期望的（`templates`）与
    // 磁盘上真有的（`templatesPresent`）。默认取「已经生成过」这个常见状态。
    // ⚠️ 两个都给，别只给期望清单：只给期望的会让界面给不存在的文件挂 <img>，
    // 那就是一次 404、一张裂图（用户报过）。
    templates: ["cell.png", "grid2x2.png"],
    templatesPresent: ["cell.png", "grid2x2.png"],
    templateRev: "1000-2",
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
// +1 = 实验性进入提示的 `gateOpen`（`useState`；配套的 `closeGate` 是 useCallback、不占槽）。
// **新增状态时这个数字必须跟着改** —— 它是「槽位没串位」的唯一护栏。
const EXPECTED_HOOKS = 28;
/**
 * 把测试里写的「扁平 cells 网格」补成三层草稿。
 * 断言里仍然可以只关心地面，所以旧写法继续可用。
 */
function normalizeDraft(draft) {
  if (draft === null || draft === undefined) return null;
  if (Array.isArray(draft)) return { ground: draft, decor: {}, buildings: [] };
  return {
    ground: draft.ground ?? [],
    decor: draft.decor ?? {},
    buildings: draft.buildings ?? []
  };
}

/**
 * 复刻界面那套裁剪矩形公式（与宿主 `tilemap.measureAssemblyBounds` 同构）。
 *
 * 断言里要算「某格左上角在叠层坐标里的位置」，就必须知道裁剪偏移 ——
 * 而偏移现在是**按草稿内容现算**的（不再读 `map.pixel`），所以测试也得算一遍。
 *
 * 建筑那一项用 `ratio` / `baseFraction`（宿主在 `preview.buildings` 里给的），
 * 所以草稿里的建筑要带上这两个字段才量得准。
 */
/** 草稿里某栋建筑的形状：带 `shape` 就用它，否则按 `fw/fh` 兜成矩形。 */
function shapeOfDraftBuilding(bd) {
  if (Array.isArray(bd?.shape) && bd.shape.length > 0) return bd.shape;
  const out = [];
  for (let r = 0; r < Math.max(1, bd?.fh ?? 1); r++) {
    for (let c = 0; c < Math.max(1, bd?.fw ?? 1); c++) out.push([r, c]);
  }
  return out;
}

function boundsOf(d, rows, cols, cw = 64, ch = 96, scale = 2) {
  const stepX = (cw / 2) * scale, stepY = (cw / 4) * scale;
  const originX = (rows - 1) * stepX, originY = ch * scale;
  const groundInset = Math.round(ch / 3), diamondH = Math.round(cw / 2);
  let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
  const put = (x, y, w, h) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return;
    if (x < L) L = x; if (y < T) T = y;
    if (x + w > R) R = x + w; if (y + h > B) B = y + h;
  };
  const occ = new Set();
  for (const bd of d.buildings ?? []) {
    for (const [dr, dc] of shapeOfDraftBuilding(bd)) occ.add(`${bd.r + dr},${bd.c + dc}`);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = originX + (c - r) * stepX, oy = originY + (c + r) * stepY;
      if ((d.ground?.[r]?.[c] ?? "") !== "") {
        const ix = ((cw - diamondH * 2) / 2) * scale;
        put(ox - ix, oy + groundInset * scale, cw * scale, diamondH * scale);
      }
      const dec = d.decor?.[`${r},${c}`];
      if (typeof dec === "string" && dec !== "" && !occ.has(`${r},${c}`)) put(ox, oy, cw * scale, ch * scale);
    }
  }
  for (const bd of d.buildings ?? []) {
    const bShape = shapeOfDraftBuilding(bd);
    const ox = originX + (bd.c - bd.r) * stepX, oy = originY + (bd.c + bd.r) * stepY;
    const bOff = shapeOffsetExpect(bShape, stepX, stepY);
    const baseX = ox + (cw * scale) / 2 + bOff.dx;
    const baseY = oy + (ch * scale) / 2 + bOff.dy;
    const w = (cw / 2) * scale * ((Math.max(...bShape.map(([r, c]) => c - r)) - Math.min(...bShape.map(([r, c]) => c - r))) + 2);
    const hgt = Math.max(1, Math.round(w * (typeof bd.ratio === "number" ? bd.ratio : 1)));
    const bf = typeof bd.baseFraction === "number" ? bd.baseFraction : 0.5;
    put(Math.round(baseX - w / 2), Math.round(baseY - bf * hgt), w, hgt);
    // 垫底：逐格（与界面/宿主同口径）
    const cellHalfW = (cw / 2) * scale, cellHalfH = cellHalfW / 2;
    for (const [dr, dc] of bShape) {
      const cx2 = ox + (cw * scale) / 2 + (dc - dr) * stepX;
      const cy2 = oy + (ch * scale) / 2 + (dc + dr) * stepY;
      put(Math.ceil(cx2 - cellHalfW), Math.floor(cy2 - cellHalfH),
        Math.floor(cx2 + cellHalfW) - Math.ceil(cx2 - cellHalfW) + 1,
        Math.ceil(cy2 + cellHalfH) - Math.floor(cy2 - cellHalfH) + 1);
    }
  }
  if (!Number.isFinite(L)) return { left: 0, top: 0 };
  return { left: Math.floor(L), top: Math.floor(T) };
}

/**
 * 形状底心偏移的**独立期望**（与 `client.ts` 里 `shapeOffsetOf` 同一条公式）。
 *
 * 公式：取 `(c−r)` 与 `(c+r)` 的极差，各自除 2 再乘步长。
 * ⚠️ 界面那份手抄必须与之一致 —— 不一致就是「建筑错半格」那类老问题。
 */
function shapeOffsetExpect(shape, stepX, stepY) {
  if (!Array.isArray(shape) || shape.length === 0) return { dx: 0, dy: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [r, c] of shape) {
    const x = c - r;
    const y = c + r;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { dx: ((minX + maxX) / 2) * stepX, dy: ((minY + maxY) / 2) * stepY };
}

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
    // 13：实验性进入提示（`gateOpen`）。默认 false = 弹窗已关，
    // 免得每个用例都被那个弹窗盖住、断言读不到底下的控件。
    // （要测弹窗的用例自己传 `gateOpen: true`。）
    drafts.gateOpen ?? false,
    // 14~19：编辑相关草稿（未编辑时全是 null）
    drafts.editingKey ?? null,
    drafts.itemDraft ?? null,
    drafts.newItem ?? null,
    drafts.brushKey ?? null,
    drafts.cellKey ?? null,
    // 草稿是**三层**的：地面 / 装饰 / 建筑（见 client.ts 里 ensureMapDraft 的注释）。
    // 传数组会被当成旧形状而炸，所以这里统一补成对象。
    normalizeDraft(drafts.mapDraft),
    // 21：幽灵预览的光标格（红警盖房式的占格高亮）
    drafts.hoverCell ?? null,
    // 22~25 是 usePendingTasks / useStudioIntent 内部的状态槽，测试没法从外面注入
    undefined, undefined, undefined, undefined
  ];
  HOOK.cursor = 0;
  // ref 槽位跟着本次渲染重新开始算。
  // ⚠️ 对象**不**清空：`useRef` 跨渲染要拿到同一个对象，否则
  // 依赖 ref 存状态的功能（撤销栈）在这里会假红 —— 见 useRef 的注释。
  // 需要干净历史的用例自己调 resetRefs()。
  const tree = TileModule({ api });
  // ⚠️ **立刻物化**整棵树。
  //
  // 假 React 的树是惰性的：函数型节点的展开依赖共享的 `HOOK.slots`，而槽位在
  // 下一次 renderTile 时就被改写了。于是「渲染 A、再渲染 B、回头读 A 的文字」
  // 会读到 **B 的文案** —— 断言莫名其妙失败，而界面其实是对的。
  // （`byClassPart` 之所以看起来正常：它在遍历时就顺手把函数节点展开了。）
  // 物化一次就把每个节点的 children 固化成当时的渲染结果，之后怎么读都稳定。
  materialize(tree);
  return { tree, hooks: HOOK.cursor };
}

/** 就地展开所有函数型节点，把惰性树固化成静态树。 */
function materialize(node, seen = new Set()) {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = materialize(node[i], seen);
    return node;
  }
  if (seen.has(node)) return node;
  seen.add(node);
  if (node.type === undefined) return node;
  let children = Array.isArray(node.children) ? node.children : [];
  if (typeof node.type === "function") {
    const props = { ...(node.props ?? {}) };
    const kids = children.filter((c) => c !== null && c !== undefined);
    if (kids.length === 1) props.children = kids[0];
    else if (kids.length > 1) props.children = kids;
    const rendered = node.type(props);
    node.type = rendered?.type ?? "div";
    node.props = rendered?.props ?? {};
    children = Array.isArray(rendered?.children) ? rendered.children : (rendered?.children === undefined ? [] : [rendered.children]);
    node.children = children;
  }
  for (let i = 0; i < children.length; i++) children[i] = materialize(children[i], seen);
  return node;
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
section("四个阶段都能渲染（每个都不能白屏）");
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
    check(`阶段 ${stage} 渲染了 4 个步骤按钮`, byClassPart(tree, "SPR_step").length === 4, `${byClassPart(tree, "SPR_step").length} 个`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section("参考图面板（原「① 模板」，现已并入生成阶段）");
// ═══════════════════════════════════════════════════════════════════════════
{
  // ★ 这一步**已经不是独立阶段了** —— 参考图在「生成地块」开始时由宿主自动渲染，
  // 所以面板必须长在 generate 阶段里。
  // ⚠️ 模板图必须**按宿主列出来的文件名**渲染（`project.templates`），界面不写死。
  // 写死 `cell.png` + `grid2x2.png` 会把 3×1 / L 形的参考图藏起来 ——
  // 用户看到的就是「只支持 1×1 和 2×2」。
  const withTemplates = makeProject({
    templates: ["cell.png", "grid2x2.png", "grid3x1.png", "shape-0-0_1-0_1-1.png"],
    templatesPresent: ["cell.png", "grid2x2.png", "grid3x1.png", "shape-0-0_1-0_1-1.png"],
    templateRev: "123"
  });
  const { tree } = renderTile(withTemplates, { stage: "generate" });
  check("★ 参考图面板长在生成阶段里（不再有独立阶段）",
    allText(tree).includes("参考图（自动生成，免费）"), allText(tree).slice(0, 160));
  check("★ 不再有「生成模板」按钮（已自动化）",
    !allText(tree).includes("生成模板"), allText(tree).slice(0, 200));
  const tiles = byClassPart(tree, "SPR_tileAsset").filter((n) => n.props["data-template"] !== undefined);
  check("★ 按宿主给的清单渲染参考图（几个文件就几张）", tiles.length === 4, `${tiles.length} 张`);
  check("★ 3×1 的参考图也在列表里（不是只显示 1×1 和 2×2）",
    tiles.some((n) => n.props["data-template"] === "grid3x1.png"),
    tiles.map((n) => n.props["data-template"]).join(", "));
  check("★ 异形参考图也在列表里（L 形带形状哈希名）",
    tiles.some((n) => n.props["data-template"] === "shape-0-0_1-0_1-1.png"),
    tiles.map((n) => n.props["data-template"]).join(", "));
  const images = byType(tree, "img");
  check("参考图走 assetBase 相对路径",
    images.some((node) => String(node.props.src).startsWith("/dsh-game-material-master/tile-assets/tabc123/template/")),
    images.map((n) => n.props.src).join(", "));
  // ★★ 回归：**只有磁盘上真有的才挂 `<img>`**。
  // 曾经给「期望清单」里的每一项都挂 `<img>`，文件还没落盘时浏览器请求 404，
  // 面板上全是裂图 —— 用户报的「参考图是裂的」就是这个。
  // 而且 404 会被浏览器**连失败一起缓存**，`updatedAt` 又不会因为图片 404 而变，
  // 所以生成完了图还是裂的。修法：没落盘的渲染成占位块（`data-pending`）。
  {
    const onlyCell = renderTile(makeProject({
      templates: ["cell.png", "grid2x2.png", "grid3x1.png"],
      templatesPresent: ["cell.png"],
      templateRev: "9"
    }), { stage: "generate" }).tree;
    const imgs = byType(onlyCell, "img").filter((n) => String(n.props.src).includes("/template/"));
    check("★★ 只给存在的文件挂 <img>（1 个存在 → 只 1 张图）",
      imgs.length === 1, `${imgs.length} 张：${imgs.map((n) => n.props.src).join(", ")}`);
    const pending = byClassPart(onlyCell, "SPR_tileAsset").filter((n) => n.props["data-pending"] === "1");
    check("★★ 没落盘的显示成「待生成」占位块（不是裂图）",
      pending.length === 2 && pending.every((n) => collect(n, (x) => x.type === "img").length === 0),
      `${pending.length} 个占位`);
    check("★★ 占位块仍然列出文件名与说明（不漏掉「将会有哪些」）",
      pending.some((n) => n.props["data-template"] === "grid3x1.png") &&
      allText(onlyCell).includes("3×1 建筑模板"),
      pending.map((n) => n.props["data-template"]).join(", "));
    // 完全没生成过：每一张都是占位，一张 <img> 都不该有
    const noneYet = renderTile(makeProject({
      templates: ["cell.png", "grid2x2.png"], templatesPresent: [], templateRev: "0"
    }), { stage: "generate" }).tree;
    check("★★ 一张都没生成时不渲染任何参考图 <img>（杜绝满屏裂图）",
      byType(noneYet, "img").filter((n) => String(n.props.src).includes("/template/")).length === 0,
      byType(noneYet, "img").map((n) => n.props.src).join(", "));
    check("★★ 图片 URL 用 templateRev 而不是 updatedAt（404 不会被永久缓存）",
      String(imgs[0]?.props.src).includes("v=9") && !String(imgs[0]?.props.src).includes("v=2026"),
      String(imgs[0]?.props.src));
  }
  check("单格参考图有中文说明", allText(tree).includes("单格模板（1×1 地形用）"));
  check("3×1 参考图的说明按文件名反推", allText(tree).includes("3×1 建筑模板"));
  check("异形参考图的说明列出格子坐标", allText(tree).includes("异形模板"), allText(tree).slice(-200));
  // 还没生成过时给空态提示，且不能崩
  const empty = renderTile(makeProject({ templates: [] }), { stage: "generate" }).tree;
  check("还没有参考图时给空态提示（不是白屏）",
    allText(empty).includes("还没有参考图") &&
    byClassPart(empty, "SPR_tileAsset").filter((n) => n.props["data-template"] !== undefined).length === 0,
    allText(empty).slice(-140));
  // ⚠️ 仍然不能有「把图永久隐藏」的 onError
  check("参考图的 onError 只标灰、不隐藏",
    !readFileSync(target, "utf8").includes('event.target.style.display = "none"'));
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

  // 任务在跑时必须有**看得见的进度**、且**不遮挡面板**。
  //
  // 这里刻意不再要求出现 `SPR_ovl`（绝对定位遮罩）：生成一轮几十秒，
  // 盖住整块面板意味着用户既切不了阶段、也点不到「停止」，更去不了别的模块。
  // 现在用行内进度条（`SPR_progress`），它跟着文档流走、不拦点击。
  const running = makeProject({ job: { projectId: "tabc123", kind: "generate", targets: ["grass#v1", "grass#v2"], done: [], running: "grass#v1", startedAt: Date.now() } });
  const busyTree = renderTile(running, { stage: "generate" }).tree;
  // ⚠️ 先把文字**立即**取出来。假 React 的树是惰性的（节点持有的是
  // 「按槽位取值」的函数），后面任何一次 renderTile 都会改写共享的 HOOK.slots，
  // 再回头 allText(busyTree) 读到的就是**另一个项目的文案** ——
  // 表现为断言莫名其妙地失败，而界面其实是对的。收集元素（byClassPart）
  // 不受影响，因为它在遍历时就把函数展开成真节点了。
  const busyText = allText(busyTree);
  check("有任务在跑时出现行内进度条", byClassPart(busyTree, "SPR_progress").length === 1,
    `${byClassPart(busyTree, "SPR_progress").length} 个`);
  check("面板级遮罩**不能**出现（否则挡住了别的页签和停止按钮）", overlays(busyTree).length === 0,
    `${overlays(busyTree).length} 个`);
  check("进度条文案是「正在生成地块…」", busyText.includes("正在生成地块"), busyText.slice(0, 200));
  check("进度条显示正在生成哪一张", busyText.includes("grass#v1"), busyText.slice(0, 200));
  check("进度条显示完成进度 n/total", busyText.includes("0/2"), busyText.slice(0, 200));
  check("进度条是纯展示、不拦点击", byClassPart(busyTree, "SPR_progress").every((n) => n.props.role === "status"));
  check("在跑时给出「停止」按钮", busyText.includes("停止"));

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
  check("编辑态有占格形状编辑器（点格子增删，支持 L 形）",
    editingText.includes("占格形状") && editingText.includes("左上角是锚点"));
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

  // ★ 形状编辑器：能配任意形状（这是「支持 L 形」的入口）。
  //
  // ⚠️ `editingKey` 必须等于 `makeProject()` 里**真实存在**的地块键，
  // 否则编辑表单根本不渲染、断言会误报成「编辑器坏了」（实测踩过）。
  {
    const editDraft = (shape) => ({
      key: "grass", label: "草地", kind: "terrain", family: "grass",
      footprint: [2, 2], shape, content: "", mode: "template", variantCount: 1
    });
    const render = (shape) => renderTile(makeProject(), {
      stage: "generate", editingKey: "grass", itemDraft: editDraft(shape)
    }).tree;
    const lShape = [[0, 0], [1, 0], [1, 1]];
    const cells = byClassPart(render(lShape), "SPR_shapeCell");
    const lit = cells.filter((n) => n.props["data-on"] === "1");
    check("★ 形状编辑器按形状渲染（L 形 3 格亮）", lit.length === 3, `${lit.length} 格亮`);
    check("★ 形状编辑器标出锚点且不可取消",
      cells.some((n) => n.props["data-shape-cell"] === "0,0" && n.props.disabled === true),
      cells.filter((n) => n.props.disabled === true).map((n) => n.props["data-shape-cell"]).join(","));
    check("★ 形状编辑器网格比形状大一圈（能往外扩）",
      cells.some((n) => String(n.props["data-shape-cell"]).startsWith("2,")) &&
      cells.some((n) => String(n.props["data-shape-cell"]).endsWith(",2")),
      `共 ${cells.length} 格`);
    check("★ 形状编辑器的格子可点（有 onClick）",
      cells.length > 0 && cells.every((n) => typeof n.props.onClick === "function"),
      `${cells.length} 格`);
    check("★ 形状编辑器也能显示矩形（2×2 → 4 格亮）",
      byClassPart(render([[0, 0], [0, 1], [1, 0], [1, 1]]), "SPR_shapeCell")
        .filter((n) => n.props["data-on"] === "1").length === 4,
      `${byClassPart(render([[0, 0], [0, 1], [1, 0], [1, 1]]), "SPR_shapeCell").filter((n) => n.props["data-on"] === "1").length} 格亮`);
  }

  // ★★ 回归：界面上的「最终提示词」预览必须按**这个地块自己的形状**写行列数。
  //
  // 真机踩过：用户新加了一个 3×1 的「围墙」，预览里仍然写着
  // 「是一栋大型建筑占用的 2x2 共 4 格地块」—— 那句话是**写死在预览函数里**的。
  // 后果不只是看着别扭：用户以为形状没生效，而且预览与实际发给模型的提示词
  // 完全对不上（宿主那边其实是按形状算的）。
  {
    const previewFor = (draft) => allText(renderTile(makeProject(), {
      stage: "generate", editingKey: "grass", itemDraft: draft
    }).tree);
    const base = {
      key: "grass", label: "围墙", kind: "building", family: "building",
      content: "一堵石墙。", mode: "grid2x2", variantCount: 1
    };
    const wallText = previewFor({ ...base, footprint: [3, 1], shape: [[0, 0], [0, 1], [0, 2]] });
    check("★★ 3×1 的提示词预览写「3×1 / 共 3 格」",
      wallText.includes("3×1") && wallText.includes("共 3 格"),
      (wallText.match(/占地形状[^再]{0,70}/) ?? ["(没找到形状描述)"])[0]);
    check("★★ 3×1 的预览里**不再出现**「2x2 共 4 格」",
      !wallText.includes("2x2 共 4 格") && !wallText.includes("2×2 的等距菱形"),
      wallText.includes("2x2 共 4 格") ? "还写着 2x2" : "ok");
    const sqText = previewFor({ ...base, footprint: [2, 2], shape: [[0, 0], [0, 1], [1, 0], [1, 1]] });
    check("★★ 2×2 的预览写「2×2 / 共 4 格」",
      sqText.includes("2×2") && sqText.includes("共 4 格"),
      (sqText.match(/占地形状[^再]{0,70}/) ?? ["(没找到)"])[0]);
    // 非矩形预览也要带「哪格是空地」
    const lText = previewFor({ ...base, footprint: [2, 2], shape: [[0, 0], [1, 0], [1, 1]] });
    check("★★ L 形的预览带「哪格是空地」那套说法",
      lText.includes("空地") && lText.includes("天井"), lText.slice(-200));
  }

  // ★ 回归：数字输入框必须把新值**真的**交给上层。
  //
  // 曾经的 bug：5 处 `NumField` 传的是 `onCommit`，而组件解构的是 `onChange`
  // —— 失焦时抛 `onChange is not a function`，`itemDraft` 永远拿到旧值。
  // 界面看着一切正常、点保存也提示成功，实际提交的是旧数字
  // （真机表现就是「改了草地变体数、保存后还是 2」）。
  // 占格改成形状编辑器后，编辑态的数字输入框只剩「变体数」一个。
  check("★ 编辑态的数字输入框带 data-num-field 标记（可被断言找到）",
    byClassPart(editing, "SPR_field").filter((n) => n.props["data-num-field"] === "1").length >= 1,
    `${byClassPart(editing, "SPR_field").filter((n) => n.props["data-num-field"] === "1").length} 个`);
  // 组件层：拿到 `onCommit` 而不是 `onChange` 时必须**当场报错**，不许静默。
  {
    const label = byClassPart(editing, "SPR_field").find((n) => n.props["data-num-field"] === "1");
    const numInput = (Array.isArray(label?.props?.children) ? label.props.children : [label?.props?.children])
      .map((c) => c?.props?.children).flat().find((c) => c?.type === "input");
    // 输入 5 → 失焦：必须调用一次 onChange（把 5 交出去），且不抛异常
    let threw = null;
    try {
      numInput?.props?.onChange?.({ target: { value: "5" } });
      numInput?.props?.onBlur?.();
    } catch (error) {
      threw = String(error?.message ?? error);
    }
    check("★ 数字输入框失焦不抛异常（曾经抛 onChange is not a function）", threw === null, String(threw));
  }
  // 源码契约：**所有** `NumField` 调用点都只能用 `onChange`。
  // 纯渲染断言拦不住这个 —— 组件照样渲染出来，只是回调悄悄丢了。
  {
    const source = readFileSync(target, "utf8");
    const bad = [];
    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/h\(NumField/.test(lines[i])) continue;
      let seg = lines[i];
      for (let j = i; j < Math.min(lines.length, i + 10) && !/onCommit:|onChange:/.test(seg); j++) {
        if (j > i) seg += " " + lines[j];
      }
      if (/onCommit:/.test(seg)) bad.push(i + 1);
    }
    check("★ 没有 NumField 调用点误用 onCommit（组件只认 onChange）",
      bad.length === 0, `误用的行：${bad.join(", ")}`);
  }

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
section("④ 拼图阶段：三层编辑（地面 / 装饰 / 建筑）");
// ═══════════════════════════════════════════════════════════════════════════
{
  // 一份「有地面、有装饰、有一栋 2×2 建筑」的宿主视角夹具
  const preview = {
    cells: {
      grass: ["cell/grass.v1.png"],
      dirt: ["cell/dirt.v1.png"],
      rock: ["cell/rock.v1.png"],
      tree: ["decor/tree.v1.png"],
      building: ["cell/building.v1.png"]
    },
    kinds: { grass: "terrain", dirt: "terrain", rock: "terrain", tree: "decor", building: "building" },
    footprints: { grass: [1, 1], dirt: [1, 1], rock: [1, 1], tree: [1, 1], building: [2, 2] },
    cellWidth: 64,
    cellHeight: 96,
    seed: 5,
    ground: [[0, 0, 0], [0, -1, 0], [0, 0, 0]],
    decor: { "1,1": [0, "decor/tree.v1.png"] },
    buildings: [{ r: 2, c: 1, fw: 2, fh: 2, index: 0, cell: "cell/building.v1.png", baseFraction: 0.5 }],
    groundUnder: "cell/grass.v1.png"
  };
  const ground = [["grass", "grass", "grass"], ["grass", "grass", "dirt"], ["grass", "grass", "grass"]];
  // 建筑锚点放 (0,0)，占格 (0,0)(0,1)(1,0)(1,1) —— 必须整个落在 3×3 图内，
  // 否则「缺地面」的判定会因为越界而误判（越界格查不到地面 → 以为要垫底）。
  // 占格铺草地（`paint` 现在的做法），所以垫底不该再出现。
  // 装饰放 (1,2)：**必须在建筑占格之外** —— 占格里的装饰会被抑制（正确行为）。
  const draft = {
    ground,
    decor: { "1,2": "tree" },
    buildings: [{ r: 0, c: 0, fw: 2, fh: 2, key: "building", under: "grass" }]
  };
  const items = [
    makeItem({ key: "grass", label: "草地", kind: "terrain", family: "grass" }),
    makeItem({ key: "dirt", label: "土地", kind: "terrain", family: "dirt" }),
    makeItem({ key: "tree", label: "阔叶树", kind: "decor", family: "tree", mode: "plain" }),
    makeItem({ key: "building", label: "中世纪石屋", kind: "building", family: "building", mode: "grid2x2", footprint: [2, 2] })
  ];

  const tree = renderTile(
    makeProject({
      items,
      preview,
      map: { rows: 3, cols: 3, seed: 5, cells: ground, decor: { "1,1": "tree" }, buildings: [], buildingGround: [], png: "map/map.png", json: "map/map.json", pixel: { width: 320, height: 288, left: 0, top: 100, scale: 2 } }
    }),
    { stage: "map", brushKey: "tree", mapDraft: draft, cellKey: "1,1" }
  ).tree;

  check("笔刷按用途分成地面 / 装饰 / 建筑三组",
    allText(tree).includes("地面") && allText(tree).includes("装饰") && allText(tree).includes("建筑"),
    allText(tree).slice(0, 160));
  // ★ 树下面必须有草地：装饰是独立一层，地面贴图仍然在
  const arts = byClassPart(tree, "SPR_mapArt");
  const decors = byClassPart(tree, "SPR_mapDecor");
  const builds = byClassPart(tree, "SPR_mapBuild");
  check("装饰单独成层（SPR_mapDecor 存在）", decors.length === 1, `${decors.length} 个`);
  check("★ 树那一格同时有草地（装饰不顶掉地面）",
    arts.some((n) => String(n.props.alt).startsWith("1,1 ") && String(n.props.src).includes("grass")),
    arts.map((n) => n.props.alt).join(" | "));
  check("装饰贴在树那一格", String(decors[0]?.props.alt) === "decor 1,2", String(decors[0]?.props.alt));
  // ★ 2×2 建筑：占格的地面被让开，建筑按占格宽摆
  check("建筑单独成层", builds.length === 1, `${builds.length} 个`);
  const bimg = collect(builds[0], (n) => n.type === "img")[0];
  check("★ 建筑贴图按占格宽度摆（2×2 → 4 个半宽 = 256px）",
    Number.parseFloat(String(bimg?.props["data-w"])) === 256,
    String(bimg?.props["data-w"]));
  // 期望值按**界面那套裁剪矩形公式**现算（不再读 `map.pixel`：
  // 几何现在是按草稿内容现算的，读死值会立刻假红 —— 这正是本次修复的目标）。
  {
    const cw = 64, ch = 96, scale = 2, rows = 3;
    const stepX = (cw / 2) * scale, stepY = (cw / 4) * scale;
    const originX = (rows - 1) * stepX, originY = ch * scale;
    const bd = boundsOf(draft, 3, 3);
    const trimLeft = bd.left, trimTop = bd.top;
    const fw = 2, fh = 2;   // 夹具里那栋楼是 2×2
    const br = 0, bc = 0;   // 锚点 (0,0)
    const x = Math.round(originX + (bc - br) * stepX) - trimLeft;
    const y = Math.round(originY + (bc + br) * stepY) - trimTop;
    // ★ 底面中心 = **形状**的包围菱形中心（与宿主 `shapeBaseOffset` 同一条公式）。
    // 夹具那栋是 2×2 矩形。
    const anchorX = x + (cw * scale) / 2;
    const anchorY = y + (ch * scale) / 2;
    const bShape = [[0, 0], [0, 1], [1, 0], [1, 1]];
    const bOff = shapeOffsetExpect(bShape, stepX, stepY);
    const wantX = anchorX + bOff.dx;
    const wantY = anchorY + bOff.dy;
    check("★ 建筑底面中心对到**形状包围菱形**的中心（不是锚点格中心）",
      bimg !== undefined &&
      Number.parseFloat(String(bimg.props["data-bx"])) === wantX &&
      Number.parseFloat(String(bimg.props["data-by"])) === wantY,
      `bx=${bimg?.props["data-bx"]} by=${bimg?.props["data-by"]} 期望 ${wantX},${wantY}`);
    // ★ **独立真值**：底心必须等于「四个占格菱形中心的包围盒中点」。
    // 与公式无关 —— 公式错了这条也照样红。
    {
      const centers = bShape.map(([rr, cc]) => ({
        x: x + (cc - rr) * stepX + (cw * scale) / 2,
        y: y + (cc + rr) * stepY + (ch * scale) / 2
      }));
      const truthX = (Math.min(...centers.map((p) => p.x)) + Math.max(...centers.map((p) => p.x))) / 2;
      const truthY = (Math.min(...centers.map((p) => p.y)) + Math.max(...centers.map((p) => p.y))) / 2;
      check("★ 独立真值：底心 = 四个占格菱形中心的包围盒中点",
        Number.parseFloat(String(bimg?.props["data-bx"])) === truthX &&
        Number.parseFloat(String(bimg?.props["data-by"])) === truthY,
        `界面 ${bimg?.props["data-bx"]},${bimg?.props["data-by"]} vs 真值 ${truthX},${truthY}`);
    }
    check("★ 底面中心比锚点格中心低一格（2×2 的判据）",
      Number.parseFloat(String(bimg?.props["data-by"] ?? "0")) - anchorY === stepY,
      `差 ${Number.parseFloat(String(bimg?.props["data-by"] ?? "0")) - anchorY}px`);
    void fw;
    void fh;
  }
  // ★ 语义变了：建筑占格现在**照画地面**（与宿主 `place()` 同口径）。
  //
  // 以前占格被清空，只能靠一块裁成菱形的纯色垫底去堵洞 —— 那块垫底和周围
  // 有纹理的草地格格不入，真机上看着像建筑拖着一块塑料板。
  // 现在占格铺真地面，垫底只在「占格确实缺地面」时才补。
  check("★ 建筑占格照画地面（不再是空洞）",
    ["0,0", "0,1", "1,0", "1,1"].every((pos) =>
      arts.some((n) => String(n.props.alt).startsWith(`${pos} `))),
    arts.map((n) => n.props.alt).join(" | "));
  check("占格有地面时不再叠那块纯色垫底",
    byClassPart(tree, "SPR_mapUnder").length === 0,
    `${byClassPart(tree, "SPR_mapUnder").length} 个`);

  // ★ 回归：老数据的建筑占格是**空串**（旧版 `place()` 会清空）。
  // 打开编辑时要**自动补上默认地面** —— 不补的话界面会一直给它们叠那块纯色
  // 垫底（真机上是「建筑拖着塑料板」），而且用户得先手动保存一次才会好。
  //
  // `ensureMapDraft` 在假 React 下没法直接跑（setState 是空实现），
  // 所以照着它的口径推一遍草稿：占格空串 → 用建筑自己的 `under` 补上。
  {
    const emptyFootprint = [["", "", "grass"], ["", "", "grass"], ["grass", "grass", "grass"]];
    const legacyBuildings = [{ r: 0, c: 0, fw: 2, fh: 2, key: "building", under: "grass" }];
    const backfilled = emptyFootprint.map((row) => [...row]);
    for (const bd of legacyBuildings) {
      for (let dr = 0; dr < bd.fh; dr++) {
        for (let dc = 0; dc < bd.fw; dc++) {
          if (backfilled[bd.r + dr]?.[bd.c + dc] === "") backfilled[bd.r + dr][bd.c + dc] = bd.under;
        }
      }
    }
    check("★ 老数据的占格空串会被补成地块键（不是留空）",
      backfilled[0][0] === "grass" && backfilled[1][1] === "grass",
      JSON.stringify(backfilled));

    const legacy = renderTile(
      makeProject({
        items, preview,
        map: {
          rows: 3, cols: 3, seed: 5, cells: emptyFootprint, decor: {}, buildings: [], buildingGround: [],
          png: "map/map.png", json: "map/map.json", pixel: { width: 320, height: 288, left: 0, top: 100, scale: 2 }
        }
      }),
      { stage: "map", brushKey: "grass", mapDraft: { ground: backfilled, decor: {}, buildings: legacyBuildings } }
    ).tree;
    const legacyArts = byClassPart(legacy, "SPR_mapArt").filter((n) => !String(n.props.className).includes("Under"));
    check("★ 补完之后 9 格都有地面（没有洞）", legacyArts.length === 9, `${legacyArts.length} 张`);
    check("★ 补完之后不再需要那块纯色垫底",
      byClassPart(legacy, "SPR_mapUnder").length === 0,
      `${byClassPart(legacy, "SPR_mapUnder").length} 个`);
  }

  // ★ 红警盖房子式幽灵预览：选 2×2 建筑笔刷、光标停在某格时，
  // **整块占格**都要高亮（只高亮一格的话用户不知道会盖多大一片），
  // 并且能放画绿、不能放画红。
  {
    const mk = (hover, brush) => renderTile(
      makeProject({
        items, preview,
        map: { rows: 3, cols: 3, seed: 5, cells: ground, decor: {}, buildings: [], buildingGround: [], png: "map/map.png", json: "map/map.json", pixel: { width: 320, height: 288, left: 0, top: 100, scale: 2 } }
      }),
      { stage: "map", brushKey: brush, mapDraft: { ground, decor: {}, buildings: [] }, hoverCell: hover }
    ).tree;

    // 2×2 建筑笔刷、光标在 (0,0)：占格 (0,0)(0,1)(1,0)(1,1) 四格都该高亮
    const ghostOk = mk("0,0", "building");
    const okCells = byClassPart(ghostOk, "SPR_mapCell").filter((n) => String(n.props.className).includes("SPR_mapCell-ghostOk"));
    check("★ 选 2×2 笔刷时整块占格都高亮（不是只高亮一格）", okCells.length === 4,
      `${okCells.length} 格：${okCells.map((n) => n.props.title).join(" | ")}`);
    check("幽灵预览画出了占格外框", byClassPart(ghostOk, "SPR_mapGhost").length === 1,
      `${byClassPart(ghostOk, "SPR_mapGhost").length} 个`);
    check("能放时用「可放」配色",
      String(byClassPart(ghostOk, "SPR_mapGhost")[0]?.props.className).includes("SPR_mapGhost-ok"));

    // 光标在 (2,2)：2×2 会越界 → 红框 + 原因。
    // 占格是 (2,2)(2,3)(3,2)(3,3)，只有 (2,2) 落在 3×3 图内，
    // 其余三格在**图外**、没有可渲染的格子 —— 所以只断言图内那一格变色 + 红框。
    const ghostBad = mk("2,2", "building");
    const badGhost = byClassPart(ghostBad, "SPR_mapGhost");
    check("★ 越界时画红框（不可放）",
      badGhost.length === 1 && String(badGhost[0].props.className).includes("SPR_mapGhost-bad"),
      String(badGhost[0]?.props.className));
    const badCells = byClassPart(ghostBad, "SPR_mapCell").filter((n) => String(n.props.className).includes("SPR_mapCell-ghostBad"));
    check("越界时图内那一格标成不可放", badCells.length === 1, `${badCells.length} 格`);
    check("★ 不可放的格子 title 里写明原因（不是「点了没反应」）",
      badCells.every((n) => String(n.props.title).includes("超出边界")),
      badCells.map((n) => n.props.title).join(" | "));
    // 幽灵层里画的是**占格那几块**（越界时也照画，只是配色变红）——
    // 不再额外描一圈外框：两套节点会叠在同一个容器里越堆越多（实测踩过）。
    const ghostNodes = collect(badGhost[0], (n) => String(n.props?.className ?? "").includes("SPR_mapGhostCell"));
    check("★ 越界时幽灵仍按整块占格画（4 块），只是配色变红",
      ghostNodes.length === 4 && String(badGhost[0].props.className).includes("SPR_mapGhost-bad"),
      `${ghostNodes.length} 块 / ${badGhost[0].props.className}`);
    check("★ 幽灵不混进建筑层（否则会被当成建筑重复渲染）",
      byClassPart(ghostBad, "SPR_mapBuild").length === 0,
      `${byClassPart(ghostBad, "SPR_mapBuild").length} 个`);

    // 单格笔刷仍然只高亮一格
    const one = mk("1,1", "grass");
    const oneCells = byClassPart(one, "SPR_mapCell").filter((n) => String(n.props.className).includes("SPR_mapCell-ghost"));
    check("单格笔刷只高亮一格", oneCells.length === 1, `${oneCells.length} 格`);
    check("没有光标时不画幽灵", byClassPart(mk(null, "building"), "SPR_mapGhost").length === 0);

    // ★ 撤销 / 重做：编辑态要给按钮，而且「还没画过」时两边都该是禁用的。
    //
    // 这里只能断言**渲染出来的控件**；真正的撤销行为在真机浏览器里走查
    // （假 React 的 setState 是空实现，栈推不动）。
    const editTree = mk(null, "grass");
    const btnLabels = collect(editTree, (n) => n.type === "button").map((n) => textOf(n.children ?? []));
    check("★ 编辑态有「撤销」按钮", btnLabels.some((t) => t === "撤销"), btnLabels.slice(0, 12).join("|"));
    check("★ 编辑态有「重做」按钮", btnLabels.some((t) => t === "重做"), btnLabels.slice(0, 12).join("|"));
    const undoBtn = collect(editTree, (n) => n.type === "button" && textOf(n.children ?? []) === "撤销")[0];
    const redoBtn = collect(editTree, (n) => n.type === "button" && textOf(n.children ?? []) === "重做")[0];
    check("刚打开编辑时「撤销」是禁用的（还没有可撤的）", undoBtn?.props?.disabled === true,
      String(undoBtn?.props?.disabled));
    check("刚打开编辑时「重做」是禁用的", redoBtn?.props?.disabled === true,
      String(redoBtn?.props?.disabled));
    check("提示里写了快捷键", allText(editTree).includes("Ctrl+Z"), allText(editTree).slice(0, 120));
  }

  // ★ 回归：草稿里装饰必须存**地块键**（`tree`），不能存贴图路径。
  // 存路径的话后面按键查变体查不到，装饰会**静默全丢**（实测预览里树一个都不剩）。
  // 这里用差分断言：同一份数据，草稿存键 vs 存路径，只有前者能画出装饰。
  {
    const mk = (decorValue) => renderTile(
      makeProject({
        items,
        preview,
        map: { rows: 3, cols: 3, seed: 5, cells: ground, decor: { "1,1": "tree" }, buildings: [], buildingGround: [], png: "map/map.png", json: "map/map.json", pixel: { width: 320, height: 288, left: 0, top: 100, scale: 2 } }
      }),
      { stage: "map", brushKey: "tree", mapDraft: { ground, decor: { "1,1": decorValue }, buildings: [] } }
    ).tree;
    const byKey = byClassPart(mk("tree"), "SPR_mapDecor");
    const byPath = byClassPart(mk("decor/tree.v1.png"), "SPR_mapDecor");
    check("★ 草稿存地块键时装饰画得出来", byKey.length === 1, `${byKey.length} 个`);
    check("★ 草稿存贴图路径时装饰画不出来（证明键才是对的）", byPath.length === 0,
      `${byPath.length} 个`);
    check("装饰贴图指向 decor/ 目录",
      String(byKey[0]?.props.src).includes("/decor/"), String(byKey[0]?.props.src));

    // ★ 装饰层的摆放口径：**贴图铺满整格，左上角对齐格子左上角**。
    //
    // 这条不能靠「推公式」来验 —— 历史上推错过两次（写成格子底边 / 自己又居中一次），
    // 而且推错了断言照样绿。所以这里直接和**宿主的真实合成**比：
    // 拿宿主 `regularizeDecorSprite` 造一张真装饰图，量出它把树画在了格内哪个位置，
    // 再断言界面那张 `<img>` 的摆放能让**同一个像素**落到同一个画面坐标。
    {
      const geom = await import("../lib/tilegeom.js");
      const tilemap = await import("../lib/tilemap.js");
      const anchorY = geom.decorAnchorY(SETTINGS);
      const style = byKey[0]?.props.style ?? {};
      const at = /^decor (\d+),(\d+)$/.exec(String(byKey[0]?.props.alt));
      const [r, c] = at === null ? [1, 1] : [Number(at[1]), Number(at[2])];
      const scale = 2;
      const bd = boundsOf({ ground, decor: { "1,2": "tree" }, buildings: [] }, 3, 3);
      // ★ 用**宿主的** tileLayout 现算这一格的位置（别自己手推 origin —— 推错过一次）。
      const layout = tilemap.tileLayout(SETTINGS, 3, 3, scale);
      const ref = tilemap.tileOriginAt(layout, r, c);
      const cellX = ref.x - bd.left;
      const cellY = ref.y - bd.top;

      check("★ 装饰贴图左上角对齐格子左上角（整格贴，不额外居中）",
        Number.parseFloat(String(style.left)) === cellX && Number.parseFloat(String(style.top)) === cellY,
        `界面 ${style.left},${style.top} 期望 ${cellX},${cellY}`);
      check("★ 装饰贴图铺满整格（与宿主 `regularizeDecorSprite` 的产物同尺寸）",
        Number.parseFloat(String(style.width)) === SETTINGS.cellWidth * scale &&
        Number.parseFloat(String(style.height)) === SETTINGS.cellHeight * scale,
        `界面 ${style.width}×${style.height} 期望 ${SETTINGS.cellWidth * scale}×${SETTINGS.cellHeight * scale}`);
      check("装饰不加会破坏对齐的 transform", style.transform === undefined, String(style.transform));

      // 黄金对照：宿主把树画在格内 (left, top) 处；界面整格贴 → 该像素必须落在
      // 「格子的画面左上角 + (left, top)·scale」。
      // 造一张「白底 + 深色树」的合成图（装饰规整器要靠与边缘的色差找前景）
      const src = { width: 96, height: 64, rgba: Buffer.alloc(96 * 64 * 4) };
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 96; x++) {
          const o = (y * 96 + x) * 4;
          // 树冠：中间一团深绿；其余留白
          const inCrown = x >= 20 && x <= 76 && y >= 6 && y <= 52;
          const inTrunk = x >= 44 && x <= 52 && y >= 40 && y <= 60;
          const fg = inCrown || inTrunk;
          src.rgba[o] = fg ? 40 : 255;
          src.rgba[o + 1] = fg ? 130 : 255;
          src.rgba[o + 2] = fg ? 50 : 255;
          src.rgba[o + 3] = 255;
        }
      }
      const reg = geom.regularizeDecorSprite(src, SETTINGS);
      const [placedX, placedY] = reg.report.placedAt;
      check("★ 宿主确实把装饰**居中**合成进整格（界面因此不该再居中一次）",
        reg.bitmap.width === SETTINGS.cellWidth && reg.bitmap.height === SETTINGS.cellHeight &&
        placedX > 0 && placedY + reg.report.cellSize[1] === anchorY,
        `产物 ${reg.bitmap.width}×${reg.bitmap.height}，画在 (${placedX},${placedY})，锚点 ${anchorY}`);
      // 黄金对照：**宿主与界面算出同一个格子左上角**。
      //
      // 这就是「树落在草地上」的充要条件：装饰贴图是整格合成图，
      // 界面把它整格贴在「格子左上角 − 裁剪偏移」处，而那个格子左上角
      // 必须等于宿主 `tileOriginAt` 算出来的那一个。
      //
      // ⚠️ 别拿「树的像素」去比：宿主画的是**未裁**坐标，界面画的是**裁过**坐标，
      // 两边差一个裁剪偏移。要比就得把界面那份加回偏移 —— 我第一版漏了/加了两次，
      // 各错了一轮。比「格子左上角」这个中间量最不容易搞错。
      const expectLeft = ref.x - bd.left;
      const expectTop = ref.y - bd.top;
      check("★ 黄金对照：界面与宿主算出同一个格子左上角（树因此落在草地上）",
        Number.parseFloat(String(style.left)) === expectLeft && Number.parseFloat(String(style.top)) === expectTop,
        `界面 ${style.left},${style.top} vs 宿主 ${ref.x},${ref.y} − 偏移 ${bd.left},${bd.top} = ${expectLeft},${expectTop}`);
      // 顺带钉住「宿主确实把树居中合成进整格」——这正是界面**不该**再居中一次的原因
      check("★ 宿主把装饰居中合成进整格（界面因此不该再居中一次）",
        placedX > 0 && placedX < SETTINGS.cellWidth &&
        placedY + reg.report.cellSize[1] === anchorY,
        `画在 (${placedX},${placedY})，树高 ${reg.report.cellSize[1]}，锚点 ${anchorY}`);
      check("宿主 decorAnchorY 确实是 54（64×96 的基准值）", anchorY === 54,
        String(anchorY));
    }
  }

  // ★ 回归：`cells` 里存着**装饰键**的老项目，草稿不能把那格丢成空串。
  //
  // 拼图那边这些格子照样铺着地面，界面草稿若丢成 `""`，预览里就出现一个个
  // **白色菱形洞** —— 而「开始编辑布局」打开的正是这份草稿。
  // 实测踩过：一个 13 个 tree 格的项目，编辑区里有 13 个白洞。
  {
    const decorCells = [
      ["tree", "tree", "tree"],
      ["tree", "grass", "tree"],
      ["tree", "tree", "tree"]
    ];
    const proj = makeProject({
      items,
      preview,
      map: {
        rows: 3, cols: 3, seed: 5, cells: decorCells, decor: {}, buildings: [], buildingGround: [],
        png: "map/map.png", json: "map/map.json", pixel: { width: 320, height: 288, left: 0, top: 100, scale: 2 }
      }
    });
    // `ensureMapDraft` 在假 React 下没法直接调（setState 是空实现），
    // 所以这里照着它的口径算一遍草稿：装饰键 → 用默认地面补上。
    const groundFill = Object.keys(preview.cells)
      .find((k) => preview.kinds[k] === "terrain" && preview.cells[k].length > 0) ?? "";
    const derived = decorCells.map((row) =>
      row.map((k) => (k !== "" && preview.kinds[k] !== "terrain" ? groundFill : k)));
    check("★ 装饰键的格子会用默认地面补上（不是留空 → 白洞）",
      derived.every((row) => row.every((k) => k === "grass")),
      JSON.stringify(derived));

    const filled = renderTile(proj, {
      stage: "map", brushKey: "grass",
      mapDraft: { ground: derived, decor: {}, buildings: [] }
    }).tree;
    check("★ 补完后每一格都画出了地面（9 格 9 张贴图，没有洞）",
      byClassPart(filled, "SPR_mapArt").length === 9,
      `${byClassPart(filled, "SPR_mapArt").length} 张`);

    // 反面：真·空白（用户主动清空）仍然保持空洞，不能自作主张填满
    const blank = [["", "", ""], ["", "", ""], ["", "", ""]];
    const blankTree = renderTile(proj, {
      stage: "map", brushKey: "grass",
      mapDraft: { ground: blank, decor: {}, buildings: [] }
    }).tree;
    check("用户主动清空的格子仍然不画地面（尊重清空，不擅自填满）",
      byClassPart(blankTree, "SPR_mapArt").length === 0,
      `${byClassPart(blankTree, "SPR_mapArt").length} 张`);
  }
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

  // ★ 即时预览：草稿里的每一格都要**立刻**贴出对应地块的图，不必先保存再铺。
  // 没有它用户只能看见空的菱形格子，「拼的时候就能预览」就无从谈起。
  {
    const preview = renderTile(
      makeProject({
        map: { rows: 3, cols: 3, seed: 5, cells, decor: {}, buildings: [] },
        preview: { cells: { grass: ["cell/grass.v1.png", "cell/grass.v2.png"], dirt: ["cell/dirt.v1.png"], rock: ["cell/rock.v1.png"] }, cellWidth: 64, cellHeight: 96 }
      }),
      { stage: "map", brushKey: "dirt", mapDraft: cells.map((row) => [...row]) }
    ).tree;
    const arts = byClassPart(preview, "SPR_mapArt");
    // 草稿里有 8 个非空格（3×3 里去掉中间那个空）
    check("预览按草稿贴出每一格的图", arts.length === 8, `${arts.length} 张`);
    check("预览的图真的指向地块贴图",
      arts.every((n) => /tile-assets\/[^?]*\/cell\//.test(String(n.props.src))),
      String(arts[0]?.props.src));
    check("预览层不接事件（点击交给可点格子）",
      arts.every((n) => n.props.className === "SPR_mapArt"));
    // 同一格每次渲染都应固定用同一张（不闪）
    const again = renderTile(
      makeProject({
        map: { rows: 3, cols: 3, seed: 5, cells, decor: {}, buildings: [] },
        preview: { cells: { grass: ["cell/grass.v1.png", "cell/grass.v2.png"], dirt: ["cell/dirt.v1.png"], rock: ["cell/rock.v1.png"] }, cellWidth: 64, cellHeight: 96 }
      }),
      { stage: "map", brushKey: "dirt", mapDraft: cells.map((row) => [...row]) }
    ).tree;
    const arts2 = byClassPart(again, "SPR_mapArt");
    check("同一格两次渲染贴的是同一张（不会闪）",
      arts.length === arts2.length && arts.every((n, i) => n.props.src === arts2[i].props.src));
    // 空格子不贴图
    check("空格子不贴图", !arts.some((n) => String(n.props.alt).includes("· 空格")));
    // 没有 preview 素材时不能崩，只是没有预览层
    const noPreview = renderTile(makeProject({ map: { rows: 3, cols: 3, seed: 5, cells, decor: {}, buildings: [] } }),
      { stage: "map", brushKey: "dirt", mapDraft: cells.map((row) => [...row]) }).tree;
    check("没有 preview 素材时不崩、只是没有预览层", byClassPart(noPreview, "SPR_mapArt").length === 0);

    // ★ 缩放到容器宽度：14×14 的叠层有 1792px 宽，不缩放就只能看见左上角，
    // 「一眼看见整张地图」就没了。
    {
      const cells14 = Array.from({ length: 14 }, () => Array.from({ length: 14 }, () => "grass"));
      const big = renderTile(
        makeProject({
          map: { rows: 14, cols: 14, seed: 5, cells: cells14, decor: {}, buildings: [], png: "map/map.png", pixel: { width: 1792, height: 900, left: 0, top: 200, scale: 2 } },
          preview: { cells: { grass: ["cell/grass.v1.png"] }, cellWidth: 64, cellHeight: 96 }
        }),
        { stage: "map", brushKey: "grass", mapDraft: cells14 }
      ).tree;
      const scaler = byClassPart(big, "SPR_mapEditorScaler")[0];
      const fitBox = byClassPart(big, "SPR_mapEditorFit")[0];
      check("大地图会被缩放（不是原尺寸溢出）",
        scaler !== undefined && /scale\(0\.\d+\)/.test(String(scaler.props.style.transform)),
        String(scaler?.props.style.transform));
      check("缩放容器占的是缩放后的尺寸（不会留一大片空白）",
        fitBox !== undefined && Number.parseFloat(fitBox.props.style.width) <= 900,
        `${fitBox?.props.style.width} x ${fitBox?.props.style.height}`);
      // 缩放不该放大（小地图保持 1:1）
      const small = renderTile(
        makeProject({
          map: { rows: 3, cols: 3, seed: 5, cells, decor: {}, buildings: [], png: "map/map.png", pixel: { width: 320, height: 288, left: 0, top: 100, scale: 2 } },
          preview: { cells: { grass: ["cell/grass.v1.png"] }, cellWidth: 64, cellHeight: 96 }
        }),
        { stage: "map", brushKey: "grass", mapDraft: cells }
      ).tree;
      check("小地图保持 1:1（不放大）",
        String(byClassPart(small, "SPR_mapEditorScaler")[0]?.props.style.transform) === "scale(1)",
        String(byClassPart(small, "SPR_mapEditorScaler")[0]?.props.style.transform));
    }
  }

  // ★ 叠层坐标必须与宿主 `tileOriginAt` **逐点一致**。
  // 这是「点到的格子 = 看到的格子」的唯一保证：浏览器半区不能 import 宿主代码，
  // 只能各写一份公式，所以必须在这里拿宿主的实现比对。
  // 实测踩过：界面那份把 originY 写成 `cellH/2*scale`，叠层整整偏了半个格子。
  {
    const host = await import("../lib/tilemap.js");
    const settings = { cellWidth: 64, cellHeight: 96 };
    const layout = host.tileLayout(settings, 3, 3, 2);
    // ★ 裁剪偏移现在**按草稿内容现算**（不再读 `map.pixel`）——
    // 夹具里那个 `pixel` 就是故意写错的，界面必须无视它。
    const stale = { left: 40, top: 128, width: layout.canvasW - 80, height: layout.canvasH - 200, scale: 2 };
    const draftForBounds = { ground: cells, decor: {}, buildings: [] };
    const trim = boundsOf(draftForBounds, 3, 3);
    const withTrim = renderTile(
      makeProject({ map: { rows: 3, cols: 3, seed: 5, cells, decor: {}, buildings: [], png: "map/map.png", pixel: stale } }),
      { stage: "map", brushKey: "dirt", mapDraft: draftForBounds }
    ).tree;
    const trimCells = byClassPart(withTrim, "SPR_mapCell");
    const mismatches = [];
    for (const [r, c] of [[0, 0], [0, 2], [2, 0], [1, 1], [2, 2]]) {
      const want = host.tileOriginAt(layout, r, c);
      const node = trimCells.find((n) => n.props.title.startsWith(`${r},${c} · `));
      const got = { x: Number.parseFloat(node.props.style.left), y: Number.parseFloat(node.props.style.top) };
      // 叠层坐标 = 未裁坐标 − 现算的裁剪偏移
      if (got.x !== want.x - trim.left || got.y !== want.y - trim.top) {
        mismatches.push(`(${r},${c}) 界面 ${got.x},${got.y} vs 期望 ${want.x - trim.left},${want.y - trim.top}`);
      }
    }
    check("叠层坐标 = 宿主 tileOriginAt − 现算的裁剪偏移", mismatches.length === 0, mismatches.join(" | "));
    check("叠层画布尺寸 = 现算的包围盒（**不是** map.pixel）",
      Number.parseFloat(byClassPart(withTrim, "SPR_mapEditorCanvas")[0]?.props.style.width) !== stale.width &&
      Number.parseFloat(byClassPart(withTrim, "SPR_mapEditorCanvas")[0]?.props.style.height) !== stale.height,
      `界面 ${byClassPart(withTrim, "SPR_mapEditorCanvas")[0]?.props.style.width}×${byClassPart(withTrim, "SPR_mapEditorCanvas")[0]?.props.style.height}` +
      ` 不该等于过期的 ${stale.width}×${stale.height}`);
    check("stepY 用的是菱形高（cellWidth/4）而不是 cellHeight/4",
      layout.stepY === (64 / 4) * 2 && layout.stepY !== (96 / 4) * 2,
      `stepY=${layout.stepY}`);
    // ★ 老项目没有 `map.pixel`，而且**有 `pixel` 也不用**：
    // 偏移一律按草稿内容现算。所以这条断言改成「与现算偏移一致」，
    // 而不是「与未裁坐标一致」—— 后者是引入现算之前的旧口径。
    const plainDraft = { ground: cells, decor: {}, buildings: [] };
    const plainTrim = boundsOf(plainDraft, 3, 3);
    const plain = host.tileOriginAt(layout, 0, 0);
    check("老项目（没有 map.pixel）也按现算偏移对齐",
      Number.parseFloat(cellNodes[0]?.props.style.left) === plain.x - plainTrim.left &&
      Number.parseFloat(cellNodes[0]?.props.style.top) === plain.y - plainTrim.top,
      `界面 ${cellNodes[0]?.props.style.left},${cellNodes[0]?.props.style.top} vs ${plain.x - plainTrim.left},${plain.y - plainTrim.top}`);
    // 而且**不能**等于「未裁坐标」—— 那说明它退回了旧口径
    check("老项目不会退回「未裁坐标」的旧口径",
      Number.parseFloat(cellNodes[0]?.props.style.top) !== plain.y,
      `界面 top=${cellNodes[0]?.props.style.top} 未裁=${plain.y}`);
  }

  // ★ 黄金对照：界面那份**手抄的**裁剪矩形公式必须与宿主 `measureAssemblyBounds`
  // 算出同一个值。
  //
  // 浏览器半区不能 import 宿主代码，所以这段几何是「抄」过去的 ——
  // 一旦宿主改了公式（改地面菱形内缩、改建筑包围盒口径），界面就会悄悄错位，
  // 表现正是「房子整体上移一格 / 点到的格子和涂到的不是同一格」。
  // 这里拿宿主真实现比对同一组输入，把两边钉在一起。
  {
    const host = await import("../lib/tilemap.js");
    const settings = { cellWidth: 64, cellHeight: 96 };
    // 造一份宿主认识的 lookup（只需要 width/height/baseFraction）
    const lookup = new Map([
      ["grass#0", { width: 64, height: 96 }],
      ["tree#0", { width: 64, height: 96 }],
      ["building#0", { width: 128, height: 122, baseFraction: 0.68 }]
    ]);
    const cases = [
      { name: "只有地面", state: { rows: 4, cols: 4, seed: 1, cells: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => "grass")), decor: {}, buildings: [], buildingGround: [] }, families: { grass: ["grass#0"] } },
      { name: "地面 + 装饰", state: { rows: 4, cols: 4, seed: 1, cells: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => "grass")), decor: { "1,1": "tree#0" }, buildings: [], buildingGround: [] }, families: { grass: ["grass#0"] } },
      { name: "地面 + 2×2 建筑", state: { rows: 6, cols: 6, seed: 1, cells: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => "grass")), decor: {}, buildings: [[2, 2, "building#0"]], buildingGround: [[2, 2, 2, 2, "grass#0"]] }, families: { grass: ["grass#0"] } }
    ];
    for (const one of cases) {
      // ⚠️ 宿主量的是 **1× 交付前**的坐标，界面用 **2× 交付尺寸**的坐标
      // （宿主 `runMapStage` 里 `upscale(trimmed, 2)`）。所以比对前要把宿主那份 ×2。
      const hostBounds = host.measureAssemblyBounds(lookup, one.state, { settings, families: one.families });
      const want = { left: hostBounds.left * 2, top: hostBounds.top * 2 };
      const draft = {
        ground: one.state.cells,
        decor: Object.fromEntries(Object.entries(one.state.decor).map(([k, v]) => [k, v.split("#")[0]])),
        buildings: one.state.buildings.map(([r, c]) => ({ r, c, fw: 2, fh: 2, ratio: 122 / 128, baseFraction: 0.68 }))
      };
      const got = boundsOf(draft, one.state.rows, one.state.cols);
      check(`★ 界面与宿主裁剪矩形一致：${one.name}`,
        got.left === want.left && got.top === want.top,
        `界面 left=${got.left} top=${got.top} vs 宿主×2 ${want.left} ${want.top}`);
    }
  }

  // ★ 黄金对照：界面那份**手抄的**形状公式必须与宿主 `shapeBaseOffset` /
  // `shapeDiamondHalf` 算出同一个值（含 L 形）。
  //
  // 浏览器半区不能 import 宿主代码，所以形状几何是「抄」过去的。宿主改了公式
  // 而界面没跟，就会重演「建筑错半格 / L 形错位」那类问题。这里把两边钉死。
  {
    const TM = await import("../lib/tilemap.js");
    const cw = 64;
    const shapes = [
      ["1×1", [[0, 0]]],
      ["2×2", [[0, 0], [0, 1], [1, 0], [1, 1]]],
      ["3×1", [[0, 0], [0, 1], [0, 2]]],
      ["1×3", [[0, 0], [1, 0], [2, 0]]],
      ["L 形", [[0, 0], [1, 0], [1, 1]]],
      ["T 形", [[0, 0], [0, 1], [0, 2], [1, 1]]],
      ["十字", [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]]
    ];
    const bad = [];
    const badW = [];
    for (const [name, shape] of shapes) {
      const host = TM.shapeBaseOffset(shape, cw);
      const ui = shapeOffsetExpect(shape, cw / 2, cw / 4);
      if (Math.abs(host.dx - ui.dx) > 1e-9 || Math.abs(host.dy - ui.dy) > 1e-9) {
        bad.push(`${name}: 界面(${ui.dx},${ui.dy}) 宿主(${host.dx},${host.dy})`);
      }
      const hostW = TM.shapeDiamondHalf(shape, cw).halfW * 2;
      const xs = shape.map(([r, c]) => c - r);
      const uiW = (Math.max(...xs) - Math.min(...xs)) * (cw / 2) + cw;
      if (Math.abs(hostW - uiW) > 1e-9) badW.push(`${name}: 界面 ${uiW} 宿主 ${hostW}`);
    }
    check("★ 黄金对照：形状底心偏移界面 = 宿主（含 L/T/十字）", bad.length === 0, bad.join(" | "));
    check("★ 黄金对照：形状包围菱形宽度界面 = 宿主", badW.length === 0, badW.join(" | "));
  }

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
  const g0 = renderTile(makeProject(), { stage: "generate" }).tree;
  click(g0, "生成全部地块");
  await new Promise((r) => setTimeout(r, 20));
  check("点击「生成全部地块」调用了 runTileItems",
    CALLS.some((c) => c.name === "runTileItems" && c.payload?.projectId === "tabc123"),
    CALLS.map((c) => c.name).join(", "));
  // ★ 参考图没有单独的远程方法了 —— 它在 runTileItems 里自动准备。
  // 界面上不该再有任何「生成模板」入口。
  check("★ 界面上没有 runTileTemplate 这个调用面了",
    !CALLS.some((c) => c.name === "runTileTemplate") &&
    !readFileSync(target, "utf8").includes("runTileTemplate"),
    CALLS.map((c) => c.name).join(", "));

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


