# NixOS module：以独立的 systemd 服务运行 Gateway（Caddy）。
# Cloudflare 隧道与 Access 不归这里管，在服务器现有配置里把隧道指向 address:port 即可。
self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.my-screeps-client;
in
{
  options.services.my-screeps-client = {
    enable = lib.mkEnableOption "my-screeps-client 的 Gateway 与前端";

    address = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "监听地址。默认只监听本机，由 Cloudflare 隧道接入。";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8080;
      description = "监听端口。";
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.gateway;
      defaultText = lib.literalExpression "my-screeps-client.packages.\${system}.gateway";
      description = "Gateway 包（内含前端静态文件）。";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.my-screeps-client = {
      description = "my-screeps-client Gateway";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      environment = {
        MSC_ADDRESS = cfg.address;
        MSC_PORT = toString cfg.port;
        HOME = "/var/lib/my-screeps-client";
        XDG_DATA_HOME = "/var/lib/my-screeps-client";
        XDG_CONFIG_HOME = "/var/lib/my-screeps-client";
      };
      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
        DynamicUser = true;
        StateDirectory = "my-screeps-client";
        # 无状态服务：收紧权限
        AmbientCapabilities = lib.optional (cfg.port < 1024) "CAP_NET_BIND_SERVICE";
        CapabilityBoundingSet = lib.optional (cfg.port < 1024) "CAP_NET_BIND_SERVICE";
        NoNewPrivileges = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        SystemCallArchitectures = "native";
      };
    };
  };
}
