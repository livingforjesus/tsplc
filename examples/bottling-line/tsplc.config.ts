import { defineConfig, ms } from "@tsplc/config";
import type { HardwareIoMapping } from "./generated/hardware.ts";

// One config drives check, typegen, build, the editor's hardware view and monitoring.
// On a fresh checkout run `tsplc typegen` first: it creates ./generated/hardware.ts,
// which `check` and `build` use to type-check the `io` mappings below.
export default defineConfig({
  name: "BottlingLine",
  backend: "codesys",
  compiler: {
    tsconfig: "tsconfig.json",
    programs: {
      main: { module: "src/main.ts", export: "main" },
      heartbeat: { module: "src/heartbeat.ts", export: "heartbeat" },
    },
  },
  tasks: [
    {
      name: "MainTask",
      schedule: { kind: "cyclic", interval: ms(10) },
      priority: 1,
      programs: ["main"],
    },
    {
      name: "HeartbeatTask",
      schedule: { kind: "cyclic", interval: ms(100) },
      priority: 10,
      programs: ["heartbeat"],
    },
  ],
  build: {
    // Shared CODESYS Virtual Control template that references the Util library.
    template: "../templates/virtual.project",
    outDir: "build/codesys",
    docker: { image: "tsplc-build:3.5.22.30", cpuSet: "0-1" },
    removeObjects: ["PLC_PRG", "Visualization Manager", "VISU_TASK"],
    symbols: true,
  },
  codesys: {
    profile: { directAddressing: "byte", numericAddressing: "byte" },
    // Readable IEC names for host clients instead of the generated defaults.
    programNames: { main: "Main", heartbeat: "Heartbeat" },
    globalListNames: {
      Line: "Line",
      Production: "Production",
      Diagnostics: "Diagnostics",
      Settings: "Settings",
    },
    publishGlobalLists: ["Line", "Production", "Diagnostics"],
  },
  // Util supplies the native BLINK used by StackLight.
  dependencies: { Util: { version: "3.5.22.0", company: "System", namespace: "Util" } },
  eds: "eds",
  // Assembly instances come from each EDS connection. Base addresses are the
  // process-image locations the template assigns to the devices.
  devices: {
    reader: {
      file: "eds/0678077312900100.eds",
      connection: "Connection1",
      inputs: { assembly: 11, address: "%IB0" },
      outputs: { assembly: 21, address: "%QB0" },
    },
    conveyor: {
      file: "eds/ConveyLinx_V5_10_CODESYS.eds",
      connection: "Connection1",
      inputs: { assembly: 105, address: "%IB512" },
      outputs: { assembly: 106, address: "%QB512" },
    },
    remoteIo: {
      file: "eds/EthernetIP_CPU1_IF1__ST1.eds",
      connection: "Connection1",
      inputs: { assembly: 124, address: "%IB576" },
      outputs: { assembly: 112, address: "%QB576" },
    },
  },
  io: {
    // Storage paths: the compiler copies these channels to and from fields of the
    // Line globals around each scan. No declarations or copy code are needed.
    "Line.Filler.BottlesInPlace": { device: "remoteIo", channel: "inputs.Byte0.Bit2" },
    "Line.Filler.GateClosed": { device: "remoteIo", channel: "outputs.Byte0.Bit0" },
    "Line.Filler.Valves[1].Open": { device: "remoteIo", channel: "outputs.Byte1.Bit0" },
    "Line.Filler.Valves[2].Open": { device: "remoteIo", channel: "outputs.Byte1.Bit1" },
    "Line.Filler.Valves[3].Open": { device: "remoteIo", channel: "outputs.Byte1.Bit2" },
    "Line.Filler.Valves[4].Open": { device: "remoteIo", channel: "outputs.Byte1.Bit3" },
    "Line.Reader.Input.ResultsAvailable": { device: "reader", channel: "inputs.Results_Available" },
    // A UINT channel fills a WORD field: equal-width integer and bit-string types bind directly.
    "Line.Reader.Input.ResultCode": { device: "reader", channel: "inputs.Result_Code" },
    "Line.Reader.Input.ResultLength": { device: "reader", channel: "inputs.Result_Length" },
    // A whole EDS byte span binds to FixedArray<BYTE, 480>.
    "Line.Reader.Input.ResultData": { device: "reader", channel: "inputs.Result_Data" },
    "Line.Reader.Output.ResultsAck": { device: "reader", channel: "outputs.Results_Ack" },
    "Line.Infeed.Status": { device: "conveyor", channel: "inputs.Zone_Status_Upstream" },
    "Line.Infeed.Speed": { device: "conveyor", channel: "outputs.Speed_Left" },
    // Logical IO names declared in src/io.d.ts.
    StartButton: { device: "remoteIo", channel: "inputs.Byte0.Bit0" },
    StopButton: { device: "remoteIo", channel: "inputs.Byte0.Bit1" },
    RecipeSelector: { device: "remoteIo", channel: "inputs.Byte1" },
    RejectGate: { device: "remoteIo", channel: "outputs.Byte0.Bit1" },
    // Direct addresses for IO outside the EDS devices, such as a local IO module.
    EStopHealthy: { address: "%IX700.0" },
    RunLamp: { address: "%QX700.0" },
    FaultLamp: { address: "%QX700.1" },
  } satisfies HardwareIoMapping,
  typegen: { out: "generated/plc.ts", hardwareOut: "generated/hardware.ts" },
  monitor: { endpoint: "opc.tcp://127.0.0.1:4840" },
});
