#!/usr/bin/env node
// quota-plus: quota-axi's report, with our own adapters filling in the providers it fails to read.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { ADAPTERS } from "./adapters.js";
import { mergeReports } from "./merge.js";
import { readQuotaAxi } from "./quota-axi.js";
import { loadSettings } from "./settings.js";
import type { AdapterContext, CommandResult } from "./types.js";

const USAGE = `usage: quota-plus [--json] [--explain] [quota-axi flags...]
  Runs quota-axi --json --allow-keychain-prompt and replaces each provider quota-axi fails to read
  (no windows, auth_required, error, unavailable) with quota-plus's own adapter when one exists.
  Adapters: ${ADAPTERS.map(adapter => adapter.id).join(", ")}
  --explain   print which providers fell back and why (stderr)
  Settings: ~/.config/quota-plus/config.json {"force": [], "disable": []}, QUOTA_PLUS_FORCE, QUOTA_PLUS_DISABLE.`;

function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") { reject(error); return; }
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(USAGE + "\n"); return 0; }
  const explain = argv.includes("--explain");
  const passThrough = argv.filter(arg => arg !== "--json" && arg !== "--explain" && arg !== "--allow-keychain-prompt");

  const context: AdapterContext = {
    env: process.env,
    platform: process.platform,
    homeDirectory: homedir(),
    now: () => Date.now(),
    readTextFile: path => readFile(path, "utf8").catch(() => undefined),
    runCommand,
    fetch: globalThis.fetch,
  };

  const [base, settings] = await Promise.all([readQuotaAxi(runCommand, passThrough), loadSettings(context)]);
  const { report, fallbacks } = await mergeReports(base.ok ? base.report : undefined, ADAPTERS, settings, context);
  report.quotaPlus = { quotaAxi: base.ok ? "ok" : base.error, fallbacks };

  if (explain) {
    if (!base.ok) process.stderr.write(`quota-axi: ${base.error}\n`);
    for (const item of fallbacks) {
      process.stderr.write(`${item.provider}: ${item.reason} -> ${item.outcome}${item.error ? ` (${item.error})` : ""}\n`);
    }
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  // Fail only when neither quota-axi nor any adapter produced something to show.
  return base.ok || report.providers.some(provider => provider.windows.length > 0) ? 0 : 1;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  process.stderr.write(`quota-plus: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
