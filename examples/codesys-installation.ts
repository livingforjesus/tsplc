import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { codesys } from "@vplc/compiler/codesys";

const prefix = process.env.CODESYS_WINEPREFIX ?? join(homedir(), ".wine.codesys");
const profile = process.env.CODESYS_PROFILE ?? "CODESYS V3.5 SP22 Patch 3";

// Host settings belong to the engineering configuration, outside PLC source.
const installation =
  process.platform === "win32"
    ? {
        executable: process.env.CODESYS_EXE ?? "C:/CODESYS-3.5.22.30/CODESYS/Common/CODESYS.exe",
        profile,
      }
    : {
        executable:
          process.env.CODESYS_EXE ??
          join(prefix, "drive_c/CODESYS-3.5.22.30/CODESYS/Common/CODESYS.exe"),
        profile,
        wine: {
          prefix,
          binary:
            process.env.CODESYS_WINE ??
            (process.platform === "darwin" ? "/opt/local/bin/wine" : "wine"),
          pathBinary:
            process.env.CODESYS_WINEPATH ??
            (process.platform === "darwin" ? "/opt/local/bin/winepath" : "winepath"),
          nativeExit: true,
        },
      };

// The examples share the verified virtual target. Each build copies this template
// and replaces its task plan; the upstream hardware and visualization stay archived.
export const engineering = {
  kind: "v3.5",
  build: {
    codesys: installation,
    template: join(dirname(fileURLToPath(import.meta.url)), "templates/virtual.project"),
    removeObjects: [
      "PLC_PRG",
      "Visualization Manager",
      "VISU_TASK",
      "LineView",
      "__VisualizationStyle",
      "Communication Manager",
      "Line_IO",
      "ST_WebPayload",
    ],
    symbols: true,
  },
} satisfies Parameters<typeof codesys>[0]["engineering"];
