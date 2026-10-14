# vPLC for VS Code

The vPLC extension provides Structured Text language assistance, an EDS hardware and IO view, CODESYS library name/version validation, and read-only OPC-UA monitoring. It uses the project's shared `vplc.config.ts` for TypeScript and raw Structured Text projects.

## Install

From the monorepo root, install dependencies and package the extension:

```sh
bun install --frozen-lockfile
bun run --cwd packages/vscode-extension package
```

In VS Code, run **Extensions: Install from VSIX…** and select `packages/vscode-extension/artifacts/vplc.vsix`. Open your PLC project folder and select **vPLC → Hardware & IO** in the activity bar. Open a `.st` file for language assistance. The default language mode is **CODESYS Structured Text**. Existing ST extensions may select **Structured Text** (`st`) instead; hover, completion and type checking also attach to `.st` and `.iecst` files in that mode. Other formats claimed by those extensions, such as `.scl` and `.TcPOU`, are excluded.

Use **Ctrl+Space** to request suggestions, or type `.` after an instance for its members. If multiple language servers produce duplicate suggestions or conflicting diagnostics, disable the other server for this workspace. **CODESYS ST: Restart Language Server** restarts this extension; its logs appear in **Output → CODESYS Structured Text**. After updating the extension, use **Developer: Reload Window** if VS Code requests it.

The packaged language server and hardware view run on VS Code's Node runtime. Live monitoring requires Node 22.13 or later in the extension host. Project commands require Bun, the installed vPLC packages, and Docker for vendor compilation; see [packaging](../../docs/compiler/packaging.md) and the [toolchain guide](../../docs/compiler/toolchain.md). No telemetry is collected by this extension.

## Project and hardware workflow

Keep build settings, task schedules, dependencies, EDS selections, IO mappings and monitor options in `vplc.config.ts`. Use **vPLC: Generate Types** after changing hardware or source. This runs `vplc typegen` and updates the generated hardware binding types and `.vplc/project.json` used by the editor. A TypeScript build also emits readable ST under `.vplc/artifacts/st`; raw ST projects keep their authored source tree.

The Hardware & IO view shows:

- The selected EDS connection and EPATH, assembly instances, effective payload sizes, EDS capacities and process-image addresses.
- Input/output channel mappings, types, units and descriptions, with expandable byte bits and array elements.
- Cyclic task names, periods, priorities and program call order. Legacy raw-ST tasks show their configured entry source, with template-owned timing and priority labeled **Template**.
- Configured driver status symbols and watched symbols, with values, OPC-UA quality, timestamps and stale-value indication after disconnect.

Driver status comes from configured published symbols; the view does not infer a working EtherNet/IP connection from an EDS file. Channels without a published symbol mapping show no live value. **Refresh** reloads the current project; **Project** selects another config in a multi-project workspace.

The command palette also exposes **vPLC: Check Project**, **Build Project** and **Install Libraries**. These run the corresponding vPLC CLI command in the selected project's directory. The editor reads config literals without evaluating them. Dynamic configs use the generated snapshot; regenerate it after changing their expressions. Executing project commands and connecting to a PLC require a trusted workspace.

Library completion and diagnostics validate exact dependency names and versions against the CODESYS System archive. Local `.library` paths are supported by the toolchain. Downloaded library implementation metadata does not become an ST semantic signature automatically; vendor API completion still uses declaration files described below.

## Live monitoring

Configure `monitor.endpoint` and the PLC's published symbols in the shared config, then use **vPLC: Connect Monitor**. Secure sessions default to `SignAndEncrypt` with `Basic256Sha256`. Verify and trust the PLC certificate in `monitor.certificateDirectory` before connecting, and configure the PLC to trust the client's certificate. Unknown certificates are not accepted automatically.

For user authentication, configure `monitor.username`. Use `monitor.passwordEnv` to read a password from the extension host's environment, or enter it in the masked prompt. Prompted credentials are stored in VS Code SecretStorage, keyed by endpoint and username. **vPLC: Forget Monitor Password** removes that saved credential. Passwords are never written to the config snapshot. Username authentication requires a secure session; explicit `None` mode is anonymous-only.

