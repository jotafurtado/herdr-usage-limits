import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeReports, fallbackReason } from "../dist/merge.js";
import { claudeAdapter, normalizeUsage, parseCredentialBlob, decodeSecret } from "../dist/providers/claude.js";
import { loadSettings } from "../dist/settings.js";
import { readQuotaAxi } from "../dist/quota-axi.js";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const noSettings = { force: [], disable: [] };

function context(overrides = {}) {
  return {
    env: { USER: "tester" },
    platform: "linux",
    homeDirectory: "/home/tester",
    now: () => NOW,
    readTextFile: async () => undefined,
    runCommand: async () => ({ code: 1, stdout: "", stderr: "" }),
    fetch: async () => { throw new Error("unexpected fetch"); },
    ...overrides,
  };
}

const usageResponse = body => async () => new Response(JSON.stringify(body), { status: 200 });
const window = { id: "five_hour", label: "session", kind: "session", percentRemaining: 80 };

test("fallback runs only for missing, empty or failed providers, or when forced", () => {
  assert.equal(fallbackReason(undefined, false), "missing");
  assert.equal(fallbackReason({ provider: "claude", windows: [] }, false), "no_windows");
  assert.equal(fallbackReason({ provider: "claude", windows: [window], state: { status: "error" } }, false), "failed_status");
  assert.equal(fallbackReason({ provider: "claude", windows: [window], state: { status: "fresh" } }, false), undefined);
  assert.equal(fallbackReason({ provider: "claude", windows: [window], state: { status: "fresh" } }, true), "forced");
});

test("a healthy quota-axi provider is never touched", async () => {
  let calls = 0;
  const adapter = { id: "claude", read: async () => { calls++; return { provider: "claude", windows: [window] }; } };
  const base = { generatedAt: "x", providers: [{ provider: "claude", windows: [window], state: { status: "fresh" } }] };
  const { report, fallbacks } = await mergeReports(base, [adapter], noSettings, context());
  assert.equal(calls, 0);
  assert.deepEqual(report.providers, base.providers);
  assert.deepEqual(fallbacks, []);
});

test("our adapter replaces a failed quota-axi provider", async () => {
  const own = { provider: "claude", windows: [window], state: { status: "fresh" } };
  const base = { generatedAt: "x", providers: [{ provider: "claude", windows: [], state: { status: "auth_required" } }, { provider: "codex", windows: [window] }] };
  const { report, fallbacks } = await mergeReports(base, [{ id: "claude", read: async () => own }], noSettings, context());
  assert.equal(report.providers[0], own);
  assert.equal(report.providers[1].provider, "codex");
  assert.deepEqual(fallbacks, [{ provider: "claude", reason: "no_windows", outcome: "replaced" }]);
});

test("when our adapter also fails, quota-axi's entry stays with the reason attached", async () => {
  const base = { generatedAt: "x", providers: [{ provider: "claude", windows: [], state: { status: "auth_required" } }] };
  const adapter = { id: "claude", read: async () => { throw new Error("boom"); } };
  const { report, fallbacks } = await mergeReports(base, [adapter], noSettings, context());
  assert.equal(report.providers[0].state.status, "auth_required");
  assert.equal(report.providers[0].usageLimitsError, "boom");
  assert.equal(fallbacks[0].outcome, "kept_quota_axi");
});

test("adapters still report when quota-axi is unavailable; disabled adapters never run", async () => {
  const own = { provider: "claude", windows: [window] };
  const ran = await mergeReports(undefined, [{ id: "claude", read: async () => own }], noSettings, context());
  assert.deepEqual(ran.report.providers, [own]);
  const skipped = await mergeReports(undefined, [{ id: "claude", read: async () => own }], { force: [], disable: ["claude"] }, context());
  assert.deepEqual(skipped.report.providers, []);
});

