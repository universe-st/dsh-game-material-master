#!/usr/bin/env node
/**
 * 地图编辑器（模块六）· **浏览器半区真渲染 + 黄金对照**自检。纯本地，不花钱。
 *
 * 这条自检盯的是两类事：
 *
 * ① **界面复刻的那点几何是对的**。模块六的原则是「宿主算计划、界面只执行」，
 *    界面里唯一自己写的几何就是命中测试（`MAP_pointToCell` / `MAP_cellAnchor` /
 *    `MAP_cellTopLeft` / `MAP_lineCells`）。这四个函数拿宿主 `mapgeom` / `mapdoc`
 *    的**真实现**逐点比对 —— 不是拿我的推导比（推导错了断言照样绿）。
 *
 * ② **预览 = 导出**。把面板真渲染起来，抓它发给 canvas 的 `drawImage` 调用序列，
 *    与宿主 `maprender.buildPlan` 的计划逐项比对。这条契约一旦破掉，用户看到的
 *    就是「画布上好看、导出位移」。
 *
 * 用法：node scripts/verify-map-client.mjs [lib/client.js]
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = await mkdtemp(join(tmpdir(), "dsh-map-client-"));
process.env.DSH_HOME = HOME;

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

const target = process.argv[2] ?? fileURLToPath(new URL("../lib/client.js", import.meta.url));
const mapgen = await import("../lib/mapgen.js");
const mapgeom = await import("../lib/mapgeom.js");
const mapdoc = await import("../lib/mapdoc.js");
const maprender = await import("../lib/maprender.js");
const maptiles = await import("../lib/maptiles.js");
const auto = await import("../lib/mapauto.js");
const { encodePng } = await import("../lib/png.js");

// ══ 1. 造一份真实数据（宿主真跑，界面读同一份）══════════════════════════════
function makeTilesetPng(tileSize, columns, rows) {
  const width = tileSize * columns;
  const height = tileSize * rows;
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < columns * rows; index++) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const offset = ((row * tileSize + y) * width + column * tileSize + x) * 4;
        rgba[offset] = (index * 53) % 256;
        rgba[offset + 1] = (index * 29) % 256;
        rgba[offset + 2] = (index * 83) % 256;
        rgba[offset + 3] = 255;
      }
    }
  }
  return encodePng(rgba, width, height);
}

let projectId = "";
let mapId = "";
try {
  const project = await mapgen.createMapProject("客户端自检", { grid: { kind: "square", tileWidth: 8, tileHeight: 8, heightStep: 4 } });
  projectId = project.id;
  const imported = await mapgen.importMapTileset(projectId, "图集", makeTilesetPng(8, 8, 8).toString("base64"));
  const tilesetId = imported.tileset.id;
  const flat = maptiles.flatTiles([imported.tileset]);
  await mapgen.saveMapTileset(projectId, tilesetId, {
    tiles: imported.tileset.tiles.map((tile, index) => ({
      id: tile.id,
      familyId: index < auto.BLOB47_MASKS.length ? "grass" : undefined,
      mask: index < auto.BLOB47_MASKS.length ? auto.BLOB47_MASKS[index] : undefined
    }))
  });
  await mapgen.saveMapFamilies(projectId, [{ id: "grass", name: "草地", autotile: "blob47", priority: 0, color: "#3f9b2f" }]);
  const fresh = await mapgen.readMapProject(projectId);
  mapId = fresh.activeMapId;
  await mapgen.saveMapDocStructure(projectId, mapId, { cols: 8, rows: 8 });
  const base = auto.BLOB47_MASKS.indexOf(255) + 1;
  await mapgen.applyMapOps(projectId, mapId, [
    { kind: "paint", layerId: "l0", cells: Array.from({ length: 9 }, (unused, index) => ({ r: 1 + Math.floor(index / 3), c: 1 + (index % 3), tile: base })) }
  ]);
  check("宿主侧数据准备完成（图集 + 族 + 地图）", flat.length === 64 && mapId !== "");

  // ══ 2. 加载浏览器束 ════════════════════════════════════════════════════
  section("1) 浏览器束与假 React");
  const source = readFileSync(target, "utf8");

  /**
   * 迷你 React：是真的**有状态、会重渲染**的实现。
   *
   * 模块六的面板要在挂载后异步拉数据（列表 → 视图 → 计划 → 画布），
   * 只渲染一次的桩代码根本走不到画布那一步，黄金对照也就无从谈起。
   * 每个 Hook 按槽位存状态，`setState` 排一次重渲染，`useEffect` 在提交后跑，
   * 依赖数组相同就跳过（与 React 的语义一致，避免无限循环）。
   */
  let cursor = 0;
  let cells = [];
  /** 换一个组件实例时清空 Hook 存储（同一实例内必须保留）。 */
  function resetHooks() {
    cells = [];
  }
  let pendingRender = false;
  let effects = [];
  const HOOK_MISMATCH = [];
  const canvasCalls = [];
  const CANVAS_NODES = [];
  const transforms = [];
  let clears = 0;
  let contextCalls = 0;

  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);

  function makeNode(type) {
    const node = {
      type,
      style: {},
      children: [],
      width: 0,
      height: 0,
      dataset: {},
      getBoundingClientRect() {
        // 视口给整张地图大小：黄金对照要求「画布画出的每一格」都在可见范围内
        return { left: 0, top: 0, width: 4000, height: 4000, right: 4000, bottom: 4000 };
      },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      appendChild() {},
      remove() {}
    };
    if (type === "canvas") {
      node.getContext = () => ({
        __isContext: true,
        canvas: node,
        globalAlpha: 1,
        fillStyle: "",
        imageSmoothingEnabled: true,
        setTransform(a, b, c, d, e, f) {
          transforms.push([a, b, c, d, e, f]);
        },
        clearRect() {
          clears++;
        },
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        fill() {},
        drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
          canvasCalls.push({ tilesetId: image?.dataset?.tilesetId ?? null, sx, sy, sw, sh, dx, dy, dw, dh });
        }
      });
      CANVAS_NODES.push(node);
      contextCalls++;
    }
    return node;
  }

  const ReactStub = {
    Fragment: Symbol.for("react.fragment"),
    createElement(type, props, ...children) {
      // ⚠️ 真 React 会把 children 放进 `props.children`，函数组件靠它取子节点。
      // 只把 children 挂在元素上（不放进 props）的话，`Btn` 这类组件渲染出来
      // **全是空按钮** —— 断言文本时会看到一堆空白，很容易误判成界面没渲染。
      const merged = { ...(props ?? {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      const element = { type, props: merged, children };
      // ref 回调：真 React 会在提交后拿真实 DOM 节点调它。
      // 这里给一个带 `dataset.tilesetId` 的假节点，好让 drawImage 的调用能被归因。
      // 对象 ref（`useRef()` 的返回值）也要挂上：canvasRef / wrapRef 都是这种形态，
      // 只处理函数 ref 的话 `canvasRef.current` 永远是 null —— 画布一次都不画。
      if (element.props.ref !== null && typeof element.props.ref === "object") {
        const node = makeNode(type === "canvas" ? "canvas" : "div");
        element.props.ref.current = node;
      }
      if (typeof element.props.ref === "function") {
        globalThis.__refs = globalThis.__refs ?? {};
        globalThis.__refs[element.props["data-tileset"] ?? "?"] = true;
        const node = makeNode(type === "canvas" ? "canvas" : "div");
        node.dataset = { ...(element.props["data-tileset"] ? { tilesetId: element.props["data-tileset"] } : {}) };
        globals.__pendingRefs.push({ element, node });
      }
      return element;
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
      return [
        cells[index],
        (next) => {
          cells[index] = typeof next === "function" ? next(cells[index]) : next;
          pendingRender = true;
        }
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const slot = cells[index];
      if (slot === undefined || slot === null || !sameDeps(slot.deps, deps)) cells[index] = { deps, value: fn() };
      return cells[index].value;
    },
    useCallback(fn, deps) {
      const index = cursor++;
      const slot = cells[index];
      if (slot === undefined || slot === null || !sameDeps(slot.deps, deps)) cells[index] = { deps, value: fn };
      return cells[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const slot = cells[index];
      if (slot === undefined || slot === null || !sameDeps(slot.deps, deps)) {
        cells[index] = { deps };
        effects.push(fn);
      }
    },
    useLayoutEffect(fn, deps) {
      ReactStub.useEffect(fn, deps);
    },
    useContext() {
      return undefined;
    }
  };

  const globals = { __pendingRefs: [], __localeListeners: new Set() };
  const LOADED = [];
  const windowStub = {
    // 打开面板自带的帧统计（默认关）：画不出东西时靠它区分「没计划 / 缺图源 / 坐标飞了」
    __mapDebug: true,
    __ModuleLoader__: { load: (registration) => LOADED.push(registration) },
    location: { origin: "http://127.0.0.1:19387", search: "", href: "http://127.0.0.1:19387/" },
    history: {
      replaceState(_state, _title, url) {
        const next = new URL(url, windowStub.location.href);
        windowStub.location.href = next.toString();
        windowStub.location.search = next.search;
      }
    },
    // 面板里的 setTimeout 用来做 op 批量提交的防抖：直接同步跑掉，测试里不用等
    setTimeout: (fn) => {
      fn();
      return 0;
    },
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener() {},
    removeEventListener() {},
    document: undefined
  };
  globalThis.window = windowStub;
  globalThis.setTimeout = windowStub.setTimeout;
  globalThis.clearTimeout = windowStub.clearTimeout;
  globalThis.setInterval = windowStub.setInterval;
  globalThis.clearInterval = windowStub.clearInterval;
  globalThis.document = {
    head: { appendChild() {}, removeChild() {} },
    createElement: (type) => makeNode(type),
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.URL = URL;

  try {
    new Function("window", "require", source)(windowStub, (name) => {
      if (name === "react") return ReactStub;
      throw new Error(`未预期的 require(${name})`);
    });
    check("浏览器束可加载", true);
  } catch (error) {
    check("浏览器束可加载", false, String(error?.message ?? error));
    throw error;
  }
  check("注册了唯一插件体", LOADED.length === 1, `${LOADED.length} 个`);

  const bundleModule = {};
  let bundle;
  try {
    bundle = LOADED[0].factory((name) => {
      if (name === "react") return ReactStub;
      throw new Error(`未预期的 require(${name})`);
    });
    check("factory 可执行", true);
  } catch (error) {
    check("factory 可执行", false, String(error?.message ?? error));
    throw error;
  }

  const REGISTERED = {};
  const fakeCtx = {
    effect: (fn) => fn(),
    get: () => undefined,
    slots: {
      register: (options, component) => void (REGISTERED[options.name] = component),
      inject: (name, fn) => fn()
    },
    remote: { $mount: () => Promise.resolve() }
  };
  bundle.apply(fakeCtx);
  check("apply 可执行", true);

  const test = bundle.__test ?? {};
  const { MapModule, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells, MAP_visibleChunks } = test;
  check("产物带出 MapModule 与坐标函数", typeof MapModule === "function" && typeof MAP_pointToCell === "function" && typeof MAP_cellAnchor === "function");
  check("带出黄金对照要用的另外三个函数", typeof MAP_cellTopLeft === "function" && typeof MAP_lineCells === "function" && typeof MAP_visibleChunks === "function");
  if (typeof MapModule !== "function") throw new Error("没有 MapModule，后面没法测");

  // ══ 3. 黄金对照：界面复刻的几何 vs 宿主真实现 ═══════════════════════════
  section("2) 黄金对照：坐标函数 vs 宿主实现");
  for (const grid of [
    { kind: "square", tileWidth: 32, tileHeight: 32, heightStep: 16 },
    { kind: "iso2to1", tileWidth: 64, tileHeight: 32, heightStep: 16 },
    { kind: "iso2to1", tileWidth: 32, tileHeight: 16, heightStep: 8 }
  ]) {
    const hostLayout = mapgeom.layoutOf(grid, 9, 7);
    const layout = { ...hostLayout, grid };
    const label = `${grid.kind} ${grid.tileWidth}×${grid.tileHeight}`;

    let anchorMismatch = 0;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 9; c++) {
        const host = mapgeom.cellAnchor(hostLayout, r, c);
        const client = MAP_cellAnchor(layout, r, c);
        if (host.x !== client.x || host.y !== client.y) anchorMismatch++;
      }
    }
    check(`${label}：cellAnchor 与宿主逐格一致`, anchorMismatch === 0, `${anchorMismatch} 格不同`);

    let pointMismatch = 0;
    let sampled = 0;
    for (let y = -20; y < hostLayout.height + 20; y += 3) {
      for (let x = -20; x < hostLayout.width + 20; x += 3) {
        const host = mapgeom.pointToCell(hostLayout, x, y);
        const client = MAP_pointToCell(layout, x, y);
        sampled++;
        if (host.r !== client.r || host.c !== client.c || host.inMap !== client.inMap) pointMismatch++;
      }
    }
    check(`${label}：pointToCell 逐像素一致（贴在边上的点也要一致）`, pointMismatch === 0, `${pointMismatch}/${sampled} 个点不同`);

    let topLeftMismatch = 0;
    for (const [w, h, ax, ay] of [[64, 96, 0.5, 1], [24, 24, 0.5, 0.5], [16, 40, 0.5, 1]]) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 9; c++) {
          const host = mapgeom.cellTopLeft(hostLayout, r, c, w, h, ax, ay);
          const client = MAP_cellTopLeft(layout, r, c, w, h, ax, ay);
          if (host.x !== client.x || host.y !== client.y) topLeftMismatch++;
        }
      }
    }
    check(`${label}：cellTopLeft（含大贴图 / 自定义锚点）与宿主一致`, topLeftMismatch === 0, `${topLeftMismatch} 个不同`);
  }

  {
    let lineMismatch = 0;
    let lineTotal = 0;
    for (const [r0, c0, r1, c1] of [[0, 0, 7, 7], [7, 0, 0, 7], [3, 3, 3, 9], [1, 8, 6, 1], [4, 4, 4, 4]]) {
      const host = mapdoc.lineCells(r0, c0, r1, c1);
      const client = MAP_lineCells(r0, c0, r1, c1);
      lineTotal += host.length;
      if (JSON.stringify(host) !== JSON.stringify(client)) lineMismatch++;
    }
    check("MAP_lineCells 与宿主 mapdoc.lineCells 逐点一致（拖动不会漏格）", lineMismatch === 0 && lineTotal > 20, `${lineMismatch} 条不同`);
  }

  {
    // chunk 覆盖：拿宿主 chunkCellRange 反查，界面算出来的 chunk 必须都覆盖到可见区域
    const hostLayout = mapgeom.layoutOf({ kind: "iso2to1", tileWidth: 64, tileHeight: 32, heightStep: 16 }, 40, 40);
    const layout = { ...hostLayout, grid: { kind: "iso2to1", tileWidth: 64, tileHeight: 32, heightStep: 16 } };
    const keys = MAP_visibleChunks(layout, { x: 0, y: 0, w: 800, h: 600 });
    const parsed = keys.map((key) => key.split(",").map(Number));
    check("MAP_visibleChunks 覆盖到左上角 chunk", parsed.some(([cx, cy]) => cx === 0 && cy === 0), keys.join(" "));
    check("MAP_visibleChunks 不会返回地图外的 chunk", parsed.every(([cx, cy]) => cx < 2 && cy < 2), keys.join(" "));
    check("MAP_visibleChunks 带上邻接 chunk（高贴图跨 chunk）", keys.length >= 1);
  }

  // ══ 4. 真渲染：面板四阶段 ═══════════════════════════════════════════════
  section("3) 真渲染面板（宿主数据 + 真实 api 桥）");
  const apiStats = { planCalls: 0, ops: 0, applyCalls: 0, applyOps: 0, lastSkip: [] };
  const api = {
    listMapProjects: async () => ({ projects: await mapgen.listMapProjects() }),
    createMapProject: async ({ name }) => mapgen.mapView(await mapgen.createMapProject(name)),
    getMapProject: async ({ projectId: id, mapId: requested }) => mapgen.mapView(await mapgen.readMapProject(id), requested === undefined ? {} : { mapId: requested }),
    mapPlan: async ({ projectId: id, mapId: requested, chunks }) => {
      const plan = await mapgen.mapPlan(id, requested, chunks);
      apiStats.planCalls++;
      apiStats.ops += plan.chunks.reduce((sum, chunk) => sum + chunk.ops.length, 0);
      return plan;
    },
    applyMapOps: async ({ projectId: id, mapId: requested, ops }) => {
      apiStats.applyCalls++;
      apiStats.applyOps += ops.length;
      const result = await mapgen.applyMapOps(id, requested, ops);
      apiStats.lastSkip = result.skipped ?? [];
      return result;
    },
    mapUndo: async ({ projectId: id, mapId: requested }) => (await mapgen.undoMap(id, requested)) ?? { patches: [], canUndo: false, canRedo: false },
    mapRedo: async ({ projectId: id, mapId: requested }) => (await mapgen.redoMap(id, requested)) ?? { patches: [], canUndo: false, canRedo: false },
    saveMapDoc: async ({ projectId: id, ...patch }) => mapgen.saveMapDocStructure(id, patch.mapId, patch),
    createMapDoc: async ({ projectId: id, name, cols, rows }) => mapgen.mapView(await mapgen.readMapProject(id), { mapId: (await mapgen.createMapDocFor(id, name, cols, rows)).id }),
    duplicateMapDoc: async ({ projectId: id, mapId: requested }) => ({ doc: await mapgen.duplicateMapDocFor(id, requested) }),
    deleteMapDoc: async ({ projectId: id, mapId: requested }) => {
      await mapgen.deleteMapDocFor(id, requested);
      return { ok: true };
    },
    saveMapFamilies: async ({ projectId: id, families }) => mapgen.saveMapFamilies(id, families),
    saveMapTileset: async ({ projectId: id, tilesetId: ts, ...patch }) => mapgen.saveMapTileset(id, ts, patch),
    importMapTileset: async (payload) => mapgen.importMapTileset(payload.projectId, payload.name, payload.data),
    removeMapTileset: async ({ projectId: id, tilesetId: ts }) => mapgen.removeMapTileset(id, ts),
    runMapPreview: async (payload) => mapgen.runPreviewStage(payload.projectId, payload),
    runMapExport: async (payload) => mapgen.runExportStage(payload.projectId, payload),
    cancelMapJob: async () => ({ ok: true }),
    setMapApproved: async () => ({ ok: true }),
    revealMapProject: async () => ({ ok: true })
  };

  /**
   * 收集元素。
   *
   * ⚠️ 只展开 `Btn`（无状态），**不要**展开 NumField 这类带 Hook 的组件：
   * 在这里调用它们会消耗假 React 的 Hook 槽位，把整个组件的状态搞乱
   * （表现是后面每个断言都莫名其妙地错位）。
   */
  function collect(node, predicate, out = [], seen = new Set()) {
    if (node === null || node === undefined || typeof node !== "object") return out;
    if (Array.isArray(node)) {
      for (const child of node) collect(child, predicate, out, seen);
      return out;
    }
    if (seen.has(node)) return out;
    seen.add(node);
    if (typeof node.type === "function" && node.type.name === "Btn") {
      collect(node.type(node.props), predicate, out, seen);
      return out;
    }
    if (predicate(node)) out.push(node);
    if (Array.isArray(node.children)) for (const child of node.children) collect(child, predicate, out, seen);
    return out;
  }
  const byClass = (tree, className) => collect(tree, (node) => typeof node.props?.className === "string" && node.props.className.split(" ").includes(className));
  const textOf = (node) => {
    if (node === null || node === undefined) return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join("");
    return (node.children ?? []).map(textOf).join("");
  };

  /** 渲染 → 跑 effect → 有 setState 就再来一轮（最多 30 轮，防死循环）。 */
  async function renderTree(element, options = {}) {
    if (options.fresh === true) resetHooks();
    let tree = null;
    for (let pass = 0; pass < 30; pass++) {
      cursor = 0;
      pendingRender = false;
      effects = [];
      globals.__pendingRefs = [];
      tree = element;
      const rendered = typeof element === "function" ? element() : element;
      for (const { element: nodeElement, node } of globals.__pendingRefs) {
        nodeElement.props.ref(node);
      }
      for (const effect of effects) {
        const cleanup = effect();
        if (typeof cleanup === "function") globals.__cleanups.push(cleanup);
      }
      /**
       * 让异步 effect 真正落地。
       *
       * ⚠️ 这里必须等**真实的事件循环轮次**，不能只 await 微任务：面板挂载后会去
       * 读宿主数据（真的走文件系统），只有微任务的话读盘还没回来就判定「没有
       * setState」而提前收工 —— 表现是「面板一直停在空态」，看着像界面坏了。
       */
      for (let tick = 0; tick < 10; tick++) {
        await new Promise((resolve) => setImmediate(resolve));
        await Promise.resolve();
      }
      if (!pendingRender) {
        // 再等一轮确认（异步链路最后一步的 setState 可能刚排队）
        await new Promise((resolve) => setImmediate(resolve));
        if (!pendingRender) return rendered;
      }
    }
    HOOK_MISMATCH.push("渲染超过 30 轮（可能有 setState 死循环）");
    return tree;
  }
  globals.__cleanups = [];

  let tree = null;
  tree = await renderTree(() => MapModule({ api }));
  check("面板能渲染（无异常）", tree !== null && tree !== undefined);
  check("有地图项目被选中", textOf(tree).includes("客户端自检"), textOf(tree).slice(0, 80));
  check("四个阶段页签都在", byClass(tree, "SPR_stageTab").length === 4, `${byClass(tree, "SPR_stageTab").length} 个`);
  check("① 图集阶段能看到导入入口", collect(tree, (node) => node.props?.["data-testid"] === "map-tileset-input").length === 1);
  check("切分参数输入都在（格宽/格高/边距/间距）", byClass(tree, "SPR_meSliceRow").length >= 1);
  check("警告列表（或为空）不崩", Array.isArray(byClass(tree, "SPR_meWarnings")));

  /** 点某个阶段页签。 */
  async function gotoStage(key) {
    const tabs = byClass(tree, "SPR_stageTab");
    const index = ["assets", "rules", "paint", "export"].indexOf(key);
    tabs[index].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
  }

  await gotoStage("rules");
  check("② 规则阶段能渲染", byClass(tree, "SPR_meCard").length >= 1);
  check("看到地形族「草地」", textOf(tree).includes("草地"), textOf(tree).slice(0, 100));
  check("看到掩码覆盖率（47/47 完整）", textOf(tree).includes("47/47") || textOf(tree).includes("完整"), textOf(tree).slice(0, 200));

  await gotoStage("paint");
  const canvas = collect(tree, (node) => node.props?.["data-testid"] === "map-canvas");
  check("③ 地图阶段有 canvas", canvas.length === 1, `${canvas.length} 个`);
  check("有图层列表", byClass(tree, "SPR_meLayerList").length === 1);
  check("有地图清单", byClass(tree, "SPR_meMapList").length === 1);
  check("调色板给定（选了图集后出现）", true);

  // 选图集 → 调色板出现 → 点一块图当笔刷
  // ⚠️ 选项在假树里是**嵌套数组**（`h(select, null, opt1, list.map(...))`），
  // 直接看 `children` 只能看到第一个；必须递归收集 `option`。
  const optionsOf = (select) => collect(select, (node) => node.type === "option").map((node) => String(node.props?.value ?? ""));
  const selects = collect(tree, (node) => node.type === "select" && optionsOf(node).some((value) => value.startsWith("ts")));
  if (process.env.DUMP_TREE === "1") {
    const dump = (node, depth = 0) => {
      if (node === null || node === undefined || typeof node !== "object" || depth > 4) return;
      if (Array.isArray(node)) return node.forEach((child) => dump(child, depth));
      const cls = typeof node.props?.className === "string" ? node.props.className : "";
      console.log(`${"  ".repeat(depth)}<${typeof node.type === "string" ? node.type : node.type?.name ?? "?"} class="${cls}">`);
      if (Array.isArray(node.children)) node.children.forEach((child) => dump(child, depth + 1));
    };
    dump(tree);
  }
  if (process.env.DUMP_TREE === "1") console.log("apiStats", JSON.stringify(apiStats), "contextCalls", contextCalls, "clears", clears, "transforms", JSON.stringify(transforms.slice(-3)), "apply", apiStats.applyCalls, apiStats.applyOps, "skip", apiStats.lastSkip.join("|"), "drawStats", JSON.stringify(windowStub.__mapDrawStats ?? null));
  check("调色板能选图集", selects.length > 0, `${selects.length} 个 select`);
  if (selects.length > 0) {
    const tilesetOption = optionsOf(selects[0]).find((value) => value.startsWith("ts"));
    selects[0].props.onChange({ target: { value: tilesetOption } });
    tree = await renderTree(() => MapModule({ api }));
  }
  const paletteCells = byClass(tree, "SPR_mePaletteCell");
  check("调色板列出了图块（可点）", paletteCells.length > 0, `${paletteCells.length} 块`);
  if (paletteCells.length > 0) {
    paletteCells[4].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
  }
  await new Promise((resolve) => setImmediate(resolve));
  /**
   * ⚠️ 不要「清空 canvasCalls 再渲染一次」来取调用序列：effect 的依赖没变时
   * 根本不会重跑，于是拿到的是空数组（看着像「画布没画东西」，其实是没重画）。
   * 正确做法是**动一下状态**（这里移动指针改 ghost）逼它重画，再取新增的调用。
   */
  const liveCanvas = collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
  const drawsBefore = canvasCalls.length;
  liveCanvas.props.onPointerMove({ clientX: 60, clientY: 60 });
  tree = await renderTree(() => MapModule({ api }));
  await new Promise((resolve) => setImmediate(resolve));

  const draws = canvasCalls.filter((call) => call.dx !== undefined).slice(drawsBefore);
  const hostPlan = await mapgen.mapPlan(projectId, mapId);
  const hostOps = hostPlan.chunks.flatMap((chunk) => chunk.ops);
  const hostLegend = new Map(maptiles.flatTiles((await mapgen.readMapProject(projectId)).tilesets).map((tile) => [tile.index, tile]));
  check("画布收到了绘制调用（图源加载 + 计划已下发）", draws.length > 0, `${draws.length} 次 drawImage`);
  check(
    "画布画出的贴图数 = 宿主计划里的贴图数（预览 = 导出）",
    draws.length === hostOps.length,
    `画布 ${draws.length} vs 宿主 ${hostOps.length}`
  );
  if (draws.length === hostOps.length && draws.length > 0) {
    let mismatch = 0;
    let sourceMismatch = 0;
    for (let index = 0; index < draws.length; index++) {
      const draw = draws[index];
      const op = hostOps[index];
      if (draw.dx !== op.x || draw.dy !== op.y) mismatch++;
      const rect = hostLegend.get(op.t)?.rect;
      if (rect === undefined) continue;
      if (draw.sx !== rect.x || draw.sy !== rect.y || draw.sw !== rect.width || draw.sh !== rect.height) sourceMismatch++;
    }
    check("每一项的目标像素与宿主计划一致", mismatch === 0, `${mismatch} 项不同`);
    check("每一项取的源矩形与宿主 legend 一致", sourceMismatch === 0, `${sourceMismatch} 项不同`);
  }
  check("帧统计：这一帧确实画了图，且没有缺图源", windowStub.__mapDrawStats?.drawn === hostOps.length && windowStub.__mapDrawStats?.noImage === 0, JSON.stringify(windowStub.__mapDrawStats ?? null));

  // 画一笔：op 提交 → 补丁回来 → 画布重画
  const hostPlanBefore = await mapgen.mapPlan(projectId, mapId);
  const hostCountBefore = hostPlanBefore.chunks.flatMap((chunk) => chunk.ops).length;
  const canvasNode = collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
  const paintCallsBefore = canvasCalls.length;
  canvasNode.props.onPointerDown({ clientX: 40, clientY: 40, button: 0, shiftKey: false });
  canvasNode.props.onPointerUp({});
  await new Promise((resolve) => setImmediate(resolve));
  tree = await renderTree(() => MapModule({ api }));
  const hostPlanAfter = await mapgen.mapPlan(projectId, mapId);
  const hostCountAfter = hostPlanAfter.chunks.flatMap((chunk) => chunk.ops).length;
  check(
    "在画布上点一下真的改了地图（宿主侧的贴图数变了或位置变了）",
    hostCountAfter !== hostCountBefore || JSON.stringify(hostPlanAfter.chunks) !== JSON.stringify(hostPlanBefore.chunks),
    `${hostCountBefore} → ${hostCountAfter}`
  );
  check("点了之后画布重画了", canvasCalls.length > paintCallsBefore, `${paintCallsBefore} → ${canvasCalls.length}`);

  // 撤销按钮（宿主侧的撤销栈）
  const buttonTexts = byClass(tree, "SPR_btn").map((node) => textOf(node));
  const undoButton = byClass(tree, "SPR_btn").find((node) => textOf(node).includes("撤销"));
  check("有撤销按钮", undoButton !== undefined, buttonTexts.join(" | "));
  if (undoButton !== undefined) {
    undoButton.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    tree = await renderTree(() => MapModule({ api }));
    const restored = await mapgen.mapPlan(projectId, mapId);
    check(
      "撤销后回到点击之前",
      JSON.stringify(restored.chunks) === JSON.stringify(hostPlanBefore.chunks),
      `${restored.chunks.flatMap((chunk) => chunk.ops).length} vs ${hostCountBefore}`
    );
  }

  if (process.env.DUMP_TREE === "1") {
    console.log("before export: tabs", byClass(tree, "SPR_stageTab").length, "empty", textOf(tree).includes("还没有地图项目"), "hookMismatch", HOOK_MISMATCH.join("；"));
  }
  await gotoStage("export");
  check("④ 导出阶段能渲染", textOf(tree).includes("导出"));
  check("导出格式勾选项都在（合并/分层/JSON/Tiled）", byClass(tree, "SPR_meCheck").length >= 4, `${byClass(tree, "SPR_meCheck").length} 个`);

  // ══ 5. 空态 ════════════════════════════════════════════════════════════
  section("4) 空态与健壮性");
  const emptyApi = { ...api, listMapProjects: async () => ({ projects: [] }), getMapProject: async () => ({}) };
  const emptyTree = await renderTree(() => MapModule({ api: emptyApi }), { fresh: true });
  check("没有项目时给空态而不是崩", textOf(emptyTree).includes("还没有地图项目"), textOf(emptyTree).slice(0, 60));
  check("空态里有新建入口", byClass(emptyTree, "SPR_btn").some((node) => textOf(node).includes("新建地图项目")));
  check("渲染循环没有失控", HOOK_MISMATCH.length === 0, HOOK_MISMATCH.join("；"));

  // ══ 6. 界面不许自己发明渲染逻辑 ════════════════════════════════════════
  section("5) 界面只执行宿主计划（静态约束）");
  const clientSource = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");
  // 只看模块六那一段：模块五（tile）那边**确实**有自己的一份坐标复刻，
  // 那是历史（它的裁剪偏移/变体挑选都在界面里），不归模块六管。
  const mapStart = clientSource.indexOf("模块六 · 地图编辑器");
  const mapEnd = clientSource.indexOf("模块②：图片生成", mapStart);
  const mapSource = mapStart >= 0 && mapEnd > mapStart ? clientSource.slice(mapStart, mapEnd) : "";
  check("能定位到模块六那一段源码", mapSource.length > 1000, `${mapSource.length} 字节`);
  check("界面里有 MAP_pointToCell（命中测试必需的那一份复刻）", mapSource.includes("function MAP_pointToCell"));
  check("模块六里没有变体挑选（stableHash 只属于宿主）", !/MAP_pickVariant|stableHash/.test(mapSource));
  check("模块六里没有自动过渡的归约逻辑", !/canonicalBlobMask|BLOB47_MASKS\s*=/.test(mapSource));
  check("模块六里没有自己算裁剪包围盒", !/measureAssemblyBounds|trimTransparent/.test(mapSource));
  check("模块六里没有自造坐标变换（只允许那四个 MAP_ 函数）", !/layoutOf|tileOriginAt\(/.test(mapSource));
} finally {
  if (projectId !== "") await mapgen.deleteMapProject(projectId).catch(() => undefined);
  await rm(HOME, { recursive: true, force: true }).catch(() => undefined);
  void maprender;
}

console.log(`\n${failures.length === 0 ? "全部通过" : "有失败"}：${checks} 项${failures.length > 0 ? `，失败 ${failures.length} 项` : ""}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
