import { defineConfig, ms } from "@vplc/config";
export default defineConfig({
  name: "FrameAssembly",
  backend: "codesys",
  compiler: {
    tsconfig: "tsconfig.json",
    programs: { main: { module: "src/Main.ts", export: "main" } },
  },
  tasks: [
    {
      name: "MainTask",
      schedule: { kind: "cyclic", interval: ms(20) },
      priority: 1,
      programs: ["main"],
    },
  ],
  build: {
    template: "templates/local.project",
    outDir: "build/codesys",
    docker: { image: "vplc-build:3.5.22.30", cpuSet: "0-1" },
    symbols: true,
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
  },
  eds: "eds",
  devices: {},
  io: {},
  dependencies: {},
  codesys: {
    profile: { directAddressing: "byte" },
    programNames: { main: "Main" },
    publishGlobalLists: ["LineIO", "LineStations", "LineCollections", "LineScannerRequests"],
    globalListNames: {
      LineIO: "LineIO",
      LineConstants: "LineConstants",
      LineStations: "LineStations",
      LineCollections: "LineCollections",
      LineScannerRequests: "LineScannerRequests",
    },
  },
  monitor: { endpoint: "opc.tcp://127.0.0.1:4840" },
});
