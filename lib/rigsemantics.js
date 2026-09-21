/**
 * 骨骼动画的**部件语义层**（纯计算，不碰文件系统）。
 *
 * v1 把「第几个格子 = 哪个部件」当成确定事实：分割时按网格给名字，装配按名字查
 * 固定表推父级与锚点（`spine.ts` 的 `RIG_SLOTS`）。规则简单、可复现，但有两个代价：
 *
 *   1. 生图模型一不按网格摆，整条链就失效，只能告警 + 让用户重新生成
 *      （见 `riggen.ts` 的 `missing >= 40%` 分支）；
 *   2. 非标准角色（兽耳、尾巴、裙摆、武器、多肢体）没有任何表达位置——表外的名字
 *      只能靠关键词瞎猜宿主（`parentBoneOf`）。
 *
 * 所以 v2 把「语义」从**隐含的网格约定**提成**显式数据**：每个部件带一组
 * `{role, parent, proximal, distal, tags}`，它既是装配与骨骼推导的输入，
 * 也是 AI 可以提案、人可以修改、脚本可以校验的对象。
 *
 * 这一层的设计原则：
 *   - **纯函数、无 I/O**：方便单测，也方便被宿主与客户端同时使用；
 *   - **校验失败不抛异常，而是返回诊断**：UI 需要把「哪一条不合法、为什么」
 *     展示给用户，而不是让整个保存动作失败；
 *   - **可降级**：没给语义时，用默认人形表 + 关键词启发式补齐，
 *     所以 v1 的历史任务与「直接上传部件 PNG」的路径都不需要用户先填表。
 */
// ── 语义角色 ────────────────────────────────────────────────────────────
/**
 * 角色枚举。刻意比「部位名」宽一档：`accessory` / `prop` / `weapon` / `hair` /
 * `cloth` 这类没有固定解剖位置的部件，靠 `parent` 决定挂在谁身上。
 */
export const RIG_ROLES = [
    "head",
    "neck",
    "torso",
    "hip",
    "upperArm",
    "lowerArm",
    "hand",
    "upperLeg",
    "lowerLeg",
    "foot",
    "hair",
    "cloth",
    "accessory",
    "weapon"
];
const ROLE_SET = new Set(RIG_ROLES);
export function isRigRole(value) {
    return typeof value === "string" && ROLE_SET.has(value);
}
/** 角色的中文名，界面与验收包都用它。 */
export const ROLE_LABELS = {
    head: "头部",
    neck: "脖子",
    torso: "躯干",
    hip: "胯部",
    upperArm: "上臂",
    lowerArm: "小臂",
    hand: "手",
    upperLeg: "大腿",
    lowerLeg: "小腿",
    foot: "脚",
    hair: "头发",
    cloth: "衣料",
    accessory: "配饰",
    weapon: "武器"
};
/**
 * 角色的**英文名词**，给生图提示词用。
 *
 * 为什么需要它：给模型的提示词里必须有一个**具体的主语**。实测过一次很有代表性
 * 的失败——提示词里最具体的一句是「flat clean background of a single solid colour」，
 * 于是模型就真的交回一张纯色图（补边是白底就返回白、改灰底就返回灰）。
 * 说清「这是一只手」比反复强调整体约束有用得多，而这个信息语义层本来就有。
 */
export const ROLE_NOUNS = {
    head: "head",
    neck: "neck",
    torso: "torso",
    hip: "hip / pelvis",
    upperArm: "upper arm",
    lowerArm: "lower arm (forearm)",
    hand: "hand",
    upperLeg: "upper leg (thigh)",
    lowerLeg: "lower leg (shin)",
    foot: "foot",
    hair: "lock of hair",
    cloth: "piece of clothing",
    accessory: "accessory",
    weapon: "weapon"
};
/**
 * 每个角色的**默认锚点**（归一化到部件包围盒，x 向右、y **向下**）。
 *
 * 语义：`proximal` 是「近端」——骨骼的原点落在这里，也是它绕着自己转的那一点；
 * `distal` 是「远端」，骨骼朝向 = 近端 → 远端。
 * 四肢取「上端为近端」（上臂的肩、大腿的胯），躯干链取「下端为近端」（头挂在脖子上）。
 */
