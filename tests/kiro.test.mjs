import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeReports } from "../dist/merge.js";
import { databasePath, epochToIso, kiroAdapter, normalizeUsage } from "../dist/providers/kiro.js";
import { formatAmount } from "../mods/usage-limits/limit-windows.js";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const DATABASE = "/home/tester/Library/Application Support/kiro-cli/data.sqlite3";
const PROFILE = "arn:aws:codewhisperer:us-east-1:111111111111:profile/EXAMPLE";

// Shape of GetUsageLimits for a Kiro Power plan, with the identifiers removed.
const usage = {
  daysUntilReset: null,
  limits: null,
  nextDateReset: 1.7960832e9,
  overageConfiguration: { overageStatus: "DISABLED" },
  subscriptionInfo: { subscriptionTitle: "KIRO POWER", type: "Q_DEVELOPER_STANDALONE_POWER" },
  usageBreakdownList: [{
    resourceType: "CREDIT", displayName: "Credit", displayNamePlural: "Credits", unit: "INVOCATIONS",
    currentUsage: 1860, currentUsageWithPrecision: 1860.96, usageLimit: 10000, usageLimitWithPrecision: 10000,
    nextDateReset: 1.7960832e9, overageRate: 0.04,
  }],
  userInfo: { email: null, userId: "d-xxxx.yyyy" },
};

function rows({ expiresAt = "2026-11-25T18:00:00Z", token = true, profile = true } = {}) {
  const list = [];
  if (token) list.push({ key: "kirocli:odic:token", value: JSON.stringify({ access_token: "secret-token", expires_at: expiresAt, region: "us-east-1" }) });
  if (profile) list.push({ key: "api.codewhisperer.profile", value: JSON.stringify({ arn: PROFILE }) });
  return JSON.stringify(list);
}

function context(overrides = {}) {
  return {
    env: {}, platform: "darwin", homeDirectory: "/home/tester", now: () => NOW,
    readTextFile: async () => undefined,
    pathExists: async () => true,
    runCommand: async () => ({ code: 0, stdout: rows(), stderr: "" }),
    fetch: async () => new Response(JSON.stringify(usage), { status: 200 }),
    ...overrides,
  };
}

test("credits become one monthly window with the absolute amount attached", () => {
  const { windows, plan } = normalizeUsage(usage);
  assert.equal(plan, "Kiro Power");
  assert.deepEqual(windows, [{
    id: "credits", label: "Credits", kind: "monthly", percentUsed: 18.61, percentRemaining: 81.39,
    resetsAt: "2026-12-01T00:00:00.000Z", windowSeconds: 30 * 86400,
    amount: { used: 1860.96, limit: 10000, unit: "credits" },
  }]);
});

test("entries without a usable limit are dropped and the top-level reset is the fallback", () => {
  const { windows } = normalizeUsage({
    nextDateReset: 1796083200,
    usageBreakdownList: [{ resourceType: "CREDIT", currentUsage: 5, usageLimit: 0 }, { resourceType: "AGENTIC_REQUEST", currentUsage: 50, usageLimit: 200 }],
  });
  assert.deepEqual(windows.map(w => [w.id, w.percentUsed, w.resetsAt]), [["agentic_request", 25, "2026-12-01T00:00:00.000Z"]]);
  assert.deepEqual(normalizeUsage(null).windows, []);
  assert.equal(epochToIso(1796083200000), "2026-12-01T00:00:00.000Z");
  assert.equal(epochToIso("soon"), undefined);
});

test("database path follows the platform", () => {
  assert.equal(databasePath({ env: {}, platform: "darwin", homeDirectory: "/h" }), "/h/Library/Application Support/kiro-cli/data.sqlite3");
  assert.equal(databasePath({ env: {}, platform: "linux", homeDirectory: "/h" }), "/h/.local/share/kiro-cli/data.sqlite3");
  assert.equal(databasePath({ env: { XDG_DATA_HOME: "/x" }, platform: "linux", homeDirectory: "/h" }), "/x/kiro-cli/data.sqlite3");
});

