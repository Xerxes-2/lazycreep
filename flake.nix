{
  description = "my-screeps-client：自用 Screeps 客户端";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        web = pkgs.callPackage ./nix/web.nix { };
        gateway = pkgs.callPackage ./nix/gateway.nix { inherit web; };
        default = web;
      });

      nixosModules.default = import ./nix/module.nix self;

      checks = forAllSystems (
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          packages = self.packages.${system};
        in
        {
          inherit (packages) web;
          # 允许名单与反代规则：起本地模拟上游，不触网
          gateway = pkgs.runCommand "my-screeps-gateway-test" { nativeBuildInputs = [ pkgs.python3 ]; } ''
            python3 ${./gateway/test_gateway.py} ${./gateway/routes.json} ${pkgs.lib.getExe packages.gateway}
            touch $out
          '';
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          # 只评估 module 生成的 systemd 单元，不起 VM
          nixos-module =
            let
              nixos = nixpkgs.lib.nixosSystem {
                inherit system;
                modules = [
                  self.nixosModules.default
                  {
                    services.my-screeps-client = {
                      enable = true;
                      port = 8787;
                    };
                    boot.isContainer = true;
                    system.stateVersion = "26.05";
                  }
                ];
              };
            in
            pkgs.writeText "my-screeps-client-module-eval"
              nixos.config.systemd.units."my-screeps-client.service".text;
        }
      );

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.pnpm_11
            # 联调测试经真实 Gateway 请求
            pkgs.caddy
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
