import {
  extractSubscriberDigits,
  generateCandidates,
  KEYPAD,
} from '../../src/vanity-converter/converter';

describe('extractSubscriberDigits', () => {
  test('extracts last 7 digits from E.164 format', () => {
    expect(extractSubscriberDigits('+12065551234')).toBe('5551234');
  });

  test('extracts last 7 digits from 10-digit format', () => {
    expect(extractSubscriberDigits('2065551234')).toBe('5551234');
  });

  test('returns 7 digits unchanged when already 7 digits', () => {
    expect(extractSubscriberDigits('5551234')).toBe('5551234');
  });

  test('strips dashes from formatted number', () => {
    expect(extractSubscriberDigits('206-555-1234')).toBe('5551234');
  });

  test('strips parentheses and spaces', () => {
    expect(extractSubscriberDigits('(206) 555-1234')).toBe('5551234');
  });

  test('pads with leading zeros when fewer than 7 digits provided', () => {
    const result = extractSubscriberDigits('123');
    expect(result).toHaveLength(7);
    expect(result).toBe('0000123');
  });

  test('handles numeric input (not a string)', () => {
    expect(extractSubscriberDigits(2065551234)).toBe('5551234');
  });
});

describe('generateCandidates', () => {
  test('all-zero input produces exactly one candidate equal to itself', () => {
    const result = generateCandidates('0000000');
    expect(result).toEqual(['0000000']);
  });

  test('all-one input produces exactly one candidate equal to itself', () => {
    const result = generateCandidates('1111111');
    expect(result).toEqual(['1111111']);
  });

  test('single non-zero/one digit in position 0 produces 3 candidates', () => {
    const result = generateCandidates('2000000');
    expect(result).toHaveLength(3);
    expect(result).toContain('A000000');
    expect(result).toContain('B000000');
    expect(result).toContain('C000000');
  });

  test('each candidate has the same length as the input', () => {
    const result = generateCandidates('5551234');
    for (const c of result) {
      expect(c).toHaveLength(7);
    }
  });

  test('all-twos produces 3^7 = 2187 candidates', () => {
    expect(generateCandidates('2222222')).toHaveLength(2187);
  });

  test('digit 7 maps to 4 letters (P Q R S)', () => {
    const result = generateCandidates('7000000');
    expect(result).toHaveLength(4);
    expect(result).toContain('P000000');
    expect(result).toContain('Q000000');
    expect(result).toContain('R000000');
    expect(result).toContain('S000000');
  });

  test('3569377 includes FLOWERS as a candidate', () => {
    const result = generateCandidates('3569377');
    expect(result).toContain('FLOWERS');
  });

  test('0 and 1 positions remain as literal digits in all candidates', () => {
    const result = generateCandidates('2010000');
    for (const c of result) {
      expect(c[1]).toBe('0');
      expect(c[2]).toBe('1');
    }
  });

  test('produces no duplicate candidates', () => {
    const result = generateCandidates('3569377');
    expect(new Set(result).size).toBe(result.length);
  });

  test('all candidates contain only uppercase letters and digits 0/1', () => {
    const result = generateCandidates('5601234');
    for (const c of result) {
      expect(c).toMatch(/^[A-Z01]+$/);
    }
  });

  test('keypad mapping has entries for digits 0–9', () => {
    for (let d = 0; d <= 9; d++) {
      expect(KEYPAD[String(d)]).toBeDefined();
      expect(Array.isArray(KEYPAD[String(d)])).toBe(true);
    }
  });

  test('throws when input contains a non-digit character', () => {
    expect(() => generateCandidates('A000000')).toThrow(
      "generateCandidates: unexpected character 'A'",
    );
  });
});
