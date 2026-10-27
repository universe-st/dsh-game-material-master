/**
 * 抠像底色（chroma key 背景色）。
 *
 * 这个模块解决两件事：
 *
 * 1. **抠像不再只认绿色**。角色自己穿绿衣服时，绿幕会把衣服一起吃掉；用户可以
 *    改用品红 / 蓝 / 白 / 黑等背景。这里负责把界面 / 配置里的颜色规整成
 *    `#RRGGBB`，并给出颜色名与颜色通道方向（去溢色要用）。
 * 2. **提示词里的「绿幕」跟着换**。默认提示词里写死了「纯绿幕 / #00FF00」，
 *    配置成蓝幕后如果还把这些字发给模型，模型会继续画绿幕 —— 于是抠像参数
 *    与画面背景对不上。`applyKeyColorToPrompt` / `backgroundClause` 就是这层的
 *    唯一真源：服务端默认提示词与浏览器半区的 AI 素材提示词都走它。
 *
 * 颜色计算只做纯函数，不读配置、不碰 IO —— 这样 chroma / directions / client
 * 都能安全引用，也方便自检逐条断言。
 */
/** 默认抠像底色：标准 chroma key 绿。 */
export const DEFAULT_KEY_COLOR = "#00FF00";
/**
 * 内置可选底色。
 *
 * 只放**饱和、均匀**的纯色：抠像最怕背景本身有纹理 / 渐变，模型也最容易画准
 * 这种颜色。白 / 黑放在最后：它们适合「绿、蓝、品红都不能用」的极端衣服配色，
 * 但边缘溢色不如彩色幕好处理。
 */
