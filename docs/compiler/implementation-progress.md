# Historical compiler validation record

This file was inherited from the PLC-TS repository and records work performed before the vPLC consolidation. Its approval labels, package layout, tool commands and test totals are historical evidence, not the current monorepo release status. Use [architecture.md](architecture.md), [toolchain.md](toolchain.md) and [packaging.md](packaging.md) for the maintained workflow. Current checks must be rerun against the consolidated source and actual packaged consumer.

## Inherited implementation progress

The implementation follows docs/architecture.md, with the full planned source-to-CODESYS scope.
Each module must pass behavior tests, simplification review and independent subagent review before the next module starts.
No commits or publication are part of this task.

## Modules

1. Workspace, IR contracts, diagnostics and typed host configuration — APPROVED. Independent reviewer found four issues; all fixed and re-reviewed. Typecheck and 9 behavior tests pass.
2. TypeScript frontend, SDK declarations and Boolean compiler slice — APPROVED. Suppression and dependency-provenance findings fixed and re-reviewed. Typecheck and 20 tests pass.
3. Verified core, CODESYS backend and I/O bindings — APPROVED. Dictionary, naming and type-table findings fixed and re-reviewed; declaration and implementation mappings reviewed. All 30 checks pass; generated Boolean bundle also passes installed CODESYS compilation.
4. Numeric semantics, functions and bounded control flow — APPROVED. Independent fix/re-review loop completed, including REAL canonicalization, switch semantics, constant ordering, I/O boundaries and contextual literals. Typecheck and 45 tests / 280 assertions pass; 18-object numeric bundle builds through codesys-build and installed CODESYS.
5. Records, enums, fixed arrays, generics and source libraries — APPROVED. Independent fix/re-review loop completed for receiver effects, generic layout identity, const binding semantics, comparison context and layout-depth order. Typecheck and 60 tests / 335 assertions pass; aggregate bundle passes installed CODESYS compilation through codesys-build.
6. Timers, triggers, user function blocks, borrows and retention — APPROVED. Independent fix/re-review loop completed for whole-output snapshots, private receiver safety, generic borrow identity, complete allocation budgets, lexical naming and inferred retention. Typecheck and 85 tests / 427 assertions pass; 16-object block bundle builds through codesys-build and installed CODESYS.
7. Compiler orchestration, CLI and engineering integration — APPROVED. Independent fix/re-review loop completed for engineering cache authority, symlink guards, failed-build receipt withdrawal, publication-time user edits, complete task plans and vendor diagnostic identity/location mapping. Typecheck and 106 tests / 559 assertions pass; companion 258 tests and 21 Python tests pass. Actual CLI build through codesys-build verified two task schedules and published vendor artifacts.
8. Packaging, full frame-assembly port, full integration verification and final simplification review — APPROVED. Independent review/fix/re-review completed for external symbol publication, Windows SDK path identity, readable compiler phases and redundant aggregate initialization. Final source gate passes 120 tests / 878 assertions, typecheck with unused-code checks, Biome lint and formatting. All seven local archives pass isolated offline installation, strict public declaration checking, typed host config, SDK/source-library provenance and CLI check/emission smoke tests.

Frame-assembly reference: /Users/Apple/.t3/worktrees/rip-technologies/t3code-bd440e47/apps/frame-assembly/plc. Port all authored PLC logic, declarations and configuration into examples/frame-assembly; preserve source unchanged. Inventory: 42 ST files, 1,345 lines, including in-out aggregates, fixed byte buffers, strings, timers and nested function blocks.

## Review process

For each module, the reviewer reports blockers and worthwhile simplifications.
The primary agent fixes them, runs affected checks and requests re-review.
Approval means no remaining actionable findings in that module's implemented contract.
Vendor compilation and runtime verification are recorded separately from source/unit checks.

## Design adjustment for the full frame-assembly port

The real reference project requires VAR_IN_OUT aggregates. Implement explicit call-site borrowed records via SDK InOut<T> and ref(place), forbidding persistent references, escaping borrows and overlapping mutable call arguments. This is a current source requirement, not speculative general pointer support.

## Vendor verification

2026-10-09: Boolean source compiled through the emitted split ST bundle into Application.app and Application.crc with installed CODESYS V3.5 SP22 Patch 3 under Wine, using a temporary copy of the frame-assembly local.project template. Includes persistent state, invocation locals, short-circuit control flow, direct BOOL I/O and an early return. Build only; no PLC deployment or runtime execution. Probe script: Documents/Codex/2026-10-08/in/work/vendor-probe.ts.

