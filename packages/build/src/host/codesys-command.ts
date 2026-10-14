export { commandArgumentSchema } from "@vplc/config/build";
import type { ResolvedConfig } from "../config";

export const codesysCommandFilename = "run.cmd";

// Keep arguments in the Windows command line: Wine's direct launcher loses the
// quoting CODESYS needs around profile names containing spaces.
const createCommand = (arguments_: string) =>
  [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    `"%CODESYS_BUILD_EXE%" --profile="%CODESYS_BUILD_PROFILE%" ${arguments_}`,
    'set "CODESYS_BUILD_STATUS=%errorlevel%"',
    'if not "%CODESYS_BUILD_STATUS%"=="0" echo CODESYS Windows exit status: %CODESYS_BUILD_STATUS%',
    "exit /b %CODESYS_BUILD_STATUS%",
    "",
  ].join("\r\n");

export const codesysCommand = createCommand('--noUI --runscript="%CODESYS_BUILD_SCRIPT%"');

export const editorCommand = createCommand('--project="%CODESYS_BUILD_PROJECT%"');

export const getHostCommand = (
  config: Pick<ResolvedConfig["codesys"], "commandProcessor" | "wine">,
  platform: NodeJS.Platform = process.platform,
  headless = true,
) => {
  if (platform === "win32") {
    return {
      args: ["/d", "/c", codesysCommandFilename],
      executable: config.commandProcessor,
    };
  }
  const wine = config.wine?.binary ?? "wine";
  const args = ["cmd", "/d", "/c", codesysCommandFilename];
  if (!headless) {
    return { args, executable: wine };
  }
  // --noUI suppresses the IDE, but CODESYS can still allocate a Wine console.
  // A private PTY makes Wine use its Unix console instead of a desktop window.
  return {
    args:
      platform === "darwin"
        ? ["-q", "/dev/null", wine, ...args]
        : [
            "-q",
            "-e",
            "-c",
            [wine, ...args].map((argument) => `'${argument.replaceAll("'", "'\\''")}'`).join(" "),
            "/dev/null",
          ],
    executable: "script",
  };
};
