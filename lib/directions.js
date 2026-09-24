/**
 * 八方向定义与默认提示词。
 *
 * ── 方位约定 ──────────────────────────────────────────────────────────────
 * 这是 RPG 地图上的八方向行走，不是「抬头 / 低头」。约定画面上方为北：
 *
 *   N  北  = 屏幕上方  = 背对镜头，看不到脸
 *   NE 东北 = 屏幕右上  = 四分之三背面，看不到脸
 *   E  东  = 屏幕右侧  = 右侧脸
 *   SE 东南 = 屏幕右下  = 四分之三正面，看得见脸
 *   S  南  = 屏幕下方  = 正对镜头，完整正脸
 *   SW 西南 = 屏幕左下  = 四分之三正面，看得见脸
 *   W  西  = 屏幕左侧  = 左侧脸
 *   NW 西北 = 屏幕左上  = 四分之三背面，看不到脸
 *
 * 「看不见脸 / 侧脸 / 看得见脸」完全由 Y 轴朝向决定：朝北（屏幕上方）走就是
 * 背对镜头。提示词必须把**转身**和**视线**分开写——只说「朝左上方」时模型
 * 经常理解成抬头仰视，这是上一版提示词的毛病。
 *
 * ── 生成顺序 ──────────────────────────────────────────────────────────────
 * DIRECTIONS 的数组顺序 = 生成顺序（依赖顺序），同层内可并发：
 *   1. front   ← 源图
 *   2. back    ← front
 *   3. downLeft / downRight   ← front
 *   4. upLeft / upRight       ← back
 *   5. left / right           ← front + back
 */
export const DIRECTIONS = [
    {
        key: "front",
        compass: "S",
        label: "南 · 正对镜头",
        facing: "角色向正南行走（约定：画面上方为北、下方为南），正面朝着镜头迎面走来。",
        visibility: "完整正脸：双眼、鼻子、嘴全部清晰可见，视线水平看向镜头。身体正对镜头，不要侧身。",
        refs: ["source"]
    },
    {
        key: "back",
        compass: "N",
        label: "北 · 背对镜头",
        facing: "角色向正北行走（画面上方为北），背对镜头向画面深处走去。",
        visibility: "完全看不到脸：镜头拍到的是**正背面**——后脑勺、头发后侧与平整的后背。不得出现眼睛、鼻子、嘴或任何五官。也不要侧身。",
        refs: ["front"]
    },
    {
        key: "downLeft",
        compass: "SW",
        label: "西南 · 四分之三正面",
        facing: "角色向西南行走（约定：画面左下方为西南），身体绕竖轴转向镜头的左前方约 45 度。",
        visibility: "能看到正脸，但脸和身体一起明显转向画面左侧约 45 度（四分之三正面）：双眼都可见，右耳比左耳更靠近镜头，鼻尖指向画面左下。不要正对镜头。",
        refs: ["front"]
    },
    {
        key: "downRight",
        compass: "SE",
        label: "东南 · 四分之三正面",
        facing: "角色向东南行走（约定：画面右下方为东南），身体绕竖轴转向镜头的右前方约 45 度。",
        visibility: "能看到正脸，但脸和身体一起明显转向画面右侧约 45 度（四分之三正面）：双眼都可见，左耳比右耳更靠近镜头，鼻尖指向画面右下。不要正对镜头。",
        refs: ["front"]
    },
    {
        key: "upLeft",
        compass: "NW",
        label: "西北 · 四分之三背面",
        facing: "角色向西北行走（画面左上方为西北），背对镜头，身体绕竖轴转开约 45 度。",
        visibility: "完全看不到脸：只看到后脑勺、头发后侧，以及后背偏左的一侧（身体绕竖轴侧转约 45 度，不是正背面）。不得出现眼睛、鼻子、嘴或任何五官。",
        refs: ["back"]
    },
    {
        key: "upRight",
        compass: "NE",
        label: "东北 · 四分之三背面",
        facing: "角色向东北行走（画面右上方为东北），背对镜头，身体绕竖轴转开约 45 度。",
        visibility: "完全看不到脸：只看到后脑勺、头发后侧，以及后背偏右的一侧（身体绕竖轴侧转约 45 度，不是正背面）。不得出现眼睛、鼻子、嘴或任何五官。",
        refs: ["back"]
    },
    {
        key: "left",
        compass: "W",
        label: "西 · 左侧脸",
        facing: "角色向正西行走（约定：画面左侧为西），朝画面左侧行走。",
        visibility: "镜头拍到的是角色的左侧面：身体完全侧对镜头，两只肩膀一前一后、连线与画面垂直，鼻尖指向画面左侧，视线与画面平行、不看镜头。只能看到左半边侧脸——左眼的侧面轮廓、鼻梁侧影、左半边嘴；看不到右眼，右半边脸被头部完全挡住。不要正对镜头，也不要背对镜头。",
        refs: ["front", "back"]
    },
    {
        key: "right",
        compass: "E",
        label: "东 · 右侧脸",
        facing: "角色向正东行走（约定：画面右侧为东），朝画面右侧行走。",
        visibility: "镜头拍到的是角色的右侧面：身体完全侧对镜头，两只肩膀一前一后、连线与画面垂直，鼻尖指向画面右侧，视线与画面平行、不看镜头。只能看到右半边侧脸——右眼的侧面轮廓、鼻梁侧影、右半边嘴；看不到左眼，左半边脸被头部完全挡住。不要正对镜头，也不要背对镜头。",
        refs: ["front", "back"]
    }
];
export const DIRECTION_KEYS = DIRECTIONS.map((d) => d.key);
export function directionOf(key) {
    return DIRECTIONS.find((d) => d.key === key);
}
/** 罗盘顺时针顺序，用于整图行序。 */
export const COMPASS_ORDER = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** 默认整图行序：北 → 东北 → 东 → 东南 → 南 → 西南 → 西 → 西北（罗盘顺时针）。 */
export const DEFAULT_ROW_ORDER = COMPASS_ORDER.map((compass) => DIRECTIONS.find((direction) => direction.compass === compass)?.key ?? "").filter((key) => key !== "");
/**
 * 生图提示词模板。
 *
 * `{facing}` 只描述**转身**（角色朝哪个方位走），`{visibility}` 描述**镜头看到什么**。
 * 两者必须分开写：合成一句时，模型会把「朝画面左上方」理解成抬头仰视。
 */
