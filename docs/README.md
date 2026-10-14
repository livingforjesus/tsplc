# vPLC documentation

vPLC turns PLC TypeScript into Structured Text and builds it with the CODESYS
compiler in Docker. You can also build authored Structured Text directly. One
`vplc.config.ts` connects source, tasks, hardware descriptions, IO mappings,
libraries, deployment and monitoring.

## Start here

1. [Getting started](getting-started.md): create a small program, check it and
   inspect its generated ST before setting up Docker.
2. [TypeScript handbook](language/README.md): state, IEC types, functions, loops,
   records, arrays, timers and function blocks.
3. [Build guide](guides/building.md): templates, the Docker compiler, output files
   and the raw-ST workflow.

## Guides

| I want to…                                         | Read                                         |
| -------------------------------------------------- | -------------------------------------------- |
| Connect an EDS device to typed logical IO          | [Hardware and IO](guides/hardware-and-io.md) |
| Generate contracts for a host application          | [Type generation](guides/typegen.md)         |
| Install a CODESYS library by version or local path | [Libraries](guides/libraries.md)             |
| Download an application or apply an online change  | [Deployment](guides/deployment.md)           |
| Use the hardware view and monitor live values      | [VS Code](guides/editor.md)                  |
| Check source, test logic or run a PLC simulation   | [Testing](guides/testing.md)                 |
| Diagnose a failed command                          | [Troubleshooting](troubleshooting.md)        |

## Reference

- [Configuration](reference/configuration.md): fields, defaults, paths and examples.
- [CLI](reference/cli.md): commands, flags and their effects.
- [Packages and SDK](reference/packages.md): package boundaries and public entry points.
- [Detailed language semantics](compiler/language.md): numeric proofs, value
  semantics, borrowing rules and current restrictions.

Commands below use `bun run vplc`. This works from the vPLC checkout. An external
PLC project can use the same spelling by adding `"vplc": "vplc"` to its package
scripts after [installing the local package archives](compiler/packaging.md).
Add `--config path/to/vplc.config.ts` when working from a different directory.

## Examples and internals

[Maintained examples](../examples/README.md) include traffic control, a mixing
tank, garden control and Frame assembly. Their source and configurations are
useful references for larger applications.

For contributors, see [packaging](compiler/packaging.md),
[compiler architecture](compiler/architecture.md),
[validation](validation.md) and [Docker reliability](build-reliability.md).
[Research notes](research/documentation-structure.md) explain the documentation
structure and link to the tools that informed it. Implementation history and
research describe the work behind vPLC; the guides above describe how to use it.
