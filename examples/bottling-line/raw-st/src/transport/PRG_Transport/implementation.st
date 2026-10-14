ClampedSpeed := F_Clamp(Value := 150, Low := 0, High := 100);
Conveyor.SetEnabled(Asserted := IO.StartButton);
Conveyor();
Conveyor.RequestedSpeed := ClampedSpeed;
IO.InfeedSpeed := INT_TO_UINT(ClampedSpeed);
