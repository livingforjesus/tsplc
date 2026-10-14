/* Barcode reader signals from input assembly 11 (reader to PLC). */
export interface ST_ReaderInput {
  ResultsAvailable: BOOL;
  /* Bit 0 set means the code was read. */
  ResultCode: WORD;
  /* Number of valid bytes in ResultData. */
  ResultLength: UINT;
  /* Raw decode result; 480 bytes fit the default 496-byte connection. */
  ResultData: FixedArray<BYTE, 480>;
}

/* Barcode reader signals for output assembly 21 (PLC to reader). */
export interface ST_ReaderOutput {
  ResultsAck: BOOL;
}

/* Reader handshake state and the last accepted label. */
export interface ST_Reader {
  Input: ST_ReaderInput;
  Output: ST_ReaderOutput;
  /* Copy of the last good read, kept stable until the next label. */
  LastCode: FixedArray<BYTE, 480>;
  LastLength: UINT;
  /* XOR checksum of LastCode, published for host-side label lookups. */
  LastChecksum: BYTE;
  NoReads: UDINT;
}
