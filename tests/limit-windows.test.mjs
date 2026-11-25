import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWindows } from "../mods/usage-limits/limit-windows.js";

const windows = ["gemini_5h", "gemini_weekly", "claude_gpt_5h", "claude_gpt_weekly"]
  .map(id => ({ id, kind: id.endsWith("weekly") ? "weekly" : "session" }));
const provider = { id: "agy", windows };

test("existing settings and enabled option preserve all windows", () => {
  assert.deepEqual(visibleWindows(provider, {}), windows);
  assert.deepEqual(visibleWindows(provider, { agyClaudeGpt: true }), windows);
});

test("disabled option hides only Claude/GPT without changing cached data", () => {
  assert.deepEqual(visibleWindows(provider, { agyClaudeGpt: false }).map(w => w.id),
    ["gemini_5h", "gemini_weekly"]);
  assert.equal(provider.windows.length, 4);
  assert.deepEqual(visibleWindows(provider, { agyClaudeGpt: true }), windows);
});

test("other providers and unrelated future windows are unaffected", () => {
  assert.deepEqual(visibleWindows({ id: "claude", windows }, { agyClaudeGpt: false }), windows);
  const future = { id: "agy", windows: [{ id: "new_model" }, { kind: "weekly" }] };
  assert.deepEqual(visibleWindows(future, { agyClaudeGpt: false }), future.windows);
});

test("category filters still apply independently after the provider filter", () => {
  assert.deepEqual(visibleWindows(provider, { agyClaudeGpt: false })
    .filter(w => w.kind === "weekly").map(w => w.id), ["gemini_weekly"]);
});

test("elapsed share marks where usage would be if spread evenly", async () => {
  const { elapsedShare, parseTime, levelIndex } = await import("../mods/usage-limits/limit-windows.js");
  const now = Date.parse("2026-11-25T12:00:00Z");
  const session = { kind: "session", windowSeconds: 18000, resetsAt: "2026-11-25T16:00:00Z" };
  assert.ok(Math.abs(elapsedShare(session, now) - 0.2) < 1e-9);
  assert.equal(elapsedShare({ kind: "weekly", resetsAt: "2026-11-28T00:00:00Z" }, now) > 0.5, true);
  assert.equal(elapsedShare({ kind: "monthly", resetsAt: "2026-12-01T00:00:00Z" }, now) > 0.7, true);
  // A session without a duration is a 5-hour one; a reset already in the past gives no mark.
  assert.ok(Math.abs(elapsedShare({ kind: "session", resetsAt: "2026-11-25T16:00:00Z" }, now) - 0.2) < 1e-9);
  assert.equal(elapsedShare({ ...session, resetsAt: "2026-11-25T11:00:00Z" }, now), null);
  assert.equal(elapsedShare({ ...session, resetsAt: undefined }, now), null);
  assert.equal(parseTime("2026-11-25T16:00:00.123456+00:00"), Date.parse("2026-11-25T16:00:00.123Z"));
  assert.equal(Number.isNaN(parseTime("soon")), true);
});

test("usage turns yellow from 80% and red from 90%", async () => {
  const { levelIndex } = await import("../mods/usage-limits/limit-windows.js");
  assert.deepEqual([0, 59, 79.9, 80, 89.9, 90, 100].map(levelIndex), [0, 0, 0, 1, 1, 2, 2]);
});
