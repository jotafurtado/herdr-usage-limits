import type { CommandRunner, QuotaReport } from "./types.js";

const QUOTA_AXI_TIMEOUT_MS = 90_000;

export type QuotaAxiOutcome =
  | { ok: true; report: QuotaReport }
  | { ok: false; error: string };

export async function readQuotaAxi(runCommand: CommandRunner, extraArgs: string[] = []): Promise<QuotaAxiOutcome> {
  let result;
  try {
    result = await runCommand("quota-axi", ["--json", "--allow-keychain-prompt", ...extraArgs], QUOTA_AXI_TIMEOUT_MS);
  } catch (error) {
    return { ok: false, error: `quota-axi did not start: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim().split("\n").pop() ?? "";
    return { ok: false, error: `quota-axi exited ${result.code}${detail ? `: ${detail}` : ""}` };
  }
  const start = result.stdout.indexOf("{");
  if (start < 0) return { ok: false, error: "quota-axi printed no JSON" };
  try {
    const parsed: unknown = JSON.parse(result.stdout.slice(start));
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as QuotaReport).providers)) {
      return { ok: false, error: "quota-axi JSON has no providers list" };
    }
    return { ok: true, report: parsed as QuotaReport };
  } catch {
    return { ok: false, error: "quota-axi JSON could not be parsed" };
  }
}
