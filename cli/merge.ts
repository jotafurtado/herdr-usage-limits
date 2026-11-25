import type { AdapterContext, FallbackRecord, ProviderAdapter, ProviderReport, UsageLimitsSettings, UsageReport } from "./types.js";

const FAILED_STATUSES = new Set(["auth_required", "error", "unavailable"]);

export function fallbackReason(provider: ProviderReport | undefined, forced: boolean): FallbackRecord["reason"] | undefined {
  if (forced) return "forced";
  if (!provider) return "missing";
  if (provider.windows.length === 0) return "no_windows";
  if (provider.state && FAILED_STATUSES.has(provider.state.status)) return "failed_status";
  return undefined;
}

// quota-axi stays the source of truth. A provider is handed to our adapter only when quota-axi
// failed to read it (or the settings force it); if our adapter fails too, quota-axi's entry stays.
export async function mergeReports(
  base: UsageReport | undefined,
  adapters: ProviderAdapter[],
  settings: UsageLimitsSettings,
  context: AdapterContext,
): Promise<{ report: UsageReport; fallbacks: FallbackRecord[] }> {
  const providers = [...(base?.providers ?? [])];
  const fallbacks: FallbackRecord[] = [];
  const active = adapters.filter(adapter => !settings.disable.includes(adapter.id));

  const results = await Promise.all(active.map(async adapter => {
    const index = providers.findIndex(provider => provider.provider === adapter.id);
    const current = index >= 0 ? providers[index] : undefined;
    const reason = fallbackReason(current, settings.force.includes(adapter.id));
    if (!reason) return undefined;
    let own: ProviderReport;
    try {
      own = await adapter.read(context);
    } catch (error) {
      own = { provider: adapter.id, windows: [], state: { status: "error", error: error instanceof Error ? error.message : String(error) } };
    }
    return { adapter, reason, own };
  }));

  for (const result of results) {
    if (!result) continue;
    const { adapter, reason, own } = result;
    const index = providers.findIndex(provider => provider.provider === adapter.id);
    const current = index >= 0 ? providers[index] : undefined;
    if (own.windows.length > 0) {
      if (index >= 0) providers[index] = own; else providers.push(own);
      fallbacks.push({ provider: adapter.id, reason, outcome: "replaced" });
      continue;
    }
    // The provider isn't installed here and quota-axi doesn't list it: leave it out of the report.
    if (!current && own.notSetUp) {
      fallbacks.push({ provider: adapter.id, reason, outcome: "skipped", error: own.state?.error ?? "not_set_up" });
      continue;
    }
    const error = own.state?.error ?? own.state?.status ?? "no windows";
    // Nothing better than quota-axi: keep its entry (or ours, when quota-axi had none) and say why.
    if (current) providers[index] = { ...current, usageLimitsError: error, ...(own.notice ? { notice: own.notice } : {}) };
    else providers.push(own);
    fallbacks.push({ provider: adapter.id, reason, outcome: "kept_quota_axi", error });
  }

  return {
    report: { ...(base ?? {}), generatedAt: new Date(context.now()).toISOString(), providers },
    fallbacks,
  };
}
