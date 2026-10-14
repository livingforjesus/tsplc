/* Physical collection order along the carrier conveyor. Unknown passes through to the end. */
export enum E_LineCarrier {
  Unknown = 0,
  USPS = 1,
  DHLDomestic = 2,
  DHLInternational = 3,
  UPS = 4,
  FedEx = 5,
  Passport = 6,
  AmazonLogistics = 7,
}
