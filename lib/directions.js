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
/** 把任意输入规整成提示词语言；认不出来的一律按中文。 */
export function normalizePromptLang(value) {
    return typeof value === "string" && value.trim().toLowerCase().startsWith("en") ? "en" : "zh";
}
export const DIRECTIONS = [
    {
        key: "front",
        compass: "S",
        label: "南 · 正对镜头",
        facing: "角色向正南行走（约定：画面上方为北、下方为南），正面朝着镜头迎面走来。",
        visibility: "完整正脸：双眼、鼻子、嘴全部清晰可见，视线水平看向镜头。身体正对镜头，不要侧身。",
        facingEn: "The character walks due south (convention: the top of the image is north, the bottom is south), walking straight toward the camera with the front of the body facing the lens.",
        visibilityEn: "Full front view: both eyes, nose and mouth all clearly visible, gaze horizontal and looking at the camera. The body faces the camera straight on; do not turn the body sideways.",
        refs: ["source"]
    },
    {
        key: "back",
        compass: "N",
        label: "北 · 背对镜头",
        facing: "角色向正北行走（画面上方为北），背对镜头向画面深处走去。",
        visibility: "完全看不到脸：镜头拍到的是**正背面**——后脑勺、头发后侧与平整的后背。不得出现眼睛、鼻子、嘴或任何五官。也不要侧身。",
        facingEn: "The character walks due north (the top of the image is north), walking away from the camera toward the depth of the image with its back to the lens.",
        visibilityEn: "The face is completely invisible: the camera captures a **straight back view** - the back of the head, the rear of the hair and the flat back. No eyes, nose, mouth or any facial features may appear. Do not turn the body sideways either.",
        refs: ["front"]
    },
    {
        key: "downLeft",
        compass: "SW",
        label: "西南 · 四分之三正面",
        facing: "角色向西南行走（约定：画面左下方为西南），身体绕竖轴转向镜头的左前方约 45 度。",
        visibility: "能看到正脸，但脸和身体一起明显转向画面左侧约 45 度（四分之三正面）：双眼都可见，右耳比左耳更靠近镜头，鼻尖指向画面左下。不要正对镜头。",
        facingEn: "The character walks southwest (convention: the lower-left of the image is southwest), the body rotating around the vertical axis about 45 degrees to the camera's front-left.",
        visibilityEn: "The front of the face is visible, but the face and body are both clearly turned about 45 degrees toward the left side of the image (a three-quarter front view): both eyes are visible, the right ear is closer to the camera than the left ear, and the tip of the nose points toward the lower-left of the image. Do not face the camera straight on.",
        refs: ["front"]
    },
    {
        key: "downRight",
        compass: "SE",
        label: "东南 · 四分之三正面",
        facing: "角色向东南行走（约定：画面右下方为东南），身体绕竖轴转向镜头的右前方约 45 度。",
        visibility: "能看到正脸，但脸和身体一起明显转向画面右侧约 45 度（四分之三正面）：双眼都可见，左耳比右耳更靠近镜头，鼻尖指向画面右下。不要正对镜头。",
        facingEn: "The character walks southeast (convention: the lower-right of the image is southeast), the body rotating around the vertical axis about 45 degrees to the camera's front-right.",
        visibilityEn: "The front of the face is visible, but the face and body are both clearly turned about 45 degrees toward the right side of the image (a three-quarter front view): both eyes are visible, the left ear is closer to the camera than the right ear, and the tip of the nose points toward the lower-right of the image. Do not face the camera straight on.",
        refs: ["front"]
    },
    {
        key: "upLeft",
        compass: "NW",
        label: "西北 · 四分之三背面",
        facing: "角色向西北行走（画面左上方为西北），背对镜头，身体绕竖轴转开约 45 度。",
        visibility: "完全看不到脸：只看到后脑勺、头发后侧，以及后背偏左的一侧（身体绕竖轴侧转约 45 度，不是正背面）。不得出现眼睛、鼻子、嘴或任何五官。",
        facingEn: "The character walks northwest (the upper-left of the image is northwest), with its back to the camera, the body rotated about 45 degrees around the vertical axis.",
        visibilityEn: "The face is completely invisible: only the back of the head, the rear of the hair, and the left-hand side of the back are seen (the body is turned about 45 degrees around the vertical axis, not a straight back view). No eyes, nose, mouth or any facial features may appear.",
        refs: ["back"]
    },
    {
        key: "upRight",
        compass: "NE",
        label: "东北 · 四分之三背面",
        facing: "角色向东北行走（画面右上方为东北），背对镜头，身体绕竖轴转开约 45 度。",
        visibility: "完全看不到脸：只看到后脑勺、头发后侧，以及后背偏右的一侧（身体绕竖轴侧转约 45 度，不是正背面）。不得出现眼睛、鼻子、嘴或任何五官。",
        facingEn: "The character walks northeast (the upper-right of the image is northeast), with its back to the camera, the body rotated about 45 degrees around the vertical axis.",
        visibilityEn: "The face is completely invisible: only the back of the head, the rear of the hair, and the right-hand side of the back are seen (the body is turned about 45 degrees around the vertical axis, not a straight back view). No eyes, nose, mouth or any facial features may appear.",
        refs: ["back"]
    },
    {
        key: "left",
        compass: "W",
        label: "西 · 左侧脸",
        facing: "角色向正西行走（约定：画面左侧为西），朝画面左侧行走。",
        visibility: "镜头拍到的是角色的左侧面：身体完全侧对镜头，两只肩膀一前一后、连线与画面垂直，鼻尖指向画面左侧，视线与画面平行、不看镜头。只能看到左半边侧脸——左眼的侧面轮廓、鼻梁侧影、左半边嘴；看不到右眼，右半边脸被头部完全挡住。不要正对镜头，也不要背对镜头。",
        facingEn: "The character walks due west (convention: the left side of the image is west), walking toward the left side of the image.",
        visibilityEn: "The camera captures the character's left side: the body is fully in profile to the camera, the two shoulders are one in front of the other with the line between them perpendicular to the image plane, the tip of the nose points toward the left side of the image, and the gaze is parallel to the image plane and not looking at the camera. Only the left half of the profile is visible - the profile contour of the left eye, the side profile of the nose bridge, the left half of the mouth; the right eye cannot be seen, and the right half of the face is completely hidden by the head. Do not face the camera straight on and do not turn your back to the camera.",
        refs: ["front", "back"]
    },
    {
        key: "right",
        compass: "E",
        label: "东 · 右侧脸",
        facing: "角色向正东行走（约定：画面右侧为东），朝画面右侧行走。",
        visibility: "镜头拍到的是角色的右侧面：身体完全侧对镜头，两只肩膀一前一后、连线与画面垂直，鼻尖指向画面右侧，视线与画面平行、不看镜头。只能看到右半边侧脸——右眼的侧面轮廓、鼻梁侧影、右半边嘴；看不到左眼，左半边脸被头部完全挡住。不要正对镜头，也不要背对镜头。",
        facingEn: "The character walks due east (convention: the right side of the image is east), walking toward the right side of the image.",
        visibilityEn: "The camera captures the character's right side: the body is fully in profile to the camera, the two shoulders are one in front of the other with the line between them perpendicular to the image plane, the tip of the nose points toward the right side of the image, and the gaze is parallel to the image plane and not looking at the camera. Only the right half of the profile is visible - the profile contour of the right eye, the side profile of the nose bridge, the right half of the mouth; the left eye cannot be seen, and the left half of the face is completely hidden by the head. Do not face the camera straight on and do not turn your back to the camera.",
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
/**
 * `DEFAULT_IMAGE_PROMPT` 的英文版。
 *
 * 两版必须**逐行对应**：段数与 `{facing}` / `{visibility}` 的位置都一样。
 * 中英两版是同一份提示词工程结论，不是「翻译给界面看的」——它们会真的发给生图模型。
 */
const DEFAULT_IMAGE_PROMPT_EN = [
    "[Camera] Fixed camera positioned directly in front of the character, lens level with the character's chest, neither looking down nor looking up. The character stands upright on the ground, both feet planted on the floor.",
    "[Turn method] The character turns only around its own vertical axis to change the direction it faces, and the body always stays upright. Strictly forbidden: tilting the head up, tilting the head down, looking up, looking down, bending at the waist, leaning backward, or tilting the body. The gaze stays horizontal at all times, neither looking up nor looking down.",
    "[Consistency] All the images below are the same character turning in place around its vertical axis; height, build, face shape, hairstyle, clothing and color scheme must be exactly identical, only the body orientation differs.",
    "[Subject] Treat the person in the reference image as the only subject; fully preserve their facial features, hairstyle, hair color, clothing style, color scheme and overall art style; it must look like the exact same person.",
    "[Facing] {facing}",
    "[Visible parts] {visibility}",
    "[Art style] Flat cel-shaded coloring, crisp boundaries between color blocks, avoid realistic lighting and shading, gradients, depth of field and noise.",
    "[Background] Solid green screen, the color is standard chroma key green #00FF00, the whole background is a completely uniform single color, with no shadows, gradients or noise of any kind.",
    "[Hard requirements] The background must be absolutely clean: no ground, no cast shadow, no text, no border, no checkerboard, no props or decorations of any kind. The character is the only object in the frame, should fill the frame height as much as possible (about 80%), full body complete and centered, not cropped and not occluded."
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
/** `DEFAULT_TURN_PROMPT` 的英文版（逐行对应）。 */
const DEFAULT_TURN_PROMPT_EN = [
    "[Static camera] Fixed camera position, fixed focal length, fixed framing, the camera stays completely motionless, camera height level with the character's chest, neither looking down nor looking up. The green screen background stays exactly as it is.",
    "[Start pose] At the start of the clip the character must look exactly as in the reference image: a front-facing standing pose facing the camera, both feet on the ground, arms hanging naturally at the sides, fully preserving the reference image's facial features, hairstyle, hair color, clothing style, color scheme and overall art style; it must look like the exact same person.",
    "[Motion] There is only this one character in the frame; the character rotates in place around its own vertical axis at a completely even speed for a full circle (360 degrees), the rotation speed stays constant from beginning to end, and it finishes facing exactly the same direction as at the start, so the first and last frames connect seamlessly.",
    "[No other motion] Apart from rotating around the vertical axis, there must be no other movement: no walking, no stepping, no swinging the arms, no raising the arms, no nodding. The body always stays in an upright standing pose; do not tilt the head up, tilt the head down, bend at the waist, lean backward, crouch or jump.",
    "[Consistency] During the rotation the height, build, face shape, hairstyle, clothing, color scheme and art style must stay exactly identical; only the body orientation changes.",
    "[Background] Solid green screen, the color is standard chroma key green #00FF00, the whole background is a completely uniform single color, pure green throughout, with no shadows, gradients, ground or cast shadow.",
    "[Frame] The character stays fully centered inside the frame the whole time, never cropped; no second person and no other object appears, no transitions, no jitter, no zooming, no camera movement or camera motion."
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
/** `DEFAULT_VIDEO_PROMPT` 的英文版（逐行对应）。 */
const DEFAULT_VIDEO_PROMPT_EN = [
    "[Static shot] Fixed camera position, fixed focal length, fixed framing, the camera stays completely motionless, camera height level with the character's chest, neither looking down nor looking up. The green screen background stays exactly as it is.",
    "There is only this one character in the frame; keep the orientation and position from the image unchanged - do not turn around, do not change the direction it faces. Perform a natural walking motion in place: the legs step alternately, the arms swing naturally, walk three complete steps.",
    "While walking the body stays upright and the gaze stays horizontal at all times; do not tilt the head up, tilt the head down, or let the body bob and deform.",
    "Keep the flat color blocks and the clean green screen; do not add texture, lighting or background detail.",
    "Do not walk out of the frame, do not let a second person or any other object appear, no transitions, no jitter, no zooming, no camera movement or camera motion."
].join("\n");
/** 把模板里的两个占位符换成具体方向的描述。 */
export function fillImagePrompt(template, facing, visibility) {
    return template.replace(/\{facing\}/g, facing).replace(/\{visibility\}/g, visibility);
}
/** 某个语言下的三个默认提示词模板。 */
const TEMPLATES = {
    zh: { image: DEFAULT_IMAGE_PROMPT, turn: DEFAULT_TURN_PROMPT, video: DEFAULT_VIDEO_PROMPT },
    en: { image: DEFAULT_IMAGE_PROMPT_EN, turn: DEFAULT_TURN_PROMPT_EN, video: DEFAULT_VIDEO_PROMPT_EN }
};
/**
 * 内置默认提示词（**唯一真源**）。
 *
 * 默认值不止界面要显示，它还真的会发给生图 / 视频模型，所以语言必须跟着 DSH 走：
 * 英文界面下把中文提示词发出去，模型照样能画，但用户读不懂自己在调什么。
 * @param lang - 目标语言；省略按中文。
 */
export function defaultPrompts(lang = "zh") {
    const template = TEMPLATES[lang] ?? TEMPLATES.zh;
    const images = {};
    for (const direction of DIRECTIONS) {
        const facing = lang === "en" ? direction.facingEn : direction.facing;
        const visibility = lang === "en" ? direction.visibilityEn : direction.visibility;
        images[direction.key] = fillImagePrompt(template.image, facing, visibility);
    }
    return { images, video: template.video, turn: template.turn };
}
/** 把八方向默认提示词装配成一张表（每个方向一份，可单独编辑）。 */
export function defaultImagePrompts(lang = "zh") {
    return defaultPrompts(lang).images;
}
/**
 * 把「还是内置默认值」的提示词换成目标语言的默认值。
 *
 * 判定标准是**逐字等于**另一语言的默认值：只有从没被改过（或改回了原样）的条目会被换，
 * 用户自己写过的一个字都不动。这样切换语言时，默认提示词跟着走，
 * 手改过的提示词留着手改的内容。
 *
 * @returns 是否真的改了——没改就别写盘。
 */
export function localizePrompts(prompts, lang) {
    const target = defaultPrompts(lang);
    const other = defaultPrompts(lang === "en" ? "zh" : "en");
    let changed = false;
    for (const key of DIRECTION_KEYS) {
        const current = prompts.images?.[key];
        if (typeof current !== "string" || current === target.images[key])
            continue;
        if (current === other.images[key]) {
            prompts.images[key] = target.images[key];
            changed = true;
        }
    }
    if (prompts.video !== undefined && prompts.video !== target.video && prompts.video === other.video) {
        prompts.video = target.video;
        changed = true;
    }
    if (prompts.turn !== undefined && prompts.turn !== target.turn && prompts.turn === other.turn) {
        prompts.turn = target.turn;
        changed = true;
    }
    // 单个方向的视频提示词覆盖：同样只换「还是默认值」的那些。
    const per = prompts.videoPerDirection;
    if (per !== undefined && per !== null && typeof per === "object") {
        for (const key of Object.keys(per)) {
            if (per[key] !== target.video && per[key] === other.video) {
                per[key] = target.video;
                changed = true;
            }
        }
    }
    return changed;
}
