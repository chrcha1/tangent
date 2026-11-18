// Wikipedia / Wikimedia public APIs: what people are reading right now, pages
// similar to a page, and one-line descriptions. No key required.

import { ServiceError } from './http.js';

const PAGEVIEWS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access';
const ACTION = 'https://en.wikipedia.org/w/api.php';
const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary';

const malformed = (what) =>
  new ServiceError(`Wikipedia returned an unexpected ${what}`, { kind: 'malformed' });

export function createWikipedia({ getJson }) {
  return {
    // Most-viewed article titles for a UTC calendar day, most viewed first.
    async topArticles(date) {
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      const data = await getJson(`${PAGEVIEWS}/${yyyy}/${mm}/${dd}`);
      const articles = data?.items?.[0]?.articles;
      if (!Array.isArray(articles)) throw malformed('pageview list');
      return articles
        .map((entry) => entry?.article)
        .filter((title) => typeof title === 'string')
        .map((title) => title.replaceAll('_', ' '));
    },

    // Titles of articles that read like the given one.
    async moreLike(title) {
      const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: `morelike:${title}`,
        srnamespace: '0',
        srlimit: '30',
        srprop: '',
        format: 'json',
        origin: '*',
      });
      const data = await getJson(`${ACTION}?${params}`);
      const hits = data?.query?.search;
      if (!Array.isArray(hits)) throw malformed('search result');
      return hits.map((hit) => hit?.title).filter((t) => typeof t === 'string');
    },

    // Short description and opening extract for an article.
    async summary(title) {
      const data = await getJson(`${SUMMARY}/${encodeURIComponent(title.replaceAll(' ', '_'))}`);
      if (!data || typeof data !== 'object') throw malformed('summary');
      return {
        description: typeof data.description === 'string' ? data.description : null,
        extract: typeof data.extract === 'string' ? data.extract : null,
      };
    },
  };
}
