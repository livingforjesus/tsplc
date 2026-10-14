import * as LineCollections from "../globals/LineCollections.ts";
import * as LineConstants from "../globals/LineConstants.ts";
import * as LineIO from "../globals/LineIO.ts";
import * as LineStations from "../globals/LineStations.ts";
import { E_LineCarrier } from "../types/E_LineCarrier.ts";
import { E_LineStation } from "../types/E_LineStation.ts";
import { F_DiverterRoute } from "./F_DiverterRoute.ts";
import { F_StationAvailable } from "./F_StationAvailable.ts";
import { FB_Diverter } from "./FB_Diverter/FB_Diverter.ts";

const Oversize = new FB_Diverter();
const Canvas = new FB_Diverter();
const FramingPair01 = new FB_Diverter();
const FramingPair02 = new FB_Diverter();
const FramingPair03 = new FB_Diverter();
const FramingPair04 = new FB_Diverter();
const FramingPair05 = new FB_Diverter();
const FramingPair06 = new FB_Diverter();
const EmptyBinCollection = new FB_Diverter();
const QualityControl = new FB_Diverter();
const FinishingLoadBalancer = new FB_Diverter();
const FinishingArrival = new R_TRIG();
let FinishingRoute: INT = LineConstants.RouteLeft;
const Carrier01 = new FB_Diverter();
const Carrier02 = new FB_Diverter();
const Carrier03 = new FB_Diverter();
const Carrier04 = new FB_Diverter();

