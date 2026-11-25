import { join } from "node:path";
import type { AdapterContext, LimitWindow, ProviderAdapter, ProviderNotice, ProviderReport } from "../types.js";
import { finiteNumber, makeWindow, record, slugify, text } from "./shared.js";

// Same call Kiro's own /usage makes: the control plane's GetUsageLimits, with the sign-in kiro-cli keeps
// in its local database. quota-axi does not know Kiro, so this adapter runs whenever Kiro is installed.
const ORIGIN = "KIRO_CLI";
const DEFAULT_REGION = "us-east-1";
const REGIONS = ["us-east-1", "eu-central-1", "us-gov-east-1", "us-gov-west-1"];
const TOKEN_KEYS = ["kirocli:odic:token", "kirocli:social:token", "kirocli:external-idp:token"];
const PROFILE_KEY = "api.codewhisperer.profile";
const THIRTY_DAYS_SECONDS = 2_592_000;
const SQLITE_TIMEOUT_MS = 15_000;
const TIMEOUT_MS = 15_000;
const LOGIN = "Run kiro-cli login";

export function noticeFor(status: string, error: string): ProviderNotice | undefined {
  if (error.startsWith("token_expired")) return { message: "The Kiro CLI session expired.", action: "Open Kiro CLI to renew it" };
  if (error === "signed_out" || status === "auth_required") return { message: "Kiro CLI is signed out.", action: LOGIN };
  return undefined;
}

export function databasePath(context: Pick<AdapterContext, "env" | "platform" | "homeDirectory">): string {
  if (context.platform === "darwin") return join(context.homeDirectory, "Library", "Application Support", "kiro-cli", "data.sqlite3");
  const data = context.env.XDG_DATA_HOME ?? join(context.homeDirectory, ".local", "share");
  return join(data, "kiro-cli", "data.sqlite3");
}

interface KiroSession {
  accessToken: string;
  expiresAt?: number;
  region: string;
  profileArn?: string;
}

type SessionLookup =
  | { status: "found"; session: KiroSession }
  | { status: "failed"; report: ProviderReport };

function failure(status: string, error: string, extra: Partial<ProviderReport> = {}): ProviderReport {
  const report: ProviderReport = { provider: "kiro", label: "Kiro", source: "usage-limits", windows: [], state: { status, stale: false, error }, ...extra };
  const notice = noticeFor(status, error);
  if (notice) report.notice = notice;
  return report;
}

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

function regionOf(token: Record<string, unknown>, profileArn: string | undefined): string {
  const fromArn = profileArn?.split(":")[3];
  const region = text(token.region) ?? fromArn;
  return region && REGIONS.includes(region) ? region : DEFAULT_REGION;
}

// kiro-cli keeps the sign-in in a SQLite file; `sqlite3` is the one reader that needs no extra dependency.
async function lookupSession(context: AdapterContext): Promise<SessionLookup> {
  const database = databasePath(context);
  if (!await context.pathExists(database)) return { status: "failed", report: failure("auth_required", "kiro_cli_not_found", { notSetUp: true }) };

  const keys = [...TOKEN_KEYS, PROFILE_KEY].map(key => `'${key}'`).join(",");
  const query = `select key, value from auth_kv where key in (${keys}) union all select key, value from state where key in (${keys});`;
  let result;
  try {
    result = await context.runCommand("sqlite3", ["-readonly", "-json", database, query], SQLITE_TIMEOUT_MS);
  } catch (error) {
    return { status: "failed", report: failure("unavailable", `sqlite3_unavailable: ${error instanceof Error ? error.message : String(error)}`) };
  }
  if (result.code !== 0) return { status: "failed", report: failure("unavailable", `sqlite3_exit_${result.code}`) };

  const rows = result.stdout.trim() ? parseJson(result.stdout) : [];
  const values = new Map<string, string>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const entry = record(row);
      const key = text(entry?.key), value = text(entry?.value);
      if (key && value) values.set(key, value);
    }
  }

  const tokenKey = TOKEN_KEYS.find(key => values.has(key));
  const token = record(parseJson(tokenKey ? values.get(tokenKey) : undefined));
  const accessToken = text(token?.access_token);
  if (!token || !accessToken) return { status: "failed", report: failure("auth_required", "signed_out") };

  const profileArn = text(record(parseJson(values.get(PROFILE_KEY)))?.arn);
  const session: KiroSession = { accessToken, region: regionOf(token, profileArn) };
  const expiresAt = Date.parse(text(token.expires_at) ?? "");
  if (Number.isFinite(expiresAt)) session.expiresAt = expiresAt;
  if (profileArn !== undefined) session.profileArn = profileArn;
  return { status: "found", session };
}

