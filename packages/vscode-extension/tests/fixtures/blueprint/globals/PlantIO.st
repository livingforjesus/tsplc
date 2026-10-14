{attribute 'linkalways'}
{attribute 'qualified_only'}
(* Bottling line devices and operator controls. *)
VAR_GLOBAL
	(* Motor-driven roller zone chain *)
	{attribute 'symbol' := 'readwrite'}
	Conveyor_Infeed : ST_Conveyor;
	(* Motor-driven roller zone chain *)
	{attribute 'symbol' := 'readwrite'}
	Conveyor_Outfeed : ST_Conveyor;
	(* Motor-driven roller zone chain *)
	{attribute 'symbol' := 'readwrite'}
	Conveyor_Palletizing : ST_Conveyor;
	(* Barcode reader identifying large-format containers for the sorter *)
	{attribute 'symbol' := 'readwrite'}
	Reader_LargeFormat : ST_Reader;
	(* Barcode reader identifying sample bottles for the sorter *)
	{attribute 'symbol' := 'readwrite'}
	Reader_Sampling : ST_Reader;
	(* Barcode reader sending lot data to filler 1 or 2 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_FillerPair01 : ST_Reader;
	(* Barcode reader sending lot data to filler 3 or 4 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_FillerPair02 : ST_Reader;
	(* Barcode reader sending lot data to filler 5 or 6 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_FillerPair03 : ST_Reader;
	(* Barcode reader sending lot data to filler 7 or 8 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_FillerPair04 : ST_Reader;
	(* Barcode reader sending lot data to filler 9 or 10 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_FillerPair05 : ST_Reader;
	(* Barcode reader sending lot data to filler 11 or 12 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_FillerPair06 : ST_Reader;
	(* Barcode reader identifying empty crates for the sorter *)
	{attribute 'symbol' := 'readwrite'}
	Reader_EmptyCrates : ST_Reader;
	(* Barcode reader identifying rejected bottles for the sorter *)
	{attribute 'symbol' := 'readwrite'}
	Reader_Rejects : ST_Reader;
	(* Barcode reader sending lot data to capper 1 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_Capper01 : ST_Reader;
	(* Barcode reader sending lot data to capper 2 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_Capper02 : ST_Reader;
	(* Barcode reader sending lot data to labeler 1 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_Labeler01 : ST_Reader;
	(* Barcode reader sending lot data to labeler 2 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_Labeler02 : ST_Reader;
	(* Barcode reader sending lot data to case packer 1 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_CasePacker01 : ST_Reader;
	(* Barcode reader sending lot data to case packer 2 *)
	{attribute 'symbol' := 'readwrite'}
	Reader_CasePacker02 : ST_Reader;
	(* Barcode reader for routing cases to a pallet lane *)
	{attribute 'symbol' := 'readwrite'}
	Reader_Palletizing : ST_Reader;
	(* Photoeye for final backup detection that stops the large-format sorter *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_LargeFormat_BackupLimit : ST_Photoeye;
	(* Photoeye for early warning of a backup in the large-format direction *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_LargeFormat_BackupWarning : ST_Photoeye;
	(* Photoeye for final backup detection that stops the sampling sorter *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Sampling_BackupLimit : ST_Photoeye;
	(* Photoeye for early warning of a backup in the sampling direction *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Sampling_BackupWarning : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 1 for Sorter_FillerPair01 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler01_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 1 for Sorter_FillerPair01 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler01_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 2 for Sorter_FillerPair01 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler02_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 2 for Sorter_FillerPair01 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler02_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 3 for Sorter_FillerPair02 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler03_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 3 for Sorter_FillerPair02 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler03_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 4 for Sorter_FillerPair02 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler04_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 4 for Sorter_FillerPair02 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler04_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 5 for Sorter_FillerPair03 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler05_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 5 for Sorter_FillerPair03 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler05_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 6 for Sorter_FillerPair03 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler06_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 6 for Sorter_FillerPair03 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler06_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 7 for Sorter_FillerPair04 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler07_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 7 for Sorter_FillerPair04 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler07_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 8 for Sorter_FillerPair04 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler08_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 8 for Sorter_FillerPair04 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler08_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 9 for Sorter_FillerPair05 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler09_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 9 for Sorter_FillerPair05 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler09_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 10 for Sorter_FillerPair05 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler10_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 10 for Sorter_FillerPair05 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler10_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 11 for Sorter_FillerPair06 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler11_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 11 for Sorter_FillerPair06 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler11_TransferFeedback : ST_Photoeye;
	(* Photoeye detecting a bottle at filler 12 for Sorter_FillerPair06 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler12_Presence : ST_Photoeye;
	(* Photoeye timing the transfer at filler 12 for Sorter_FillerPair06 *)
	{attribute 'symbol' := 'readwrite'}
	Photoeye_Filler12_TransferFeedback : ST_Photoeye;
	(* Sorts large-format containers right *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_LargeFormat : ST_Sorter;
	(* Sorts sample bottles right *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_Sampling : ST_Sorter;
	(* Sorts bottles between fillers 1 and 2 *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_FillerPair01 : ST_Sorter;
	(* Sorts bottles between fillers 3 and 4 *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_FillerPair02 : ST_Sorter;
	(* Sorts bottles between fillers 5 and 6 *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_FillerPair03 : ST_Sorter;
	(* Sorts bottles between fillers 7 and 8 *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_FillerPair04 : ST_Sorter;
	(* Sorts bottles between fillers 9 and 10 *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_FillerPair05 : ST_Sorter;
	(* Sorts bottles between fillers 11 and 12 *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_FillerPair06 : ST_Sorter;
	(* Sorts empty crates right; full crates and rejects continue straight. *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_EmptyCrates : ST_Sorter;
	(* Sorts rejected bottles right and passes through all others *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_Rejects : ST_Sorter;
	(* Sorts all right *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_Capper01 : ST_Sorter;
	(* Sorts cases labelled for pallet lane 1 right, passes through all others *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_Pallet01 : ST_Sorter;
	(* Sorts cases labelled for pallet lane 2 right, passes through all others *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_Pallet02 : ST_Sorter;
	(* Sorts cases labelled for pallet lane 3 right, passes through all others *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_Pallet03 : ST_Sorter;
	(* Sorts cases labelled for pallet lane 4 right, passes through all others *)
	{attribute 'symbol' := 'readwrite'}
	Sorter_Pallet04 : ST_Sorter;
	(* Distributes bottles between the two capper approach conveyors. *)
	{attribute 'symbol' := 'readwrite'}
	SIM_Sorter_CapperLoadBalancer : ST_Sorter;
	(* Push button for overall system activation *)
	{attribute 'symbol' := 'readwrite'}
	Button_SystemStart01 : ST_Button;
	(* Push button for overall system activation *)
	{attribute 'symbol' := 'readwrite'}
	Button_SystemStart02 : ST_Button;
	(* Push button for overall system activation *)
	{attribute 'symbol' := 'readwrite'}
	Button_SystemStart03 : ST_Button;
	(* Push button for overall system deactivation *)
	{attribute 'symbol' := 'readwrite'}
	Button_SystemStop01 : ST_Button;
	(* Push button for overall system deactivation *)
	{attribute 'symbol' := 'readwrite'}
	Button_SystemStop02 : ST_Button;
	(* Push button for overall system deactivation *)
	{attribute 'symbol' := 'readwrite'}
	Button_SystemStop03 : ST_Button;
	(* Emergency stop for system *)
	{attribute 'symbol' := 'readwrite'}
	SIM_EmergencyStop01 : ST_Estop;
	(* Emergency stop for system *)
	{attribute 'symbol' := 'readwrite'}
	SIM_EmergencyStop02 : ST_Estop;
	(* Emergency stop for system *)
	{attribute 'symbol' := 'readwrite'}
	SIM_EmergencyStop03 : ST_Estop;
	(* Stack light for overall system status *)
	{attribute 'symbol' := 'readwrite'}
	StackLight_System01 : ST_StackLight;
	(* Stack light for overall system status *)
	{attribute 'symbol' := 'readwrite'}
	StackLight_System02 : ST_StackLight;
	(* Stack light for overall system status *)
	{attribute 'symbol' := 'readwrite'}
	StackLight_System03 : ST_StackLight;
	(* Alarm sounds briefly as the conveyor system starts, connected to the stack light *)
	{attribute 'symbol' := 'readwrite'}
	Alarm_SystemStartup : ST_Alarm;
END_VAR
