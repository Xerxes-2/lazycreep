/**
 * 版本信息里的渲染器覆盖配置（#47）：赛季服在 `GET /season/api/version` 的 `serverData.renderer`
 * 下发 `{resources: {名字: URL}, metadata: {对象类型: 官方 metadata}}`（MMO 为空）。
 *
 * 资源在官方静态资源主机上，不给 CORS 头，不能直接作 WebGL 纹理；这里把它们换成同源的
 * Gateway 只读路径 `/season-static/<…>`（Gateway 转发到静态资源主机的 `/seasons/<…>`）。
 * 认不出的地址直接丢掉，用到它的对象退回兜底画法。
 */
import { isRecord } from "../storage/local-store.ts";

/** Gateway 上赛季静态资源的同源路径（gateway/Caddyfile、web/gateway-dev.ts） */
export const SEASON_STATIC_ROOT = "/season-static";

export interface RendererOverride {
  /** 贴图名 → 同源 URL */
  readonly resources: Readonly<Record<string, string>>;
  /** 对象类型 → 官方 metadata（未解释的 JSON） */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** 官方静态资源的两种地址写法：S3 路径式与静态资源域名 */
const STATIC_URL = /^https:\/\/(?:s3\.amazonaws\.com\/static\.screeps\.com|static\.screeps\.com)\/seasons\/([\w\-/.]+)$/;

/** 官方静态资源地址 → 同源路径；认不出或路径可疑时为 undefined */
export function seasonStaticUrl(url: string): string | undefined {
  const rest = STATIC_URL.exec(url)?.[1];
  if (rest === undefined) return undefined;
  if (rest.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return undefined;
  return `${SEASON_STATIC_ROOT}/${rest}`;
}

/** `serverData.renderer` → 覆盖配置；没有可用贴图时为 undefined */
export function rendererFromWire(wire: unknown): RendererOverride | undefined {
  if (!isRecord(wire) || !isRecord(wire["resources"])) return undefined;
  const resources: Record<string, string> = {};
  for (const [name, url] of Object.entries(wire["resources"])) {
    const local = typeof url === "string" ? seasonStaticUrl(url) : undefined;
    if (local) resources[name] = local;
  }
  if (Object.keys(resources).length === 0) return undefined;
  const metadata = isRecord(wire["metadata"]) ? wire["metadata"] : {};
  return { resources, metadata };
}

/** 存储里读回的覆盖配置（已是同源路径）：形状不对时为 undefined */
export function rendererFromStored(value: unknown): RendererOverride | undefined {
  if (!isRecord(value) || !isRecord(value["resources"]) || !isRecord(value["metadata"])) return undefined;
  const resources: Record<string, string> = {};
  for (const [name, url] of Object.entries(value["resources"])) {
    if (typeof url !== "string" || !url.startsWith(`${SEASON_STATIC_ROOT}/`)) return undefined;
    resources[name] = url;
  }
  return { resources, metadata: value["metadata"] };
}
