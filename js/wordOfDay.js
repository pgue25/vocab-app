// The one function that decides today's word. Pure and deterministic: the same
// date + word bank always gives the same word, on any device.

export const TIME_ZONE = 'America/New_York';

// NYT crossword-style difficulty: index 0 = Sunday.
export const LEVEL_BY_WEEKDAY = [5, 1, 1, 2, 3, 4, 4];

// How many days per week each level gets, and which of those days (0 or 1)
// a weekday is within its level. Used to walk each level's list without repeats.
const DAYS_PER_WEEK = { 1: 2, 2: 1, 3: 1, 4: 2, 5: 1 };
const SLOT_BY_WEEKDAY = [0, 0, 1, 0, 0, 0, 1];

// Monday 2024-01-01: the week boundary for counting level-days.
const EPOCH_UTC = Date.UTC(2024, 0, 1);

/** "YYYY-MM-DD" for the given instant, in New York time. */
export function nyDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/** Difficulty level (1-5) for a "YYYY-MM-DD" key. */
export function levelForDateKey(key) {
  return LEVEL_BY_WEEKDAY[new Date(key + 'T00:00:00Z').getUTCDay()];
}

// Stable string hash (FNV-1a) so each level's order is fixed but shuffled.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Pick the word of the day.
 * @param {Array} words  the word bank (words.json)
 * @param {Date|string} date  an instant, or a "YYYY-MM-DD" New York date key
 * @returns {{ word: object, level: number, dateKey: string }}
 */
export function pickWordOfDay(words, date = new Date()) {
  const dateKey = typeof date === 'string' ? date : nyDateKey(date);
  const weekday = new Date(dateKey + 'T00:00:00Z').getUTCDay();
  const level = LEVEL_BY_WEEKDAY[weekday];

  const pool = words
    .filter((w) => w.level === level)
    .sort((a, b) => hash(a.word) - hash(b.word) || a.word.localeCompare(b.word));
  if (!pool.length) throw new Error(`No words for level ${level}`);

  // Number of earlier days (since EPOCH) that had this same level.
  const dayNum = Math.round((Date.parse(dateKey + 'T00:00:00Z') - EPOCH_UTC) / 86400000);
  const week = Math.floor(dayNum / 7);
  const levelDay = week * DAYS_PER_WEEK[level] + SLOT_BY_WEEKDAY[weekday];

  return { word: pool[((levelDay % pool.length) + pool.length) % pool.length], level, dateKey };
}
