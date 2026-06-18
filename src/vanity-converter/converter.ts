const KEYPAD: Record<string, string[]> = {
  '0': ['0'],
  '1': ['1'],
  '2': ['A', 'B', 'C'],
  '3': ['D', 'E', 'F'],
  '4': ['G', 'H', 'I'],
  '5': ['J', 'K', 'L'],
  '6': ['M', 'N', 'O'],
  '7': ['P', 'Q', 'R', 'S'],
  '8': ['T', 'U', 'V'],
  '9': ['W', 'X', 'Y', 'Z'],
};

/**
 * Strips non-digits and returns the last 7 digits (the subscriber number).
 * E.g. "+12065551234" → "5551234", "206-555-1234" → "5551234"
 */
function extractSubscriberDigits(phoneNumber: string | number): string {
  const digits = String(phoneNumber).replace(/\D/g, '');
  if (digits.length < 7) {
    return digits.padStart(7, '0');
  }
  return digits.slice(-7);
}

/**
 * Given a 7-character string of subscriber digits, returns every possible
 * alpha representation. Digits 0 and 1 have no letter mapping and appear
 * as themselves in all candidates.
 *
 * Result size: product of letter-option counts per digit.
 * Worst case (all 7s or 9s): 4^7 = 16,384. Typical: ~2,000–5,000.
 */
function generateCandidates(subscriberDigits: string): string[] {
  const letterOptions = subscriberDigits.split('').map((d) => KEYPAD[d] ?? [d]);

  let candidates: string[] = [''];
  for (const options of letterOptions) {
    const next: string[] = [];
    for (const prefix of candidates) {
      for (const letter of options) {
        next.push(prefix + letter);
      }
    }
    candidates = next;
  }
  return candidates;
}

export { extractSubscriberDigits, generateCandidates, KEYPAD };
