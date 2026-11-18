import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getJson, ServiceError } from '../src/services/http.js';
import { createDatamuse } from '../src/services/datamuse.js';
import { createWikipedia } from '../src/services/wikipedia.js';
import { createWordSource, NoRelativesError, presentable } from '../src/wordSource.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const kindOf = (kind) => (err) => err instanceof ServiceError && err.kind === kind;

// ---------- http ----------

test('getJson returns parsed JSON', async () => {
  assert.deepEqual(await getJson('https://x.test', { fetchImpl: async () => ok([1]) }), [1]);
});

test('getJson reports a dropped connection', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(getJson('https://x.test', { fetchImpl }), kindOf('network'));
});

test('getJson gives up on a server that never answers', async () => {
  const fetchImpl = (_url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(getJson('https://x.test', { fetchImpl, timeoutMs: 10 }), kindOf('timeout'));
});

test('getJson reports HTTP errors with their status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(
    getJson('https://x.test', { fetchImpl }),
    (err) => kindOf('http')(err) && err.status === 503,
  );
});

test('getJson reports a body that is not JSON', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('<html>'); } });
  await assert.rejects(getJson('https://x.test', { fetchImpl }), kindOf('malformed'));
});

// ---------- service wrappers ----------

test('datamuse ignores junk rows and rejects a non-list response', async () => {
  const rows = [{ word: 'milk' }, null, { score: 3 }, { word: 'herd' }];
  assert.deepEqual(await createDatamuse({ getJson: async () => rows }).triggers('cow'), ['milk', 'herd']);
  await assert.rejects(
    createDatamuse({ getJson: async () => ({ error: 'nope' }) }).triggers('cow'),
    kindOf('malformed'),
  );
});

test('datamuse define strips the part-of-speech tag and tolerates no definition', async () => {
  const withDef = createDatamuse({ getJson: async () => [{ word: 'tide', defs: ['n\tthe rise and fall of the sea'] }] });
  assert.equal(await withDef.define('tide'), 'the rise and fall of the sea');
  const without = createDatamuse({ getJson: async () => [{ word: 'tide' }] });
  assert.equal(await without.define('tide'), null);
  const wrongWord = createDatamuse({ getJson: async () => [{ word: 'tidy', defs: ['adj\tneat'] }] });
  assert.equal(await wrongWord.define('tide'), null);
});

test('wikipedia asks for the UTC day and rejects unexpected shapes', async () => {
  let asked;
  const wiki = createWikipedia({
    getJson: async (url) => {
      asked = url;
      return { items: [{ articles: [{ article: 'Blue_whale' }, { views: 4 }] }] };
    },
  });
  assert.deepEqual(await wiki.topArticles(new Date(Date.UTC(2026, 0, 5))), ['Blue whale']);
  assert.ok(asked.endsWith('/2026/01/05'));
  const bad = createWikipedia({ getJson: async () => ({ items: [] }) });
  await assert.rejects(bad.topArticles(new Date()), kindOf('malformed'));
  await assert.rejects(bad.moreLike('Blue whale'), kindOf('malformed'));
});

// ---------- word source ----------

const quiet = {
  datamuse: { triggers: async () => [], meansLike: async () => [], define: async () => null },
  wikipedia: { topArticles: async () => [], moreLike: async () => [], summary: async () => ({}) },
};
const source = (overrides = {}) =>
  createWordSource({
    datamuse: { ...quiet.datamuse, ...overrides.datamuse },
    wikipedia: { ...quiet.wikipedia, ...overrides.wikipedia },
    rng: overrides.rng ?? (() => 0),
    now: () => new Date(Date.UTC(2026, 10, 11, 12)),
  });
const word = (text) => ({ word: text, kind: 'word' });

test('random draws from the chosen list and avoids words already used', async () => {
  const words = source();
  const first = await words.random('ideas');
  const second = await words.random('ideas', new Set([first.word]));
  assert.equal(first.kind, 'word');
  assert.notEqual(second.word, first.word);
  await assert.rejects(words.random('nonsense-source'), /Unknown word source/);
});

test('related skips used words, near-duplicates and non-words', async () => {
  const words = source({
    datamuse: { triggers: async () => ['tides', 'moon', 'high tide', 'x1', 'harbor', 'a', 'b', 'c'] },
  });
  const picked = await words.related(word('tide'), new Set(['moon']));
  assert.deepEqual(picked, word('harbor'));
});