export const DEFAULT_IMAGE_PROMPT = [
    "【机位】固定正对角色的摄像机，镜头与角色胸口齐平，不俯视也不仰视。角色直立站在地面上，双脚着地。",
    "【转身方式】角色只绕自身竖直轴转身来改变面朝的方向，身体始终保持直立。严格禁止抬头、低头、仰视、俯视、弯腰、后仰或身体倾斜；视线始终水平，既不向上看也不向下看。",
    "【一致性】以下所有图都是同一个角色在原地绕竖轴转身得到的，身高、体型、脸型、发型、服装、配色必须完全一致，只有身体朝向不同。",
    "【主体】把参考图中的人物当作唯一主体，完整保留其五官、发型、发色、服装款式、配色和整体画风，必须看起来是同一个人。",
    "【朝向】{facing}",
    "【可见部位】{visibility}",
    "【画风】平涂赛璐璐上色，色块边界清晰，避免写实光影、渐变、景深与噪点。",
    "【背景】纯色绿幕，颜色是标准 chroma key 绿 #00FF00，整幅背景颜色完全均匀一致，不要任何阴影、渐变或噪点。",
    "【硬性要求】背景必须绝对纯净：不要地面、不要投影、不要文字、不要边框、不要棋盘格、不要任何道具或装饰。人物是画面中唯一对象，尽量占满画面高度（约 80%），全身完整居中且不裁切、不被遮挡。"
].join("\n");
// ── 转圈截帧（「八方向绿幕图」的默认生成方式）──────────────────────────────
//
// 思路和「逐方向生图」相反：**一次生成、多次截取**。
// 逐方向生图是八次独立的 Seedream 调用，模型每次都要「重新理解」角色，
// 于是脸型、发色、服装细节常常在八个方向之间漂移；转圈模式只让视频模型
// 绕竖轴转一圈，八个方向出自**同一段视频**，一致性天然成立——
// 代价是分辨率取决于视频（默认 768P/2K，够做精灵图）与转速是否均匀。
//
// 转圈模式下八个方向不再「逐个生成」，而是落在时间轴上的八个截帧位置：
// 界面用一条轴 + 八个可拖动的圆圈来调，宿主按 picks 把那八帧写成
// `images/<方向>.png`——下游（行走视频 / 抽帧 / 整图）完全不必知道这件事。
/**
 * 转圈视频提示词模板（MiniMax 图生视频，八方向共用一段）。
 *
 * 三条硬要求，缺一条这个模式就不成立：
 *   1. **起始姿态 = 参考图**（否则第一帧就不是角色正面，整圈都对不上）；
 *   2. **转速均匀 + 转满一整圈**（否则八个方向在时间轴上不是等分的，
 *      默认的截帧位置会整体偏掉）；
 *   3. **除旋转外不许有任何动作**（走路 / 摆手都会让某一帧的姿势和别的不一致）。
 */
