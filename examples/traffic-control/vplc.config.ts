import { defineConfig, ms } from "@vplc/config";
export default defineConfig({
  name: "TrafficControl",
  backend: "codesys",
  compiler: {
    tsconfig: "tsconfig.json",
    programs: { main: { module: "src/main.ts", export: "main" } },
  },
  tasks: [
    {
      name: "MainTask",
      schedule: { kind: "cyclic", interval: ms(5) },
      priority: 1,
      programs: ["main"],
    },
  ],
  build: {
    template: "../templates/virtual.project",
    docker: { cpuSet: "0-1" },
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
  codesys: { profile: { directAddressing: "byte" }, programNames: { main: "Main" } },
});
