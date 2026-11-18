// Where words come from: fresh random ones, and ones related to a word already
// on the tree. Local lists answer instantly; "now" and relations use the network.

import { THINGS, IDEAS, RARE } from './words.js';
import { ServiceError } from './services/http.js';

export const SOURCES = ['all', 'things', 'ideas', 'rare', 'now'];

const LISTS = { things: THINGS, ideas: IDEAS, rare: RARE };
const WEIGHTS = { things: 40, ideas: 25, rare: 15, now: 20 };
const RELATED_POOL = 30; // pick among the strongest N associations
const THIN_POOL = 5; // below this, widen the search
const MAX_TOPICS = 200;
const MAX_TOPIC_LENGTH = 40;

export class NoRelativesError extends Error {
  constructor(word) {
    super(`No related words found for "${word}"`);
    this.name = 'NoRelativesError';
    this.word = word;
  }
}

const NOT_A_TOPIC = /^(main page|search|wikipedia|list of|lists of|deaths in|index of|portal|cookie)/i;
const UNWELCOME = /porn|xxx|xnxx|xvideos|hentai|onlyfans|\bsex/i;

// Article titles worth showing: real subjects, not site plumbing.
export function presentable(title) {
  return (
    !title.includes(':') &&
    !title.startsWith('.') &&
    /[a-z]/i.test(title) &&
    !NOT_A_TOPIC.test(title) &&
    !UNWELCOME.test(title) &&
    displayName(title).length <= MAX_TOPIC_LENGTH
  );
}

// "Wicked (2024 film)" reads better on the tree as "Wicked".
function displayName(title) {
  return title.replace(/\s*\([^)]*\)$/, '') || title;
}

const topicEntry = (title) => ({ word: displayName(title), kind: 'topic', title });
const wordEntry = (word) => ({ word, kind: 'word' });
const isPlainWord = (word) => /^[a-z]{3,}$/.test(word);

function pick(list, rng) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function pickWeighted(weights, rng) {
  const entries = Object.entries(weights);
  let roll = rng() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll < 0) return name;
  }
  return entries[entries.length - 1][0];
}

function uniqueByWord(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = entry.word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createWordSource({ datamuse, wikipedia, rng = Math.random, now = () => new Date() }) {
  let trending = null;
  let trendingLoad = null;

  // Yesterday's list is published a few hours after UTC midnight, so step back
  // a day at a time until one exists.
  async function fetchTrending() {
    const today = now();
    let notPublished = null;
    for (const daysAgo of [1, 2, 3]) {
      const date = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo),
      );
      try {
        const titles = await wikipedia.topArticles(date);
        const entries = uniqueByWord(titles.filter(presentable).map(topicEntry)).slice(0, MAX_TOPICS);
        if (entries.length) return entries;
      } catch (err) {
        if (!(err instanceof ServiceError) || err.status !== 404) throw err;
        notPublished = err;
      }
    }
    throw new ServiceError('No trending topics available', { kind: 'empty', cause: notPublished });
  }

  function loadTrending() {
    trendingLoad ??= fetchTrending().then(
      (entries) => (trending = entries),
      (err) => {
        trendingLoad = null; // let the next request try again
        throw err;
      },
    );
    return trendingLoad;
  }

  function freshFrom(entries, exclude) {
    const unused = entries.filter((entry) => !exclude.has(entry.word.toLowerCase()));
    return pick(unused.length ? unused : entries, rng);
  }

  async function random(source = 'all', exclude = new Set()) {
    let kind = source;
    if (source === 'all') {
      // Trending topics join the mix once they have loaded; never wait on them.
      const { now: _now, ...local } = WEIGHTS;
      kind = pickWeighted(trending ? WEIGHTS : local, rng);
    }
    if (kind === 'now') return freshFrom(await loadTrending(), exclude);
    const list = LISTS[kind];
    if (!list) throw new Error(`Unknown word source "${source}"`);
    return freshFrom(list.map(wordEntry), exclude);
  }

  async function related(node, exclude = new Set()) {
    const base = node.word.toLowerCase();
    const isFresh = (entry) => {
      const word = entry.word.toLowerCase();
      return !exclude.has(word) && !word.startsWith(base) && !base.startsWith(word);
    };

    let candidates = [];
    if (node.kind === 'topic') {
      const titles = await wikipedia.moreLike(node.title ?? node.word);
      candidates = titles.filter(presentable).map(topicEntry).filter(isFresh);
    }
    if (!candidates.length) {
      const toEntries = (words) => words.filter(isPlainWord).map(wordEntry).filter(isFresh);
      candidates = toEntries(await datamuse.triggers(node.word));
      if (candidates.length < THIN_POOL) {
        candidates = candidates.concat(toEntries(await datamuse.meansLike(node.word)));
      }
    }

    candidates = uniqueByWord(candidates);
    if (!candidates.length) throw new NoRelativesError(node.word);
    return pick(candidates.slice(0, RELATED_POOL), rng);
  }

  // One line on what a word or topic is, or null when nothing is known.
  async function gloss(node) {
    if (node.kind === 'topic') {
      try {
        const { description, extract } = await wikipedia.summary(node.title ?? node.word);
        return description || extract?.split(/(?<=\.)\s/)[0] || null;
      } catch (err) {
        if (err instanceof ServiceError && err.status === 404) return null;
        throw err;
      }
    }
    return datamuse.define(node.word);
  }

  return { random, related, gloss, preload: loadTrending };
}
