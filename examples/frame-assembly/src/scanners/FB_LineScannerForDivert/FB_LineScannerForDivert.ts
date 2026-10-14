import type { E_LineDiverter } from "../../types/E_LineDiverter.ts";
import type { ST_LineDiverter } from "../../types/ST_LineDiverter/ST_LineDiverter.ts";
import type { ST_LineScanner } from "../../types/ST_LineScanner/ST_LineScanner.ts";
import type { ST_ScannerRequest } from "../../types/ST_ScannerRequest.ts";

interface Inputs {
  ConveyorId: INT;
  DiverterId: E_LineDiverter;
  Scanner: InOut<ST_LineScanner>;
  AssociatedDiverter: InOut<ST_LineDiverter>;
  Request: InOut<ST_ScannerRequest>;
}

export class FB_LineScannerForDivert extends FunctionBlock<Inputs> {
  protected execute(input: Inputs): void {
    input.Scanner.Output.BufferResultsEnable = true;

    if (!input.Scanner.Input.ResultsAvailable) {
      input.Scanner.Output.ResultsAck = false;
    }

    if (input.Request.RequestReady && input.Request.ResultReady) {
      if (input.Request.ApplyRouting) {
        input.AssociatedDiverter.Route = copy(input.Request.RoutingResult);
      }
      /* Identify straight-through lookups too, before publishing readiness. */
      input.AssociatedDiverter.Route.Barcode = input.Request.RoutingResult.Barcode;
      input.AssociatedDiverter.RouteReady = true;
      input.Request.RequestReady = false;
    }

    /* RouteReady stays true until the payload leaves, protecting this route before
   arrival and throughout transfer. The worker clears ResultReady after acknowledgement. */
    if (
      input.Request.RequestReady ||
      input.Request.ResultReady ||
      input.AssociatedDiverter.RouteReady ||
      input.Scanner.Output.ResultsAck ||
      !input.Scanner.Input.ResultsAvailable
    ) {
      return;
    }

    input.Scanner.Output.ResultsAck = true;

    if (
      (input.Scanner.Input.ResultCode & 1) === 0 ||
      input.Scanner.Input.ResultLength === 0 ||
      input.Scanner.Input.ResultLength > 484
    ) {
      input.AssociatedDiverter.RouteReady = true;
      return;
    }

    input.Request.Barcode = copy(input.Scanner.Input.ResultData);
    input.Request.BarcodeLength = input.Scanner.Input.ResultLength;
    input.Request.ConveyorId = input.ConveyorId;
    input.Request.DiverterId = input.DiverterId;
    input.Request.RequestReady = true;
  }
}
