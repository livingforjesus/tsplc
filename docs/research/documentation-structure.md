# Documentation structure

Reviewed 2026-10-14. This note records patterns from official developer-tool documentation and recommends a structure for tsPLC's user documentation. It does not describe new compiler features.

## Patterns to adopt

| Source                                                                                                                               | Observed pattern                                                                                                                                    | Application to tsPLC                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Bun quickstart](https://bun.com/docs/quickstart)                                                                                    | A short sequence creates a project, names the files to edit, runs commands, and shows the expected result.                                          | Give readers one complete TypeScript-to-PLC build with a small program, a shared config, exact commands, and the resulting artifacts.                                                             |
| [Bun guides](https://bun.com/guides)                                                                                                 | Guides have task names such as adding a dependency or configuring a monorepo.                                                                       | Use pages for building, mapping I/O, installing libraries, deploying, and making an online change.                                                                                                |
| [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html)                                                       | The handbook teaches everyday language concepts in a reading order; reference pages explain individual features in more detail.                     | Make the supported TypeScript syntax readable as a handbook. Explain PLC state and scalar types before arrays, function blocks, and loops. Link detailed restrictions beside the relevant syntax. |
| [TypeScript config reference](https://www.typescriptlang.org/tsconfig/)                                                              | Options have individual entries with descriptions, examples, defaults, and related settings.                                                        | Document every public `tsplc.config.ts` field with its type, default, path-resolution rule, and a concrete example.                                                                               |
| [IronPLC documentation](https://www.ironplc.com/)                                                                                    | The entry page separates quick start, task guides, explanations, and reference. Reference covers language, compiler, runtime, and editor extension. | Keep a single docs index that routes readers by task. Give the compiler, Docker build, type generation, and VS Code extension their own pages.                                                    |
| [IronPLC first program](https://www.ironplc.com/quickstart/helloworld.html)                                                          | A small PLC program is explained, run, and checked against visible variable values before the reader proceeds to configuration.                     | Use a minimal counter or output program whose emitted ST and build result can be checked. Add hardware mapping after the first successful build.                                                  |
| [CODESYS ST documentation](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_f_programming_language_st.html) | The language page identifies ST and its vendor extension, then links programming instructions and specific syntax.                                  | Explain that tsPLC compiles a supported TypeScript subset to CODESYS ST. Show TypeScript and emitted ST together where the translation affects behavior.                                          |

[Diátaxis](https://diataxis.fr/) describes four reader needs: learning through a tutorial, completing a task, looking up technical details, and understanding a concept. Its [how-to guidance](https://diataxis.fr/how-to-guides/) and [reference guidance](https://diataxis.fr/reference/) support keeping task instructions separate from exhaustive field and syntax lookup. tsPLC can use these distinctions in ordinary Markdown; they do not require a documentation website.

## tsPLC layout

The user guides apply those patterns in this layout, alongside the existing
compiler internals and research:

```text
docs/
  README.md                # Entry point, reading paths, and package roles
  getting-started.md        # Installation through first successful PLC build
  troubleshooting.md        # Actionable symptoms, diagnostics, and recovery
  language/
    README.md               # Supported TypeScript, PLC semantics, and examples
  guides/
    building.md             # Docker setup, ST-only builds, and artifacts
    hardware-and-io.md      # EDS descriptions and typed I/O mapping
    typegen.md              # Host contracts and hardware type generation
    libraries.md            # Versions, local files, locks, and install
    editor.md               # VSIX, hardware view, monitoring, and diagnostics
    deployment.md           # Compose, download, baselines, and online changes
    testing.md              # Logic tests, vendor builds, and runtime simulation
  reference/
    configuration.md        # Shared fields, defaults, and path resolution
    cli.md                  # Commands and flags
    packages.md             # Public package and SDK entry points
  compiler/                # Existing architecture and implementation material
  research/                # Evidence and historical investigations
```

`docs/README.md` should offer three entry paths: create a TypeScript PLC project, build existing Structured Text, and connect hardware or an existing project. The repository README should link directly to this index and the getting-started page.

## Content rules

- Start each task page with its prerequisites and the outcome. Name the directory from which commands run. Show expected files or output after the command that creates them.
- Use complete examples that match the checked-in API. Keep the tutorial small; put advanced configuration and programmatic entry points in the reference.
- State TypeScript restrictions beside the relevant construct. Cover integer and real types, initialization, persistent PLC state, input/output/in-out variables, array bounds, references, loop increments, and unsupported JavaScript runtime features where the implementation supports or rejects them.
- Explain source-to-ST folder mapping and how the resulting `.project` appears in CODESYS. Readers need to know which files are source, generated ST, generated typings, build artifacts, and online-change state.
- Distinguish generating hardware metadata from configuring or communicating with a physical device. State the source of displayed values and which connection settings are required.
- Document current behavior from source and verified examples. Link investigation and reliability reports as further reading; do not make the reader follow implementation history to learn how to build a project.
- Keep navigation shallow. Add links between the task page and the field or syntax reference it uses, plus a next step at the end of the introductory tutorial.

These rules are recommendations inferred from the cited examples. The file names
and ordering are tsPLC-specific choices.
