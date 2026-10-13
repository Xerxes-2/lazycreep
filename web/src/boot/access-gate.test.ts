import { describe, expect, it } from "vitest";
import { probeAccessGate, REAUTH_PARAM, reauthUrl, stripReauthParam } from "./access-gate.ts";

const respond = (init: Partial<Response>) => (async () => init as Response) as typeof fetch;

describe("访问网关", () => {
  it("API 被重定向才算网关拦下；正常响应、上游错误与网络错误都不算", async () => {
    expect(await probeAccessGate(respond({ type: "opaqueredirect", status: 0 }))).toBe(true);
    expect(await probeAccessGate(respond({ type: "basic", status: 200 }))).toBe(false);
    expect(await probeAccessGate(respond({ type: "basic", status: 502 }))).toBe(false);
    expect(await probeAccessGate((async () => Promise.reject(new TypeError("offline"))) as typeof fetch)).toBe(false);
  });

  it("重新登录的地址带上参数并保留 hash；启动时去掉参数，hash 不动", () => {
    const url = reauthUrl({ href: "https://screeps.example/?x=1#!/shard0/W1N1" }, 42);
    expect(url).toBe(`https://screeps.example/?x=1&${REAUTH_PARAM}=42#!/shard0/W1N1`);

    let replaced: string | undefined;
    stripReauthParam({
      location: { href: url } as Location,
      history: { state: null, replaceState: (_s: unknown, _t: string, u?: string | URL | null) => void (replaced = String(u)) } as History,
    });
    expect(replaced).toBe("/?x=1#!/shard0/W1N1");
  });
});
