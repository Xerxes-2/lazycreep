/**
 * 浏览器里取图与栅格化的唯一入口：Pixi 纹理加载（texture-sources.ts、composite-textures.ts）、
 * 徽章位图（badge-image.ts）与赛季贴图预检（season-art.ts）都经这里，不各写一份。
 *
 * 只依赖 DOM（fetch、DOMParser、<img>、canvas、createImageBitmap），不依赖 Pixi。
 */

/** 栅格化结果：可以直接作为纹理资源的画布或位图 */
export type RasterImage = HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

// ---- 纹理来源：image 图元 url 的合法形式（scene.ts 的 ImagePrimitive.url）与成对的编码 / 识别 ----
//
// data URL 一律自带内容（URL 由内容决定、Scene 仍是可序列化的纯数据、适配层按 URL 天然去重，
// 不需要 revoke）；按下面的前缀区分，前缀互不包含。

/** 普通 SVG 文本的 data URL：`data:image/svg+xml;charset=utf-8,` + encodeURIComponent（徽章等） */
const SVG_DATA_PREFIX = "data:image/svg+xml;charset=utf-8,";
/**
 * 合成贴图（composite-textures.ts，房间级地形、rampart）：`data:image/svg+xml;msc=composite,` + 只转义 `%` 与 `#`
 * 的 SVG 文本（体积大，全转义会膨胀约三成）。它本身也是合法的 SVG data URL。
 */
const COMPOSITE_PREFIX = "data:image/svg+xml;msc=composite,";
/** 像素图（pixel-image.ts，World Map 单位图层）：`data:image/bmp;base64,` + 32 位 BMP */
export const PIXEL_IMAGE_PREFIX = "data:image/bmp;base64,";

/**
 * image 图元 url 的种类：
 * - `pixels`：{@link PIXEL_IMAGE_PREFIX} 像素图，适配层同步解码、最近邻缩放
 * - `composite`：{@link compositeSvgUrl} 合成贴图，内联引用的 PNG 后栅格化，闲置即卸载
 * - `svg`：`.svg` 结尾的同源地址或其他 `data:image/svg+xml`（如 {@link svgDataUrl}），按档位栅格化
 * - `bitmap`：其余（PNG 等同源地址），fetch + 解码，尺寸固定
 */
export type TextureSourceKind = "pixels" | "composite" | "svg" | "bitmap";

export function textureSourceKind(url: string): TextureSourceKind {
  if (url.startsWith(PIXEL_IMAGE_PREFIX)) return "pixels";
  if (url.startsWith(COMPOSITE_PREFIX)) return "composite";
  return isSvgUrl(url) ? "svg" : "bitmap";
}

/** URL 是否指向 SVG（`.svg` 结尾的地址或 `data:image/svg+xml`，含合成贴图） */
export function isSvgUrl(url: string): boolean {
  if (url.startsWith("data:")) return url.startsWith("data:image/svg+xml");
  return /\.svg(?:[?#]|$)/i.test(url);
}

/** SVG 文本 → 普通 SVG data URL */
export function svgDataUrl(svg: string): string {
  return SVG_DATA_PREFIX + encodeURIComponent(svg);
}

/** SVG 文本 → 合成贴图 URL */
export function compositeSvgUrl(svg: string): string {
  return COMPOSITE_PREFIX + svg.replace(/[%#]/g, (c) => encodeURIComponent(c));
}

export function isCompositeUrl(url: string): boolean {
  return url.startsWith(COMPOSITE_PREFIX);
}

/** 合成贴图 URL → SVG 文本；不是合成贴图时为 undefined */
export function compositeSvgText(url: string): string | undefined {
  return isCompositeUrl(url) ? decodeURIComponent(url.slice(COMPOSITE_PREFIX.length)) : undefined;
}

/** 是否像是像素图 URL（只看前缀，不解码） */
export function isPixelImageUrl(url: string): boolean {
  return url.startsWith(PIXEL_IMAGE_PREFIX);
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}：HTTP ${response.status}`);
  return response;
}

/** 取一张位图并解码（走浏览器 HTTP 缓存）。Chrome 的 createImageBitmap 不解码 SVG，SVG 要先栅格化 */
export async function fetchBitmap(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetchOk(url)).blob());
}

/** 取一张图转成 data URL（合成贴图内联 PNG 用） */
export async function fetchDataUrl(url: string): Promise<string> {
  const blob = await (await fetchOk(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`${url}：读取失败`));
    reader.readAsDataURL(blob);
  });
}

/** 取 SVG 文本 */
export async function fetchSvgText(url: string): Promise<string> {
  return (await fetchOk(url)).text();
}

/** 预检：取到并能解码才算可用（SVG 解析出根元素，位图能解码） */
export async function checkImage(url: string): Promise<void> {
  if (isSvgUrl(url)) {
    parseSvg(await fetchSvgText(url), url);
    return;
  }
  (await fetchBitmap(url)).close();
}

function parseSvg(svg: string, label: string): Document {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.documentElement.nodeName !== "svg") throw new Error(`${label}：不是 SVG`);
  return doc;
}

/**
 * 没有 viewBox 的 SVG 用原来的 width/height 补一个，改宽高后内容才会跟着缩放；否则内容按原尺寸画在左上角，
 * 放大时只占贴图的一角。官方美术里有几张（creep-npc、nuke、rampart、exit-*）把属性写成了小写 `viewbox`，
 * SVG 区分大小写，等于没有；官方渲染器按 width/height 绘制，所以补的是 `0 0 width height`，不照抄小写那个。
 */
export function ensureViewBox(root: Element): void {
  if (root.hasAttribute("viewBox")) return;
  const w = Number.parseFloat(root.getAttribute("width") ?? "");
  const h = Number.parseFloat(root.getAttribute("height") ?? "");
  if (w > 0 && h > 0) root.setAttribute("viewBox", `0 0 ${w} ${h}`);
}

/**
 * SVG 文本 → width×height 像素的画布。把根元素的 width/height 改成目标像素（矢量按目标尺寸绘制，
 * 也让没有 width/height 的 SVG 有确定尺寸；不改宽高比的 viewBox 照常缩放），经 <img> 画进画布。
 */
export async function rasterizeSvgText(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const doc = parseSvg(svg, "SVG");
  const root = doc.documentElement;
  ensureViewBox(root);
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.setAttribute("preserveAspectRatio", "none");
  const blob = new Blob([new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image(width, height);
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 2d 不可用");
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** url 指向的 SVG → width×height 像素的画布 */
export async function rasterizeSvgUrl(url: string, width: number, height: number): Promise<HTMLCanvasElement> {
  return rasterizeSvgText(await fetchSvgText(url), width, height);
}
