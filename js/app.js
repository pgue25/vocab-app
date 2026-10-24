import { pickWordOfDay, nyDateKey } from './wordOfDay.js';
import * as store from './store.js';

const view = document.getElementById('view');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let words = [];
let byWord = new Map();
let state = store.load();
let lastQuizWord = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function applyTheme() {
  if (state.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.theme;
}

function wordCard(w) {
  return `
    <div class="card">
      <h1 class="word">${esc(w.word)}</h1>
      <div class="meta"><i>${esc(w.partOfSpeech)}</i>${w.pronunciation ? ` · ${esc(w.pronunciation)}` : ''}</div>
    </div>
    <div class="card">
      <p class="eyebrow">Definition</p>
      <p class="def">${esc(w.definition)}</p>
    </div>
    <div class="card">
      <p class="eyebrow">In a sentence</p>
      <ul class="examples">${w.examples.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    </div>`;
}

// ---------- Today ----------
function renderToday() {
  const { word, level, dateKey } = pickWordOfDay(words);
  store.markViewed(state, word, dateKey);
  const { current } = store.streaks(state, dateKey);
  const weekday = WEEKDAYS[new Date(dateKey + 'T00:00:00Z').getUTCDay()];
  view.innerHTML = `
    <div class="top">
      <p class="eyebrow">${weekday} · Word of the Day</p>
      <span class="pill">Level ${level}</span>
    </div>
    ${wordCard(word)}
    <p class="streak">🔥 ${current}-day streak · ${plural(Object.keys(state.learned).length, 'word')} learned</p>
    <a class="btn full" href="#quiz">Test your knowledge</a>`;
}

// ---------- Single word (from Stats) ----------
function renderWord(name) {
  const w = byWord.get(name);
  if (!w || !state.learned[name]) return (location.hash = '#stats');
  view.innerHTML = `
    <div class="top"><a class="eyebrow" href="#stats">‹ Stats</a><span class="pill">Level ${w.level}</span></div>
    ${wordCard(w)}`;
}

// ---------- Quiz ----------
// Words you've missed carry extra weight (misses goes up 2 per miss, down 1 per hit).
function pickQuizWord() {
  let pool = Object.keys(state.learned).filter((w) => byWord.has(w));
  if (pool.length > 1) pool = pool.filter((w) => w !== lastQuizWord);
  const weights = pool.map((w) => 1 + 3 * (state.quiz[w]?.misses || 0));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    if ((r -= weights[i]) < 0) return byWord.get(pool[i]);
  }
  return byWord.get(pool[pool.length - 1]);
}

function renderQuiz() {
  if (!Object.keys(state.learned).some((w) => byWord.has(w))) {
    view.innerHTML = `
      <p class="eyebrow">Test your knowledge</p>
      <div class="card"><p>Quizzes use words you've learned. View today's word first.</p>
      <a class="btn full" href="#today">See today's word</a></div>`;
    return;
  }
  const w = pickQuizWord();
  lastQuizWord = w.word;
  // Each word has 3 sets of (1 correct + 3 wrong); rotate so repeats differ.
  const set = (state.quiz[w.word]?.attempts || 0) % w.quizCorrect.length;
  const correct = w.quizCorrect[set];
  const options = shuffle([correct, ...w.quizWrong.slice(set * 3, set * 3 + 3)]);

  view.innerHTML = `
    <div class="top">
      <p class="eyebrow">Which sentence uses it correctly?</p>
      <span class="pill">Level ${w.level}</span>
    </div>
    <div class="card"><h1 class="word">${esc(w.word)}</h1>
      <div class="meta"><i>${esc(w.partOfSpeech)}</i></div></div>
    <div class="options">
      ${options.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join('')}
    </div>
    <div id="feedback"></div>`;

  view.querySelectorAll('.opt').forEach((btn) => btn.addEventListener('click', () => {
    const chosen = options[+btn.dataset.i];
    const ok = chosen === correct;
    store.recordAnswer(state, w.word, ok);
    view.querySelectorAll('.opt').forEach((b) => {
      b.disabled = true;
      if (options[+b.dataset.i] === correct) b.classList.add('correct');
    });
    if (!ok) btn.classList.add('wrong');
    document.getElementById('feedback').innerHTML = `
      <div class="card feedback">
        <p class="verdict ${ok ? 'ok' : 'no'}">${ok ? 'Correct' : 'Not quite'}</p>
        <p class="def" style="font-size:17px">“${esc(correct)}”</p>
        <p class="eyebrow" style="margin-top:14px">Definition</p>
        <p style="margin:0">${esc(w.definition)}</p>
      </div>
      <button class="primary full" id="next">Next question</button>`;
    document.getElementById('next').addEventListener('click', renderQuiz);
    document.getElementById('next').scrollIntoView({ behavior: 'smooth', block: 'end' });
  }));
}

