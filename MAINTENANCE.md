# Independent maintenance

Decision recorded on 2026-11-01.

## Direction

Usage Limits ([jotafurtado/herdr-usage-limits](https://github.com/jotafurtado/herdr-usage-limits)) is maintained independently
by jotafurtado as a focused usage-limits mod for Herdr.

The original author moved development into [Lakris2407/herdr-mods](https://github.com/Lakris2407/herdr-mods),
a broader collection of mods.
This fork keeps a narrower direction: model and provider limits, usage, reset times and the
preferences needed to show that information clearly.

This decision concerns this fork only. It does not claim ownership of the original project,
the Herdr application, quota-axi or the upstream collection, and does not imply endorsement
by their authors. On 2026-11-04 the repository was detached from GitHub's fork network to
allow catalog discovery; its Git history and attribution were preserved.

## Rename

On 2026-11-24 the mod was renamed from Agent Quota to Usage Limits, following the term the
providers themselves use. The repository became `jotafurtado/herdr-usage-limits`, the mod
folder `mods/usage-limits` and the CLI `usage-limits` (formerly `quota-plus`). Its shared state
keys, key actions and settings (`~/.config/usage-limits/config.json`, `USAGE_LIMITS_FORCE`,
`USAGE_LIMITS_DISABLE`) changed with it. quota-axi keeps its own name: it is an external dependency.

## Scope

- Maintain usage fetching, normalization, display and preferences.
- Review relevant upstream fixes individually, retaining their attribution and license notices.
- Distribute only usage-related code, documentation and assets. Unrelated modules and inherited
  preview images were removed from the current tree on 2026-11-03; their history is preserved.
- Describe platform support according to what has actually been implemented and verified.

## Current code and publication

The repository source now includes the Usage and Display interface, the Windows npm launcher,
percentage normalization, Antigravity filtering and percentage-only display. The screenshots
are generated from this source in an isolated Herdr profile with illustrative usage data.
Personal terminal content, account identifiers and local executable paths are not included.

Community publication follows [PUBLISHING.md](PUBLISHING.md). Recording this decision does not
publish a release, change GitHub repository settings or submit the mod to a catalog.

## Attribution

Keep the original Git history and the Lakris2407 copyright notice. Retain contributor credits
when incorporating changes. The fork remains under MIT; see [LICENSE](LICENSE) and
[CREDITS.md](CREDITS.md).