export const ROLE_ANCHORS = {
    head: { proximal: [0.5, 1], distal: [0.5, 0] },
    neck: { proximal: [0.5, 1], distal: [0.5, 0] },
    torso: { proximal: [0.5, 1], distal: [0.5, 0] },
    hip: { proximal: [0.5, 1], distal: [0.5, 0] },
    upperArm: { proximal: [0.5, 0], distal: [0.5, 1] },
    lowerArm: { proximal: [0.5, 0], distal: [0.5, 1] },
    hand: { proximal: [0.5, 0], distal: [0.5, 1] },
    upperLeg: { proximal: [0.5, 0], distal: [0.5, 1] },
    lowerLeg: { proximal: [0.5, 0], distal: [0.5, 1] },
    foot: { proximal: [0.5, 0], distal: [0.5, 1] },
    // 头发/衣料通常从根部往下（或往后）延伸；配饰与武器整体朝上，绕底边中点转。
    hair: { proximal: [0.5, 0], distal: [0.5, 1] },
    cloth: { proximal: [0.5, 0], distal: [0.5, 1] },
    accessory: { proximal: [0.5, 1], distal: [0.5, 0] },
    weapon: { proximal: [0.5, 1], distal: [0.5, 0] }
};
/**
 * 每个角色的**默认父级角色**（不是骨骼名——骨骼名要等具体部件名确定后才知道）。
 * `undefined` 表示直接挂在 root 下。
 */
export const ROLE_PARENT_ROLE = {
    head: "neck",
    neck: "torso",
    torso: "hip",
    hip: undefined,
    upperArm: "torso",
    lowerArm: "upperArm",
    hand: "lowerArm",
    upperLeg: "hip",
    lowerLeg: "upperLeg",
    foot: "lowerLeg",
    hair: "head",
    cloth: "torso",
    accessory: "torso",
    weapon: "torso"
};
export function isFinitePair(value) {
    return (Array.isArray(value) &&
        value.length === 2 &&
        Number.isFinite(value[0]) &&
        Number.isFinite(value[1]));
}
function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}
function normalizePair(value, fallback) {
    if (!isFinitePair(value))
        return [fallback[0], fallback[1]];
    return [clamp01(Number(value[0])), clamp01(Number(value[1]))];
}
// ── 从部件名推断语义（兜底路径）────────────────────────────────────────
/**
 * 关键词 → 角色。用于两条路径：
 *   ① v1 历史任务的迁移（只有名字，没有语义）；
 *   ② 用户直接上传部件 PNG（文件名即部件名）。
 *
 * 顺序很重要：先匹配更具体的词（`forearm` 先于 `arm`），否则「左小臂」会被
 * 「上臂」的规则抢走。
 */
