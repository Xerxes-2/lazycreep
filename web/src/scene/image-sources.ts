/**
 * 浏览器里取图与栅格化的唯一入口：Pixi 纹理加载（texture-sources.ts、composite-textures.ts）、
 * 徽章位图（badge-image.ts）与赛季贴图预检（season-art.ts）都经这里，不各写一份。
 *
 * 只依赖 DOM（fetch、DOMParser、<img>、canvas、createImageBitmap），不依赖 Pixi。
 */

/** 栅格化结果：可以直接作为纹理资源的画布或位图 */
export type RasterImage = HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

/** URL 是否指向 SVG（`.svg` 结尾的地址或 `data:image/svg+xml`） */
export function isSvgUrl(url: string): boolean {
  if (url.startsWith("data:")) return url.startsWith("data:image/svg+xml");
  return /\.svg(?:[?#]|$)/i.test(url);
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
 * SVG 文本 → width×height 像素的画布。把根元素的 width/height 改成目标像素（矢量按目标尺寸绘制，
 * 也让没有 width/height 的 SVG 有确定尺寸；不改宽高比的 viewBox 照常缩放），经 <img> 画进画布。
 */
export async function rasterizeSvgText(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const doc = parseSvg(svg, "SVG");
  const root = doc.documentElement;
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
