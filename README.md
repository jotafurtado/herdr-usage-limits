# Usage Limits

See your AI usage limits and reset times inside [Herdr](https://herdr.dev).
Usage Limits adds a compact status strip and a popup with two tabs: **Usage** for your limits,
and **Display** for choosing what appears. Usage data comes from
[quota-axi](https://github.com/kunchenguid/quota-axi), using the provider accounts already
authenticated on your computer.

![Usage Limits: status strip with progress bars, followed by Usage and Display](preview.png)

These are native Herdr captures of the current mod, using illustrative usage data in an isolated
preview layout. They contain no terminal content or account identifiers. Values and plans are examples.

## Install

Tell your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/jotafurtado/herdr-usage-limits
```

## What it shows

- **Usage per limit**, not one combined percentage for an entire provider. Session, weekly,
  monthly and model-specific limits can appear separately when quota-axi reports them.
- **Reset countdowns** for limits with a future reset time.
- **Provider and plan names** when available. Claude, Codex, Antigravity and other supported
  providers appear according to the data returned by quota-axi.
- **Warning triangle**: bars stay green. From 80% used a ▲ follows the percentage, yellow until 90%
  and red above, in the strip and in the popup. Colors come from the active theme's palette.
- **Pace mark**: a tick on every bar marks how much of the window has elapsed, that is, where usage
  would be if spread evenly (1h into a 5-hour window: 20%). Usage left of the tick is behind pace,
  right of it is ahead. The popup says by how many points (`19 pts behind pace`). Sessions count as 5 hours, weeks as 7 days and
  months as 30 days when the provider does not report a duration.

Percentages mean **share of the limit used**. The mod displays the provider's reported windows; it cannot
create a per-model breakdown when the provider only reports a shared allowance. Available
providers and limits depend on quota-axi and your local sign-ins.

## Usage and Display

Click or right-click the status strip to open the popup.

**Usage** groups available limits by provider, with percentages and reset countdowns.
Providers hidden from the strip remain accessible under **Other providers**.

**Display** lets you:

- Show or hide each provider in the strip.
- Select session, weekly, monthly and model-specific limit types for the strip.
- Hide Antigravity's Claude/GPT limits independently of its Gemini limits.
- Show provider names or signed-out providers in the strip.
- Enable **Percentages only (no bars)** in both the strip and popup.
- Enable **Credit Amounts** to also show the absolute amount behind a percentage (for example
  `1,867 of 10,000 credits` for Kiro) in the popup and in the strip tooltip. Off by default.

Preferences apply immediately and persist across restarts. The strip uses compact labels such
as `5h` and `7d`. A monthly window is labeled `30d` only when its reported duration is exactly
30 days; otherwise it uses `mês`.

## Refresh and preferences

Limits refresh automatically every two minutes. Select **Refresh** to update them immediately; the button reads `Refreshing…` until the new data arrives.
Your display preferences are saved locally and retained across restarts.

If a provider is missing, check the filters in Display. On macOS, Claude's sign-in is read from the
Keychain: approve the prompt with **Always Allow** if it appears. Your agent can check the dependency
and provider sign-ins when needed. Usage Limits reuses existing sign-ins and does not save access tokens.

## The usage-limits CLI: filling gaps in quota-axi

quota-axi stays the data source. `usage-limits` (in `cli/`) runs `quota-axi --json` and, for each
provider quota-axi could not read (no windows, or `auth_required`, `error`, `unavailable`), tries
this repository's own adapter for that provider. When the adapter also fails, quota-axi's entry is
kept, with the reason in `usageLimitsError`. The mod runs `usage-limits` when it is installed and falls
back to `quota-axi` otherwise, so quota-axi updates keep flowing in without changes here.

```sh
npm install && npm run build && npm install -g .   # installs the usage-limits command
usage-limits --explain                                #  JSON on stdout, fallback decisions on stderr
```

Adapters: `claude` and `kiro`.

`claude` reads the environment token, `~/.claude/.credentials.json` or the macOS Keychain, then
Anthropic's OAuth usage endpoint. It never refreshes tokens, which would sign Claude Code out.
A token from `claude setup-token` only has the inference scope, so the usage endpoint refuses it.
When Claude can't be read, the report carries a `notice` (`message` and `action`), and the mod keeps
Claude in the strip with **Run /login**, explaining why in the tooltip and in the popup.

`kiro` covers what quota-axi does not list. It reads kiro-cli's sign-in from its local SQLite
database (`~/Library/Application Support/kiro-cli/data.sqlite3` on macOS, `$XDG_DATA_HOME/kiro-cli`
or `~/.local/share/kiro-cli` elsewhere, through the `sqlite3` command) and calls the same
`Get-Usage-Limits` endpoint as Kiro's `/usage`. Credits appear as one monthly window with its reset
date, and the absolute amount is available through **Credit Amounts**. It never refreshes the token,
so after the session expires Kiro shows **Open Kiro CLI to renew it** until kiro-cli runs again.
Kiro is left out when kiro-cli is not installed. Verified on macOS with an IAM Identity Center
sign-in; other sign-in methods and platforms are untested.

To always use an adapter, or never, set `{"force": ["claude"], "disable": []}` in
`~/.config/usage-limits/config.json`, or `USAGE_LIMITS_FORCE` / `USAGE_LIMITS_DISABLE`.
To add one, write `cli/providers/<id>.ts` implementing `ProviderAdapter` and register it in
`cli/adapters.ts`.

## Credits and license

Independently maintained by [jotafurtado](https://github.com/jotafurtado), based on
[Lakris2407's original mod](https://github.com/Lakris2407/herdr-quota). Usage data is supplied by
[quota-axi](https://github.com/kunchenguid/quota-axi), by kunchenguid. Herdr supplies its mod API
and installed provider icons; additional bundled provider icons retain the LobeHub MIT notice.

MIT, with the original copyright preserved. See [LICENSE](LICENSE), [CREDITS.md](CREDITS.md),
[maintenance direction](MAINTENANCE.md) and [publishing on Herdr Mods](PUBLISHING.md).
