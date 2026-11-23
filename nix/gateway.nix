# Gateway：gateway/Caddyfile 加一个启动脚本，脚本给环境变量填默认值后 exec caddy。
# 上游地址的默认值只来自 gateway/routes.json（Caddyfile 不写默认值）；routes.json 缺字段时求值失败。
# 启动时在 stderr 打印访问链接。
# 环境变量可在调用时覆盖（测试据此把上游指向本地模拟服务器）。
{
  lib,
  writeShellApplication,
  caddy,
  web,
}:
let
  routes = lib.importJSON ../gateway/routes.json;
  postAllowlist = lib.concatMapStringsSep " " (p: "${p.prefix}/${p.endpoint}") (
    lib.cartesianProduct {
      prefix = routes.apiPrefixes;
      endpoint = routes.postAllowlist;
    }
  );
  caddyfile = ../gateway/Caddyfile;
in
writeShellApplication {
  name = "lazycreep-gateway";
  runtimeInputs = [ caddy ];
  text = ''
    export MSC_WEB_ROOT="''${MSC_WEB_ROOT:-${web}}"
    export MSC_API_UPSTREAM="''${MSC_API_UPSTREAM:-${routes.apiOrigin}}"
    export MSC_TILES_UPSTREAM="''${MSC_TILES_UPSTREAM:-${routes.tilesOrigin}}"
    export MSC_SEASON_STATIC_UPSTREAM="''${MSC_SEASON_STATIC_UPSTREAM:-${routes.seasonStaticOrigin}}"
    export MSC_POST_ALLOWLIST=${lib.escapeShellArg postAllowlist}
    # 启动时给一个能直接点开的链接；监听所有地址时用 localhost，IPv6 字面量加方括号
    host="''${MSC_ADDRESS:-127.0.0.1}"
    case "$host" in
      0.0.0.0 | :: | "[::]") host=localhost ;;
      *:*) host="[$host]" ;;
    esac
    echo "lazycreep: http://$host:''${MSC_PORT:-8080}/" >&2
    exec caddy run --adapter caddyfile --config ${caddyfile} "$@"
  '';
  meta.description = "lazycreep 的 Gateway（Caddy）";
}
