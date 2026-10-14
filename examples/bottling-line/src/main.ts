import { exact, saturate, wrapAdd } from "@tsplc/compiler/types";
import { FillerControl } from "./filler/FillerControl.ts";
import * as Line from "./Line.ts";
import * as Production from "./Production.ts";
import { ReaderHandshake } from "./reader/ReaderHandshake.ts";
import { selectRecipe } from "./recipes.ts";
import { FillHeads, RejectPulse } from "./Settings.ts";
import { StackLight } from "./StackLight.ts";
import { E_LineState } from "./types/E_LineState.ts";

// Module-scope blocks keep their state between scans.
const startPressed = new R_TRIG();
const reader = new ReaderHandshake();
const filler = new FillerControl();
const rejectPulse = new TP();
const stackLight = new StackLight();

function updateState(): void {
  switch (Line.Status.State) {
    case E_LineState.Stopped:
      if (startPressed.out.Q && EStopHealthy && !StopButton) {
        Line.Status.State = E_LineState.Running;
      }
      break;
    case E_LineState.Running:
      if (!EStopHealthy) {
        Line.Status.State = E_LineState.Faulted;
      } else if (StopButton) {
        Line.Status.State = E_LineState.Stopped;
      }
      break;
    case E_LineState.Faulted:
      // Acknowledge with Stop once the emergency-stop chain is healthy again.
      if (EStopHealthy && StopButton) {
        Line.Status.State = E_LineState.Stopped;
      }
      break;
  }
}

export function main(): void {
  // Recipes change only while the line is stopped.
  if (Line.Status.State === E_LineState.Stopped) {
    Line.Status.Recipe = selectRecipe(RecipeSelector);
  }
  startPressed.update({ CLK: StartButton });
  updateState();
  const running: BOOL = Line.Status.State === E_LineState.Running;

  switch (Line.Status.State) {
    case E_LineState.Stopped:
      Line.Status.Message = "Stopped: select recipe and press Start";
      break;
    case E_LineState.Running:
      Line.Status.Message = "Running";
      break;
    case E_LineState.Faulted:
      Line.Status.Message = "Emergency stop: reset, then press Stop";
      break;
  }

  reader.update({ Reader: ref(Line.Reader) });
  rejectPulse.update({ IN: reader.out.NoRead, PT: RejectPulse });
  RejectGate = rejectPulse.out.Q;
  if (reader.out.NoRead) {
    Production.Counters.Rejected = wrapAdd<UDINT>(Production.Counters.Rejected, 1);
  }

  filler.update({
    Filler: ref(Line.Filler),
    Enabled: running,
    FillTime: Line.Status.Recipe.FillTime,
  });
  if (filler.out.BatchDone) {
    Production.Counters.Filled = wrapAdd<UDINT>(
      Production.Counters.Filled,
      exact<UDINT>(FillHeads),
    );
  }

  Line.Infeed.Speed = running ? Line.Status.Recipe.ConveyorSpeed : 0;
  Line.Status.RejectsShown = saturate<UINT>(Production.Counters.Rejected);

  stackLight.update({ State: Line.Status.State });
  RunLamp = stackLight.out.Green;
  FaultLamp = stackLight.out.Red;
}