const ROLE_KEYWORDS = [
    ["lowerArm", ["lower-arm", "lowerarm", "forearm", "小臂", "前臂"]],
    ["upperArm", ["upper-arm", "upperarm", "上臂", "大臂"]],
    ["lowerLeg", ["lower-leg", "lowerleg", "calf", "shin", "小腿"]],
    ["upperLeg", ["upper-leg", "upperleg", "thigh", "大腿"]],
    ["hand", ["hand", "wrist", "手"]],
    ["foot", ["foot", "feet", "ankle", "脚", "足"]],
    ["head", ["head", "face", "头", "脸"]],
    ["neck", ["neck", "脖", "颈"]],
    ["torso", ["torso", "chest", "body", "trunk", "躯干", "身体", "胸"]],
    ["hip", ["hip", "pelvis", "waist", "胯", "臀", "腰"]],
    ["hair", ["hair", "ponytail", "bangs", "发", "辫"]],
    ["weapon", ["weapon", "sword", "blade", "bow", "gun", "staff", "wand", "刀", "剑", "弓", "杖", "枪"]],
    ["cloth", ["skirt", "cape", "cloak", "sleeve", "dress", "coat", "裙", "披风", "袖", "衣"]],
    ["accessory", ["hat", "cap", "helmet", "horn", "ear", "eye", "tail", "wing", "belt", "scarf", "帽", "盔", "角", "耳", "眼", "尾", "翅", "带", "围巾", "饰"]]
];
/** 从部件名猜角色。猜不到就是 `accessory`——比瞎猜成某个解剖部位安全。 */
export function roleOfName(name) {
    const lower = name.toLowerCase();
    for (const [role, keys] of ROLE_KEYWORDS) {
        if (keys.some((key) => lower.includes(key)))
            return role;
    }
    return "accessory";
}
/**
 * 从「部件名 → 角色」的映射推出父级**部件名**。
 *
 * 与 v1 的 `parentBoneOf`（`spine.ts`）的区别：v1 是「按名字猜父级名字」，
 * 这里多一层「角色 → 角色」的映射，因此能正确处理 `left-lower-arm` 这种
 * 名字里既有 `left` 又有 `arm` 的情况，也能让用户改角色后自动重算父级。
 *
 * **理想父级角色不存在时会沿角色链向上退**：例如「裙摆」的理想父级是躯干，
 * 但一个只有「头 + 裙摆 + 胯」的集合里没有躯干，此时退到胯（`torso → hip`）。
 * 这条兜底是必要的——v1 的注释就写过「猜不到就挂到躯干上，总比散落一地强」；
 * 没有它，任何理想父级缺席的部件都会掉到 root，看起来就是「飘着」。
 *
 * 返回 `undefined` 表示挂 root（整条角色链都不存在）。
 */
export function parentNameOf(name, roleByName) {
    const role = roleByName.get(name) ?? roleOfName(name);
    const side = sideOfName(name);
    // 沿「角色 → 它的父角色」向上找第一个真实存在的角色。
    // `visited` 只是为了防御性 —— ROLE_PARENT_ROLE 本身是无环的。
    const visited = new Set();
    let parentRole = ROLE_PARENT_ROLE[role];
    while (parentRole !== undefined && !visited.has(parentRole)) {
        visited.add(parentRole);
        const candidates = [...roleByName.entries()].filter(([other, otherRole]) => other !== name && otherRole === parentRole);
        if (candidates.length > 0) {
            // 优先同侧：左小臂的父级应该是左上臂，不是右上臂。
            if (candidates.length === 1)
                return candidates[0][0];
            if (side !== "") {
                const sameSide = candidates.find(([other]) => sideOfName(other) === side);
                if (sameSide !== undefined)
                    return sameSide[0];
            }
            // 同侧也分不出来时按名字排序取第一个，保证结果确定（同样的输入永远同样的输出）。
            return candidates.map(([other]) => other).sort()[0];
        }
        parentRole = ROLE_PARENT_ROLE[parentRole];
    }
    return undefined;
}
/** 从部件名抽出左右侧；没有侧别信息返回空串。 */
export function sideOfName(name) {
    const lower = name.toLowerCase();
    if (lower.includes("left") || name.includes("左"))
        return "left";
    if (lower.includes("right") || name.includes("右"))
        return "right";
    return "";
}
/**
 * 给一批部件名生成**默认语义**（角色、父级、锚点、标签）。
 *
 * 这是「不填表也能跑」的保证：AI 不需要出手、用户不需要动手，也能得到一份
 * 结构上说得通的语义表；AI 或人之后只需要改**不对的那几条**。
 */
