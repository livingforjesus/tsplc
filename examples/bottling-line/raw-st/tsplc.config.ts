import { defineConfig, ms } from "@tsplc/config";

// Raw Structured Text mode: no `compiler` section. The vendor compiler receives the
// authored ST under build.sourceDir; build.entry names the entry program.
export default defineConfig({
  name: "BottlingLineST",
  backend: "codesys",
  tasks: [
    {
      name: "MainTask",
      schedule: { kind: "cyclic", interval: ms(20) },
      priority: 1,
      programs: ["Main"],
    },
  ],
  build: {
    template: "../../templates/virtual.project",
    sourceDir: "src",
    entry: "src/Main.st",
    outDir: "build/codesys",
    docker: { image: "tsplc-build:3.5.22.30", cpuSet: "0-1" },
    symbols: true,
    removeObjects: ["PLC_PRG"],
  },
  dependencies: { Standard: "3.5.22.0" },
  eds: "../eds",
  devices: {
    conveyor: {
      file: "../eds/ConveyLinx_V5_10_CODESYS.eds",
      connection: "Connection1",
      inputs: { assembly: 105, address: "%IB512" },
      outputs: { assembly: 106, address: "%QB512" },
    },
  },
  codesys: { profile: { directAddressing: "byte", numericAddressing: "byte" } },
  // Raw ST bindings use qualified Object.Variable names. They are applied to the
  // declarations in memory; the authored files stay unchanged.
  io: {
    "IO.StartButton": { address: "%IX700.0", type: "BOOL" },
    "IO.BottlePresent": { address: "%IX700.1", type: "BOOL" },
    "IO.CapperRun": { address: "%QX700.0", type: "BOOL" },
    "IO.ZoneStatus": { device: "conveyor", channel: "inputs.Zone_Status_Upstream" },
    "IO.InfeedSpeed": { device: "conveyor", channel: "outputs.Speed_Left" },
  },
});
