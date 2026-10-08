/**
 * 在 Solid 组件里拿当前 Server + token 的共享 Source 租约（source/shared-source.ts）：
 * Server 或 token 变化时关旧租约、拿新租约，组件卸载时关闭。settings 的 server / token 按值判等，
 * 切 Shard 不会换租约。需在 Solid 的 owner 里调用。
 */
import { createMemo, onCleanup, type Accessor } from "solid-js";
import type { SourceFactory } from "../settings/SettingsPage.tsx";
import type { Settings } from "../settings/settings.ts";
import type { Source } from "./source.ts";

export function useSharedSource(sourceFor: SourceFactory, settings: Pick<Settings, "server" | "token">): Accessor<Source> {
  return createMemo(() => {
    const created = sourceFor(settings.server(), settings.token() || undefined);
    onCleanup(() => created.close());
    return created;
  });
}