export function PRG_Diverters(): void {
  /* Physical sides are provisional: verify them along the direction of travel. */
  Oversize.update({
    Enabled: LineIO.Conveyor_Inbound.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_Oversize.Route.TargetStation === E_LineStation.Oversize,
      false,
    ),
    LeftAvailable: F_StationAvailable(copy(LineStations.Station_Oversize)),
    RightAvailable: false,
    Diverter: ref(LineIO.Diverter_Oversize),
  });

  Canvas.update({
    Enabled: LineIO.Conveyor_Inbound.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_Canvas.Route.TargetStation === E_LineStation.Canvas,
      false,
    ),
    LeftAvailable: F_StationAvailable(copy(LineStations.Station_Canvas)),
    RightAvailable: false,
    Diverter: ref(LineIO.Diverter_Canvas),
  });

  FramingPair01.update({
    Enabled: LineIO.Conveyor_Inbound.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_FramingPair01.Route.TargetStation === E_LineStation.Framing01,
      LineIO.Diverter_FramingPair01.Route.TargetStation === E_LineStation.Framing02,
    ),
    LeftAvailable: F_StationAvailable(copy(LineStations.Station_Framing01)),
    RightAvailable: F_StationAvailable(copy(LineStations.Station_Framing02)),
    Diverter: ref(LineIO.Diverter_FramingPair01),
  });

  FramingPair02.update({
    Enabled: LineIO.Conveyor_Inbound.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_FramingPair02.Route.TargetStation === E_LineStation.Framing03,
      LineIO.Diverter_FramingPair02.Route.TargetStation === E_LineStation.Framing04,
    ),
    LeftAvailable: F_StationAvailable(copy(LineStations.Station_Framing03)),
    RightAvailable: F_StationAvailable(copy(LineStations.Station_Framing04)),
    Diverter: ref(LineIO.Diverter_FramingPair02),
  });

  FramingPair03.update({
    Enabled: LineIO.Conveyor_Inbound.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_FramingPair03.Route.TargetStation === E_LineStation.Framing05,
      LineIO.Diverter_FramingPair03.Route.TargetStation === E_LineStation.Framing06,
    ),
    LeftAvailable: F_StationAvailable(copy(LineStations.Station_Framing05)),
    RightAvailable: F_StationAvailable(copy(LineStations.Station_Framing06)),
    Diverter: ref(LineIO.Diverter_FramingPair03),
  });

  FramingPair04.update({
    Enabled: LineIO.Conveyor_Inbound.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_FramingPair04.Route.TargetStation === E_LineStation.Framing07,
      LineIO.Diverter_FramingPair04.Route.TargetStation === E_LineStation.Framing08,
    ),
    LeftAvailable: F_StationAvailable(copy(LineStations.Station_Framing07)),
    RightAvailable: F_StationAvailable(copy(LineStations.Station_Framing08)),
    Diverter: ref(LineIO.Diverter_FramingPair04),
  });

  FramingPair05.update({
    Enabled: LineIO.Conveyor_Inbound.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_FramingPair05.Route.TargetStation === E_LineStation.Framing09,
      LineIO.Diverter_FramingPair05.Route.TargetStation === E_LineStation.Framing10,
    ),
    LeftAvailable: F_StationAvailable(copy(LineStations.Station_Framing09)),
    RightAvailable: F_StationAvailable(copy(LineStations.Station_Framing10)),
    Diverter: ref(LineIO.Diverter_FramingPair05),
  });

  FramingPair06.update({
    Enabled: LineIO.Conveyor_Inbound.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_FramingPair06.Route.TargetStation === E_LineStation.Framing11,
      LineIO.Diverter_FramingPair06.Route.TargetStation === E_LineStation.Framing12,
    ),
    LeftAvailable: F_StationAvailable(copy(LineStations.Station_Framing11)),
    RightAvailable: F_StationAvailable(copy(LineStations.Station_Framing12)),
    Diverter: ref(LineIO.Diverter_FramingPair06),
  });

  EmptyBinCollection.update({
    Enabled: LineIO.Conveyor_Outbound.Enabled,
    RequestedDirection: LineIO.Diverter_EmptyBinCollection.Route.EmptyBin
      ? LineConstants.RouteRight
      : LineConstants.RouteThrough,
    LeftAvailable: false,
    RightAvailable: !LineCollections.Collection_EmptyBins.Full,
    Diverter: ref(LineIO.Diverter_EmptyBinCollection),
  });

  QualityControl.update({
    Enabled: LineIO.Conveyor_Outbound.Enabled,
    RequestedDirection: LineIO.Diverter_QualityControl.Route.HasQC
      ? LineConstants.RouteRight
      : LineConstants.RouteThrough,
    LeftAvailable: false,
    RightAvailable: !LineCollections.Collection_QualityControl.Full,
    Diverter: ref(LineIO.Diverter_QualityControl),
  });

  /* Alternate once per photoeye arrival; FB_Diverter holds the direction until departure. */
  FinishingArrival.update({ CLK: LineIO.Diverter_ShrinkWrapLoadBalancer.BinPresent });
  if (FinishingArrival.out.Q) {
    FinishingRoute =
      FinishingRoute === LineConstants.RouteThrough
        ? LineConstants.RouteLeft
        : LineConstants.RouteThrough;
  }
  LineIO.Diverter_ShrinkWrapLoadBalancer.RouteReady = true;
  FinishingLoadBalancer.update({
    Enabled: LineIO.Conveyor_Outbound.Enabled,
    RequestedDirection: FinishingRoute,
    LeftAvailable: true,
    RightAvailable: false,
    Diverter: ref(LineIO.Diverter_ShrinkWrapLoadBalancer),
  });

  Carrier01.update({
    Enabled: LineIO.Conveyor_CarrierSorting.Enabled,
    RequestedDirection: F_DiverterRoute(
      false,
      LineIO.Diverter_Carrier01.Route.TargetCarrier === E_LineCarrier.USPS,
    ),
    LeftAvailable: false,
    RightAvailable: true,
    Diverter: ref(LineIO.Diverter_Carrier01),
  });

  Carrier02.update({
    Enabled: LineIO.Conveyor_CarrierSorting.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_Carrier02.Route.TargetCarrier === E_LineCarrier.DHLDomestic,
      LineIO.Diverter_Carrier02.Route.TargetCarrier === E_LineCarrier.DHLInternational,
    ),
    LeftAvailable: true,
    RightAvailable: true,
    Diverter: ref(LineIO.Diverter_Carrier02),
  });

  Carrier03.update({
    Enabled: LineIO.Conveyor_CarrierSorting.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_Carrier03.Route.TargetCarrier === E_LineCarrier.UPS,
      LineIO.Diverter_Carrier03.Route.TargetCarrier === E_LineCarrier.FedEx,
    ),
    LeftAvailable: true,
    RightAvailable: true,
    Diverter: ref(LineIO.Diverter_Carrier03),
  });

  Carrier04.update({
    Enabled: LineIO.Conveyor_CarrierSorting.Enabled,
    RequestedDirection: F_DiverterRoute(
      LineIO.Diverter_Carrier04.Route.TargetCarrier === E_LineCarrier.Passport,
      LineIO.Diverter_Carrier04.Route.TargetCarrier === E_LineCarrier.AmazonLogistics,
    ),
    LeftAvailable: true,
    RightAvailable: true,
    Diverter: ref(LineIO.Diverter_Carrier04),
  });
}
