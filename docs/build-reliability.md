# Docker build reliability

The native assertion seen in intermittent fresh-image failures was reproduced by
a Wine/Rosetta signal-state incompatibility. A scoped Wine adapter corrects that
boundary while preserving register values. Ten cold builds of a complete
application passed with the prototype, followed by ten with the maintained image. The maintained image passed
offline compiler verification and is now the local default.

## The signal-state fix

Wine can return a Linux SIGUSR1 frame with its AVX component marked absent when
that component contains its initial, all-zero state. The tested Rosetta runtime
instead requires that component to be explicitly present. Returning the absent
component reproduced `ThreadContextSignals.cpp:414 rt_sigreturn`, exit 133.
Returning explicitly zeroed AVX data reproduced successful signal return.

The adapter wraps Wine's SIGUSR1 handler and normalizes only that exact transition
in the validated Linux frame layout. Unknown layouts and nonzero AVX data remain
unchanged. Native register tests verify both the zero-state conversion and
preservation of nonzero values. It does not retry a failed compile or suppress an
assertion. Its scope, ABI assumptions and maintenance checks are documented beside
the implementation.

The first fresh image had assertions in builds 1, 4, 6, 7 and 10. Its main compiler
reported success in four of those runs, so an exit-code-only check hid helper
crashes. The same fresh Windows installation with the prototype adapter passed
all ten builds without assertions. Draining both .NET NGen queues did not prevent
the failure and was rejected.

## Build and shutdown checks

- The launcher records its actual exit status atomically. A crash, signal, missing
  matching record or acknowledged shutdown that never exits rejects the build.
- Native Rosetta assertions in the completed worker transcript reject a reported
  exit code 0. Terminal color and carriage returns cannot hide the signature.
- The worker binds Windows `ExitProcess` before serving requests. Shutdown avoids
  importing `ctypes` or invoking managed finalizers at that point.
- Artifacts are published after successful shutdown. Compiler locations and
  shutdown errors survive the Docker boundary; operation IDs reject stale failure
  metadata.
- ARM hosts use FEX for installation only. Compilation and offline verification
  use the final AMD64 Wine runtime, a native process reaper and builder-owned
  prefix.
- Offline verification removes old outputs, requires fresh nonempty project,
  application and CRC files, reopens the project and resolves its libraries.
  Vendor failures and native assertions reject the image build.

An acknowledged controller update records its accepted baseline before shutdown.
If shutdown subsequently fails, the command reports failure while retaining that
baseline for inspection and recovery.

## Measured results

| Check                       | Result                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Fresh official installation | .NET, WebView, MSI and all eleven bundled packages installed; AMD64 verification produced project/app/CRC and reopened the project |
| Unmodified fresh image      | Native assertions in 5 of 10 builds; rejected                                                                                      |
| NGen queue control          | Both queues drained; assertion returned in build 3; rejected                                                                       |
| Native adapter tests        | 23 frame/handler cases, deterministic assertion reproduction and 2 register-preservation checks passed                             |
| Wine launcher packaging     | Both real loaders selected the matching library; arguments and exit status preserved; no preload warnings                          |
| Prototype adapter image     | 10 cold application builds passed; nonempty artifacts, exit 0, no native or managed faults                                         |
| Maintained adapter image    | 10 cold application builds passed; fresh project/app/CRC, exit 0, no native or managed faults or preload warnings                  |
| tsPLC check                 | TypeScript, ESLint, Prettier and 697 Bun tests passed; 27,129 assertions across 61 files                                           |
| Python orchestration        | 50 tests passed; these use test doubles                                                                                            |
| Installed packages          | 182 files match archives; 178 payloads match source; no Python bytecode caches                                                     |
| Isolated package consumer   | Install, source checking and Structured Text emission passed                                                                       |
| VS Code extension           | Refreshed VSIX installed; extension/server bundles and notices match the packaged source                                           |
| Current controller workflow | Download, two online changes, boot creation and identity checks after restart passed                                               |
| Installer decoder           | Byte parity with all 16 official entries, totaling 1,526,843,035 bytes, plus 42 boundary comparisons                               |

The default is `tsplc-build:3.5.22.30` at
`sha256:5a548028df0a54c9bf1cd36819cda3599808897a5557eb51c71289f5c36f22f5`.
The previous image is retained as `tsplc-build:3.5.22.30-before-fresh-verifier`.
A compiler image change requires an explicit download before further online
changes, because the saved controller baseline is bound to its image identity.

The full check also exposed a Bun OPC UA initialization error when the hostname
resolver returned scoped IPv6. The maintained dependency patch routes the thrown
validation error into the existing hostname fallback. Direct library and bundled
CJS regressions pass; the production extension contains the patch. Node 25 accepts this particular address, so the reproduction
establishes Bun behavior, not an Electron DNS failure.

The root check now uses the extension's existing bounded 20-second per-test
budget through the shared test script. Under concurrent Wine compilation, three
longer tests exceeded the former five-second default. Their assertions and
subprocess deadlines are unchanged, and the final standard check passed.

## Limits

These checks establish the stated behavior; they do not guarantee every future
vendor installation, program or target. One earlier fresh package installation
failed during a type lookup. Later controlled installations and the revised fresh
recipe completed all eleven packages, but the original failing prefix was not
preserved, so that lookup's cause remains unknown. An older boot-path exception
has not reproduced. Physical EtherNet/IP commissioning and an exhaustive
retention/layout-change matrix were not performed.

Earlier FEX compiler runs suffered managed faults, which is why FEX is confined
to setup. An interrupted online cycle coincided with an OrbStack daemon crash and
less than 1 GiB free disk; that timing does not establish its cause. A complete
subsequent cycle passed with byte-exact source restoration.