export const DEFAULT_TURN_PROMPT = [
    "[固定机位] 固定机位、固定焦距、固定构图，镜头完全静止不动，镜头高度与角色胸口齐平，不俯视也不仰视。绿幕背景保持原样不变。",
    "[起始姿态] 画面开始时角色必须就是参考图里的样子：正面站姿面对镜头，双脚着地，双臂自然垂下，完整保留参考图的五官、发型、发色、服装款式、配色与整体画风，必须看起来是同一个人。",
    "[动作] 画面中只有这一个角色，角色原地绕自身竖直轴以完全均匀的速度旋转满一整圈（360 度），转速从头到尾不变，最后回到与开始时完全相同的朝向，首尾能够无缝接上。",
    "[禁止其它动作] 除了绕竖轴旋转，不要有任何动作：不要行走、不要迈步、不要摆手、不要抬手、不要点头；身体始终保持直立站姿，不要抬头、低头、弯腰、后仰、下蹲或跳动。",
    "[一致性] 旋转过程中身高、体型、脸型、发型、服装、配色与画风必须完全一致，只有身体朝向在变化。",
    "[背景] 纯色绿幕，颜色是标准 chroma key 绿 #00FF00，整幅背景颜色完全均匀一致，全程保持纯绿，不要任何阴影、渐变、地面或投影。",
    "[画面] 角色始终完整居中在画面内、不被裁切；不要出现第二个人或任何其它物体，不出现转场、抖动、缩放、运镜或镜头移动。"
].join("\n");
/**
 * 顺时针（俯视）转圈时，镜头依次看到的朝向：
 * 正南（正面）→ 西南 → 西 → 西北 → 正北（背面）→ 东北 → 东 → 东南。
 *
 * 换算方式：屏幕左下方是西南、左方是西……也就是「脸先转向画面左侧」。
 * 另一圈方向（逆时针）把这串反过来。默认位置按这个顺序等分时间轴；
 * 模型实际往哪边转不确定，所以界面上两个圆圈随时可以拖。
 */
export const TURN_ORDER_CW = ["front", "downLeft", "left", "upLeft", "back", "upRight", "right", "downRight"];
export const TURN_ORDER_CCW = ["front", "downRight", "right", "upRight", "back", "upLeft", "left", "downLeft"];
/** 默认转圈方向（见 TurnDirection 的注释）。 */
export const TURN_DIRECTION_DEFAULT = "ccw";
export function turnOrder(direction) {
    return direction === "ccw" ? [...TURN_ORDER_CCW] : [...TURN_ORDER_CW];
}
/** 候选帧数的默认值（也是可调范围）。转一整圈均分：32 帧 ≈ 每帧 11.25°。 */
export const TURN_FRAME_COUNT_DEFAULT = 32;
export const TURN_FRAME_COUNT_MIN = 8;
export const TURN_FRAME_COUNT_MAX = 64;
/**
 * 默认的八个截帧位置：把整圈（候选帧 0…frameCount-1）均分成八份，
 * 第 k 个方向取第 k 份的起点。轴上的圆圈就是这个下标，拖动即改。
 */
export function defaultTurnPicks(frameCount, direction = TURN_DIRECTION_DEFAULT) {
    const count = Math.max(TURN_FRAME_COUNT_MIN, Math.round(frameCount));
    const order = turnOrder(direction);
    const picks = {};
    order.forEach((key, index) => {
        picks[key] = Math.min(count - 1, Math.round((index * count) / order.length));
    });
    return picks;
}
/**
 * 视频提示词模板（MiniMax 图生视频）。
 * 同样要防俯仰：视频模型也会把「朝上」理解成抬头。
 */
export const DEFAULT_VIDEO_PROMPT = [
    "[Static shot] 固定机位、固定焦距、固定构图，镜头完全静止不动，镜头高度与角色胸口齐平，不俯视也不仰视。绿幕背景保持原样不变。",
    "画面中只有这一个角色，保持图中的朝向和位置不变——不要转身、不要改变面朝的方向。原地做出自然的行走动作：双腿交替迈步，手臂自然摆动，完整走三步。",
    "行走过程中身体保持直立，视线始终水平，不要抬头、低头或身体起伏变形。",
    "保持平涂色块和干净的绿幕，不要补充纹理、光影或背景细节。",
    "不要走出画面、不要出现第二个人或任何其它物体，不出现转场、抖动、缩放、运镜或镜头移动。"
].join("\n");
/** 把模板里的两个占位符换成具体方向的描述。 */
export function fillImagePrompt(template, facing, visibility) {
    return template.replace(/\{facing\}/g, facing).replace(/\{visibility\}/g, visibility);
}
/** 把八方向默认提示词装配成一张表（每个方向一份，可单独编辑）。 */
export function defaultImagePrompts() {
    const out = {};
    for (const direction of DIRECTIONS) {
        out[direction.key] = fillImagePrompt(DEFAULT_IMAGE_PROMPT, direction.facing, direction.visibility);
    }
    return out;
}
