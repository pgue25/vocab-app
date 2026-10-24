import { pickWordOfDay, pickDailySet, nyDateKey } from './wordOfDay.js';
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

// ---------- Pronunciation (built-in text-to-speech, works offline) ----------
const canSpeak = 'speechSynthesis' in window;
// Line icons (inline SVG, inherit text color).
const ICONS = {
  speaker: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  cards: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>',
  quiz: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
};
const icon = (name, size = 20) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// Shrink long words so they never break mid-word next to the speaker button.
const wordH1 = (word, extra = '') =>
  `<h1 class="word ${word.length > 12 ? 'xlong' : word.length > 9 ? 'long' : ''} ${extra}">${esc(word)}</h1>`;
const speakBtn = (word) => canSpeak
  ? `<button class="speak" data-say="${esc(word)}" aria-label="Hear ${esc(word)} pronounced">${icon('speaker')}</button>` : '';

function speak(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.lang === 'en-US' && v.localService) || voices.find((v) => v.lang.startsWith('en')) || null;
  u.lang = 'en-US';
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

view.addEventListener('click', (e) => {
  const btn = e.target.closest('.speak');
  if (btn) speak(btn.dataset.say);
});

function wordCard(w) {
  return `
    <div class="card">
      <div class="word-row">${wordH1(w.word)}${speakBtn(w.word)}</div>
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
    <p class="streak">${icon('flame', 16)} ${current}-day streak · ${plural(Object.keys(state.learned).length, 'word')} studied</p>
    <a class="btn full" href="#learn">Study today's 25 words</a>`;
}

// ---------- Single word (from Learn or Quiz stats) ----------
function renderWord(name) {
  const w = byWord.get(name);
  if (!w) return (location.hash = '#learn');
  view.innerHTML = `
    <div class="top"><a class="eyebrow" href="javascript:history.back()">‹ Back</a><span class="pill">Level ${w.level}</span></div>
    ${wordCard(w)}`;
}

// ---------- Keyboard shortcuts (laptop) ----------
// Each screen calls setKeys({ up, down, left, right, enter, space }) with what those
// keys should do there; route() clears them, so keys never act on a stale screen.
let keys = {};
const setKeys = (k) => { keys = k; };
const KEY_NAMES = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'enter', ' ': 'space' };

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const name = KEY_NAMES[e.key];
  if (!name || !keys[name]) return;
  e.preventDefault(); // no page scroll, and no native "click" on a focused button
  if (e.repeat && (name === 'enter' || name === 'space')) return; // holding Enter can't submit twice
  keys[name]();
});

// Moves the keyboard highlight to buttons[i]; scrolls only when a key moved it.
function highlight(buttons, i, scroll = false) {
  buttons.forEach((b, j) => b.classList.toggle('kb', j === i));
  if (scroll) buttons[i]?.scrollIntoView({ block: 'nearest' });
}

// ---------- Shared question UI (used by Quiz tab and Learn quiz) ----------
// Each word has 3 sets of (1 correct + 3 wrong); rotate by attempts so repeats differ.
function questionFor(w) {
  const set = (state.quiz[w.word]?.attempts || 0) % w.quizCorrect.length;
  const correct = w.quizCorrect[set];
  return { correct, options: shuffle([correct, ...w.quizWrong.slice(set * 3, set * 3 + 3)]) };
}

function questionHTML(w, options, eyebrow) {
  return `
    <div class="top">
      <p class="eyebrow">${eyebrow}</p>
      <span class="pill">Level ${w.level}</span>
    </div>
    <div class="card"><div class="word-row">${wordH1(w.word)}${speakBtn(w.word)}</div>
      <div class="meta"><i>${esc(w.partOfSpeech)}</i></div></div>
    <p class="muted" style="margin:0 0 4px;font-size:14px">Which sentence uses it correctly?</p>
    <div class="options">
      ${options.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join('')}
    </div>
    <p class="kbd-hint">↑ ↓ to choose · Enter to submit</p>
    <div id="feedback"></div>`;
}

