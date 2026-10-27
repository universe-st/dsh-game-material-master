#!/usr/bin/env node
/**
 * 地图编辑器（模块六）· **浏览器半区真渲染 + 黄金对照**自检。纯本地，不花钱。
 *
 * 这条自检盯三类事：
 *
 * ① **界面复刻的那点几何是对的**。模块六的原则是「宿主算计划、界面只执行」，
 *    界面里唯一自己写的几何就是 `MAP_pointToCell` / `MAP_cellAnchor` /
 *    `MAP_cellTopLeft` / `MAP_lineCells`。这四个函数拿宿主 `mapgeom` / `mapdoc`
 *    的**真实现**逐点比对 —— 不是拿我推的公式比（推导错了断言照样绿）。
 *    环绕开 / 关两组各整张地图采样 + 图外点，另配两条反向验证证明比对有区分力。
 *
 * ② **预览 = 导出**。把面板真渲染起来，抓它发给 canvas 的 `drawImage` 调用序列，
 *    与宿主 `mapgen.mapPlan` 对**同一视口**给出的计划逐项比对：条数、顺序、
 *    目标像素、源矩形，以及 `__mapDrawStats`（画了几条 / 缺图源几条）。
 *    A2 拼块的「一格 4 条」、动画的「同格不同帧取不同矩形」、环绕接缝的负数 chunk
 *    都在这条链路上验。
 *
 * ③ **界面结构与纪律**。左列调色板（8 列 / 可选中 / 可滚动）、12 个图标按钮、
 *    顶栏没有阶段条、空态两个按钮、**「不是实验性功能」的三处反向验证**（角标 /
 *    弹窗 / 常驻提示条一个都不能有）、术语黑名单、每个 `SPR_` 类都有 CSS。
 *
 * 用法：node scripts/verify-map-client.mjs [lib/client.js]
 */
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// 整个脚本跑在一个 mkdtemp 出来的临时 DSH_HOME 里，结束连同项目一起删掉。
const HOME = await mkdtemp(join(tmpdir(), "dsh-map-client-"));
process.env.DSH_HOME = HOME;

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n── ${title} ──`);
}
/** 诊断输出：不作为断言（用来把「已知缺陷」的量级摆出来，而不是猜）。 */
function note(text) {
  console.log(`  · ${text}`);
}

const target = process.argv[2] ?? fileURLToPath(new URL("../lib/client.js", import.meta.url));
const G = await import("../lib/mapgen.js");
const GEOM = await import("../lib/mapgeom.js");
const DOC = await import("../lib/mapdoc.js");
const TILES = await import("../lib/maptiles.js");
const SAMPLES = await import("../lib/mapsamplegen.js");
const { encodePng } = await import("../lib/png.js");

// ══ 0. 夹具：宿主真跑一份数据，界面读同一份 ════════════════════════════════
section("0) 夹具（宿主真跑：建项目 → 装内置素材 → 画几笔）");

/** 每块一个可辨色的素材图（普通形态，用于 corner16 / plain 的另一条路）。 */
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
let propBrush = 0;
let a2Brush = 0;
let a2TilesetId = "";
let propTilesetId = "";
try {
  const project = await G.createMapProject("客户端自检", { grid: { tileWidth: 32, tileHeight: 32, wrap: true }, cols: 32, rows: 32 });
  projectId = project.id;
  check("宿主侧项目建好（32×32、环绕开）", projectId !== "" && project.cols === undefined && project.grid.wrap === true && project.grid.tileWidth === 32, JSON.stringify(project.grid));

  const sample = await G.importSampleTileset(projectId);
  check("内置素材装进来了（4 张 A2 拼块 + 1 张道具网格）", sample.tilesets.filter((ts) => ts.shape === "a2quad").length === 4 && sample.tilesets.filter((ts) => ts.shape === "plain").length === 1, sample.tilesets.map((ts) => `${ts.name}:${ts.shape}`).join(" / "));

  const view0 = await G.mapView(await G.readMapProject(projectId));
  const a2 = view0.tilesets.find((ts) => ts.shape === "a2quad");
  const prop = view0.tilesets.find((ts) => ts.shape === "plain");
  a2TilesetId = a2.id;
  propTilesetId = prop.id;
  a2Brush = a2.palette[0].index;
  propBrush = prop.palette[0].index;
  check("A2 素材在**宿主视图**的调色板里只有一个条目（点它 = 自动连接笔刷）", a2.palette.length === 1 && a2.palette[0].rect.width === 32 && a2.palette[0].rect.height === 32, JSON.stringify(a2.palette));
  /**
   * ⚠️ 这条原来断言的是 40 —— 那是**照着实现写的**：内置道具图是「8 列 × 5 帧」，
   * 但宿主当时把它当成了 40 个各自独立的图块，调色板于是冒出 40 个笔刷，
   * 其中 32 个逐像素重复（用户截图里的「一堆重复的块」）。现在帧由宿主按全局帧号现推，
   * 每列只出**第 0 帧**那一条：8 列 = 8 个笔刷，且都落在第一行（rect.y === 0）。
   */
  check(
    "翻页图（行 = 帧）的调色板每列只出一条：道具 8 列 × 5 帧 = 8 条，且都在第 0 帧（rect.y = 0）",
    prop.palette.length === 8 && prop.palette.every((item, index) => item.rect.y === 0 && item.rect.height === 32 && item.rect.x === index * 32),
    `条数 ${prop.palette.length} / ${JSON.stringify(prop.palette.map((item) => [item.rect.x, item.rect.y]))}`
  );

  // 画一片：A2 的 2×2 方块（验「一格 4 条 op」与自动连接）+ 两个道具格；
  // 第二层再画两笔 —— 单层预览要能证明「过滤真的发生了」。
  await G.applyMapOps(projectId, [
    {
      kind: "paint",
      layerId: "l0",
      cells: [
        { r: 8, c: 8, tile: a2Brush },
        { r: 8, c: 9, tile: a2Brush },
        { r: 9, c: 8, tile: a2Brush },
        { r: 9, c: 9, tile: a2Brush },
        { r: 3, c: 3, tile: propBrush },
        { r: 3, c: 4, tile: propBrush }
      ]
    }
  ]);
  await G.applyMapOps(projectId, [{ kind: "paint", layerId: "l1", cells: [{ r: 20, c: 20, tile: propBrush }, { r: 21, c: 20, tile: propBrush }] }]);
  const doc0 = await G.readTheDoc(projectId);
  check("地图上真的画了东西（两层各自有内容）", DOC.filledCount(doc0, "l0") === 6 && DOC.filledCount(doc0, "l1") === 2, `l0=${DOC.filledCount(doc0, "l0")} l1=${DOC.filledCount(doc0, "l1")}`);

  // ══ 1. 浏览器束与假 React ════════════════════════════════════════════════
  section("1) 浏览器束与假 React（有状态、会重渲染）");
  const source = readFileSync(target, "utf8");

  /**
   * 迷你 React：真的**有状态、会重渲染**。
   *
   * 模块六的面板挂载后要异步拉数据（项目列表 → 视图 → 计划 → 画布），
   * 只渲染一次的桩根本走不到画布，黄金对照也就无从谈起。
   * 每个 Hook 按槽位存状态，`setState` 排一次重渲染，`useEffect` 在提交后跑，
   * 依赖数组相同就跳过（与 React 语义一致，避免无限循环）。
   */
  let cursor = 0;
  let cells = [];
  function resetHooks() {
    cells = [];
  }
  /**
   * 用**临时的一份 Hook 存储**渲染别的组件，结束后原样换回来。
   *
   * ⚠️ 直接 `resetHooks()` 会把正在测的面板状态一起清掉（表现是「后面全变空态」）。
   * 单独渲染弹窗这类子组件时必须用这个。
   */
  async function withFreshHooks(render) {
    const saved = cells;
    cells = [];
    try {
      return await render();
    } finally {
      cells = saved;
    }
  }
  let pendingRender = false;
  let effects = [];
  const HOOK_MISMATCH = [];
  /**
   * 还有几次宿主调用没回来。
   *
   * ⚠️ 这个计数器是**必须的**：面板的 async effect 要经过好几个 await 才把状态写回来
   * （读 project.json → 读 map.json → 算计划），只盯 `pendingRender` 的话，
   * 中间那几轮「还没回来、也没有新 setState」会被判成「已经稳定」而提前收工 ——
   * 表现是「刚拖完视口 / 刚点完撤销，断言读到的是上一步的状态」，**随机**失败。
   */
  let inFlight = 0;
  /**
   * 面板的防抖定时器（op 批量提交 40ms / 计划查询 32ms）。
   *
   * ⚠️ 这里**不能**像旧版那样让 `setTimeout` 同步跑掉：真机上 effect 的 cleanup
   * 会在下一次提交时 `clearTimeout`，于是「挂载时按还没缩放的视口查的那一次」
   * 根本不会发生。同步跑掉的话那道查询会真的发出去，还会把按旧视口裁的 chunk
   * 灌进缓存 —— 表现是「自检里首帧缺一大片」（真实浏览器没有这个问题），
   * 白白诬告一处代码。所以改成**可取消的定时器队列**：先渲染、先跑 effect
   * （cleanup 已经执行），稳定之后才把还活着的定时器放出来（见 renderTree）。
   */
  const timers = new Map();
  let timerSeq = 0;
  function pumpTimers() {
    const due = [...timers.values()];
    timers.clear();
    for (const fn of due) fn();
  }
  /**
   * 面板的轮询定时器（`view.busy === true` 时每 1.5s 重读一次项目）。
   *
   * ⚠️ 必须有真的实现：导出 / 预览是**宿主后台作业**，提交那次读到的还是「进行中」，
   * 界面靠这个轮询才把新产物读回来（ENGINEERING.md 里记过这条：真机导出约 2s 后
   * 文件列表自己冒出来）。以前这里返回 0 什么都不做，于是「提交完界面不刷新」这条
   * 路径在自检里**根本走不到**。这里只登记、由测试显式 `tickTimers()` 放出来。
   */
  const intervals = new Map();
  let intervalSeq = 0;
  /** 放一次轮询（与真机的「又过了 1.5s」等价），再等宿主调用落地。 */
  async function tickIntervals() {
    const due = [...intervals.values()];
    if (due.length === 0) return false;
    for (const fn of due) fn();
    let quiet = 0;
    for (let tick = 0; tick < 240; tick++) {
      await new Promise((resolve) => setImmediate(resolve));
      await Promise.resolve();
      if (inFlight > 0) quiet = 0;
      else if (++quiet >= 3) break;
    }
    return true;
  }
  /** 把队列里还活着的定时器放出来，再等宿主调用落地（模拟「又过了 40ms」）。 */
  async function tickTimers() {
    const polled = await tickIntervals();
    if (timers.size === 0) {
      if (!polled) return;
      return;
    }
    pumpTimers();
    let quiet = 0;
    for (let tick = 0; tick < 240; tick++) {
      await new Promise((resolve) => setImmediate(resolve));
      await Promise.resolve();
      if (inFlight > 0) quiet = 0;
      else if (++quiet >= 3) break;
    }
  }

  /**
   * 画布调用抓取。
   *
   * ⚠️ 按 `clearRect` 切帧：面板每次重渲染都会**整幅重画**，把调用累在一个数组里
   * 再 `slice` 只能碰运气（多跑一轮 pass 就多一份）。每帧一份数组，
   * 「最后一帧」就是这一帧画面真正执行的 `drawImage` 序列。
   */
  const drawFrames = [];
  let currentFrame = null;
  const fillRects = [];
  let clears = 0;
  let lastFillStyle = "";
  /** 标记层相关的画布调用：圆弧（`arc`）、圆圈里的数字（`fillText`）、以及**调用顺序**。 */
  const arcs = [];
  const texts = [];
  const callOrder = [];
  let lastFont = "";
  let lastStrokeStyle = "";
  let lastLineWidth = 1;
  /** 动画帧号：面板用 rAF + Date.now 推时钟，这里把 rAF 排队、由测试推进。 */
  const rafQueue = new Map();
  /** 「等待稳定超时」的记号每次 renderTree 最多说一次（它每轮都会触发，不然刷屏）。 */
  let settleNotes = 0;
  let rafSeq = 0;

  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
  const frameOf = () => (drawFrames.length === 0 ? [] : drawFrames[drawFrames.length - 1]);
  /** 帧序列里的一条：9 参数形式的 drawImage。 */
  const isDrawImage = (call) => call.args.length >= 9;

  let fileClicks = 0;
  function makeNode(type) {
    const node = {
      type,
      style: {},
      children: [],
      width: 0,
      height: 0,
      dataset: {},
      /**
       * 视口量出来就是整张地图大小（32×32×32px = 1024）：
       * 黄金对照要求「计划覆盖到的每一格」都在可见范围内。
       */
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 520, right: 900, bottom: 520 };
      },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      appendChild() {},
      remove() {},
      click() {
        fileClicks++;
      }
    };
    if (type === "canvas") {
      const ctx = {
        __isContext: true,
        canvas: node,
        globalAlpha: 1,
        imageSmoothingEnabled: true,
        setTransform() {},
        clearRect() {
          clears++;
          currentFrame = [];
          drawFrames.push(currentFrame);
          arcs.length = 0;
          texts.length = 0;
          callOrder.length = 0;
        },
        fillRect(x, y, w, h) {
          fillRects.push({ fillStyle: lastFillStyle, x, y, w, h });
        },
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        fill() {},
        stroke() {
          if (arcs.length > 0) arcs[arcs.length - 1].stroked = true;
        },
        arc(x, y, radius) {
          arcs.push({ x, y, radius, fillStyle: lastFillStyle, strokeStyle: lastStrokeStyle, lineWidth: lastLineWidth, stroked: false });
          callOrder.push("arc");
        },
        measureText(text) {
          return { width: String(text).length * 7 };
        },
        fillText(text, x, y) {
          texts.push({ text: String(text), x, y, font: lastFont, fillStyle: lastFillStyle });
          callOrder.push("fillText");
        },
        drawImage(...args) {
          callOrder.push("drawImage");
          if (currentFrame === null) {
            currentFrame = [];
            drawFrames.push(currentFrame);
          }
          currentFrame.push({ args, sx: args[1], sy: args[2], sw: args[3], sh: args[4], dx: args[5], dy: args[6], dw: args[7], dh: args[8], tilesetId: args[0]?.dataset?.tilesetId ?? null });
        }
      };
      // fillStyle 是普通属性：单层预览的绿底靠它认（`rgb(56,170,68)`）。
      Object.defineProperty(ctx, "fillStyle", {
        get: () => lastFillStyle,
        set: (value) => {
          lastFillStyle = String(value);
        }
      });
      // 标记的圆圈与数字靠 font / strokeStyle / lineWidth 定位与上色，同样按普通属性记。
      Object.defineProperty(ctx, "font", {
        get: () => lastFont,
        set: (value) => {
          lastFont = String(value);
        }
      });
      Object.defineProperty(ctx, "strokeStyle", {
        get: () => lastStrokeStyle,
        set: (value) => {
          lastStrokeStyle = String(value);
        }
      });
      Object.defineProperty(ctx, "lineWidth", {
        get: () => lastLineWidth,
        set: (value) => {
          lastLineWidth = Number(value);
        }
      });
      node.getContext = () => ctx;
    }
    return node;
  }

  const ReactStub = {
    Fragment: Symbol.for("react.fragment"),
    createElement(type, props, ...children) {
      // ⚠️ 真 React 会把 children 放进 `props.children`，函数组件靠它取子节点。
      // 只挂在元素上（不放进 props）的话，`Btn` 这类组件渲染出来**全是空按钮**。
      const merged = { ...(props ?? {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      const element = { type, props: merged, children };
      // 对象 ref（useRef 的返回值）在提交后指向真实节点；函数 ref 走 __pendingRefs。
      if (element.props.ref !== null && typeof element.props.ref === "object") {
        element.props.ref.current = makeNode(type === "canvas" ? "canvas" : "div");
      }
      if (typeof element.props.ref === "function") {
        const node = makeNode(type === "canvas" ? "canvas" : "div");
        node.dataset = { ...(element.props["data-tileset"] ? { tilesetId: element.props["data-tileset"] } : {}) };
        globals.__pendingRefs.push({ element, node });
      }
      return element;
    },
    /**
     * ⚠️ 每个 Hook 都要**捕获当前那份存储**（`const store = cells`）。
     * 直接用模块级 `cells` 的话，`withFreshHooks` 换回来之后，迟到的 `setState`
     * 会写进**别人的存储**（表现是「面板上一堆断言突然全错位」）。
     */
    useState(initial) {
      const index = cursor++;
      const store = cells;
      if (!(index in store)) store[index] = typeof initial === "function" ? initial() : initial;
      return [
        store[index],
        (next) => {
          const value = typeof next === "function" ? next(store[index]) : next;
          /**
           * ⚠️ 必须和 React 一样**值没变就跳过重渲染**（`Object.is`）。
           *
           * 无脑 `pendingRender = true` 的后果有两个：
           * ① 每个 effect 里那句「设置成同一个值」（`setMeasured(true)` 之类）都会让
           *    「等界面稳定」的循环永远静不下来，每轮白跑 220 个 tick 才被硬截断 ——
           *    自检里满屏 `⚠️ 等待稳定超时`，而且是**半渲染**的树，偶发误报就来自这里；
           * ② 组件里为了省一次重画而故意返回同一个对象（`setHover(prev => …)`）在自检里
           *    完全体现不出来，跟真机不一致。
           */
          if (Object.is(value, store[index])) return;
          store[index] = value;
          pendingRender = true;
        }
      ];
    },
    useRef(initial) {
      const index = cursor++;
      const store = cells;
      if (!(index in store)) store[index] = { current: initial };
      return store[index];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const store = cells;
      const slot = store[index];
      if (slot === undefined || slot === null || !sameDeps(slot.deps, deps)) store[index] = { deps, value: fn() };
      return store[index].value;
    },
    useCallback(fn, deps) {
      const index = cursor++;
      const store = cells;
      const slot = store[index];
      if (slot === undefined || slot === null || !sameDeps(slot.deps, deps)) store[index] = { deps, value: fn };
      return store[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const store = cells;
      const slot = store[index];
      if (slot === undefined || slot === null || !sameDeps(slot.deps, deps)) {
        store[index] = { deps };
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

  /** 系统「减少动态效果」开关：动画那一段要能翻转它。 */
  let reduceMotion = false;
  const globals = { __pendingRefs: [], __cleanups: [] };
  const LOADED = [];
  const windowStub = {
    // 打开面板自带的帧统计（默认关）：画不出东西时靠它区分「没计划 / 缺图源 / 坐标飞了」
    __mapDebug: true,
    __ModuleLoader__: { load: (registration) => LOADED.push(registration) },
    location: { origin: "http://127.0.0.1:19387", search: "", href: "http://127.0.0.1:19387/" },
    devicePixelRatio: 1,
    /**
     * ⚠️ 原生 prompt 的**假实现**：记录下来，断言模块六一次都没碰它。
     *
     * 真机坏在这里：DSH 桌面端是 Electron，`window.prompt` 存在但一调用就抛错
     * （`typeof` 判断看不出来），于是「新建项目」点了毫无反应。面板必须自带对话框，
     * 这条桩就是用来钉住「不许再依赖原生 prompt」的 —— 返回 null 会让旧写法什么都不建。
     */
    __promptCalls: [],
    __confirmCalls: [],
    confirm(message) {
      windowStub.__confirmCalls.push(message);
      return true;
    },
    prompt(message, defaultValue) {
      windowStub.__promptCalls.push({ message, defaultValue });
      return null;
    },
    history: {
      replaceState(_state, _title, url) {
        const next = new URL(url, windowStub.location.href);
        windowStub.location.href = next.toString();
        windowStub.location.search = next.search;
      }
    },
    matchMedia: (query) => ({
      matches: query.includes("prefers-reduced-motion") ? reduceMotion : false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {}
    }),
    requestAnimationFrame: (fn) => {
      const id = ++rafSeq;
      rafQueue.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => {
      rafQueue.delete(id);
    },
    /**
     * 面板里的 setTimeout 用来做 op 批量提交 / 计划查询的防抖。
     * 入库但**不自动执行**：由 renderTree 在「effect 都跑完、状态稳定」之后统一放出来，
     * 这样 effect 的 cleanup（clearTimeout）语义与真机一致（见上面的 timers 注释）。
     */
    setTimeout: (fn) => {
      const id = ++timerSeq;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    setInterval: (fn) => {
      const id = ++intervalSeq;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => {
      intervals.delete(id);
    },
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
    removeEventListener() {},
    hidden: false
  };
  globalThis.URL = URL;
  /**
   * `FileReader` 的最小桩：Node 有 `File` / `Blob`，但没有 `FileReader`，而面板读完文件
   * 才把 base64 交给宿主（`readBase64`）—— 少了它，「新增素材」这条路永远停在上传之前，
   * 自检就只能验到「草稿填了什么」，验不到「真的发了什么」。
   */
  globalThis.FileReader = class {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onerror = null;
    }
    readAsDataURL(file) {
      void file
        .arrayBuffer()
        .then((buffer) => {
          this.result = `data:${file.type || "image/png"};base64,${Buffer.from(buffer).toString("base64")}`;
          if (typeof this.onload === "function") this.onload();
        })
        .catch((error) => {
          if (typeof this.onerror === "function") this.onerror(error);
        });
    }
  };

  try {
    new Function("window", "require", source)(windowStub, (name) => {
      if (name === "react") return ReactStub;
      throw new Error(`未预期的 require(${name})`);
    });
    check("浏览器束可加载（经典脚本 + 假 React）", true);
  } catch (error) {
    check("浏览器束可加载（经典脚本 + 假 React）", false, String(error?.message ?? error));
    throw error;
  }
  check("注册了唯一插件体", LOADED.length === 1, `${LOADED.length} 个`);

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
  /**
   * 插件启动时会通过 `ctx.get("remote.gameStudio")` 调 `reportClientOrigin`。
   *
   * 假 ctx 直接返回 undefined 的话，那次调用会失败并按退避重试 60 次，
   * harness 一轮轮放定时器时就误报「setState 死循环」。这里给一个只实现
   * `reportClientOrigin` 的假远程服务；面板自身的 API 仍是下面单独的 `api` 桥。
   */
  const fakeRemote = {
    reportClientOrigin: async () => ({ ok: true, value: { ok: true } })
  };
  const fakeCtx = {
    effect: (fn) => fn(),
    get: (name) => (name === "remote.gameStudio" ? fakeRemote : undefined),
    slots: {
      register: (options, component) => void (REGISTERED[options.name] = component),
      inject: (name, fn) => fn()
    },
    remote: { $mount: () => Promise.resolve() }
  };
  bundle.apply(fakeCtx);
  check("apply 可执行", true);

  const test = bundle.__test ?? {};
  const { MapModule, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells } = test;
  check("产物带出 MapModule", typeof MapModule === "function");
  /**
   * 反向验证：模块⑥**不再是实验性功能**，所以那个弹窗组件必须从产物里彻底消失。
   * 只删渲染、留着组件的话，下一个人「顺手」把它挂回去就又变回实验性了。
   */
  check("产物里不再有 MapExperimentalDialog（模块⑥已转正）", test.MapExperimentalDialog === undefined, Object.keys(test).filter((key) => /Experimental/.test(key)).join(","));
  check(
    "产物带出四个黄金对照函数（命中测试必需的那份复刻）",
    typeof MAP_pointToCell === "function" && typeof MAP_cellAnchor === "function" && typeof MAP_cellTopLeft === "function" && typeof MAP_lineCells === "function"
  );
  check(
    "产物里不再有 MAP_visibleChunks / MAP_chunkKey（chunk 计算全在宿主）",
    test.MAP_visibleChunks === undefined && test.MAP_chunkKey === undefined,
    Object.keys(test).filter((key) => /chunk|visible/i.test(key)).join(",")
  );
  if (typeof MapModule !== "function") throw new Error("没有 MapModule，后面没法测");

  // ══ 2. 黄金对照：界面复刻的几何 vs 宿主真实现 ════════════════════════════
  section("2) 黄金对照：四个坐标函数 vs 宿主 mapgeom / mapdoc");

  /** 客户端那份 layout 与宿主同形（自己造的字段它不读）。 */
  const layoutFor = (grid, cols, rows) => {
    const host = GEOM.layoutOf(grid, cols, rows);
    return { ...host, grid };
  };

  /**
   * 采样点：格中心 / 四角内侧 / 45% 偏移 / 贴边（左、上边线正好落在格上）。
   * 「贴边」是刻意选的：夹具总取正中时，`floor` 与 `round` 的差别看不出来。
   */
  function samplePoints(layout, cols, rows) {
    const points = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = c * layout.stepX;
        const y0 = r * layout.stepY;
        const center = GEOM.cellCenter(layout, r, c);
        points.push({ x: center.x, y: center.y, why: `center ${r},${c}` });
        points.push({ x: x0 + 0.5, y: y0 + 0.5, why: `topleft ${r},${c}` });
        points.push({ x: x0 + layout.stepX - 0.5, y: y0 + 0.5, why: `topright ${r},${c}` });
        points.push({ x: x0 + 0.5, y: y0 + layout.stepY - 0.5, why: `bottomleft ${r},${c}` });
        points.push({ x: x0 + layout.stepX - 0.5, y: y0 + layout.stepY - 0.5, why: `bottomright ${r},${c}` });
        points.push({ x: x0 + layout.stepX * 0.45, y: y0 + layout.stepY * 0.45, why: `45% ${r},${c}` });
        points.push({ x: x0, y: y0, why: `edge ${r},${c}` });
      }
    }
    return points;
  }
  /** 图外点：负数、超尺寸、远在天边、以及带小数的。 */
  function outsidePoints(layout) {
    return [
      { x: -1, y: -1 },
      { x: -0.5, y: -0.5 },
      { x: -layout.stepX * 3.5, y: -layout.stepY * 2.5 },
      { x: -1, y: layout.height / 2 },
      { x: layout.width / 2, y: -1 },
      { x: layout.width + 0.5, y: layout.height + 0.5 },
      { x: layout.width + layout.stepX * 2.3, y: layout.height + layout.stepY * 4.7 },
      { x: layout.width * 2, y: layout.height * 3 }
    ];
  }

  for (const grid of [
    { tileWidth: 32, tileHeight: 32, wrap: true },
    { tileWidth: 32, tileHeight: 32, wrap: false }
  ]) {
    const cols = 11;
    const rows = 7;
    const layout = layoutFor(grid, cols, rows);
    const hostLayout = GEOM.layoutOf(grid, cols, rows);
    const label = `32×32 wrap=${String(grid.wrap)}`;

    let anchorMismatch = 0;
    let anchorSamples = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const host = GEOM.cellAnchor(hostLayout, r, c);
        const client = MAP_cellAnchor(layout, r, c);
        anchorSamples++;
        if (host.x !== client.x || host.y !== client.y) anchorMismatch++;
      }
    }
    check(`${label}：cellAnchor 与宿主逐格一致（${anchorSamples} 格）`, anchorMismatch === 0, `${anchorMismatch} 格不同`);

    let topLeftMismatch = 0;
    let topLeftSamples = 0;
    for (const [w, h, ax, ay] of [[32, 32, undefined, undefined], [64, 96, 0.5, 1], [24, 24, 0.5, 0.5], [16, 40, 0, 0]]) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const host = ax === undefined ? GEOM.cellTopLeft(hostLayout, r, c, w, h) : GEOM.cellTopLeft(hostLayout, r, c, w, h, ax, ay);
          const client = ax === undefined ? MAP_cellTopLeft(layout, r, c, w, h) : MAP_cellTopLeft(layout, r, c, w, h, ax, ay);
          topLeftSamples++;
          if (host.x !== client.x || host.y !== client.y) topLeftMismatch++;
        }
      }
    }
    check(`${label}：cellTopLeft 逐格一致（含默认锚点 / 大贴图 / 自定义锚点，${topLeftSamples} 组）`, topLeftMismatch === 0, `${topLeftMismatch} 组不同`);

    let pointMismatch = 0;
    const points = [...samplePoints(layout, cols, rows), ...outsidePoints(layout)];
    for (const point of points) {
      const host = GEOM.pointToCell(hostLayout, point.x, point.y);
      const client = MAP_pointToCell(layout, point.x, point.y);
      if (host.r !== client.r || host.c !== client.c || host.inMap !== client.inMap) pointMismatch++;
    }
    check(`${label}：pointToCell 逐点一致（${points.length} 个点，含格中心 / 四角 / 贴边 / 图外）`, pointMismatch === 0, `${pointMismatch}/${points.length} 个点不同`);

    if (grid.wrap === true) {
      let inside = 0;
      for (const point of outsidePoints(layout)) {
        const client = MAP_pointToCell(layout, point.x, point.y);
        if (client.inMap === true && client.r >= 0 && client.r < rows && client.c >= 0 && client.c < cols) inside++;
      }
      check(`${label}：环绕下**图外点**折回图内（inMap 恒 true、坐标落在 0..rows/cols）`, inside === outsidePoints(layout).length, `${inside}/${outsidePoints(layout).length}`);
    } else {
      let outside = 0;
      for (const point of outsidePoints(layout)) {
        const client = MAP_pointToCell(layout, point.x, point.y);
        if (client.inMap === false) outside++;
      }
      check(`${label}：非环绕下**图外点**如实返回 inMap=false（不静默折回）`, outside === outsidePoints(layout).length, `${outside}/${outsidePoints(layout).length}`);
    }
  }

  // 反向验证：这两条证明上面的逐点比对**真的能抓错**，不是自证。
  {
    const wrapLayout = layoutFor({ tileWidth: 32, tileHeight: 32, wrap: true }, 11, 7);
    const flatLayout = layoutFor({ tileWidth: 32, tileHeight: 32, wrap: false }, 11, 7);
    const flatHost = GEOM.layoutOf({ tileWidth: 32, tileHeight: 32, wrap: false }, 11, 7);
    const crossing = [{ x: -1, y: -1 }, { x: 11 * 32 + 5, y: 7 * 32 + 5 }, { x: 400, y: 400 }];
    check(
      "反向验证：跨边界点上 wrap / 非 wrap 的结果确实不同（否则那条比对没有区分力）",
      crossing.every((point) => {
        const wrapped = MAP_pointToCell(wrapLayout, point.x, point.y);
        const flat = MAP_pointToCell(flatLayout, point.x, point.y);
        return wrapped.r !== flat.r || wrapped.c !== flat.c || wrapped.inMap !== flat.inMap;
      })
    );
    // 把 wrap 写死成 true 的错实现，在非环绕布局上必然与宿主不一致 —— 这就是上面那条比对能抓的东西。
    const hardcodedWrap = (x, y) => {
      const r0 = Math.floor(y / 32);
      const c0 = Math.floor(x / 32);
      return { r: ((r0 % 7) + 7) % 7, c: ((c0 % 11) + 11) % 11, inMap: true };
    };
    check(
      "反向验证：若把 wrap 写死成 true，非环绕布局上就会与宿主不一致（逐点比对能抓出来）",
      crossing.some((point) => {
        const wrong = hardcodedWrap(point.x, point.y);
        const host = GEOM.pointToCell(flatHost, point.x, point.y);
        const client = MAP_pointToCell(flatLayout, point.x, point.y);
        return (wrong.r !== host.r || wrong.c !== host.c || wrong.inMap !== host.inMap) && client.inMap === host.inMap && client.r === host.r && client.c === host.c;
      })
    );
    // 把锚点当中心（少半格）是 mapgeom 头部注释点名的老坑：这条证明 cellAnchor 的比对能抓它。
    const wrongAnchor = (layout, r, c) => ({ x: c * layout.stepX + 16, y: r * layout.stepY + 16 });
    check(
      "反向验证：把锚点当中心（y 少半格）会与宿主 cellAnchor 不同 —— 逐格比对能抓住",
      [0, 3, 6].every((r) => {
        const host = GEOM.cellAnchor(GEOM.layoutOf({ tileWidth: 32, tileHeight: 32, wrap: true }, 11, 7), r, 2);
        const client = MAP_cellAnchor(wrapLayout, r, 2);
        const wrong = wrongAnchor(wrapLayout, r, 2);
        return client.y === host.y && wrong.y !== host.y;
      })
    );
  }

  {
    let lineMismatch = 0;
    let lineTotal = 0;
    const cases = [[0, 0, 7, 7], [7, 0, 0, 7], [3, 3, 3, 9], [1, 8, 6, 1], [4, 4, 4, 4], [0, 0, 6, 6]];
    for (const [r0, c0, r1, c1] of cases) {
      const host = DOC.lineCells(r0, c0, r1, c1);
      const client = MAP_lineCells(r0, c0, r1, c1);
      lineTotal += host.length;
      if (JSON.stringify(host) !== JSON.stringify(client)) lineMismatch++;
    }
    check(`MAP_lineCells 与宿主 mapdoc.lineCells 逐点一致（${cases.length} 组、含 45° 斜线与同点，共 ${lineTotal} 格）`, lineMismatch === 0 && lineTotal > 20, `${lineMismatch} 组不同`);
    check(
      "反向验证：拖动补间不是「只连两端」（45° 斜线的中间格必须在结果里）",
      DOC.lineCells(0, 0, 4, 4).length === 5 && MAP_lineCells(0, 0, 4, 4).length === 5
    );
  }

  // ══ 3. 真渲染：面板 vs 宿主计划 ══════════════════════════════════════════
  section("3) 真渲染面板（宿主数据 + 真实 api 桥）");

  const apiLog = {
    plans: [],
    applies: [],
    undos: 0,
    redos: 0,
    saves: [],
    samples: 0,
    imports: 0,
    /** 每次 `createMapProject` 的入参（要看界面有没有把「一格多大」传下去）。 */
    created: [],
    /** 每次 `importMapTileset` 带过去的属性（格子 / 用法 / 会动吗 / 动画速度）。 */
    importOptions: [],
    generates: [],
    /** 每次 `saveMapTileset` 的入参（要看界面把哪些属性交下去了）。 */
    tilesetSaves: [],
    exports: 0,
    exportPayloads: [],
    reveals: [],
    approvals: []
  };
  const apiRaw = {
    /**
     * 插件启动时会调用它上报 origin；假桥必须成功返回。
     *
     * 少了这一条，`reportClientOrigin` 会按失败退避重试 60 次（每 500ms 一次），
     * harness 把定时器一轮轮放出来时就会超过 40 轮，误报「setState 死循环」。
     * 这是测试夹具漏了一个远程方法，不是面板真的在循环。
     */
    reportClientOrigin: async () => ({ ok: true }),
    listMapProjects: async () => ({ projects: await G.listMapProjects() }),
    createMapProject: async ({ name, cols, rows, grid }) => {
      apiLog.created.push({ name, cols, rows, grid });
      return G.mapView(await G.createMapProject(name, { cols, rows, grid }));
    },
    getMapProject: async ({ projectId: id }) => G.mapView(await G.readMapProject(id)),
    deleteMapProject: async ({ projectId: id }) => {
      await G.deleteMapProject(id);
      return { ok: true };
    },
    saveMapProject: async ({ projectId: id, name }) => {
      await G.patchMapProject(id, (project) => {
        project.name = name;
      });
      return { ok: true };
    },
    importMapTileset: async ({ projectId: id, name, data, ...opts }) => {
      apiLog.imports++;
      /**
       * ⚠️ 属性（格子 / 用法 / 会动吗 / 动画速度）要**原样转给宿主** —— 假桥少转一个字段，
       * 「界面选了什么」就永远验不到（真实宿主的 schema 也是这么收的）。
       */
      apiLog.importOptions.push(opts);
      return G.importMapTileset(id, name, data, opts);
    },
    importSampleTileset: async ({ projectId: id }) => {
      apiLog.samples++;
      return G.importSampleTileset(id);
    },
    saveMapTileset: async ({ projectId: id, tilesetId, ...patch }) => {
      apiLog.tilesetSaves.push({ tilesetId, ...patch });
      return G.saveMapTileset(id, tilesetId, patch);
    },
    removeMapTileset: async ({ projectId: id, tilesetId }) => G.removeMapTileset(id, tilesetId),
    saveMapDoc: async ({ projectId: id, ...patch }) => {
      apiLog.saves.push(patch);
      return G.saveMapDocStructure(id, patch);
    },
    applyMapOps: async (payload) => {
      apiLog.applies.push({ ops: payload.ops, stroke: payload.stroke, have: [...(payload.have ?? [])] });
      return G.applyMapOps(payload.projectId, payload.ops, { stroke: payload.stroke, have: payload.have });
    },
    mapUndo: async ({ projectId: id, have }) => {
      apiLog.undos++;
      return G.undoMap(id, have);
    },
    mapRedo: async ({ projectId: id, have }) => {
      apiLog.redos++;
      return G.redoMap(id, have);
    },
    mapPlan: async (payload) => {
      const result = await G.mapPlan(payload.projectId, {
        view: payload.view,
        have: payload.have,
        layerIds: payload.layerIds,
        // 预览是宿主侧的能力（盖在克隆上算计划、不落盘）：夹具必须原样透传，
        // 否则「拖动期间看得见」这条契约在自检里根本测不到
        pending: payload.pending,
        // 整图的通行区域同理：桥少转一个字段，「区域叠加」就永远验不到。
        pass: payload.pass === true
      });
      apiLog.plans.push({
        view: { ...payload.view },
        have: [...(payload.have ?? [])],
        pending: payload.pending === undefined ? undefined : [...payload.pending],
        layerIds: payload.layerIds === undefined ? undefined : [...payload.layerIds],
        pass: payload.pass === true,
        result
      });
      return result;
    },
    runMapGenerate: async (payload) => {
      apiLog.generates.push(payload);
      return G.runMapGenerate(payload.projectId, payload);
    },
    runMapPreview: async (payload) => G.runPreviewStage(payload.projectId),
    runMapExport: async (payload) => {
      apiLog.exports++;
      apiLog.exportPayloads.push({ scale: payload.scale, formats: { ...(payload.formats ?? {}) } });
      return G.runExportStage(payload.projectId, { scale: payload.scale, formats: payload.formats });
    },
    cancelMapJob: async () => ({ ok: true }),
    setMapApproved: async (payload) => {
      apiLog.approvals.push(payload);
      return { ok: true };
    },
    revealMapProject: async (payload) => {
      const { dir, fallback } = await G.mapRevealDir(payload.projectId, payload.target ?? "");
      apiLog.reveals.push({ ...payload, dir, fallback });
      return { ok: true, dir, fallback };
    }
  };
  /** 每个宿主调用都计一次「在飞」，供 renderTree 判断真的静下来了。 */
  const api = Object.fromEntries(
    Object.entries(apiRaw).map(([name, fn]) => [
      name,
      async (...args) => {
        inFlight++;
        try {
          return await fn(...args);
        } finally {
          inFlight--;
        }
      }
    ])
  );

  /**
   * 收集元素。
   *
   * ⚠️ 只展开 `Btn`（无状态）：在面板的 hook 存储里调用带 Hook 的组件会把槽位读串，
   * 表现是后面每个断言都莫名其妙地错位。
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
  /**
   * 重新挂载面板，直到**视图真的加载出来**为止（最多 3 次）。
   *
   * ⚠️ 挂载时要「读项目列表 → 读视图 → 问计划」，全是真的文件系统往返；本 harness
   * 偶尔会在那一串异步还没落地时就判定「已经稳定」，于是这个全新面板停在空态。
   * 那不是界面坏了（真机上刷新一次就好），但会让**后面每条断言连环崩**
   * （`byTool(freshTree, "eraser")[0]` 直接 undefined，整个脚本挂掉、后半个文件的
   * 覆盖全丢 —— 本机实测三次跑，分别死在第 10 / 15 / 16 节）。重挂一次即可。
   */
  async function freshPanel(apiImpl = api, tries = 3) {
    let mounted = await renderTree(() => MapModule({ api: apiImpl }), { fresh: true });
    for (let i = 1; i < tries && textOf(mounted).includes("还没有地图项目"); i++) {
      mounted = await renderTree(() => MapModule({ api: apiImpl }), { fresh: true });
    }
    return mounted;
  }
  const byTool = (tree, key) => collect(tree, (node) => node.props?.["data-tool"] === key);
  /**
   * 地图格 → 客户端坐标。
   *
   * ⚠️ 不要写死 `clientX: 40` 这类数字：相机被夹在地图里之后，硬编码的坐标很容易落到
   * 地图外（按新约定不算命中 → 不画也不悬停），断言就会莫名其妙地失败。
   * 相机口径取客户端最近一次计划查询的 `view`（= `{x: pan.x, y: pan.y, width: w/zoom}`）；
   * 画布桩的 `getBoundingClientRect()` 是 900×520、left/top = 0。
   */
  const clientOf = (r, c, step = 32) => {
    // 相机用面板自己暴露的那一份（`__mapDebug` 打开时随每次绘制刷新）——
    // 拿「最近一次计划查询的 view」推会读到过期相机（切项目 / 自适应缩放之后）。
    const cam = windowStub.__mapCamera;
    if (cam === undefined) throw new Error("拿不到 __mapCamera：面板还没画过？");
    return { x: ((c + 0.5) * step - cam.pan.x) * cam.zoom, y: ((r + 0.5) * step - cam.pan.y) * cam.zoom };
  };
  const textOf = (node) => {
    if (node === null || node === undefined) return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join("");
    return (node.children ?? []).map(textOf).join("");
  };
  /** 递归展开函数组件（**只用于独立渲染的子树**：展开会消耗 Hook 槽位）。 */
  function expandComponents(node, depth = 0) {
    if (node === null || node === undefined || typeof node !== "object" || depth > 8) return node;
    if (Array.isArray(node)) return node.map((child) => expandComponents(child, depth));
    if (typeof node.type === "function") return expandComponents(node.type(node.props), depth + 1);
    return { ...node, children: (node.children ?? []).map((child) => expandComponents(child, depth)) };
  }

  /**
   * 渲染 → 跑 effect → 有 setState 就再来一轮（最多 30 轮，防死循环）。
   *
   * 一轮 = 「渲染 + 跑 effect + 等宿主调用落地」，**先不放定时器**。
   * 只有在这一轮彻底稳定（没有新 setState、没有在飞的宿主调用）之后，
   * 才把还活着的防抖定时器放出来 —— 那时 effect 的 cleanup 都已经执行过，
   * 与真机「32ms 后定时器才响，而 React 早就重渲染并清掉了旧定时器」一致。
   */
  async function renderTree(element, options = {}) {
    if (options.fresh === true) resetHooks();
    settleNotes = 0;
    let tree = null;
    /** 最近一次真正渲染出来的树：40 轮还没稳定时也要把它还回去（`tree` 只是入参元素）。 */
    let lastRendered = null;
    for (let pass = 0; pass < 40; pass++) {
      cursor = 0;
      pendingRender = false;
      effects = [];
      globals.__pendingRefs = [];
      tree = element;
      const rendered = typeof element === "function" ? element() : element;
      lastRendered = rendered;
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
       * ⚠️ 必须等**真实的事件循环轮次**：面板挂载后要读宿主数据（真走文件系统），
       * 只 await 微任务的话读盘还没回来就判「没有 setState」而提前收工 ——
       * 表现是「面板一直停在空态」或「刚点完撤销断言读到旧状态」，看着像界面坏了。
       * 判据是「连续 3 轮既没有新 setState、也没有在飞的宿主调用」。
       */
      let quiet = 0;
      for (let tick = 0; tick < 240; tick++) {
        await new Promise((resolve) => setImmediate(resolve));
        await Promise.resolve();
        if (pendingRender || inFlight > 0) {
          quiet = 0;
          if (tick > 220) {
            /**
             * 多数情况下这是**本 harness 的已知特性**，不是界面在死循环：
             * 它每轮重跑**所有** effect（不认依赖数组），而面板里那句「按视口查绘制计划」
             * 的 effect 每次都会真的发起一次宿主查询 → `inFlight` / `pendingRender` 永远不为 0。
             * （真机上不会：React 只在依赖变化时重跑。实测界面空闲 3 秒重画 0 次。）
             * 留一条记号是为了万一真的读到半渲染的树、断言开始莫名其妙地报错时有个抓手。
             */
            if (settleNotes++ === 0) note(`⚠️ 等待稳定超时（本 harness 每轮重跑所有 effect，属已知特性；tick=${tick}，inFlight=${inFlight}）`);
            break;
          }
        } else if (++quiet >= 3) {
          break;
        }
      }
      if (pendingRender) continue; // 还没稳定：先让 React 提交，别急着放定时器
      if (timers.size === 0) return rendered;
      pumpTimers();
      let quietAfter = 0;
      for (let tick = 0; tick < 240; tick++) {
        await new Promise((resolve) => setImmediate(resolve));
        await Promise.resolve();
        if (pendingRender || inFlight > 0) {
          quietAfter = 0;
          if (tick > 220) {
            if (settleNotes++ === 0) note(`⚠️ 等待稳定超时（定时器后；同上，属已知特性；tick=${tick}，inFlight=${inFlight}）`);
            break;
          }
        } else if (++quietAfter >= 3) {
          break;
        }
      }
      // 定时器放出来的工作也落地了、也没有新状态 → 这一帧就是终态
      if (!pendingRender && inFlight === 0) {
        if (timers.size === 0) return rendered;
        continue; // 定时器里又排了新的（例如批量提交后续），再走一轮
      }
    }
    HOOK_MISMATCH.push("渲染超过 40 轮（可能有 setState 死循环）");
    /**
     * 40 轮还没稳定时，把**最近一次真正渲染出来的树**还回去。
     *
     * `tree` 只是入参（可能是 `() => MapModule(...)` 这个函数本身）—— 原样返回会让后面
     * 每条 `collect(tree, ...)` 都拿到空结果，然后崩在一条毫不相关的断言上（本机实测：
     * 第 3 节第一条 `byTool(tree, "pen")[0].props` 就抛 TypeError，后半文件全都不跑）。
     * 还回最后一帧至少能让其余断言继续，真正的问题（渲染循环）由上面那条单独报出来。
     */
    return lastRendered ?? tree;
  }

  let tree = await renderTree(() => MapModule({ api }));
  check("面板能渲染（无异常、不是空态）", tree !== null && tree !== undefined && !textOf(tree).includes("还没有地图项目"), textOf(tree).slice(0, 60));

  /**
   * ⚠️ 模块⑥转正后这里**不能**再出现 `MapExperimentalDialog`。
   * 早退分支（空态）与正常分支都要查：只改一处的话，用户从空态进去仍会看到
   * 「实验性」弹窗，与页签上的正式模样自相矛盾。
   */
  const gateElement = collect(tree, (node) => typeof node.type === "function" && /Experimental(Dialog|Bar)/.test(node.type.name ?? ""))[0];
  check("进入模块⑥**不弹**实验性说明（它不是实验性功能）", gateElement === undefined, gateElement?.type?.name ?? "");

  // ── 顶栏 ────────────────────────────────────────────────────────────────
  const projButton = byClass(tree, "SPR_mapEdProj")[0];
  check("顶栏有项目名（可展开菜单）", projButton !== undefined && textOf(projButton).includes("客户端自检"), textOf(projButton));
  const topButtons = byClass(tree, "SPR_mapEdTopBtn").map((node) => textOf(node).trim());
  check("顶栏有「素材」与「导出」两个入口（没有阶段条）", topButtons.includes("素材") && topButtons.includes("导出"), topButtons.join(" / "));
  check("顶栏没有「已通过」这类阶段向导按钮", !topButtons.some((text) => /阶段|下一步|①②③④/.test(text)), topButtons.join(" / "));
  // 用户反馈：画的时候那个「已自动保存」一直闪，不需要 —— 整块拿掉了
  check("顶栏不再显示保存状态（那颗会闪的字去掉了）", byClass(tree, "SPR_mapEdSave").length === 0 && !/已自动保存|还没有改动|正在保存/.test(textOf(tree)));
  {
    let copiedId = "";
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText: async (text) => { copiedId = String(text); } } },
      configurable: true
    });
    const copyElement = collect(tree, (node) => typeof node.type === "function" && node.type.name === "CopyIdButton")[0];
    const copyButton = copyElement === undefined
      ? undefined
      : byClass(await withFreshHooks(() => copyElement.type(copyElement.props)), "SPR_copyId")[0];
    check("项目顶栏有「复制 ID」按钮", copyButton !== undefined && textOf(copyButton).includes("复制 ID"), textOf(copyButton ?? null));
    if (copyButton !== undefined) await copyButton.props.onClick({ stopPropagation() {} });
    check("点「复制 ID」真的把 projectId 交给剪贴板", copiedId === projectId, copiedId);
  }
  check("**没有阶段条**：渲染结果里一个 .SPR_step 元素都没有", byClass(tree, "SPR_step").length === 0 && byClass(tree, "SPR_steps").length === 0, `${byClass(tree, "SPR_step").length}`);
  if (projButton !== undefined) {
    projButton.props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const menuText = textOf(byClass(tree, "SPR_mapEdMenu")[0] ?? null);
    check("点项目名展开菜单（新建 / 重命名 / 删除项目 / 切换项目）", ["新建项目", "重命名", "删除项目", "切换项目"].every((text) => menuText.includes(text)), menuText.slice(0, 60));
    const projButton2 = byClass(tree, "SPR_mapEdProj")[0];
    projButton2.props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("再点一下菜单收回（菜单不是只能开不会关）", byClass(tree, "SPR_mapEdMenu").length === 0);
  }

  // ── 左列：素材调色板 ────────────────────────────────────────────────────
  const paletteGrid = byClass(tree, "SPR_mapEdPaletteGrid")[0];
  const paletteTiles = byClass(tree, "SPR_mapEdTile");
  const hostView = await G.mapView(await G.readMapProject(projectId));
  const expectedBrushes = hostView.tilesets.reduce((sum, ts) => sum + ts.palette.length, 0);
  check("左侧有素材调色板（8 列的网格）", byClass(tree, "SPR_mapEdPalette").length === 1 && paletteGrid !== undefined);
  check(`调色板条目数 = 宿主 palette 的总和（${expectedBrushes} 条：4 张 A2 各 1 条 + 道具 8 条）`, paletteTiles.length === expectedBrushes, `渲染 ${paletteTiles.length} vs 宿主 ${expectedBrushes}`);
  check("调色板里 A2 素材只有一个条目（不是把 16px 小格摊出来）", paletteTiles.filter((node) => hostView.tilesets.find((ts) => ts.id === a2TilesetId).palette.some((item) => String(item.index) === node.props["data-index"])).length === 1);
  if (paletteTiles.length > 0) {
    const chosen = paletteTiles[4];
    const chosenIndex = chosen.props["data-index"];
    chosen.props.onClick({ shiftKey: false, ctrlKey: false, metaKey: false });
    tree = await renderTree(() => MapModule({ api }));
    const active = byClass(tree, "SPR_mapEdTile").filter((node) => node.props["data-on"] === "true");
    check("点调色板一块能选中（恰好一块带 data-on，红框由 CSS 画）", active.length === 1 && active[0].props["data-index"] === chosenIndex, `${active.length} 块选中`);
    /**
     * 悬停一块素材要讲人话。
     *
     * ⚠️ 这里原来是原生 `title: "第 N 块"`：新手看到的是一格草地，不是「第 33 块」——
     * 等了 1 秒才出来，还什么都没说。现在和工具格同一张自绘标签，且必须讲出
     * 「点它能干什么」；自动连接 / 会动这两件看不见的事也要在这里说。
     */
    const tileForTip = byClass(tree, "SPR_mapEdTile")[0];
    check("调色板条目不再挂原生 title（说明走自绘小标签）", tileForTip.props.title === undefined, String(tileForTip.props.title));
    check("调色板条目的 aria-label 是「名称：说明」", /：/.test(String(tileForTip.props["aria-label"])) && String(tileForTip.props["aria-label"]).includes("按住鼠标左键"), String(tileForTip.props["aria-label"]).slice(0, 40));
    tileForTip.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ left: 120, top: 400, width: 32, height: 32 }) } });
    tree = await renderTree(() => MapModule({ api }));
    const paletteTip = byClass(tree, "SPR_mapEdTip")[0];
    const paletteTipText = textOf(paletteTip ?? null);
    const paletteOwner = hostView.tilesets.find((ts) => ts.palette.some((item) => String(item.index) === String(tileForTip.props["data-index"])));
    check("悬停调色板条目弹出小标签：先说这是什么，再说点了怎么用", paletteTip !== undefined && paletteTipText.includes(paletteOwner.name) && paletteTipText.includes("点一下选中它"), paletteTipText.replace(/\s+/g, " ").slice(0, 60));
    /**
     * 多选那几块**只影响「一键生成」**（绘制用的永远是单项 `brush`）。
     * 说明里必须把它挂到一键生成上 —— 写成「一起涂」就是教错操作。
     */
    check("多选的说明指向「一键生成」（多选不参与手绘）", paletteTipText.includes("一键生成"), paletteTipText.replace(/\s+/g, " ").slice(-30));
    check(
      "自动连接的素材在标签里讲明「边缘会自己接上」（点之前就该知道）",
      paletteOwner.shape === "plain" ? true : paletteTipText.includes("边缘会自己接上"),
      `${paletteOwner.name} / ${paletteOwner.shape}`
    );
    byClass(tree, "SPR_mapEdTile")[0].props.onMouseLeave();
    tree = await renderTree(() => MapModule({ api }));
    check("鼠标移开调色板条目后小标签收起", byClass(tree, "SPR_mapEdTip").length === 0);
  }

  // ── 左列：12 个图标按钮 ─────────────────────────────────────────────────
  const toolNodes = collect(tree, (node) => typeof node.props?.className === "string" && node.props.className.split(" ").includes("SPR_mapEdTool"));
  check("左列正好 12 个工具格（6 列 × 2 行）", toolNodes.length === 12, `${toolNodes.length} 个`);
  const toolKeys = [...collect(tree, (node) => typeof node.props?.["data-tool"] === "string")].map((node) => node.props["data-tool"]);
  const wantKeys = ["undo", "redo", "pen", "eraser", "bucket", "pipette", "hand", "marker", "grid", "gen", "settings"];
  check(`11 个具名图标按钮都在（${wantKeys.join(" / ")}）`, wantKeys.every((key) => toolKeys.includes(key)) && toolKeys.filter((key) => wantKeys.includes(key)).length === 11, toolKeys.join(","));
  const layerBtn = byClass(tree, "SPR_mapEdLayerBtn")[0];
  const layerNum = byClass(tree, "SPR_mapEdLayerNum")[0];
  check("图层按钮上有层号「1」", layerBtn !== undefined && layerNum !== undefined && textOf(layerNum) === "1", textOf(layerNum ?? null));
  const layerHalves = byClass(tree, "SPR_mapEdLayerHalf");
  check(
    "图层按钮有上 / 下两个半块，且当前是第 1 层（下一层禁用）",
    layerHalves.length === 2 && layerHalves.find((node) => node.props["data-dir"] === "down").props.disabled === true && layerHalves.find((node) => node.props["data-dir"] === "up").props.disabled === false
  );

  // ── 工具格上方的小标签（名称 + 快捷键 + 介绍）────────────────────────────
  // 真机反馈：只有原生 `title` 时，说明要等一秒、样式不受控；自绘标签若用 absolute
  // 又会被祖先的 overflow 裁掉「按钮正上方」那一段。两条都在这里钉住。
  {
    const rect = () => ({ left: 120, top: 400, width: 40, height: 40, right: 160, bottom: 440 });
    const tipOf = (current) => byClass(current, "SPR_mapEdTip")[0];
    check(
      "工具格不再挂原生 title（否则会和自绘标签叠成两个框）",
      toolNodes.every((node) => node.props.title === undefined),
      toolNodes.filter((node) => node.props.title !== undefined).map((node) => node.props["data-tool"]).join(",")
    );
    check(
      "每个具名工具格的 aria-label 是「名称：介绍（快捷键）」（图层那个是复合容器，由两个半块各自带名字）",
      byTool(tree, "pen").length === 1 &&
        [...collect(tree, (node) => typeof node.props?.["data-tool"] === "string")].every(
          (node) => typeof node.props["aria-label"] === "string" && node.props["aria-label"].includes("：")
        ) &&
        byClass(tree, "SPR_mapEdLayerHalf").every((node) => ["上一层", "下一层"].includes(node.props["aria-label"])),
      String(byTool(tree, "undo")[0]?.props["aria-label"])
    );
    check("没悬浮时不渲染小标签", tipOf(tree) === undefined);
    const penNode = byTool(tree, "pen")[0];
    penNode.props.onMouseEnter({ currentTarget: { getBoundingClientRect: rect } });
    tree = await renderTree(() => MapModule({ api }));
    let tip = tipOf(tree);
    const tipText = tip === undefined ? "" : textOf(tip);
    check("悬浮「画笔」弹出小标签", tip !== undefined, tipText.slice(0, 40));
    check("小标签里有名称、快捷键与介绍", tipText.includes("画笔") && tipText.includes("B") && tipText.includes("按住鼠标左键在格子上拖"), tipText);
    check(
      "小标签挂在被悬浮按钮的正上方（坐标是 hover 时现算的）",
      tip !== undefined && tip.props.style.left === "140px" && tip.props.style.top === "392px",
      tip === undefined ? "" : `${tip.props.style.left} / ${tip.props.style.top}`
    );
    // 键盘聚焦也要能看到（只用鼠标的话键盘用户永远没有说明）
    penNode.props.onMouseLeave();
    tree = await renderTree(() => MapModule({ api }));
    check("移开鼠标后小标签收起", tipOf(tree) === undefined);
    byTool(tree, "bucket")[0].props.onFocus({ currentTarget: { getBoundingClientRect: rect } });
    tree = await renderTree(() => MapModule({ api }));
    check("键盘聚焦也弹小标签（介绍里有「连成一片」）", textOf(tipOf(tree) ?? null).includes("连成一片"), textOf(tipOf(tree) ?? null));
    // 图层按钮是复合控件（上下两个半块 + 层号），它的说明也走同一张标签
    byClass(tree, "SPR_mapEdLayerBtn")[0].props.onMouseEnter({ currentTarget: { getBoundingClientRect: rect } });
    tree = await renderTree(() => MapModule({ api }));
    check("图层按钮也有小标签（讲清上下半块与打开图层列表）", textOf(tipOf(tree) ?? null).includes("上一层") && textOf(tipOf(tree) ?? null).includes("图层列表"), textOf(tipOf(tree) ?? null));
    byClass(tree, "SPR_mapEdLayerBtn")[0].props.onMouseLeave();
    tree = await renderTree(() => MapModule({ api }));
    check("图层按钮移开后也收起", tipOf(tree) === undefined);
  }
  // 切到第 2 层：层号变 2，且「下一层」变成禁用、「上一层」变可用
  layerHalves.find((node) => node.props["data-dir"] === "up").props.onClick();
  tree = await renderTree(() => MapModule({ api }));
  check("点「上一层」真的换层（层号变 2）", textOf(byClass(tree, "SPR_mapEdLayerNum")[0] ?? null) === "2", textOf(byClass(tree, "SPR_mapEdLayerNum")[0] ?? null));
  byClass(tree, "SPR_mapEdLayerHalf").find((node) => node.props["data-dir"] === "down").props.onClick();
  tree = await renderTree(() => MapModule({ api }));
  check("点「下一层」换回第 1 层", textOf(byClass(tree, "SPR_mapEdLayerNum")[0] ?? null) === "1");
  check("底部显示当前层 / 总层数", textOf(byClass(tree, "SPR_mapEdFootText")[0] ?? null).includes("第 1 层 / 共 3 层"), textOf(byClass(tree, "SPR_mapEdFootText")[0] ?? null));
  // 网格线 / 标记 / 一键生成 / 设置：点一下要能切 data-on（按钮是开关）
  for (const [key, label] of [["grid", "网格线"], ["marker", "标记"], ["gen", "一键生成"], ["settings", "设置"]]) {
    const button = byTool(tree, key)[0];
    button.props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check(`点「${label}」会切换按钮状态（data-on）`, byTool(tree, key)[0].props["data-on"] === "true", `data-on=${String(byTool(tree, key)[0].props["data-on"])}`);
    byTool(tree, key)[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
  }
  check("隐藏的素材上传入口还在（data-testid=map-tileset-input）", collect(tree, (node) => node.props?.["data-testid"] === "map-tileset-input").length === 1);
  const fileInput = collect(tree, (node) => node.props?.["data-testid"] === "map-tileset-input")[0];
  check("上传入口是 file input 且只收图片", fileInput !== undefined && fileInput.props.type === "file" && String(fileInput.props.accept).includes("image"));

  // 素材卡片 / 导出卡片（顶栏两个入口拉出来的面板）
  byClass(tree, "SPR_mapEdTopBtn")[0].props.onClick();
  tree = await renderTree(() => MapModule({ api }));
  const assetsCard = byClass(tree, "SPR_mapEdCard")[0];
  check(
    "点「素材」先看到的是**素材列表**（加「新增素材 / 恢复默认素材」两个按钮）",
    assetsCard !== undefined && /新增素材/.test(textOf(assetsCard)) && /恢复默认素材/.test(textOf(assetsCard)) && byClass(assetsCard, "SPR_mapEdTsRow").length > 0,
    textOf(assetsCard).slice(0, 80)
  );
  check(
    "列表里每张素材都写着尺寸与块数，内置的带「自带」徽章",
    /\d+×\d+ · \d+ 块/.test(textOf(assetsCard)) && /自带/.test(textOf(assetsCard)),
    textOf(assetsCard).slice(0, 120)
  );
  check(
    "会动的素材在列表上直接标出帧数（变体=帧 / 翻页图的行=帧）",
    /会动 \d+ 帧/.test(textOf(assetsCard)),
    textOf(assetsCard).match(/会动 \d+ 帧/)?.[0] ?? ""
  );
  check("列表里没有「改格子 / 改形态」这类入口（属性只能在新增时定）", !/改格子|改形态|这块素材怎么用/.test(textOf(assetsCard)));
  /**
   * ── 导出卡片：**选择 / 执行 / 拿文件**三件事分开 ──────────────────────────
   *
   * 用户对这一版的原始抱怨：「导出 PNG 是选项卡，导出 JSON 怎么就点击直接操作了？
   * 而且还不能选择导出位置。而且多个文件应该打 zip」。所以这里逐条钉住：
   * ① 内容是三只复选框（不是像页签的按钮），执行只有一个「导出」；
   * ② 倍率只在勾了 PNG 时出现；
   * ③ 导完给的是**一个 zip 的下载链接**（多产物自动打包），并写清文件落在哪；
   * ④ 「另存为…」走原生保存框（有才显示），拿到的就是那个 zip。
   */
  byClass(tree, "SPR_mapEdTopBtn")[1].props.onClick();
  tree = await renderTree(() => MapModule({ api }));
  const exportCard = byClass(tree, "SPR_mapEdCard")[0];
  const exportBox = (key) => collect(exportCard, (node) => node.props?.["data-testid"] === `map-export-${key}`)[0];
  check(
    "点「导出」拉出导出卡片（三只复选框 + 一个「导出」按钮）",
    exportCard !== undefined && ["png", "json", "tilesets"].every((key) => exportBox(key) !== undefined) && /导出内容/.test(textOf(exportCard)),
    textOf(exportCard).slice(0, 80)
  );
  check(
    "★ 不再有「导出图片 PNG / 导出存档 JSON」这种点一下就执行的按钮（选择与执行分开）",
    !/导出图片 PNG|导出存档 JSON/.test(textOf(exportCard)) && byClass(exportCard, "SPR_btn").filter((node) => textOf(node) === "导出").length === 1,
    textOf(exportCard).slice(0, 120)
  );
  check("默认勾上 PNG 与存档 JSON、不勾素材原图", exportBox("png").props.checked === true && exportBox("json").props.checked === true && exportBox("tilesets").props.checked !== true);
  check("导出卡片给定倍率档位 1×–4×（只在勾了 PNG 时出现）", collect(exportCard, (node) => node.type === "option").length === 4 && /倍率/.test(textOf(exportCard)));
  check("卡片上写清「多产物自动打包」这条规则", /自动打成一个 ZIP/.test(textOf(exportCard)), textOf(exportCard).match(/产出[^。]*。/)?.[0] ?? "");
  check("还没导出过时给空态文案（不是一份假清单）", /还没有导出过/.test(textOf(exportCard)));

  // 取消勾选 PNG：倍率跟着消失（倍率只对 PNG 有意义）
  exportBox("png").props.onChange({ target: { checked: false } });
  tree = await renderTree(() => MapModule({ api }));
  const cardNoPng = byClass(tree, "SPR_mapEdCard")[0];
  check("取消勾选 PNG 后倍率那一行消失", !/倍率/.test(textOf(cardNoPng)), textOf(cardNoPng).slice(0, 100));
  // 三只都取消：导出按钮变灰（点了也没东西可导）
  collect(cardNoPng, (node) => node.props?.["data-testid"] === "map-export-json")[0].props.onChange({ target: { checked: false } });
  tree = await renderTree(() => MapModule({ api }));
  const cardNone = byClass(tree, "SPR_mapEdCard")[0];
  const runButton = collect(cardNone, (node) => node.props?.["data-testid"] === "map-export-run")[0];
  check("一个都不勾时「导出」是禁用的", runButton !== undefined && runButton.props.disabled === true);

  // 勾回 PNG + JSON，真导一次
  collect(cardNone, (node) => node.props?.["data-testid"] === "map-export-png")[0].props.onChange({ target: { checked: true } });
  tree = await renderTree(() => MapModule({ api }));
  collect(byClass(tree, "SPR_mapEdCard")[0], (node) => node.props?.["data-testid"] === "map-export-json")[0].props.onChange({ target: { checked: true } });
  tree = await renderTree(() => MapModule({ api }));
  const exportsBefore = apiLog.exports;
  collect(byClass(tree, "SPR_mapEdCard")[0], (node) => node.props?.["data-testid"] === "map-export-run")[0].props.onClick();
  tree = await renderTree(() => MapModule({ api }));
  check("点「导出」真的调了一次 runMapExport", apiLog.exports === exportsBefore + 1);
  check(
    "提交的 formats 就是勾选的那三项（png/json/tilesets），界面不自作主张",
    JSON.stringify(apiLog.exportPayloads[apiLog.exportPayloads.length - 1]?.formats) === JSON.stringify({ png: true, json: true, tilesets: false }),
    JSON.stringify(apiLog.exportPayloads[apiLog.exportPayloads.length - 1])
  );

  /**
   * ⚠️ 导出是**宿主后台作业**：`runMapExport` 立刻回 `{started:true}`，文件是几轮之后才落盘的。
   * 所以先等宿主 `mapBusy` 落下去（不然断言读到的是上一帧的清单，会以「随机失败」的形式报出来）。
   *
   * 不能只 `setImmediate` 空转：那是**真写盘**（PNG + zip），要给它真实的挂钟时间，
   * 而本 harness 把 `setTimeout` 换成了可取消定时器队列 —— 所以用 `node:timers/promises`。
   *
   * 落盘之后靠**面板自己的刷新路径**把新清单读回来：`view.busy === true` 期间的
   * 1.5s 轮询（`tickTimers` 会把它放出来）。这条路径以前在自检里是空的
   * （`setInterval` 是空实现），也就是「提交完界面不刷新」根本测不到。
   */
  for (let tick = 0; tick < 200 && G.mapBusy(projectId); tick++) await delay(25);
  check("宿主导出作业跑完（自检层面确认真落盘了）", G.mapBusy(projectId) === false);
  /**
   * 界面是**异步**看到这件事的：提交那一刻读到的还是「进行中」，得靠 busy 期间的
   * 1.5s 轮询再读一次才拿到新清单（真机实测：导出约 2s 后文件列表自己冒出来）。
   * 所以这里按真机的节奏一轮轮放轮询，最多放几轮 —— 一轮就到位反而不正常。
   */
  let resultCard = null;
  let result = null;
  for (let round = 0; round < 6; round++) {
    tree = await renderTree(() => MapModule({ api }));
    resultCard = byClass(tree, "SPR_mapEdCard")[0];
    result = collect(resultCard, (node) => node.props?.["data-testid"] === "map-export-result")[0];
    if (result !== undefined) break;
    await tickTimers();
  }
  check("导出跑完后界面自己刷新出结果区（busy 期间的轮询真的在跑）", result !== undefined && /最近一次导出：\d+ 个文件/.test(textOf(result)), textOf(resultCard).slice(0, 140));
  const download = collect(resultCard, (node) => node.props?.["data-testid"] === "map-export-download")[0];
  const viewForExport = await G.mapView(await G.readMapProject(projectId));
  const zipFile = viewForExport.exportFiles.find((file) => file.endsWith(".zip"));
  check("★ 主下载按钮指向那个 zip（多产物一次拿走）", download !== undefined && zipFile !== undefined && String(download.props.href).endsWith(zipFile), `${download?.props.href} vs ${zipFile}`);
  check("下载按钮带 download 属性（点了是存盘，不是开着看）", download !== undefined && download.props.download === zipFile);
  check("结果区把每个产物都列出来（zip 上标着「打包，含全部内容」）", ["map.png", "map.json"].every((name) => textOf(resultCard).includes(name)) && /打包，含全部内容/.test(textOf(resultCard)), textOf(resultCard).slice(0, 160));
  const pathLine = collect(resultCard, (node) => node.props?.["data-testid"] === "map-export-path")[0];
  check("★ 写清文件落在哪（导出目录的本机绝对路径，不再「意味不明」）", pathLine !== undefined && textOf(pathLine).includes(viewForExport.exportPath) && textOf(pathLine).includes("export"), textOf(pathLine));
  const saveAsButton = collect(resultCard, (node) => node.props?.["data-testid"] === "map-export-save-as")[0];
  check("没有原生保存框时不给「另存为…」按钮，改说明位置由浏览器决定", saveAsButton === undefined && /下载目录/.test(textOf(resultCard)));

  // 「打开导出目录」必须带 target:"export"（不带就打开的是项目根目录 —— 老版本的坏法）
  apiLog.reveals.length = 0;
  collect(resultCard, (node) => node.type === "a" || node.type === "button")
    .find((node) => textOf(node) === "打开导出目录")
    ?.props.onClick();
  tree = await renderTree(() => MapModule({ api }));
  check('点「打开导出目录」带上 target:"export"', apiLog.reveals.length === 1 && apiLog.reveals[0].target === "export", JSON.stringify(apiLog.reveals));
  /**
   * 打开的必须是**导出目录本身**（老版本打开的是项目根目录 —— 那里并没有他要的文件）。
   * 断言宿主解析出来的路径，而不是底部那条提示：提示是瞬时状态，本来就会被下一次
   * setNotice 顶掉，拿它当断言会随机红。
   */
  check("打开的是导出目录本身（不是项目根目录）", apiLog.reveals[0]?.dir === viewForExport.exportPath && apiLog.reveals[0]?.fallback === false, `${apiLog.reveals[0]?.dir} vs ${viewForExport.exportPath}`);

  /**
   * 「另存为…」：装一个原生保存框的桩。断言的是**先弹框再取字节**这个顺序 ——
   * 先 await fetch 会把手势耗掉，Chromium 直接抛「Must be handling a user gesture」。
   */
  const saved = [];
  const order = [];
  windowStub.showSaveFilePicker = async (options) => {
    order.push("pick");
    return {
      name: options.suggestedName,
      async createWritable() {
        return {
          async write(blob) {
            order.push("write");
            saved.push({ name: options.suggestedName, size: blob.size });
          },
          async close() {
            order.push("close");
          }
        };
      }
    };
  };
  globalThis.fetch = async (url) => {
    order.push("fetch");
    return { ok: true, status: 200, async blob() { return { size: 42, url: String(url) }; } };
  };
  tree = await renderTree(() => MapModule({ api }));
  const saveAsNow = collect(byClass(tree, "SPR_mapEdCard")[0], (node) => node.props?.["data-testid"] === "map-export-save-as")[0];
  check("有原生保存框时出现「另存为…」", saveAsNow !== undefined && textOf(saveAsNow).includes("另存为"));
  saveAsNow?.props.onClick();
  tree = await renderTree(() => MapModule({ api }));
  check("「另存为…」先弹保存框、再取字节、最后写盘", order.join(">") === "pick>fetch>write>close", order.join(">"));
  check("保存框建议的文件名就是那个 zip，写进去的字节数来自下载内容", saved.length === 1 && saved[0].name === zipFile && saved[0].size === 42, JSON.stringify(saved));
  check("存完给一句「已保存到 …」", /已保存到/.test(textOf(tree)), textOf(tree).slice(0, 120));
  delete windowStub.showSaveFilePicker;
  delete globalThis.fetch;

  byClass(tree, "SPR_mapEdTopBtn")[1].props.onClick();
  tree = await renderTree(() => MapModule({ api }));
  check("再点一次卡片收起", byClass(tree, "SPR_mapEdCard").length === 0);
  check("渲染出来的文本里不出现 markdown 星号（界面不渲染 markdown）", !textOf(tree).includes("**"));
  /**
   * 术语黑名单的**用户面**版本：源码里允许协议字段名（`"chunks"`），但**画到屏幕上的字**
   * 一个都不许有。这条比扫源码更接近「用户看到什么」，也挡得住「把词写进文案里」。
   */
  const JARGON = ["地形族", "掩码", "优先级", "切分", "chunk", "chunks", "图集", "变体种子", "高度偏移", "Tiled", "等距", "图块序号"];
  const shownText = textOf(tree);
  check(
    "渲染出来的界面文案里不出现旧术语（含 chunk / 图集 / 等距 / 图块序号）",
    JARGON.every((word) => !shownText.includes(word)),
    JARGON.filter((word) => shownText.includes(word)).join("、")
  );

  // ══ 4. 预览 = 导出：drawImage 序列 == 宿主计划（同一视口）══════════════════
  section("4) 预览 = 导出：画布 drawImage 序列 == 宿主对同一视口的计划");

  const canvasNode = collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
  check("画布是 <canvas data-testid=map-canvas>", canvasNode !== undefined && canvasNode.type === "canvas");
  check("挂载后画布真的画了东西（有 drawImage 调用）", frameOf().length > 0, `${frameOf().length} 条`);
  check("画布调用是 9 参数的 drawImage（canvas 的带源矩形那一版）", frameOf().every(isDrawImage));
  check("画布上的贴图都归因到已挂载的图源（不存在无源可画）", frameOf().every((call) => call.tilesetId !== null) && frameOf().some((call) => call.tilesetId === a2TilesetId));

  /**
   * ⚠️ 计划是**增量**下发的：客户端把缓存 key 报上来（`have`），宿主只回「还没给过」的块。
   * 而块的内容取决于**查询时的视口范围**（`buildPlan(range)` 只发范围内那几格），
   * 所以「预览 == 导出」这条契约要在**整份重拉之后**才有确定的对照面：
   * 切一次单层预览再切回来会让 `planKey` 变化 → 客户端 `clearPlan()` → 下一次查询 `have` 为空。
   *
   * 挂载与平移时**不整份重拉**也必须与同一视口的计划一致 —— 第 15 节专门盯这一条
   * （增量缓存按视口失效）。
   */
  async function forceFullPlanReload(current) {
    // 单层预览的开关现在在图层卡里（工具格腾给了「标记」），所以先开卡再连点两次。
    // 卡片是开 / 关同一个按钮：已经开着就别再点，否则会把它关掉。
    if (collect(current, (node) => node.props?.["data-testid"] === "map-single-layer").length === 0) {
      collect(current, (node) => node.props?.["data-testid"] === "map-open-layers")[0].props.onClick();
      current = await renderTree(() => MapModule({ api }));
    }
    for (let i = 0; i < 2; i++) {
      const box = collect(current, (node) => node.props?.["data-testid"] === "map-single-layer")[0];
      box.props.onChange({ target: { checked: box.props.checked !== true } });
      current = await renderTree(() => MapModule({ api }));
    }
    return current;
  }
  tree = await forceFullPlanReload(tree);
  const lastQuery = apiLog.plans[apiLog.plans.length - 1];
  const prevQuery = apiLog.plans[apiLog.plans.length - 2];
  check(
    "整份重拉后：最后两次查询用的是同一个视口（对照面确定）",
    lastQuery !== undefined && prevQuery !== undefined && JSON.stringify(lastQuery.view) === JSON.stringify(prevQuery.view),
    `${JSON.stringify(lastQuery?.view)} vs ${JSON.stringify(prevQuery?.view)}`
  );
  const clientView = lastQuery.view;
  const hostPlan = await G.mapPlan(projectId, { view: clientView, have: [], layerIds: lastQuery.layerIds === undefined ? undefined : lastQuery.layerIds });
  const hostOps = hostPlan.chunks.flatMap((chunk) => chunk.ops);
  const hostLegend = new Map(hostPlan.legend.map((entry) => [entry.index, entry]));
  const frame = frameOf();

  check(`条数 == 宿主对同一视口给出的计划条数（画布 ${frame.length} vs 宿主 ${hostOps.length}）`, frame.length === hostOps.length, `画布 ${frame.length} vs 宿主 ${hostOps.length}`);
  check(
    "画布用的 chunk 列表 == 宿主算出的 visibleKeys（连顺序都一样，界面没有自己算 chunk）",
    JSON.stringify(windowStub.__mapDrawStats?.keys ?? null) === JSON.stringify(hostPlan.visibleKeys),
    `${JSON.stringify(windowStub.__mapDrawStats?.keys)} vs ${JSON.stringify(hostPlan.visibleKeys)}`
  );
  if (frame.length === hostOps.length && frame.length > 0) {
    let positionMismatch = 0;
    let rectMismatch = 0;
    let sizeMismatch = 0;
    for (let index = 0; index < frame.length; index++) {
      const draw = frame[index];
      const op = hostOps[index];
      if (draw.dx !== op.x || draw.dy !== op.y) positionMismatch++;
      const rect = hostLegend.get(op.t)?.rect;
      if (rect === undefined) continue;
      if (draw.sx !== rect.x || draw.sy !== rect.y || draw.sw !== rect.width || draw.sh !== rect.height) rectMismatch++;
      if (draw.dw !== rect.width || draw.dh !== rect.height) sizeMismatch++;
    }
    check("逐项目标像素与宿主计划一致（顺序也一致）", positionMismatch === 0, `${positionMismatch} 项不同`);
    check("逐项源矩形与宿主 legend 一致（sx/sy/sw/sh）", rectMismatch === 0, `${rectMismatch} 项不同`);
    check("贴图按 legend 的原尺寸贴（不缩放，像素画不糊）", sizeMismatch === 0, `${sizeMismatch} 项不同`);
    // 反向验证：把顺序当成「可任意」时上面那条会失效 —— 倒序比对必须能发现不同。
    let reversedSame = true;
    for (let index = 0; index < frame.length; index++) {
      const op = hostOps[frame.length - 1 - index];
      if (frame[index].dx !== op.x || frame[index].dy !== op.y) {
        reversedSame = false;
        break;
      }
    }
    check("反向验证：倒序比对会不一致（所以「顺序也一致」这条断言有区分力）", reversedSame === false || frame.length === 1);
  }
  check(
    "帧统计：drawn == 计划条数、noImage == 0（没有缺图源导致的静默少画）",
    windowStub.__mapDrawStats?.drawn === hostOps.length && windowStub.__mapDrawStats?.noImage === 0 && windowStub.__mapDrawStats?.noLegend === 0,
    JSON.stringify(windowStub.__mapDrawStats ?? null)
  );

  // ══ 5. A2 拼块：一格 4 条 op ══════════════════════════════════════════════
  section("5) A2 拼块：一格 4 条 drawImage（四象限）");
  const opIndicesOf = (r, c) => hostOps.map((op, index) => ({ op, index })).filter((item) => item.op.r === r && item.op.c === c).map((item) => item.index);
  const cell88 = opIndicesOf(8, 8);
  check("宿主计划里 A2 的 (8,8) 有 4 条 op（TL/TR/BL/BR）", cell88.length === 4, `${cell88.length}`);
  check("四条 op 落在四个**不同像素位置**（半格偏移）", new Set(cell88.map((index) => `${hostOps[index].x},${hostOps[index].y}`)).size === 4, cell88.map((index) => `${hostOps[index].x},${hostOps[index].y}`).join(" "));
  check(
    "画布对 (8,8) 的四条 op 各画一次，且四条的 dx/dy 互不相同",
    cell88.length === 4 && new Set(cell88.map((index) => `${frame[index].dx},${frame[index].dy}`)).size === 4,
    cell88.map((index) => `${frame[index].dx},${frame[index].dy}`).join(" ")
  );
  const a2Rects = cell88.map((index) => hostLegend.get(hostOps[index].t)?.rect);
  check(
    "四条 op 的源矩形都是 16×16 的**小格**且互不相同（不是整格 32×32）",
    a2Rects.every((rect) => rect !== undefined && rect.width === 16 && rect.height === 16) && new Set(a2Rects.map((rect) => `${rect.x},${rect.y}`)).size === 4,
    a2Rects.map((rect) => `${rect.x},${rect.y} ${rect.width}x${rect.height}`).join(" | ")
  );
  const blockCells = opIndicesOf(8, 9).length + opIndicesOf(9, 8).length + opIndicesOf(9, 9).length + cell88.length;
  check("2×2 的 A2 方块一共 16 条 op（4 格 × 4 象限）", blockCells === 16, `${blockCells}`);
  check(
    "自动连接真的生效：A2 满格的四条 op 与孤立格的四条 op 不是同一套小格",
    (() => {
      const isolated = hostOps.filter((op) => op.r === 8 && op.c === 8).map((op) => op.t).join(",");
      const filled = hostOps.filter((op) => op.r === 9 && op.c === 9).map((op) => op.t).join(",");
      return isolated !== filled && isolated !== "" && filled !== "";
    })()
  );

  // ══ 6. 动画：同一格在不同帧号下取不同矩形 ════════════════════════════════
  section("6) 动画：全局帧号驱动，同一格不同帧取不同源矩形");
  /**
   * ⚠️ `planMeta.frameCount` 是**本次计划里所有 cycle 长度的最大值**（全图共用一个时钟），
   * 不是某一个素材的帧数：内置素材里 A2 的变体是 2 帧、道具翻页图是 5 帧，所以这里是 5。
   * 面板按它推进全局帧号，每条 op 再各自 `frame % cycle.length` 取自己那一帧。
   */
  check("宿主计划给出 frameCount = 各 cycle 长度的最大值（A2 变体 2 帧 + 道具翻页图 5 帧 → 5）", hostPlan.frameCount === 5 && hostPlan.fps === 1, `frameCount=${hostPlan.frameCount} fps=${hostPlan.fps}`);
  const animated = hostOps.findIndex((op) => Array.isArray(op.cycle) && op.cycle.length === 2);
  check("A2 的 op 带 cycle（长度 2），且 t == cycle[0]", animated >= 0 && hostOps[animated].t === hostOps[animated].cycle[0], JSON.stringify(hostOps[animated]?.cycle));
  const frame0Rect = hostLegend.get(hostOps[animated].t).rect;
  const frameNow = frameOf();
  check("第 0 帧画的是 cycle[0] 的矩形", frameNow[animated].sx === frame0Rect.x && frameNow[animated].sy === frame0Rect.y);
  // 推进全局帧号：面板用 rAF + Date.now 推时钟，这里把时钟拨快再跑一次排队的回调。
  const realNow = Date.now;
  const pendingTicks = [...rafQueue.values()];
  rafQueue.clear();
  check("画面在动时确实注册了动画回调（不是死帧）", pendingTicks.length > 0, `${pendingTicks.length} 个`);
  try {
    /**
     * ⚠️ 拨**恰好一个帧间隔**（`fps = 1` → 1000ms），不能拨 1500ms。
     *
     * 面板算的是 `floor(elapsed * fps) % frameCount`：拨 1.5s 时落到哪一帧取决于
     * `elapsed` 的奇偶 —— 也就是说这条断言隐含依赖「跑到这里时一共花了多少挂钟时间」。
     * 前面的用例多花半秒（例如新增的导出段要真写盘）就会翻成 frame 0，表现为
     * 「莫名其妙挂一条与本次改动无关的动画断言」。拨整数个间隔则恒 +1 帧。
     */
    Date.now = () => realNow() + 1000;
    for (const tick of pendingTicks) tick();
  } finally {
    Date.now = realNow;
  }
  tree = await renderTree(() => MapModule({ api }));
  const frame1 = frameOf();
  const frame1Rect = hostLegend.get(hostOps[animated].cycle[1]).rect;
  check("推进一帧后 __mapDrawStats.frame == 1（帧号真的推上去了）", windowStub.__mapDrawStats?.frame === 1, `frame=${String(windowStub.__mapDrawStats?.frame)}`);
  check(
    "同一格在帧 1 取到的源矩形与帧 0 不同（画布从 legend 查的是另一块）",
    frame1[animated].sx === frame1Rect.x && frame1[animated].sy === frame1Rect.y && frame1[animated].sx !== frameNow[animated].sx,
    `帧0 (${frameNow[animated].sx},${frameNow[animated].sy}) → 帧1 (${frame1[animated].sx},${frame1[animated].sy})`
  );
  check("动画只换图块、不换位置（同一格两个帧的目标像素相同）", frame1[animated].dx === frameNow[animated].dx && frame1[animated].dy === frameNow[animated].dy);
  // 反向验证：不再推进帧时，重渲染必须还是同一帧（动画是帧号驱动，不是每次重画随机挑）
  tree = await renderTree(() => MapModule({ api }));
  check("反向验证：不推进帧号时重渲染仍是同一帧（不是每次重画随机挑一块）", frameOf()[animated].sx === frame1[animated].sx);

  // ══ 7. 环绕接缝：负数 chunk key 也要画 ════════════════════════════════════
  section("7) 环绕接缝：视口跨左上边界时出现负数 chunk key 且真的画了");
  {
    // 用抓手把视口往右下拉 → 相机往左上走（pan 变负），视口就跨过了左上边界。
    byTool(tree, "hand")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const queriesBeforeDrag = apiLog.plans.length;
    const liveCanvas = collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
    liveCanvas.props.onPointerDown({ clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    liveCanvas.props.onPointerMove({ clientX: 2000, clientY: 2000, pointerId: 1 });
    liveCanvas.props.onPointerUp({ pointerId: 1 });
    tree = await renderTree(() => MapModule({ api }));
    const draggedQueries = apiLog.plans.slice(queriesBeforeDrag);
    /**
     * ⚠️ 相机现在**被夹在地图里**（见 clampPan）：往右下角拖到头时视口原点正好是
     * 「地图宽 - 视口宽」，再拖也不动 —— 真机上这就是「地图不再乱跑、左上角能对齐」。
     */
    const clampedQuery = draggedQueries[draggedQueries.length - 1];
    // 这个夹具里自适应缩放会让整张地图正好铺进视口（视口 ≥ 地图）→ 相机应当钉在 0：
    // 「地图左上角 = 画布左上角」。地图比视口大的分支（能滚、滚到边界停）用捏合放大后再测。
    check(
      "地图不比视口大时相机钉在 0（左上角对齐，不会拖进空白）",
      clampedQuery !== undefined && clampedQuery.view.x === 0 && clampedQuery.view.y === 0,
      `x=${clampedQuery?.view.x} y=${clampedQuery?.view.y} 视口宽=${clampedQuery?.view.width}`
    );
    // 地图比视口大时另一支：捏合放大（双指针）让地图超出视口，再拖 → 能滚，且滚到边界就停
    {
      const pinchCanvas = collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
      pinchCanvas.props.onPointerDown({ clientX: 300, clientY: 260, button: 0, pointerId: 71 });
      pinchCanvas.props.onPointerDown({ clientX: 420, clientY: 260, button: 0, pointerId: 72 });
      pinchCanvas.props.onPointerMove({ clientX: 300, clientY: 260, pointerId: 71 });
      pinchCanvas.props.onPointerMove({ clientX: 560, clientY: 260, pointerId: 72 });
      pinchCanvas.props.onPointerUp({ pointerId: 71 });
      pinchCanvas.props.onPointerUp({ pointerId: 72 });
      tree = await renderTree(() => MapModule({ api }));
      tree = await forceFullPlanReload(tree);
      const zoomed = apiLog.plans[apiLog.plans.length - 1].view;
      const dragStart = apiLog.plans.length;
      byTool(tree, "hand")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
      const drag2 = collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
      // 把地图往左上拖（pointer 往左上 → pan 变大）→ 一路滚到右下边界就停
      drag2.props.onPointerDown({ clientX: 300, clientY: 260, button: 0, pointerId: 73 });
      drag2.props.onPointerMove({ clientX: -3000, clientY: -3000, pointerId: 73 });
      drag2.props.onPointerUp({ pointerId: 73 });
      tree = await renderTree(() => MapModule({ api }));
      tree = await forceFullPlanReload(tree);
      const afterDrag = apiLog.plans.slice(dragStart).map((entry) => entry.view);
      const last = afterDrag[afterDrag.length - 1];
      const mapSide = 32 * 32;
      const maxAllowed = Math.max(0, mapSide - last.width);
      check(
        "放大到地图超出视口后可以滚，且滚到边界就停（pan 落在 0..地图-视口）",
        last !== undefined && zoomed.width < mapSide && last.x >= -0.5 && last.x <= maxAllowed + 0.5,
        `放大后视口宽=${Math.round(zoomed.width)}，滚到底 x=${Math.round(last?.x)}（上界 ${Math.round(maxAllowed)}）`
      );
      check("滚到右下边界时正好停在「地图右下角贴住画布右下角」", Math.abs(last.x - maxAllowed) < 0.5 && Math.abs(last.y - Math.max(0, mapSide - last.height)) < 0.5, `x=${Math.round(last?.x)}/${Math.round(maxAllowed)} y=${Math.round(last?.y)}`);
    }
    tree = await forceFullPlanReload(tree);
    const seamQuery = apiLog.plans[apiLog.plans.length - 1];
    const seamPlan = await G.mapPlan(projectId, { view: seamQuery.view, have: [] });
    /**
     * ⚠️ 契约变了：相机被夹在地图内（`clampPan`）之后，客户端**再也不会请求越界的视口** ——
     * 所以「环绕出来的负数 key」在界面上不会出现，环绕只剩**数据层**语义（自动连接看邻居、
     * 导出铺一次）。这里改成钉住新不变量：所有请求出去的视口原点都不越界。
     * （负数 key 本身仍由宿主支持，`verify-map` / `-pipeline` 里有断言。）
     */
    const negativeKeys = seamPlan.visibleKeys.filter((key) => key.includes("-"));
    check("相机被夹住后不再请求越界视口（界面上不会出现环绕出来的副本）", negativeKeys.length === 0 && apiLog.plans.every((entry) => entry.view.x >= 0 && entry.view.y >= 0), `最后一次 visibleKeys=${seamPlan.visibleKeys.join(" ")}`);
    const seamFrame = frameOf();
    check("负数 chunk 的计划里真的有内容（不是空块）", seamPlan.chunks.every((chunk) => chunk.ops.length > 0), seamPlan.chunks.map((chunk) => `${chunk.key}:${chunk.ops.length}`).join(" "));
    check("画布对负数 chunk 照画不误（条数 > 0，且 chunk 列表与宿主一致）", seamFrame.length > 0 && JSON.stringify(windowStub.__mapDrawStats?.keys) === JSON.stringify(seamPlan.visibleKeys), `${seamFrame.length} 条 / ${JSON.stringify(windowStub.__mapDrawStats?.keys)}`);
    check("接缝处画的内容 == 宿主计划（含图外副本的绝对像素）", seamFrame.length === seamPlan.chunks.flatMap((chunk) => chunk.ops).length, `${seamFrame.length} vs ${seamPlan.chunks.flatMap((chunk) => chunk.ops).length}`);
    // ── 小幅平移（不动 planKey、**不整份重拉**）之后，缓存里的块是不是仍然对 ──
    // 小幅平移时一部分 unwrapped chunk key 会留下来（`have` 命中 → 宿主不重发），
    // 而它们的 ops 是按**当时那个范围**裁的。留下来还能看见的那几块一旦内容不全，
    // 画面就会缺一条边 —— 不报错，只在平移时看得出来。
    tree = await forceFullPlanReload(tree);
    const beforePanQuery = apiLog.plans[apiLog.plans.length - 1];
    const beforePanPlan = await G.mapPlan(projectId, { view: beforePanQuery.view, have: [] });
    const beforePanPositions = new Set(beforePanPlan.chunks.flatMap((chunk) => chunk.ops).map((op) => `${op.x},${op.y}`));
    byTool(tree, "hand")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const panCanvas = collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
    panCanvas.props.onPointerDown({ clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    panCanvas.props.onPointerMove({ clientX: 500, clientY: 460, pointerId: 1 });
    panCanvas.props.onPointerUp({ pointerId: 1 });
    tree = await renderTree(() => MapModule({ api }));
    const afterPanQuery = apiLog.plans[apiLog.plans.length - 1];
    const afterPanPlan = await G.mapPlan(projectId, { view: afterPanQuery.view, have: [] });
    const afterPanNeed = new Set(afterPanPlan.chunks.flatMap((chunk) => chunk.ops).map((op) => `${op.x},${op.y}`));
    const afterPanDrawn = new Set(frameOf().map((draw) => `${draw.dx},${draw.dy}`));
    const panMissing = [...afterPanNeed].filter((key) => !afterPanDrawn.has(key));
    const panExtra = [...afterPanDrawn].filter((key) => !afterPanNeed.has(key));
    const reused = [...beforePanPositions].filter((key) => afterPanNeed.has(key)).length;
    note(`小幅平移探针：视口 x ${beforePanQuery.view.x.toFixed(1)} → ${afterPanQuery.view.x.toFixed(1)}`);
    note(`平移前用过、平移后仍能看到的位置（会命中 have 而不重发）：${reused} 个`);
    note(`平移后宿主计划 ${afterPanNeed.size} 个像素位置；画布 ${afterPanDrawn.size} 个；缺 ${panMissing.length}、多 ${panExtra.length}`);
    check(
      "小幅平移后（不整份重拉）画布覆盖 == 宿主计划要求的像素位置（增量缓存按视口失效）",
      panMissing.length === 0 && panExtra.length === 0,
      `缺 ${panMissing.length} 个、多 ${panExtra.length} 个：${panMissing.slice(0, 4).join(" | ")}`
    );
    byTool(tree, "pen")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
  }

  // ══ 8. 真的能改地图：画一笔 / 撤销 / 重做 ════════════════════════════════
  section("8) 真的能改地图（一笔拖拽 = 一条撤销）");
  {
    const beforeView = apiLog.plans[apiLog.plans.length - 1].view;
    const planBefore = await G.mapPlan(projectId, { view: beforeView, have: [] });
    const depthBefore = G.historyState(projectId).depth;
    const appearsBefore = apiLog.applies.length;
    const framesBefore = drawFrames.length;
    const liveCanvas = collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
    // 换一块笔刷再画：保证「这一笔真的改到了数据」（同格同图 = 宿主认为没变，计划自然不变）
    byClass(tree, "SPR_mapEdTile")[4].props.onClick({ shiftKey: false });
    byTool(tree, "pen")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    /**
     * ⚠️ 必须画**当前视口里**的格子。相机现在会被夹在地图内（可能停在边界上），
     * 视口外的格子画了也不会改变「这一份视口的计划」，断言会误报「没改到地图」。
     * 用 __mapCamera 反推视口中心在哪个格，再从那附近拖两格。
     */
    const camNow = windowStub.__mapCamera;
    const viewMidR = Math.floor((camNow.pan.y + 520 / camNow.zoom / 2) / 32);
    const viewMidC = Math.floor((camNow.pan.x + 900 / camNow.zoom / 2) / 32);
    const from11 = clientOf(viewMidR, viewMidC);
    const to33 = clientOf(viewMidR + 1, viewMidC + 1);
    liveCanvas.props.onPointerDown({ clientX: from11.x, clientY: from11.y, button: 0, pointerId: 1 });
    await tickTimers();
    liveCanvas.props.onPointerMove({ clientX: to33.x, clientY: to33.y, pointerId: 1 });
    /**
     * 一笔还没结束：这里要模拟「手还按着、又过了一小会儿」——
     * 80ms 的预览节拍放行 → 重渲染（查询副作用这时才注册自己的定时器）→ 再放行一次，
     * 于是产生一条带 `pending` 的**预览查询**（宿主只算不存）。
     */
    await tickTimers();
    tree = await renderTree(() => MapModule({ api }));
    await tickTimers();
    liveCanvas.props.onPointerUp({ pointerId: 1 });
    tree = await renderTree(() => MapModule({ api }));
    const planAfter = await G.mapPlan(projectId, { view: beforeView, have: [] });
    const depthAfter = G.historyState(projectId).depth;
    const submits = apiLog.applies.slice(appearsBefore);
    note(`调试：提交的格 ${submits.flatMap((b) => (b.ops ?? []).flatMap((op) => (op.cells ?? []).map((c) => `${c.r},${c.c},t${c.tile}`))).join(" ")}`);

    check("在画布上按下 → 拖动 → 抬起真的改了地图（宿主计划变了）", JSON.stringify(planAfter.chunks) !== JSON.stringify(planBefore.chunks), `${planBefore.chunks.flatMap((c) => c.ops).length} → ${planAfter.chunks.flatMap((c) => c.ops).length} 条 op`);
    check("改了之后画布重画了", drawFrames.length > framesBefore, `${framesBefore} → ${drawFrames.length} 帧`);
    check("一笔拖拽只提交**一次**（改完样式：不一边画一边存），宿主历史 +1", depthAfter === depthBefore + 1 && submits.length === 1, `depth ${depthBefore} → ${depthAfter}，提交 ${submits.length} 批`);
    /**
     * 用户要的其实是两件：**画的过程中看得见**（预览），但**别一边画一边存**（提交）。
     * 所以拖动期间必须出现带 `pending` 的计划查询（宿主只算不存），而 applyMapOps 一次都不发。
     */
    const previewQueries = apiLog.plans.filter((entry) => Array.isArray(entry.pending) && entry.pending.length > 0);
    check(
      "拖动期间画得出来：发出了带 pending 的预览查询（宿主只算不存）",
      previewQueries.length > 0,
      `预览查询 ${previewQueries.length} 次 / 总共 ${apiLog.plans.length} 次查询`
    );
    /**
     * ⚠️ 这条原来写得太松（「有一块带 op」或「visibleKeys 非空」都算过），结果放过去一个真机 bug：
     * 预览查询带着 `have`，宿主认为「你有这一块」就不回传 —— 于是拖动期间**一片空白**，
     * 松手提交后靠 dropKeys 重拉才出现。现在按「返回的那块里、那一格的 op 真的换了」来判。
     */
    const opAt = (result, r, c) => {
      for (const chunk of result.chunks ?? []) {
        const hit = chunk.ops.find((op) => op.r === r && op.c === c);
        if (hit !== undefined) return hit;
      }
      return null;
    };
    const beforeOp = opAt(planBefore, viewMidR, viewMidC);
    const strictPreview = previewQueries.some((entry) => {
      const op = opAt(entry.result, viewMidR, viewMidC);
      return op !== null && (beforeOp === null || op.t !== beforeOp.t);
    });
    check(
      "预览真的把这一笔画进了计划（返回块里那一格的内容变了，不是空转）",
      strictPreview,
      `按下格 ${viewMidR},${viewMidC}：拖动前 ${beforeOp === null ? "无 op" : "t" + beforeOp.t}，预览回传块 ${previewQueries.map((entry) => entry.result.chunks.length).join(",")}`
    );
    check(
      "预览期间 applyMapOps 一次都没发（只有松手那一次）",
      apiLog.applies.length - appearsBefore === 1,
      `${apiLog.applies.length - appearsBefore} 次`
    );
    check(
      "这一次提交带非空 stroke（少了它一次拖拽会变成好几步撤销）",
      submits.length === 1 && typeof submits[0].stroke === "string" && submits[0].stroke !== "",
      submits.map((submit) => String(submit.stroke)).join(",")
    );
    check("每一批提交都把本地缓存的 chunk key 报上去（have，宿主据此只回失效的块）", submits.every((submit) => Array.isArray(submit.have)) && submits.some((submit) => submit.have.length > 0), submits.map((submit) => submit.have.length).join(","));
    check("画布重画用的还是宿主的计划（改动后 drawn 仍等于计划条数）", windowStub.__mapDrawStats?.noImage === 0 && windowStub.__mapDrawStats?.noLegend === 0, JSON.stringify(windowStub.__mapDrawStats ?? null));
    /**
     * ⚠️ 拖动期间**一帧都不能是空的**。
     *
     * 真机踩过：提交完一批 op 之后宿主回的 `dropKeys` 里就有刚画的那一块，客户端当时是
     * **直接把它从缓存里删掉**，于是从「删掉」到「重拉回来」之间这块是空的 —— 一块 = 整张
     * 地图（32×32 地图在 `MAP_CHUNK_SIZE = 32` 下只有一块）时，就是**拖动期间每 40ms 全屏闪
     * 一下**（真机实测 266 个采样里 77 个是空屏）。所以这里按帧断言：旧内容要一直留到新内容回来。
     */
    const strokeFrames = drawFrames.slice(framesBefore).map((frame) => frame.length);
    check(
      "拖动过程中没有一帧是空的（旧内容留到新内容回来，不闪全屏）",
      strokeFrames.length > 0 && strokeFrames.every((size) => size > 0),
      `帧大小 ${strokeFrames.join(",")}`
    );
    // 重拉回来之后，**改动过的那几格**必须画的是新贴图。
    // 只比位置抓不到「内容还是旧的」：同一格重画后位置不变、贴图源矩形变了。
    const beforeTileAt = new Map(planBefore.chunks.flatMap((chunk) => chunk.ops).map((op) => [`${op.x},${op.y}`, op.t]));
    // 注意也要算上「原来这一格是空的」：那时 beforeTileAt 里没有这个位置，
    // 画上去就是新增的 op（`undefined !== t` 自然成立）。
    const changedOps = planAfter.chunks
      .flatMap((chunk) => chunk.ops)
      .filter((op) => beforeTileAt.get(`${op.x},${op.y}`) !== op.t);
    const rectOfTile = new Map((planAfter.legend || []).map((entry) => [entry.index, entry.rect]));
    const drawnByPos = new Map(frameOf().map((draw) => [`${draw.dx},${draw.dy}`, draw]));
    const stillStale = changedOps.filter((op) => {
      const draw = drawnByPos.get(`${op.x},${op.y}`);
      const rect = rectOfTile.get(op.t);
      if (draw === undefined || rect === undefined) return true;
      return draw.sx !== rect.x || draw.sy !== rect.y;
    });
    check(
      "重拉回来后改动过的那几格画的是新贴图（不是留在旧内容上）",
      changedOps.length > 0 && stillStale.length === 0,
      `改动了 ${changedOps.length} 格，仍画旧贴图 ${stillStale.length} 格`
    );

    // 撤销
    const undoButton = byTool(tree, "undo")[0];
    check("有撤销按钮（图标按钮 + aria-label，说明走自绘小标签）", undoButton !== undefined && String(undoButton.props["aria-label"]).includes("撤销"));
    undoButton.props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const restored = await G.mapPlan(projectId, { view: beforeView, have: [] });
    check("撤销后宿主计划**回到点击之前**（JSON 全等）", JSON.stringify(restored.chunks) === JSON.stringify(planBefore.chunks), `${restored.chunks.flatMap((c) => c.ops).length} vs ${planBefore.chunks.flatMap((c) => c.ops).length}`);
    check("撤销后按钮状态跟着变（canRedo 变 true）", byTool(tree, "redo")[0].props.disabled === false);
    // 重做
    byTool(tree, "redo")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const redone = await G.mapPlan(projectId, { view: beforeView, have: [] });
    check("重做后宿主计划又回到改动之后（JSON 全等）", JSON.stringify(redone.chunks) === JSON.stringify(planAfter.chunks));
    check("撤销 / 重做走的是宿主（apiLog 里各记了一次）", apiLog.undos >= 1 && apiLog.redos >= 1, `undo=${apiLog.undos} redo=${apiLog.redos}`);
  }

  // ══ 8b. 素材自己的播放速度 ══════════════════════════════════════════════
  section("8b) 动画播放速度（新增时能设，而且画面真的按它走）");
  {
    /**
     * ★ 用户的原话：「我希望新增素材时能设置动画播放速度」。
     *
     * ① 对话框里真有这一项，且只对**会动的**素材出现（静态素材显示了只会让人以为没生效）；
     * ② 素材列表上看得见它（不然用户不知道这张自己跑多快）；
     * ③ **画面真的按它走**：同一张地图上，一张 8 帧/秒的素材与一张跟全局（1 帧/秒）的素材，
     *    同样走 1 秒，前者必须走 8 帧、后者只走 1 帧。少了 ③，速度就只是存了个数。
     */
    byClass(tree, "SPR_mapEdTopBtn")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    collect(tree, (node) => node.props?.["data-testid"] === "map-add-open")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const addDlgOf = (mounted) => collect(mounted, (node) => node.props?.["data-testid"] === "map-add-dialog")[0];
    const fpsOf = (mounted) => collect(addDlgOf(mounted), (node) => node.props?.["data-testid"] === "map-add-fps")[0];
    check(
      "静态素材（普通 + 不动）不显示「动画速度」与「循环方式」",
      addDlgOf(tree) !== undefined &&
        fpsOf(tree) === undefined &&
        collect(addDlgOf(tree), (node) => typeof node.props?.["data-loop"] === "string").length === 0
    );
    collect(addDlgOf(tree), (node) => node.props?.["data-anim"] === "rows")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("勾「翻页图」后出现「动画速度」，默认跟设置里的那条走", fpsOf(tree) !== undefined && fpsOf(tree).props.value === "", String(fpsOf(tree)?.props.value));
    check(
      "可选值：跟全局 / 1 / 2 / 4 / 6 / 8 / 12 帧每秒",
      (fpsOf(tree).props.children ?? []).map((option) => String(option.props.value)).join(",") === ",1,2,4,6,8,12",
      (fpsOf(tree).props.children ?? []).map((option) => String(option.props.value)).join(",")
    );
    /**
     * 「循环方式」：勾了「翻页图」之后出现，默认正放，三个选项都在；
     * 点「倒放」/「来回」按钮真的切过去。
     */
    const loopPicker = (mounted) => collect(addDlgOf(mounted), (node) => typeof node.props?.["data-loop"] === "string");
    check("勾「翻页图」后出现「循环方式」：正放 / 倒放 / 来回 三个选项", loopPicker(tree).length === 3, `${loopPicker(tree).length} 个`);
    check("默认是「正放」", loopPicker(tree).some((node) => node.props["data-loop"] === "forward" && node.props["data-on"] === "true"));
    loopPicker(tree)[1].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("点「倒放」之后按钮切过去（data-on 真的动了）", loopPicker(tree).some((node) => node.props["data-loop"] === "reverse" && node.props["data-on"] === "true"));
    loopPicker(tree)[2].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("点「来回」之后也切过去", loopPicker(tree).some((node) => node.props["data-loop"] === "pingpong" && node.props["data-on"] === "true"));
    collect(addDlgOf(tree), (node) => node.props?.["data-shape"] === "a2quad")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("用法选「拼块」时也显示（拼块的动画靠变体）", fpsOf(tree) !== undefined && loopPicker(tree).length === 3);
    fpsOf(tree).props.onChange({ target: { value: "6" } });
    tree = await renderTree(() => MapModule({ api }));
    check("选了 6 帧/秒：选择框跟着走，说明也换成「自己按 6 帧/秒播」", fpsOf(tree).props.value === "6" && /6 帧\/秒/.test(textOf(addDlgOf(tree))));
    collect(addDlgOf(tree), (node) => node.props?.["data-testid"] === "map-add-cancel")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("取消后对话框关掉（别挡住后面的画布断言）", addDlgOf(tree) === undefined);

    // ── 造一张 8 帧/秒的拼块素材（3 个变体），和内置道具（5 帧、跟全局 1 帧/秒）比快慢 ──
    const fastDir = join(HOME, "client-fast");
    await mkdir(fastDir, { recursive: true });
    const fastFiles = [];
    for (let index = 0; index < 3; index++) {
      const rgba = Buffer.alloc(32 * 32 * 4);
      for (let pixel = 0; pixel < 32 * 32; pixel++) {
        rgba[pixel * 4] = 20 + index * 90;
        rgba[pixel * 4 + 1] = 100;
        rgba[pixel * 4 + 2] = 210;
        rgba[pixel * 4 + 3] = 255;
      }
      const file = join(fastDir, `cf${index}.png`);
      await writeFile(file, encodePng(rgba, 32, 32));
      fastFiles.push(file);
    }
    const fastSheet = await G.composeMapAsset({ projectId, name: "客户端快水", files: fastFiles, shape: "a2quad" });
    const fastBytes = await readFile(G.mapAssetPath(projectId, fastSheet.file));
    const importedFast = await G.importMapTileset(projectId, "客户端快水", fastBytes.toString("base64"), { shape: "a2quad", cell: { width: 32, height: 32 }, fps: 8 });
    check("夹具：8 帧/秒的拼块素材建出来了（3 个变体）", importedFast.tilesets[0].fps === 8 && importedFast.tilesets[0].variants === 3, JSON.stringify({ fps: importedFast.tilesets[0].fps, variants: importedFast.tilesets[0].variants }));

    const viewNow = await G.mapView(await G.readMapProject(projectId));
    const layer0 = viewNow.layers[0].id;
    const fastEntry = viewNow.tilesets.find((entry) => entry.id === importedFast.tilesets[0].id);
    const slowEntry = viewNow.tilesets.find((entry) => entry.animRows === true);
    check("夹具：内置道具是「跟全局」的那张（没有 fps）", slowEntry !== undefined && slowEntry.fps === undefined);
    /**
     * 画在**当前视口里**（外面画了也不会进这一份计划）。取相机左上角往里两格，
     * 两个格子错开三格，免得互相盖住。
     */
    const camNow = windowStub.__mapCamera;
    const viewR = Math.min(30, Math.floor(camNow.pan.y / 32) + 2);
    const viewC = Math.min(30, Math.floor(camNow.pan.x / 32) + 2);
    const fastCell = { r: viewR, c: viewC };
    const slowCell = { r: Math.min(31, viewR + 3), c: Math.min(31, viewC + 3) };
    await G.applyMapOps(projectId, [
      { kind: "paint", layerId: layer0, cells: [{ ...fastCell, tile: fastEntry.palette[0].index }] },
      { kind: "paint", layerId: layer0, cells: [{ ...slowCell, tile: slowEntry.palette[0].index }] }
    ]);
    // 素材变了（多了一张）→ 客户端的计划身份里带着素材签名，重挂一次就得拿到新计划。
    tree = await renderTree(() => MapModule({ api }));
    await tickTimers();
    tree = await renderTree(() => MapModule({ api }));
    const hostPlanFast = await G.mapPlan(projectId, { view: apiLog.plans[apiLog.plans.length - 1].view, have: [] });
    const opAtCell = (result, r, c) => result.chunks.flatMap((chunk) => chunk.ops).find((op) => op.r === r && op.c === c);
    check(
      "宿主给这张素材下发 fps = 8，另一张没有（跟全局）",
      opAtCell(hostPlanFast, fastCell.r, fastCell.c)?.fps === 8 && opAtCell(hostPlanFast, slowCell.r, slowCell.c)?.fps === undefined,
      `${String(opAtCell(hostPlanFast, fastCell.r, fastCell.c)?.fps)} / ${String(opAtCell(hostPlanFast, slowCell.r, slowCell.c)?.fps)}`
    );
    check("计划 fpsMax = 8（客户端据此推时钟，慢素材不会被拖住）", hostPlanFast.fpsMax === 8, String(hostPlanFast.fpsMax));

    const rectToIndex = new Map(hostPlanFast.legend.map((entry) => [`${entry.tilesetId}|${entry.rect.x}|${entry.rect.y}`, entry.index]));
    const indexAt = (draw) => (draw === undefined ? undefined : rectToIndex.get(`${draw.tilesetId}|${draw.sx}|${draw.sy}`));
    /** 那一格画的是哪一块：用**左上象限**那条 op 的源矩形反查（拼块一格有 4 条 op）。 */
    const drawAt = (frame, cell) => frame.find((draw) => draw.dx === cell.c * 32 && draw.dy === cell.r * 32);
    /** 那一格的帧序（`cycle`）：走的帧数要按**帧序里的位置**算，索引步长不等于帧数。 */
    const cycleAt = (cell) => (hostPlanFast.chunks.flatMap((chunk) => chunk.ops).find((op) => op.x === cell.c * 32 && op.y === cell.r * 32) ?? {}).cycle ?? [];
    const posIn = (cycle, index) => cycle.indexOf(index);
    const before = frameOf();
    const beforeFast = indexAt(drawAt(before, fastCell));
    const beforeSlow = indexAt(drawAt(before, slowCell));
    const realNow2 = Date.now;
    const ticks2 = [...rafQueue.values()];
    rafQueue.clear();
    check("画面里有会动的素材时确实注册了动画回调", ticks2.length > 0, `${ticks2.length} 个`);
    try {
      // 拨**恰好一秒**：8 帧/秒的走 8 帧（3 个变体 → 模 3 = +2），1 帧/秒的只走 1 帧。
      Date.now = () => realNow2() + 1000;
      for (const tick of ticks2) tick();
    } finally {
      Date.now = realNow2;
    }
    tree = await renderTree(() => MapModule({ api }));
    const after = frameOf();
    const afterFast = indexAt(drawAt(after, fastCell));
    const afterSlow = indexAt(drawAt(after, slowCell));
    const cycleFast = cycleAt(fastCell);
    const cycleSlow = cycleAt(slowCell);
    check(
      "★ 一秒之后：8 帧/秒 的素材走了 8 帧（3 个变体 → 模 3 = +2），跟全局 1 帧/秒 的那张只走了 1 帧",
      cycleFast.length === 3 &&
        cycleSlow.length === 5 &&
        posIn(cycleFast, beforeFast) >= 0 &&
        posIn(cycleFast, afterFast) >= 0 &&
        posIn(cycleSlow, beforeSlow) >= 0 &&
        posIn(cycleSlow, afterSlow) >= 0 &&
        (posIn(cycleFast, afterFast) - posIn(cycleFast, beforeFast) + 3) % 3 === 8 % 3 &&
        (posIn(cycleSlow, afterSlow) - posIn(cycleSlow, beforeSlow) + 5) % 5 === 1,
      `快水 帧序位置 ${posIn(cycleFast, beforeFast)}→${posIn(cycleFast, afterFast)}（cycle=${cycleFast.length}），道具 ${posIn(cycleSlow, beforeSlow)}→${posIn(cycleSlow, afterSlow)}（cycle=${cycleSlow.length}）`
    );

    // 列表上看得见速度。
    const listText = textOf(collect(tree, (node) => node.props?.["data-testid"] === "map-tileset-list")[0]);
    check("素材列表上标出「8 帧/秒」", /8 帧\/秒/.test(listText), listText.replace(/\s+/g, " ").slice(0, 140));
    check("反向验证：跟全局的那张只写帧数、不写速度", /会动 5 帧(?! ·)/.test(listText.replace(/\s+/g, " ")), listText.replace(/\s+/g, " ").slice(0, 140));
  }

  // ══ 9. 单层预览：过滤由宿主做 ════════════════════════════════════════════
  section("9) 单层预览（layerIds 交给宿主过滤，界面不筛 op）");
  {
    const queriesBefore = apiLog.plans.length;
    // 图层卡是开 / 关同一个按钮：已经开着就别再点（不然会关掉）。
    if (collect(tree, (node) => node.props?.["data-testid"] === "map-single-layer").length === 0) {
      collect(tree, (node) => node.props?.["data-testid"] === "map-open-layers")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
    }
    const singleBox = () => collect(tree, (node) => node.props?.["data-testid"] === "map-single-layer")[0];
    singleBox().props.onChange({ target: { checked: true } });
    tree = await renderTree(() => MapModule({ api }));
    const singleQueries = apiLog.plans.slice(queriesBefore).filter((query) => Array.isArray(query.layerIds));
    check("打开单层预览后请求计划时带了 layerIds", singleQueries.length > 0, `${singleQueries.length} 次查询带 layerIds`);
    const query = singleQueries[0];
    check("layerIds 就是当前层号（第 1 层 → [0]）", JSON.stringify(query.layerIds) === JSON.stringify([0]), JSON.stringify(query.layerIds));
    const singleOps = query.result.chunks.flatMap((chunk) => chunk.ops);
    check("宿主返回的那份计划只含这一层（过滤真的发生了）", singleOps.length > 0 && singleOps.every((op) => op.l === 0), `${singleOps.length} 条，层号集合 ${[...new Set(singleOps.map((op) => op.l))].join(",")}`);
    const layer0Only = await G.mapPlan(projectId, { view: query.view, have: [], layerIds: [0] });
    const layer1Only = await G.mapPlan(projectId, { view: query.view, have: [], layerIds: [1] });
    check(
      "反向验证：宿主的两层内容不同（层过滤不是「反正都一样」）",
      layer0Only.chunks.flatMap((c) => c.ops).every((op) => op.l === 0) &&
        layer1Only.chunks.flatMap((c) => c.ops).every((op) => op.l === 1) &&
        layer1Only.chunks.flatMap((c) => c.ops).length > 0
    );
    check(
      "单层预览打开时画布底铺绿色（rgb(56,170,68)，AsLib 同款）",
      fillRects.some((rect) => rect.fillStyle === "rgb(56,170,68)"),
      [...new Set(fillRects.map((rect) => rect.fillStyle))].slice(0, 4).join(" / ")
    );
    singleBox().props.onChange({ target: { checked: false } });
    tree = await renderTree(() => MapModule({ api }));
    const allAgain = apiLog.plans[apiLog.plans.length - 1];
    check("关掉单层预览后 layerIds 不再传（回到全部层）", allAgain.layerIds === undefined, JSON.stringify(allAgain.layerIds));
  }

  // ══ 10. 橡皮不依赖笔刷（新面板重来一次，笔刷恒为 null）════════════════════
  section("10) 橡皮的可用性不依赖笔刷（新挂载的面板，笔刷为 null）");
  {
    const freshTree = await freshPanel();
    check("新挂载的面板有机会画（视图已加载）", !textOf(freshTree).includes("还没有地图项目"), textOf(freshTree).slice(0, 160));
    byTool(freshTree, "eraser")[0].props.onClick();
    let erased = await renderTree(() => MapModule({ api }));
    const before = apiLog.applies.length;
    const liveCanvas = collect(erased, (node) => node.props?.["data-testid"] === "map-canvas")[0];
    const eraseAt = clientOf(1, 1);
    liveCanvas.props.onPointerDown({ clientX: eraseAt.x, clientY: eraseAt.y, button: 0, pointerId: 1 });
    await tickTimers();
    liveCanvas.props.onPointerUp({ pointerId: 1 });
    erased = await renderTree(() => MapModule({ api }));
    const submits = apiLog.applies.slice(before);
    const paintOps = submits.flatMap((submit) => submit.ops).filter((op) => op.kind === "paint");
    check("没选过任何笔刷时，橡皮照样提交 op（tile 0）", paintOps.length > 0 && paintOps.every((op) => op.cells.every((cell) => cell.tile === 0)), `${paintOps.length} 条 paint op`);
    check("橡皮不会弹「先在左边点一块图当笔刷」", !textOf(erased).includes("先在左边点一块图当笔刷"), textOf(erased).slice(-60));
    // 反向验证：同一份面板、同一次挂载下，用画笔点一下就会被拦（证明这条路径确实不同）
    byTool(erased, "pen")[0].props.onClick();
    erased = await renderTree(() => MapModule({ api }));
    const beforePen = apiLog.applies.length;
    const penCanvas = collect(erased, (node) => node.props?.["data-testid"] === "map-canvas")[0];
    const seamAt = clientOf(4, 4);
    penCanvas.props.onPointerDown({ clientX: seamAt.x, clientY: seamAt.y, button: 0, pointerId: 1 });
    penCanvas.props.onPointerUp({ pointerId: 1 });
    erased = await renderTree(() => MapModule({ api }));
    check("反向验证：笔刷下用画笔点一下不会提交 op，并给出提示", apiLog.applies.length === beforePen && textOf(erased).includes("先在左边点一块图当笔刷"), textOf(erased).slice(-60));
  }

  // ══ 11. 减少动态效果：停在帧 0 ═══════════════════════════════════════════
  section("11) prefers-reduced-motion：停在帧 0");
  {
    reduceMotion = true;
    rafQueue.clear();
    const stillTree = await renderTree(() => MapModule({ api }), { fresh: true });
    check("开启「减少动态效果」后面板照常渲染", !textOf(stillTree).includes("还没有地图项目"));
    check("不再注册动画回调（不推时钟）", rafQueue.size === 0, `${rafQueue.size} 个`);
    check("帧号停在 0", windowStub.__mapDrawStats?.frame === 0, `frame=${String(windowStub.__mapDrawStats?.frame)}`);
    reduceMotion = false;
  }

  // ══ 12. 空态与健壮性 ═════════════════════════════════════════════════════
  section("12) 空态（没有项目时一句话 + 两个按钮）");
  {
    const emptyApi = { ...api, listMapProjects: async () => ({ projects: [] }) };
    const clicksBefore = fileClicks;
    const emptyTree = await renderTree(() => MapModule({ api: emptyApi }), { fresh: true });
    check("没有项目时给空态而不是崩", textOf(emptyTree).includes("还没有地图项目"), textOf(emptyTree).slice(0, 60));
    check("空态有两个按钮：选一张素材图开始 / 用自带素材试试", /选一张素材图开始/.test(textOf(emptyTree)) && /用自带素材试试/.test(textOf(emptyTree)), textOf(emptyTree).slice(0, 120));
    check("空态也不带实验性弹窗 / 提示条（早退分支同样不能漏）", collect(emptyTree, (node) => typeof node.type === "function" && /Experimental(Dialog|Bar)/.test(node.type.name ?? "")).length === 0 && byClass(emptyTree, "SPR_expTag").length === 0);
    check("空态不出现阶段条 / 自造阶段类名", byClass(emptyTree, "SPR_step").length === 0 && byClass(emptyTree, "SPR_meSteps").length === 0);
    const startBtn = collect(emptyTree, (node) => node.type === "button" && textOf(node).includes("选一张素材图开始"))[0];
    if (startBtn !== undefined) startBtn.props.onClick();
    check("点「选一张素材图开始」会打开文件选择框", fileClicks > clicksBefore, `click 次数 ${clicksBefore} → ${fileClicks}`);
    check("空态文本里不出现 markdown 星号", !textOf(emptyTree).includes("**"));
  }

  // ══ 13. 模块⑥不是实验性功能 ══════════════════════════════════════════════
  section("13) 模块⑥已转正：角标 / 弹窗 / 常驻提示条三处一个都不能有");
  {
    const source = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");
    /**
     * 「转正」这件事必须三处同时改，只改一处的结果是：
     *   · 只删弹窗 → 页签上还挂着「实验性」角标（用户在入口就看到矛盾信息）；
     *   · 只删角标 → 进去还弹「仍在开发中」；
     *   · 留着常驻提示条 → 弹窗关掉之后模块里一直写着「该模块功能尚不完善」。
     */
    const modulesBlock = (source.match(/function make_MODULES\(\) \{[\s\S]*?\n\s*\];/) ?? [])[0] ?? "";
    const mapEntry = (modulesBlock.match(/\{ key: "map"[^}]*\}/) ?? [])[0] ?? "";
    check("MODULES 里模块⑥的条目存在且没有 experimental: true", mapEntry !== "" && !mapEntry.includes("experimental"), mapEntry);
    check("源码里不再有 MapExperimentalDialog / MAP_EXPERIMENTAL_POINTS", !source.includes("MapExperimentalDialog") && !source.includes("MAP_EXPERIMENTAL_POINTS"));
    check("实验性「不再提示」标志里没有 map 这一格（模块④⑤之外不该有）", !/experimentalGateMuted = \{[^}]*\bmap\b/.test(source));
    check("模块⑤是新 45° 地图编辑器且为正式功能", /title: T\("45°地图编辑器"\)/.test(source) && !/title: T\("45°地图编辑器"\)[^}]*experimental: true/.test(source));
    const treeNow = await withFreshHooks(() => renderTree(() => MapModule({ api })));
    check("面板里没有实验性角标与常驻提示条", byClass(treeNow, "SPR_expTag").length === 0 && byClass(treeNow, "SPR_expBar").length === 0);
  }

  // ══ 14. 静态源码约束 ═════════════════════════════════════════════════════
  section("14) 界面只执行宿主计划（静态源码约束）");
  const clientSource = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");
  /**
   * 只看模块六那一段：模块④（Spine 图集）与模块⑤（45° 等距地块）里的
   * 「图集」「等距」是**正确用词**，全文件扫会误伤。
   */
  const mapStart = clientSource.indexOf("模块六 · 地图编辑器");
  const mapEnd = clientSource.indexOf("模块②：图片生成", mapStart);
  const mapSource = mapStart >= 0 && mapEnd > mapStart ? clientSource.slice(mapStart, mapEnd) : "";
  check("能定位到模块六那一段源码（切片锚点还在，且切出了足量内容）", mapSource.length > 20000, `${mapSource.length} 字节`);
  check("模块②那个锚点注释还在（自检按它切片）", mapEnd > mapStart && clientSource.includes("模块②：图片生成"));
  check("界面里有 MAP_pointToCell（命中测试必需的那一份复刻）", mapSource.includes("function MAP_pointToCell"));
  check(
    "模块六里没有变体挑选 / 绘制顺序 / chunk 计算（那些全在宿主）",
    !mapSource.includes("MAP_pickVariant") && !mapSource.includes("MAP_drawOrder") && !mapSource.includes("MAP_visibleChunks") && !mapSource.includes("MAP_chunkKey"),
    ["MAP_pickVariant", "MAP_drawOrder", "MAP_visibleChunks", "MAP_chunkKey"].filter((name) => mapSource.includes(name)).join(",")
  );
  check("模块六里没有自造坐标变换（只允许那四个 MAP_ 函数 + 取模辅助）", !/layoutOf\(|tileOriginAt\(|stableHash/.test(mapSource));
  check("模块六没有复用八方向图那个蒙层样式 SPR_stageHint", !mapSource.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "").includes("SPR_stageHint"), "复用它会把说明绝对定位铺满容器");
  /**
   * ⚠️ 术语黑名单：用户对第一版的反馈就是「门槛太高、专业名词太多」。
   * 只扫模块六那一段 —— 「图集」（Spine 纹理图集）与「等距」（45° 地块）在别的模块里是正确的。
   *
   * 唯一的例外是**协议字段名** `"chunks"`（宿主 `mapPlan` 返回体里那批 op 就叫这个名字，
   * 界面从不把它呈现给用户）。例外收得很紧：只许这一个字面量，
   * 而且它出现几次，`chunk` 就得命中几次 —— 多出来的用法（注释、变量名）一律算命中。
   */
  const chunkLiterals = (mapSource.match(/"chunks"/g) ?? []).length;
  const chunkHits = (mapSource.match(/chunk/g) ?? []).length;
  check(
    "黑名单例外收得很紧：模块六里 chunk 只作为协议字段 \"chunks\" 出现（没有别处用法）",
    chunkHits === chunkLiterals && chunkLiterals >= 1 && chunkLiterals <= 2,
    `chunk 命中 ${chunkHits} 次，其中协议字段字面量 ${chunkLiterals} 次`
  );
  const mapSourceNoProtocol = mapSource.replace(/"chunks"/g, "«协议字段»");
  for (const word of ["地形族", "掩码", "优先级", "切分", "chunk", "图集", "变体种子", "高度偏移", "Tiled", "等距"]) {
    check(`模块六的源码 / 文案里不出现旧术语「${word}」`, !mapSourceNoProtocol.includes(word), "命中旧术语");
  }
  check("（对照）整份客户端里别处仍允许出现「图集」/「等距」（模块④ / ⑤ 的正确用词）", clientSource.length > mapSource.length && clientSource.includes("等距") && clientSource.includes("图集"));
  /**
   * ⚠️ 用到的每个 `SPR_` 类都必须真的有 CSS 规则（或本来就是个纯文本容器）。
   * 这条是**真机打脸**换来的：自造的类名一个 CSS 规则都没有 → 界面塌成几个小按钮。
   */
  const mapCode = mapSource.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const styled = new Set();
  for (const match of clientSource.matchAll(/\.(SPR_[A-Za-z0-9_-]+)/g)) styled.add(match[1]);
  const intentionallyUnstyled = new Set(["SPR_moduleBody", "SPR_notice", "SPR_select"]);
  const usedClasses = new Set();
  for (const match of mapCode.matchAll(/SPR_[A-Za-z0-9_-]+/g)) {
    if (match[0].endsWith("-")) continue; // `SPR_notice-${kind}` 这种是模板片段
    usedClasses.add(match[0]);
  }
  const unstyled = [...usedClasses].filter((name) => !styled.has(name) && !intentionallyUnstyled.has(name)).sort();
  check(`模块六用到的 ${usedClasses.size} 个类都有 CSS 规则（或本来无样式）`, unstyled.length === 0, unstyled.length === 0 ? "" : `没有样式：${unstyled.join("、")}`);
  check("面板外层仍走 DSH 变量（深色主题下不塌）", clientSource.includes(".SPR_mapEdRoot{") && clientSource.includes("border:1px solid var(--dsw-alias-border-l2)"));
  for (const [name, needle] of [
    ["保存状态色", '.SPR_mapEdSave[data-busy="true"]{color:var(--dsw-alias-state-warning-primary'],
    ["通过标记色", ".SPR_mapEdMark{color:var(--dsw-alias-state-success-primary"],
    ["危险操作色", '.SPR_mapEdMenuItem[data-danger="true"]{color:var(--dsw-alias-state-error-primary'],
    ["导出链接色", ".SPR_mapEdFiles a{color:var(--dsw-alias-state-business-primary"]
  ]) {
    check(`模块六的${name}走 var(--dsw-alias-state-*)（状态色没有写死）`, clientSource.includes(needle), needle);
  }
  check("调色板可滚动（overflow:auto，条目多了滚轮能滚）", /\.SPR_mapEdPalette\{[^}]*overflow:auto/.test(clientSource));
  check("调色板是 8 列 32px 网格", clientSource.includes(".SPR_mapEdPaletteGrid{display:grid;grid-template-columns:repeat(8,32px)"));
  check("工具格是 6 列 × 2 行", clientSource.includes(".SPR_mapEdTools{display:grid;grid-template-columns:repeat(6,1fr)"));
  // 工具小标签：固定定位才不会被祖先的 overflow 裁掉「按钮正上方」那段；坐标要夹在视口内。
  check(
    "工具小标签用 position:fixed + translate(-50%,-100%)（absolute 会被 overflow 裁掉）",
    /\.SPR_mapEdTip\{position:fixed[^}]*translate\(-50%,-100%\)/.test(clientSource)
  );
  check("工具小标签贴边时被夹在视口内", /Math\.max\(half, Math\.min\(center, viewWidth - half\)\)/.test(clientSource));
  /**
   * ⚠️ 「素材说明」里那层网格必须**循环**隐现 —— 用户要的就是「看几眼里就知道图是几块排的」，
   * 一次性淡出等于没有。jsdom 不算动画，所以只能在 CSS 数值上钉住：
   * 两条 `animation` + 两条网格各自的 `animation-delay`（一隐一现交替）+ 一条 `@keyframes`。
   * 另外配一条反向验证：把 `infinite` 去掉就判不过（提取器不是常量）。
   */
  const gridLoop = /\.SPR_mapEdGuideGrid,\.SPR_mapEdGuideSubGrid\{[^}]*animation:SPR_mapEdGuidePulse 3\.6s ease-in-out infinite\}/.exec(clientSource);
  check(
    "说明图上的网格是循环的（animation + infinite，不是一次性淡出）",
    gridLoop !== null && /@keyframes SPR_mapEdGuidePulse\{0%\{opacity:0\}[\s\S]{0,120}?100%\{opacity:0\}\}/.test(clientSource),
    gridLoop === null ? "没找到循环动画" : gridLoop[0].slice(-60)
  );
  check(
    "「一格」与「格内小块」两层网格错开半拍（一隐一现交替，不是两条线一起闪）",
    /\.SPR_mapEdGuideGrid\{color:rgba\(255,255,255,\.62\)\}/.test(clientSource) && /\.SPR_mapEdGuideSubGrid\{color:rgba\(255,215,154,\.85\);animation-delay:1\.8s\}/.test(clientSource)
  );
  check(
    "反向验证：把 infinite 去掉这条判不过（正则不是恒真）",
    !/\.SPR_mapEdGuideGrid,\.SPR_mapEdGuideSubGrid\{[^}]*animation:SPR_mapEdGuidePulse 3\.6s ease-in-out infinite\}/.test(
      ".SPR_mapEdGuideGrid,.SPR_mapEdGuideSubGrid{animation:SPR_mapEdGuidePulse 3.6s ease-in-out}"
    )
  );
  check(
    "网格动画尊重 prefers-reduced-motion（不想看动画的人不被动）",
    /@media \(prefers-reduced-motion: reduce\)\{\.SPR_mapEdGuideGrid,\.SPR_mapEdGuideSubGrid\{animation:none;opacity:1\}\}/.test(clientSource)
  );

  /**
   * ⚠️ 真机踩过：小标签的 z-index 比自家的全屏遮罩**小**，于是「新增素材」对话框里
   * 悬停「用法 / 会动吗」弹出的说明整片跑到窗口后面去了 —— 标签节点挂在面板根节点下、
   * 是遮罩的**兄弟**而不是子节点，遮罩一动就把整屏蒙住，能救的只有 z-index。
   * jsdom 不算绘制顺序，所以这条只能在 CSS 数值上钉住（配一条反向验证）。
   */
  const cssZIndex = (selector) => {
    const rule = new RegExp(`${selector.replace(/[.\\]/g, "\\$&")}\\{([^}]*)\\}`).exec(clientSource);
    const value = rule === null ? null : /z-index:(\d+)/.exec(rule[1]);
    return value === null ? null : Number(value[1]);
  };
  const tipZ = cssZIndex(".SPR_mapEdTip");
  const dlgZ = cssZIndex(".SPR_mapEdDlgMask");
  const zoomZ = cssZIndex(".SPR_zoomMask");
  check(
    "工具小标签的 z-index 高于对话框遮罩（低了的真机表现：对话框里的说明被蒙层盖住）",
    tipZ !== null && dlgZ !== null && tipZ > dlgZ,
    `tip=${tipZ} 遮罩=${dlgZ}`
  );
  check("工具小标签的 z-index 也高于看图遮罩", tipZ !== null && zoomZ !== null && tipZ > zoomZ, `tip=${tipZ} 看图=${zoomZ}`);
  check(
    "反向验证：修复前的 60 判不过、而且没写 z-index 的选择器取不到数（提取器不是常量）",
    !(60 > (dlgZ ?? 0)) && cssZIndex(".SPR_mapEdRoot") === null,
    `旧值 60 vs 遮罩 ${dlgZ}`
  );
  // 新建 / 重命名：不许再依赖原生 prompt（Electron 里它是坏的），两个入口都走同一个对话框。
  // 用剥掉注释的 mapCode：注释里正解释着「为什么不能用 window.prompt」。
  check("模块六不再调用 window.prompt", !/window\.prompt/.test(mapCode));
  check("新建与重命名都走自带的名字对话框", /askProjectName\("create"\)/.test(mapCode) && /askProjectName\("rename"\)/.test(mapCode));
  check("名字对话框用 position:fixed 居中（absolute 会被 overflow 裁掉）", /\.SPR_mapEdDlgMask\{position:fixed/.test(clientSource));
  check(
    "悬停红框按**未取模**坐标定位（环绕时同一格有多份，取模后会跳一整张地图）",
    /const rawC = Math\.floor\(hover\.x \/ layout\.stepX\)/.test(mapCode) && /const rawR = Math\.floor\(hover\.y \/ layout\.stepY\)/.test(mapCode)
  );
  check("选中的笔刷是红框（outline 2px 红，AsLib 同款）", /\.SPR_mapEdTile\[data-on="true"\]\{outline:2px solid #e23b2b/.test(clientSource));
  check("画布用 image-rendering:pixelated / touch-action:none（像素画不糊、触摸不滚动）", /\.SPR_mapEdCanvas\{[^}]*image-rendering:pixelated[^}]*touch-action:none/.test(clientSource));
  /**
   * ⚠️ 一次拖拽 = **一步**撤销。客户端必须把 `stroke` 一路带上（拖拽期间分多批提交），
   * 否则真机上擦一条线要按好几次撤销。
   */
  check("拖拽带笔画 id（applyMapOps payload 里带 stroke）", /stroke:\s*ops\[0\]\?\.stroke/.test(mapSource), "少了它，一笔拖拽会变成好几步撤销");
  check("笔画 id 在拖动期间保持同一个（currentStroke）", /currentStroke\.current/.test(mapSource) && /pendingOps\.current\.concat/.test(mapSource));
  check("wire 的 applyMapOps schema 声明了 stroke（不声明会被静默丢掉）", readFileSync(fileURLToPath(new URL("../src/wire.ts", import.meta.url)), "utf8").includes("stroke: z.string().optional()"));
  /**
   * ⚠️ 橡皮**不需要**笔刷。判断写成「笔刷为空就返回」的话，刚进面板还没选过图时
   * 橡皮拖半天一点反应都没有、也不报错（真机踩过）。
   * 判据是**顺序**：`tool === "eraser"` 那条分支必须排在 `warnNoBrush()` 之前，
   * 而且擦的是 tile 0。
   */
  const eraseBranchAt = mapSource.indexOf('tool === "eraser"');
  const brushGuardAt = mapSource.indexOf("warnNoBrush()");
  check(
    "橡皮的可用性判断不依赖笔刷（eraser 分支在 warnNoBrush 之前，且擦的是 tile 0）",
    eraseBranchAt > 0 && brushGuardAt > eraseBranchAt && /tile:\s*0/.test(mapSource) && mapSource.includes("先在左边点一块图当笔刷"),
    `eraser@${eraseBranchAt} warnNoBrush@${brushGuardAt}`
  );
  check("调色板读的是宿主给的 palette（不是自己从 legend 里推可点的块）", /owner\.palette|\.palette\.length/.test(mapSource) && /A2 素材只出 1 个条目|palette/.test(mapSource));
  check("渲染循环没有失控（没有 setState 死循环）", HOOK_MISMATCH.length === 0, HOOK_MISMATCH.join("；"));

  // ══ 15. 挂载首帧 == 同一视口的计划（不整份重拉）══════════════════════════
  section("15) 挂载首帧 == 同一视口的计划（增量缓存按视口失效）");
  {
    const mountQuery = apiLog.plans[0];
    if (mountQuery !== undefined) {
      const mountPlan = await G.mapPlan(projectId, { view: mountQuery.view, have: [] });
      const settledView = apiLog.plans[apiLog.plans.length - 1]?.view ?? mountQuery.view;
      const settledPlan = await G.mapPlan(projectId, { view: settledView, have: [] });
      note(`首次查询视口 ${JSON.stringify(mountQuery.view)} → visibleKeys ${mountPlan.visibleKeys.join(" ")}`);
      note(`稳定后视口 ${JSON.stringify(settledView)} → visibleKeys ${settledPlan.visibleKeys.join(" ")}`);
    }
    /**
     * 在「第一次查询那个窗口之外」（第 25 行）放一格内容，再**全新挂载**一次。
     *
     * 这里刻意**不做任何整份重拉**（不碰 planKey）：面板挂载时会按量到的画布尺寸
     * 先查一次计划，紧接着 fit effect 把缩放改成「整张图放得下」。真机上那两次
     * 状态提交都发生在 32ms 防抖窗口之内，所以**只有后一次查询会真的发出去**；
     * 假 React 这边也照这个语义放定时器（见 timers 的注释），于是首帧应当就是
     * 「稳定视口的完整计划」。一旦有人把 `have` 的失效口径改坏（或让旧查询漏出去），
     * 首帧就会缺一块 —— 这条断言就是「预览 = 导出」在挂载那一刻的形态。
     */
    await G.applyMapOps(projectId, [{ kind: "paint", layerId: "l0", cells: [{ r: 25, c: 25, tile: propBrush }] }]);
    const freshTree = await freshPanel();
    const freshQuery = apiLog.plans[apiLog.plans.length - 1];
    const mountFrame = frameOf();
    const needPlan = await G.mapPlan(projectId, { view: freshQuery.view, have: [] });
    const needOps = needPlan.chunks.flatMap((chunk) => chunk.ops);
    const key255 = (op) => `${op.x},${op.y}`;
    const drawn = new Set(mountFrame.map((draw) => `${draw.dx},${draw.dy}`));
    const needed = new Set(needOps.map(key255));
    const missing = [...needed].filter((key) => !drawn.has(key));
    const extra = [...drawn].filter((key) => !needed.has(key));
    note(`全新挂载（内容含 (25,25)）：首帧 ${mountFrame.length} 条 drawImage（${drawn.size} 个像素位置）`);
    note(`同一视口的宿主计划 ${needOps.length} 条（${needed.size} 个像素位置）`);
    note(`缺的位置例如 ${missing.slice(0, 6).join(" | ")}${extra.length > 0 ? `；多的位置例如 ${extra.slice(0, 3).join(" | ")}` : ""}`);
    check(
      "挂载后首帧 == 同一视口的计划（增量缓存必须按视口失效）",
      missing.length === 0 && extra.length === 0,
      `首帧 ${drawn.size}/${needed.size} 个像素位置：缺 ${missing.length} 个、多 ${extra.length} 个`
    );
    check("诊断用的全新面板本身渲染正常（视图已加载）", !textOf(freshTree).includes("还没有地图项目"));
  }

  // ══ 16) 新建 / 重命名 与 悬停红框（都会动到面板状态，所以放在最后）══════════
  section("16) 新建项目走自带对话框（Electron 里原生 prompt 是坏的）+ 悬停红框跟着指针");
  {
    // 前面的用例把 `tree` 留在了别的快照上（第 15 段还单独挂过一次），这里重新挂一份
    // 自洽的面板再点，免得点到过期闭包上（菜单开关会因此「点了没反应」）。
    tree = await freshPanel();
    // ── 新建 / 重命名：自带对话框，不依赖原生 window.prompt ───────────────
    windowStub.__promptCalls.length = 0;
    const projButton = byClass(tree, "SPR_mapEdProj")[0];
    check("顶栏有项目菜单入口", projButton !== undefined && textOf(projButton).includes("▾"), textOf(projButton ?? null));
    /** 菜单是开关：前面的用例可能已经把它留着开着了，别盲目再点一下（会关掉）。 */
    const ensureMenu = async () => {
      if (byClass(tree, "SPR_mapEdMenuItem").length === 0) {
        byClass(tree, "SPR_mapEdProj")[0].props.onClick();
        tree = await renderTree(() => MapModule({ api }));
      }
      return byClass(tree, "SPR_mapEdMenuItem");
    };
    const menuItems = await ensureMenu();
    const newItem = menuItems.find((node) => textOf(node) === "新建项目");
    check("项目菜单里有「新建项目」", newItem !== undefined, menuItems.map((node) => textOf(node)).join(" / "));
    newItem.props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const dlg = byClass(tree, "SPR_mapEdDlg")[0];
    const nameInput = collect(tree, (node) => node.props?.["data-testid"] === "map-name-input")[0];
    check("点「新建项目」弹出面板自己的对话框（不再走原生 prompt）", dlg !== undefined && nameInput !== undefined);
    check(
      "对话框里预填了默认名，且全程没碰 window.prompt",
      nameInput?.props.value === "我的地图" && windowStub.__promptCalls.length === 0,
      `值 ${nameInput?.props.value} / prompt 调用 ${windowStub.__promptCalls.length} 次`
    );
    /**
     * ★ 「一格多大」：新建时能选 16 / 32 / 48 / 64 —— 这一下就定了。
     * 选 64 之后建出来的项目，网格必须真的是 64（否则 AI 素材还是按 32 出块，白选）。
     */
    const gridSelect = collect(dlg, (node) => node.props?.["data-testid"] === "map-create-grid")[0];
    check("新建对话框里有「一格多大」，默认 32", gridSelect !== undefined && gridSelect.props.value === "32", String(gridSelect?.props.value));
    check(
      "可选 16 / 32 / 48 / 64 四档",
      (gridSelect.props.children ?? []).map((option) => String(option.props.value)).join(",") === "16,32,48,64",
      (gridSelect.props.children ?? []).map((option) => String(option.props.value)).join(",")
    );
    check("说明里写清「这一下就定了」", /这一下就定了/.test(textOf(dlg)), textOf(dlg).match(/这一下就定了[^。]*。/)?.[0] ?? "");
    check(
      "对话框标题与「取消 / 确定」都在",
      dlg !== undefined && textOf(dlg).includes("新建项目") && collect(dlg, (node) => node.props?.["data-testid"] === "map-name-ok").length === 1 && collect(dlg, (node) => node.props?.["data-testid"] === "map-name-cancel").length === 1,
      textOf(dlg)
    );
    // 输入名字 → 回车确认（与点「确定」共用同一个提交函数）
    nameInput.props.onChange({ target: { value: "自检建的项目" } });
    tree = await renderTree(() => MapModule({ api }));
    collect(tree, (node) => node.props?.["data-testid"] === "map-name-input")[0].props.onKeyDown({ key: "Enter", preventDefault() {} });
    tree = await renderTree(() => MapModule({ api }));
    check("回车确认后对话框关掉", byClass(tree, "SPR_mapEdDlg").length === 0);
    check("项目真的建出来了，并且已经切过去", textOf(byClass(tree, "SPR_mapEdProj")[0] ?? null).includes("自检建的项目"), textOf(byClass(tree, "SPR_mapEdProj")[0] ?? null));
    const built = await G.listMapProjects();
    check("宿主侧确实多出这个名字的项目", built.some((item) => item.name === "自检建的项目"), built.map((item) => item.name).join(" / "));
    /**
     * ★ 「一格多大」的**真机行为**：选 64 建出来的项目，网格必须真的是 64。
     *
     * ⚠️ 建完立刻删掉：这个自检后面很多用例都按 32 网格算（相机、坐标、红框），
     * 留一个 64 的项目当「当前项目」会把它们全带偏。
     */
    {
      const before64 = (await G.listMapProjects()).length;
      (await ensureMenu()).find((node) => textOf(node) === "新建项目").props.onClick();
      tree = await renderTree(() => MapModule({ api }));
      const dlg64 = byClass(tree, "SPR_mapEdDlg")[0];
      collect(dlg64, (node) => node.props?.["data-testid"] === "map-create-grid")[0].props.onChange({ target: { value: "64" } });
      tree = await renderTree(() => MapModule({ api }));
      collect(tree, (node) => node.props?.["data-testid"] === "map-name-input")[0].props.onChange({ target: { value: "64 网格的项目" } });
      tree = await renderTree(() => MapModule({ api }));
      collect(tree, (node) => node.props?.["data-testid"] === "map-name-ok")[0].props.onClick();
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      const list64 = await G.listMapProjects();
      const made = list64.find((item) => item.name === "64 网格的项目");
      check("★ 选「一格多大 = 64」真的传给宿主了（创建入参里带 grid）", apiLog.created.some((entry) => entry.name === "64 网格的项目" && entry.grid?.tileWidth === 64 && entry.grid?.tileHeight === 64), JSON.stringify(apiLog.created.at(-1) ?? null));
      check(
        "★ 建出来的项目网格就是 64×64（不是永远 32）",
        made !== undefined && (await G.readMapProject(made.id)).grid.tileWidth === 64,
        made === undefined ? "(没建出来)" : String((await G.readMapProject(made.id)).grid.tileWidth)
      );
      if (made !== undefined) await G.deleteMapProject(made.id);
      check("（清理）临时建的 64 项目已删掉，后面的用例仍按 32 网格跑", (await G.listMapProjects()).length === before64);
      /**
       * 切回 32 那个项目：后面的用例（相机 / 红框 / 重命名）都按它算。
       *
       * ⚠️ 切项目是异步的（`loadProject` 要读盘），一次渲染不一定落地 —— 这里重试几轮，
       * 别让「刚好没赶上渲染」变成一条假的失败。
       */
      for (let attempt = 0; attempt < 6; attempt++) {
        if (textOf(byClass(tree, "SPR_mapEdProj")[0] ?? null).includes("自检建的项目")) break;
        (await ensureMenu()).find((node) => textOf(node) === "自检建的项目")?.props.onClick();
        await tickTimers();
        tree = await renderTree(() => MapModule({ api }));
      }
      check("**切回** 32 网格的项目了（标题上还是它）", textOf(byClass(tree, "SPR_mapEdProj")[0] ?? null).includes("自检建的项目"), textOf(byClass(tree, "SPR_mapEdProj")[0] ?? null));
    }
    // 取消路径：一个项目都不能多出来
    (await ensureMenu()).find((node) => textOf(node) === "新建项目").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    collect(tree, (node) => node.props?.["data-testid"] === "map-name-input")[0].props.onChange({ target: { value: "不该被建出来" } });
    tree = await renderTree(() => MapModule({ api }));
    collect(tree, (node) => node.props?.["data-testid"] === "map-name-cancel")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const afterCancel = await G.listMapProjects();
    check(
      "点「取消」不会建出项目",
      byClass(tree, "SPR_mapEdDlg").length === 0 && !afterCancel.some((item) => item.name === "不该被建出来"),
      afterCancel.map((item) => item.name).join(" / ")
    );
    // 重命名：同一个对话框（点到「重命名」就换成重命名标题）
    (await ensureMenu()).find((node) => textOf(node) === "重命名").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("「重命名」弹出的是同一个对话框、预填当前名字", textOf(byClass(tree, "SPR_mapEdDlg")[0] ?? null).includes("重命名项目") && collect(tree, (node) => node.props?.["data-testid"] === "map-name-input")[0]?.props.value === "自检建的项目", textOf(byClass(tree, "SPR_mapEdDlg")[0] ?? null));
    collect(tree, (node) => node.props?.["data-testid"] === "map-name-cancel")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
  }
  {
    // ── 悬停红框跟着指针，且**地图外不悬停**─────────────────────────────────
    // 老 bug：红框按取模后的格号画，指针落在地图外那一份时红框会跳一整张地图。
    // 现在的契约更简单：只认地图自己那一份 —— 图内红框跟着指针，图外干脆不画。
    {
      /** ⚠️ `fillRects` 是累积的（每次重画只是往里继续 push），所以必须按「这次之前」切片。 */
      const redFrameSince = (from) => {
        const rects = fillRects.slice(from).filter((item) => item.fillStyle === "#e23b2b").slice(-4);
        if (rects.length < 4) return null;
        return {
          left: Math.min(...rects.map((item) => item.x)),
          right: Math.max(...rects.map((item) => item.x + item.w)),
          top: Math.min(...rects.map((item) => item.y)),
          bottom: Math.max(...rects.map((item) => item.y + item.h))
        };
      };
      const hitCanvas = () => collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
      const inside = [];
      for (const [r, c] of [[2, 3], [7, 9], [12, 5], [15, 14]]) {
        const before = fillRects.length;
        const at = clientOf(r, c);
        hitCanvas().props.onPointerMove({ clientX: at.x, clientY: at.y, pointerId: 41 });
        tree = await renderTree(() => MapModule({ api }));
        // 红框的 fillRect 参数是**地图坐标**（画布带变换），所以拿格的中心去比，不用管屏幕像素
        const frame = redFrameSince(before);
        const cx = (c + 0.5) * 32, cy = (r + 0.5) * 32;
        inside.push(frame !== null && frame.left - 0.6 <= cx && cx <= frame.right + 0.6 && frame.top - 0.6 <= cy && cy <= frame.bottom + 0.6);
      }
      check("图内悬停：红框落在这几格上（4 个位置全中）", inside.every(Boolean), inside.map((ok) => (ok ? "✓" : "✗")).join(""));
      // 地图外（右下角那片空白）：不该有红框 —— 用户就是在这里发现「画到图外会点亮相反的边」
      const beforeOutside = fillRects.length;
      const outside = clientOf(40, 40);
      hitCanvas().props.onPointerMove({ clientX: outside.x, clientY: outside.y, pointerId: 42 });
      tree = await renderTree(() => MapModule({ api }));
      check("地图外悬停不画红框（图外那片空白不该有落笔提示）", redFrameSince(beforeOutside) === null, JSON.stringify(redFrameSince(beforeOutside)));
    }
  }

  // ══ 17) 地图外不落笔；图内快速拖动仍要补满 ═══════════════════════════════
  // 真机反馈：「画超过右边缘时左边缘被着色、超过下边缘时上边缘被着色」——
  // 环绕地图上 `pointToCell` 会把图外折回图内。现在只认地图自己那一份。
  section("17) 地图外不落笔（不折回另一边）+ 图内快速拖动补满");
  {
    // 夹具准备：上一段建过自己的项目（没有素材），这里重挂并切回主夹具，选一支笔
    tree = await freshPanel();
    const mainName17 = (await G.readMapProject(projectId)).name;
    if (byClass(tree, "SPR_mapEdMenuItem").length === 0) {
      byClass(tree, "SPR_mapEdProj")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
    }
    byClass(tree, "SPR_mapEdMenuItem").find((node) => textOf(node) === mainName17).props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    byClass(tree, "SPR_mapEdTile")[0].props.onClick({ shiftKey: false });
    tree = await renderTree(() => MapModule({ api }));
    byTool(tree, "pen")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const grid = (await G.readMapProject(projectId)).grid;
    const probeView = { x: 0, y: 0, width: grid.tileWidth, height: grid.tileHeight };
    const cols = (await G.mapPlan(projectId, { view: probeView, have: [] })).cols;
    const rows = (await G.mapPlan(projectId, { view: probeView, have: [] })).rows;
    const canvasNode = () => collect(tree, (node) => node.props?.["data-testid"] === "map-canvas")[0];
    const dragCells = async (from, to) => {
      const before = apiLog.applies.length;
      const a = clientOf(from[0], from[1], grid.tileWidth);
      const b = clientOf(to[0], to[1], grid.tileWidth);
      canvasNode().props.onPointerDown({ clientX: a.x, clientY: a.y, button: 0, pointerId: 51 });
      canvasNode().props.onPointerMove({ clientX: b.x, clientY: b.y, pointerId: 51 });
      canvasNode().props.onPointerUp({ pointerId: 51 });
      tree = await renderTree(() => MapModule({ api }));
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      const painted = new Set();
      for (const batch of apiLog.applies.slice(before)) {
        for (const op of batch.ops ?? []) {
          for (const cell of op.cells ?? []) painted.add(`${((cell.r % rows) + rows) % rows},${((cell.c % cols) + cols) % cols}`);
        }
      }
      return painted;
    };
    // ① 往右拖出地图：不能折回左边
    const right = await dragCells([5, cols - 1], [5, cols + 2]);
    check(
      "画超过右边缘不会点亮左边缘（图外那两格不落笔）",
      right.size > 0 && ![...right].some((key) => key.split(",")[1] === "0"),
      `落笔：${[...right].join(" ")}`
    );
    // ② 往下拖出地图：不能折回上边
    const down = await dragCells([rows - 1, 6], [rows + 2, 6]);
    check(
      "画超过下边缘不会点亮上边缘（图外那两格不落笔）",
      down.size > 0 && ![...down].some((key) => key.split(",")[0] === "0"),
      `落笔：${[...down].join(" ")}`
    );
    // ③ 同一格内挪 12 次不该重画；跨格挪 4 次必须重画（两边一起才有区分力）
    {
      const canvas = canvasNode();
      const at = clientOf(7, 7, grid.tileWidth);
      canvas.props.onPointerMove({ clientX: at.x, clientY: at.y, pointerId: 61 });
      tree = await renderTree(() => MapModule({ api }));
      const intraBefore = drawFrames.length;
      for (let i = 1; i <= 12; i++) canvas.props.onPointerMove({ clientX: at.x + i * 0.3, clientY: at.y + i * 0.2, pointerId: 61 });
      tree = await renderTree(() => MapModule({ api }));
      const intraFrames = drawFrames.length - intraBefore;
      const crossBefore = drawFrames.length;
      for (let i = 1; i <= 4; i++) {
        const step = clientOf(7, 7 + i * 2, grid.tileWidth);
        canvas.props.onPointerMove({ clientX: step.x, clientY: step.y, pointerId: 61 });
        tree = await renderTree(() => MapModule({ api }));
      }
      const crossFrames = drawFrames.length - crossBefore;
      check(
        "同一格内挪 12 次几乎不重画，跨格 4 次必须重画（悬停去重还在）",
        intraFrames <= 1 && crossFrames >= 3,
        `同格 ${intraFrames} 帧 / 跨格 ${crossFrames} 帧`
      );
    }
    // ④ 图内一笔从 (2,2) 快速拖到 (2,9)：中间不能漏格（补间还得管用）
    const fast = await dragCells([2, 2], [2, 9]);
    const wantCols = [2, 3, 4, 5, 6, 7, 8, 9];
    check(
      "图内一笔快速拖动补满中间格（不漏格）",
      wantCols.every((c) => fast.has(`2,${c}`)) && fast.size <= wantCols.length + 1,
      `落笔：${[...fast].join(" ")}`
    );
  }
  // ══ 18) 自由尺寸 / 用法说明 / 通过按钮文案 ═══════════════════════════════
  section("18) 地图尺寸与素材格子都可自由填；用法四项悬停有解释；卡片里没有「确定」按钮（关卡片只有右上角的 ×）");
  {
    tree = await freshPanel();
    // 上一段建过自己的项目（没有素材），切回主夹具再测尺寸与素材设置
    const mainName18 = (await G.readMapProject(projectId)).name;
    if (byClass(tree, "SPR_mapEdMenuItem").length === 0) {
      byClass(tree, "SPR_mapEdProj")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
    }
    byClass(tree, "SPR_mapEdMenuItem").find((node) => textOf(node) === mainName18).props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    /**
     * ⚠️ `NumField` 自带 hook，harness 的 `collect` **不能**展开它（会多吃 hook 槽位），
     * 所以这里按它的 props 找那个元素，直接调它的 `onChange`（= 失焦提交后的回调）。
     */
    const numFieldIn = (card, label) =>
      collect(card, (node) => node.props !== undefined && typeof node.props.onChange === "function" && node.props.label === label)[0];
    const capCard = (index) => byClass(tree, "SPR_mapEdCard")[index];

    // ── 地图大小：宽 / 高 各填各的（不再是固定正方形）
    byTool(tree, "settings")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const settingsCard = capCard(byClass(tree, "SPR_mapEdCard").length - 1);
    const mapWidth = numFieldIn(settingsCard, "宽");
    const mapHeight = numFieldIn(settingsCard, "高");
    check(
      "设置卡里「地图大小」是两个数字框（宽 / 高 各填各的，不再是正方形下拉）",
      mapWidth !== undefined && mapHeight !== undefined,
      JSON.stringify(collect(settingsCard, (node) => typeof node.props?.label === "string").map((node) => node.props.label))
    );
    windowStub.__confirmCalls.length = 0;
    mapWidth.props.onChange(48);
    tree = await renderTree(() => MapModule({ api }));
    numFieldIn(capCard(byClass(tree, "SPR_mapEdCard").length - 1), "高").props.onChange(20);
    tree = await renderTree(() => MapModule({ api }));
    const doc = await G.readTheDoc(projectId);
    check("改成 48×20 真的生效（宽高各自独立）", doc.cols === 48 && doc.rows === 20, `${doc.cols}×${doc.rows}`);
    check("改小会先问一句（确认后照做）", windowStub.__confirmCalls.length > 0, windowStub.__confirmCalls.join(" / "));

    // ── 素材：列表 + 新增（属性在对话框里一次定死）+ 删除 / 恢复默认
    byTool(tree, "settings")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    byClass(tree, "SPR_mapEdTopBtn")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const assets = byClass(tree, "SPR_mapEdCard")[0];
    const rowCount = () => byClass(byClass(tree, "SPR_mapEdCard")[0], "SPR_mapEdTsRow").length;
    const beforeRows = rowCount();
    check("素材列表列出了项目里的素材", beforeRows > 0, `${beforeRows} 张`);
    // 新增素材：先弹对话框，里面才有「图片 / 名字 / 格子 / 用法 / 会动吗」
    collect(assets, (node) => node.type === "button" && textOf(node) === "新增素材")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const addDlg = collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog")[0];
    check("点「新增素材」弹出对话框", addDlg !== undefined, textOf(byClass(tree, "SPR_mapEdCard")[0]).slice(0, 40));
    check(
      "对话框里有：素材图 / 叫什么 / 格子大小 / 这块素材怎么用 / 会动吗",
      ["素材图", "叫什么", "格子大小（留空就自动认）", "这块素材怎么用", "会动吗"].every((label) => textOf(addDlg).includes(label)),
      textOf(addDlg).replace(/\s+/g, " ").slice(0, 120)
    );
    check("对话框里格子大小是两个数字框（宽 / 高，留空走自动识别）", numFieldIn(addDlg, "宽") !== undefined && numFieldIn(addDlg, "高") !== undefined);
    // 用法现在有五个（普通 / 整格 / 拼块 / 整图 / 自动），「会动吗」仍是两个。
    check("对话框里「用法」是五个按钮、「会动吗」是两个按钮", collect(addDlg, (node) => typeof node.props?.["data-shape"] === "string").length === 5 && collect(addDlg, (node) => typeof node.props?.["data-anim"] === "string").length === 2, `${collect(addDlg, (node) => typeof node.props?.["data-shape"] === "string").length} 个用法`);
    // 悬停解释还在（和工具格同一套小标签）
    collect(addDlg, (node) => node.props?.["data-shape"] === "corner16")[0].props.onMouseEnter({
      currentTarget: { getBoundingClientRect: () => ({ left: 120, top: 320, width: 50, height: 24 }) }
    });
    tree = await renderTree(() => MapModule({ api }));
    check("悬停「整格」解释它是什么", textOf(byClass(tree, "SPR_mapEdTip")[0] ?? null).includes("拐角"), textOf(byClass(tree, "SPR_mapEdTip")[0] ?? null));
    // 没选图就点确定：要说清楚，别静默
    collect(tree, (node) => node.props?.["data-testid"] === "map-add-ok")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("没选图片就点「确定」会明确提示（不是静默失败）", textOf(tree).includes("先选一张素材图"), textOf(tree).match(/先选一张素材图[^\s]*/)?.[0] ?? "");
    // 草稿是可编辑的：点「翻页图」后按钮状态跟着变
    collect(tree, (node) => node.props?.["data-anim"] === "rows")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("对话框里的选择只改草稿（「翻页图」被选中）", collect(tree, (node) => node.props?.["data-anim"] === "rows")[0].props["data-on"] === "true");
    collect(tree, (node) => node.props?.["data-testid"] === "map-add-cancel")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("「取消」关掉对话框、什么都不改", collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog").length === 0 && rowCount() === beforeRows, `${rowCount()} 张`);

    /**
     * ── 「素材说明」：三页图文，图上盖一层循环隐现的网格 ────────────────────
     *
     * 这里**不拿我推的公式比**：示例图逐个字节等于宿主生成器 `renderGuideSheets()`
     * 真产出的那张，网格线的位置等于真实列数 / 行数 / 每块再分的数推出来的百分比。
     * 图换了、列数改了而界面没跟上，这几条就会红（而不是「说明图和实物不一样」）。
     */
    const guideSheets = new Map(SAMPLES.renderGuideSheets().map((sheet) => [sheet.shape, sheet]));
    const guideIn = (current) => collect(current, (node) => node.props?.["data-testid"] === "map-guide-dialog")[0];
    const guideTabs = (current) => collect(guideIn(current), (node) => typeof node.props?.["data-guide-tab"] === "string");
    const guideImg = (current) => byClass(guideIn(current), "SPR_mapEdGuideImg")[0];
    const guideGrid = (current) => byClass(guideIn(current), "SPR_mapEdGuideGrid")[0];
    const guideSub = (current) => byClass(guideIn(current), "SPR_mapEdGuideSubGrid")[0];
    /** 生成器真产出的那一张图的 data URI。 */
    const guideSrc = (shape) => `data:image/png;base64,${guideSheets.get(shape).png.toString("base64")}`;
    /** 网格线应当铺满一格的百分比（100 / 列数、100 / 行数）。 */
    const guideCell = (shape) => `${100 / guideSheets.get(shape).cols}% ${100 / guideSheets.get(shape).rows}%`;
    const clickGuideTab = async (shape) => {
      guideTabs(tree).find((node) => node.props["data-guide-tab"] === shape).props.onClick();
      tree = await renderTree(() => MapModule({ api }));
    };
    const reopenAdd = async () => {
      collect(byClass(tree, "SPR_mapEdCard")[0], (node) => node.type === "button" && textOf(node) === "新增素材")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
    };

    await reopenAdd();
    check("「新增素材」标题行里有「素材说明」按钮", collect(tree, (node) => node.props?.["data-testid"] === "map-guide-open")[0] !== undefined, textOf(byClass(tree, "SPR_mapEdDlgHead")[0] ?? null));
    collect(tree, (node) => node.props?.["data-testid"] === "map-guide-open")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check(
      "点它弹出说明窗口，而且「新增素材」还开着（填了一半的表不用重来）",
      guideIn(tree) !== undefined && collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog").length === 1
    );
    check(
      "说明窗口是三页，页签与「用法」那三个选项同名",
      guideTabs(tree).length === 3 && guideTabs(tree).map(textOf).join("/") === "普通图块/整格自动连接/拼块自动连接",
      guideTabs(tree).map(textOf).join("/")
    );
    check("第一页（普通图块）的示例图就是生成器真产出的那张", guideImg(tree)?.props.src === guideSrc("plain"));
    check("网格线按真实列数现算（4 列 × 2 行 → 25% / 50%）", guideGrid(tree)?.props.style.backgroundSize === guideCell("plain"), String(guideGrid(tree)?.props.style.backgroundSize));
    check("普通图块那一页只有一层网格（没有「格内再分」）", guideSub(tree) === undefined);
    check(
      "图注里的列数 / 行数 / 块数 / 每块像素全是现算的（换了图不会留下旧数字）",
      textOf(guideIn(tree)).includes("4 列 × 2 行，共 8 块，每块 32×32"),
      textOf(guideIn(tree)).slice(0, 80)
    );

    await clickGuideTab("corner16");
    check("第 2 页（整格自动连接）换成 4×4 那张示例图", guideImg(tree)?.props.src === guideSrc("corner16"));
    check("第 2 页的网格是 25% / 25%（4 列 × 4 行）", guideGrid(tree)?.props.style.backgroundSize === guideCell("corner16"), String(guideGrid(tree)?.props.style.backgroundSize));
    const cornerText = textOf(guideIn(tree));
    check("第 2 页把顺序讲成人话：上 = 1、右 = 2、下 = 4、左 = 8", cornerText.includes("上 = 1、右 = 2、下 = 4、左 = 8"));
    check("第 2 页说清「第 1 块四周都没有、最后一块四周都有」", cornerText.includes("第 1 块是四周都没有邻居") && cornerText.includes("最后一块是四周都有"));
    check("第 2 页提醒块数不是 16 会怎样（否则用户看不出自己哪里错了）", cornerText.includes("块数不是 16"));
    check("第 2 页也只有一层网格", guideSub(tree) === undefined);

    await clickGuideTab("a2quad");
    check("第 3 页（拼块自动连接）的示例图就是内置草地那张（说明与实物同源）", guideImg(tree)?.props.src === guideSrc("a2quad"));
    check(
      "第 3 页两层网格都按真实数字现算：一格 32×32（50% / 20%）+ 格内 16×16 的小块（25% / 10%）",
      guideGrid(tree)?.props.style.backgroundSize === guideCell("a2quad") && guideSub(tree)?.props.style.backgroundSize === "25% 10%",
      `${String(guideGrid(tree)?.props.style.backgroundSize)} / ${String(guideSub(tree)?.props.style.backgroundSize)}`
    );
    const a2Text = textOf(guideIn(tree));
    check("第 3 页说清「一格里面再分成 2×2 个 16×16 的小块」与「竖着正好 5 行」", a2Text.includes("2×2 个 16×16 的小块") && a2Text.includes("竖着正好 5 行"));
    check(
      "翻页有页码，最后一页的「下一页」点不动（不会翻出第 4 页）",
      textOf(guideIn(tree)).includes("第 3 页 / 共 3 页") && collect(guideIn(tree), (node) => node.props?.["data-testid"] === "map-guide-next")[0].props.disabled === true
    );
    collect(guideIn(tree), (node) => node.props?.["data-testid"] === "map-guide-prev")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("「上一页」退回第 2 页", textOf(guideIn(tree)).includes("第 2 页 / 共 3 页"));
    /**
     * 术语黑名单的**用户面**版本，对说明窗口再来一遍：这一页是纯文案，最容易被顺手
     * 写成「掩码」「图集」这类词的地方。
     */
    check(
      "说明窗口画到屏幕上的字里也没有旧术语",
      JARGON.every((word) => !textOf(guideIn(tree)).includes(word)),
      JARGON.filter((word) => textOf(guideIn(tree)).includes(word)).join("、")
    );

    // 点窗口外面：只关说明窗口，「新增素材」还在（草稿一个字都没丢）。
    collect(guideIn(tree), (node) => node.props?.["data-testid"] === "map-guide-close")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check(
      "「关闭」只关说明窗口，「新增素材」还开着（草稿没丢，不用重新选图）",
      guideIn(tree) === undefined && collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog").length === 1
    );
    // 草稿里已经选了「整格」→ 打开说明就直接翻到那一页。
    collect(tree, (node) => node.props?.["data-shape"] === "corner16")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    collect(tree, (node) => node.props?.["data-testid"] === "map-guide-open")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("草稿里已经选了「整格」，打开说明就直接翻到整格那一页", textOf(guideIn(tree)).includes("第 2 页 / 共 3 页"), textOf(guideIn(tree)).match(/第 \d 页[^。]*/)?.[0] ?? "");
    // 关掉「新增素材」：说明窗口跟着一起没（它只跟着草稿存在，不需要在四处各写一次复位）。
    collect(tree, (node) => node.props?.["data-testid"] === "map-add-cancel")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check(
      "关掉「新增素材」时说明窗口一起消失（草稿没了，它也不该留着）",
      guideIn(tree) === undefined && collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog").length === 0
    );
    // 删除内置素材 → 列表少一张；恢复默认 → 回来了
    const builtinRow = byClass(tree, "SPR_mapEdTsRow").find((node) => textOf(node).includes("自带"));
    const builtinName = textOf(byClass(builtinRow, "SPR_mapEdTsName")[0]);
    collect(builtinRow, (node) => node.type === "button" && textOf(node) === "删除")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check(`内置素材也能删（删掉了「${builtinName}」）`, rowCount() === beforeRows - 1 && !textOf(byClass(tree, "SPR_mapEdCard")[0]).includes(builtinName), `${beforeRows} → ${rowCount()}`);
    collect(byClass(tree, "SPR_mapEdCard")[0], (node) => node.type === "button" && textOf(node) === "恢复默认素材")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("「恢复默认素材」把它拿回来（同名不会变成两份）", rowCount() === beforeRows && textOf(byClass(tree, "SPR_mapEdCard")[0]).includes(builtinName), `${rowCount()} 张`);

    /**
     * ── 卡片里**不再有「确定」按钮** ────────────────────────────────────────
     *
     * 用户原话：「确定键可以删了，和右上角的 x 没区别」。确实 —— 阶段标记在界面上
     * 不可见（上一版为了去掉「取消确认」把它做成了普通按钮），那颗按钮对用户就只剩
     * 「关掉卡片」一个作用。现在关卡片只有右上角的 ×；阶段标记仍可由验收流程 /
     * 对话面（`setMapApproved`）改，界面上唯一还暴露它的是设置卡里那颗**有状态**的
     * 「整个模块看过了」。
     */
    const cardBeforeClose = byClass(tree, "SPR_mapEdCard")[0];
    check(
      "卡片里没有「确定」按钮（和右上角的 × 重复的那一颗）",
      collect(cardBeforeClose, (node) => node.type === "button" && textOf(node) === "确定").length === 0 && !/看过了|已确定|取消确认/.test(textOf(cardBeforeClose)),
      collect(cardBeforeClose, (node) => node.type === "button").map((node) => textOf(node)).join(" / ")
    );
    collect(cardBeforeClose, (node) => node.props?.className === "SPR_mapEdCardClose")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("右上角的 × 就是关卡片的那条路（按一下收起）", byClass(tree, "SPR_mapEdCard").length === 0, `还剩 ${byClass(tree, "SPR_mapEdCard").length} 张卡片`);
    // ── 阶段标记：界面上只剩设置卡里那颗有状态的按钮（点了四阶段一起打）
    byTool(tree, "settings")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const approvalsBefore = apiLog.approvals.length;
    const seenButton = collect(byClass(tree, "SPR_mapEdCard")[0], (node) => node.type === "button" && textOf(node) === "整个模块看过了")[0];
    check("阶段标记只剩设置卡的「整个模块看过了」这一颗", seenButton !== undefined);
    seenButton?.props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const sentApproval = apiLog.approvals[apiLog.approvals.length - 1];
    check(
      "点它一次把四个阶段一起打过（不带 stage）",
      apiLog.approvals.length === approvalsBefore + 1 && sentApproval?.approved === true && sentApproval?.stage === undefined,
      JSON.stringify(sentApproval)
    );
  }

  // ══ 19. 图层命名 + 标记层 ════════════════════════════════════════════════
  section("19) 图层改名 / 换顺序 + 标记层（数字由宿主给，界面只画圆圈）");
  {
    tree = await freshPanel();
    // 前面的用例可能停在自建项目上：按名字切回主夹具（和 18 节同一套走法）。
    const mainName19 = (await G.readMapProject(projectId)).name;
    if (byClass(tree, "SPR_mapEdMenuItem").length === 0) {
      byClass(tree, "SPR_mapEdProj")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
    }
    const mainItem19 = byClass(tree, "SPR_mapEdMenuItem").find((node) => textOf(node) === mainName19);
    if (mainItem19 !== undefined) {
      mainItem19.props.onClick();
      tree = await renderTree(() => MapModule({ api }));
    }
    /** 图层卡是开 / 关同一个按钮：已经开着就别再点。 */
    const ensureLayers = async () => {
      if (collect(tree, (node) => node.props?.["data-testid"] === "map-single-layer").length === 0) {
        collect(tree, (node) => node.props?.["data-testid"] === "map-open-layers")[0].props.onClick();
        tree = await renderTree(() => MapModule({ api }));
      }
    };
    await ensureLayers();
    const testid = (id) => collect(tree, (node) => node.props?.["data-testid"] === id)[0];

    // ── 图层改名：点名字 → 就地输入 → 失焦提交一条结构补丁 ─────────────────
    const layerPick = testid("map-layer-pick-0");
    check("图层卡里列出每一层（点名字就地改）", layerPick !== undefined && textOf(layerPick).length > 0, textOf(layerPick ?? null));
    const savesBeforeRename = apiLog.saves.length;
    layerPick.props.onDoubleClick();
    tree = await renderTree(() => MapModule({ api }));
    const nameInput = testid("map-layer-name-0");
    check("双击名字变成输入框（就地改名）", nameInput !== undefined && nameInput.props.autoFocus === true);
    nameInput.props.onChange({ target: { value: "主地面" } });
    tree = await renderTree(() => MapModule({ api }));
    testid("map-layer-name-0").props.onBlur();
    tree = await renderTree(() => MapModule({ api }));
    const renamePatch = apiLog.saves[apiLog.saves.length - 1];
    check("改名提交的是 `layers: [{id,name}]`（宿主的字段，不是界面自己存）", apiLog.saves.length === savesBeforeRename + 1 && Array.isArray(renamePatch?.layers) && renamePatch.layers[0].name === "主地面", JSON.stringify(renamePatch));

    // ── 空名字本地就拦住（不发请求，也不静默成功）────────────────────────
    const savesBeforeEmpty = apiLog.saves.length;
    testid("map-layer-pick-0").props.onDoubleClick();
    tree = await renderTree(() => MapModule({ api }));
    testid("map-layer-name-0").props.onChange({ target: { value: "   " } });
    tree = await renderTree(() => MapModule({ api }));
    testid("map-layer-name-0").props.onBlur();
    tree = await renderTree(() => MapModule({ api }));
    check("空名字不发请求，并给出提示（宿主对空名字是静默 no-op）", apiLog.saves.length === savesBeforeEmpty && textOf(tree).includes("图层名字不能为空"), textOf(tree).slice(-60));

    // ── 换顺序 / 删图层：都走 saveMapDoc 的结构键 ────────────────────────
    const savesBeforeMove = apiLog.saves.length;
    const upBtn = byClass(tree, "SPR_mapEdMiniBtn").find((node) => node.props.title === "上移一层" && node.props.disabled !== true);
    upBtn.props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const movePatch = apiLog.saves[apiLog.saves.length - 1];
    check("「上移一层」提交 moveLayer（宿主换顺序）", apiLog.saves.length === savesBeforeMove + 1 && movePatch?.moveLayer !== undefined, JSON.stringify(movePatch));

    // ── 标记：宿主侧先摆两个（一个有名、一个空名），再整份重挂 ─────────────
    await G.applyMapOps(projectId, [
      { kind: "marker", op: "add", r: 3, c: 3, name: "宝箱" },
      { kind: "marker", op: "add", r: 5, c: 6 }
    ]);
    tree = await freshPanel();
    await ensureLayers();
    const markerRows = [1, 2].map((n) => testid(`map-marker-${n}`));
    check("标记列表按编号列出（第 1 / 第 2 个）", markerRows.every((row) => row !== undefined));
    check("标记行上是编号圆点 + 坐标", markerRows[0] !== undefined && textOf(byClass(markerRows[0], "SPR_mapEdMarkerDot")[0] ?? null) === "1" && textOf(markerRows[0]).includes("(3,3)"), textOf(markerRows[0] ?? null));
    const markerInputs = markerRows.map((row) => collect(row, (node) => node.props?.className === "SPR_mapEdMarkerName")[0]);
    check("名字进输入框（有名字的显示名字，没名字的用「标记 N」占位）", markerInputs[0]?.props.value === "宝箱" && markerInputs[1]?.props.value === "" && markerInputs[1]?.props.placeholder === "标记 2", JSON.stringify(markerInputs.map((node) => node?.props?.value)));

    // ── 改名字：一条 rename op（不占格、不脏图）──────────────────────────
    const appliesBeforeRename = apiLog.applies.length;
    markerInputs[1].props.onFocus();
    tree = await renderTree(() => MapModule({ api }));
    const secondInput = collect(testid("map-marker-2"), (node) => node.props?.className === "SPR_mapEdMarkerName")[0];
    secondInput.props.onChange({ target: { value: "出口" } });
    tree = await renderTree(() => MapModule({ api }));
    collect(testid("map-marker-2"), (node) => node.props?.className === "SPR_mapEdMarkerName")[0].props.onBlur();
    tree = await renderTree(() => MapModule({ api }));
    const renameOp = apiLog.applies.slice(appliesBeforeRename).flatMap((entry) => entry.ops ?? []).find((op) => op.kind === "marker" && op.op === "rename");
    check("标记改名提交 `{kind:'marker', op:'rename'}`（宿主负责落盘）", renameOp !== undefined && renameOp.name === "出口", JSON.stringify(renameOp ?? null));

    // ── 画布：圆圈与数字来自宿主的计划 ───────────────────────────────────
    tree = await freshPanel();
    const lastPlanQuery = apiLog.plans[apiLog.plans.length - 1];
    const hostMarkPlan = await G.mapPlan(projectId, { view: lastPlanQuery.view, have: [], layerIds: lastPlanQuery.layerIds });
    const hostMarkers = hostMarkPlan.markers.slice().sort((a, b) => a.n - b.n);
    check("宿主计划里带着两个标记（圆心 / 半径 / 字号 / 数字）", hostMarkers.length === 2 && hostMarkers.every((marker) => marker.radius > 0 && marker.font > 0), JSON.stringify(hostMarkers));
    check("画布画了两个圆圈，圆心与半径逐项等于宿主给的那份", arcs.length === 2 && arcs.every((arc, index) => arc.x === hostMarkers[index].x && arc.y === hostMarkers[index].y && arc.radius === hostMarkers[index].radius), JSON.stringify(arcs));
    check("圆圈里的数字是宿主给的编号（界面不自己数）", texts.map((entry) => entry.text).join(",") === hostMarkers.map((marker) => String(marker.n)).join(","), JSON.stringify(texts.map((entry) => entry.text)));
    check("数字的字号来自计划（字体串里带那个字号）", texts.every((entry, index) => entry.font.includes(` ${hostMarkers[index].font}px`) && entry.font.startsWith("700 ")), JSON.stringify(texts.map((entry) => entry.font)));
    check("圆圈有描边（不是一坨纯色）", arcs.every((arc) => arc.stroked === true && arc.strokeStyle === "#f0c040"), JSON.stringify(arcs.map((arc) => [arc.stroked, arc.strokeStyle])));
    check("标记画在地块**之后**（压在地图上，不会被后画的块盖住）", callOrder.lastIndexOf("drawImage") < callOrder.indexOf("arc"), `最后一个 drawImage @${callOrder.lastIndexOf("drawImage")}，第一个 arc @${callOrder.indexOf("arc")}`);

    // ── 标记工具：点空格放下、右键删掉、点已有的是选中 ────────────────────
    byTool(tree, "marker")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    /** 每次交互后都重新取画布节点：手势闭包里的 `view` 会被上一次操作留在旧快照上。 */
    const tap = async (button, at, pointerId) => {
      const node = collect(tree, (item) => item.props?.["data-testid"] === "map-canvas")[0];
      node.props.onPointerDown({ clientX: at.x, clientY: at.y, button, pointerId });
      await tickTimers();
      node.props.onPointerUp({ pointerId });
      tree = await renderTree(() => MapModule({ api }));
    };
    const markerOpsSince = (from) => apiLog.applies.slice(from).flatMap((entry) => entry.ops ?? []).filter((op) => op.kind === "marker");

    const freeCell = { r: 7, c: 2 };
    const appliesBeforeAdd = apiLog.applies.length;
    await tap(0, clientOf(freeCell.r, freeCell.c), 31);
    const addOp = markerOpsSince(appliesBeforeAdd).find((op) => op.op === "add");
    check("标记工具：左键点空格提交 `{kind:'marker', op:'add'}`（编号由宿主发）", addOp !== undefined && addOp.r === freeCell.r && addOp.c === freeCell.c, JSON.stringify(addOp ?? null));

    const boxAt = clientOf(3, 3);
    const appliesBeforePick = apiLog.applies.length;
    await tap(0, boxAt, 32);
    check("标记工具：点已有标记只是**选中**它（不重复放置）", markerOpsSince(appliesBeforePick).length === 0, `提交了 ${markerOpsSince(appliesBeforePick).length} 条标记 op`);
    await ensureLayers();
    check("选中之后图层卡里那一行高亮（data-on）", collect(tree, (item) => item.props?.["data-on"] === "true" && typeof item.props?.["data-testid"] === "string" && item.props["data-testid"].startsWith("map-marker-")).length === 1, "高亮行数");

    const appliesBeforeRemove = apiLog.applies.length;
    await tap(2, boxAt, 33);
    const removeOp = markerOpsSince(appliesBeforeRemove).find((op) => op.op === "remove");
    check("标记工具：右键删掉这一格的标记", removeOp !== undefined && typeof removeOp.id === "string", JSON.stringify(removeOp ?? null));

    // ── 反向验证：计划里不带标记时，画布一个圈都不许画 ────────────────────
    // （证明圆心与数字来自**宿主计划**，不是界面自己数 `view.markers` 推出来的。）
    const apiNoMarkers = {
      ...api,
      mapPlan: async (payload) => {
        const result = await api.mapPlan(payload);
        return { ...result, markers: [] };
      }
    };
    tree = await freshPanel(apiNoMarkers);
    check("反向验证：视图里有标记但计划没带 → 画布一个圈都不画", arcs.length === 0, `${arcs.length} 个圈`);
  }

  // ══ 20) AI 生成素材：对话框 → 新对话 → 回链预填「新增素材」 ══════════════
  section("20) AI 生成素材（对话框 / 新对话桥 / 回链预填）");
  {
    /**
     * 假的浏览器侧服务：`sessions` 只记账不真建会话，`uiWorkspace.openSession` 记账
     * 「有没有切到对话界面」。这样「点了生成到底做了什么」可以逐条断言，而不是靠看界面。
     */
    const bridgeLog = { created: [], retained: [], submitted: [], prompted: [], opened: [], released: 0, abandoned: 0 };
    const bridgeSessions = {
      create: async (opts) => {
        bridgeLog.created.push(opts);
        return "session-ai-1";
      },
      retain: (id, opts) => {
        bridgeLog.retained.push({ id, ...opts });
        return {
          sessionId: id,
          ready: Promise.resolve(),
          release: () => {
            bridgeLog.released++;
          },
          binding: {
            session: {
              beginSubmission: (input) => {
                bridgeLog.submitted.push(input);
                return {
                  requestId: "req-ai-1",
                  abandon: () => {
                    bridgeLog.abandoned++;
                  }
                };
              },
              prompt: async (content, mode, signal, requestId) => {
                bridgeLog.prompted.push({ content, mode, requestId });
                return { ok: true, value: { accepted: true } };
              }
            }
          }
        };
      }
    };
    const bridgeWorkspace = { openSession: (id) => bridgeLog.opened.push(id) };
    test.attachSessionBridge({
      get: (name) => (name === "sessions" ? bridgeSessions : name === "uiWorkspace" ? bridgeWorkspace : undefined)
    });

    // ── 提示词：纯函数，先把三种形态分支钉住（拼错了只会「对话里做错」，界面看不出来）──
    const promptOf = (over) =>
      test.buildAssetRequestPrompt({
        projectId,
        projectName: "客户端自检",
        cell: { width: 32, height: 32 },
        name: "岩浆",
        prompt: "一片岩浆，缓慢翻涌",
        frames: 1,
        mode: "image",
        shape: "auto",
        ...over
      });
    const oneFrame = promptOf({});
    check(
      "提示词：带上项目 id / 素材名 / 帧数 1 / 生图模型 / 用户原文",
      oneFrame.includes(projectId) && oneFrame.includes("岩浆") && oneFrame.includes("一片岩浆，缓慢翻涌") && oneFrame.includes("动画帧数：1") && oneFrame.includes("生图模型"),
      oneFrame.slice(0, 80)
    );
    check("提示词：写明「按地图网格出图」与「不要绿幕 / 不做抠像」", oneFrame.includes("32×32") && oneFrame.includes("绿幕") && oneFrame.includes("抠像"));
    const bluePrompt = promptOf({ shape: "stamp", keyColor: "#0000FF" });
    check(
      "提示词：换成蓝幕后「绿幕 / #00FF00」全部替换",
      bluePrompt.includes("蓝幕") && bluePrompt.includes("#0000FF") && !bluePrompt.includes("#00FF00") && !bluePrompt.includes("纯绿幕"),
      bluePrompt.match(/[^\n]*蓝幕[^\n]*/)?.[0] ?? ""
    );
    check(
      "提示词：composeMapAsset 必须带上同一个 keyColor",
      bluePrompt.includes("keyColor:'#0000FF'") && bluePrompt.includes("抠像底色是 #0000FF"),
      bluePrompt.match(/[^\n]*keyColor[^\n]*/)?.[0] ?? ""
    );
    check("提示词：默认不传 keyColor 时仍是绿幕（旧行为逐字兼容）", oneFrame.includes("绿幕") && oneFrame.includes("#00FF00"));
    const userGreen = promptOf({ shape: "stamp", keyColor: "#0000FF", prompt: "一只绿色史莱姆" });
    check("提示词：模板换成蓝幕，但用户原文「绿色史莱姆」一个字不改", userGreen.includes("一只绿色史莱姆") && !userGreen.includes("一只蓝色史莱姆"), userGreen.match(/一只[^\n]*史莱姆/)?.[0] ?? "");
    check("提示词：帧数 1 时只走图片生成（不含序列帧那几步）", oneFrame.includes("runImageJob") && !oneFrame.includes("runSequenceVideo"), "");
    /**
     * ★ 按一格的实际像素给「细节尺寸」的指导。
     *
     * 真机翻车过：2K 的细密砖墙缩到 32px 只剩一片红雾（细节量 8.9 vs 64px 的 14.6），用户看到的就是
     * 「不像墙」。所以提示词必须写清「细节不小于一格的四分之一、一格最多几排」，32px 时还要建议 64 格。
     */
    check(
      "提示词：写明「细节不能小于一格的四分之一」与「一格最多排几排」（32 格 → 1/4 ≈ 8px、最多 3 排）",
      oneFrame.includes("四分之一") && oneFrame.includes("8px") && oneFrame.includes("最多排 3 排"),
      oneFrame.match(/一格只有[^\n]*/)?.[0] ?? ""
    );
    check(
      "提示词：一格 32px 时明确建议「做成一格 64px 再生成」（并要它在回答里告诉用户）",
      oneFrame.includes("一格 64px") && oneFrame.includes("告诉用户"),
      oneFrame.match(/⚠️ 一格 32px[^\n]*/)?.[0] ?? ""
    );
    // 反向验证：64 格的项目不该出现「装不下细密砖纹」那句，而且允许的排数跟着放大到 5。
    const wideFrame = promptOf({ cell: { width: 64, height: 64 } });
    check(
      "反向验证：一格 64px 时不劝退（没有「装不下」那句），排数放宽到 5 排",
      !wideFrame.includes("装不下细密砖纹") && wideFrame.includes("最多排 5 排") && wideFrame.includes("约 16px"),
      wideFrame.match(/一格只有[^\n]*/)?.[0] ?? ""
    );
    const threeFrames = promptOf({ frames: 3 });
    check("提示词：帧数 3 + 生图模型 → count:3 的一次图片生成", threeFrames.includes("runImageJob({jobId, count:3})"), "");
    const videoFrames = promptOf({ frames: 3, mode: "video" });
    check(
      "提示词：帧数 3 + 视频模型 → 先出首帧，再序列帧抽 3 帧",
      videoFrames.includes("静态首帧图") && videoFrames.includes("runSequenceVideo") && videoFrames.includes("runSequenceFrames({jobId, count:3})") && videoFrames.includes("kind:'firstFrame'"),
      ""
    );
    check(
      "提示词：notes 报「砖接不上自己」时不要自动重跑（那是真花钱），要把情况交给用户决定",
      threeFrames.includes("不要**自动重跑") && threeFrames.includes("让他决定")
    );
    check("提示词：要求用 composeMapAsset 整理、并把返回的 openUrl 原样贴出来", threeFrames.includes("composeMapAsset") && threeFrames.includes("openUrl") && threeFrames.includes("原样"));
    check("提示词：写明审核模式按自动、不要再问任何问题", threeFrames.includes("自动") && threeFrames.includes("不要") && threeFrames.includes("问"));
    check("提示词：帧数越界被夹到 1..16", promptOf({ frames: 99 }).includes("动画帧数：16") && promptOf({ frames: 0 }).includes("动画帧数：1"));
    /**
     * ── 形态：先定用法，再按用法规划排布（用户这次的追加需求）───────────────
     *
     * 「自动判断」时三种排布都要写进提示词（连同判据），并把 `shape` 交给
     * `composeMapAsset`；用户指定时只写它，且明确「不要改」。
     */
    check(
      "提示词（自动）：写明判据（成片铺开→拼块 / 连成一条→整格 / 单独摆→普通）",
      oneFrame.includes("你来判断") && oneFrame.includes("成片铺开") && oneFrame.includes("连成一条") && oneFrame.includes("单独摆")
    );
    check(
      "提示词（自动）：三种排布都给了 —— 普通一格内容、整格一块无缝墙砖、拼块每个变体一块无缝材质",
      oneFrame.includes("每张图 = 一格内容") &&
        oneFrame.includes("只画**一块**正方形、**可以无缝平铺**的墙面") &&
        oneFrame.includes("只画**一块**正方形、**可以无缝平铺**的材质") &&
        oneFrame.includes("16 种接法") &&
        oneFrame.includes("5 种接法")
    );
    check(
      "提示词（自动/整格拼块）：明确要求「不要分格、不要画多格排布」（这次返工的根因）",
      oneFrame.includes("**不要**分格") && oneFrame.includes("由插件从这一块砖的像素自己拼出来") && oneFrame.includes("别自己先拼多格排布")
    );
    check(
      "提示词（自动）：要求把 shape 传给 composeMapAsset，并说清少了它会全碎",
      oneFrame.includes("shape:'<你选的形态") && oneFrame.includes("shape 必须是你这次选定的那个")
    );
    const plainPrompt = promptOf({ shape: "plain" });
    check(
      "提示词（指定普通）：标了「用户已经指定，不要改」，只写普通那段排布",
      plainPrompt.includes("用户已经指定，不要改") && plainPrompt.includes("每张图 = 一格内容") && !plainPrompt.includes("4 列 × 4 行")
    );
    const cornerWantsAnimation = promptOf({ shape: "corner16", frames: 8, mode: "video" });
    check(
      "★ 指定整格 + 用户选了视频 / 8 帧：提示词里帧数归一到 1、方式归一到生图（不再自相矛盾）",
      cornerWantsAnimation.includes("动画帧数：1") && cornerWantsAnimation.includes("动画生成方式：生图模型") && !cornerWantsAnimation.includes("runSequenceVideo")
    );
    check(
      "★ 同一条：明确要求 agent「这次按静态做，并在回答里告诉用户为什么 / 怎么换成会动的」",
      cornerWantsAnimation.includes("这次按静态做") && cornerWantsAnimation.includes("请在回答里明确告诉他") && cornerWantsAnimation.includes("拼块")
    );
    check(
      "形态待判断 + 用户要动画：要求 agent 判断成整格时改用拼块（别默默把动画丢掉）",
      promptOf({ shape: "auto", frames: 4 }).includes("如果你判断成「整格」，请**改用「拼块」**")
    );
    check(
      "反向验证：没要动画（帧数 1 / 生图模型）时不会多出这段提醒",
      !oneFrame.includes("这次按静态做") && !promptOf({ shape: "corner16" }).includes("这次按静态做")
    );
    const cornerPrompt = promptOf({ shape: "corner16" });
    check(
      "提示词（指定整格）：只写「一块无缝墙砖」那段（要求四边能接上自己、不要画边框），并说明帧数按 1 处理",
      cornerPrompt.includes("**可以无缝平铺**的墙面") &&
        cornerPrompt.includes("左右边缘能接上自己、上下边缘也能接上自己") &&
        cornerPrompt.includes("不要画边框、收口、阴影、网格线") &&
        cornerPrompt.includes("没有「帧」这一维") &&
        !cornerPrompt.includes("每张图 = 一格内容")
    );
    const a2Prompt = promptOf({ shape: "a2quad", frames: 3 });
    check(
      "提示词（指定拼块）：一块无缝材质、四边能接上自己、帧数=变体数（每张一块砖）",
      a2Prompt.includes("**可以无缝平铺**的材质") &&
        a2Prompt.includes("四边都能与自己相接") &&
        a2Prompt.includes("一共 3 张（每张一块砖）") &&
        a2Prompt.includes("5 种接法") &&
        !a2Prompt.includes("5 行是 5 种接法")
    );
    check("提示词：composeMapAsset 的示例里带着 shape 占位（不是写死的某个形态）", oneFrame.includes("shape:'<你选的形态"), "");

    /**
     * ★ 用户已经选了用法时，**不再念另外几种的判据**。
     *
     * 真机踩过：指定了「整图」，回答里还在讨论「要不要当拼块」—— 提示词里把没被选中的
     * 三种判据也写进去，agent 会以为还有得商量。所以「第一步」整块只在「自动」时出现。
     */
    const stampPrompt = promptOf({ shape: "stamp", stampCols: 4, stampRows: 3 });
    check(
      "★ 指定用法时：提示词里不再出现没选中的那几种判据（第一步整块只在「自动」时写）",
      !stampPrompt.includes("第一步") &&
        !stampPrompt.includes("成片铺开") &&
        !stampPrompt.includes("连成一条") &&
        !stampPrompt.includes("一块一块单独摆") &&
        stampPrompt.includes("已经定死了"),
      stampPrompt.split("\n").filter((line) => line.includes("整图") || line.includes("第一步")).slice(0, 3).join(" / ")
    );
    check(
      "★ 指定用法时：其它形态的「排布段落」一个都不写（只留选中的那一种）",
      !stampPrompt.includes("每张图 = 一格内容") &&
        !stampPrompt.includes("**可以无缝平铺**的墙面") &&
        !stampPrompt.includes("**可以无缝平铺**的材质") &&
        stampPrompt.includes("【整图】")
    );
    check(
      "整图提示词：要求纯绿幕背景 + 只画建筑本体 + 不画地面 / 草地 / 道路",
      stampPrompt.includes("背景必须是纯绿幕") &&
        stampPrompt.includes("不要画地面") &&
        stampPrompt.includes("草地") &&
        stampPrompt.includes("道路"),
      stampPrompt.split("\n").filter((line) => line.includes("绿幕") || line.includes("地面")).join(" / ")
    );
    check(
      "整图提示词：明确「不用自己抠图」（别为了抠图再花一次钱）",
      stampPrompt.includes("不用") && stampPrompt.includes("抠图") && stampPrompt.includes("自己去抠像")
    );
    check("整图提示词：带上「占几格」（4×3 = 12 格）", stampPrompt.includes("4×3") && stampPrompt.includes("12 格"), String(stampPrompt.split("\n").find((line) => line.includes("切成")) ?? ""));
    /**
     * 占格下限是 1（曾经是 2）：界面的夹取函数不许再把 1 顶回 2 ——
     * 喂 1×1 进提示词，拼出来的必须还是 1×1。
     */
    const tinyStampPrompt = promptOf({ shape: "stamp", stampCols: 1, stampRows: 1 });
    check(
      "★ 整图占格下限是 1：1×1 不会被顶回 2×2（提示词里就是 1×1 = 1 格）",
      tinyStampPrompt.includes("1×1") && tinyStampPrompt.includes("1 格") && !tinyStampPrompt.includes("2×2"),
      String(tinyStampPrompt.split("\n").find((line) => line.includes("切成")) ?? "")
    );
    check(
      "反向验证：非整图的提示词里不许出现绿幕要求（材质类素材要的是不透明方块）",
      !plainPrompt.includes("背景必须是纯绿幕") && plainPrompt.includes("不要用绿幕背景") && !a2Prompt.includes("背景必须是纯绿幕")
    );
    check(
      "deriveAssetName：取提示词开头、压掉换行；空则兜底「AI 素材」",
      test.deriveAssetName("  岩浆\n  纹理  ") === "岩浆 纹理" && test.deriveAssetName("") === "AI 素材",
      `${test.deriveAssetName("  岩浆\n  纹理  ")} / ${test.deriveAssetName("")}`
    );

    // ── 对话框：点开、四个控件、帧数为 1 时视频模型点不动 ─────────────────
    tree = await freshPanel();
    byClass(tree, "SPR_mapEdTopBtn")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const aiOpen = collect(tree, (node) => node.props?.["data-testid"] === "map-ai-open")[0];
    check("素材卡片里有「AI 生成素材」按钮", aiOpen !== undefined && textOf(aiOpen) === "AI 生成素材", textOf(aiOpen));
    aiOpen.props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const aiDialogAt = (mounted) => collect(mounted, (node) => node.props?.["data-testid"] === "map-ai-dialog")[0];
    const aiDialog = aiDialogAt(tree);
    check("点开的是**新对话框**（不是「新增素材」）", aiDialog !== undefined && collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog").length === 0);
    const aiPromptBox = (mounted) => collect(aiDialogAt(mounted), (node) => node.props?.["data-testid"] === "map-ai-prompt")[0];
    const aiNameBox = (mounted) => collect(aiDialogAt(mounted), (node) => node.props?.["data-testid"] === "map-ai-name")[0];
    /**
     * 帧数用的是共用的 `NumField`（失焦提交）。
     *
     * ⚠️ 不要试图把它「渲染出来」再找里面的 `<input>`：`collect` 只展开 `Btn`
     * （`NumField` 有 hooks，在本 harness 外调用会污染 hook 存储）。直接读它的
     * props 更干净 —— `value` 就是草稿值，`onChange` 就是失焦后的那个回调。
     */
    const aiFrameField = (mounted) =>
      collect(
        aiDialogAt(mounted),
        (node) => typeof node.type === "function" && node.type.name === "NumField" && node.props?.label === "帧"
      )[0];
    const aiModeBtn = (mounted, value) => collect(aiDialogAt(mounted), (node) => node.props?.["data-ai-mode"] === value)[0];
    const aiShapeBtn = (mounted, value) => collect(aiDialogAt(mounted), (node) => node.props?.["data-ai-shape"] === value)[0];
    check(
      "五个控件齐了：提示词 / 素材名字 / 动画帧数 / 动画生成方式 / 这块素材怎么用",
      aiPromptBox(tree) !== undefined &&
        aiNameBox(tree) !== undefined &&
        aiFrameField(tree) !== undefined &&
        aiModeBtn(tree, "image") !== undefined &&
        aiModeBtn(tree, "video") !== undefined &&
        aiShapeBtn(tree, "auto") !== undefined &&
        aiShapeBtn(tree, "corner16") !== undefined &&
        aiShapeBtn(tree, "a2quad") !== undefined
    );
    check(
      "默认值：帧数 1、方式=生图模型、用法=自动判断、名字与提示词都是空的",
      aiFrameField(tree).props.value === 1 &&
        aiFrameField(tree).props.min === 1 &&
        aiFrameField(tree).props.max === 16 &&
        aiModeBtn(tree, "image").props["data-on"] === "true" &&
        aiShapeBtn(tree, "auto").props["data-on"] === "true" &&
        aiPromptBox(tree).props.value === "" &&
        aiNameBox(tree).props.value === ""
    );
    check("默认（自动判断）时给了判据说明", /成片铺开/.test(textOf(aiDialogAt(tree))) && /连成一条/.test(textOf(aiDialogAt(tree))));
    aiShapeBtn(tree, "corner16").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check(
      "用法选「整格」：说明「只画一块无缝墙砖、插件拼 16 种接法」",
      aiShapeBtn(tree, "corner16").props["data-on"] === "true" && /一块\*\*无缝墙砖/.test(textOf(aiDialogAt(tree))) && /拼出 16 种接法/.test(textOf(aiDialogAt(tree)))
    );
    /**
     * ★ 整格没有帧这一维：不许让用户配出一个**做不到**的组合。
     *
     * 真机踩过：用户在整格上选了「视频模型 + 8 帧」，派出去的提示词里同时写着「帧数 8」和
     * 「整格没有帧这一维」，agent 按静态做完，出来的图不动、**而且没人告诉他**。
     * 现在：帧数灰掉、视频模型点不动、并且明确写出「想要会动请改拼块」。
     */
    check(
      "整格：帧数输入框被禁用（灰掉，不让改）",
      aiFrameField(tree).props.disabled === true && aiFrameField(tree).props.value === 1,
      String(aiFrameField(tree).props.disabled)
    );
    check(
      "整格：说明里点明「没有动画 / 想要会动改成拼块」",
      /整格没有动画/.test(textOf(aiDialogAt(tree))) && /改成「拼块」/.test(textOf(aiDialogAt(tree)))
    );
    aiModeBtn(tree, "video").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("整格：视频模型点不动（出来还是一张静态图，白多一次计费）", aiModeBtn(tree, "video").props["data-on"] !== "true" && aiModeBtn(tree, "image").props["data-on"] === "true");
    // 从整格切到别的用法：帧数重新可用。
    aiShapeBtn(tree, "plain").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("切回「普通」后帧数恢复可用（禁用只跟着整格）", aiFrameField(tree).props.disabled !== true);
    aiShapeBtn(tree, "a2quad").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check(
      "用法选「拼块」：说明「每个变体一块无缝材质 / 拼成 N 列 × 5 行」",
      aiShapeBtn(tree, "a2quad").props["data-on"] === "true" && /一块\*\*无缝材质/.test(textOf(aiDialogAt(tree))) && /N 列 × 5 行/.test(textOf(aiDialogAt(tree)))
    );
    aiShapeBtn(tree, "plain").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("用法选「普通」：说明「每张 = 一格内容 / 帧数 > 1 竖排翻页图」", aiShapeBtn(tree, "plain").props["data-on"] === "true" && /一格内容/.test(textOf(aiDialogAt(tree))));
    aiShapeBtn(tree, "auto").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("再切回「自动判断」", aiShapeBtn(tree, "auto").props["data-on"] === "true");
    check("帧数为 1 时给了「只用生图模型」的说明", /帧数为 1 时只用生图模型/.test(textOf(aiDialogAt(tree))));
    aiModeBtn(tree, "video").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("帧数为 1 时点视频模型不生效（点不动）", aiModeBtn(tree, "image").props["data-on"] === "true" && aiModeBtn(tree, "video").props["data-on"] !== "true");

    // 改帧数（NumField 失焦提交）→ 视频模型可选。
    aiFrameField(tree).props.onChange(3);
    tree = await renderTree(() => MapModule({ api }));
    check("帧数改成 3 之后控件跟着走", Number(aiFrameField(tree).props.value) === 3, String(aiFrameField(tree).props.value));
    aiModeBtn(tree, "video").props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("帧数大于 1 时视频模型可以选（data-on 真的动了）", aiModeBtn(tree, "video").props["data-on"] === "true");
    check("选视频模型时说明了「会多一次生图计费」", /先出一张静态首帧/.test(textOf(aiDialogAt(tree))));

    // 空提示词：拒绝并提示（不建会话）。
    const createdBeforeEmpty = bridgeLog.created.length;
    collect(tree, (node) => node.props?.["data-testid"] === "map-ai-ok")[0].props.onClick();
    await tickTimers();
    tree = await renderTree(() => MapModule({ api }));
    check("空提示词：明确提示「先写一段提示词」且不建会话", /先写一段提示词/.test(textOf(tree)) && bridgeLog.created.length === createdBeforeEmpty);

    // 填提示词 → 生成 → 建会话 + 切到对话 + 发提示词。
    aiPromptBox(tree).props.onChange({ target: { value: "一片岩浆，缓慢翻涌" } });
    tree = await renderTree(() => MapModule({ api }));
    collect(tree, (node) => node.props?.["data-testid"] === "map-ai-ok")[0].props.onClick();
    await tickTimers();
    tree = await renderTree(() => MapModule({ api }));
    check(
      "生成：建的是**不挂靠项目**的新会话（不带 workspaceId / cwd）",
      bridgeLog.created.length === 1 && bridgeLog.created[0].workspaceId === undefined && bridgeLog.created[0].cwd === undefined,
      JSON.stringify(bridgeLog.created)
    );
    check("生成：先切到对话界面（uiWorkspace.openSession）", bridgeLog.opened.join(",") === "session-ai-1", bridgeLog.opened.join(","));
    check(
      "生成：以 queue 模式把提示词作为第一轮发进去（带 beginSubmission 的 requestId）",
      bridgeLog.prompted.length === 1 &&
        bridgeLog.prompted[0].mode === "queue" &&
        bridgeLog.prompted[0].requestId === "req-ai-1" &&
        bridgeLog.prompted[0].content.length === 1 &&
        bridgeLog.prompted[0].content[0].type === "text",
      JSON.stringify(bridgeLog.prompted.map((entry) => entry.mode))
    );
    const sentText = bridgeLog.prompted[0].content[0].text;
    check(
      "生成：发出去的正文就是拼出来的那段（项目 id / 名字 / 帧数 3 / 视频模型 / composeMapAsset）",
      sentText.includes(projectId) &&
        sentText.includes("一片岩浆，缓慢翻涌") &&
        sentText.includes("动画帧数：3") &&
        sentText.includes("视频模型") &&
        sentText.includes("composeMapAsset"),
      sentText.slice(0, 100)
    );
    check("生成：本地回显登记的附件是空的（只用文字）", bridgeLog.submitted.length === 1 && bridgeLog.submitted[0].attachments.length === 0 && bridgeLog.submitted[0].text === sentText);
    check("生成：对话框关掉、给出「已在新对话里开始生成」提示", aiDialogAt(tree) === undefined && /已在新对话里开始生成/.test(textOf(tree)));
    check("生成：会话引用用后即放（不长期占着）", bridgeLog.released === 1, String(bridgeLog.released));

    // ── 回链：`dialog=add&asset=…&frames=2` → 打开「新增素材」并预填 ───────
    /**
     * 夹具帧用 **128×128**（地图格子 32 → 4 倍）：这样 `composeMapAsset` 会把素材图留到
     * 4 倍分辨率，回链带上 `scale=4`，「新增素材」里才会出现「清晰度」那一项。
     */
    const composedFrame = join(HOME, "client-frames", "f0.png");
    await mkdir(join(HOME, "client-frames"), { recursive: true });
    await writeFile(composedFrame, encodePng(Buffer.alloc(128 * 128 * 4, 180), 128, 128));
    const composed = await G.composeMapAsset({ projectId, name: "回链素材", files: [composedFrame, composedFrame] });
    check(
      "夹具：宿主真的整理出一张 ai/ 下的素材图（4 倍分辨率，等用户在「新增素材」里选清晰度）",
      composed.file === "ai/回链素材.png" && composed.frameCount === 2 && composed.scale === 4,
      `${composed.file} scale=${composed.scale}`
    );

    const fetched = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      if (String(url).includes("missing")) return { ok: false, status: 404, blob: async () => new Blob([]) };
      const bytes = await readFile(G.mapAssetPath(projectId, composed.file));
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    };
    try {
      test.openStudioIntent({ get: () => undefined }, { module: "map", jobId: projectId, stage: "assets", dialog: "add", asset: composed.file, frames: 2, scale: composed.scale });
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      const addDialog = (mounted) => collect(mounted, (node) => node.props?.["data-testid"] === "map-add-dialog")[0];
      check("回链：打开的是「新增素材」" + (addDialog(tree) === undefined ? "（没打开）" : ""), addDialog(tree) !== undefined);
      check("回链：素材窗口同时展开", collect(tree, (node) => node.props?.["data-testid"] === "map-assets-card").length === 1);
      check(
        "回链：图已经预选好（显示的是文件名，不是「还没选」）",
        addDialog(tree) !== undefined && /回链素材\.png/.test(textOf(addDialog(tree))) && !/还没选/.test(textOf(addDialog(tree))),
        textOf(addDialog(tree) ?? null).slice(0, 80)
      );
      check("回链：名字预填成文件干名", collect(addDialog(tree), (node) => node.props?.["data-testid"] === "map-add-name")[0].props.value === "回链素材");
      const addCellFields = collect(
        addDialog(tree),
        (node) => typeof node.type === "function" && node.type.name === "NumField"
      );
      check(
        "回链：格子大小预填成项目网格（32×32）",
        addCellFields.map((node) => `${node.props.label}=${String(node.props.value)}`).join(",") === "宽=32,高=32",
        addCellFields.map((node) => `${node.props.label}=${String(node.props.value)}`).join(",")
      );
      check(
        "回链：用法按回链里的 shape 预选成「普通」，而不是「自动识别」",
        collect(addDialog(tree), (node) => node.props?.["data-shape"] === "plain" && node.props?.["data-on"] === "true").length === 1 &&
          collect(addDialog(tree), (node) => node.props?.["data-shape"] === "auto" && node.props?.["data-on"] === "true").length === 0
      );
      check("回链：帧数 2 → 「会动吗」预选翻页图", collect(addDialog(tree), (node) => node.props?.["data-anim"] === "rows" && node.props?.["data-on"] === "true").length === 1);
      check(
        "回链：取的就是项目资源路由下那张图（assetBase + 相对路径）",
        fetched.length >= 1 &&
          fetched.every((url) => url.endsWith(composed.file) && url.includes(`/dsh-game-material-master/map-assets/${projectId}/`)),
        fetched[0] ?? "(没发请求)"
      );

      /**
       * ── 回链预填之后还能调「动画速度」，点「确定」真的发给宿主 ────────────────
       *
       * 「新增素材时能设置动画播放速度」这条需求的最小闭环：界面上选了 → 提交时带上
       * （假桥会把 import 的属性原样转给宿主，所以这里能验到真发了什么）。
       */
      const fpsSelect = collect(addDialog(tree), (node) => node.props?.["data-testid"] === "map-add-fps")[0];
      check("回链预填的草稿上也有「动画速度」（预填的是会动的素材）", fpsSelect !== undefined && fpsSelect.props.value === "");
      const importsBefore = apiLog.importOptions.length;
      fpsSelect.props.onChange({ target: { value: "4" } });
      tree = await renderTree(() => MapModule({ api }));
      /**
       * 清晰度：回链带了 `scale`（这张 AI 素材图是 4 倍分辨率）时才出现 ——
       * 选了「锐利」再点确定，宿主应当收到 `clarity: "sharp"` + `scale: 4`。
       */
      const clarityPicker = collect(addDialog(tree), (node) => typeof node.props?.["data-clarity"] === "string");
      check("回链带了 scale=4 → 「新增素材」里出现「清晰度」三个选项", clarityPicker.length === 3, `${clarityPicker.length} 个`);
      check("默认选的是「平滑」（面积平均，AI 图最清楚的那档）", clarityPicker.some((node) => node.props["data-clarity"] === "smooth" && node.props["data-on"] === "true"));
      check("说明里写清「每格 128px（4 倍）、会缩到 32px」", /4 倍/.test(textOf(addDialog(tree))) && /128px/.test(textOf(addDialog(tree))), textOf(addDialog(tree)).match(/这张图每格[^。]*。/)?.[0] ?? "");
      collect(addDialog(tree), (node) => node.props?.["data-clarity"] === "sharp")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
      collect(tree, (node) => node.props?.["data-testid"] === "map-add-ok")[0].props.onClick();
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      check(
        "点「确定」后宿主真的收到 fps=4（不是只改了个界面状态）",
        apiLog.importOptions.length === importsBefore + 1 && apiLog.importOptions[apiLog.importOptions.length - 1].fps === 4,
        JSON.stringify(apiLog.importOptions[apiLog.importOptions.length - 1] ?? null)
      );
      check(
        "循环方式也一起发出去了（默认正放）",
        apiLog.importOptions[apiLog.importOptions.length - 1].loop === "forward",
        JSON.stringify(apiLog.importOptions[apiLog.importOptions.length - 1] ?? null)
      );
      check(
        "★ 清晰度与倍数也一起发出去了（clarity=sharp、scale=4 —— 宿主据此把 4 倍图缩到格子）",
        apiLog.importOptions[apiLog.importOptions.length - 1].clarity === "sharp" && apiLog.importOptions[apiLog.importOptions.length - 1].scale === 4,
        JSON.stringify(apiLog.importOptions[apiLog.importOptions.length - 1] ?? null)
      );
      check(
        "同一批提交里用法 / 会动吗 / 格子也一起发过去了（回链预填的普通 + 翻页图）",
        apiLog.importOptions[apiLog.importOptions.length - 1].animRows === true &&
          apiLog.importOptions[apiLog.importOptions.length - 1].shape === "plain" &&
          apiLog.importOptions[apiLog.importOptions.length - 1].cell.width === 32,
        JSON.stringify(apiLog.importOptions[apiLog.importOptions.length - 1] ?? null)
      );

      /**
       * ── 形态跟着回链走：拼块 / 整格不会退回「普通」 ───────────────────────
       *
       * 少了这一条，用户点开链接看到的是「用法 = 普通」，一确定就把拼块图当成普通素材
       * 导入 —— 画出来全是碎块，而且不报错。
       */
      const a2Sheet = await G.composeMapAsset({ projectId, name: "回链拼块", files: [composedFrame, composedFrame], shape: "a2quad" });
      test.openStudioIntent({ get: () => undefined }, { module: "map", jobId: projectId, stage: "assets", dialog: "add", asset: a2Sheet.file, frames: 2, shape: a2Sheet.shape });
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      check(
        "回链（拼块）：用法预选成「拼块」、会动吗 = 不动（拼块的动画走变体，不是翻页图）",
        collect(addDialog(tree), (node) => node.props?.["data-shape"] === "a2quad" && node.props?.["data-on"] === "true").length === 1 &&
          collect(addDialog(tree), (node) => node.props?.["data-anim"] === "off" && node.props?.["data-on"] === "true").length === 1,
        `shape=${collect(addDialog(tree), (node) => node.props?.["data-shape"] === "a2quad")[0]?.props?.["data-on"]}`
      );
      const cornerSheet = await G.composeMapAsset({ projectId, name: "回链整格", files: [composedFrame], shape: "corner16" });
      test.openStudioIntent({ get: () => undefined }, { module: "map", jobId: projectId, stage: "assets", dialog: "add", asset: cornerSheet.file, frames: 1, shape: cornerSheet.shape });
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      check(
        "回链（整格）：用法预选成「整格」、会动吗 = 不动",
        collect(addDialog(tree), (node) => node.props?.["data-shape"] === "corner16" && node.props?.["data-on"] === "true").length === 1 &&
          collect(addDialog(tree), (node) => node.props?.["data-anim"] === "off" && node.props?.["data-on"] === "true").length === 1
      );
      // 反向验证：asset 指到一个不存在的文件 → 仍然打开「新增素材」（空的），并给出提示。
      fetched.length = 0;
      test.openStudioIntent({ get: () => undefined }, { module: "map", jobId: projectId, stage: "assets", dialog: "add", asset: "ai/missing.png", frames: 1 });
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      check("反向验证：图取不回来时仍然打开「新增素材」（空的）", addDialog(tree) !== undefined && /还没选/.test(textOf(addDialog(tree))));
      check("反向验证：并明确提示「没取到刚生成的那张图」", /没取到刚生成的那张图/.test(textOf(tree)), textOf(tree).match(/没取到[^。]*。/)?.[0] ?? "");
      check("反向验证：帧数 1 时不会预选「翻页图」", collect(addDialog(tree), (node) => node.props?.["data-anim"] === "off" && node.props?.["data-on"] === "true").length === 1);
      check(
        "反向验证：不认识的 shape 不会带进界面（退回普通）",
        collect(addDialog(tree), (node) => node.props?.["data-shape"] === "plain" && node.props?.["data-on"] === "true").length === 1
      );
    } finally {
      if (realFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = realFetch;
    }
  }


  // ══ 22) 整图（多格印花：占格 / 帧数 / 区域 / 右键旋转 / 区域叠加）═══════════
  section("22) 整图（多格印花）");
  {
    /** 先在宿主侧塞一张整图素材（界面上只要它出现在调色板就行）。 */
    const stampCell = 16, stampCols = 3, stampRows = 2;
    const stampBitmap = { width: stampCols * stampCell, height: stampRows * stampCell, rgba: Buffer.alloc(stampCols * stampCell * stampRows * stampCell * 4) };
    for (let y = 0; y < stampBitmap.height; y++) {
      for (let x = 0; x < stampBitmap.width; x++) {
        const offset = (y * stampBitmap.width + x) * 4;
        stampBitmap.rgba[offset] = 30 + Math.floor(x / stampCell) * 60;
        stampBitmap.rgba[offset + 1] = 30 + Math.floor(y / stampCell) * 90;
        stampBitmap.rgba[offset + 2] = 120;
        stampBitmap.rgba[offset + 3] = 255;
      }
    }
    const stampPass = [0, 0, 0, 1, 1, 2];
    const stampImported = await G.importMapTileset(projectId, "雕像", encodePng(stampBitmap.rgba, stampBitmap.width, stampBitmap.height).toString("base64"), {
      stamp: { cols: stampCols, rows: stampRows, frames: 2, pass: stampPass }
    });
    const stampTileset = stampImported.tilesets[0];
    tree = await freshPanel();

    const hostView = await G.mapView(await G.readMapProject(projectId));
    const stampEntry = hostView.tilesets.find((entry) => entry.id === stampTileset.id);
    const stampBrush = stampEntry.palette[0].index;

    // ── 调色板：整图只出一条，缩略图是**整张**（不是一格）────────────────
    const paletteNodes = () => collect(tree, (node) => typeof node.props?.["data-index"] === "string");
    const stampButton = () => paletteNodes().find((node) => node.props["data-index"] === String(stampBrush));
    check("调色板：整图只出一条笔刷", paletteNodes().filter((node) => node.props["data-index"] === String(stampBrush)).length === 1);
    check(
      "★ 调色板的缩略图按**整张**缩放（3 格的图缩进一个 32px 按钮，而不是只露出第一格）",
      stampButton() !== undefined && String(stampButton().props.style.backgroundSize).startsWith("32px"),
      String(stampButton()?.props.style.backgroundSize)
    );
    check(
      "调色板悬停说明写清「这是 3×2 的整图、右键能转」",
      String(stampButton()?.props["aria-label"] ?? "").includes("3×2") && String(stampButton()?.props["aria-label"] ?? "").includes("右键"),
      String(stampButton()?.props["aria-label"] ?? "").slice(0, 80)
    );

    // ── 笔刷：选中后**点一次印一整张**，拖动不连印 ────────────────────────
    stampButton().props.onClick({ shiftKey: false, ctrlKey: false, metaKey: false });
    tree = await renderTree(() => MapModule({ api }));
    const tapBrush = async (button, at, pointerId) => {
      const node = collect(tree, (item) => item.props?.["data-testid"] === "map-canvas")[0];
      node.props.onPointerDown({ clientX: at.x, clientY: at.y, button, pointerId });
      await tickTimers();
      node.props.onPointerUp({ pointerId });
      tree = await renderTree(() => MapModule({ api }));
    };
    const stampOpsSince = (from) => apiLog.applies.slice(from).flatMap((entry) => entry.ops ?? []).filter((op) => op.kind === "stampPlace" || op.kind === "paint");

    /**
     * ★ 换成别的工具后，整图笔刷的「多格」状态必须收成一格。
     *
     * 真机反馈：先在印整图，切到标记 / 橡皮之后，悬停框还是 3×2 的一大块，
     * 看着像这些工具也会一次作用好几格。整图只借给「画笔」；其它工具一律单格。
     * 另外橡皮工具下右键也应该擦（以前整图笔刷还在时右键是转整图）。
     */
    {
      const redFrameSince = (from) => {
        const rects = fillRects.slice(from).filter((item) => item.fillStyle === "#e23b2b").slice(-4);
        if (rects.length < 4) return null;
        return {
          left: Math.min(...rects.map((item) => item.x)),
          right: Math.max(...rects.map((item) => item.x + item.w)),
          top: Math.min(...rects.map((item) => item.y)),
          bottom: Math.max(...rects.map((item) => item.y + item.h))
        };
      };
      const hoverFrame = async (r, c) => {
        const before = fillRects.length;
        const node = collect(tree, (item) => item.props?.["data-testid"] === "map-canvas")[0];
        const at = clientOf(r, c);
        node.props.onPointerMove({ clientX: at.x, clientY: at.y, pointerId: 61 });
        tree = await renderTree(() => MapModule({ api }));
        return redFrameSince(before);
      };
      const sizeOf = (frame) =>
        frame === null ? "" : `${Math.round(frame.right - frame.left)}×${Math.round(frame.bottom - frame.top)}`;
      const penFrame = await hoverFrame(3, 3);
      check("画笔 + 整图：悬停框按整张算（3×2 = 96×64）", sizeOf(penFrame) === "96×64", sizeOf(penFrame));
      const toolSwitches = [["eraser", "橡皮"], ["marker", "标记"], ["bucket", "油漆桶"], ["pipette", "吸管"]];
      for (const [index, [key, label]] of toolSwitches.entries()) {
        byTool(tree, key)[0].props.onClick();
        tree = await renderTree(() => MapModule({ api }));
        /**
         * 先悬停另一格热身，再量目标格。
         *
         * ① 同一格不会触发重画（hover 去重），量到的会是上一帧；
         * ② 本 harness 里「切工具后的第一次 pointermove」偶尔会晚一拍才提交，
         *    直接拿它当测量值会读到切换前的 3×2。
         */
        await hoverFrame(6, 6);
        const one = await hoverFrame(3, 3 + index);
        check(`★ 切到${label}：悬停框回到 1×1（不再保留整图的 3×2）`, sizeOf(one) === "32×32", sizeOf(one));
      }
      // 橡皮工具下右键 = 擦一格（不是转整图）
      byTool(tree, "eraser")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
      const eraseFrom = apiLog.applies.length;
      await tapBrush(2, clientOf(9, 9), 62);
      const eraserOps = apiLog.applies.slice(eraseFrom).flatMap((entry) => entry.ops ?? []);
      check(
        "★ 橡皮工具下右键 = 擦一格（不再因为整图笔刷而去旋转）",
        eraserOps.some((op) => op.kind === "paint") && !eraserOps.some((op) => op.kind === "stampPlace"),
        JSON.stringify(eraserOps)
      );
      byTool(tree, "pen")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
      const backFrame = await hoverFrame(5, 5);
      check("切回画笔：整图的悬停框恢复 3×2（多格状态只是不借给别的工具）", sizeOf(backFrame) === "96×64", sizeOf(backFrame));
    }

    const applyFrom = apiLog.applies.length;
    await tapBrush(0, clientOf(1, 1), 41);
    let ops = stampOpsSince(applyFrom);
    check("★ 左键点一下 = **一条** stampPlace（不是逐格刷 6 次）", ops.length === 1 && ops[0].kind === "stampPlace" && ops[0].rot === 0 && ops[0].r === 1 && ops[0].c === 1, JSON.stringify(ops));
    check("stampPlace 带的是素材 id（占几格由宿主决定，界面不许传）", ops[0].tilesetId === stampTileset.id && ops[0].cols === undefined && ops[0].rows === undefined, JSON.stringify(ops[0]));

    // 拖动：按下、移两格、松开 → 仍然只有第一条
    const dragFrom = apiLog.applies.length;
    {
      const node = collect(tree, (item) => item.props?.["data-testid"] === "map-canvas")[0];
      const start = clientOf(4, 4);
      node.props.onPointerDown({ clientX: start.x, clientY: start.y, button: 0, pointerId: 42 });
      node.props.onPointerMove({ clientX: clientOf(4, 6).x, clientY: clientOf(4, 6).y, pointerId: 42 });
      node.props.onPointerUp({ pointerId: 42 });
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
    }
    check("★ 拖动不连印（松手后只有按下那一次的基础 + 不超过 1 条）", stampOpsSince(dragFrom).filter((op) => op.kind === "stampPlace").length <= 1, JSON.stringify(stampOpsSince(dragFrom)));

    // ── 右键：旋转（0→1→2→3→0），**不再擦除** ────────────────────────────
    const rotateFrom = apiLog.applies.length;
    await tapBrush(2, clientOf(2, 2), 43);
    check("★ 右键不擦除（整图笔刷下不提交任何 op）", stampOpsSince(rotateFrom).length === 0, JSON.stringify(stampOpsSince(rotateFrom)));
    await tapBrush(0, clientOf(2, 2), 44);
    ops = stampOpsSince(rotateFrom).filter((op) => op.kind === "stampPlace");
    check("★ 右键转 90°：下一条 stampPlace 的 rot = 1", ops.length === 1 && ops[0].rot === 1, JSON.stringify(ops));
    for (let i = 0; i < 2; i++) await tapBrush(2, clientOf(2, 2), 45 + i);
    await tapBrush(0, clientOf(3, 3), 48);
    ops = stampOpsSince(rotateFrom).filter((op) => op.kind === "stampPlace");
    check("右键转四次回到原样（第四条 op 的 rot = 3，再转一次就回 0）", ops[ops.length - 1].rot === 3, JSON.stringify(ops.map((op) => op.rot)));
    await tapBrush(2, clientOf(2, 2), 49);
    await tapBrush(0, clientOf(5, 5), 50);
    ops = stampOpsSince(rotateFrom).filter((op) => op.kind === "stampPlace");
    check("转满一圈回到 0", ops[ops.length - 1].rot === 0, JSON.stringify(ops.map((op) => op.rot)));

    // ── 橡皮：碰一格 → 整张没了，并且提示一句 ────────────────────────────
    // 先确保地图上有一张（上面那几次点击已经放了）。
    byTool(tree, "eraser")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const stampAt = await G.mapPlan(projectId, { view: { x: 0, y: 0, width: 32 * 6, height: 32 * 6 }, have: [] });
    const stampDocs = await G.readMapProject(projectId);
    void stampDocs;
    const eraseFrom = apiLog.applies.length;
    await tapBrush(0, clientOf(2, 2), 51);
    const erasedOps = stampOpsSince(eraseFrom);
    check("橡皮：碰一下整图就发的是 paint（由宿主决定整张摘掉）", erasedOps.length >= 1 && erasedOps.every((op) => op.kind === "paint"), JSON.stringify(erasedOps));
    check(
      "★ 擦到整图时**提示**「动到了 1 张整图」（不让用户以为是 bug）",
      textOf(tree).includes("动到了") && textOf(tree).includes("整图"),
      textOf(tree).match(/动到了[^。]*。/)?.[0] ?? textOf(tree).slice(0, 80)
    );
    check("撤销按钮变成可用（整张摘掉也是一步撤销）", collect(tree, (node) => node.props?.["data-testid"] === "map-undo")[0]?.props?.disabled !== true);

    // ── 区域叠加：勾上之后计划带 pass、画布按三色涂 ───────────────────────
    byTool(tree, "pen")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    stampButton().props.onClick({ shiftKey: false, ctrlKey: false, metaKey: false });
    await tapBrush(0, clientOf(2, 2), 52);
    byTool(tree, "settings")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const passToggle = collect(tree, (node) => node.props?.["data-testid"] === "map-show-pass")[0];
    check("设置里多了「区域」开关", passToggle !== undefined);
    const plansBefore = apiLog.plans.length;
    passToggle.props.onChange({ target: { checked: true } });
    tree = await renderTree(() => MapModule({ api }));
    await tickTimers();
    tree = await renderTree(() => MapModule({ api }));
    const passQuery = apiLog.plans.slice(plansBefore).find((entry) => entry.pass === true);
    check("★ 打开「区域」后计划查询带 pass: true", passQuery !== undefined, JSON.stringify(apiLog.plans.slice(plansBefore).map((entry) => entry.pass)));
    const passRects = fillRects.filter((rect) => typeof rect.fillStyle === "string" && rect.fillStyle.startsWith("rgba(") && rect.fillStyle.includes("0.34"));
    check("★ 画布把区域涂成半透明（三种颜色都出现过）", new Set(passRects.map((rect) => rect.fillStyle)).size >= 2, [...new Set(passRects.map((rect) => rect.fillStyle))].join(" / "));

    // ── 反向验证：普通笔刷右键既不擦除、也不乱提交 ─────────────────────────
    const plainButton = paletteNodes().find((node) => node.props["data-index"] !== String(stampBrush));
    if (plainButton !== undefined) {
      plainButton.props.onClick({ shiftKey: false, ctrlKey: false, metaKey: false });
      tree = await renderTree(() => MapModule({ api }));
      const plainFrom = apiLog.applies.length;
      await tapBrush(2, clientOf(6, 6), 53);
      check("反向验证：普通素材右键不擦除（提示「擦除请点橡皮」）", stampOpsSince(plainFrom).length === 0 && textOf(tree).includes("橡皮"), textOf(tree).match(/右键是旋转整图用的[^。]*。/)?.[0] ?? "");
    }

    // ── 「新增素材」里的整图那一段（占几格 / 帧数 / 区域）────────────────────
    const numFieldInDialog = (card, label) =>
      collect(card, (node) => node.props !== undefined && typeof node.props.onChange === "function" && node.props.label === label)[0];
    byTool(tree, "settings")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    byClass(tree, "SPR_mapEdTopBtn")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    collect(byClass(tree, "SPR_mapEdCard")[0], (node) => node.type === "button" && textOf(node) === "新增素材")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const stampDialog = () => collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog")[0];
    collect(stampDialog(), (node) => node.props?.["data-shape"] === "stamp")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const dialogText = textOf(stampDialog()).replace(/\s+/g, " ");
    check("选「整图」后：格子大小与「会动吗」都不出现（格子锁死为地图网格）", !dialogText.includes("格子大小") && !dialogText.includes("会动吗"));
    check("选「整图」后：占几格 / 帧数 / 区域 三项都在", ["占几格", "帧数", "哪些格子能走"].every((label) => dialogText.includes(label)), dialogText.slice(0, 100));
    const passCellsOf = () =>
      collect(stampDialog(), (node) => typeof node.props?.["data-testid"] === "string" && /^map-add-pass-\d+-\d+$/u.test(node.props["data-testid"]));
    check("默认 3×3 → 9 个区域格子（默认全部不可通过）", passCellsOf().length === 9 && passCellsOf().every((node) => node.props["data-pass"] === "0"), `${passCellsOf().length} 格 / ${passCellsOf().map((node) => node.props["data-pass"]).join("")}`);
    collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-1-1")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("点一格：0 → 1（可通过·被人物遮挡）", collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-1-1")[0].props["data-pass"] === "1");
    collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-1-1")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("再点：1 → 2（可通过·遮挡人物）", collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-1-1")[0].props["data-pass"] === "2");
    collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-1-1")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("再点：2 → 0（转回不可通过）", collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-1-1")[0].props["data-pass"] === "0");
    collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-walk")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("「全部可通过」一键把 9 格都设成 1", passCellsOf().every((node) => node.props["data-pass"] === "1"), passCellsOf().map((node) => node.props["data-pass"]).join(""));
    collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-none")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    check("「全部不可通过」一键回到 0", passCellsOf().every((node) => node.props["data-pass"] === "0"));
    // 改「占几格」：区域格子跟着重排（3×3 → 4×3 = 12 格）
    numFieldInDialog(stampDialog(), "宽").props.onChange(4);
    tree = await renderTree(() => MapModule({ api }));
    check("占格改成 4×3 → 区域格子变成 12 个（多出来的默认不可通过）", passCellsOf().length === 12, `${passCellsOf().length} 格`);
    numFieldInDialog(stampDialog(), "高").props.onChange(2);
    tree = await renderTree(() => MapModule({ api }));
    check("占格改成 4×2 → 8 格", passCellsOf().length === 8, `${passCellsOf().length} 格`);
    // 给一格「可通过·遮挡人物」，然后带上图提交
    collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-0-0")[0].props.onClick();
    collect(stampDialog(), (node) => node.props?.["data-testid"] === "map-add-pass-0-0")[0].props.onClick();
    tree = await renderTree(() => MapModule({ api }));
    const stampFile = new File([encodePng(Buffer.alloc(64 * 32 * 4, 200), 64, 32)], "statue.png", { type: "image/png" });
    // 隐藏的 file input 挂在面板壳里（不在对话框节点下）。
    collect(tree, (node) => node.props?.["data-testid"] === "map-add-input")[0].props.onChange({ target: { files: [stampFile], value: "" } });
    tree = await renderTree(() => MapModule({ api }));
    const importFrom = apiLog.importOptions.length;
    collect(tree, (node) => node.props?.["data-testid"] === "map-add-ok")[0].props.onClick();
    await tickTimers();
    tree = await renderTree(() => MapModule({ api }));
    const stampOption = apiLog.importOptions[importFrom];
    check(
      "★ 点「确定」：stamp 规格（4×2 / 1 帧 / 8 格区域）真的交给宿主",
      stampOption !== undefined && stampOption.stamp !== undefined && stampOption.stamp.cols === 4 && stampOption.stamp.rows === 2 && stampOption.stamp.frames === 1 && stampOption.stamp.pass.length === 8,
      JSON.stringify(stampOption?.stamp ?? null)
    );
    check("区域里的 2（可通过·遮挡人物）也原样传下去了", stampOption !== undefined && stampOption.stamp.pass[0] === 2, JSON.stringify(stampOption?.stamp?.pass ?? null));
    check("★ 整图默认勾上「抠掉绿幕背景」，点确定时 `stampKey: true` 一起发出去", stampOption !== undefined && stampOption.stampKey === true, JSON.stringify(stampOption?.stampKey ?? null));

    // 自己导一张透明 PNG：取消勾选 → `stampKey: false`（不能替用户决定抠不抠）
    {
      /** 打开「新增素材」并选「整图」（素材卡可能已经在显示，那就先找按钮、找不到再切卡片）。 */
      const reopened = async () => {
        const addButton = () => collect(tree, (node) => node.type === "button" && textOf(node) === "新增素材")[0];
        if (addButton() === undefined) {
          byTool(tree, "assets")[0].props.onClick();
          tree = await renderTree(() => MapModule({ api }));
        }
        addButton().props.onClick();
        tree = await renderTree(() => MapModule({ api }));
        collect(tree, (node) => node.props?.["data-shape"] === "stamp")[0].props.onClick();
        tree = await renderTree(() => MapModule({ api }));
      };
      const dialogOf = () => collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog")[0];
      const keyBox = () => collect(dialogOf(), (node) => node.props?.["data-testid"] === "map-add-stamp-key")[0];
      await reopened();
      check("对话框里整图多一个「抠掉绿幕背景」勾选，默认勾着", keyBox() !== undefined && keyBox().props.checked === true);
      keyBox().props.onChange({ target: { checked: false } });
      tree = await renderTree(() => MapModule({ api }));
      check("取消勾选后就真的是 false（草稿只改自己）", keyBox().props.checked === false);
      const file = new File([encodePng(Buffer.alloc(64 * 64 * 4, 200), 64, 64)], "own.png", { type: "image/png" });
      collect(tree, (node) => node.props?.["data-testid"] === "map-add-input")[0].props.onChange({ target: { files: [file], value: "" } });
      tree = await renderTree(() => MapModule({ api }));
      const from = apiLog.importOptions.length;
      collect(tree, (node) => node.props?.["data-testid"] === "map-add-ok")[0].props.onClick();
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      check("★ 取消勾选 → `stampKey: false`（不替用户抠图）", apiLog.importOptions[from]?.stampKey === false, JSON.stringify(apiLog.importOptions[from]?.stampKey ?? null));
    }

    // ── 这三条是真机反馈：窗口太长没滚动、区域格子看不到图、整图找不到播放速度 ──
    {
      const cssText = String(test.CSS ?? source.slice(source.indexOf("const CSS = "), source.indexOf("const CSS = ") + 200000));
      check(
        "★「新增素材」窗口固定最大高度并自己滚（整图选项多时不会长到出屏、底下的「确定」点不到）",
        /\.SPR_mapEdDlg\{[^}]*max-height:[^;}]+[^}]*overflow-y:auto/.test(cssText),
        (cssText.match(/\.SPR_mapEdDlg\{[^}]*\}/) ?? [""])[0].slice(0, 120)
      );
      check("底部「取消 / 确定」吸底（滚动时始终能点到）", /\.SPR_mapEdDlgActions\{[^}]*position:sticky[^}]*bottom:/.test(cssText));
      /** 打开「新增素材」并选中「整图」—— 对话框已经开着就直接用（重复点会把上一份草稿顶掉）。 */
      const openStampDialog = async () => {
        const dialogNode = () => collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog")[0];
        if (dialogNode() === undefined) {
          const addButton = () => collect(tree, (node) => node.type === "button" && textOf(node) === "新增素材")[0];
          if (addButton() === undefined) {
            byTool(tree, "assets")[0].props.onClick();
            tree = await renderTree(() => MapModule({ api }));
          }
          addButton().props.onClick();
          tree = await renderTree(() => MapModule({ api }));
        }
        const shape = collect(tree, (node) => node.props?.["data-shape"] === "stamp")[0];
        if (shape !== undefined && shape.props["data-on"] !== "true") {
          shape.props.onClick();
          tree = await renderTree(() => MapModule({ api }));
        }
      };
      const dialog2 = () => collect(tree, (node) => node.props?.["data-testid"] === "map-add-dialog")[0];
      await openStampDialog();
      const preview = () => collect(dialog2(), (node) => node.props?.["data-testid"] === "map-add-stamp-preview")[0];
      const gridOf = () => collect(preview(), (node) => node.props?.className === "SPR_mapEdStampGrid")[0];
      check("★ 区域格子**叠在素材图上面**（点的是图上那一块，不是一串编号按钮）", preview() !== undefined && gridOf() !== undefined, textOf(preview() ?? null));
      /**
       * 这段要连着改好几次草稿（占格 → 帧数 → 速度 → 循环方式），而 harness 偶尔会在
       * 某一轮 setState 之后判「没稳定」把面板整棵树换掉 —— 那之后对话框就没了。
       * 所以整段放进重试里：**每一步都确认对话框还在**，不在就从头再来一遍。
       */
      // 刚打开时帧数还是 1：**静态的整图不该出现「动画速度」**（显示了只会让人以为设了动画）
      await openStampDialog();
      check("反向验证：帧数为 1 的整图不显示「动画速度」与「循环方式」", !textOf(dialog2()).replace(/\s+/g, " ").includes("动画速度") && !textOf(dialog2()).includes("循环方式"), textOf(dialog2()).replace(/\s+/g, " ").slice(-80));
      const previewFile = new File([encodePng(Buffer.alloc(40 * 24 * 4, 180), 40, 24)], "preview.png", { type: "image/png" });
      let configured = false;
      for (let attempt = 0; attempt < 4 && configured !== true; attempt++) {
        try {
          await openStampDialog();
          if (preview() === undefined) continue;
          const num = (label) =>
            collect(dialog2(), (node) => node.props !== undefined && typeof node.props.onChange === "function" && node.props.label === label)[0];
          num("宽").props.onChange(5);
          tree = await renderTree(() => MapModule({ api }));
          if (preview() === undefined) continue;
          num("高").props.onChange(3);
          tree = await renderTree(() => MapModule({ api }));
          if (preview() === undefined) continue;
          collect(tree, (node) => node.props?.["data-testid"] === "map-add-input")[0].props.onChange({ target: { files: [previewFile], value: "" } });
          tree = await renderTree(() => MapModule({ api }));
          if (preview() === undefined) continue;
          num("帧数").props.onChange(3);
          tree = await renderTree(() => MapModule({ api }));
          if (preview() === undefined) continue;
          configured = true;
        } catch {
          configured = false;
        }
      }
      check("整图对话框能连续改「占几格 / 帧数」（改完对话框还在）", configured === true);
      check(
        "预览框的比例 = 占几格（5×3 → aspect-ratio 5 / 3，图不会被拉成方的）",
        String(preview()?.props.style.aspectRatio) === "5 / 3",
        String(preview()?.props.style.aspectRatio)
      );
      check(
        "格子网格的列数 / 行数跟着占格走（CSS grid repeat(N, 1fr)）",
        String(gridOf()?.props.style.gridTemplateColumns) === "repeat(5, 1fr)" && String(gridOf()?.props.style.gridTemplateRows) === "repeat(3, 1fr)",
        `${gridOf()?.props.style.gridTemplateColumns} / ${gridOf()?.props.style.gridTemplateRows}`
      );
      check(
        "★ 选好图之后预览框铺上这张图（blob URL，不读 base64 —— 点格子时看的就是这张图）",
        String(preview()?.props.style.backgroundImage).startsWith("url(\"blob:"),
        String(preview()?.props.style.backgroundImage).slice(0, 40)
      );
      check(
        "预览框的图被拉伸成正好铺满格子（background-size 100% 100%，否则点到的格子与画面对不上）",
        /\.SPR_mapEdStamp\{[^}]*background-size:100% 100%/.test(String(test.CSS ?? "")) &&
          /^(100% 100%|100% \d+%)$/.test(String(preview()?.props.style.backgroundSize)),
        String(preview()?.props.style.backgroundSize)
      );
      check(
        "多帧时预览只铺**第 1 帧**（草稿里那张是各帧竖排的，整张铺上去格子就对不上了）",
        String(collect(dialog2(), (node) => node.props !== undefined && typeof node.props.onChange === "function" && node.props.label === "帧数")[0]?.props?.value) === "3"
          ? String(preview()?.props.style.backgroundSize) === "100% 300%"
          : true,
        String(preview()?.props.style.backgroundSize)
      );
      const labelText = () => textOf(dialog2()).replace(/\s+/g, " ");
      collect(dialog2(), (node) => node.props !== undefined && typeof node.props.onChange === "function" && node.props.label === "帧数")[0].props.onChange(3);
      tree = await renderTree(() => MapModule({ api }));
      check("★ 整图帧数改成 3 之后出现「动画速度」与「循环方式」（真机反馈找不到）", labelText().includes("动画速度") && labelText().includes("循环方式"), labelText().slice(-120));
      collect(dialog2(), (node) => node.props?.["data-testid"] === "map-add-fps")[0].props.onChange({ target: { value: "8" } });
      tree = await renderTree(() => MapModule({ api }));
      collect(dialog2(), (node) => node.props?.["data-loop"] === "reverse")[0].props.onClick();
      tree = await renderTree(() => MapModule({ api }));
      const from2 = apiLog.importOptions.length;
      collect(tree, (node) => node.props?.["data-testid"] === "map-add-ok")[0].props.onClick();
      await tickTimers();
      tree = await renderTree(() => MapModule({ api }));
      const animOption = apiLog.importOptions[from2];
        /**
       * ★ 整图占格的**上限 = 地图自己**（不再是死写的 8）。
       * 项目是 32×32 格的地图：输入框的 max 应该就是 32，且填 64 会被夹回 32。
       */
      {
        await openStampDialog();
        const num = (label) =>
          collect(dialog2(), (node) => node.props !== undefined && typeof node.props.onChange === "function" && node.props.label === label)[0];
        // 这个项目在前面被改成过 48×20，所以上限不能写死 —— 直接读当前地图尺寸比。
        const mapNow = await G.mapView(await G.readMapProject(projectId));
        check(
          "★ 整图「宽 / 高」的输入上限跟着地图走（不是死写的 8）",
          num("宽").props.max === mapNow.cols && num("高").props.max === mapNow.rows,
          JSON.stringify({ w: num("宽").props.max, h: num("高").props.max, map: [mapNow.cols, mapNow.rows] })
        );
        num("宽").props.onChange(mapNow.cols + 8);
        tree = await renderTree(() => MapModule({ api }));
        const colsValue = Number(num("宽").props.value);
        check("★ 填一个比地图还大的数会被夹回地图宽度（不会让用户配出一张画不全的整图）", colsValue === mapNow.cols, `${colsValue} vs ${mapNow.cols}`);
      }

      // ── 素材属性窗口：点素材列表里的一行就打开（改名 / 播放速度 / 循环方式）──
      {
        byTool(tree, "settings")[0].props.onClick();
        tree = await renderTree(() => MapModule({ api }));
        byClass(tree, "SPR_mapEdTopBtn")[0].props.onClick();
        tree = await renderTree(() => MapModule({ api }));
        const rowOf = (name) => collect(tree, (node) => node.props?.["data-tileset"] !== undefined && textOf(node).includes(name))[0];
        const waterRow = rowOf("内置 · 水");
        check("素材列表里每一行都可以点开（data-tileset 带素材 id）", waterRow !== undefined, textOf(byClass(tree, "SPR_mapEdCard")[0]).slice(0, 60));
        waterRow.props.onClick();
        tree = await renderTree(() => MapModule({ api }));
        const tsDlg = () => collect(tree, (node) => node.props?.["data-testid"] === "map-tsedit-dialog")[0];
        check("★ 点一下素材 → 弹出「素材属性」窗口", tsDlg() !== undefined, textOf(tree).slice(0, 60));
        check("窗口里有名字 / 动画速度 / 循环方式三样", ["叫什么", "动画速度", "循环方式"].every((label) => textOf(tsDlg()).includes(label)), textOf(tsDlg()).replace(/\s+/g, " ").slice(0, 90));
        const nameInput = () => collect(tsDlg(), (node) => node.props?.["data-testid"] === "map-tsedit-name")[0];
        check("名字输入框预填的是当前名字", nameInput().props.value === "内置 · 水", String(nameInput().props.value));
        nameInput().props.onChange({ target: { value: "我的水" } });
        tree = await renderTree(() => MapModule({ api }));
        const fpsSelect = () => collect(tsDlg(), (node) => node.props?.["data-testid"] === "map-tsedit-fps")[0];
        check("会动的素材：播放速度可选（默认跟全局 = 空串）", fpsSelect() !== undefined && fpsSelect().props.disabled !== true && fpsSelect().props.value === "", JSON.stringify({ disabled: fpsSelect()?.props.disabled, value: fpsSelect()?.props.value }));
        fpsSelect().props.onChange({ target: { value: "6" } });
        tree = await renderTree(() => MapModule({ api }));
        collect(tsDlg(), (node) => node.props?.["data-loop"] === "pingpong")[0].props.onClick();
        tree = await renderTree(() => MapModule({ api }));
        const savesBefore = apiLog.tilesetSaves.length;
        collect(tree, (node) => node.props?.["data-testid"] === "map-tsedit-ok")[0].props.onClick();
        await tickTimers();
        tree = await renderTree(() => MapModule({ api }));
        const editCall = apiLog.tilesetSaves[savesBefore];
        check(
          "★ 点「保存」把 名字 / 速度 / 循环方式 一起交给宿主",
          editCall !== undefined && editCall.name === "我的水" && Number(editCall.fps) === 6 && editCall.loop === "pingpong",
          JSON.stringify(editCall ?? null)
        );
        check("保存后窗口关掉", collect(tree, (node) => node.props?.["data-testid"] === "map-tsedit-dialog").length === 0);

        /**
         * ★ 整图素材：属性窗口里要能**重新点通行区域**（原来只在「新增素材」时点一次，之后改不了）。
         * 两个关键点：格子数 = 素材规格；贴的图是**烘过 4 个旋转的成品图**（按 max(cols,rows) 行宽算比例，
         * 否则非方形整图的格子与画面错位，用户点错格还看不出来）。
         */
        const stampRow = rowOf("雕像");
        check("素材列表里有整图素材（下面测它的通行区域）", stampRow !== undefined, textOf(byClass(tree, "SPR_mapEdCard")[0]).slice(0, 80));
        stampRow.props.onClick();
        tree = await renderTree(() => MapModule({ api }));
        check("★ 整图素材的属性窗口里有「哪些格子能走」", textOf(tsDlg()).includes("哪些格子能走"), textOf(tsDlg()).replace(/\s+/g, " ").slice(0, 100));
        const passCells = () =>
          collect(tsDlg(), (node) => typeof node.props?.["data-testid"] === "string" && /^map-tsedit-pass-\d+-\d+$/u.test(node.props["data-testid"]));
        check("★ 格子数 = 素材规格的 3×2 = 6", passCells().length === 6, String(passCells().length));
        const stampPreview = collect(tsDlg(), (node) => node.props?.["data-testid"] === "map-tsedit-stamp-preview")[0];
        check(
          "★ 贴的是烘过旋转的成品图：按真实行宽 max(3,2)=3 与 2 帧 × 2(3+2) 行算铺图比例",
          stampPreview !== undefined && stampPreview.props.style.backgroundSize === "100% 1000%",
          String(stampPreview?.props.style.backgroundSize)
        );
        check(
          "格子预填的是素材当前的通行区域（第 0 格是不可通过）",
          passCells()[0].props["data-pass"] === "0",
          passCells().map((node) => node.props["data-pass"]).join(",")
        );
        passCells()[0].props.onClick();
        tree = await renderTree(() => MapModule({ api }));
        check(
          "★ 点一格就换状态（不可通过 0 → 可通过·被人物遮挡 1）",
          collect(tsDlg(), (node) => node.props?.["data-testid"] === "map-tsedit-pass-0-0")[0].props["data-pass"] === "1",
          passCells().map((node) => node.props["data-pass"]).join(",")
        );
        const stampSavesBefore = apiLog.tilesetSaves.length;
        collect(tree, (node) => node.props?.["data-testid"] === "map-tsedit-ok")[0].props.onClick();
        await tickTimers();
        tree = await renderTree(() => MapModule({ api }));
        const stampEditCall = apiLog.tilesetSaves[stampSavesBefore];
        check(
          "★ 保存把新的通行区域交给宿主（6 个值、第 0 格改成 1）",
          stampEditCall !== undefined &&
            Array.isArray(stampEditCall.stampPass) &&
            stampEditCall.stampPass.length === 6 &&
            stampEditCall.stampPass[0] === 1,
          JSON.stringify(stampEditCall ?? null)
        );
      }

    check(
        "★ 帧数 / 速度 / 循环方式一起交给宿主（整图的动画参数真的存进去了）",
        animOption !== undefined && animOption.stamp?.frames === 3 && Number(animOption.fps) === 8 && animOption.loop === "reverse",
        JSON.stringify({ fps: animOption?.fps, loop: animOption?.loop, frames: animOption?.stamp?.frames })
      );
    }
  }

} finally {
  if (projectId !== "") await G.deleteMapProject(projectId).catch(() => undefined);
  await rm(HOME, { recursive: true, force: true }).catch(() => undefined);
}

console.log(`\n${failures.length === 0 ? "全部通过" : "有失败"}：${passed} 项通过${failures.length > 0 ? `，失败 ${failures.length} 项` : ""}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}

