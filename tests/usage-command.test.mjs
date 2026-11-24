import assert from "node:assert/strict";
import { test } from "node:test";
import { runUsageCommand, SHELL_SCRIPT } from "../mods/usage-limits/usage-command.js";

test("usage-limits runs first and its success does not invoke anything else", async () => {
  const calls = [];
  const result = { code: 0, stdout: '{"providers":[]}' };
  assert.equal(await runUsageCommand(async (...args) => { calls.push(args); return result; }), result);
  assert.deepEqual(calls, [["usage-limits", ["--json"], {}]]);
});

test("without usage-limits, quota-axi runs directly and the target machine is preserved", async () => {
  const calls = [], options = { on: "windows-host" }, result = { code: 0, stdout: "{}" };
  const actual = await runUsageCommand(async (...args) => {
    calls.push(args);
    if (args[0] !== "quota-axi") throw new Error("cannot spawn");
    return result;
  }, options);
  assert.equal(actual, result);
  assert.deepEqual(calls, [
    ["usage-limits", ["--json"], options],
    ["cmd.exe", ["/d", "/s", "/c", "usage-limits --json"], options],
    ["quota-axi", ["--json", "--allow-keychain-prompt"], options],
  ]);
});

test("spawn failure uses the fixed npm shim command", async () => {
  const calls = [], result = { code: 0, stdout: "{}" };
  const actual = await runUsageCommand(async (...args) => {
    calls.push(args);
    if (args[0] !== "cmd.exe") throw new Error("cannot spawn .cmd");
    return result;
  });
  assert.equal(actual, result);
  assert.deepEqual(calls.at(-1), ["cmd.exe", ["/d", "/s", "/c", "usage-limits --json"], {}]);
});

test("a CLI error is returned without invoking another command", async () => {
  let calls = 0;
  const result = { code: 1, stderr: "authentication failed" };
  assert.equal(await runUsageCommand(async () => { calls++; return result; }), result);
  assert.equal(calls, 1);
});

test("when nothing can start, the first error is kept for the Unix login-shell fallback", async () => {
  const original = new Error("usage-limits not on PATH");
  await assert.rejects(runUsageCommand(async command => {
    throw command === "usage-limits" ? original : new Error(`${command} not found`);
  }), error => error === original);
});

test("the login-shell script prefers usage-limits and has no single quotes", () => {
  assert.match(SHELL_SCRIPT, /command -v usage-limits/);
  assert.equal(SHELL_SCRIPT.includes("'"), false);
});
