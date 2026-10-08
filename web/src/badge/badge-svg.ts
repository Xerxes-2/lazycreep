/**
 * 徽章生成器（#43）：徽章数据 → SVG 字符串，纯函数，无 DOM 依赖。
 *
 * 移植自官方后端 screeps/backend-local 的 `lib/game/api/badge.js`（ISC，Copyright (c) 2016, Artem Chivchalov；
 * 许可全文见同目录 LICENSE-screeps-backend-local.txt）。与官方客户端的 BadgeGenerator 同一算法：
 * viewBox 0 0 100 100，圆形 clipPath（r 52，带黑边时 r 48），先铺 color1，再画 path1（color2）、path2（color3），
 * 按 flip 与类型的 rotate180 / 90 / 45 旋转。输出与原版逐字一致（对照测试见 badge-svg.test.ts）。
 *
 * 与原版的差别只在接口：路径表改为返回 {path1, path2} 的纯函数（原版改写共享对象上的 this.path1）；
 * 不合法的类型 / 调色板下标在 parseBadge 处已被拒绝，这里不再检查。
 */
import type { Badge, BadgeColor } from "./badge.ts";

interface BadgePathPair {
  readonly path1: string;
  readonly path2: string;
}

interface BadgePathSpec {
  calc(param: number): BadgePathPair;
  readonly flip?: "rotate180" | "rotate90" | "rotate45";
}