// ---------- Stats ----------
function renderStats() {
  const today = nyDateKey();
  const { current, best } = store.streaks(state, today);
  const learned = Object.keys(state.learned).filter((w) => byWord.has(w));
  let attempts = 0, correct = 0;
  const lvl = {};
  for (let l = 1; l <= 5; l++) lvl[l] = { attempts: 0, correct: 0, learned: 0 };
  for (const w of learned) lvl[byWord.get(w).level].learned++;
  for (const [w, q] of Object.entries(state.quiz)) {
    const word = byWord.get(w);
    if (!word) continue;
    attempts += q.attempts; correct += q.correct;
    lvl[word.level].attempts += q.attempts; lvl[word.level].correct += q.correct;
  }
  const pct = (c, a) => (a ? Math.round((100 * c) / a) : 0);
  const practice = learned.filter((w) => state.quiz[w]?.misses > 0);

  view.innerHTML = `
    <p class="eyebrow">Your progress</p>
    <div class="grid">
      <div class="stat"><b>${current}</b><span>Current streak</span></div>
      <div class="stat"><b>${best}</b><span>Best streak</span></div>
      <div class="stat"><b>${learned.length}</b><span>Words learned</span></div>
      <div class="stat"><b>${attempts ? pct(correct, attempts) + '%' : '–'}</b><span>Quiz accuracy · ${plural(attempts, 'answer')}</span></div>
    </div>
    <div class="card">
      <h2>Accuracy by level</h2>
      <p class="muted" style="margin:0;font-size:13px">Percent correct (answers given)</p>
      ${[1, 2, 3, 4, 5].map((l) => `
        <div class="bar-row"><span>Level ${l}</span>
          <div class="bar"><div style="width:${pct(lvl[l].correct, lvl[l].attempts)}%"></div></div>
          <span class="n">${lvl[l].attempts ? `${pct(lvl[l].correct, lvl[l].attempts)}% (${lvl[l].attempts})` : '–'}</span>
        </div>`).join('')}
    </div>
    ${learned.length ? `<div class="card">
      <h2>Learned words</h2>
      <p class="muted" style="margin:0 0 10px;font-size:14px">${practice.length ? 'Red outline = needs practice. ' : ''}Tap a word to review it.</p>
      <div class="wordlist">${learned.sort().map((w) =>
        `<button class="${practice.includes(w) ? 'miss' : ''}" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>
    </div>` : ''}`;
  view.querySelectorAll('.wordlist button').forEach((b) =>
    b.addEventListener('click', () => (location.hash = '#word/' + encodeURIComponent(b.dataset.w))));
}

// ---------- Settings ----------
function renderSettings() {
  view.innerHTML = `
    <p class="eyebrow">Settings</p>
    <div class="card">
      <h2>Appearance</h2>
      <div class="seg">${['auto', 'light', 'dark'].map((t) =>
        `<button data-t="${t}" class="${state.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    </div>
    <div class="card stack">
      <h2>Backup</h2>
      <p class="muted" style="margin:0;font-size:14px">Progress is stored only on this device. Export a file to back it up or move it to another device.</p>
      <button class="primary" id="export">Export progress</button>
      <label class="btn secondary">Import progress<input type="file" id="import" accept="application/json,.json" hidden></label>
      <p id="msg" class="muted" style="margin:0;font-size:14px"></p>
    </div>
    <p class="muted" style="font-size:13px;text-align:center">${words.length} words in the bank · Mon–Tue L1 · Wed L2 · Thu L3 · Fri–Sat L4 · Sun L5</p>`;

  view.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    state.theme = b.dataset.t;
    store.save(state);
    applyTheme();
    renderSettings();
  }));
  document.getElementById('export').addEventListener('click', () => store.exportFile(state));
  document.getElementById('import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const msg = document.getElementById('msg');
    try {
      state = await store.importFile(file);
      applyTheme();
      msg.textContent = `Imported ${Object.keys(state.learned).length} learned words.`;
    } catch (err) {
      msg.textContent = err.message;
    }
  });
}

// ---------- Router ----------
function route() {
  const [tab, arg] = (location.hash.slice(1) || 'today').split('/');
  document.querySelectorAll('.tabs a').forEach((a) =>
    a.classList.toggle('on', a.dataset.tab === (tab === 'word' ? 'stats' : tab)));
  window.scrollTo(0, 0);
  ({ today: renderToday, quiz: renderQuiz, stats: renderStats, settings: renderSettings,
     word: () => renderWord(decodeURIComponent(arg || '')) }[tab] || renderToday)();
}

async function init() {
  applyTheme();
  try {
    words = await (await fetch('words.json')).json();
  } catch {
    view.innerHTML = `<div class="card">Couldn't load the word list. Open the app once while online.</div>`;
    return;
  }
  byWord = new Map(words.map((w) => [w.word, w]));
  window.addEventListener('hashchange', route);
  // Re-render Today if the app is reopened after midnight.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (location.hash || '#today') === '#today') route();
  });
  route();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
init();
