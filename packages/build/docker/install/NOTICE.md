The installer extractor (`extract.py`, `decode.c`), package metadata adapter
(`helper-launcher.c`), and Linux ARM64 device description come from
https://github.com/livingforjesus/codesys-macos-install-guide at commit
1c6337991e68e4dbcdc89e43035e230aa600e5d2. The extractor is adapted for Linux
and takes explicit input/output paths. The adapter is unchanged.
On Linux, the bundled add-ons are extracted from the MSI's `ISSetupFile`
streams; `msiextract` only exposes the regular installed files.

CODESYS and Microsoft prerequisites retain their vendor licenses. The official
CODESYS installer is downloaded from the official CODESYS archive during image
creation and checked against the pinned SHA-256 of the tested installer. An
optional local copy must match the same checksum. No installer or installed IDE
is included in this source repository. The device description is for CODESYS
Virtual Control for Linux ARM64 SL 4.22.0.0, matching the supplied example.

Wine 11.19's NCrypt OAEP forwarding repair, original component source,
equivalent source patch and LGPL license are in `wine-ncrypt/`.
This provider repair leaves the original CODESYS and .NET assemblies unchanged.