// The API sends epoch seconds as a float (1.7960832E9); tolerate milliseconds too.
export function epochToIso(value: unknown): string | undefined {
  const number = finiteNumber(value);
  if (number === undefined || number <= 0) return undefined;
  const date = new Date(number < 1e11 ? number * 1000 : number);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function creditWindow(raw: unknown, fallbackReset: string | undefined): LimitWindow | undefined {
  const entry = record(raw);
  if (!entry) return undefined;
  const used = finiteNumber(entry.currentUsageWithPrecision) ?? finiteNumber(entry.currentUsage);
  const limit = finiteNumber(entry.usageLimitWithPrecision) ?? finiteNumber(entry.usageLimit);
  if (used === undefined || limit === undefined || limit <= 0) return undefined;
  const resource = text(entry.resourceType) ?? "CREDIT";
  const label = text(entry.displayNamePlural) ?? text(entry.displayName) ?? "Credits";
  const id = resource === "CREDIT" ? "credits" : slugify(resource);
  const window = makeWindow(id, label, "monthly", used / limit * 100, epochToIso(entry.nextDateReset) ?? fallbackReset, THIRTY_DAYS_SECONDS);
  window.amount = { used, limit, unit: label.toLowerCase() };
  return window;
}

export function normalizeUsage(raw: unknown): { windows: LimitWindow[]; plan?: string } {
  const data = record(raw);
  if (!data) return { windows: [] };
  const fallbackReset = epochToIso(data.nextDateReset);
  const list = Array.isArray(data.usageBreakdownList) ? data.usageBreakdownList : [];
  const windows = list.map(entry => creditWindow(entry, fallbackReset)).filter((window): window is LimitWindow => window !== undefined);
  const plan = text(record(data.subscriptionInfo)?.subscriptionTitle);
  return plan === undefined ? { windows } : { windows, plan: titleCase(plan) };
}

// "KIRO POWER" -> "Kiro Power"
function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

export const kiroAdapter: ProviderAdapter = {
  id: "kiro",
  async read(context) {
    const lookup = await lookupSession(context);
    if (lookup.status === "failed") return lookup.report;
    const { session } = lookup;
    // Never refresh: kiro-cli rotates its own token and renews it the next time it runs.
    if (session.expiresAt !== undefined && session.expiresAt <= context.now()) return failure("auth_required", "token_expired (open Kiro CLI to renew it)");

    const url = new URL(`https://management.${session.region}.kiro.dev/Get-Usage-Limits`);
    url.searchParams.set("origin", ORIGIN);
    if (session.profileArn !== undefined) url.searchParams.set("profileArn", session.profileArn);
    let response: Response;
    try {
      response = await context.fetch(url, {
        headers: { authorization: `Bearer ${session.accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return failure("unavailable", `network: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 403) {
      // Accounts whose plan has no usage endpoint answer 403 with this reason; that is not an expired session.
      const body = await response.text().catch(() => "");
      if (body.includes("FEATURE_NOT_SUPPORTED")) return failure("unavailable", "feature_not_supported", { notSetUp: true });
      return failure("auth_required", "token_expired (open Kiro CLI to renew it)");
    }
    if (response.status === 401) return failure("auth_required", "token_expired (open Kiro CLI to renew it)");
    if (!response.ok) return failure(response.status === 429 ? "rate_limited" : "error", `http_${response.status}`);

    const { windows, plan } = normalizeUsage(await response.json().catch(() => undefined));
    if (windows.length === 0) return failure("error", "usage_response_without_windows");
    const report: ProviderReport = { provider: "kiro", label: "Kiro", source: "usage-limits:kiro-cli", windows, state: { status: "fresh", stale: false } };
    if (plan !== undefined) report.plan = plan;
    return report;
  },
};