export function defaultSemanticsOf(names) {
    const roleByName = new Map();
    for (const name of names)
        roleByName.set(name, roleOfName(name));
    return names.map((name) => {
        const role = roleByName.get(name);
        const anchors = ROLE_ANCHORS[role];
        const tags = new Set([role]);
        const side = sideOfName(name);
        if (side !== "")
            tags.add(side);
        return {
            name,
            role,
            parent: parentNameOf(name, roleByName),
            proximal: [anchors.proximal[0], anchors.proximal[1]],
            distal: [anchors.distal[0], anchors.distal[1]],
            tags: [...tags],
            source: "default"
        };
    });
}
/**
 * 校验并归一化一份语义表。
 *
 * **永远返回可用的 `parts`**：把非法字段就地修成安全值并记一条 issue，
 * 而不是整体拒绝。理由是这一层的用户是「正在用界面调参数的人」——
 * 他要看到的是「哪个部件、哪个字段、为什么不合法」，而不是一个保存失败的红点。
 *
 * error 与 warning 的分界：
 *   - **error**：会让下游（骨骼推导 / 导出）产生**错误结果**的问题，
 *     例如父级成环、父级不存在、角色未知；
 *   - **warning**：能跑但很可能不符合预期，例如锚点退化（近端 = 远端，
 *     骨骼长度为 0）、左右镜像缺失、人形结构可疑。
 */