export const KEY_COLOR_PRESETS = [
    { hex: "#00FF00", zh: "绿幕", en: "green screen", zhColor: "绿", enColor: "green" },
    { hex: "#0000FF", zh: "蓝幕", en: "blue screen", zhColor: "蓝", enColor: "blue" },
    { hex: "#FF00FF", zh: "品红幕", en: "magenta screen", zhColor: "品红", enColor: "magenta" },
    { hex: "#00FFFF", zh: "青幕", en: "cyan screen", zhColor: "青", enColor: "cyan" },
    { hex: "#FFFF00", zh: "黄幕", en: "yellow screen", zhColor: "黄", enColor: "yellow" },
    { hex: "#FF0000", zh: "红幕", en: "red screen", zhColor: "红", enColor: "red" },
    { hex: "#FFFFFF", zh: "白幕", en: "white screen", zhColor: "白", enColor: "white" },
    { hex: "#000000", zh: "黑幕", en: "black screen", zhColor: "黑", enColor: "black" }
];
const NAMED_COLORS = {
    green: "#00FF00",
    blue: "#0000FF",
    magenta: "#FF00FF",
    cyan: "#00FFFF",
    yellow: "#FFFF00",
    red: "#FF0000",
    white: "#FFFFFF",
    black: "#000000",
    gray: "#808080",
    grey: "#808080",
    绿: "#00FF00",
    绿幕: "#00FF00",
    蓝: "#0000FF",
    蓝幕: "#0000FF",
    品红: "#FF00FF",
    品红幕: "#FF00FF",
    青: "#00FFFF",
    青幕: "#00FFFF",
    黄: "#FFFF00",
    黄幕: "#FFFF00",
    红: "#FF0000",
    红幕: "#FF0000",
    白: "#FFFFFF",
    白幕: "#FFFFFF",
    黑: "#000000",
    黑幕: "#000000"
};
/** 任意输入 → 规范的 `#RRGGBB`；认不出来回退到 `fallback`。 */
export function normalizeKeyColor(value, fallback = DEFAULT_KEY_COLOR) {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (text === "")
        return fallback;
    const named = NAMED_COLORS[text];
    if (named !== undefined)
        return named;
    const short = /^#([0-9a-f]{3})$/.exec(text);
    if (short !== null) {
        const [r, g, b] = short[1].split("");
        return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    const full = /^#?([0-9a-f]{6})$/.exec(text);
    if (full !== null)
        return `#${full[1]}`.toUpperCase();
    return fallback;
}
/** `#RRGGBB` → 0~255 三个通道。 */
export function keyColorRgb(hex) {
    const color = normalizeKeyColor(hex);
    return {
        r: Number.parseInt(color.slice(1, 3), 16),
        g: Number.parseInt(color.slice(3, 5), 16),
        b: Number.parseInt(color.slice(5, 7), 16)
    };
}
/** 是不是「绿幕」那一档。绿色走原有的绿色优势判据（对实拍 / 视频帧更稳）。 */
export function isGreenKeyColor(hex) {
    const { r, g, b } = keyColorRgb(hex);
    return g > r + 64 && g > b + 64;
}
/** 当前底色对应的预设；自定义颜色返回 undefined。 */
export function keyColorPreset(hex) {
    const color = normalizeKeyColor(hex);
    return KEY_COLOR_PRESETS.find((preset) => preset.hex === color);
}
/** 颜色字的语言版本。自定义颜色退回 `#RRGGBB`。 */
export function keyColorWord(hex, lang = "zh") {
    const preset = keyColorPreset(hex);
    if (preset !== undefined)
        return lang === "en" ? preset.enColor : preset.zhColor;
    return normalizeKeyColor(hex);
}
/** 「绿幕 / 蓝幕 / 品红幕…」；自定义颜色说「纯色背景」。 */
export function keyScreenName(hex, lang = "zh") {
    const preset = keyColorPreset(hex);
    if (preset !== undefined)
        return lang === "en" ? preset.en : preset.zh;
    return lang === "en" ? "solid background" : "纯色背景";
}
/** 是否标准 `#00FF00`：默认提示词与旧项目都按这个判断。 */
export function isDefaultKeyColor(hex) {
    return normalizeKeyColor(hex) === DEFAULT_KEY_COLOR;
}
/**
 * 去溢色要压制的通道。
 *
 * 绿幕只压 G；蓝幕只压 B；品红幕同时压 R / B。返回**主色通道的下标**，
 * 其余通道取最大值作为「其它颜色」的基准 —— 这样品红幕的白色边缘（R≈G≈B）
 * 不会被误压，而偏品红的软边会被拉回中性。
 */
export function keyDominantChannels(hex) {
    const { r, g, b } = keyColorRgb(hex);
    const channels = [r, g, b];
    const out = [];
    for (let i = 0; i < 3; i++) {
        const others = channels.filter((_, index) => index !== i);
        const otherAverage = (others[0] + others[1]) / 2;
        if (channels[i] - otherAverage >= 48)
            out.push(i);
    }
    return out;
}
/**
 * 默认提示词里「整幅背景」那句话。
 *
 * 这一段会**真的发给模型**，所以绿色必须保持与旧版逐字一致（有一批老项目、
 * 自检与模型行为都按那几句验证过）；其它颜色按同一句式生成。
 */
export function backgroundClause(hex, lang = "zh", variant = "image") {
    const color = normalizeKeyColor(hex);
    if (color === DEFAULT_KEY_COLOR) {
        return variant === "turn"
            ? lang === "en"
                ? "Solid green screen, the color is standard chroma key green #00FF00, the whole background is a completely uniform single color, pure green throughout, with no shadows, gradients, ground or cast shadow."
                : "纯色绿幕，颜色是标准 chroma key 绿 #00FF00，整幅背景颜色完全均匀一致，全程保持纯绿，不要任何阴影、渐变、地面或投影。"
            : lang === "en"
                ? "Solid green screen, the color is standard chroma key green #00FF00, the whole background is a completely uniform single color, with no shadows, gradients or noise of any kind."
                : "纯色绿幕，颜色是标准 chroma key 绿 #00FF00，整幅背景颜色完全均匀一致，不要任何阴影、渐变或噪点。";
    }
    const screen = keyScreenName(color, lang);
    const word = keyColorWord(color, lang);
    const screenClause = keyColorPreset(color) === undefined ? (lang === "en" ? "Solid background" : "纯色背景") : (lang === "en" ? `Solid ${screen}` : `纯色${screen}`);
    if (variant === "turn") {
        return lang === "en"
            ? `${screenClause} (${color}), the whole background is a completely uniform single color, pure ${word} throughout, with no shadows, gradients, ground or cast shadow.`
            : `${screenClause}，颜色是 ${color}，整幅背景颜色完全均匀一致，全程保持纯${word}，不要任何阴影、渐变、地面或投影。`;
    }
    return lang === "en"
        ? `${screenClause} (${color}), the whole background is a completely uniform single color, with no shadows, gradients or noise of any kind.`
        : `${screenClause}，颜色是 ${color}，整幅背景颜色完全均匀一致，不要任何阴影、渐变或噪点。`;
}
/**
 * 把默认提示词里的背景描述换成目标颜色。
 *
 * 只替换**内置默认句式**（对所有内置颜色 + 目标自定义颜色都认），用户自己改写过的
 * 句子一个字都不动。这样：
 *   · 老项目里存着「纯绿幕 #00FF00」的默认提示词，切到蓝幕后仍会自动更新；
 *   · 用户手写「我要一个绿色背景」不会被误替换（不匹配默认句式）。
 */
export function applyKeyColorToPrompt(text, hex, lang = "zh") {
    if (typeof text !== "string" || text === "")
        return text;
    const target = normalizeKeyColor(hex);
    let out = text;
    // 1) 整句背景：内置颜色 + 目标自定义颜色都替换成目标句式。
    const colors = new Set([target, ...KEY_COLOR_PRESETS.map((preset) => preset.hex)]);
    const variants = ["image", "turn"];
    for (const variant of variants) {
        const replacement = backgroundClause(target, lang, variant);
        for (const color of colors) {
            const old = backgroundClause(color, lang, variant);
            if (old !== replacement)
                out = out.split(old).join(replacement);
        }
    }
    // 2) 句中的短称呼：`绿幕背景` / `干净的绿幕` / `同一片绿` / `抠绿幕` …
    //    也覆盖「目标颜色是绿」时从蓝幕 / 品红幕默认值改回来的情况。
    const screenNames = new Set(KEY_COLOR_PRESETS.map((preset) => (lang === "en" ? preset.en : preset.zh)));
    const targetScreen = keyScreenName(target, lang);
    const targetWord = keyColorWord(target, lang);
    const targetShort = lang === "en"
        ? keyColorPreset(target) === undefined ? targetWord : targetScreen.replace(/\s+screen$/u, "")
        : targetScreen.endsWith("幕") ? targetScreen.slice(0, -1) : targetWord;
    const targetBackground = lang === "en"
        ? keyColorPreset(target) === undefined ? "solid background" : `${targetScreen} background`
        : targetScreen.endsWith("幕") ? `${targetScreen}背景` : "纯色背景";
    for (const screen of screenNames) {
        const short = lang === "en" ? screen.replace(/\s+screen$/u, "") : screen.replace(/幕$/u, "");
        if (screen === targetScreen && short === targetShort)
            continue;
        out = out.split(`${screen}背景`).join(targetBackground);
        out = out.split(`干净的${screen}`).join(`干净的${targetScreen}`);
        out = out.split(`没检测到${screen}`).join(`没检测到${targetScreen}`);
        out = out.split(`抠${screen}`).join(`抠${targetScreen}`);
        out = out.split(`抠${short}`).join(`抠${targetShort}`);
        out = out.split(`抠掉${screen}背景`).join(`抠掉${targetBackground}`);
        out = out.split(`同一片${short}`).join(`同一片${targetShort}`);
        out = out.split(`纯${short}`).join(`纯${targetShort}`);
        out = out.split(`每一片${short}`).join(`每一片${targetShort}`);
        out = out.split(`${short}色描边`).join(`${targetWord}色描边`);
        out = out.split(`${short}色外发光`).join(`${targetWord}色外发光`);
        if (lang === "en") {
            out = out.split(`${screen} background`).join(targetBackground);
            out = out.split(`clean ${screen}`).join(`clean ${targetScreen}`);
            out = out.split(`the same ${short} background`).join(`the same ${targetShort} background`);
            out = out.split(`${short} background`).join(targetBackground);
            out = out.split(`pure ${short}`).join(`pure ${targetWord}`);
            out = out.split(`${short} outline`).join(`${targetWord} outline`);
            out = out.split(`${short} glow`).join(`${targetWord} glow`);
        }
    }
    // 3) 自定义旧颜色（不是任何内置预设）的整句背景：把 `颜色是 #XXXXXX` 所在句替换成目标句。
    //    只匹配「颜色是 #RRGGBB」到句号，避免误伤其它提到色值的文字。
    if (lang === "zh") {
        out = out.replace(/纯色[^，。\n]*，颜色是 #[0-9A-Fa-f]{6}，整幅背景颜色完全均匀一致，不要[^。\n]*。/gu, backgroundClause(target, lang, "image"));
        out = out.replace(/纯色[^，。\n]*，颜色是 #[0-9A-Fa-f]{6}，[^。\n]*全程保持[^。\n]*。/gu, backgroundClause(target, lang, "turn"));
    }
    if (lang === "en") {
        out = out.replace(/Solid [^,\n]*#[0-9A-Fa-f]{6}[^,\n]*, the whole background is a completely uniform single color, pure [^.]*\./gu, backgroundClause(target, lang, "turn"));
        out = out.replace(/Solid [^,\n]*#[0-9A-Fa-f]{6}[^,\n]*, the whole background is a completely uniform single color, with no [^.]*\./gu, backgroundClause(target, lang, "image"));
    }
    return out;
}
/** 一句短背景描述，给「背景保持原样」这类句中位置用。 */
export function shortBackground(hex, lang = "zh") {
    const color = normalizeKeyColor(hex);
    if (color === DEFAULT_KEY_COLOR)
        return lang === "en" ? "green screen" : "绿幕";
    return lang === "en" ? keyScreenName(color, "en") : `${keyScreenName(color, "zh")}`;
}
/** 一行「当前底色」说明，给界面 / 提示词用。 */
export function describeKeyColor(hex, lang = "zh") {
    const color = normalizeKeyColor(hex);
    const screen = keyScreenName(color, lang);
    return lang === "en" ? `${screen} (${color})` : `${screen}（${color}）`;
}
