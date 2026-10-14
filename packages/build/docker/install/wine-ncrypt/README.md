# Wine 11.19 NCrypt compatibility repair

Wine's `NCryptEncrypt` rejects `NCRYPT_PAD_OAEP_FLAG` with `NTE_NOT_SUPPORTED`
before forwarding to `BCryptEncrypt`, although the shipped BCrypt/SymCrypt
backend implements RSA-OAEP with SHA256. Original CODESYS controller
authentication calls .NET Framework `RSACng.Encrypt(OaepSHA256)` and encounters
this rejection.

`enable-oaep.py` changes exactly one immediate byte in the pinned Wine provider:
`test r12b,5` becomes `test r12b,1` at VA `0x1800029a9`, file offset `0x29ac`.
The no-padding rejection, flag validation, key validation, and BCrypt call stay
unchanged. Both the installed builtin DLL and copied prefix DLL are patched.
A different provider checksum fails image creation.

Source: Wine tag `wine-11.19`, `dlls/ncrypt/main.c`,
SHA256 `ac3ab423337c24a69e54b57b436f3d6a8b52500db1d51f2c8b0dbacc5525341d`.
The original component source and equivalent guard patch are included here.
Wine is licensed under LGPL 2.1 or later; `COPYING.LIB` is included.
Complete upstream source: <https://github.com/wine-mirror/wine/tree/wine-11.19>.

Validation in the original ARM64 Docker image: the native and .NET controls
reproduce the original failure; the repaired provider passes 2048-bit RSA public
key import, OAEP-SHA256 size query/encryption, randomized ciphertext, wrong-hash
rejection, short-buffer rejection, and unchanged no-padding rejection.
OpenSSL independently decrypts native BCrypt, native NCrypt, and original .NET
RSACng ciphertext with OAEP-SHA256/MGF1-SHA256 and rejects SHA1.
Captured source, disassembly, scripts and logs are in the repository's
`investigation/docker-online/auth-compatibility/` directory.
