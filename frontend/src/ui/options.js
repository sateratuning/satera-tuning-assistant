// frontend/src/ui/options.js

// ── Shared ────────────────────────────────────────────────
export const years       = Array.from({ length: 21 }, (_, i) => String(2005 + i)); // 2005–2025
export const fuels       = ['91', '93', 'E30', 'E50', 'E85', 'Race Gas'];
export const powerAdders = ['N/A', 'PD blower', 'Centrifugal', 'Turbo', 'Nitrous'];
export const tireHeights = ['26', '27', '28', '29', '30', '31', '32', 'Other'];
export const gearRatios  = ['2.62', '2.82', '3.06', '3.09', '3.23', '3.31', '3.55', '3.73', '3.92', '4.10', 'Other'];

// ── Mopar / Gen3 HEMI ─────────────────────────────────────
export const models        = ['Charger', 'Challenger', 'Durango', 'Trackhawk', 'TRX', '300', 'Magnum', 'Other'];
export const engines       = ['Pre-eagle 5.7L', 'Eagle 5.7L', '6.1L', '6.4L (392)', 'Hellcat 6.2L', 'HO Hellcat 6.2L', 'Other'];
export const injectors     = ['Stock', 'ID850x', 'ID1050x', 'ID1300x', 'ID1700x', 'Other'];
export const mapSensors    = ['OEM 1 bar', '2 bar', '3 bar', 'Other'];
export const throttles     = ['Stock', '84mm', '90mm', '95mm', '105mm', '108mm', '112mm', '120mm', '130mm', 'Other'];
export const transmissions = ['8HP70/75', '8HP90/95', 'TR6060', 'NAG1/WA580', 'Other']; // must match backend TRANS_RATIOS keys

// ── Ford Coyote ───────────────────────────────────────────
export const fordModels        = ['Mustang GT', 'Mustang GT500', 'Mustang Dark Horse', 'F-150 5.0', 'Expedition 5.0', 'Other'];
export const fordEngines       = ['5.0L Gen 1 (2011-2014)', '5.0L Gen 2 (2015-2017)', '5.0L Gen 3 (2018-2023)', '5.0L Gen 4 (2024+)', '5.2L Voodoo (GT350)', '5.2L Predator (GT500)', 'Other'];
export const fordInjectors     = ['Stock', 'ID725x', 'ID850x', 'ID1050x', 'ID1300x', 'ID1700x', 'ID2000cc', 'Other'];
export const fordMapSensors    = ['Stock (Gen4 only)', 'N/A (Gen1-3 MAF-based)', 'Other'];
export const fordThrottles     = ['Stock', '87mm', '90mm', '95mm', '97mm', '102mm', 'Other'];
export const fordTransmissions = ['TR-3160 (6-speed Manual)', 'MT-82 (6-speed Manual)', '6R80 (6-speed Auto)', '10R80 (10-speed Auto)', 'Tremec TR-9070 (7-speed DCT)', 'Other'];
