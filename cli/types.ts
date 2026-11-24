// Shapes shared with quota-axi --json (schemaVersion 5). Only the fields the mod reads are typed;
// everything else quota-axi reports passes through untouched.

export interface LimitWindow {
  id: string;
  label: string;
  kind: string;
  percentUsed?: number;
  percentRemaining?: number;
  resetsAt?: string;
  windowSeconds?: number;
  [extra: string]: unknown;
}

export interface ProviderState {
  status: string;
  stale?: boolean;
  error?: string;
  [extra: string]: unknown;
}

// Something the person can do to make a provider readable again, shown by the mod.
export interface ProviderNotice {
  message: string;
  action: string;
}

export interface ProviderReport {
  provider: string;
  notice?: ProviderNotice;
  label?: string;
  plan?: string;
  source?: string;
  windows: LimitWindow[];
  state?: ProviderState;
  [extra: string]: unknown;
}

export interface UsageReport {
  generatedAt: string;
  schemaVersion?: number;
  providers: ProviderReport[];
  [extra: string]: unknown;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], timeoutMs: number) => Promise<CommandResult>;

export interface AdapterContext {
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  homeDirectory: string;
  now: () => number;
  readTextFile: (path: string) => Promise<string | undefined>;
  runCommand: CommandRunner;
  fetch: typeof fetch;
}

export interface ProviderAdapter {
  id: string;
  read(context: AdapterContext): Promise<ProviderReport>;
}

export interface UsageLimitsSettings {
  // Providers whose own adapter always replaces quota-axi.
  force: string[];
  // Providers whose own adapter never runs.
  disable: string[];
}

export interface FallbackRecord {
  provider: string;
  reason: "forced" | "missing" | "no_windows" | "failed_status";
  outcome: "replaced" | "kept_quota_axi";
  error?: string;
}
