import * as LineConstants from "../globals/LineConstants.ts";
import * as LineIO from "../globals/LineIO.ts";
import * as LineScannerRequests from "../globals/LineScannerRequests.ts";
import { E_LineDiverter } from "../types/E_LineDiverter.ts";
import { FB_LineScannerForDivert } from "./FB_LineScannerForDivert/FB_LineScannerForDivert.ts";

const OversizeScanner = new FB_LineScannerForDivert();
const CanvasScanner = new FB_LineScannerForDivert();
const FramingPair01Scanner = new FB_LineScannerForDivert();
const FramingPair02Scanner = new FB_LineScannerForDivert();
const FramingPair03Scanner = new FB_LineScannerForDivert();
const FramingPair04Scanner = new FB_LineScannerForDivert();
const FramingPair05Scanner = new FB_LineScannerForDivert();
const FramingPair06Scanner = new FB_LineScannerForDivert();
const EmptyBinConveyorScanner = new FB_LineScannerForDivert();
const QCConveyorScanner = new FB_LineScannerForDivert();
const Carrier01Scanner = new FB_LineScannerForDivert();
const Carrier02Scanner = new FB_LineScannerForDivert();
const Carrier03Scanner = new FB_LineScannerForDivert();
const Carrier04Scanner = new FB_LineScannerForDivert();

export function PRG_LineScanners(): void {
  OversizeScanner.update({
    ConveyorId: LineConstants.ConveyorInbound,
    DiverterId: E_LineDiverter.Oversize,
    Scanner: ref(LineIO.Scanner_Oversize),
    AssociatedDiverter: ref(LineIO.Diverter_Oversize),
    Request: ref(LineScannerRequests.Oversize),
  });
  CanvasScanner.update({
    ConveyorId: LineConstants.ConveyorInbound,
    DiverterId: E_LineDiverter.Canvas,
    Scanner: ref(LineIO.Scanner_Canvas),
    AssociatedDiverter: ref(LineIO.Diverter_Canvas),
    Request: ref(LineScannerRequests.Canvas),
  });

  FramingPair01Scanner.update({
    ConveyorId: LineConstants.ConveyorInbound,
    DiverterId: E_LineDiverter.FramingPair01,
    Scanner: ref(LineIO.Scanner_FramingPair01),
    AssociatedDiverter: ref(LineIO.Diverter_FramingPair01),
    Request: ref(LineScannerRequests.FramingPair01),
  });
  FramingPair02Scanner.update({
    ConveyorId: LineConstants.ConveyorInbound,
    DiverterId: E_LineDiverter.FramingPair02,
    Scanner: ref(LineIO.Scanner_FramingPair02),
    AssociatedDiverter: ref(LineIO.Diverter_FramingPair02),
    Request: ref(LineScannerRequests.FramingPair02),
  });
  FramingPair03Scanner.update({
    ConveyorId: LineConstants.ConveyorInbound,
    DiverterId: E_LineDiverter.FramingPair03,
    Scanner: ref(LineIO.Scanner_FramingPair03),
    AssociatedDiverter: ref(LineIO.Diverter_FramingPair03),
    Request: ref(LineScannerRequests.FramingPair03),
  });
  FramingPair04Scanner.update({
    ConveyorId: LineConstants.ConveyorInbound,
    DiverterId: E_LineDiverter.FramingPair04,
    Scanner: ref(LineIO.Scanner_FramingPair04),
    AssociatedDiverter: ref(LineIO.Diverter_FramingPair04),
    Request: ref(LineScannerRequests.FramingPair04),
  });
  FramingPair05Scanner.update({
    ConveyorId: LineConstants.ConveyorInbound,
    DiverterId: E_LineDiverter.FramingPair05,
    Scanner: ref(LineIO.Scanner_FramingPair05),
    AssociatedDiverter: ref(LineIO.Diverter_FramingPair05),
    Request: ref(LineScannerRequests.FramingPair05),
  });
  FramingPair06Scanner.update({
    ConveyorId: LineConstants.ConveyorInbound,
    DiverterId: E_LineDiverter.FramingPair06,
    Scanner: ref(LineIO.Scanner_FramingPair06),
    AssociatedDiverter: ref(LineIO.Diverter_FramingPair06),
    Request: ref(LineScannerRequests.FramingPair06),
  });

  EmptyBinConveyorScanner.update({
    ConveyorId: LineConstants.ConveyorOutbound,
    DiverterId: E_LineDiverter.EmptyBinCollection,
    Scanner: ref(LineIO.Scanner_EmptyBinCollection),
    AssociatedDiverter: ref(LineIO.Diverter_EmptyBinCollection),
    Request: ref(LineScannerRequests.EmptyBinCollection),
  });
  QCConveyorScanner.update({
    ConveyorId: LineConstants.ConveyorOutbound,
    DiverterId: E_LineDiverter.QualityControl,
    Scanner: ref(LineIO.Scanner_QualityControl),
    AssociatedDiverter: ref(LineIO.Diverter_QualityControl),
    Request: ref(LineScannerRequests.QualityControl),
  });
  Carrier01Scanner.update({
    ConveyorId: LineConstants.ConveyorCarrierSorting,
    DiverterId: E_LineDiverter.Carrier01,
    Scanner: ref(LineIO.Scanner_Carrier01),
    AssociatedDiverter: ref(LineIO.Diverter_Carrier01),
    Request: ref(LineScannerRequests.Carrier01),
  });

  Carrier02Scanner.update({
    ConveyorId: LineConstants.ConveyorCarrierSorting,
    DiverterId: E_LineDiverter.Carrier02,
    Scanner: ref(LineIO.Scanner_Carrier02),
    AssociatedDiverter: ref(LineIO.Diverter_Carrier02),
    Request: ref(LineScannerRequests.Carrier02),
  });

  Carrier03Scanner.update({
    ConveyorId: LineConstants.ConveyorCarrierSorting,
    DiverterId: E_LineDiverter.Carrier03,
    Scanner: ref(LineIO.Scanner_Carrier03),
    AssociatedDiverter: ref(LineIO.Diverter_Carrier03),
    Request: ref(LineScannerRequests.Carrier03),
  });

  Carrier04Scanner.update({
    ConveyorId: LineConstants.ConveyorCarrierSorting,
    DiverterId: E_LineDiverter.Carrier04,
    Scanner: ref(LineIO.Scanner_Carrier04),
    AssociatedDiverter: ref(LineIO.Diverter_Carrier04),
    Request: ref(LineScannerRequests.Carrier04),
  });
}
