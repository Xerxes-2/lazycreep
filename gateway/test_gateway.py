"""Gateway 行为测试：不触网。

起两个本地模拟上游（API 与瓦片 CDN），把 Gateway 的上游指过去，经 Gateway 发请求，
断言模拟上游收到了什么、没收到什么。

    python3 test_gateway.py <routes.json> <gateway 命令> [参数...]

Gateway 命令按环境变量 MSC_ADDRESS / MSC_PORT / MSC_WEB_ROOT / MSC_API_UPSTREAM /
MSC_TILES_UPSTREAM / MSC_SEASON_STATIC_UPSTREAM 启动（见 gateway/Caddyfile）。
"""

import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROUTES_PATH = sys.argv[1]
GATEWAY_CMD = sys.argv[2:]
with open(ROUTES_PATH) as f:
    ROUTES = json.load(f)

TOKEN = "test-token-0123"


class MockUpstream:
    """记录收到的每个请求，GET 回 JSON（/map/ 与 /seasons/ 下回 PNG），POST 回显 body。"""

    def __init__(self):
        self.requests = []
        upstream = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                upstream.requests.append(
                    {"method": self.command, "path": self.path, "headers": dict(self.headers.items()), "body": body}
                )
                if self.path.startswith(("/map/", "/seasons/")):
                    payload, ctype = b"\x89PNG\r\n\x1a\nfake", "image/png"
                else:
                    payload, ctype = json.dumps({"ok": 1, "echo": body.decode()}).encode(), "application/json"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(payload)

            do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _handle

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}"

    def received(self, method, path):
        return [r for r in self.requests if r["method"] == method and r["path"] == path]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


api = MockUpstream()
tiles = MockUpstream()
season_static = MockUpstream()
web_root = tempfile.mkdtemp()
with open(os.path.join(web_root, "index.html"), "w") as f:
    f.write("<!doctype html><title>index</title>")
os.makedirs(os.path.join(web_root, "assets"))
with open(os.path.join(web_root, "assets", "app.js"), "w") as f:
    f.write("console.log('app')")

PORT = free_port()
env = dict(
    os.environ,
    MSC_ADDRESS="127.0.0.1",
    MSC_PORT=str(PORT),
    MSC_WEB_ROOT=web_root,
    MSC_API_UPSTREAM=api.url,
    MSC_TILES_UPSTREAM=tiles.url,
    MSC_SEASON_STATIC_UPSTREAM=season_static.url,
    HOME=tempfile.mkdtemp(),
    XDG_DATA_HOME=tempfile.mkdtemp(),
    XDG_CONFIG_HOME=tempfile.mkdtemp(),
)
gateway = subprocess.Popen(GATEWAY_CMD, env=env)


