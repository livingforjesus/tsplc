"""Enable Wine 11.19's existing BCrypt OAEP implementation through NCrypt.

The pinned Wine build rejects OAEP before reaching BCryptEncrypt. Change only
that test's mask from NO_PADDING|OAEP to NO_PADDING. Full file and instruction
hash checks reject other provider versions rather than guessing an offset.
"""
import hashlib
from pathlib import Path
import sys

ORIGINAL = "bef675557affd765a074f39761a30f621da32b50a4407eb449321e7a1856b674"
PATCHED = "e34b80fc59fa4cededff41ca55f5c2b2013efa7e6963a1bd5fac49246d0add11"


def enable(path):
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest == PATCHED:
        return
    if digest != ORIGINAL or data[0x29a9:0x29b3] != bytes.fromhex("41f6c4050f85dd000000"):
        raise RuntimeError("Unexpected Wine NCrypt provider: " + str(path))
    result = bytearray(data)
    result[0x29ac] = 1
    if hashlib.sha256(result).hexdigest() != PATCHED:
        raise RuntimeError("Wine NCrypt repair checksum mismatch")
    path.write_bytes(result)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: enable-oaep.py ncrypt.dll [ncrypt.dll ...]")
    for argument in sys.argv[1:]:
        enable(Path(argument))
    print("Wine NCrypt OAEP forwarding enabled; BCrypt and authentication algorithms unchanged")
