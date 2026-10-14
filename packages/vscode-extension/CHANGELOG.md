# Changelog

## 0.1.2

- Allow qualified access to ordinary program variables, such as `PRG_ConveyorSetup.ConveyorStarted`, in diagnostics and completion.
- Preserve temporary-variable and function-block member access restrictions.

## 0.1.1

- Activate hover, completion and type checking when another ST extension assigns the `st` language mode to `.st` or `.iecst` files.
- Keep other legacy `st` formats outside the CODESYS source selector.
- Test automatic activation and real VS Code providers in both language modes, including the blueprint's `Inbound` instance in a nested PLC project.

## 0.1.0

- Initial CODESYS Structured Text language server and VS Code client.
- `codesys-build` source ownership, type diagnostics, completion and navigation.
- Highlighting, semantic tokens, snippets, file icons and counterpart navigation.
- Portable PLC fixtures, adversarial/property tests, LSP integration and VS Code host tests.