def request(method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    # skip_host 让测试可以自己设 Host；路径原样发出，不做规范化
    conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
    all_headers = {"Host": "client.example", **(headers or {})}
    if body is not None:
        all_headers["Content-Length"] = str(len(body))
    for k, v in all_headers.items():
        conn.putheader(k, v)
    conn.endheaders(body)
    res = conn.getresponse()
    data = res.read()
    conn.close()
    return res.status, res.getheader("Content-Type") or "", data


# 原始路径含编码斜杠、编码点或 `.` / `..` 段：Gateway 返回 400，不到达上游
BAD_PATHS = [
    "/api/user/code/..%2F..%2Fuser/console",
    "/season/api/user%2Fcode",
    "/season/api/user%2fconsole",
    "/season/api/user/%2E%2E/code",
    "/ptr/api/%2e/user/console",
    "/season/api/game/map-stats/../../user/code",
    "/season/api/user/console/../code",
    "/season/api/./user/console",
    "/api/user/console/..",
    "/x/../api/user/console",
    "/room-history/shardSeason/..%2F..%2Fapi/1.json",
    "/room-history/shardSeason/W1N1/../../../api/user/code",
    "/map-tiles/../api/user/console",
    "/map-tiles/shardSeason%2F..%2FE0N0.png",
    "/season-static/season11/../../api/user/console",
    "/season-static/season11%2F..%2Frenderer/T.png",
    "/season-static/./season11/renderer/T.png",
]


def upstream_count():
    return len(api.requests) + len(tiles.requests) + len(season_static.requests)


def wait_ready():
    deadline = time.time() + 20
    while time.time() < deadline:
        if gateway.poll() is not None:
            sys.exit(f"Gateway 提前退出：{gateway.returncode}")
        try:
            request("GET", "/")
            return
        except OSError:
            time.sleep(0.1)
    sys.exit("Gateway 没有在 20 秒内就绪")


class GatewayTest(unittest.TestCase):
    def test_get_is_forwarded_on_every_api_prefix_with_token_and_query(self):
        for prefix in ROUTES["apiPrefixes"]:
            path = f"{prefix}/game/time?shard=shardSeason"
            status, ctype, _ = request("GET", path, headers={"X-Token": TOKEN})
            self.assertEqual(status, 200, path)
            self.assertIn("application/json", ctype)
            [got] = api.received("GET", path)
            self.assertEqual(got["headers"].get("X-Token"), TOKEN)

    def test_upstream_sees_its_own_host_not_the_gateway_host(self):
        request("GET", "/api/version")
        [got] = api.received("GET", "/api/version")
        self.assertEqual(got["headers"].get("Host"), f"127.0.0.1:{api.port}")

    def test_allowlisted_post_is_forwarded_with_body(self):
        for prefix in ROUTES["apiPrefixes"]:
            for endpoint in ROUTES["postAllowlist"]:
                path = f"{prefix}/{endpoint}"
                body = json.dumps({"probe": path}).encode()
                status, _, data = request(
                    "POST", path, body, {"X-Token": TOKEN, "Content-Type": "application/json"}
                )
                self.assertEqual(status, 200, path)
                self.assertEqual(json.loads(data)["echo"], body.decode())
                [got] = api.received("POST", path)
                self.assertEqual(got["headers"].get("X-Token"), TOKEN)

    def test_post_outside_allowlist_is_403_and_never_reaches_upstream(self):
        before = upstream_count()
        paths = [
            "/api/user/code",
            "/season/api/user/code",
            "/ptr/api/user/code",
            "/season/api/game/market/create-order",
            "/season/api/user/memory",
            "/season/api/user/console/",
            "/room-history/shardSeason/W1N1/100.json",
            "/map-tiles/shardSeason/E0N0.png",
        ]
        for path in paths:
            status, _, _ = request("POST", path, b"{}", {"X-Token": TOKEN, "Content-Type": "application/json"})
            self.assertEqual(status, 403, path)
        self.assertEqual(upstream_count(), before)

    def test_paths_with_encoded_slash_or_dot_or_dot_segments_are_400_for_any_method(self):
        # Caddy 的 path 匹配先解码再清理，上游却收到原始路径：这类路径一律拒绝（ADR 0003）
        before = upstream_count()
        for path in BAD_PATHS:
            for method in ["GET", "POST"]:
                body = b"{}" if method == "POST" else None
                status, _, _ = request(method, path, body, {"X-Token": TOKEN, "Content-Type": "application/json"})
                self.assertEqual(status, 400, f"{method} {path}")
        self.assertEqual(upstream_count(), before)

    def test_encoded_slash_in_query_is_not_a_bad_path(self):
        path = "/api/user/find?username=a%2Fb/../c"
        status, _, _ = request("GET", path)
        self.assertEqual(status, 200)
        self.assertEqual(len(api.received("GET", path)), 1)

    def test_other_write_methods_are_403(self):
        before = len(api.requests)
        for method in ["PUT", "DELETE", "PATCH"]:
            for endpoint in ["user/code", *ROUTES["postAllowlist"]]:
                path = f"/season/api/{endpoint}"
                status, _, _ = request(method, path, b"{}", {"X-Token": TOKEN})
                self.assertEqual(status, 403, f"{method} {path}")
        self.assertEqual(len(api.requests), before)

    def test_method_override_headers_are_not_forwarded(self):
        request("GET", "/api/game/shards/info", headers={"X-HTTP-Method-Override": "POST"})
        [got] = api.received("GET", "/api/game/shards/info")
        self.assertNotIn("X-HTTP-Method-Override", got["headers"])

    def test_room_history_is_forwarded(self):
        path = "/room-history/shardSeason/W13S28/1024900.json"
        status, _, _ = request("GET", path)
        self.assertEqual(status, 200)
        self.assertEqual(len(api.received("GET", path)), 1)

    def test_map_tiles_go_to_the_cdn_map_path(self):
        status, ctype, _ = request("GET", "/map-tiles/shardSeason/E0N0.png")
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "image/png")
        [got] = tiles.received("GET", "/map/shardSeason/E0N0.png")
        self.assertEqual(got["headers"].get("Host"), f"127.0.0.1:{tiles.port}")
        self.assertEqual(api.received("GET", "/map/shardSeason/E0N0.png"), [])

    def test_season_static_get_and_head_go_to_the_static_host_seasons_path(self):
        path = "/season-static/season11/renderer/T.png"
        for method in ["GET", "HEAD"]:
            status, ctype, _ = request(method, path, headers={"X-Token": TOKEN, "Cookie": "CF_Authorization=secret"})
            self.assertEqual(status, 200, method)
            self.assertEqual(ctype, "image/png")
            [got] = season_static.received(method, "/seasons/season11/renderer/T.png")
            self.assertEqual(got["headers"].get("Host"), f"127.0.0.1:{season_static.port}")
            # 静态资源主机不需要身份：token 与 cookie 都不带过去
            sent = {k.lower() for k in got["headers"]}
            self.assertNotIn("x-token", sent)
            self.assertNotIn("cookie", sent)
        self.assertEqual(api.received("GET", "/seasons/season11/renderer/T.png"), [])

    def test_season_static_is_read_only_and_never_reaches_upstream(self):
        before = upstream_count()
        path = "/season-static/season11/renderer/T.png"
        for method in ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]:
            status, _, _ = request(method, path, b"{}", {"Content-Type": "application/json"})
            self.assertEqual(status, 403, method)
        for endpoint in ROUTES["postAllowlist"]:
            status, _, _ = request("POST", f"/season-static/{endpoint}", b"{}")
            self.assertEqual(status, 403, endpoint)
        self.assertEqual(upstream_count(), before)

    def test_browser_and_cloudflare_headers_are_not_leaked_upstream(self):
        request(
            "GET",
            "/api/game/world-size",
            headers={
                "Cookie": "CF_Authorization=secret",
                "Cf-Access-Jwt-Assertion": "jwt",
                "Cf-Connecting-Ip": "203.0.113.1",
                "Cdn-Loop": "cloudflare",
            },
        )
        [got] = api.received("GET", "/api/game/world-size")
        sent = {k.lower() for k in got["headers"]}
        for name in ["cookie", "cf-access-jwt-assertion", "cf-connecting-ip", "cdn-loop"]:
            self.assertNotIn(name, sent)

    def test_static_files_and_spa_fallback(self):
        status, _, data = request("GET", "/assets/app.js")
        self.assertEqual((status, data), (200, b"console.log('app')"))
        for path in ["/", "/room/shardSeason/W13S28"]:
            status, ctype, data = request("GET", path)
            self.assertEqual(status, 200, path)
            self.assertIn("text/html", ctype)
            self.assertIn(b"<title>index</title>", data)


if __name__ == "__main__":
    wait_ready()
    try:
        result = unittest.main(argv=[sys.argv[0], "-v"], exit=False).result
    finally:
        gateway.terminate()
        gateway.wait(timeout=10)
    sys.exit(0 if result.wasSuccessful() else 1)