Monitoring subscribes to published IO, driver status and explicitly watched symbols. It does not write values, force IO, download applications or perform online changes. Use the CLI for deployment and online changes; see the [runtime workflow](../../docs/compiler/toolchain.md#runtime-and-online-changes).

## Editing features

- Member completion through structs, function-block instances, properties, arrays, pointers, references, aliases and inherited members. For example: `pConveyor^.Cards[CardIndex].Output.`.
- Scoped identifier and type completion, named input/output argument suggestions, signature help and comment documentation on hover.
- Go to definition/type definition, find references, document outline, workspace symbols and rename for variables, fields, enum members and parameters. Rename checks identity and collisions; it does not replace text in comments or strings.
- Diagnostics for unresolved names/types, incompatible assignments, invalid calls, parameter directions, duplicate/missing arguments, by-reference type/storage mismatches, constant writes, visibility, invalid conditions/indexes, literal ranges, array sizes/bounds and cyclic definitions.
- Inheritance, interface signature checks, method overrides and getter/setter access checks. Method bodies inherit their enclosing POU's scope; getter and setter locals remain separate.
- TextMate and semantic highlighting, nested comments, folding, CODESYS snippets, brackets, indentation, and light/dark `.st` file icons. Language icons appear when the active file-icon theme permits language-specific icons.
- **CODESYS ST: Open Declaration / Implementation** cycles between an object's source parts. **CODESYS ST: Restart Language Server** restarts indexing.

Potentially lossy numeric conversions are warnings. Use an explicit conversion after checking the range. Out-of-range integer constants and incompatible types are errors. Enum checking is deliberately conservative: enum identity is preserved and numeric enum arithmetic is rejected, including enums without `strict`.

## Source layouts

All of these share the same semantic index:

```text
src/
  Main.st                         # PROGRAM … END_PROGRAM
  types/ST_Item.st                # TYPE … END_TYPE
  globals/LineIO.st               # VAR_GLOBAL … END_VAR
  PRG_Update.declaration.st
  PRG_Update.implementation.st
  FB_Conveyor/
    FB_Conveyor.declaration.st    # or declaration.st
    FB_Conveyor.implementation.st # or implementation.st
    methods/
      Run.st                     # complete method
      Reset/
        declaration.st
        implementation.st
    properties/
      Enabled/
        declaration.st
        get.st
        set.st
    actions/
      Clear.st                   # body only
```

`source.st` is also supported for complete directory-owned POUs. Generic and named declaration/implementation parts can be mixed. Interfaces use `source.st` plus method/property signature files. Global-list names come from filenames. Identifiers are case-insensitive; ordinary folders organize code without creating namespaces. Separate source roots have separate IEC namespaces.

The editor tolerates incomplete source and declaration-only method signatures. The `@vplc/build` source loader performs stricter filename/header, prefix, terminator and import-layout validation during a build.

## Workspace configuration

By default, the language server discovers `vplc.config.ts` projects and uses `.vplc/project.json` to select their generated ST or raw `build.sourceDir`. Before the first generation it looks for adjacent `src/`. Legacy `codesys-build` config discovery remains supported for ST editing. Without a project config, it indexes the workspace folder. It ignores hidden folders, unrelated build outputs and dependency folders, and does not follow source symlinks. Unsaved buffers override disk content. Changes to declarations refresh diagnostics and completion across the project.

For a custom source directory before the first type generation, configure the location explicitly. The language server never imports or evaluates project config:

```json
{
  "codesysST.sourceRoots": ["plc"],
  "codesysST.libraryPaths": ["library-signatures"]
}
```

Each `sourceRoots` entry is an independent project, relative to the workspace folder. `libraryPaths` supplies additional ST declarations to every project in that folder. Keep these signatures outside the build source tree. Use `.declaration.st` for POU signatures that omit executable bodies. Standard timers, counters, edge triggers, common functions and explicit conversions have bundled signatures. Go to definition on a bundled symbol opens a read-only signature document.

Library signatures currently share the application's namespace. Arbitrary vendor namespaces and compiled `.library` / `.compiled-library` metadata are not imported. Missing vendor APIs produce unresolved-symbol/type diagnostics instead of silently becoming untyped.

## Scope and limits

Language diagnostics cover source-level semantics. Run `vplc check` and the Docker-backed CODESYS build before deployment.

- Conditional compilation is not evaluated: all branches are indexed and a warning marks conditional directives. Generic specializations also emit a compiler-validation warning.
- Graphical languages, CODESYS project/device-topology editing, breakpoints and controller writes are outside the extension. Templates supply vendor target/topology configuration; EDS selections describe channel mappings.
- The checker covers the tested source-language subset; it does not perform control-flow proofs, definite initialization, pointer lifetime/nullability analysis, runtime bounds checks or complete IEC operator-overload validation. Date/time literal payload validation and vendor extensions still require the compiler.
- Object names are tied to build-tool filenames. Symbol-only rename of POUs/types/methods/properties is refused; rename their files and declarations together. Variable/field/parameter rename is supported.
- Analysis is conservative about enum conversions and string/reference compatibility. Default/vendor encodings and target-dependent numeric behavior require compiler validation.
- Files larger than 2 MiB are skipped during disk discovery with an output-channel message. Pathological nesting is bounded and diagnostics are capped at 200 per file. Large-project validation rebuilds the semantic snapshot after changes; parsing is reused for unchanged files within that snapshot's service.

## Development and validation

From the monorepo root:

```sh
bun run check
bun run --cwd packages/vscode-extension test
bun run --cwd packages/vscode-extension test:host
bun run --cwd packages/vscode-extension package
```

Press **F5** to launch an isolated Extension Development Host with the portable conveyor fixture. `test:host` runs both `codesys-st` and legacy `st` language modes with a competing language extension, isolated profiles and temporary monorepo workspaces. It verifies automatic activation without explicitly activating the extension, including `Inbound` hover and completion in the PLC blueprint. Set `VSCODE_EXECUTABLE_PATH` to use an installed VS Code; otherwise the runner can download VS Code. It never edits the original PLC workspace.

Tests include authored PLC fixtures, deterministic mutation/property testing, every-prefix edits, Node/V8 stack-stress cases, real Oniguruma highlighting, workspace transactions, JSON-RPC and actual VS Code providers. Hardware tests use the real scanner, conveyor and remote IO EDS files. Monitoring tests cover secure sessions, certificate trust, stale values and cancelled connections. Live runtime validation is recorded in [validation.md](../../docs/validation.md).

The code uses strict TypeScript, ESLint and Prettier. `src/language/` owns parsing, indexing, semantic analysis and editor responses; `src/server/` owns disk/buffer synchronization and LSP. `src/extension.ts` wires VS Code commands, `hardware-view.ts` manages project/monitor state, and `hardware-renderer.ts` renders the page while its media script updates live samples in place. There are no native parser binaries.
