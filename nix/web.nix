{
  lib,
  stdenvNoCC,
  nodejs_22,
  nodejs-slim_22,
  pnpm_11,
  fetchPnpmDeps,
  pnpmConfigHook,
}:
let
  pnpm = pnpm_11.override { nodejs-slim = nodejs-slim_22; };
  root = ../.;
  # 只把前端构建与测试需要的文件放进源码，避免本地 node_modules / dist / .env* 进入 store。
  src = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-workspace.yaml
      ../pnpm-lock.yaml
      # 开发服务器的 Gateway 代理读取路径与 POST 允许名单
      ../gateway/routes.json
      # 测试回放录制好的 fixture
      ../fixtures
      (lib.fileset.difference ../web (
        lib.fileset.unions [
          (lib.fileset.maybeMissing ../web/node_modules)
          (lib.fileset.maybeMissing ../web/dist)
        ]
      ))
    ];
  };
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "my-screeps-client-web";
  version = "0.0.0";
  inherit src;

  nativeBuildInputs = [
    nodejs_22
    pnpm
    pnpmConfigHook
  ];

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    # pnpm-lock.yaml 变动后：改成 lib.fakeHash，`nix build .#web` 报错里取新值。
    hash = "sha256-puiTfV0S7ef9aTq0IPhTa9EepAtUiOeqSbtSMBiqa6s=";
  };

  buildPhase = ''
    runHook preBuild
    pnpm --filter web build
    runHook postBuild
  '';

  # 默认测试套件不触网，可以在沙箱里跑；类型检查一并执行。
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    pnpm --filter web typecheck
    pnpm --filter web test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    cp -r web/dist $out
    runHook postInstall
  '';

  meta = {
    description = "my-screeps-client 前端静态文件包";
    platforms = lib.platforms.all;
  };
})
