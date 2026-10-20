// The text the heredoc body scans may read past one pass of each body: one budget per request, sized to its input.

/** Text the scans may read, per character of the input they serve, and on
 *  top of that. Past it every body still to scan is unresolved. */
const SCAN_CHARS_PER_CHAR = 32;
const SCAN_CHARS_FLOOR = 65_536;

let remaining = 0;
let scopes = 0;

function budgetFor(chars: number): number {
  return SCAN_CHARS_PER_CHAR * chars + SCAN_CHARS_FLOOR;
}

/** Runs `run` under one budget for every body it scans, sized to the
 *  `inputChars` of the request it serves. */
export function withScanBudget<T>(inputChars: number, run: () => T): T {
  const saved = remaining;
  remaining = budgetFor(inputChars);
  scopes += 1;
  try {
    return run();
  } finally {
    scopes -= 1;
    remaining = saved;
  }
}

/** Starts the budget for a body that no other body holds, sized to the
 *  body, unless a request's budget covers it. */
export function startScanBudget(bodyChars: number): void {
  if (scopes === 0) remaining = budgetFor(bodyChars);
}

/** Charges `chars` of reading; false once the budget is spent. */
export function chargeScan(chars: number): boolean {
  remaining -= chars;
  return remaining >= 0;
}
