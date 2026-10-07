/**
 * 全页共享数据源（#2）：每个 Server + token 组合只建一个 Source（对 LiveSource 即至多一条官方 WebSocket），
 * 页面各处（World Map、Room View、PvP、Attack Alert、设置……）拿到的都是它的“租约”。
 *
 * 租约实现完整的 Source 接口，除了 close()：关闭租约只退掉经它建立、还没退订的订阅，
 * 最后一个租约关闭时才关闭底层 Source。所以切换 Server 或 token 时，各使用方照常
 * “关旧的、要新的”，旧连接在没人用后关闭，新组合建一个新的。
 * 频道按监听者计数、`room:` 的单房间约束都在 LiveSource 内部，共享后行为不变。
 */
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { ServerConfig, Source } from "./source.ts";

interface Entry {
  readonly source: Source;
  leases: number;
}

const keyOf = (server: ServerConfig, token: string | undefined) => JSON.stringify([server, token ?? ""]);

/** 返回订阅类句柄（Unsubscribe）的方法：租约记下这些句柄，关闭时一并退订 */
const isSubscription = (name: string) => name.startsWith("subscribe") || name === "onConnection";

export function sharedSources(create: SourceFactory): SourceFactory {
  const entries = new Map<string, Entry>();

  return (server, token) => {
    const key = keyOf(server, token);
    let entry = entries.get(key);
    if (!entry) {
      entry = { source: create(server, token), leases: 0 };
      entries.set(key, entry);
    }
    const current = entry;
    current.leases++;
    const offs = new Set<() => void>();
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      for (const off of offs) off();
      offs.clear();
      if (--current.leases > 0) return;
      if (entries.get(key) === current) entries.delete(key);
      current.source.close();
    };

    return new Proxy(current.source, {
      get(target, prop) {
        if (prop === "close") return close;
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        const method = value as (...args: unknown[]) => unknown;
        if (typeof prop !== "string" || !isSubscription(prop)) return method.bind(target);
        return (...args: unknown[]) => {
          const off = method.apply(target, args) as () => void;
          if (closed) {
            off();
            return () => {};
          }
          const tracked = () => {
            if (offs.delete(tracked)) off();
          };
          offs.add(tracked);
          return tracked;
        };
      },
    });
  };
}
