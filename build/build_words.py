#!/usr/bin/env python3
"""One-time word bank builder.

Steps:
  1. Read candidates.txt, score each word with wordfreq Zipf frequency,
     drop words that are too common or too rare to be useful.
  2. Rank by Zipf (most common first) and split into 5 equal levels.
  3. Fetch part of speech, pronunciation and definition from Merriam-Webster
     (if MW_API_KEY is set) or dictionaryapi.dev. Cached in defs_cache.json.
  4. Merge LLM-written sentences from sentences/*.json.
  5. Write ../words.review.json for review. Run with --promote to copy it to
     ../words.json (the file the app ships).

Usage:
  python3 build_words.py                 # build words.review.json
  python3 build_words.py --per-level 20  # cap words per level
  python3 build_words.py --promote       # validate review file and ship it
"""
import argparse
import html
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from wordfreq import zipf_frequency

HERE = Path(__file__).parent
ROOT = HERE.parent
CACHE = HERE / "defs_cache.json"
SENTENCES_DIR = HERE / "sentences"  # one or more JSON files: {word: {examples, quizCorrect, quizWrong}}
OVERRIDES = HERE / "overrides.json"
REVIEW = ROOT / "words.review.json"
SHIP = ROOT / "words.json"

ZIPF_MIN = 1.0  # rarer than this = obscure trivia, skip
ZIPF_MAX = 4.6  # more common than this = everyone already knows it
LEVELS = 5
COUNTS = {"examples": 2, "quizCorrect": 3, "quizWrong": 9}


def load_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


# Every source returns the same shape:
#   {"source", "pronunciation", "senses": [{"partOfSpeech", "definitions": [...]}]}
# overrides.json can pick {"sense": i, "defIndex": j} when the first sense isn't
# the one used in quality writing (e.g. "volatile" -> markets, not chemistry).

UA = {"User-Agent": "vocab-app-builder/1.0 (personal vocabulary app)"}


def get(url, **kw):
    for attempt in range(4):
        r = requests.get(url, headers=UA, timeout=10, **kw)
        if r.status_code != 429:
            return r
        time.sleep(2 ** attempt * 2)
    return r


def fetch_mw(word, key):
    data = get(f"https://www.dictionaryapi.com/api/v3/references/collegiate/json/{word}", params={"key": key}).json()
    entries = [e for e in data if isinstance(e, dict) and e.get("meta", {}).get("id", "").split(":")[0] == word]
    entries = [e for e in entries if e.get("shortdef")]
    if not entries:
        return None
    prs = entries[0].get("hwi", {}).get("prs", [])
    return {
        "source": "merriam-webster",
        "pronunciation": f"\\{prs[0]['mw']}\\" if prs else "",
        "senses": [{"partOfSpeech": e.get("fl", ""), "definitions": e["shortdef"]} for e in entries],
    }


def fetch_free(word):
    r = get(f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}")
    if r.status_code == 404:
        return None
    r.raise_for_status()
    entry = r.json()[0]
    pron = entry.get("phonetic") or next((p["text"] for p in entry.get("phonetics", []) if p.get("text")), "")
    return {
        "source": "dictionaryapi.dev",
        "pronunciation": pron,
        "senses": [{"partOfSpeech": m["partOfSpeech"], "definitions": [d["definition"] for d in m["definitions"]]}
                   for m in entry["meanings"]],
    }


def _clean(h):
    h = re.sub(r"<style.*?</style>", "", h, flags=re.S)
    h = re.sub(r"<[^>]+>", "", h)
    h = re.sub(r"\.mw-parser-output[^}]*\}", "", html.unescape(h))
    return re.sub(r"\s+", " ", h).strip()


def fetch_wiktionary(word):
    r = get(f"https://en.wiktionary.org/api/rest_v1/page/definition/{word}")
    if r.status_code == 404:
        return None
    r.raise_for_status()
    senses = []
    for sec in r.json().get("en", []):
        defs = [_clean(d["definition"]) for d in sec["definitions"]]
        defs = [d for d in defs if d and not re.match(r"\((obsolete|archaic|rare|dated)", d, re.I)]
        if defs:
            senses.append({"partOfSpeech": sec["partOfSpeech"].lower(), "definitions": defs})
    if not senses:
        return None
    wt = get("https://en.wiktionary.org/w/api.php",
             params={"action": "parse", "page": word, "prop": "wikitext", "format": "json"}).json()
    text = wt.get("parse", {}).get("wikitext", {}).get("*", "")
    english = re.split(r"\n==[^=]", text.split("==English==", 1)[-1], maxsplit=1)[0]
    lines = [l for l in english.splitlines() if "{{IPA|en|" in l]
    us = [l for l in lines if re.search(r"\b(US|GA|GenAm|General American)\b", l)]
    ipa = re.findall(r"\{\{IPA\|en\|([^}|]+)", (us or lines or [""])[0])
    return {"source": "wiktionary", "pronunciation": ipa[0] if ipa else "", "senses": senses}


