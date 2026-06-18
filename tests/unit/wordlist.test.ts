import { getWordSet, getBlocklistSet } from '../../src/vanity-converter/wordlist';

describe('getWordSet', () => {
  let wordSet!: Set<string>;
  beforeAll(() => { wordSet = getWordSet(); });

  test('returns a Set', () => {
    expect(wordSet).toBeInstanceOf(Set);
  });

  test('is non-empty', () => {
    expect(wordSet.size).toBeGreaterThan(0);
  });

  test('all words are uppercase', () => {
    for (const word of wordSet) {
      expect(word).toBe(word.toUpperCase());
    }
  });

  test('all words are between 3 and 7 characters', () => {
    for (const word of wordSet) {
      expect(word.length).toBeGreaterThanOrEqual(3);
      expect(word.length).toBeLessThanOrEqual(7);
    }
  });

  test('all words contain only letters A–Z (no digits or special chars)', () => {
    for (const word of wordSet) {
      expect(word).toMatch(/^[A-Z]+$/);
    }
  });

  test('contains commonly expected vanity-friendly words', () => {
    expect(wordSet.has('CALL')).toBe(true);
    expect(wordSet.has('HOME')).toBe(true);
    expect(wordSet.has('HELP')).toBe(true);
    expect(wordSet.has('LOVE')).toBe(true);
    expect(wordSet.has('FLOWERS')).toBe(true);
  });

  test('returns the same Set instance on repeated calls (singleton)', () => {
    expect(getWordSet()).toBe(wordSet);
  });
});

describe('getBlocklistSet', () => {
  let blocklistSet!: Set<string>;
  beforeAll(() => { blocklistSet = getBlocklistSet(); });

  test('returns a Set', () => {
    expect(blocklistSet).toBeInstanceOf(Set);
  });

  test('is non-empty', () => {
    expect(blocklistSet.size).toBeGreaterThan(0);
  });

  test('all blocklist entries are uppercase', () => {
    for (const word of blocklistSet) {
      expect(word).toBe(word.toUpperCase());
    }
  });

  test('all blocklist entries contain only letters A–Z', () => {
    for (const word of blocklistSet) {
      expect(word).toMatch(/^[A-Z]+$/);
    }
  });

  test('returns the same Set instance on repeated calls (singleton)', () => {
    expect(getBlocklistSet()).toBe(blocklistSet);
  });

  test('no word appears in both word set and blocklist', () => {
    const wordSet = getWordSet();
    for (const entry of blocklistSet) {
      expect(wordSet.has(entry)).toBe(false);
    }
  });
});
