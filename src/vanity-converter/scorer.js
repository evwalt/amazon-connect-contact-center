const MIN_WORD_LEN = 3;
const MAX_WORD_LEN = 7;

/**
 * Returns all substrings of `candidate` (length 3–7) that exist in `lookupSet`.
 * Works for both the word set (scoring) and the blocklist (filtering).
 */
function findSubstrings(candidate, lookupSet) {
  const found = new Set();
  for (let start = 0; start < candidate.length; start++) {
    for (
      let len = MIN_WORD_LEN;
      len <= Math.min(MAX_WORD_LEN, candidate.length - start);
      len++
    ) {
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
function longestAlphaRun(candidate) {
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

/**
 * Scores and ranks vanity candidates.
 *
 * Scoring formula (from DECISIONS.md §1):
 *   primary = (word_count * 10) + longest_word_length
 *   secondary = longest contiguous run of letters (tiebreaker)
 *
 * Candidates that contain any blocklist substring are discarded before scoring.
 *
 * @param {string[]} candidates - All possible alpha representations of the subscriber digits.
 * @param {Set<string>} wordSet - Dictionary word set (uppercase).
 * @param {Set<string>} blocklistSet - Offensive word set (uppercase).
 * @param {number} limit - Number of results to return (default 5).
 * @returns {string[]} Top `limit` candidates ordered best → worst.
 */
function rankCandidates(candidates, wordSet, blocklistSet, limit = 5) {
  const scored = [];

  for (const candidate of candidates) {
    if (findSubstrings(candidate, blocklistSet).size > 0) continue;

    const words = findSubstrings(candidate, wordSet);
    const wordCount = words.size;
    const longestWord =
      wordCount > 0 ? Math.max(...[...words].map((w) => w.length)) : 0;

    scored.push({
      candidate,
      primary: wordCount * 10 + longestWord,
      secondary: longestAlphaRun(candidate),
    });
  }

  scored.sort(
    (a, b) => b.primary - a.primary || b.secondary - a.secondary
  );

  return scored.slice(0, limit).map((s) => s.candidate);
}

module.exports = { rankCandidates, findSubstrings, longestAlphaRun };
