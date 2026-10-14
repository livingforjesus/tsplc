import { expect, it } from "bun:test";
import {
  codesysCommand,
  codesysCommandFilename,
  commandArgumentSchema,
  getHostCommand,
} from "./codesys-command";

const wineConfig = {
  commandProcessor: "cmd.exe",
  wine: {
    binary: "wine",
    prefix: "/prefix",
    pathBinary: "winepath",
    debug: "-all",
    nativeExit: false,
  },
};

it.each(["C:\\PLC projects\\A&B!100%.exe", "CODESYS V3.5 SP22 Patch 3"])(
  "preserves a quoted Windows command value %s",
  (value) => {
    expect(commandArgumentSchema.parse(value)).toBe(value);
  },
);

it.each(["", "   ", 'bad" & echo injected', "bad\ncommand", "bad\rcommand", "bad\0value"])(
  "rejects a value that can escape a quoted command argument %j",
  (value) => {
    expect(() => commandArgumentSchema.parse(value)).toThrow();
  },
);

it("uses the Windows command processor without Wine", () => {
  const commandProcessor = "C:\\Windows\\System32\\cmd.exe";
  const command = getHostCommand({ commandProcessor }, "win32");
  expect(command).toEqual({
    args: ["/d", "/c", codesysCommandFilename],
    executable: commandProcessor,
  });
});

it("preserves the raw Windows status before reporting failure", () => {
  const lines = codesysCommand.split("\r\n");
  const call = lines.findIndex((line) => line.startsWith('"%CODESYS_BUILD_EXE%"'));
  expect(lines[call + 1]).toBe('set "CODESYS_BUILD_STATUS=%errorlevel%"');
  expect(lines[call + 2]).toBe(
    'if not "%CODESYS_BUILD_STATUS%"=="0" echo CODESYS Windows exit status: %CODESYS_BUILD_STATUS%',
  );
  expect(lines[call + 3]).toBe("exit /b %CODESYS_BUILD_STATUS%");
  expect(lines[1]).toBe("setlocal DisableDelayedExpansion");
});

it("gives macOS Wine workers a virtual terminal without shell parsing", () => {
  const command = getHostCommand(
    { ...wineConfig, wine: { ...wineConfig.wine, binary: "/Wine tools/wine" } },
    "darwin",
  );
  expect(command).toEqual({
    executable: "script",
    args: ["-q", "/dev/null", "/Wine tools/wine", "cmd", "/d", "/c", codesysCommandFilename],
  });
});

it("quotes Wine paths for util-linux script and returns the child exit status", () => {
  const command = getHostCommand(
    {
      ...wineConfig,
      wine: { ...wineConfig.wine, binary: "/Wine tools/a'b/wine" },
    },
    "linux",
  );
  expect(command).toEqual({
    executable: "script",
    args: ["-q", "-e", "-c", "'/Wine tools/a'\\''b/wine' 'cmd' '/d' '/c' 'run.cmd'", "/dev/null"],
  });
});