// ---- 以下路径表逐字移植自原版（保留原有缩进：模板字符串里的空白是输出的一部分） ----
const BADGE_PATHS: Readonly<Record<number, BadgePathSpec>> = {

    1: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var vert = 0, hor = 0;
            if(param > 0) {
                vert = param * 30 / 100;
            }
            if(param < 0) {
                hor = -param * 30 / 100;
            }
            p1 = `M 50 ${100-vert} L ${hor} 50 H ${100-hor} Z`;
            p2 = `M ${hor} 50 H ${100-hor} L 50 ${vert} Z`;

            return { path1: p1, path2: p2 };
        }
    },

    2: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var x = 0, y = 0;

            if(param > 0) {
                x = param * 30 / 100;
            }
            if(param < 0) {
                y = -param * 30 / 100;
            }

            p1 = `M ${x} ${y} L 50 50 L ${100-x} ${y} V -1 H -1 Z`;
            p2 = `M ${x} ${100-y} L 50 50 L ${100-x} ${100-y} V 101 H -1 Z`;
            return { path1: p1, path2: p2 };
        }
    },

    3: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var angle = Math.PI/4 + Math.PI/4*(param+100)/200,
                angle1 = -Math.PI/2,
                angle2 = Math.PI/2 + Math.PI/3,
                angle3 = Math.PI/2 - Math.PI/3;

            p1 = `M 50 50 L ${50+100*Math.cos(angle1-angle/2)} ${50+100*Math.sin(angle1-angle/2)} L ${50+100*Math.cos(angle1+angle/2)} ${50+100*Math.sin(angle1+angle/2)} Z`;
            p2 = `M 50 50 L ${50+100*Math.cos(angle2-angle/2)} ${50+100*Math.sin(angle2-angle/2)} L ${50+100*Math.cos(angle2+angle/2)} ${50+100*Math.sin(angle2+angle/2)} Z
                          M 50 50 L ${50+100*Math.cos(angle3-angle/2)} ${50+100*Math.sin(angle3-angle/2)} L ${50+100*Math.cos(angle3+angle/2)} ${50+100*Math.sin(angle3+angle/2)}`;
            return { path1: p1, path2: p2 };
        },
        flip: "rotate180"
    },

    4: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            param += 100;
            var y1 = 50 - param * 30 / 200,
                y2 = 50 + param * 30 / 200;

            p1 = `M 0 ${y2} H 100 V 100 H 0 Z`;
            p2 = param > 0 ? `M 0 ${y1} H 100 V ${y2} H 0 Z` : '';
            return { path1: p1, path2: p2 };
        },
        flip: "rotate90"
    },

    5: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            param += 100;
            var x1 = 50 - param * 10 / 200 - 10,
                x2 = 50 + param * 10 / 200 + 10;

            p1 = `M ${x1} 0 H ${x2} V 100 H ${x1} Z`;
            p2 = `M 0 ${x1} H 100 V ${x2} H 0 Z`;
            return { path1: p1, path2: p2 };
        },
        flip: "rotate45"
    },

    6: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var width = 5 + (param+100) * 8 / 200,
                x1 = 50, x2 = 20, x3 = 80;

            p1 = `M ${x1-width} 0 H ${x1+width} V 100 H ${x1-width}`;
            p2 = `M ${x2-width} 0 H ${x2+width} V 100 H ${x2-width} Z
                          M ${x3-width} 0 H ${x3+width} V 100 H ${x3-width} Z`;
            return { path1: p1, path2: p2 };
        },
        flip: "rotate90"
    },

    7: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var w = 20 + param * 10 / 100;

            p1 = `M 0 50 Q 25 30 50 50 T 100 50 V 100 H 0 Z`;
            p2 = `M 0 ${50-w} Q 25 ${30-w} 50 ${50-w} T 100 ${50-w}
                            V ${50+w} Q 75 ${70+w} 50 ${50+w} T 0 ${50+w} Z`;
            return { path1: p1, path2: p2 };
        },
        flip: "rotate90"
    },

    8: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var y = param * 20 / 100;

            p1 = `M 0 50 H 100 V 100 H 0 Z`;
            p2 = `M 0 50 Q 50 ${y} 100 50 Q 50 ${100-y} 0 50 Z`;
            return { path1: p1, path2: p2 };
        },
        flip: "rotate90"
    },

    9: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var y1 = 0, y2 = 50, h = 70;
            if(param > 0) y1 += param/100*20;
            if(param < 0) y2 += param/100*30;

            p1 = `M 50 ${y1} L 100 ${y1+h} V 101 H 0 V ${y1+h} Z`;
            p2 = `M 50 ${y1+y2} L 100 ${y1+y2+h} V 101 H 0 V ${y1+y2+h} Z`;
            return { path1: p1, path2: p2 };
        },
        flip: "rotate180"
    },

    10: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var r = 30, d = 7;

            if(param > 0) r += param*50/100;
            if(param < 0) d -= param*20/100;

            p1 = `M ${50+d+r} ${50-r} A ${r} ${r} 0 0 0 ${50+d+r} ${50+r} H 101 V ${50-r} Z`;
            p2 = `M ${50-d-r} ${50-r} A ${r} ${r} 0 0 1 ${50-d-r} ${50+r} H -1 V ${50-r} Z`;
            return { path1: p1, path2: p2 };
        },
        flip: "rotate90"
    },

    11: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var a1 = 30, a2 = 30, x = 50 - 50*Math.cos(Math.PI/4), y = 50 - 50*Math.sin(Math.PI/4);

            if(param > 0) {
                a1 += param*25/100;
                a2 += param*25/100;
            }
            if(param < 0) {
                a2 -= param*50/100;
            }

            p1 = `M ${x} ${y} Q ${a1} 50 ${x} ${100-y} H 0 V ${y} Z
                          M ${100-x} ${y} Q ${100-a1} 50 ${100-x} ${100-y} H 100 V ${y} Z`;
            p2 = `M ${x} ${y} Q 50 ${a2} ${100-x} ${y} V 0 H ${x} Z
                          M ${x} ${100-y} Q 50 ${100-a2} ${100-x} ${100-y} V 100 H ${x} Z`;

            return { path1: p1, path2: p2 };
        },
        flip: "rotate90"
    },

    12: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var a1 = 30, a2 = 35;

            if(param > 0) a1 += param * 30 / 100;
            if(param < 0) a2 += param * 15 / 100;

            p1 = `M 0 ${a1} H 100 V 100 H 0 Z`;
            p2 = `M 0 ${a1} H ${a2} V 100 H 0 Z
                          M 100 ${a1} H ${100-a2} V 100 H 100 Z`;

            return { path1: p1, path2: p2 };
        },
        flip: "rotate180"
    },

    13: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var r = 30, d = 0;

            if(param > 0) r += param * 50 / 100;
            if(param < 0) d -= param * 20 / 100;

            p1 = `M 0 0 H 50 V 100 H 0 Z`;
            p2 = `M ${50-r} ${50-d-r} A ${r} ${r} 0 0 0 ${50+r} ${50-r-d} V 0 H ${50-r} Z`;

            return { path1: p1, path2: p2 };
        },
        flip: "rotate180"
    },

    14: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var a = Math.PI/4,
                d = 0;

            a += param * Math.PI/4 / 100;

            p1 = `M 50 0 Q 50 ${50+d} ${50 + 50*Math.cos(a)} ${50 + 50*Math.sin(a)} H 100 V 0 H 50 Z`;
            p2 = `M 50 0 Q 50 ${50+d} ${50 - 50*Math.cos(a)} ${50 + 50*Math.sin(a)} H 0 V 0 H 50 Z`;

            return { path1: p1, path2: p2 };
        },
        flip: "rotate180"
    },

    15: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var w = 13 + param * 6 / 100,
                r1 = 80, r2 = 45, d = 10;

            p1 = `M ${50-r1-w} ${100+d} A ${r1+w} ${r1+w} 0 0 1 ${50+r1+w} ${100+d}
                                   H ${50+r1-w} A ${r1-w} ${r1-w} 0 1 0 ${50-r1+w} ${100+d}`;
            p2 = `M ${50-r2-w} ${100+d} A ${r2+w} ${r2+w} 0 0 1 ${50+r2+w} ${100+d}
                                   H ${50+r2-w} A ${r2-w} ${r2-w} 0 1 0 ${50-r2+w} ${100+d}`;

            return { path1: p1, path2: p2 };
        },
        flip: "rotate180"
    },

    16: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var a = 30 * Math.PI / 180, d = 25;

            if(param > 0) {
                a += 30 * Math.PI / 180 * param / 100;
            }
            if(param < 0) {
                d += param * 25 / 100;
            }

            p1 = '';
            for(var i=0; i<3; i++) {
                var angle1 = i * Math.PI*2/3 + a/2 - Math.PI/2,
                    angle2 = i * Math.PI*2/3 - a/2 - Math.PI/2;

                p1 += `M ${50+100*Math.cos(angle1)} ${50+100*Math.sin(angle1)}
                               L ${50+100*Math.cos(angle2)} ${50+100*Math.sin(angle2)}
                               L ${50+d*Math.cos(angle2)} ${50+d*Math.sin(angle2)}
                               A ${d} ${d} 0 0 1 ${50+d*Math.cos(angle1)} ${50+d*Math.sin(angle1)} Z`;
            }

            p2 = '';
            for(var i=0; i<3; i++) {
                var angle1 = i * Math.PI*2/3 + a/2 + Math.PI/2,
                    angle2 = i * Math.PI*2/3 - a/2 + Math.PI/2;

                p2 += `M ${50+100*Math.cos(angle1)} ${50+100*Math.sin(angle1)}
                               L ${50+100*Math.cos(angle2)} ${50+100*Math.sin(angle2)}
                               L ${50+d*Math.cos(angle2)} ${50+d*Math.sin(angle2)}
                               A ${d} ${d} 0 0 1 ${50+d*Math.cos(angle1)} ${50+d*Math.sin(angle1)} Z`;
            }

            return { path1: p1, path2: p2 };
        }
    },

    17: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var w = 35, h = 45;

            if(param > 0) {
                w += param * 20 / 100;
            }
            if(param < 0) {
                h  -= param * 30 / 100;
            }

            p1 = `M 50 45 L ${50-w} ${h+45} H ${50+w} Z`;
            p2 = `M 50 0 L ${50-w} ${h} H ${50+w} Z`;


            return { path1: p1, path2: p2 };
        }
    },

    18: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var a = 90 * Math.PI / 180, d = 10;

            if(param > 0) {
                a -= 60 / 180 * Math.PI * param / 100;
            }
            if(param < 0) {
                d -= param * 15 / 100;
            }

            p1 = '';
            p2 = '';
            for(var i=0;i<3;i++) {

                var angle1 = Math.PI*2/3*i + a/2 - Math.PI/2,
                    angle2 = Math.PI*2/3*i - a/2 - Math.PI/2,
                    path = `M ${50 + 100 * Math.cos(angle1)} ${50+100*Math.sin(angle1)}
                            L ${50 + 100 * Math.cos(angle2)} ${50+100*Math.sin(angle2)}
                            L ${50+d*Math.cos((angle1+angle2)/2)} ${50+d*Math.sin((angle1+angle2)/2)} Z`;

                if(!i) {
                    p1 += path;
                }
                else {
                    p2 += path;
                }
            }
            return { path1: p1, path2: p2 };
        },
        flip: "rotate180"
    },

    19: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var w2 = 20, w1 = 60;

            w1 += param * 20 / 100;
            w2 += param * 20 / 100;

            p1 = `M 50 -10 L ${50-w1} 100 H ${50+w1} Z`;
            p2 = '';
            if(w2 > 0) {
                p2 = `M 50 0 L ${50-w2} 100 H ${50+w2} Z`
            }
            return { path1: p1, path2: p2 };
        },
        flip: "rotate180"
    },

    20: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var w = 10, h = 20;

            if(param > 0) w += param * 20 / 100;
            if(param < 0) h += param * 40 / 100;

            p1 = `M 0 ${50-h} H ${50-w} V 100 H 0 Z`;
            p2 = `M ${50+w} 0 V ${50+h} H 100 V 0 Z`
            return { path1: p1, path2: p2 };
        },
        flip: "rotate90"
    },

    21: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var w = 40, h = 50;

            if(param > 0) w -= param * 20 / 100;
            if(param < 0) h += param * 20 / 100;

            p1 = `M 50 ${h} Q ${50+w} 0 50 0 T 50 ${h} Z
                          M 50 ${100-h} Q ${50+w} 100 50 100 T 50 ${100-h} Z`;
            p2 = `M ${h} 50 Q 0 ${50+w} 0 50 T ${h} 50 Z
                          M ${100-h} 50 Q 100 ${50+w} 100 50 T ${100-h} 50 Z`;
            return { path1: p1, path2: p2 };
        },
        flip: "rotate45"
    },

    22: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var w = 20;

            w += param * 10 / 100;

            p1 = `M ${50-w} ${50-w} H ${50+w} V ${50+w} H ${50-w} Z`;
            p2 = '';

            for(var i=-4;i<4;i++) {
                for(var j=-4;j<4;j++) {
                    var a = (i+j)%2;
                    p2 += `M ${50 - w - w * 2 * i} ${50 - w - w*2*(j+a)} h ${-w * 2} v ${w*2} h ${w * 2} Z`;
                }
            }
            return { path1: p1, path2: p2 };
        },
        flip: "rotate45"
    },

    23: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var w = 17, h = 25;

            if(param > 0) w += param * 35 / 100;
            if(param < 0) h -= param * 23 / 100;

            p1 = '';
            for(var i=-4; i<=4; i++) {
                p1 += `M ${50 - w*i*2} ${50-h} l ${-w} ${-h} l ${-w} ${h} l ${w} ${h} Z`
            }
            p2 = '';
            for(var i=-4; i<=4; i++) {
                p2 += `M ${50 - w*i*2} ${50+h} l ${-w} ${-h} l ${-w} ${h} l ${w} ${h} Z`
            }
            return { path1: p1, path2: p2 };
        },
        flip: "rotate90"
    },

    24: {
        calc(param: number): BadgePathPair {
            let p1 = "", p2 = "";
            var w = 50, h = 45;

            if(param > 0) w += param * 60 / 100;
            if(param < 0) h += param * 30 / 100;

            p1 = `M 0 ${h} L 50 70 L 100 ${h} V 100 H 0 Z`;
            p2 = `M 50 0 L ${50+w} 100 H 100 V ${h} L 50 70 L 0 ${h} V 100 H ${50-w} Z`;
            return { path1: p1, path2: p2 };
        },
        flip: "rotate180"
    },
};
// ---- 路径表结束 ----

