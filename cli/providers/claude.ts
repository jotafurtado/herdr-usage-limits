import { join } from "node:path";
import type { AdapterContext, ProviderAdapter, ProviderReport, QuotaWindow } from "../types.js";

// Same endpoint and headers Claude Code uses for /usage.
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const USER_AGENT = "claude-code/2.1.202";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const FIVE_HOURS_SECONDS = 18_000;
const SEVEN_DAYS_SECONDS = 604_800;
const TIMEOUT_MS = 15_000;

interface ClaudeCredential {
  source: "env" | "credentials-file" | "keychain";
  accessToken: string;
  expiresAt?: number;
  plan?: string;
}

type CredentialLookup =
  | { status: "found"; credential: ClaudeCredential }
  | { status: "absent"; source: ClaudeCredential["source"] }
  | { status: "invalid"; source: ClaudeCredential["source"]; error: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// `security -w` prints the secret as hex when it holds bytes it does not consider printable.
export function decodeSecret(raw: string): string {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0 && !trimmed.startsWith("{")) {
    return Buffer.from(trimmed, "hex").toString("utf8");
  }
  return trimmed;
}

export function parseCredentialBlob(raw: string, source: ClaudeCredential["source"]): CredentialLookup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeSecret(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The position tells where the blob breaks without echoing any secret.
    return { status: "invalid", source, error: `json_parse_error (${message.replace(/"[^"]*"/g, "…").slice(0, 80)})` };
  }
  const data = record(parsed);
  const oauth = record(data?.claudeAiOauth) ?? data;
  const accessToken = text(oauth?.accessToken) ?? text(oauth?.access_token);
  // Claude Code blanks the tokens and stamps loginEnded when its refresh token expires.
  if (!accessToken && text(oauth?.loginEnded)) return { status: "invalid", source, error: "signed_out (run /login in Claude Code)" };
  if (!accessToken) return { status: "invalid", source, error: "access_token_missing" };
  const credential: ClaudeCredential = { source, accessToken };
  const expiresAt = finiteNumber(oauth?.expiresAt);
  if (expiresAt !== undefined) credential.expiresAt = expiresAt;
  const plan = text(oauth?.subscriptionType) ?? text(data?.subscriptionType);
  if (plan !== undefined) credential.plan = plan;
  return { status: "found", credential };
}

async function lookups(context: AdapterContext): Promise<CredentialLookup[]> {
  const found: CredentialLookup[] = [];
  const envToken = context.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (envToken) found.push({ status: "found", credential: { source: "env", accessToken: envToken } });

  const configDirectory = context.env.CLAUDE_CONFIG_DIR ?? join(context.homeDirectory, ".claude");
  const file = await context.readTextFile(join(configDirectory, ".credentials.json"));
  found.push(file === undefined ? { status: "absent", source: "credentials-file" } : parseCredentialBlob(file, "credentials-file"));

  // A custom CLAUDE_CONFIG_DIR uses a hashed Keychain service name; only the default one is read here.
  if (context.platform === "darwin" && !context.env.CLAUDE_CONFIG_DIR) {
    const account = context.env.USER ?? "";
    const result = await context.runCommand("security", ["find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"], 60_000)
      .catch(() => ({ code: -1, stdout: "", stderr: "" }));
    found.push(result.code === 0 ? parseCredentialBlob(result.stdout, "keychain") : { status: "absent", source: "keychain" });
  }
  return found;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
}

