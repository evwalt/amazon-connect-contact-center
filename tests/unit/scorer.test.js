'use strict';

const { rankCandidates, findSubstrings, longestAlphaRun } = require('../../src/vanity-converter/scorer');

const WORDS = new Set(['CALL', 'ALL', 'LOVE', 'LOW', 'FLOW', 'FLOWER', 'FLOWERS', 'OWE', 'LOWER', 'FLY', 'HOME', 'HELP']);
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
    const result = rankCandidates(candidates, WORDS, new Set());
    expect(result).toHaveLength(5);
  });

  test('respects custom limit', () => {
    const candidates = ['FLOWERS', 'CALLXYZ', 'LOVEXYZ', 'HOMEXYZ', 'HELPXYZ', 'LOWXYZZ'];
    const result = rankCandidates(candidates, WORDS, new Set(), 3);
    expect(result).toHaveLength(3);
  });

  test('candidate with more words ranks above candidate with fewer', () => {
    // FLOWERS contains FLOW, FLOWER, FLOWERS, LOW, LOWER, OWE = 6 words → primary = 67
    // CALLXYZ contains CALL, ALL = 2 words → primary = 24
    const result = rankCandidates(['CALLXYZ', 'FLOWERS'], WORDS, new Set());
    expect(result[0]).toBe('FLOWERS');
  });

  test('candidate with no words gets primary score 0', () => {
    const result = rankCandidates(['ZZZZZZZ'], WORDS, new Set());
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('ZZZZZZZ');
  });

  test('candidates with equal primary score are sorted by longest alpha run', () => {
    // Both have no dictionary words (primary = 0), so secondary (alpha run) decides
    // 'AAAZ0AA' has runs: 3, 2 → longest = 3
    // 'AAAAZAA' has runs: 4, 2 → longest = 4
    const result = rankCandidates(['AAAZ0AA', 'AAAAZAA'], WORDS, new Set());
    expect(result[0]).toBe('AAAAZAA');
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
    const result = rankCandidates(['FLOWERS', 'CALLXYZ'], WORDS, new Set(), 5);
    expect(result).toHaveLength(2);
  });

  test('returns results as strings in an array', () => {
    const result = rankCandidates(['FLOWERS'], WORDS, new Set());
    expect(Array.isArray(result)).toBe(true);
    expect(typeof result[0]).toBe('string');
  });

  test('FLOWERS scores correctly: 6 words found, longest is 7 chars', () => {
    // primary = 6 * 10 + 7 = 67
    // Verify FLOWERS beats a candidate with 1 word of length 4 (primary = 14)
    const result = rankCandidates(['CALLXYZ', 'FLOWERS'], WORDS, new Set(), 2);
    expect(result[0]).toBe('FLOWERS');
    expect(result[1]).toBe('CALLXYZ');
  });
});
