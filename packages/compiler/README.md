# @tsplc/compiler

Part of [tsPLC](https://github.com/livingforjesus/tsplc).

Write CODESYS PLC programs in TypeScript and compile them to IEC 61131-3 Structured Text. This package provides the `tsplc` CLI (`check`, `typegen`, `build`, `run`, `download`, `online-change`, `inspect`) and the compiler API.

```sh
bun add -d @tsplc/compiler
bunx tsplc check
bunx tsplc build --emit-only
```

Requires Bun 1.4.3 or later. A full CODESYS build runs in Docker via `@tsplc/build`.

See the [documentation](https://github.com/livingforjesus/tsplc/tree/main/docs). MIT licensed.
