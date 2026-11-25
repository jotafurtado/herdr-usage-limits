import { claudeAdapter } from "./providers/claude.js";
import { kiroAdapter } from "./providers/kiro.js";
import type { ProviderAdapter } from "./types.js";

// Add an adapter here when quota-axi cannot read a provider we need.
export const ADAPTERS: ProviderAdapter[] = [claudeAdapter, kiroAdapter];
