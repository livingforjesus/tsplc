# Virtual CODESYS template

`virtual.project` is a copy of the verified frame-assembly virtual Linux ARM64 target with one additional library reference: **Util, 3.5.22.0 (System)**. It was saved by CODESYS V3.5 SP22 Patch 3 through its scripting API. `provenance.json` records the source and resulting project hashes. The original frame-assembly template is unchanged.

The reference supplies the native `Util.BLINK` used by traffic and garden simulation. The pinned Docker compiler image supplies the matching Util library; its binary is not vendored in this directory. The template retains the original Standard and device placeholders. Builds use `@vplc/build` and replace the task plan in their private project copies.

Prepare the image with `bun run vplc configure` from the repository root; [examples/README.md](../README.md) describes the build commands. The checked-in reference is pinned to the version used for these examples. To change its target or library references, edit a separate template copy in CODESYS and select that file through `build.template` in the project config. This template does not provide the upstream projects' device wiring or visualization bindings.

[CODESYS Library Manager scripting API](https://content.helpme-codesys.com/en/ScriptingEngine/ScriptLibManObject.html) documents `get_library_manager` and `add_library`; [BLINK documentation](https://content.helpme-codesys.com/de/libs/Util/Current/Signals/BLINK.html) specifies the native block contract.