export function validateSemantics(input, options = {}) {
    const errors = [];
    const warnings = [];
    // ① 名字唯一且非空。
    const seen = new Set();
    const unique = [];
    for (const raw of input) {
        const name = typeof raw.name === "string" ? raw.name.trim() : "";
        if (name === "") {
            errors.push({ name: "", level: "error", message: "存在没有名字的部件" });
            continue;
        }
        if (seen.has(name)) {
            errors.push({ name, level: "error", message: `部件名重复：${name}` });
            continue;
        }
        seen.add(name);
        unique.push({ ...raw, name });
    }
    const nameSet = new Set(unique.map((item) => item.name));
    // ② 角色与锚点。
    const parts = unique.map((raw) => {
        let role;
        if (isRigRole(raw.role)) {
            role = raw.role;
        }
        else {
            role = roleOfName(raw.name);
            if (raw.role !== undefined) {
                errors.push({ name: raw.name, level: "error", message: `未知的角色「${String(raw.role)}」，已按名字推断为「${role}」` });
            }
        }
        const fallback = ROLE_ANCHORS[role];
        const proximal = normalizePair(raw.proximal, fallback.proximal);
        const distal = normalizePair(raw.distal, fallback.distal);
        // 锚点退化会让骨骼长度为 0，方向也失去意义——自动推开一点点并告警。
        if (Math.abs(proximal[0] - distal[0]) < 1e-6 && Math.abs(proximal[1] - distal[1]) < 1e-6) {
            warnings.push({ name: raw.name, level: "warning", message: "近端与远端锚点重合，骨骼长度为 0；已按角色默认锚点纠正" });
            proximal[0] = fallback.proximal[0];
            proximal[1] = fallback.proximal[1];
            distal[0] = fallback.distal[0];
            distal[1] = fallback.distal[1];
        }
        const tags = Array.isArray(raw.tags)
            ? [...new Set(raw.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()))]
            : [];
        const source = raw.source === "ai" || raw.source === "human" ? raw.source : "default";
        return { name: raw.name, role, parent: typeof raw.parent === "string" && raw.parent.trim() !== "" ? raw.parent.trim() : undefined, proximal, distal, tags, source };
    });
    // ③ 父级存在性与自环。
    for (const part of parts) {
        if (part.parent === undefined)
            continue;
        if (part.parent === part.name) {
            errors.push({ name: part.name, level: "error", message: "父级指向自己" });
            part.parent = undefined;
            continue;
        }
        if (!nameSet.has(part.parent)) {
            errors.push({ name: part.name, level: "error", message: `父级「${part.parent}」不存在` });
            part.parent = undefined;
        }
    }
    // ④ 成环检测：沿 parent 链走，走到自己就是环。
    //    成环的骨骼表在渲染时会无限递归，必须在写入前拦住（v1 只在推导时兜底）。
    const byName = new Map(parts.map((part) => [part.name, part]));
    for (const part of parts) {
        const path = new Set([part.name]);
        let cursor = part.parent;
        while (cursor !== undefined) {
            if (path.has(cursor)) {
                errors.push({ name: part.name, level: "error", message: `父级链成环：${[...path].join(" → ")} → ${cursor}；已改挂 root` });
                part.parent = undefined;
                break;
            }
            path.add(cursor);
            cursor = byName.get(cursor)?.parent;
        }
    }
    // ⑤ 人形结构自洽：只有在「看起来是人形」时才检查，否则会误伤四足/机械角色。
    const humanoid = options.humanoid ?? parts.some((part) => part.role === "head");
    if (humanoid) {
        const has = (role) => parts.some((part) => part.role === role);
        if (!has("head"))
            warnings.push({ name: "", level: "warning", message: "判定为人形，但没有角色为「头部」的部件" });
        if (!has("torso") && !has("hip"))
            warnings.push({ name: "", level: "warning", message: "判定为人形，但没有躯干或胯部，骨骼会以 root 为中心" });
        // 头的祖先链**不能经过肢体**——「头挂在腿上」是最典型的语义/装配错误，
        // 也正是 v1 只能靠几何（比 y 大小）事后发现的那一类问题。
        //
        // 注意不要写成「祖先链必须包含 neck/torso/hip」：那会把「头 → 躯干 →
        // 胯」这种完全正常的极简骨架误判（它的链就是 torso → hip）。真正要拦的是
        // **肢体**出现在头的上方。
        const LIMB_ROLES = ["upperArm", "lowerArm", "hand", "upperLeg", "lowerLeg", "foot"];
        for (const part of parts.filter((item) => item.role === "head")) {
            const chain = [];
            let cursor = part.parent;
            let guard = 0;
            while (cursor !== undefined && guard++ < 64) {
                const parent = byName.get(cursor);
                if (parent === undefined)
                    break;
                chain.push(parent.role);
                cursor = parent.parent;
            }
            const limb = chain.find((role) => LIMB_ROLES.includes(role));
            if (limb !== undefined) {
                warnings.push({ name: part.name, level: "warning", message: `「头部」的祖先链经过肢体（${chain.join(" → ")}），结构可疑` });
            }
        }
        // 左右镜像：人形角色的成对部件应该左右都在，少一边通常意味着分割丢了东西。
        for (const role of ["upperArm", "lowerArm", "hand", "upperLeg", "lowerLeg", "foot"]) {
            const sides = new Set(parts.filter((part) => part.role === role).map((part) => sideOfName(part.name)));
            if (sides.has("left") && !sides.has("right"))
                warnings.push({ name: "", level: "warning", message: `有左侧${ROLE_LABELS[role]}但没有右侧` });
            if (sides.has("right") && !sides.has("left"))
                warnings.push({ name: "", level: "warning", message: `有右侧${ROLE_LABELS[role]}但没有左侧` });
        }
    }
    return { ok: errors.length === 0, errors, warnings, parts };
}
/**
 * 把「局部语义补丁」合并进现有语义表。
 *
 * 只改传进来的字段——这是 §4.4 细粒度失效传播的前提：改一个部件的 `parent`
 * 不应该让整份语义表重新生成，也不应该丢掉别人改过的锚点。
 */
export function mergeSemantics(current, patches) {
    const byName = new Map(current.map((part) => [part.name, { ...part }]));
    for (const patch of patches) {
        const base = byName.get(patch.name);
        if (base === undefined) {
            // 新部件（例如 AI 建议把一条长发拆成 3 节）：用默认语义起头再套补丁。
            const fresh = defaultSemanticsOf([patch.name])[0];
            byName.set(patch.name, { ...fresh, ...patch });
            continue;
        }
        byName.set(patch.name, { ...base, ...patch, name: patch.name });
    }
    return [...byName.values()];
}
