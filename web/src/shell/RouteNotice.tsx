/** 地址无效时的提示（#32）：已回到当前 Server 的 World Map；可关闭，下次有效导航时自动消失。 */
import { Show } from "solid-js";
import { useI18n } from "../i18n";
import type { UrlRouter } from "./url-router.ts";

export function RouteNotice(props: { readonly router: UrlRouter }) {
  const { t } = useI18n();
  return (
    <Show when={props.router.notice()}>
      {(notice) => (
        <p class="route-notice" role="status" data-testid="route-notice">
          <span>{t("route.invalid", { hash: notice().hash })}</span>
          <button
            type="button"
            data-action="dismiss-route-notice"
            aria-label={t("route.dismiss")}
            onClick={() => props.router.dismissNotice()}
          >
            ×
          </button>
        </p>
      )}
    </Show>
  );
}
