import words from './data/words.json';
import blocklist from './data/blocklist.json';

let wordSet: Set<string> | null = null;
let blocklistSet: Set<string> | null = null;

function getWordSet(): Set<string> {
  if (!wordSet) wordSet = new Set<string>(words as string[]);
  return wordSet!;
}

function getBlocklistSet(): Set<string> {
  if (!blocklistSet) blocklistSet = new Set<string>(blocklist as string[]);
  return blocklistSet!;
}

export { getWordSet, getBlocklistSet };
