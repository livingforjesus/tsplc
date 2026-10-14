"""Extract the 3.5.22.30 InstallShield payload (adapted from the Mac guide)."""
import ctypes
import mmap
from pathlib import Path
import struct
import sys
import zlib

library = ctypes.CDLL(str(Path(__file__).with_name("decode.so")))
library.decode.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_char_p, ctypes.c_size_t]
output = Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
with open(sys.argv[1], "rb") as installer:
    with mmap.mmap(installer.fileno(), 0, access=mmap.ACCESS_READ) as data:
        position = data.find(b"ISSetupStream\0", 1300000)
        if position < 0:
            raise ValueError("Not the supported CODESYS 64 3.5.22.30 installer")
        count, archive_type = struct.unpack_from("<HI", data, position + 14)
        position += 46
        for _ in range(count):
            name_length, flags, length, compressed = struct.unpack_from("<II2xI8xH", data, position)
            position += 48 if archive_type == 4 else 24
            name = data[position:position + name_length].decode("utf-16le").rstrip("\0")
            position += name_length
            target = output / name.replace("\\", "/")
            if not target.resolve().is_relative_to(output) or position + length > len(data):
                raise ValueError("Invalid installer archive entry")
            target.parent.mkdir(parents=True, exist_ok=True)
            key = bytes(c ^ b"\x13\x35\x86\x07"[i % 4] for i, c in enumerate(name.encode()))
            print(name, flush=True)
            decompressor = zlib.decompressobj() if compressed else None
            with target.open("wb") as destination:
                for offset in range(0, length, 1048576):
                    block = ctypes.create_string_buffer(data[position + offset:position + min(offset + 1048576, length)])
                    size = len(block) - 1
                    if flags & 4:
                        library.decode(block, size, key, len(key))
                    destination.write(decompressor.decompress(block.raw[:size]) if decompressor else block.raw[:size])
                if decompressor:
                    destination.write(decompressor.flush())
                    if not decompressor.eof:
                        raise ValueError("Incomplete compressed installer entry")
            position += length