test('related widens the search when associations are thin', async () => {
  const words = source({
    datamuse: { triggers: async () => [], meansLike: async () => ['current'] },
  });
  assert.deepEqual(await words.related(word('tide')), word('current'));
});

test('related says so when a word has no relatives', async () => {
  await assert.rejects(source().related(word('zugzwang')), NoRelativesError);
});

test('related passes service failures through untouched', async () => {
  const words = source({
    datamuse: { triggers: async () => { throw new ServiceError('offline', { kind: 'network' }); } },
  });
  await assert.rejects(words.related(word('tide')), kindOf('network'));
});

test('topics branch to similar articles, falling back to word associations', async () => {
  const topic = { word: 'Wicked', kind: 'topic', title: 'Wicked (2024 film)' };
  let asked;
  const viaWiki = source({
    wikipedia: {
      moreLike: async (title) => {
        asked = title;
        return ['List of musicals', 'Wicked (musical)', 'Oz the Great and Powerful'];
      },
    },
  });
  assert.deepEqual(await viaWiki.related(topic), {
    word: 'Oz the Great and Powerful',
    kind: 'topic',
    title: 'Oz the Great and Powerful',
  });
  assert.equal(asked, 'Wicked (2024 film)');

  const viaWords = source({ datamuse: { meansLike: async () => ['evil'] } });
  assert.deepEqual(await viaWords.related(topic), word('evil'));
});

test('"now" steps back a day when yesterday is not published yet', async () => {
  const asked = [];
  const words = source({
    wikipedia: {
      topArticles: async (date) => {
        asked.push(date.toISOString().slice(0, 10));
        if (asked.length === 1) throw new ServiceError('not yet', { kind: 'http', status: 404 });
        return ['Main Page', 'Special:Search', 'Blue whale'];
      },
    },
  });
  assert.deepEqual(await words.random('now'), { word: 'Blue whale', kind: 'topic', title: 'Blue whale' });
  assert.deepEqual(asked, ['2026-11-10', '2026-11-09']);
});

test('"now" surfaces an outage, retries next time, and "anything" keeps working meanwhile', async () => {
  let calls = 0;
  const words = source({
    wikipedia: {
      topArticles: async () => {
        calls += 1;
        if (calls === 1) throw new ServiceError('offline', { kind: 'network' });
        return ['Blue whale'];
      },
    },
    rng: () => 0.99, // would choose "now" if it were available
  });
  await assert.rejects(words.random('now'), kindOf('network'));
  assert.equal((await words.random('all')).kind, 'word');
  assert.equal((await words.random('now')).word, 'Blue whale');
  assert.equal((await words.random('all')).kind, 'topic');
});

test('"now" reports when every recent day is empty', async () => {
  await assert.rejects(source().random('now'), kindOf('empty'));
});

test('gloss describes topics and words, and treats a missing page as "nothing known"', async () => {
  const topic = { word: 'Blue whale', kind: 'topic', title: 'Blue whale' };
  const described = source({ wikipedia: { summary: async () => ({ description: 'Species of baleen whale' }) } });
  assert.equal(await described.gloss(topic), 'Species of baleen whale');
  const extractOnly = source({ wikipedia: { summary: async () => ({ extract: 'It is big. Very big.' }) } });
  assert.equal(await extractOnly.gloss(topic), 'It is big.');
  const missing = source({
    wikipedia: { summary: async () => { throw new ServiceError('gone', { kind: 'http', status: 404 }); } },
  });
  assert.equal(await missing.gloss(topic), null);
  const defined = source({ datamuse: { define: async () => 'the rise and fall of the sea' } });
  assert.equal(await defined.gloss(word('tide')), 'the rise and fall of the sea');
});

test('site plumbing and junk never count as topics', () => {
  for (const title of ['Main Page', 'Special:Search', 'List of sovereign states', 'Deaths in 2026', '.xxx', '2026', 'XXX (film series)']) {
    assert.equal(presentable(title), false, title);
  }
  for (const title of ['Blue whale', 'Wicked (2024 film)', 'Sussex']) {
    assert.equal(presentable(title), true, title);
  }
});
