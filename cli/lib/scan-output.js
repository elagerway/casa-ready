// Shared scan-output layout contract. The scan command writes per-target results
// to <runDir>/<target>/<RESULTS_FILENAME>; the triage command reads from the same path.
// Keep this the single source of truth so the two commands cannot drift.
export const RESULTS_FILENAME = 'results.json';
