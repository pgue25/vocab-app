// Progress lives in localStorage under one key. Shape:
// {
//   version: 1,
//   learned: { [word]: { date: "YYYY-MM-DD", level } },
//   days: ["YYYY-MM-DD", ...],              // days the word of the day was viewed
//   quiz: { [word]: { attempts, correct, misses } },  // misses = "needs practice" weight
//   theme: "auto" | "light" | "dark"
// }

const KEY = 'vocab-progress-v1';

const empty = () => ({ version: 1, learned: {}, days: [], quiz: {}, theme: 'auto' });

export function load() {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return empty();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save progress', e);
  }
}

export function markViewed(state, wordObj, dateKey) {
  if (!state.learned[wordObj.word]) state.learned[wordObj.word] = { date: dateKey, level: wordObj.level };
  if (!state.days.includes(dateKey)) state.days.push(dateKey);
  save(state);
}

export function recordAnswer(state, word, isCorrect) {
  const q = (state.quiz[word] ||= { attempts: 0, correct: 0, misses: 0 });
  q.attempts += 1;
  if (isCorrect) {
    q.correct += 1;
    q.misses = Math.max(0, q.misses - 1);
  } else {
    q.misses += 2;
  }
  save(state);
}

const prevDay = (key) => {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Current streak (ending today or yesterday) and best streak, in days. */
export function streaks(state, todayKey) {
  const days = new Set(state.days);
  let current = 0;
  let cursor = days.has(todayKey) ? todayKey : prevDay(todayKey);
  while (days.has(cursor)) { current++; cursor = prevDay(cursor); }

  let best = 0, run = 0, last = null;
  for (const d of [...days].sort()) {
    run = last && prevDay(d) === last ? run + 1 : 1;
    best = Math.max(best, run);
    last = d;
  }
  return { current, best };
}

export function exportFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vocab-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importFile(file) {
  const data = JSON.parse(await file.text());
  if (data.version !== 1 || typeof data.learned !== 'object' || !Array.isArray(data.days)) {
    throw new Error('That file is not a Vocab backup.');
  }
  const state = { ...empty(), ...data };
  save(state);
  return state;
}
