import type { ResolvedVplcConfig } from "@vplc/config/schema";
import type { InputBoxOptions, SecretStorage } from "vscode";

type MonitorConfig = NonNullable<ResolvedVplcConfig["monitor"]>;

export function monitorPasswordKey(endpoint: string, username: string): string {
  return `vplc.monitor.password:${JSON.stringify([endpoint, username])}`;
}

/** Resolve a password without putting it in config, a snapshot or the webview. */
export async function monitorPassword(
  monitor: MonitorConfig,
  secrets: Pick<SecretStorage, "get" | "store">,
  prompt: (options: InputBoxOptions) => Thenable<string | undefined>,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined | null> {
  if (!monitor.username) return undefined;
  if (monitor.passwordEnv) {
    const password = environment[monitor.passwordEnv];
    if (password === undefined)
      throw new Error(`Environment variable ${monitor.passwordEnv} is not set in VS Code.`);
    return password;
  }
  const key = monitorPasswordKey(monitor.endpoint, monitor.username);
  const saved = await secrets.get(key);
  if (saved !== undefined) return saved;
  const password = await prompt({
    title: "vPLC monitor password",
    prompt: `Password for ${monitor.username} at ${monitor.endpoint}. Saved in VS Code SecretStorage.`,
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) return null;
  await secrets.store(key, password);
  return password;
}
