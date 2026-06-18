// End-to-end ranking tests using the real wordlist and blocklist.
// These cross converter → scorer → wordlist and verify output quality on known phone numbers.

import { generateCandidates } from '../../src/vanity-converter/converter';
import { rankCandidates } from '../../src/vanity-converter/scorer';
import { getWordSet, getBlocklistSet } from '../../src/vanity-converter/wordlist';

const wordSet = getWordSet();
const blocklistSet = getBlocklistSet();

describe('ranking quality with real wordlist', () => {
  test('FLOWERS ranks first for subscriber 3569377 (+1-800-356-9377)', () => {
    const candidates = generateCandidates('3569377');
    const result = rankCandidates(candidates, wordSet, blocklistSet, 5);
    expect(result[0]).toBe('FLOWERS');
  });

  test('WELCOME ranks first for subscriber 9352663 (+1-800-935-2663)', () => {
    // W(9)E(3)L(5)C(2)O(6)M(6)E(3) = 9352663
    const candidates = generateCandidates('9352663');
    const result = rankCandidates(candidates, wordSet, blocklistSet, 5);
    expect(result[0]).toBe('WELCOME');
  });

  test('SHOT-bearing candidates rank in top 5 for subscriber 5557468', () => {
    // SHOT = S(7)H(4)O(6)T(8) maps to positions 4-7 of 5557468.
    // SHOT also contains HOT (3-letter), giving it wordScore=42 vs RIOT's 41.
    const candidates = generateCandidates('5557468');
    const result = rankCandidates(candidates, wordSet, blocklistSet, 5);
    for (const v of result) {
      expect(v).toContain('SHOT');
    }
  });

  test('word-matched candidates rank above all no-word candidates', () => {
    // Subscriber 5557468: only SHOT-bearing candidates have word matches.
    // Every result in the top 5 must therefore contain a word.
    const candidates = generateCandidates('5557468');
    const result = rankCandidates(candidates, wordSet, blocklistSet, 5);
    for (const v of result) {
      expect(wordSet.has('SHOT') || wordSet.has('HOT')).toBe(true);
      // The candidate itself must surface a word match
      const words = [...wordSet].filter(
        (w) => w.length >= 3 && v.includes(w),
      );
      expect(words.length).toBeGreaterThan(0);
    }
  });

  test('all top results for subscriber 5701813 contain literal 0 or 1 (no words achievable)', () => {
    // [JKL][PQRS]01[TUV]1[DEF] — every candidate has '0' at pos 3, '1' at pos 4 and pos 6.
    const candidates = generateCandidates('5701813');
    const result = rankCandidates(candidates, wordSet, blocklistSet, 5);
    for (const v of result) {
      expect(v).toMatch(/[01]/);
    }
  });

  test('no word-matched candidates exist for subscriber 5701813', () => {
    // Maximum contiguous letter span is 2 (positions 1-2 or position 5 or 7 alone).
    // Minimum word length is 3, so no dictionary word can fit.
    const candidates = generateCandidates('5701813');
    const withWords = candidates.filter((c) => {
      for (const w of wordSet) {
        if (w.length >= 3 && c.includes(w)) return true;
      }
      return false;
    });
    expect(withWords).toHaveLength(0);
  });

  test('blocklist prevents high-scoring offensive candidates from appearing', () => {
    // Verify the real blocklist is non-empty and correctly wired to rankCandidates.
    expect(blocklistSet.size).toBeGreaterThan(0);
    // Generate candidates for a subscriber whose alphabet includes blocklisted words,
    // then confirm none appear in results.
    const candidates = generateCandidates('3569377'); // includes FLOWERS territory
    const withBlocklist = rankCandidates(candidates, wordSet, blocklistSet, 50);
    for (const v of withBlocklist) {
      for (const bad of blocklistSet) {
        expect(v).not.toContain(bad);
      }
    }
  });

  test('top results for FLOWERS subscriber are all-letter strings (no digit contamination)', () => {
    // Subscriber 3569377 has no 0 or 1 digits — every candidate is pure letters.
    const candidates = generateCandidates('3569377');
    const result = rankCandidates(candidates, wordSet, blocklistSet, 5);
    for (const v of result) {
      expect(v).toMatch(/^[A-Z]{7}$/);
    }
  });
});
