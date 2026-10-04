# 调研（research/）

这里放**技术可行性调研**：为某个准备加入插件的新功能，先做实验把"能不能做、怎么做才稳"问清楚，
再据此写产品文档与开发计划。

与 `docs/` 的分工：

| 目录 | 放什么 | 面向 |
|---|---|---|
| `docs/` | 产品文档、开发计划、工程文档 | **要做什么、怎么做** |
| `research/` | 调研报告、实验脚本、原始数据、交付样张 | **为什么这么做**（证据与踩坑） |

调研的结论会被写进 `docs/`；`docs/` 的结论如果被推翻，回这里查当时的证据。

---

## 任务清单

| 任务 | 报告 | 结论 | 对应文档 |
|---|---|---|---|
| **45° 等距地图地块生成** | [tile-isometric/tile-isometric-research-report.md](tile-isometric/tile-isometric-research-report.md) | ✅ 可行。核心是「几何交给代码、内容交给 AI」：纯文生图达标率 0%，模板填充 100% | [产品文档](../docs/地图地块生成-产品文档.md) · [开发计划](../docs/地图地块生成-开发计划.md) |

---

## 目录约定

每个调研任务一个文件夹，命名为 `research/<英文短横线名>/`：

```
research/
  README.md                     ← 本文件：任务索引 + 约定
  <task>/
    <task>-research-report.md   ← 调研报告（结论、数据、踩坑、脚本清单）
    tools/                      ← 实验脚本（算法参考实现，可复跑）
    jobs/                       ← 生成作业描述（提示词 / 参数，入库）
    out/                        ← 交付样张 + 验证图（入库）
    probe/                      ← 原始生成图（不入库，见下）
```

### 为什么 `jobs/` 和 `probe/` 分开放

- `jobs/`（几 KB 的 JSON）：**提示词与参数的原文**。这是"这次生成到底发了什么"的唯一凭证，
  必须入库 —— 报告里能引用，改动能在 diff 里看见。
- `probe/`（上百 MB 的 PNG）：模型的原始输出。可以重新生成，**但会真实计费**，所以不入库。

分开的好处是：**生成这一步也可复跑** —— 有 `jobs/` 就能重发同样的请求，
不必去报告正文里抄提示词。

`jobs/` 里不要内联 base64（比如 mask 图）：那是二进制、会让 diff 无法阅读。
用占位符 + 一个 patch 脚本在运行前替换（见 `tile-isometric` 的 `patch-mask.mjs` /
`unpatch-mask.py`）。

### 为什么 `probe/` 不入库

`probe/` 是生图模型的原始输出（每个任务动辄上百 MB 的 2K PNG）。
它们**可以重新生成，但会真实计费**，所以不放进 git。
入库的是"重新生成之后要做的事"：`tools/` 里的算法、`out/` 里的最终样张与验证图。

复跑方式写在每个任务报告的「脚本清单」一节。

### 脚本写路径的约定

任务内的脚本**一律按自身位置解析路径，不要依赖当前工作目录**：

```python
# Python
HERE = os.path.dirname(os.path.abspath(__file__))
TASK = os.path.dirname(HERE)          # research/<task>
OUT  = os.path.join(TASK, "out")
```

```js
// Node
const here = dirname(fileURLToPath(import.meta.url));
const TASK = resolve(here, "..");     // research/<task>
```

这样从仓库根、从任务目录、从任意位置跑，结果都一样。
（早期版本的 `stats.py` 用的是裸相对路径 `research/probe/...`，一旦换目录就静默产出空表。）

---

## 新增一个调研任务

1. 建 `research/<task>/`，按上面的目录约定放东西；
2. 报告文件名统一为 `<task>-research-report.md`，**不要**用 `REPORT.md` 这种通用名
   （多个任务并存时无法区分，且在各处引用时看不出是哪一份）；
3. 在本文件的任务清单里加一行；
4. 报告里要有一节「脚本清单」写清复跑方式，方便以后核对数据；
5. `probe/` 不用管 `.gitignore`，`research/*/probe/` 已经统一排除。
