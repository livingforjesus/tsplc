/* Logical IO names. tsplc.config.ts binds each one to a device channel or address. */
declare const StartButton: Input<BOOL>;
declare const StopButton: Input<BOOL>;
declare const EStopHealthy: Input<BOOL>;
/* Rotary recipe selector: 1 water, 2 juice, 3 soda. */
declare const RecipeSelector: Input<BYTE>;
declare let RunLamp: Output<BOOL>;
declare let FaultLamp: Output<BOOL>;
declare let RejectGate: Output<BOOL>;