/** 原版 hsl2rgb：H ∈ [0, 360)，S、L ∈ [0, 1] → `rrggbb` */
function hsl2rgb(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h_ = h / 60;
  const x = c * (1 - Math.abs((h_ % 2) - 1));
  let [r1, g1, b1] = [0, 0, 0];
  if (h_ >= 0 && h_ < 1) [r1, g1, b1] = [c, x, 0];
  else if (h_ >= 1 && h_ < 2) [r1, g1, b1] = [x, c, 0];
  else if (h_ >= 2 && h_ < 3) [r1, g1, b1] = [0, c, x];
  else if (h_ >= 3 && h_ < 4) [r1, g1, b1] = [0, x, c];
  else if (h_ >= 4 && h_ < 5) [r1, g1, b1] = [x, 0, c];
  else if (h_ >= 5 && h_ < 6) [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return hex(r1) + hex(g1) + hex(b1);
}

/** 历史格式的 80 色调色板：4 档（亮、中、暗、极暗），每档 1 个灰 + 19 个色相 */
export const BADGE_PALETTE: readonly string[] = (() => {
  const out: string[] = [];
  for (const [grey, s, l] of [
    [0.8, 0.6, 0.8],
    [0.5, 0.7, 0.5],
    [0.3, 0.4, 0.3],
    [0.1, 0.5, 0.1],
  ] as const) {
    out.push("#" + hsl2rgb(0, 0, grey));
    for (let i = 0; i < 19; i++) out.push("#" + hsl2rgb((i * 360) / 19, s, l));
  }
  return out;
})();

const colorOf = (c: BadgeColor): string => (typeof c === "string" ? c : (BADGE_PALETTE[c] ?? "#000000"));

const ROTATE = { rotate180: 180, rotate90: 90, rotate45: 45 } as const;

/** 徽章 → SVG（128×128，viewBox 100）；border 为 badge-svg 的 `border=1`：裁剪圆缩到 r 48 并加一圈黑边 */
export function badgeSvg(badge: Badge, border = false): string {
  const color1 = colorOf(badge.color1),
    color2 = colorOf(badge.color2),
    color3 = colorOf(badge.color3);

  const spec = typeof badge.type === "number" ? BADGE_PATHS[badge.type] : undefined;
  const paths: { readonly path1: string; readonly path2?: string | undefined } =
    typeof badge.type === "number" ? (spec?.calc(badge.param) ?? { path1: "", path2: "" }) : badge.type;
  const rotate = badge.flip && spec?.flip ? ROTATE[spec.flip] : 0;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 100 100" shape-rendering="geometricPrecision">
                            <defs>
                                <clipPath id="clip">
                                    <circle cx="50" cy="50" r="${border ? 48 : 52}" />
                                    <!--<rect x="0" y="0" width="100" height="100"/>-->
                                </clipPath>
                            </defs>
                            <g transform="rotate(${rotate} 50 50)">
                            <rect x="0" y="0" width="100" height="100" fill="${color1}" clip-path="url(#clip)"/>`;

  svg += `<path d="${paths.path1}" fill="${color2}" clip-path="url(#clip)"/>`;

  if (paths.path2) {
    svg += `<path d="${paths.path2}" fill="${color3}" clip-path="url(#clip)"/>`;
  }

  if (border) {
    svg += `<circle cx="50" cy="50" r="47.5" fill="transparent" stroke="#000" stroke-width="5"></circle>`;
  }

  svg += `</g></svg>`;

  return svg;
}

/**
 * 没有徽章的玩家（如 Source Keeper）与徽章未到时的中性占位：与徽章同尺寸的灰色圆，布局不跳动。
 * 参照官方房间渲染器没有徽章时的退路（纯色圆，userBadge.js）。
 */
export const BADGE_PLACEHOLDER_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 100 100">` +
  `<circle cx="50" cy="50" r="46" fill="#3a3a3a" stroke="#7a7a7a" stroke-width="4"/></svg>`;
