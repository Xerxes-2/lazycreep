/**
 * Gateway 前面的访问网关（例如 Cloudflare Access）登录过期时的出路。
 *
 * 过期后同源请求被 302 到网关的登录页（另一个源），fetch 只看到跨源失败，像是连不上 Server；
 * 而重新加载页面会被 service worker 用缓存的应用外壳直接回答，请求到不了网关，登录页永远不出现。
 * 所以：启动失败时用 `redirect: "manual"` 探一次 API，被重定向就说明是网关拦下的；
 * 重新登录时导航到带 `REAUTH_PARAM` 的地址，service worker 不回答它（pwa.config.ts），
 * 网关得以把浏览器带去登录、再回到这里；应用启动时把这个参数去掉。
 */

export const REAUTH_PARAM = "reauth";

/** 探测用的地址：Gateway 反代的轻量只读接口 */
const PROBE_URL = "/api/version";

/** API 请求是否被重定向（同源 Gateway 不会重定向它，只有前面的访问网关会） */
export async function probeAccessGate(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchFn(PROBE_URL, { redirect: "manual", cache: "no-store", credentials: "same-origin" });
    return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
  } catch {
    return false;
  }
}

/** 重新登录要导航到的地址：当前页面加上 `REAUTH_PARAM`，hash 照留 */
export function reauthUrl(location: Pick<Location, "href">, now = Date.now()): string {
  const url = new URL(location.href);
  url.searchParams.set(REAUTH_PARAM, String(now));
  return url.href;
}

/** 启动时去掉 `REAUTH_PARAM`，免得之后的地址都带着它 */
export function stripReauthParam(win: Pick<Window, "location" | "history"> = window): void {
  const url = new URL(win.location.href);
  if (!url.searchParams.has(REAUTH_PARAM)) return;
  url.searchParams.delete(REAUTH_PARAM);
  win.history.replaceState(win.history.state, "", url.pathname + url.search + url.hash);
}