// Wires up answer buttons; calls onAnswered(ok) and shows the correct sentence + definition.
function bindQuestion(w, { correct, options }, nextLabel, onNext, onAnswered) {
  const opts = [...view.querySelectorAll('.opt')];
  let sel = 0;
  let answered = false;
  highlight(opts, sel);
  setKeys({
    up: () => highlight(opts, (sel = (sel + opts.length - 1) % opts.length), true),
    down: () => highlight(opts, (sel = (sel + 1) % opts.length), true),
    enter: () => opts[sel].click(),
  });
  opts.forEach((btn) => btn.addEventListener('click', () => {
    if (answered) return; // a second click/Enter can't record a second answer
    answered = true;
    highlight(opts, -1);
    const ok = options[+btn.dataset.i] === correct;
    store.recordAnswer(state, w.word, ok);
    store.markViewed(state, w, nyDateKey());
    onAnswered?.(ok);
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
      <button class="primary full" id="next">${nextLabel}</button>`;
    const next = document.getElementById('next');
    let advanced = false;
    const go = () => { if (!advanced) { advanced = true; onNext(); } };
    next.addEventListener('click', go);
    next.classList.add('kb');
    setKeys({ enter: go });
    next.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }));
}

// ---------- Learn: today's 25 words ----------
// Session progress is saved so closing the app mid-way doesn't lose your place.
function learnSession() {
  const { dateKey, words: set } = pickDailySet(words);
  if (state.learn?.date !== dateKey) {
    const names = set.map((w) => w.word);
    state.learn = {
      date: dateKey,
      cards: { queue: shuffle(names), known: [], later: [], round: 1 },
      quiz: { order: shuffle(names), i: 0, correct: 0, missed: [] },
    };
    store.save(state);
  }
  return { dateKey, set, s: state.learn };
}

function renderLearn() {
  const { dateKey, set, s } = learnSession();
  const weekday = WEEKDAYS[new Date(dateKey + 'T00:00:00Z').getUTCDay()];
  const total = set.length;
  const quizDone = s.quiz.i >= s.quiz.order.length;
  view.innerHTML = `
    <p class="eyebrow">${weekday} · Today's ${total} words</p>
    <div class="modes">
      <a class="mode" href="#learn/cards">
        <span class="mode-ic">${icon('cards', 26)}</span><b>Flashcards</b>
        <span class="muted">${s.cards.known.length ? `${s.cards.known.length}/${total} known` : 'Flip through definitions'}</span>
      </a>
      <a class="mode" href="#learn/quiz">
        <span class="mode-ic">${icon('quiz', 26)}</span><b>Quiz</b>
        <span class="muted">${quizDone ? `Done · ${s.quiz.correct}/${s.quiz.order.length}` : s.quiz.i ? `${s.quiz.i}/${s.quiz.order.length} answered` : 'Pick the right sentence'}</span>
      </a>
    </div>
    ${[1, 2, 3, 4, 5].map((l) => {
      const lw = set.filter((w) => w.level === l);
      return lw.length ? `<div class="card">
        <h2>Level ${l}</h2>
        <div class="wordlist">${lw.map((w) => `<button data-w="${esc(w.word)}">${esc(w.word)}</button>`).join('')}</div>
      </div>` : '';
    }).join('')}
    <p class="muted" style="font-size:13px;text-align:center">A new set every day at midnight (New York time).</p>`;
  bindWordlist();
}

function renderCards() {
  const { set, s } = learnSession();
  const c = s.cards;
  c.later ||= [];
  c.round ||= 1;
  // Finished this pass: start another pass with only the "still learning" cards.
  if (!c.queue.length && c.later.length) {
    c.queue = shuffle(c.later);
    c.later = [];
    c.round += 1;
    store.save(state);
  }
  if (!c.queue.length) {
    view.innerHTML = `
      <div class="top"><a class="eyebrow" href="#learn">‹ Learn</a></div>
      <div class="card center">
        <p class="done-ic">${icon('check', 44)}</p>
        <h2>All ${set.length} cards known</h2>
        <p class="muted">Ready to use them in context?</p>
        <a class="btn full" href="#learn/quiz">Take the quiz</a>
        <button class="btn secondary full" id="again">Go through the cards again</button>
      </div>`;
    document.getElementById('again').addEventListener('click', () => {
      state.learn.cards = { queue: shuffle(set.map((w) => w.word)), known: [], later: [], round: 1 };
      store.save(state);
      renderCards();
    });
    const primary = view.querySelector('a.btn');
    primary.classList.add('kb');
    setKeys({ enter: () => primary.click() });
    return;
  }
  const w = byWord.get(c.queue[0]);
  view.innerHTML = `
    <div class="top"><a class="eyebrow" href="#learn">‹ Learn</a>
      <span class="muted" style="font-size:14px">${c.round > 1 ? `Review round ${c.round} · ` : ''}${c.known.length}/${set.length} known · ${c.queue.length} left</span></div>
    <div class="progress"><div style="width:${(100 * c.known.length) / set.length}%"></div></div>
    <div class="card flash" id="flash" role="button" aria-label="Flip card">
      <div class="top"><span class="pill">Level ${w.level}</span>${speakBtn(w.word)}</div>
      ${wordH1(w.word, 'center-text')}
      <div class="meta center-text"><i>${esc(w.partOfSpeech)}</i>${w.pronunciation ? ` · ${esc(w.pronunciation)}` : ''}</div>
      <div class="back" hidden>
        <p class="def">${esc(w.definition)}</p>
        <p class="example">${esc(w.examples[0])}</p>
      </div>
      <p class="muted hint center-text">Tap to reveal</p>
    </div>
    <div class="row" id="grade" hidden>
      <button class="btn secondary" id="learning">Still learning</button>
      <button class="btn" id="know">Know it</button>
    </div>
    <p class="kbd-hint">Enter to flip · ← → to choose · Enter to confirm</p>`;
  const gradeBtns = [document.getElementById('learning'), document.getElementById('know')];
  let flipped = false;
  let graded = false;
  let sel = 0; // 0 = Still learning, 1 = Know it
  const flip = () => {
    if (flipped) return;
    flipped = true;
    view.querySelector('.back').hidden = false;
    view.querySelector('.hint').hidden = true;
    document.getElementById('grade').hidden = false;
    store.markViewed(state, w, nyDateKey());
    highlight(gradeBtns, sel);
    setKeys({
      left: () => highlight(gradeBtns, (sel = 0), true),
      right: () => highlight(gradeBtns, (sel = 1), true),
      enter: () => grade(sel === 1),
    });
  };
  setKeys({ enter: flip, space: flip });
  document.getElementById('flash').addEventListener('click', (e) => { if (!e.target.closest('.speak')) flip(); });
  const grade = (known) => {
    if (graded) return; // each card is graded once
    graded = true;
    c.queue.shift();
    if (known) c.known.push(w.word);
    else c.later.push(w.word); // comes back after every other card in this pass
    store.save(state);
    renderCards();
  };
  document.getElementById('know').addEventListener('click', () => grade(true));
  document.getElementById('learning').addEventListener('click', () => grade(false));
}

function renderLearnQuiz() {
  const { set, s } = learnSession();
  const q = s.quiz;
  if (q.i >= q.order.length) {
    const missed = [...new Set(q.missed)];
    view.innerHTML = `
      <div class="top"><a class="eyebrow" href="#learn">‹ Learn</a></div>
      <div class="card center">
        <p class="eyebrow">Score</p>
        <p class="score">${q.correct}<span>/${q.order.length}</span></p>
        ${missed.length ? `<p class="muted">Missed: tap to review</p>
          <div class="wordlist" style="justify-content:center">${missed.map((m) => `<button class="miss" data-w="${esc(m)}">${esc(m)}</button>`).join('')}</div>
          <button class="btn full" id="retry">Retry the ${plural(missed.length, 'missed word')}</button>` : '<p>Perfect round.</p>'}
        <button class="btn secondary full" id="restart">Start over with all ${set.length}</button>
      </div>`;
    bindWordlist();
    document.getElementById('retry')?.addEventListener('click', () => {
      state.learn.quiz = { order: shuffle(missed), i: 0, correct: 0, missed: [] };
      store.save(state);
      renderLearnQuiz();
    });
    document.getElementById('restart').addEventListener('click', () => {
      state.learn.quiz = { order: shuffle(set.map((w) => w.word)), i: 0, correct: 0, missed: [] };
      store.save(state);
      renderLearnQuiz();
    });
    const primary = document.getElementById('retry') || document.getElementById('restart');
    primary.classList.add('kb');
    setKeys({ enter: () => primary.click() });
    return;
  }
  const w = byWord.get(q.order[q.i]);
  const question = questionFor(w);
  view.innerHTML = `
    <div class="top" style="margin-bottom:8px"><a class="eyebrow" href="#learn">‹ Learn</a>
      <span class="muted" style="font-size:14px">${q.i + 1} of ${q.order.length} · ${q.correct} correct</span></div>
    <div class="progress"><div style="width:${(100 * q.i) / q.order.length}%"></div></div>
    ${questionHTML(w, question.options, "Today's words")}`;
  bindQuestion(w, question, q.i + 1 < q.order.length ? 'Next question' : 'See score', renderLearnQuiz, (ok) => {
    q.i += 1;
    if (ok) q.correct += 1; else q.missed.push(w.word);
    store.save(state);
  });
}

function bindWordlist() {
  view.querySelectorAll('.wordlist button').forEach((b) =>
    b.addEventListener('click', () => (location.hash = '#word/' + encodeURIComponent(b.dataset.w))));
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
      <p class="eyebrow">Review quiz</p>
      <div class="card"><p>This quiz mixes every word you've studied, with missed words coming up more often. Study today's words first.</p>
      <a class="btn full" href="#learn">Go to Learn</a></div>
      ${statsHTML()}`;
    bindWordlist();
    return;
  }
  const w = pickQuizWord();
  lastQuizWord = w.word;
  const question = questionFor(w);
  view.innerHTML = questionHTML(w, question.options, 'Review · all words you’ve studied') + statsHTML();
  bindWordlist();
  bindQuestion(w, question, 'Next question', () => { renderQuiz(); window.scrollTo(0, 0); });
}

// ---------- Stats ----------
function statsHTML() {
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

  return `
    <p class="eyebrow" style="margin-top:32px">Your progress</p>
    <div class="grid">
      <div class="stat"><b>${current}</b><span>Current streak</span></div>
      <div class="stat"><b>${best}</b><span>Best streak</span></div>
      <div class="stat"><b>${learned.length}</b><span>Words studied</span></div>
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
      <h2>Words you've studied</h2>
      <p class="muted" style="margin:0 0 10px;font-size:14px">${practice.length ? 'Red outline = needs practice. ' : ''}Tap a word to review it.</p>
      <div class="wordlist">${learned.sort().map((w) =>
        `<button class="${practice.includes(w) ? 'miss' : ''}" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>
    </div>` : ''}`;
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
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  setKeys({});
  document.activeElement?.blur?.();
  window.scrollTo(0, 0);
  const learn = { cards: renderCards, quiz: renderLearnQuiz }[arg] || renderLearn;
  ({ today: renderToday, learn, quiz: renderQuiz, settings: renderSettings,
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
    if (document.visibilityState === 'visible' && ['', '#today', '#learn'].includes(location.hash)) route();
  });
  route();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
init();
