# CODESYS library dependencies

[Documentation home](../README.md) · [Package reference](../reference/packages.md)

Use `dependencies` in `tsplc.config.ts` for vendor CODESYS libraries. These are
different from Bun/npm dependencies containing TypeScript source.

## Choose a dependency

```ts
dependencies: {
  Standard: "3.5.22.0",
  Util: { version: "3.5.22.0", company: "System", namespace: "Util" },
  Machine: { path: "libs/Machine.library", namespace: "Machine" },
},
```

Archive dependencies use the exact library name and a four-part version, not a
semver range. The resolver reads the CODESYS System archive's library/version
indexes and validates the advertised payload. `company` selects an archive
company; `namespace` selects the CODESYS import namespace. Local paths can point
to `.library` or `.compiled-library` files and are relative to the config.

The archive index is [CODESYS System libraries](https://store-archive.codesys.com/CODESYSLibs/System/index).
Availability there does not imply compatibility with every target. Choose
versions compatible with the template and runtime.

## Install and lock

```sh
bun run tsplc install
```

Downloaded archive payloads are cached under `.tsplc/libraries`; local libraries
remain at their configured paths. Both are pinned by selection/path and SHA-256
in `tsplc.lock.json`. The build installs these files into the vendor library
repository and adds their project references.

Commit `tsplc.config.ts` and `tsplc.lock.json`. Keep locally maintained library files
in source control or another reproducible artifact source. The `.tsplc/libraries`
directory is a cache, not the authored dependency specification.

For CI, first restore the matching `.tsplc/libraries` cache and local library
files. A fresh checkout can instead run ordinary `install` to recover the
requested payloads; an existing lock still checks their hashes. Then verify:

```sh
bun run tsplc install --frozen-lockfile
bun run tsplc build --frozen-lockfile
```

Frozen mode requires every locked payload to exist locally with its recorded
hash. Missing/different selections or missing/changed files fail immediately;
frozen installation does not fetch a replacement. An archive replacement does
not silently change a locked binary.

To update a library, change its requested version/path deliberately and run
`install` without frozen mode, review the lockfile and rebuild.

## Calling libraries from PLC TypeScript

Installing a vendor library makes it available to CODESYS. It does not turn all
its functions or blocks into TypeScript implementations. PLC TypeScript currently
uses its supported native SDK blocks, such as `TON` and `Util.BLINK`, and imports
ordinary supported TypeScript helpers by source. Raw ST can call compatible
vendor libraries directly.

For reusable PLC TypeScript helpers, use normal module/package imports that
resolve to implementation `.ts` source. Keep Bun/npm package dependencies in
`package.json` and vendor library dependencies in `tsplc.config.ts`.

The extension validates archive names and versions. Full compilation remains the
check for transitive vendor dependencies, namespaces and target compatibility.
For failures, see [troubleshooting](../troubleshooting.md).
