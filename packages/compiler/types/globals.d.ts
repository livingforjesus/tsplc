export {};

// Ambient spellings point to the canonical SDK types; the frontend checks this
// declaration identity rather than trusting a same-named user alias.
declare global {
  type BOOL = import("./index").BOOL;
  type SINT = import("./index").SINT;
  type USINT = import("./index").USINT;
  type INT = import("./index").INT;
  type UINT = import("./index").UINT;
  type DINT = import("./index").DINT;
  type UDINT = import("./index").UDINT;
  type LINT = import("./index").LINT;
  type ULINT = import("./index").ULINT;
  type BYTE = import("./index").BYTE;
  type WORD = import("./index").WORD;
  type DWORD = import("./index").DWORD;
  type LWORD = import("./index").LWORD;
  type REAL = import("./index").REAL;
  type LREAL = import("./index").LREAL;
  type Input<T> = import("./index").Input<T>;
  type Output<T> = import("./index").Output<T>;

  type TIME = import("./index").TIME;
  type DATE = import("./index").DATE;
  type TIME_OF_DAY = import("./index").TIME_OF_DAY;
  type DATE_AND_TIME = import("./index").DATE_AND_TIME;

  type InOut<T> = import("./index").InOut<T>;
  type FunctionBlock<I, O = Record<never, never>> = import("./index").FunctionBlock<I, O>;
  const FunctionBlock: typeof import("./index").FunctionBlock;
  type BLINK = import("./index").BLINK;
  const BLINK: typeof import("./index").BLINK;
  type TON = import("./index").TON;
  const TON: typeof import("./index").TON;
  type TOF = import("./index").TOF;
  const TOF: typeof import("./index").TOF;
  type TP = import("./index").TP;
  const TP: typeof import("./index").TP;
  type R_TRIG = import("./index").R_TRIG;
  const R_TRIG: typeof import("./index").R_TRIG;
  type F_TRIG = import("./index").F_TRIG;
  const F_TRIG: typeof import("./index").F_TRIG;
  const ref: typeof import("./index").ref;
  const retain: typeof import("./index").retain;
  const ms: typeof import("./index").ms;
  const seconds: typeof import("./index").seconds;
  const minutes: typeof import("./index").minutes;
  const timeToMilliseconds: typeof import("./index").timeToMilliseconds;
  const date: typeof import("./index").date;
  const timeOfDay: typeof import("./index").timeOfDay;
  const dateAndTime: typeof import("./index").dateAndTime;

  type FixedArray<T, N extends number, Lower extends number = 0> = import("./index").FixedArray<
    T,
    N,
    Lower
  >;
  type STRING<N extends number> = import("./index").STRING<N>;
  type WSTRING<N extends number> = import("./index").WSTRING<N>;
  const defaultValue: typeof import("./index").defaultValue;
  const copy: typeof import("./index").copy;
}
