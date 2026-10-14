# @tsplc/typegen

Part of [tsPLC](https://github.com/livingforjesus/tsplc).

Generates TypeScript contracts for host clients from Structured Text declarations, and parses EtherNet/IP EDS files into typed hardware IO channels. In a tsPLC project, `tsplc typegen` writes `generated/hardware.ts`, whose `HardwareIoMapping` type checks every `io` key and channel in `tsplc.config.ts`.

See the [documentation](https://github.com/livingforjesus/tsplc/tree/main/docs). MIT licensed.
