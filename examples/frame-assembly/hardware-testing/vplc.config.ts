import { defineConfig, ms } from "@vplc/config";
import type { HardwareIoMapping } from "./generated/hardware.ts";

// Test addresses belong to the virtual process image. This profile checks EDS
// layout and code generation; the production scanner topology is template-owned.
export default defineConfig({
  backend: "codesys",
  name: "FrameHardwareTest",
  compiler: { programs: { main: { module: "src/main.ts", export: "main" } } },
  tasks: [
    {
      name: "MainTask",
      schedule: { kind: "cyclic", interval: ms(20) },
      priority: 1,
      programs: ["main"],
    },
  ],
  build: {
    template: "../templates/local.project",
    outDir: "build",
    docker: { image: "vplc-build:3.5.22.30", cpuSet: "0-1" },
    symbols: true,
    removeObjects: ["PLC_PRG", "Visualization Manager", "VISU_TASK"],
  },
  eds: "../eds",
  devices: {
    scanner: {
      file: "../eds/0678077312900100.eds",
      connection: "Connection1",
      inputs: { assembly: 11, address: "%IB0" },
      outputs: { assembly: 21, address: "%QB0" },
    },
    conveyor: {
      file: "../eds/ConveyLinx_V5_10_CODESYS.eds",
      connection: "Connection1",
      inputs: { assembly: 105, address: "%IB512" },
      outputs: { assembly: 106, address: "%QB512" },
    },
    remoteIo: {
      file: "../eds/EthernetIP_CPU1_IF1__ST1.eds",
      connection: "Connection1",
      inputs: { assembly: 124, address: "%IB576" },
      outputs: { assembly: 112, address: "%QB576" },
    },
  },
  codesys: { profile: { directAddressing: "byte", numericAddressing: "byte" } },
  io: {
    ScannerReady: { device: "scanner", channel: "inputs.Trigger_Ready" },
    ScannerTrigger: { device: "scanner", channel: "outputs.Trigger" },
    ConveyorStatus: { device: "conveyor", channel: "inputs.Zone_Status_Upstream" },
    ConveyorSpeed: { device: "conveyor", channel: "outputs.Speed_Left" },
    RemoteInput: { device: "remoteIo", channel: "inputs.Byte0" },
    RemoteOutput: { device: "remoteIo", channel: "outputs.Byte0" },
  } satisfies HardwareIoMapping,
  monitor: { endpoint: "opc.tcp://127.0.0.1:4840" },
});
