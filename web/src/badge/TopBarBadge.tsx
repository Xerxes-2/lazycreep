/**
 * Top Bar 上自己的徽章（#43）：当前 Server 上 token 所属用户的徽章（`auth/me`），确认当前登录的账号。
 * 没有 token 时不显示；资料未到或没有徽章时显示中性占位。换 Server（即换 Source）时重新取。
 */
import { createEffect, createSignal, onCleanup, Show, type Accessor } from "solid-js";
import { useI18n } from "../i18n";
import type { Source, UserInfo } from "../source/source.ts";
import { BadgeIcon } from "./BadgeIcon.tsx";

export function TopBarBadge(props: { readonly source: Accessor<Source>; readonly token: Accessor<string | undefined> }) {
  const { t } = useI18n();
  const [me, setMe] = createSignal<UserInfo>();
  createEffect(() => {
    const src = props.source();
    setMe(undefined);
    if (!props.token()) return;
    let alive = true;
    src.getMe().then(
      (info) => alive && setMe(info),
      () => undefined,
    );
    onCleanup(() => (alive = false));
  });

  return (
    <Show when={props.token()}>
      <span class="top-bar__badge" data-status="badge" data-user={me()?.id}>
        <BadgeIcon badge={me()?.badge} title={me() ? t("badge.of", { name: me()!.username }) : undefined} />
      </span>
    </Show>
  );
}
