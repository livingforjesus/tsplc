# Packaging and installation

[Documentation home](../README.md) · [Quickstart](../getting-started.md)

The workspace uses Bun 1.4.3, TypeScript 6.0.3, ESLint and Prettier. Packages are currently installed from local archives. There is no published vPLC npm release yet.

## Workspace development

```sh
cd ~/Desktop/Work/vplc
bun install
bun run check
bun run build
bun run pack
```

`build` bundles the configuration, build, typegen and compiler package entries and the VS Code extension. `pack` builds again and creates standard archives under `artifacts/packages`:

- `vplc-config-0.1.0.tgz`
- `vplc-build-0.1.0.tgz`
- `vplc-typegen-0.1.0.tgz`
- `vplc-compiler-0.1.0.tgz`

`pack` also creates a copy of each archive whose filename includes its SHA-256 prefix and writes `artifacts/packages/install.json`. That manifest contains the exact local `dependencies` and `overrides` needed by a consumer. Use these content-addressed paths for development updates: Bun can retain stale installed contents when an archive is repacked at the same filename and version, even with `bun install --force`.

Compiler IR, CODESYS emission, project orchestration, math and SDK declarations are subpaths of `@vplc/compiler`, not separate packages. The compiler archive retains authored TypeScript and canonical SDK declarations because PLC source analysis needs them. The builder archive contains the maintained Docker recipe and Python worker. The VS Code extension is packaged separately as a VSIX.

## Install local archives into another project

After running `bun run pack`, merge the `dependencies` and `overrides` objects from `artifacts/packages/install.json` into the consuming project's `package.json`. Preserve its other dependencies and scripts. The manifest points to the four local content-addressed archive paths.

Useful consumer scripts are:

```json
{
  "scripts": {
    "plc:check": "vplc check",
    "plc:build": "vplc build",
    "plc:typegen": "vplc typegen"
  }
}
```

For a portable checkout, copy the four archives named by the manifest into the consuming project's `vendor/vplc/` directory, then change both dependency and override values to `file:vendor/vplc/<archive filename>`. Keep the content hash in each filename.

The overrides belong in the consuming Bun workspace root. Keep them even when all four packages are direct dependencies: each packed package has exact transitive package versions, and the overrides direct those versions to the same unpublished archives.

```sh
bun install
bun run plc:check
bun run plc:build --emit-only
```

The migrated Frame checkout uses absolute `file:` archive paths into the local vPLC repository for development. To move it to another machine, copy the referenced archives and update both dependencies and root overrides to relative vendor paths.

After modifying vPLC, run `bun run pack`, merge the refreshed `install.json` into the consuming workspace, and run `bun install`. The changed content-addressed path makes Bun install the new archive. A source edit alone does not change a previously installed package.

## VS Code extension

```sh
cd packages/vscode-extension
bun run build
bun run package
```

The resulting file is `artifacts/vplc.vsix` under the extension package. Install it with VS Code's **Extensions: Install from VSIX** command. The archive includes the bundled language server, hardware view assets and third-party notices. It does not require a separately installed npm extension package.

## Verification

Source checks and a successful bundle build do not prove that an external consumer works. Install the archives in a fresh project and exercise SDK resolution, config checking and `build --emit-only`; that workflow has been tested with the local-override arrangement above. Docker compilation and runtime/OPC-UA simulation require their own configured template and runtime checks.

The image build verifies the pinned CODESYS compiler offline in the final AMD64 Wine runtime before packaging the SDK. On ARM hosts, FEX handles installation only. Verification compiles a cyclic ARM64 program with symbol publishing, produces fresh nonempty project/application/checksum files, then reopens the saved project and resolves its libraries again. This catches missing transitive libraries that can appear after a successful compilation. The installer uses the official PackageManagerCLI component selection for Visualization's Libraries, Visualization Profiles and License components; the vendor package bytes and assemblies stay unchanged. The required Base, Visualization Support, Math, Recipes, Trace and Communication packages are installed first.

A future published release can use registry versions instead of local archive dependencies and overrides. Publishing is separate from creating these local archives.
