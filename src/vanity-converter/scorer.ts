const MIN_WORD_LEN = 3;
const MAX_WORD_LEN = 7;

// Deducted per literal 0 or 1 in the candidate (digits map to no letters and break readability).
const DIGIT_PENALTY = 10;

/**
 * Returns all substrings of `candidate` (length 3–7) that exist in `lookupSet`.
 * Works for both the word set (scoring) and the blocklist (filtering).
 */
function findSubstrings(candidate: string, lookupSet: Set<string>): Set<string> {
  const found = new Set<string>();
  for (let start = 0; start < candidate.length; start++) {
    for (let len = MIN_WORD_LEN; len <= Math.min(MAX_WORD_LEN, candidate.length - start); len++) {
      const sub = candidate.slice(start, start + len);
      if (lookupSet.has(sub)) found.add(sub);
    }
  }
  return found;
}

/**
 * Returns the length of the longest contiguous run of letters (A–Z) in the
 * candidate. Used as a secondary sort key when primary scores are equal —
 * naturally handles numbers with no dictionary words.
 */
function longestAlphaRun(candidate: string): number {
  let max = 0;
  let current = 0;
  for (const ch of candidate) {
    if (ch >= 'A' && ch <= 'Z') {
      current += 1;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  }
  return max;
}

function countZeroOne(candidate: string): number {
  let n = 0;
  for (const ch of candidate) {
    if (ch === '0' || ch === '1') n++;
  }
  return n;
}

interface ScoredCandidate {
  candidate: string;
  primary: number;
  secondary: number;
}

/**
 * Scores and ranks vanity candidates.
 *
 * Scoring (three-level, descending priority):
 *   1. Word tier: candidates with ≥1 dictionary word match get a +10000 offset,
 *      keeping them strictly above all no-word candidates.
 *   2. Word quality within tier: longestWord * 10 + wordCount (longer single word wins).
 *      DIGIT_PENALTY is deducted per 0 or 1 in the candidate.
 *   3. Tiebreaker: longest contiguous alpha run (fewer digit gaps reads better aloud).
 *
 * Candidates containing any blocklist substring are discarded before scoring.
 *
 * @param candidates - All possible alpha representations of the subscriber digits.
 * @param wordSet - Dictionary word set (uppercase).
 * @param blocklistSet - Offensive word set (uppercase).
 * @param limit - Number of results to return (default 5).
 * @returns Top `limit` candidates ordered best → worst.
 */
function rankCandidates(
  candidates: string[],
  wordSet: Set<string>,
  blocklistSet: Set<string>,
  limit = 5,
): string[] {
  const scored: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    if (findSubstrings(candidate, blocklistSet).size > 0) continue;

    const words = findSubstrings(candidate, wordSet);
    const wordCount = words.size;
    const longestWord = wordCount > 0 ? Math.max(...[...words].map((w) => w.length)) : 0;
    // Scoring tiers (descending):
    //   1. Has word matches (10000 offset keeps these strictly above no-word candidates)
    //   2. Within each tier: longer words beat shorter; digit penalty demotes 0/1-bearing candidates
    //   3. Tiebreaker: longest contiguous alpha run (fewer gaps reads better aloud)
    const wordScore = longestWord * 10 + wordCount;
    scored.push({
      candidate,
      primary: (wordCount > 0 ? 10000 : 0) + wordScore - countZeroOne(candidate) * DIGIT_PENALTY,
      secondary: longestAlphaRun(candidate),
    });
  }

  scored.sort((a, b) => b.primary - a.primary || b.secondary - a.secondary);

  return scored.slice(0, limit).map((s) => s.candidate);
}

export { rankCandidates, findSubstrings, longestAlphaRun };
