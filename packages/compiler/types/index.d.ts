// Canonical PLC declarations: TypeScript supplies editor/checker compatibility;
// the compiler preserves scalar domains and lowers intrinsics without JS execution.
export type BOOL = boolean;
export type SINT = number;
export type USINT = number;
export type INT = number;
export type UINT = number;
export type DINT = number;
export type UDINT = number;
export type LINT = bigint;
export type ULINT = bigint;
export type BYTE = number;
export type WORD = number;
export type DWORD = number;
export type LWORD = bigint;
export type REAL = number;
export type LREAL = number;
export type Input<T> = T;
export type Output<T> = T;

// Conversions and arithmetic state their overflow policy explicitly.
export declare function exact<T extends number | bigint>(value: number | bigint): T;
export declare function wrap<T extends number | bigint>(value: number | bigint): T;
// Float-to-float saturation clips to finite target endpoints, then rounds to its width.
export declare function saturate<T extends number | bigint>(value: number | bigint): T;
export declare function wrapAdd<T extends number | bigint>(left: T, right: T): T;
export declare function wrapSubtract<T extends number | bigint>(left: T, right: T): T;
export declare function wrapMultiply<T extends number | bigint>(left: T, right: T): T;
export declare function saturatingAdd<T extends number | bigint>(left: T, right: T): T;
export declare function saturatingSubtract<T extends number | bigint>(left: T, right: T): T;
export declare function saturatingMultiply<T extends number | bigint>(left: T, right: T): T;
export declare function div<T extends number | bigint>(left: T, right: T): T;

// Capacity and bounds are compiler metadata, erased by the TypeScript checker.
export type FixedArray<T, _N extends number, _Lower extends number = 0> = T[];
export type STRING<_N extends number> = string;
export type WSTRING<_N extends number> = string;
export declare function defaultValue<T>(): T;
export declare function copy<T>(value: T): T;

declare const timeBrand: unique symbol;
declare const calendarBrand: unique symbol;
export type TIME = number & { readonly [timeBrand]: "TIME" };
export type DATE = string & { readonly [calendarBrand]: "DATE" };
export type TIME_OF_DAY = string & { readonly [calendarBrand]: "TIME_OF_DAY" };
export type DATE_AND_TIME = string & { readonly [calendarBrand]: "DATE_AND_TIME" };

// Borrowing and retained storage are checked by the compiler, not JS wrappers.
export type InOut<T> = T;
export declare function ref<T>(value: T): InOut<T>;
export declare function retain<T>(value: T): T;

export declare function ms(value: number): TIME;
export declare function seconds(value: number): TIME;
export declare function minutes(value: number): TIME;
// TIME stores unsigned 32-bit milliseconds; this preserves that complete range.
export declare function timeToMilliseconds(value: TIME): UDINT;
export declare function date(value: string): DATE;
export declare function timeOfDay(value: string): TIME_OF_DAY;
export declare function dateAndTime(value: string): DATE_AND_TIME;

// The empty output schema makes execute return void for outputless blocks.
// Native blocks expose vendor formal names through the same static interface.
export declare abstract class FunctionBlock<I, O = Record<never, never>> {
  readonly out: Readonly<O>;
  update(input: I): void;
  protected abstract execute(input: I): keyof O extends never ? void : O;
}

// CODESYS Util.BLINK holds OUT when disabled; native timing belongs to Util.
export declare class BLINK extends FunctionBlock<
  { ENABLE: BOOL; TIMELOW: TIME; TIMEHIGH: TIME },
  { OUT: BOOL }
> {
  protected execute(input: { ENABLE: BOOL; TIMELOW: TIME; TIMEHIGH: TIME }): { OUT: BOOL };
}

export declare class TON extends FunctionBlock<{ IN: BOOL; PT: TIME }, { Q: BOOL; ET: TIME }> {
  protected execute(input: { IN: BOOL; PT: TIME }): { Q: BOOL; ET: TIME };
}

export declare class TOF extends FunctionBlock<{ IN: BOOL; PT: TIME }, { Q: BOOL; ET: TIME }> {
  protected execute(input: { IN: BOOL; PT: TIME }): { Q: BOOL; ET: TIME };
}

export declare class TP extends FunctionBlock<{ IN: BOOL; PT: TIME }, { Q: BOOL; ET: TIME }> {
  protected execute(input: { IN: BOOL; PT: TIME }): { Q: BOOL; ET: TIME };
}

export declare class R_TRIG extends FunctionBlock<{ CLK: BOOL }, { Q: BOOL }> {
  protected execute(input: { CLK: BOOL }): { Q: BOOL };
}

export declare class F_TRIG extends FunctionBlock<{ CLK: BOOL }, { Q: BOOL }> {
  protected execute(input: { CLK: BOOL }): { Q: BOOL };
}
