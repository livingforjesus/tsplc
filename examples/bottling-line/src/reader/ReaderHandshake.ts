import { wrapAdd } from "@tsplc/compiler/types";
import type { ST_Reader } from "../types/ST_Reader.ts";
import { checksum } from "./checksum.ts";

interface ReaderInputs {
  /* Caller-owned reader record, borrowed for this call. */
  Reader: InOut<ST_Reader>;
}

interface ReaderOutputs {
  /* A new label was read and copied this scan. */
  NewLabel: BOOL;
  /* The reader reported a result without a usable code this scan. */
  NoRead: BOOL;
}

/*
Buffered-results handshake: when ResultsAvailable rises, copy the result and set
ResultsAck; clear ResultsAck after the reader withdraws ResultsAvailable.
*/
export class ReaderHandshake extends FunctionBlock<ReaderInputs, ReaderOutputs> {
  private available = new R_TRIG();

  protected execute(input: ReaderInputs): ReaderOutputs {
    this.available.update({ CLK: input.Reader.Input.ResultsAvailable });
    if (!input.Reader.Input.ResultsAvailable) {
      input.Reader.Output.ResultsAck = false;
      return { NewLabel: false, NoRead: false };
    }
    if (!this.available.out.Q) {
      return { NewLabel: false, NoRead: false };
    }
    input.Reader.Output.ResultsAck = true;
    const length: UINT = input.Reader.Input.ResultLength;
    if ((input.Reader.Input.ResultCode & 1) === 0 || length === 0 || length > 480) {
      input.Reader.NoReads = wrapAdd<UDINT>(input.Reader.NoReads, 1);
      return { NewLabel: false, NoRead: true };
    }
    // Arrays have value semantics: copy() takes an explicit snapshot.
    input.Reader.LastCode = copy(input.Reader.Input.ResultData);
    input.Reader.LastLength = length;
    input.Reader.LastChecksum = checksum(input.Reader.LastCode, length);
    return { NewLabel: true, NoRead: false };
  }
}
