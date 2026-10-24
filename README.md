# Vocab

A personal word-of-the-day PWA. Plain HTML/CSS/JS, no build step, hosted on GitHub Pages.
Progress lives in `localStorage` on your device; export it from Settings to back it up.

## Difficulty schedule (NYT crossword style)

Mon + Tue = Level 1 · Wed = Level 2 · Thu = Level 3 · Fri + Sat = Level 4 · Sun = Level 5

`js/wordOfDay.js` is the single source of truth for today's word (America/New_York date).
Each level's words are walked in a fixed shuffled order, so a word won't repeat until its level runs out.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The app |
| `sw.js` | Offline cache. **Bump `VERSION` when you change app files.** |
| `words.json` | Shipped word bank (generated) |
| `words.review.json` | Same bank, pretty-printed, for review before shipping |
| `build/candidates.txt` | Candidate words, one per line |
| `build/sentences/*.json` | LLM-written examples + quiz sentences per word |
| `build/overrides.json` | Picks which dictionary sense / pronunciation to use per word |
| `build/defs_cache.json` | Cached dictionary lookups |

## Adding words

1. Add words to `build/candidates.txt`.
2. `python3 build/build_words.py --per-level 40` (or omit `--per-level` to use every candidate).
   This fetches definitions (Merriam-Webster if `MW_API_KEY` is set, else dictionaryapi.dev, else Wiktionary)
   and lists words still missing sentences.
3. Ask Claude to write sentences for the missing words into a new `build/sentences/*.json`
   (2 `examples`, 3 `quizCorrect`, 9 `quizWrong` each), and to check senses in `overrides.json`.
4. Review `words.review.json`, then `python3 build/build_words.py --promote`.
5. Bump `VERSION` in `sw.js`, commit and push. GitHub Pages redeploys in about a minute.

Note: adding words changes each level's rotation, so the upcoming schedule reshuffles.

## Local preview

```
python3 -m http.server 8765
```
