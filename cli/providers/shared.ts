import type { LimitWindow } from "../types.js";

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
}

export function makeWindow(id: string, label: string, kind: string, used: number, resetsAt: string | undefined, windowSeconds: number | undefined): LimitWindow {
  const percentUsed = clampPercent(used);
  const window: LimitWindow = { id, label, kind, percentUsed, percentRemaining: clampPercent(100 - percentUsed) };
  if (resetsAt !== undefined) window.resetsAt = resetsAt;
  if (windowSeconds !== undefined) window.windowSeconds = windowSeconds;
  return window;
}

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