function makeWindow(id: string, label: string, kind: string, used: number, resetsAt: string | undefined, windowSeconds: number | undefined): QuotaWindow {
  const percentUsed = clampPercent(used);
  const window: QuotaWindow = { id, label, kind, percentUsed, percentRemaining: clampPercent(100 - percentUsed) };
  if (resetsAt !== undefined) window.resetsAt = resetsAt;
  if (windowSeconds !== undefined) window.windowSeconds = windowSeconds;
  return window;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function scopedWindow(raw: unknown): QuotaWindow | undefined {
  const entry = record(raw);
  const percent = finiteNumber(entry?.percent);
  if (!entry || percent === undefined) return undefined;
  const resetsAt = text(entry.resets_at);
  const model = record(record(entry.scope)?.model);
  const modelName = text(model?.display_name);
  if (modelName) return makeWindow(`model:${text(model?.id) ?? slugify(modelName)}`, `${modelName} week`, "model", percent, resetsAt, SEVEN_DAYS_SECONDS);
  const group = text(entry.group);
  if (group === "session") return makeWindow("five_hour", "session", "session", percent, resetsAt, FIVE_HOURS_SECONDS);
  if (group === "weekly") return makeWindow("seven_day", "week", "weekly", percent, resetsAt, SEVEN_DAYS_SECONDS);
  const kind = text(entry.kind) ?? "limit";
  return makeWindow(kind, kind, "unknown", percent, resetsAt, undefined);
}

function fixedWindow(raw: unknown, id: string, label: string, kind: string, seconds: number): QuotaWindow | undefined {
  const entry = record(raw);
  const used = finiteNumber(entry?.utilization);
  if (!entry || used === undefined) return undefined;
  return makeWindow(id, label, kind, used, text(entry.resets_at) ?? text(entry.reset_at), seconds);
}

// Mirrors quota-axi: the vendor's `limits` list wins; the fixed top-level windows are the fallback.
export function normalizeUsage(raw: unknown): QuotaWindow[] {
  const data = record(raw);
  if (!data) return [];
  const scoped = Array.isArray(data.limits)
    ? data.limits.map(scopedWindow).filter((window): window is QuotaWindow => window !== undefined)
    : [];
  if (scoped.length > 0) return scoped;
  return [
    fixedWindow(data.five_hour, "five_hour", "session", "session", FIVE_HOURS_SECONDS),
    fixedWindow(data.seven_day, "seven_day", "week", "weekly", SEVEN_DAYS_SECONDS),
    fixedWindow(data.seven_day_opus, "seven_day_opus", "opus week", "model", SEVEN_DAYS_SECONDS),
  ].filter((window): window is QuotaWindow => window !== undefined);
}

function failure(status: string, error: string, attempts: string[]): ProviderReport {
  return { provider: "claude", label: "Claude", source: "quota-plus", windows: [], state: { status, stale: false, error }, attempts };
}

async function fetchUsage(context: AdapterContext, credential: ClaudeCredential): Promise<{ windows: QuotaWindow[] } | { status: string; error: string }> {
  let response: Response;
  try {
    response = await context.fetch(USAGE_URL, {
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "anthropic-beta": OAUTH_BETA,
        "User-Agent": USER_AGENT,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { status: "unavailable", error: `network: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response.status === 401) return { status: "auth_required", error: "unauthorized" };
  if (!response.ok) return { status: response.status === 429 ? "rate_limited" : "error", error: `http_${response.status}` };
  const windows = normalizeUsage(await response.json().catch(() => undefined));
  return windows.length > 0 ? { windows } : { status: "error", error: "usage_response_without_windows" };
}

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  async read(context) {
    const attempts: string[] = [];
    let lastFailure: { status: string; error: string } = { status: "auth_required", error: "credentials_missing" };
    for (const lookup of await lookups(context)) {
      if (lookup.status === "absent") { attempts.push(`${lookup.source}: missing`); continue; }
      if (lookup.status === "invalid") {
        attempts.push(`${lookup.source}: ${lookup.error}`);
        lastFailure = { status: "auth_required", error: `${lookup.source} ${lookup.error}` };
        continue;
      }
      const { credential } = lookup;
      // Never refresh: Anthropic rotates the refresh token on use, which would sign Claude Code out.
      // Claude Code renews the token itself the next time it runs.
      if (credential.expiresAt !== undefined && credential.expiresAt <= context.now()) {
        attempts.push(`${credential.source}: expired`);
        lastFailure = { status: "auth_required", error: "token_expired (open Claude Code to renew it)" };
        continue;
      }
      const result = await fetchUsage(context, credential);
      if ("windows" in result) {
        attempts.push(`${credential.source}: ok`);
        const report: ProviderReport = {
          provider: "claude", label: "Claude", source: `quota-plus:${credential.source}`,
          windows: result.windows, state: { status: "fresh", stale: false }, attempts,
        };
        if (credential.plan !== undefined) report.plan = credential.plan;
        return report;
      }
      attempts.push(`${credential.source}: ${result.error}`);
      lastFailure = result;
    }
    return failure(lastFailure.status, lastFailure.error, attempts);
  },
};
