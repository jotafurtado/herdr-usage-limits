import { join } from "node:path";
import type { AdapterContext, UsageLimitsSettings } from "./types.js";

const EMPTY: UsageLimitsSettings = { force: [], disable: [] };

function listFromEnv(value: string | undefined): string[] {
  return (value ?? "").split(",").map(item => item.trim()).filter(item => item.length > 0);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// ~/.config/usage-limits/config.json: {"force": ["claude"], "disable": []}.
// USAGE_LIMITS_FORCE and USAGE_LIMITS_DISABLE (comma lists) are added to the file values.
export async function loadSettings(context: Pick<AdapterContext, "env" | "homeDirectory" | "readTextFile">): Promise<UsageLimitsSettings> {
  const base = context.env.XDG_CONFIG_HOME ?? join(context.homeDirectory, ".config");
  const raw = await context.readTextFile(join(base, "usage-limits", "config.json"));
  let fromFile = EMPTY;
  if (raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        fromFile = { force: stringList(record.force), disable: stringList(record.disable) };
      }
    } catch {
      fromFile = EMPTY;
    }
  }
  return {
    force: [...new Set([...fromFile.force, ...listFromEnv(context.env.USAGE_LIMITS_FORCE)])],
    disable: [...new Set([...fromFile.disable, ...listFromEnv(context.env.USAGE_LIMITS_DISABLE)])],
  };
}
