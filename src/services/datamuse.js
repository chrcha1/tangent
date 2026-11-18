// Datamuse (api.datamuse.com): free word associations, no key required.

import { ServiceError } from './http.js';

const BASE = 'https://api.datamuse.com/words';

export function createDatamuse({ getJson }) {
  async function query(params) {
    const data = await getJson(`${BASE}?${new URLSearchParams(params)}`);
    if (!Array.isArray(data)) {
      throw new ServiceError('Datamuse returned an unexpected shape', { kind: 'malformed' });
    }
    return data.filter((hit) => hit && typeof hit.word === 'string');
  }

  return {
    // Words that tend to appear alongside this one ("cow" -> "milk").
    async triggers(word) {
      return (await query({ rel_trg: word, max: 60 })).map((hit) => hit.word);
    },

    // Words with a similar meaning; also accepts short phrases.
    async meansLike(term) {
      return (await query({ ml: term, max: 40 })).map((hit) => hit.word);
    },

    // First dictionary definition, or null when the word has none.
    async define(word) {
      const [hit] = await query({ sp: word, md: 'd', max: 1 });
      const first = hit?.word?.toLowerCase() === word.toLowerCase() ? hit.defs?.[0] : null;
      if (typeof first !== 'string') return null;
      return first.includes('\t') ? first.slice(first.indexOf('\t') + 1).trim() : first.trim();
    },
  };
}
