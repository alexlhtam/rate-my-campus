import test from "node:test";
import assert from "node:assert/strict";
import { forwardHeaders, parseArgs, routeRequest, sameSubnet, selectInterface } from "../scripts/serve-lan.mjs";

test("LAN interface selection uses actual adapters and the actual subnet mask", () => {
  const interfaces = { Ethernet: [{ family: "IPv4", internal: false, address: "10.0.2.3", netmask: "255.255.255.0" }], "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.4.21", netmask: "255.255.255.192" }], Loopback: [{ family: "IPv4", internal: true, address: "127.0.0.1", netmask: "255.0.0.0" }] };
  assert.equal(selectInterface(interfaces).address, "192.168.4.21");
  assert.equal(selectInterface(interfaces, "10.0.2.3").name, "Ethernet");
  assert.throws(() => selectInterface(interfaces, "0.0.0.0"));
  assert.equal(sameSubnet("::ffff:192.168.4.40", "192.168.4.21", "255.255.255.192"), true);
  assert.equal(sameSubnet("192.168.4.80", "192.168.4.21", "255.255.255.192"), false);
  assert.equal(sameSubnet("192.168.4.999", "192.168.4.21", "255.255.255.192"), false);
});

test("LAN routes never forward privileged APIs, writes or path bypasses", () => {
  assert.equal(routeRequest("GET", "/").kind, "proxy");
  assert.equal(routeRequest("GET", "/_next/static/app.js").kind, "proxy");
  assert.equal(routeRequest("GET", "/data/campus-buildings.geojson").kind, "proxy");
  assert.equal(routeRequest("GET", "/api/community/state").body.profile.signedIn, false);
  assert.equal(routeRequest("GET", "/api/map/provider").body.provider, "openstreetmap");
  for (const [method, path] of [["POST", "/"], ["DELETE", "/api/community/account"], ["GET", "/api/community/account/export"], ["GET", "/api/map/session"], ["GET", "/signin-with-chatgpt"], ["GET", "/.dev.vars"], ["GET", "/_next/static/../../api/community/moderation"], ["GET", "/images/%252e%252e/api/assist"], ["GET", "http://elsewhere.test/"]]) assert.equal(routeRequest(method, path).kind, "blocked");
});

test("proxy headers discard spoofed identity, cookies and credentials", () => {
  assert.deepEqual(forwardHeaders({ host: "attacker.test", cookie: "__sites_local_auth=1", authorization: "fake", "oai-authenticated-user-id": "admin", "oai-authenticated-user-email": "admin@ucl.ac.uk", "x-forwarded-for": "127.0.0.1", "next-action": "fake", accept: "text/html" }, 9000), { host: "127.0.0.1:9000", accept: "text/html" });
  assert.deepEqual(parseArgs(["--host", "192.168.4.21", "--port", "4000", "--worker-port", "9000"]), { host: "192.168.4.21", port: 4000, workerPort: 9000, help: false });
  assert.throws(() => parseArgs(["--port", "-1"]));
});