2026-10-09: Numeric source compiled through codesys-build buildProject into Application.app and Application.crc in the installed CODESYS IDE. The 18-object bundle covers exact-width numeric helpers, 64-bit wrap/saturation, explicit conversions, typed source functions, switch, bounded loops, continue, integer division and REAL constants. The vendor compiler caught unsupported identity conversion names; generic TO_type conversions and identity elimination fixed them, and the rebuild passed. Build only; no deployment or runtime execution. Probe script: Documents/Codex/2026-10-08/in/work/vendor-probe-numeric.ts.

The CLI build command will use codesys-build as the CODESYS engineering backend, as explicitly requested. ST emission and engineering compilation remain distinct stages.

2026-10-09: Aggregate source compiled through codesys-build into Application.app and Application.crc in installed CODESYS. The 16-object bundle covers strict qualified DINT enums, lower-bound arrays, nested indexed writes, record/array copies, record return values and readonly aggregate inputs, generic source helpers, generic record layouts, and escaped STRING/WSTRING literals including a BMP WSTRING character. The vendor compiler rejected typed string literal prefixes; plain single/double quoted literals fixed the syntax and the rebuild passed. Build only; no deployment or runtime execution. Probe script: Documents/Codex/2026-10-08/in/work/vendor-probe-aggregates.ts.

FixedArray<T,N,Lower=0> extends the original zero-based array plan because the complete reference uses Cards[1..256]. Bounds remain explicit static layout data, with proof required for every index.

2026-10-09: Function-block source compiled through codesys-build into Application.app and Application.crc in installed CODESYS. The 16-object bundle covers TON/TOF/TP/R_TRIG/F_TRIG, user blocks with typed outputs and early returns, nested private instances, indexed record InOut references, invocation VAR_TEMP locals, whole-output snapshots, retained scalars/native blocks and private retention promotion, and maximum TIME/calendar literals. The vendor compiler reproduced the invalid whole-output instance copy; core field projection fixed it and the rebuild passed. Build only; no deployment, PLC execution or reset/retention lifecycle validation. Probe script: Documents/Codex/2026-10-08/in/work/vendor-probe-blocks.ts.

2026-10-09: Final Module7 CLI build through codesys-build compiled generated ST and verified FastTask 10 ms / priority 2 / ReadSecond then ReadFirst, plus SlowTask 100 ms / priority 8 / PublishSlow. Published project/app/crc with a vendor-compiled receipt and matching engineering ownership marker. Invalid declaration and split implementation probes preserved raw ScriptMessage metadata, confirmed line 1 implementation reporting and direct-active-Application identity by GUID. Build only; no deployment.

## Final integration and readability verification

2026-10-09: The complete frame-assembly port compiles through the real PLC-TS CLI and codesys-build into Application.project, Application.app and Application.crc with CODESYS V3.5 SP22 Patch 3 under Wine. The final receipt reports MainTask at 20 ms, priority 1, and Main. CODESYS's exported symbol XML matches the original four published GVLs: all 110 root variables, all 22 record layouts and all five enum value lists, including variables and fields unused by the authored scan. The source port covers all 51 authored files and translates all 42 ST files. Original hashes and copied template remain unchanged.

The test-only scan executor checks all 256 conveyor slots, stop/restart disarming, scanner byte capture and worker acknowledgement, route locking/departure, same-scan program order, lift qualified endpoint feedback and timeout rearming, all drive fault inputs, conflicting/wrong-direction feedback, and finishing alternation. It does not provide a product PLC runtime.

Biome now enforces two-space formatting and linting, and TypeScript rejects unused locals and parameters. Frontend analysis uses explicit declaration/storage/body/entry phases; verified IR separates declaration admission, static allocation, per-routine lowering and module linking; target planning separates I/O/tasks/storage/constant policies; emission has bundle phases and per-routine state; CLI artifact ownership and publication have one owner. Invariant comments explain capture order, branch joins, canonical borrows, static allocation versus call graphs, target naming and scan output commits. Independent DRY/YAGNI and readability review found no remaining actionable blocker. Lint retains warning-level assertions for validated symbol relationships and fixed test fixtures; there are no lint errors.

Mutable zero aggregate declaration initializers use CODESYS's standard field defaults, eliminating redundant expanded payloads. Nonzero defaults, sparse enum values, CONSTANT declarations, signed floating zero and time/calendar values remain explicit. The final LineIO.st is 7,472 bytes over 164 lines with a maximum line width of 62 characters, and the complete simplified bundle passes vendor compilation.

All eight modules have independent approval. Compilation and test scan behavior are verified; no PLC download, runtime execution, physical I/O commissioning, or retention lifecycle test was performed. The installation's original wiring and commissioning notes remain in the example.
