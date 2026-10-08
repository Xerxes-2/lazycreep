/**
 * 版本信息里的渲染器覆盖配置（#47）：资源 URL 换成同源 Gateway 路径，认不出的地址不用。
 */
import { describe, expect, it } from "vitest";
import { rendererFromWire } from "./season-renderer.ts";

const S3 = "https://s3.amazonaws.com/static.screeps.com/seasons/season11/renderer";

describe("渲染器覆盖配置", () => {
  it("官方静态资源主机的两种写法都换成 /season-static/ 下的同源路径", () => {
    const renderer = rendererFromWire({
      resources: { T: `${S3}/T.png`, "reactor-core": "https://static.screeps.com/seasons/season11/renderer/reactor-core.png" },
      metadata: { reactor: { processors: [] } },
    });
    expect(renderer).toEqual({
      resources: {
        T: "/season-static/season11/renderer/T.png",
        "reactor-core": "/season-static/season11/renderer/reactor-core.png",
      },
      metadata: { reactor: { processors: [] } },
    });
  });

  it("MMO 下发的空配置、缺字段或形状不对时没有配置", () => {
    expect(rendererFromWire({ resources: {}, metadata: {} })).toBeUndefined();
    expect(rendererFromWire(undefined)).toBeUndefined();
    expect(rendererFromWire({ resources: [1], metadata: 3 })).toBeUndefined();
  });

  it("别的主机、非 https、带 . / .. 段或编码字符的地址不用", () => {
    const renderer = rendererFromWire({
      resources: {
        a: "https://evil.example/seasons/season11/a.png",
        b: "http://static.screeps.com/seasons/season11/b.png",
        c: `${S3}/../../x.png`,
        d: `${S3}/%2e%2e/d.png`,
        e: "https://static.screeps.com/other/e.png",
        f: 42,
        ok: `${S3}/ok.png`,
      },
      metadata: {},
    });
    expect(renderer?.resources).toEqual({ ok: "/season-static/season11/renderer/ok.png" });
  });
});
