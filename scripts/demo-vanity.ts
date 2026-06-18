// Development-only diagnostic script — not part of the test suite or Lambda bundle.
// Run with: npm run demo:vanity

import { extractSubscriberDigits, generateCandidates } from '../src/vanity-converter/converter';
import { rankCandidates, findSubstrings } from '../src/vanity-converter/scorer';
import { getWordSet, getBlocklistSet } from '../src/vanity-converter/wordlist';

const DEMO_NUMBERS: Array<{ input: string; label: string }> = [
  { input: '+18003569377', label: '800-FLOWERS — classic full-word vanity' },
  { input: '+18009352663', label: '800-WELCOME — strong 7-letter word' },
  { input: '+12125557468', label: 'partial word case (SHOT spans positions 4-7)' },
  { input: '+17575701813', label: 'worst case — 0 and 1 embedded, no words possible' },
];

function extractAreaCode(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1, 4);
  return digits.length > 7 ? digits.slice(0, digits.length - 7) : '';
}

const wordSet = getWordSet();
const blocklistSet = getBlocklistSet();

console.log('\n=== Vanity Number Demo ===');
console.log(`Wordlist: ${wordSet.size} words  |  Blocklist: ${blocklistSet.size} entries\n`);

for (const { input, label } of DEMO_NUMBERS) {
  const areaCode = extractAreaCode(input);
  const subscriber = extractSubscriberDigits(input);
  const candidates = generateCandidates(subscriber);
  const withWords = candidates.filter((c) => findSubstrings(c, wordSet).size > 0).length;
  const top5 = rankCandidates(candidates, wordSet, blocklistSet, 5);

  console.log(`Input: ${input}`);
  console.log(`  ${label}`);
  console.log(
    `  subscriber: ${subscriber}  |  ${candidates.length} candidates  |  ${withWords} with word matches`,
  );
  for (let i = 0; i < top5.length; i++) {
    const display = areaCode ? `${areaCode}-${top5[i]}` : top5[i];
    console.log(`  ${i + 1}. ${display}`);
  }
  console.log('');
}
