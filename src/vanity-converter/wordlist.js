const words = require('./data/words.json');
const blocklist = require('./data/blocklist.json');

let wordSet = null;
let blocklistSet = null;

function getWordSet() {
  if (!wordSet) wordSet = new Set(words);
  return wordSet;
}

function getBlocklistSet() {
  if (!blocklistSet) blocklistSet = new Set(blocklist);
  return blocklistSet;
}

module.exports = { getWordSet, getBlocklistSet };
