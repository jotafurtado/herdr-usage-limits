// Prefer usage-limits (quota-axi plus our per-provider fallbacks, from this repository's cli/),
// and use quota-axi directly when usage-limits is not installed.
// npm installs a .cmd shim on Windows, which cannot be spawned as a native executable.
// Keep exec injectable so the fallbacks and machine forwarding can be checked without Herdr.
export const COMMANDS = [
  ["usage-limits", ["--json"]],
  ["quota-axi", ["--json", "--allow-keychain-prompt"]],
];

// Login-shell fallback for apps started from the Dock, which miss PATH entries set in rc files.
export const SHELL_SCRIPT = 'if command -v usage-limits >/dev/null 2>&1; then exec usage-limits --json; else exec quota-axi --json --allow-keychain-prompt; fi';

export async function runUsageCommand(exec, options = {}) {
  let firstError;
  for (const [command, args] of COMMANDS) {
    try {
      return await exec(command, args, options);
    } catch (startError) {
      firstError ??= startError;
      try {
        // Fixed command only: never interpolate paths, credentials or caller arguments into cmd.
        return await exec("cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], options);
      } catch {
        // Try the next command; on Unix the login-shell fallback handles PATH discovery.
      }
    }
  }
  throw firstError;
}
