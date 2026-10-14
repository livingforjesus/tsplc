import { defineConfig } from "@vplc/config";

export default defineConfig({
  backend: "codesys",
  build: {
    template: "../templates/virtual.project",
    sourceDir: "src",
    entry: "src/Main.st",
    docker: { image: "vplc-build:3.5.22.30", cpuSet: "0-1" },
    symbols: true,
    removeObjects: ["PLC_PRG"],
  },
  dependencies: { Standard: "3.5.22.0" },
});
