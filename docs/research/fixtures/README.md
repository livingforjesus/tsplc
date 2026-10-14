# Public EtherNet/IP EDS fixture

`opener_sample_app.eds` is an unchanged copy of the first-party OpENer sample at
https://github.com/EIPStackGroup/OpENer/blob/091e2de36f7dd640c708be6c9e40e307fe212260/data/opener_sample_app.eds

- Upstream project: EIPStackGroup/OpENer.
- Upstream copyright: Rockwell Automation, Inc., 2009.
- License: adapted BSD-style distribution license, retained verbatim in `OpENer-license.txt` (original file encoding).
- Retrieval: 2026-10-13.
- Bytes: 17437.
- SHA-256: `0e0da5ddd62f571ea319dc29254be08cac5134236b389174983d80f0e370760f`.

This is a public sample device, not a Cognex DataMan or B&R description. It is useful
for testing the real EDS grammar, repeated members, connection direction, sizes,
RPI parameter references, and an input-only connection. Input `Assem100` and output
`Assem150` each contain 32 eight-bit members; configuration `Assem151` contains ten.
The input-only connection has zero O→T data and a 32-byte T→O assembly.
No absolute CODESYS `%I`/`%Q` address is declared or inferred here.
