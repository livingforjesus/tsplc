import { defaultValue, type BOOL } from "@vplc/compiler/types";
import type { trafficLightCars, trafficLightPed } from "./types.ts";

export interface TrafficIO {
  Cross1CarU: trafficLightCars;
  Cross1CarD: trafficLightCars;
  Cross1CarL: trafficLightCars;
  Cross1CarR: trafficLightCars;
  Cross2CarU: trafficLightCars;
  Cross2CarD: trafficLightCars;
  Cross2CarL: trafficLightCars;
  Cross2CarR: trafficLightCars;
  Cross1PedLUD: trafficLightPed;
  Cross1PedLDU: trafficLightPed;
  Cross1PedRUD: trafficLightPed;
  Cross1PedRDU: trafficLightPed;
  Cross1PedULR: trafficLightPed;
  Cross1PedURL: trafficLightPed;
  Cross1PedDLR: trafficLightPed;
  Cross1PedDRL: trafficLightPed;
  Cross2PedLUD: trafficLightPed;
  Cross2PedLDU: trafficLightPed;
  Cross2PedRUD: trafficLightPed;
  Cross2PedRDU: trafficLightPed;
  Cross2PedULR: trafficLightPed;
  Cross2PedURL: trafficLightPed;
  Cross2PedDLR: trafficLightPed;
  Cross2PedDRL: trafficLightPed;
  PoliceModeActivated: BOOL;
}

export const gIO = defaultValue<TrafficIO>();
