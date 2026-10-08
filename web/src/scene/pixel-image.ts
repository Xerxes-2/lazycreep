/**
 * 像素图（#44）：把一小块 RGBA 像素编码成 `image` 图元可用的 data URL（32 位 BMP），Scene 仍是纯数据。
 * 选 BMP 是因为它不压缩、编码只需写一个固定的文件头；它也是浏览器能直接显示的真图片。
 * Pixi 适配层认出本模块编码的 URL 后同步解码成纹理（scene/pixel-textures.ts），不走 fetch，
 * 换帧时不会因异步加载而闪一下空白。
 */

export interface PixelImage {
  readonly width: number;
  readonly height: number;
  /** 按行从上到下，每像素 r, g, b, a；长度 width × height × 4 */
  readonly rgba: Uint8Array;
}

const PREFIX = "data:image/bmp;base64,";
const FILE_HEADER = 14;
/** BITMAPV4HEADER：带 alpha 掩码，浏览器才认透明 */
const INFO_HEADER = 108;
const OFFSET = FILE_HEADER + INFO_HEADER;

export function encodePixelImage(image: PixelImage): string {
  const { width, height, rgba } = image;
  const bytes = new Uint8Array(OFFSET + width * height * 4);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42; // B
  bytes[1] = 0x4d; // M
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, OFFSET, true);
  view.setUint32(14, INFO_HEADER, true);
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true); // 负数：从上到下
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 32, true); // 位深
  view.setUint32(30, 3, true); // BI_BITFIELDS
  view.setUint32(34, width * height * 4, true);
  view.setUint32(54, 0x00ff0000, true); // R
  view.setUint32(58, 0x0000ff00, true); // G
  view.setUint32(62, 0x000000ff, true); // B
  view.setUint32(66, 0xff000000, true); // A
  view.setUint32(70, 0x73524742, true); // 'sRGB'
  for (let i = 0, o = OFFSET; i < rgba.length; i += 4, o += 4) {
    bytes[o] = rgba[i + 2]!;
    bytes[o + 1] = rgba[i + 1]!;
    bytes[o + 2] = rgba[i]!;
    bytes[o + 3] = rgba[i + 3]!;
  }
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return PREFIX + btoa(binary);
}

/** 只认 encodePixelImage 写出的格式；别的 URL（含其他 BMP）返回 undefined。 */
export function decodePixelImage(url: string): PixelImage | undefined {
  if (!url.startsWith(PREFIX)) return undefined;
  let binary: string;
  try {
    binary = atob(url.slice(PREFIX.length));
  } catch {
    return undefined;
  }
  if (binary.length < OFFSET) return undefined;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const width = view.getInt32(18, true);
  const height = -view.getInt32(22, true);
  if (
    bytes[0] !== 0x42 ||
    bytes[1] !== 0x4d ||
    view.getUint32(10, true) !== OFFSET ||
    view.getUint32(14, true) !== INFO_HEADER ||
    view.getUint16(28, true) !== 32 ||
    width <= 0 ||
    height <= 0 ||
    bytes.length !== OFFSET + width * height * 4
  ) {
    return undefined;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, o = OFFSET; i < rgba.length; i += 4, o += 4) {
    rgba[i] = bytes[o + 2]!;
    rgba[i + 1] = bytes[o + 1]!;
    rgba[i + 2] = bytes[o]!;
    rgba[i + 3] = bytes[o + 3]!;
  }
  return { width, height, rgba };
}
