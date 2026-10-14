import { resolveConfig, type ResolvedConfig } from "../src/config.ts";

/** Only the Docker entrypoint disables dispatch after validating its request. */
export function resolveContainerConfig(input: unknown, configFile: string): ResolvedConfig {
  const config = resolveConfig(input, configFile);
  if (config.codesys.wine) config.codesys.wine.debug = "-all,err+seh";
  return { ...config, docker: undefined };
}