test("usage normalization prefers the vendor limits list", () => {
  const windows = normalizeUsage({
    five_hour: { utilization: 99 },
    limits: [
      { group: "session", percent: 12.5, resets_at: "2026-11-23T15:00:00Z" },
      { group: "weekly", percent: 40 },
      { percent: 70, scope: { model: { id: "opus", display_name: "Opus" } } },
    ],
  });
  assert.deepEqual(windows.map(w => [w.id, w.kind, w.percentUsed, w.percentRemaining, w.windowSeconds]), [
    ["five_hour", "session", 12.5, 87.5, 18000],
    ["seven_day", "weekly", 40, 60, 604800],
    ["model:opus", "model", 70, 30, 604800],
  ]);
});

test("usage normalization falls back to the fixed windows", () => {
  const windows = normalizeUsage({ five_hour: { utilization: 30, resets_at: "r" }, seven_day: { utilization: 10 } });
  assert.deepEqual(windows.map(w => [w.id, w.percentUsed, w.resetsAt]), [["five_hour", 30, "r"], ["seven_day", 10, undefined]]);
});

test("credential parsing reports the signed-out state Claude Code leaves behind", () => {
  const blob = JSON.stringify({ claudeAiOauth: { accessToken: "", refreshToken: "", expiresAt: 0, loginEnded: "1763812681" } });
  assert.deepEqual(parseCredentialBlob(blob, "keychain"), { status: "invalid", source: "keychain", error: "signed_out (run /login in Claude Code)" });
  assert.equal(parseCredentialBlob("{nope", "keychain").error.startsWith("json_parse_error"), true);
  assert.equal(decodeSecret(Buffer.from('{"a":1}').toString("hex")), '{"a":1}');
});

test("claude adapter reads the macOS Keychain and calls the usage endpoint", async () => {
  const blob = JSON.stringify({ claudeAiOauth: { accessToken: "token", expiresAt: NOW + 60000, subscriptionType: "max" } });
  let auth;
  const report = await claudeAdapter.read(context({
    platform: "darwin",
    runCommand: async (command, args) => {
      assert.equal(command, "security");
      assert.deepEqual(args, ["find-generic-password", "-a", "tester", "-s", "Claude Code-credentials", "-w"]);
      return { code: 0, stdout: blob + "\n", stderr: "" };
    },
    fetch: async (_url, init) => { auth = init.headers.authorization; return usageResponse({ five_hour: { utilization: 20 } })(); },
  }));
  assert.equal(auth, "Bearer token");
  assert.equal(report.plan, "max");
  assert.equal(report.source, "usage-limits:keychain");
  assert.equal(report.windows[0].percentUsed, 20);
});

test("claude adapter never uses an expired token", async () => {
  const blob = JSON.stringify({ claudeAiOauth: { accessToken: "old", refreshToken: "r", expiresAt: NOW - 1 } });
  const report = await claudeAdapter.read(context({ readTextFile: async () => blob }));
  assert.equal(report.windows.length, 0);
  assert.equal(report.state.status, "auth_required");
  assert.match(report.state.error, /token_expired/);
});

test("claude adapter maps 401 to auth_required", async () => {
  const report = await claudeAdapter.read(context({
    env: { CLAUDE_CODE_OAUTH_TOKEN: "env-token" },
    fetch: async () => new Response("{}", { status: 401 }),
  }));
  assert.equal(report.state.status, "auth_required");
  assert.equal(report.state.error, "unauthorized");
});

test("settings merge the config file with the environment", async () => {
  const settings = await loadSettings({
    env: { USAGE_LIMITS_FORCE: "codex, claude" },
    homeDirectory: "/home/tester",
    readTextFile: async path => path === "/home/tester/.config/usage-limits/config.json" ? '{"force":["claude"],"disable":["x"]}' : undefined,
  });
  assert.deepEqual(settings, { force: ["claude", "codex"], disable: ["x"] });
});

test("quota-axi output is parsed after any shell banner", async () => {
  const ok = await readQuotaAxi(async () => ({ code: 0, stdout: 'banner\n{"providers":[]}', stderr: "" }));
  assert.deepEqual(ok, { ok: true, report: { providers: [] } });
  const failed = await readQuotaAxi(async () => ({ code: 2, stdout: "", stderr: "x\nlast line" }));
  assert.deepEqual(failed, { ok: false, error: "quota-axi exited 2: last line" });
});
