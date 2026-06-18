import { rankCandidates, findSubstrings, longestAlphaRun } from '../../src/vanity-converter/scorer';

const WORDS = new Set([
  'CALL',
  'ALL',
  'LOVE',
  'LOW',
  'FLOW',
  'FLOWER',
  'FLOWERS',
  'OWE',
  'LOWER',
  'FLY',
  'HOME',
  'HELP',
]);
const BLOCKLIST = new Set(['DAMN', 'HELL', 'SHIT']);

describe('findSubstrings', () => {
  test('finds a 4-letter word in a candidate', () => {
    expect(findSubstrings('CALLXYZ', WORDS)).toEqual(new Set(['CALL', 'ALL']));
  });

  test('finds a 7-letter word when candidate IS the word', () => {
    expect(findSubstrings('FLOWERS', WORDS).has('FLOWERS')).toBe(true);
  });

  test('finds multiple overlapping words', () => {
    const found = findSubstrings('FLOWERS', WORDS);
    expect(found.has('FLOW')).toBe(true);
    expect(found.has('FLOWER')).toBe(true);
    expect(found.has('FLOWERS')).toBe(true);
    expect(found.has('LOW')).toBe(true);
    expect(found.has('LOWER')).toBe(true);
    expect(found.has('OWE')).toBe(true);
  });

  test('returns empty set when no words match', () => {
    expect(findSubstrings('ZZZZZZZ', WORDS).size).toBe(0);
  });

  test('does not match substrings shorter than 3 characters', () => {
    const twoLetterSet = new Set(['AB', 'OW']);
    expect(findSubstrings('FLOWERS', twoLetterSet).size).toBe(0);
  });

  test('correctly checks blocklist words', () => {
    expect(findSubstrings('SOHELLOX', BLOCKLIST).has('HELL')).toBe(true);
  });
});

describe('longestAlphaRun', () => {
  test('all letters returns full length', () => {
    expect(longestAlphaRun('FLOWERS')).toBe(7);
  });

  test('no letters returns 0', () => {
    expect(longestAlphaRun('0000000')).toBe(0);
  });

  test('digit in middle breaks the run', () => {
    expect(longestAlphaRun('ABC0DEF')).toBe(3);
  });

  test('digit at start shortens run', () => {
    expect(longestAlphaRun('0ABCDEF')).toBe(6);
  });

  test('single letter run', () => {
    expect(longestAlphaRun('A000000')).toBe(1);
  });
});

describe('rankCandidates', () => {
  test('returns top N candidates (default 5)', () => {
    const candidates = ['FLOWERS', 'AAAAAAA', 'BBBBBBB', 'CCCCCCC', 'DDDDDDD', 'EEEEEEE'];
    const result = rankCandidates(candidates, WORDS, new Set<string>());
    expect(result).toHaveLength(5);
  });

  test('respects custom limit', () => {
    const candidates = ['FLOWERS', 'CALLXYZ', 'LOVEXYZ', 'HOMEXYZ', 'HELPXYZ', 'LOWXYZZ'];
    const result = rankCandidates(candidates, WORDS, new Set<string>(), 3);
    expect(result).toHaveLength(3);
  });

  test('candidate with a longer word ranks above candidate with only shorter words', () => {
    // FLOWERS: longestWord=7, wordCount=6 → wordScore=76, primary=10076
    // CALLXYZ: longestWord=4, wordCount=2 → wordScore=42, primary=10042
    const result = rankCandidates(['CALLXYZ', 'FLOWERS'], WORDS, new Set<string>());
    expect(result[0]).toBe('FLOWERS');
  });

  test('candidate with no words gets primary score 0', () => {
    const result = rankCandidates(['ZZZZZZZ'], WORDS, new Set<string>());
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('ZZZZZZZ');
  });

  test('digit-free candidate ranks above digit-bearing candidate when neither has words', () => {
    // 'AAAAZAA': no words, no 0/1 digits → primary = 0
    // 'AAAZ0AA': no words, one 0 → primary = -10
    const result = rankCandidates(['AAAZ0AA', 'AAAAZAA'], WORDS, new Set<string>());
    expect(result[0]).toBe('AAAAZAA');
  });

  test('candidates with equal primary score are sorted by longest alpha run', () => {
    // Both have no words and exactly one 0 (primary = -10), so secondary (alpha run) decides.
    // 'AB0CDEF': alpha runs AB(2), CDEF(4) → longest = 4
    // 'ABCDE0F': alpha runs ABCDE(5), F(1) → longest = 5
    const result = rankCandidates(['AB0CDEF', 'ABCDE0F'], WORDS, new Set<string>());
    expect(result[0]).toBe('ABCDE0F');
  });

  test('word-matched candidate ranks above no-word candidate even when it contains a digit', () => {
    // 'CALL0XY': has CALL → primary = 10000 + 40+1 - 10 = 10031
    // 'ZZZZZZZ': no words, no digits → primary = 0
    const result = rankCandidates(['ZZZZZZZ', 'CALL0XY'], WORDS, new Set<string>());
    expect(result[0]).toBe('CALL0XY');
  });

  test('candidate with fewer 0/1 digits ranks above one with more (both no words)', () => {
    // 'ZZZZZZ0': one 0 → primary = -10
    // 'ZZZ01ZZ': one 0 + one 1 → primary = -20
    const result = rankCandidates(['ZZZ01ZZ', 'ZZZZZZ0'], WORDS, new Set<string>());
    expect(result[0]).toBe('ZZZZZZ0');
  });

  test('blocklisted candidate is excluded from results', () => {
    // SOHELLOX contains HELL which is in the blocklist
    const candidates = ['FLOWERS', 'SOHELLOX'];
    const result = rankCandidates(candidates, WORDS, BLOCKLIST);
    expect(result).not.toContain('SOHELLOX');
    expect(result).toContain('FLOWERS');
  });

  test('all candidates blocklisted returns empty array', () => {
    const result = rankCandidates(['XDAMNXX', 'XSHITXX'], WORDS, BLOCKLIST);
    expect(result).toHaveLength(0);
  });

  test('when fewer candidates than limit exist, returns all non-blocklisted', () => {
    const result = rankCandidates(['FLOWERS', 'CALLXYZ'], WORDS, new Set<string>(), 5);
    expect(result).toHaveLength(2);
  });

  test('returns results as strings in an array', () => {
    const result = rankCandidates(['FLOWERS'], WORDS, new Set<string>());
    expect(Array.isArray(result)).toBe(true);
    expect(typeof result[0]).toBe('string');
  });

  test('FLOWERS scores correctly: longest word 7 chars, 6 total words, no digits', () => {
    // FLOWERS: wordScore = 7*10+6 = 76 → primary = 10076
    // CALLXYZ: wordScore = 4*10+2 = 42 → primary = 10042
    const result = rankCandidates(['CALLXYZ', 'FLOWERS'], WORDS, new Set<string>(), 2);
    expect(result[0]).toBe('FLOWERS');
    expect(result[1]).toBe('CALLXYZ');
  });
});
