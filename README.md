# tangent

One random word on a random colour. Branch out from there.

- **random** (`space`) gives a completely new random word. A word standing on its own is swapped in place, so tapping space keeps changing it; once a word has branches, the new word starts a tree of its own.
- **branch** (`enter`) grows a related word beneath the selected word.
- **new tree** (`n`) starts a separate tree and keeps the current word as it is.
- Click any word to select it; branching from a word that already has a child forks the tree.

Trees hang downward: the first word on top, its branches below. A branch between two words always means "these are related". The branches are drawn as shaded ASCII on a grid of small characters: soft vines that glow from a dense heart to a faint edge (`@ % # * + = - : .`), thick where they leave a word and fading to a point at the next one. They throw off curled tendrils and carry small blooms (`. ' * o @`), most of them around the tips of the tree. Three greys give it depth, and the path from the top of the tree to the selected word is drawn strongest. Vines sway, slow swells travel down them, blooms twinkle, and a new vine grows down to its word; with "reduce motion" turned on in the system settings everything holds still.

Other keys: `r` swap the word at the tip of a branch for another relative · `d` define · `z` or `backspace` undo · `c` copy the tree as an indented outline · arrow keys move around the tree.

For vim hands, the same actions also answer to: `h` `j` `k` `l` to move · `o` branch below · `u` undo · `y` copy · `K` define · `gg` top of the tree · `G` down to the end of its first branch.

## Run

No build step and no dependencies. Serve the folder with any static file server:

```bash
npm start
```

Then open http://localhost:4173. (Opening `index.html` straight from disk will not work: browsers refuse to load JavaScript modules from `file://`.)

## Test

```bash
npm test
```

Uses Node's built-in test runner (Node 20+). Covers the tree layout (including that words never overlap), the shaded art, saved-tree validation, and the failure paths of the word services: no connection, timeouts, HTTP errors, malformed responses, words with no relatives.

## Deploy

Live at https://chrcha1.github.io/tangent/ (GitHub Pages).

Deploys come from the pipeline, not from a laptop: every push to `main` runs the tests and, if they pass, publishes `index.html`, `styles.css`, `src/` (see `.github/workflows/deploy.yml`). A failing test stops the deploy. To publish by hand, run the "Test and deploy" workflow from the repository's Actions tab.

The site is static, with nothing to configure and no secrets, so it can move to any other static host by publishing the same files.

## Where words come from

| Source | What | Needs network |
| --- | --- | --- |
| things, ideas, rare | Curated lists in `src/words.js` | No |
| now | Yesterday's most-read English Wikipedia articles (Wikimedia Pageviews API) | Yes |
| related words | Datamuse word associations; for topics, similar Wikipedia articles | Yes |
| define | Datamuse definitions; Wikipedia descriptions for topics | Yes |

Both APIs are free and need no key. The page's Content-Security-Policy only allows connections to those hosts.

## Layout

```
index.html, styles.css
src/
  app.js          page state, drawing loop, keyboard and button wiring
  tree.js         the word tree and validation of saved trees
  layout.js       where each word sits; the outline that "copy" produces
  field.js        the shaded ASCII vines, curls and blooms between words
  wordSource.js   picking random and related words
  words.js        the curated word lists
  color.js        random background + readable ink colour
  hash.js         stable per-word variety for the art
  report.js       the one place errors are reported
  services/       http (timeouts, error types), datamuse, wikipedia
tests/
```

The tree is saved in the browser's `localStorage`; a tree of more than one word is restored on the next visit.

## Not set up yet

- **Crash reporting.** Errors go to the browser console through `src/report.js`. Forward them from there once the site has a Sentry (or similar) project.