def fetch_definitions(words):
    cache = load_json(CACHE, {})
    key = os.environ.get("MW_API_KEY")
    for w in words:
        if cache.get(w) and (not key or cache[w]["source"] == "merriam-webster"):
            continue
        # Try each source in order; one that errors (vs. "not found") is skipped.
        sources = ([("mw", lambda x: fetch_mw(x, key))] if key else []) + \
                  [("dictionaryapi.dev", fetch_free), ("wiktionary", fetch_wiktionary)]
        result, errored = None, False
        for name, src in sources:
            try:
                result = src(w)
            except Exception as exc:
                errored = True
                print(f"  ! {w} via {name}: {str(exc)[:80]}", file=sys.stderr)
            if result:
                break
        if not result and errored:
            continue  # transient failure: don't cache, retry next run
        cache[w] = result
        print(f"  fetched {w}: {result['source'] if result else 'NOT FOUND'}")
        CACHE.write_text(json.dumps(cache, indent=2, ensure_ascii=False))
        time.sleep(1.5)
    return cache


def select_words(per_level):
    raw = [l.strip().lower() for l in (HERE / "candidates.txt").read_text().splitlines()]
    words = sorted({w for w in raw if w and not w.startswith("#") and w.isalpha()})
    scored = [(w, zipf_frequency(w, "en")) for w in words]
    kept = [(w, z) for w, z in scored if ZIPF_MIN <= z <= ZIPF_MAX]
    for w, z in scored:
        if (w, z) not in kept:
            print(f"  skip {w} (zipf {z})")
    kept.sort(key=lambda x: -x[1])
    size = -(-len(kept) // LEVELS)
    levels = {}
    for i, (w, z) in enumerate(kept):
        levels.setdefault(min(i // size + 1, LEVELS), []).append((w, z))
    if per_level:
        for lvl, items in levels.items():
            step = len(items) / per_level
            levels[lvl] = [items[int(i * step)] for i in range(min(per_level, len(items)))]
    return [(w, z, lvl) for lvl, items in sorted(levels.items()) for w, z in items]


def build(per_level):
    selected = select_words(per_level)
    defs = fetch_definitions([w for w, _, _ in selected])
    sentences = {}
    for f in sorted(SENTENCES_DIR.glob("*.json")):
        sentences.update(json.loads(f.read_text()))
    overrides = load_json(OVERRIDES, {})
    out, missing = [], []
    for w, z, lvl in selected:
        d = defs.get(w)
        if not d:
            print(f"  drop {w}: no dictionary entry")
            continue
        ov = overrides.get(w, {})
        sense = d["senses"][ov.get("sense", 0)]
        s = sentences.get(w, {})
        if not s:
            missing.append(w)
        out.append({
            "word": w,
            "partOfSpeech": ov.get("partOfSpeech", sense["partOfSpeech"]),
            "pronunciation": ov.get("pronunciation", d["pronunciation"]),
            "level": lvl,
            "zipf": z,
            "definition": sense["definitions"][ov.get("defIndex", 0)],
            "examples": s.get("examples", []),
            "quizCorrect": s.get("quizCorrect", []),
            "quizWrong": s.get("quizWrong", []),
        })
    REVIEW.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"\nWrote {REVIEW.name}: {len(out)} words " +
          ", ".join(f"L{l}={sum(1 for x in out if x['level']==l)}" for l in range(1, LEVELS + 1)))
    if missing:
        print(f"Missing sentences for {len(missing)} words: {', '.join(missing)}")


def validate(words):
    """Return a list of problems; empty means the bank is safe to ship."""
    problems = []
    text_fields = ("word", "partOfSpeech", "definition")
    seen_words, seen_sentences = set(), {}
    for i, w in enumerate(words):
        name = w.get("word") or f"entry #{i}"
        for f in text_fields:
            if not isinstance(w.get(f), str) or not w[f].strip():
                problems.append(f"{name}: missing {f}")
        if not isinstance(w.get("pronunciation"), str):
            problems.append(f"{name}: pronunciation must be a string")
        if w.get("level") not in range(1, LEVELS + 1):
            problems.append(f"{name}: level must be 1-{LEVELS}, got {w.get('level')!r}")
        if name in seen_words:
            problems.append(f"{name}: duplicate word")
        seen_words.add(name)
        for k, n in COUNTS.items():
            items = w.get(k)
            if not isinstance(items, list) or len(items) != n:
                problems.append(f"{name}: needs {n} {k}, has {len(items) if isinstance(items, list) else 0}")
                continue
            for sentence in items:
                if not isinstance(sentence, str) or not sentence.strip():
                    problems.append(f"{name}: blank sentence in {k}")
                elif sentence in seen_sentences:
                    problems.append(f"{name}: sentence also used by {seen_sentences[sentence]}: {sentence[:50]}")
                else:
                    seen_sentences[sentence] = f"{name}.{k}"
    for lvl in range(1, LEVELS + 1):
        if not any(w.get("level") == lvl for w in words):
            problems.append(f"level {lvl} has no words (the app needs every level)")
    return problems


def promote():
    words = json.loads(REVIEW.read_text())
    problems = validate(words)
    if problems:
        sys.exit("Refusing to promote:\n  " + "\n  ".join(problems))
    for w in words:
        w.pop("zipf", None)
    SHIP.write_text(json.dumps(words, ensure_ascii=False, separators=(",", ":")))
    print(f"Shipped {len(words)} words to {SHIP.name}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-level", type=int, default=0)
    ap.add_argument("--promote", action="store_true")
    args = ap.parse_args()
    promote() if args.promote else build(args.per_level)
