// frontend/src/ui/options.js
export const years         = Array.from({ length: 21 }, (_, i) => String(2005 + i)); // 2005–2025
export const models        = ['Charger','Challenger','Durango','Trackhawk','TRX','300','Magnum','Other'];
export const engines       = ['Pre-eagle 5.7L','Eagle 5.7L','6.1L','6.4L (392)','Hellcat 6.2L','HO Hellcat 6.2L','Other'];
export const injectors     = ['Stock','ID1050x','ID1300x','ID1700x','Other'];
export const mapSensors    = ['OEM 1 bar','2 bar','3 bar','Other'];
export const throttles     = ['Stock','84mm','90mm','95mm','105mm','108mm','112mm','120mm','130mm','Other'];
export const powerAdders   = ['N/A','PD blower','Centrifugal','Turbo','Nitrous'];
export const transmissions = ['Manual','5-speed auto','6-speed auto','8-speed auto'];
export const tireHeights   = ['26"','27"','28"','29"','30"','31"','32"','Other'];
export const gearRatios    = ['2.62','2.82','3.09','3.23','3.55','3.73','3.92','4.10','Other'];
export const fuels         = ['91','93','E85','Race Gas'];