test("a valid sign-in reads usage from the control plane with the bearer token and profile", async () => {
  const calls = [];
  const report = await kiroAdapter.read(context({
    runCommand: async (command, args) => { calls.push([command, args]); return { code: 0, stdout: rows(), stderr: "" }; },
    fetch: async (url, init) => { calls.push([String(url), init.headers.authorization]); return new Response(JSON.stringify(usage), { status: 200 }); },
  }));
  assert.equal(report.state.status, "fresh");
  assert.equal(report.plan, "Kiro Power");
  assert.equal(report.windows[0].amount.limit, 10000);
  assert.deepEqual(calls[0].slice(0, 1), ["sqlite3"]);
  assert.deepEqual(calls[0][1].slice(0, 3), ["-readonly", "-json", DATABASE]);
  assert.equal(calls[1][0], `https://management.us-east-1.kiro.dev/Get-Usage-Limits?origin=KIRO_CLI&profileArn=${encodeURIComponent(PROFILE)}`);
  assert.equal(calls[1][1], "Bearer secret-token");
});

test("Kiro that is not installed leaves the report without a Kiro entry", async () => {
  const own = await kiroAdapter.read(context({ pathExists: async () => false }));
  assert.equal(own.notSetUp, true);
  const { report, fallbacks } = await mergeReports({ generatedAt: "x", providers: [] }, [kiroAdapter], { force: [], disable: [] }, context({ pathExists: async () => false }));
  assert.deepEqual(report.providers, []);
  assert.equal(fallbacks[0].outcome, "skipped");
});

test("an expired token is never refreshed and asks to open Kiro CLI", async () => {
  let fetched = false;
  const report = await kiroAdapter.read(context({
    runCommand: async () => ({ code: 0, stdout: rows({ expiresAt: "2026-11-25T11:00:00Z" }), stderr: "" }),
    fetch: async () => { fetched = true; return new Response("{}"); },
  }));
  assert.equal(fetched, false);
  assert.equal(report.state.status, "auth_required");
  assert.deepEqual(report.notice, { message: "The Kiro CLI session expired.", action: "Open Kiro CLI to renew it" });
});

test("a signed-out database asks for kiro-cli login", async () => {
  const report = await kiroAdapter.read(context({ runCommand: async () => ({ code: 0, stdout: rows({ token: false }), stderr: "" }) }));
  assert.equal(report.state.error, "signed_out");
  assert.deepEqual(report.notice, { message: "Kiro CLI is signed out.", action: "Run kiro-cli login" });
});

test("a 403 that says the feature is unsupported is not an expired session", async () => {
  const body = JSON.stringify({ message: "Not available", reason: "FEATURE_NOT_SUPPORTED" });
  const report = await kiroAdapter.read(context({ fetch: async () => new Response(body, { status: 403 }) }));
  assert.equal(report.state.error, "feature_not_supported");
  assert.equal(report.notSetUp, true);
  assert.equal(report.notice, undefined);
});

test("failures keep a status and never leak the token", async () => {
  const unauthorized = await kiroAdapter.read(context({ fetch: async () => new Response("no", { status: 403 }) }));
  assert.equal(unauthorized.state.status, "auth_required");
  const limited = await kiroAdapter.read(context({ fetch: async () => new Response("slow", { status: 429 }) }));
  assert.deepEqual([limited.state.status, limited.state.error], ["rate_limited", "http_429"]);
  const down = await kiroAdapter.read(context({ fetch: async () => { throw new Error("offline"); } }));
  assert.equal(down.state.status, "unavailable");
  const noSqlite = await kiroAdapter.read(context({ runCommand: async () => { throw new Error("spawn sqlite3 ENOENT"); } }));
  assert.equal(noSqlite.state.status, "unavailable");
  const empty = await kiroAdapter.read(context({ fetch: async () => new Response(JSON.stringify({ usageBreakdownList: [] }), { status: 200 }) }));
  assert.equal(empty.state.error, "usage_response_without_windows");
  for (const report of [unauthorized, limited, down, noSqlite, empty]) assert.ok(!JSON.stringify(report).includes("secret-token"));
});

test("absolute credits are formatted for the popup and tooltip", () => {
  assert.equal(formatAmount({ used: 1860.96, limit: 10000, unit: "credits" }), "1,861 of 10,000 credits");
  assert.equal(formatAmount({ used: 12.34, limit: 50, unit: "credits" }), "12.3 of 50 credits");
  assert.equal(formatAmount(null), null);
  assert.equal(formatAmount({ used: Number.NaN, limit: 10 }), null);
});
