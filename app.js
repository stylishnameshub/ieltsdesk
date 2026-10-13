import { ruleParse, normalizeTest, parseKey, TYPE_LABELS, letterOptions, allQuestions } from './parser.js';
import { buildReport, formatDuration } from './grade.js';
import { SAMPLE_TEST } from './sample.js';

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const clock = s => `${String(Math.floor(Math.abs(s) / 60)).padStart(2, '0')}:${String(Math.abs(s) % 60).padStart(2, '0')}`;
const store = {
  get(k, d) { try { const v = localStorage.getItem('ieltsdesk.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ieltsdesk.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('ieltsdesk.' + k); } catch { /* ignore */ } },
};

const ICON = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
};

// ---------- theme + reading size ----------
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
function applyTheme() {
  const t = store.get('theme', null);
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const icon = isDark() ? ICON.sun : ICON.moon;
  $$('#themeBtn, [data-theme-btn]').forEach(b => { b.innerHTML = icon; });
}
function toggleTheme() { store.set('theme', isDark() ? 'light' : 'dark'); applyTheme(); }
function applyFont() { document.documentElement.style.setProperty('--read-size', store.get('font', 17) + 'px'); }
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
$('#themeBtn').addEventListener('click', toggleTheme);
$('#homeLink')?.addEventListener('click', e => { e.preventDefault(); renderHome(); });
applyTheme(); applyFont();

// ---------- AI availability (only on the deployed site with a key) ----------
let AI_AVAILABLE = false;
fetch('api/parse', { method: 'GET' })
  .then(r => (r.ok ? r.json() : null))
  .then(d => { AI_AVAILABLE = !!(d && d.ai); const b = $('#aiBtn'); if (b) b.hidden = !AI_AVAILABLE; })
  .catch(() => {});

// ---------- toast + modal ----------
let toastTimer;
function toast(msg) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.role = 'status'; el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 3800);
}
function modal({ title, body, actions }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2 style="font-size:19px">${esc(title)}</h2><p class="muted" style="margin:0">${body}</p><div class="row end">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : 'ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  bg.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) { bg.remove(); actions[+b.dataset.i].fn?.(); } else if (e.target === bg) bg.remove();
  });
  document.body.appendChild(bg);
  bg.querySelector('.btn.primary')?.focus();
}

// ---------- state ----------
let draft = store.get('draft', { src: '', key: '' });
let pending = null; // parsed test waiting on the check screen
let S = null; // running exam session
let lastResult = null;

const defaultMinutes = t => Math.min(60, Math.max(10, t.passages.length * 20));

// =====================================================================
// HOME
// =====================================================================
function renderHome() {
  document.body.classList.remove('in-exam');
  const hist = store.get('history', []);
  const sess = store.get('session', null);
  app.innerHTML = `<div class="wrap">
    ${sess && !sess.submitted ? `<div class="resume"><div><strong>You have a test in progress.</strong> <span class="muted">${esc(sess.test.title)} · ${clock(sess.left)} left</span></div><div class="row"><button class="btn small ghost" data-act="discard">Discard</button><button class="btn small primary" data-act="resume">Resume test</button></div></div>` : ''}
    <section class="hero">
      <span class="eyebrow">IELTS Academic · Reading</span>
      <h1>Paste any reading test. Sit it like the real exam.</h1>
      <p>Passage and questions side by side, a 60-minute timer, an estimated band score, and a mentor's notes on what to fix next.</p>
    </section>
    <div class="home-grid">
      <section class="card raised">
        <h2>Your test</h2>
        <p class="muted" style="margin:0">Copy the full test from a practice site or PDF and paste it below.</p>
        <div class="field">
          <label for="src">Passage(s) and questions</label>
          <textarea id="src" spellcheck="false" placeholder="READING PASSAGE 1&#10;Title of the passage&#10;A  First paragraph…&#10;&#10;Questions 1–5&#10;…">${esc(draft.src)}</textarea>
          <span class="hint">Works best when the text keeps headings like “Reading Passage 1” and “Questions 1–13”. An answer key at the end is picked up automatically.</span>
        </div>
        <div class="field">
          <label for="key">Answer key <span class="muted" style="font-weight:400">(optional, needed for the band score)</span></label>
          <textarea id="key" spellcheck="false" placeholder="1 TRUE&#10;2 NOT GIVEN&#10;3 iv&#10;4 food production">${esc(draft.key)}</textarea>
        </div>
        <div class="row actions">
          <button class="btn primary" data-act="parse">Build my test</button>
          <button class="btn" id="aiBtn" data-act="ai" ${AI_AVAILABLE ? '' : 'hidden'}>Build with AI</button>
          <button class="btn ghost" data-act="sample">Load sample test</button>
          <button class="btn ghost" data-act="clear">Clear</button>
        </div>
      </section>
      <aside class="side">
        <section class="card">
          <h2>How it works</h2>
          <ol class="steps">
            <li>Paste the test and its answer key.</li>
            <li>Check that the passages and question types were read correctly.</li>
            <li>Take the test with the timer running. Highlight, flag and jump between questions.</li>
            <li>Submit to see your band, your mistakes and a 7-day plan.</li>
          </ol>
        </section>
        <section class="card">
          <h2>Recent attempts</h2>
          ${hist.length ? `<ul class="history">${hist.slice(0, 6).map(h => `<li><span>${esc(h.title)}<br><span class="muted">${new Date(h.date).toLocaleDateString()} · ${h.correct}/${h.total} correct</span></span><span class="band-chip">${h.band ?? '–'}</span></li>`).join('')}</ul>`
            : '<p class="muted" style="margin:8px 0 0">Your scores will show here after your first test. Try the sample test to see how it works.</p>'}
        </section>
      </aside>
    </div>
  </div>`;
  const save = () => { draft = { src: $('#src').value, key: $('#key').value }; store.set('draft', draft); };
  $('#src').addEventListener('input', save);
  $('#key').addEventListener('input', save);
  window.scrollTo(0, 0);
}

function doParse() {
  const src = $('#src').value; const key = $('#key').value;
  if (src.trim().length < 200) { toast('Paste a full test first: at least one passage and its questions.'); return; }
  const t = ruleParse(src, key);
  if (!t.groups.length) { toast('No question sets found. Keep lines like “Questions 1–5” in the text.'); return; }
  pending = t; renderReview();
}

async function doAI(btn) {
  const src = $('#src').value; const key = $('#key').value;
  if (src.trim().length < 200) { toast('Paste a full test first: at least one passage and its questions.'); return; }
  btn.disabled = true; btn.textContent = 'Reading your test…';
  try {
    const r = await fetch('api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: src, key }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.test) throw new Error(d.error || 'AI parsing failed.');
    const t = normalizeTest(d.test);
    for (const g of t.groups) if ((g.type === 'match' || g.type === 'multi') && !g.options.length) g.options = letterOptions(g, t.passages);
    if (!t.groups.length) throw new Error('No questions found.');
    pending = t; renderReview();
  } catch (e) {
    toast(`${e.message} Using the standard reader instead.`);
    btn.disabled = false; btn.textContent = 'Build with AI';
    doParse();
  }
}

// =====================================================================
// CHECK SCREEN
// =====================================================================
function renderReview() {
  document.body.classList.remove('in-exam');
  const t = pending;
  const qs = allQuestions(t);
  const keyCount = qs.filter(q => t.key[q.n]).length;
  const missing = qs.filter(q => q.missing).length;
  const warnings = [];
  if (!keyCount) warnings.push('No answer key found. You can still take the test and add the key on the results page to get your band.');
  else if (keyCount < qs.length) warnings.push(`The answer key covers ${keyCount} of ${qs.length} questions. Only those will be marked.`);
  if (missing) warnings.push(`${missing} question${missing > 1 ? 's' : ''} could not be read from the text. ${missing > 1 ? 'They' : 'It'} will still get an answer box.`);
  if (t.keyEstimated) warnings.push('The answer key was worked out by AI. It is usually right, but double-check any mark that looks wrong.');
  const mins = defaultMinutes(t);

  app.innerHTML = `<div class="wrap">
    <section class="hero">
      <span class="eyebrow">Check your test</span>
      <h1>${t.passages.length} passage${t.passages.length > 1 ? 's' : ''}, ${qs.length} questions found</h1>
      <p>Make sure each question set has the right type and passage. Change anything that was read wrongly.</p>
    </section>
    <div class="card raised">
      <div class="field" style="margin-top:0"><label for="ttl">Test name</label><input type="text" id="ttl" value="${esc(t.title)}"></div>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th>Questions</th><th>Passage</th><th>Question type</th><th>Read</th><th>Answer key</th></tr></thead>
        <tbody>${t.groups.map((g, i) => {
          const found = g.questions.filter(q => !q.missing).length;
          const k = g.questions.filter(q => t.key[q.n]).length;
          return `<tr>
            <td class="num">${g.from}–${g.to}</td>
            <td><select id="gp${i}" data-gpass="${i}" aria-label="Passage for questions ${g.from}–${g.to}">${t.passages.map((p, j) => `<option value="${j}" ${j === g.passage ? 'selected' : ''}>Passage ${j + 1}</option>`).join('')}</select></td>
            <td><select id="gt${i}" data-gtype="${i}" aria-label="Type for questions ${g.from}–${g.to}">${Object.keys(TYPE_LABELS).map(l => `<option ${l === g.label ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
            <td class="num">${found}/${g.questions.length}</td>
            <td class="num">${k ? `${k}/${g.questions.length}` : '<span class="tag warn">none</span>'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th>Passage</th><th>Title</th><th>Words</th></tr></thead>
        <tbody>${t.passages.map((p, i) => `<tr><td class="num">${i + 1}</td><td>${esc(p.title)}</td><td class="num">${p.text.split(/\s+/).filter(Boolean).length}</td></tr>`).join('')}</tbody>
      </table></div>
      <div style="display:grid;gap:8px;margin-top:14px">${warnings.map(w => `<p class="notice" style="margin:0">${esc(w)}</p>`).join('')}</div>
      <h2 style="margin-top:20px">Mode</h2>
      <div class="mode-pick">
        <label><span><input type="radio" name="mode" value="exam" checked><strong>Exam mode</strong></span><span class="muted">${mins} minutes, no pause. Submits itself when time is up.</span></label>
        <label><span><input type="radio" name="mode" value="practice"><strong>Practice mode</strong></span><span class="muted">Pause any time and keep going after the timer ends. Time: <input type="number" id="mins" min="5" max="180" value="${mins}" style="width:72px;padding:3px 6px"> min</span></label>
      </div>
      <div class="row actions end">
        <button class="btn ghost" data-act="home">Back and edit</button>
        <button class="btn primary" data-act="start">Start test</button>
      </div>
    </div>
  </div>`;
  window.scrollTo(0, 0);
}

// =====================================================================
// EXAM
// =====================================================================
function startExam(test, mode, minutes) {
  const qs = allQuestions(test);
  S = {
    test, mode, duration: minutes * 60, left: minutes * 60, used: 0,
    answers: {}, flags: [], active: test.groups[0]?.passage || 0, current: qs[0]?.n,
    passageSeconds: test.passages.map(() => 0),
    passageHTML: test.passages.map(passageToHTML),
    paused: false, submitted: false, show: 'passage',
  };
  saveSession(); renderExam();
}
function saveSession() { if (S && !S.submitted) store.set('session', S); }

function passageToHTML(p) {
  let blocks = p.text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (blocks.length <= 2) blocks = p.text.split('\n').map(s => s.trim()).filter(Boolean);
  // lettered paragraphs? accept "A" on its own line, or "A " at start when letters run in order
  let expect = 'A'; let inline = 0;
  for (const b of blocks) if (new RegExp(`^${expect}\\s+\\S`).test(b)) { inline++; expect = String.fromCharCode(expect.charCodeAt(0) + 1); }
  const inlineMode = inline >= 3;
  let html = `<h2>${esc(p.title)}</h2>`;
  let label = null; expect = 'A';
  for (const b of blocks) {
    if (/^[A-L]$/.test(b)) { label = b; continue; }
    let text = b;
    if (!label && inlineMode && new RegExp(`^${expect}\\s+\\S`).test(b)) { label = expect; text = b.slice(1).trim(); }
    if (label) expect = String.fromCharCode(label.charCodeAt(0) + 1);
    html += `<div class="para ${label ? '' : 'nolabel'}">${label ? `<b>${label}</b>` : ''}<p>${esc(text).replace(/\n/g, ' ')}</p></div>`;
    label = null;
  }
  return html;
}

function renderExam() {
  document.body.classList.add('in-exam'); $('.toast')?.remove();
  const t = S.test;
  const n = allQuestions(t).length;
  app.innerHTML = `<div class="exam">
    <div class="exam-bar">
      <a class="brand" href="#" data-act="leave" title="Leave the test" style="font-size:17px"><i class="dot"></i>IELTS<span class="b-desk">Desk</span></a>
      <div class="title"><strong>${esc(t.title)}</strong><span>${S.mode === 'exam' ? 'Exam mode' : 'Practice mode'} · ${n} questions</span></div>
      <div class="timer" id="timer" role="timer"></div>
      ${S.mode === 'practice' ? `<button class="btn small" data-act="pause" id="pauseBtn">${S.paused ? 'Resume' : 'Pause'}</button>` : ''}
      <div class="bar-tools">
        <button class="icon-btn" data-act="font-dn" title="Smaller passage text" aria-label="Smaller passage text">A−</button>
        <button class="icon-btn" data-act="font-up" title="Larger passage text" aria-label="Larger passage text">A+</button>
        <button class="icon-btn" data-act="theme" data-theme-btn title="Switch light / dark theme" aria-label="Switch light / dark theme"></button>
      </div>
      <button class="btn primary" data-act="submit">Submit</button>
    </div>
    <div class="pane-switch">
      <button data-act="show" data-v="passage" aria-pressed="${S.show === 'passage'}">Passage</button>
      <button data-act="show" data-v="questions" aria-pressed="${S.show === 'questions'}">Questions</button>
    </div>
    <div class="split" id="split" data-show="${S.show}" style="--left:${store.get('split', 52)}%">
      <section class="pane passage-pane">
        <div class="ptabs" role="tablist">${t.passages.map((p, i) => `<button role="tab" data-act="ptab" data-i="${i}" aria-selected="${i === S.active}">Passage ${i + 1}</button>`).join('')}</div>
        <div class="pane-scroll" id="pscroll"><article class="passage" id="passage"></article></div>
      </section>
      <div class="divider" id="divider" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize panels"></div>
      <section class="pane q-pane"><div class="pane-scroll" id="qscroll"></div></section>
    </div>
    <nav class="qnav" id="qnav" aria-label="Question navigator"></nav>
  </div>`;
  applyTheme(); drawPassage(); drawQuestions(); drawNav(); drawTimer(); bindDivider();
}

function drawPassage() {
  $('#passage').innerHTML = S.passageHTML[S.active];
  $('#pscroll').scrollTop = 0;
  $$('.ptabs button').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.i === S.active)));
}

function groupHTML(g) {
  const showOpts = (g.type === 'match' || g.type === 'multi') && g.options.some(o => o.text && !/^Paragraph [A-L]$/.test(o.text));
  const optBox = showOpts ? `<div class="optbox"><div class="eyebrow">${esc(g.optionsTitle || (g.label === 'Matching Headings' ? 'List of Headings' : 'Options'))}</div><ol>${g.options.map(o => `<li><span>${esc(o.key)}</span>${esc(o.text)}</li>`).join('')}</ol></div>` : '';
  let body = '';
  if (g.body.trim()) {
    let b = esc(g.body);
    for (const q of g.questions) b = b.replace(new RegExp(`(\\(\\s*${q.n}\\s*\\)|\\[\\s*${q.n}\\s*\\]|(^|\\s)${q.n}(?=\\s*[._…\\u2026]{2,}))`), m => `<strong>${m}</strong>`);
    body = `<div class="qbody">${b}</div>`;
  }
  return `<section class="qgroup">
    <span class="tag">${esc(g.label)}</span>
    <h3>Questions ${g.from}–${g.to}</h3>
    ${g.instruction ? `<p class="instr">${esc(g.instruction)}</p>` : ''}
    ${optBox}${body}
    ${g.questions.map(q => qHTML(g, q)).join('')}
  </section>`;
}

function qHTML(g, q) {
  const v = S.answers[q.n] ?? '';
  const flagged = S.flags.includes(q.n);
  let ctl = '';
  if (g.type === 'tfng' || g.type === 'ynng') {
    const opts = g.type === 'tfng' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : ['YES', 'NO', 'NOT GIVEN'];
    ctl = `<div class="seg" role="group" aria-label="Answer for question ${q.n}">${opts.map(o => `<button type="button" data-act="pick" data-q="${q.n}" data-v="${o}" aria-pressed="${v === o}">${o}</button>`).join('')}</div>`;
  } else if (g.type === 'mcq') {
    const opts = q.options.length ? q.options : g.options;
    ctl = `<div class="opts">${opts.map(o => `<label><input type="radio" name="q${q.n}" value="${esc(o.key)}" data-q="${q.n}" ${v === o.key ? 'checked' : ''}><b>${esc(o.key)}</b><span>${esc(o.text)}</span></label>`).join('')}</div>`;
  } else if (g.type === 'match' || g.type === 'multi') {
    ctl = `<select id="a${q.n}" data-q="${q.n}" aria-label="Answer for question ${q.n}"><option value="">Choose…</option>${g.options.map(o => `<option value="${esc(o.key)}" ${v === o.key ? 'selected' : ''}>${esc(o.key)}${o.text && !/^Paragraph [A-L]$/.test(o.text) ? ' — ' + esc(trunc(o.text, 46)) : ''}</option>`).join('')}</select>`;
  } else {
    ctl = `<input id="a${q.n}" class="gap" type="text" data-q="${q.n}" value="${esc(v)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Answer for question ${q.n}">${g.wordLimit ? `<span class="wl" data-wl="${q.n}">max ${g.wordLimit} word${g.wordLimit > 1 ? 's' : ''}</span>` : ''}`;
  }
  let text = q.text ? esc(q.text).replace(/[.…_…]{3,}|_{2,}/g, '<span class="muted">______</span>') : '';
  if (!text && !(g.type === 'gap' && g.body)) text = g.type === 'multi' ? '<span class="muted">Choose one letter.</span>' : '<span class="muted">Question text was not found in the paste.</span>';
  return `<div class="q ${v ? 'answered' : ''} ${S.current === q.n ? 'current' : ''}" id="q-${q.n}" data-qbox="${q.n}">
    <span class="qn">${q.n}</span><div class="qtext">${text}</div>
    <button type="button" class="flag" data-act="flag" data-q="${q.n}" aria-pressed="${flagged}" title="Flag to review later" aria-label="Flag question ${q.n}">${ICON.flag}</button>
    <div class="qctl">${ctl}</div>
  </div>`;
}

function drawQuestions() {
  const gs = S.test.groups.filter(g => g.passage === S.active);
  $('#qscroll').innerHTML = gs.length ? gs.map(groupHTML).join('')
    : '<p class="muted">No questions are linked to this passage. Switch passage with the tabs on the left.</p>';
  $('#qscroll').scrollTop = 0;
  gs.forEach(g => g.questions.forEach(q => checkWordLimit(q.n)));
}

function drawNav() {
  const t = S.test;
  $('#qnav').innerHTML = t.passages.map((p, i) => {
    const qs = t.groups.filter(g => g.passage === i).flatMap(g => g.questions);
    if (!qs.length) return '';
    return `<div class="part"><span>Part ${i + 1}</span>${qs.map(q => `<button data-act="goto" data-q="${q.n}" class="${S.answers[q.n] ? 'answered' : ''} ${S.flags.includes(q.n) ? 'flagged' : ''} ${S.current === q.n ? 'current' : ''}" aria-label="Question ${q.n}">${q.n}</button>`).join('')}</div>`;
  }).join('') + `<div class="legend"><span><i style="background:var(--accent-soft);border-color:var(--accent)"></i>Answered</span><span><i style="background:var(--flag);border-color:var(--flag)"></i>Flagged</span></div>`;
}

function drawTimer() {
  const el = $('#timer'); if (!el) return;
  el.textContent = (S.left < 0 ? '+' : '') + clock(S.left);
  el.className = 'timer' + (S.left <= 300 ? ' crit' : S.left <= 600 ? ' low' : '') + (S.paused ? ' paused' : '');
  el.setAttribute('aria-label', `${Math.max(0, Math.ceil(S.left / 60))} minutes left`);
}

function tick() {
  if (!S || S.submitted || S.paused || !document.body.classList.contains('in-exam')) return;
  S.left--; S.used++; S.passageSeconds[S.active]++;
  if (S.left === 600 && S.duration >= 1500) toast('10 minutes left.');
  if (S.left === 300) toast('5 minutes left. Make sure nothing is blank.');
  if (S.left === 0 && S.mode === 'practice') toast('Time is up. You can keep going, or submit now.');
  drawTimer();
  if (S.used % 5 === 0) saveSession();
  if (S.left <= 0 && S.mode === 'exam') submit(true);
}
setInterval(tick, 1000);

function setCurrent(n) {
  if (S.current === n) return;
  $(`#q-${S.current}`)?.classList.remove('current');
  S.current = n;
  $(`#q-${n}`)?.classList.add('current');
  drawNav();
}

function setAnswer(n, v) {
  v = (v || '').toString();
  if (v.trim()) S.answers[n] = v; else delete S.answers[n];
  $(`#q-${n}`)?.classList.toggle('answered', !!v.trim());
  S.current = n;
  $$('.q.current').forEach(e => { if (e.id !== `q-${n}`) e.classList.remove('current'); });
  $(`#q-${n}`)?.classList.add('current');
  checkWordLimit(n);
  drawNav(); saveSession();
}

function checkWordLimit(n) {
  const wl = $(`[data-wl="${n}"]`); if (!wl) return;
  const g = S.test.groups.find(x => x.questions.some(q => q.n === n));
  const words = (S.answers[n] || '').trim().split(/\s+/).filter(w => w && !/^\d+$/.test(w)).length;
  const over = g.wordLimit && words > g.wordLimit;
  wl.classList.toggle('over', !!over);
  wl.textContent = over ? `too many words (max ${g.wordLimit})` : `max ${g.wordLimit} word${g.wordLimit > 1 ? 's' : ''}`;
}

function switchPassage(i) {
  if (i === S.active) return;
  S.passageHTML[S.active] = $('#passage').innerHTML;
  S.active = i; drawPassage(); drawQuestions(); saveSession();
}

function gotoQ(n) {
  const g = S.test.groups.find(x => x.questions.some(q => q.n === n));
  if (!g) return;
  if (g.passage !== S.active) switchPassage(g.passage);
  setCurrent(n);
  if (matchMedia('(max-width: 800px)').matches) setShow('questions');
  const box = $(`#q-${n}`);
  box?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  box?.querySelector('input, select, .seg button')?.focus({ preventScroll: true });
}

function setShow(v) {
  S.show = v; $('#split').dataset.show = v;
  $$('.pane-switch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
}

function bindDivider() {
  const d = $('#divider'), split = $('#split');
  const setPct = p => { p = Math.min(75, Math.max(25, p)); split.style.setProperty('--left', p + '%'); store.set('split', Math.round(p)); };
  d.addEventListener('pointerdown', e => {
    d.setPointerCapture(e.pointerId); d.classList.add('drag');
    const move = ev => { const r = split.getBoundingClientRect(); setPct(((ev.clientX - r.left) / r.width) * 100); };
    const up = () => { d.classList.remove('drag'); d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); };
    d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
  });
  d.addEventListener('keydown', e => {
    const cur = store.get('split', 52);
    if (e.key === 'ArrowLeft') setPct(cur - 3); if (e.key === 'ArrowRight') setPct(cur + 3);
  });
}

// ---------- highlighting ----------
let hlPop = null;
function hideHlPop() { hlPop?.remove(); hlPop = null; }
function maybeShowHlPop() {
  hideHlPop();
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const passage = $('#passage');
  if (!passage || !passage.contains(range.commonAncestorContainer)) return;
  const rect = range.getBoundingClientRect();
  hlPop = document.createElement('div');
  hlPop.className = 'hl-pop';
  hlPop.innerHTML = '<button class="btn small primary" type="button">Highlight</button>';
  hlPop.style.left = Math.max(8, Math.min(innerWidth - 110, rect.left + rect.width / 2 - 45)) + 'px';
  hlPop.style.top = Math.max(8, rect.top - 44) + 'px';
  hlPop.querySelector('button').addEventListener('mousedown', e => e.preventDefault());
  hlPop.querySelector('button').addEventListener('click', () => {
    highlightRange(range); sel.removeAllRanges(); hideHlPop();
    S.passageHTML[S.active] = passage.innerHTML; saveSession();
  });
  document.body.appendChild(hlPop);
}
function highlightRange(range) {
  const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) { const n = walker.currentNode; if (range.intersectsNode(n) && n.textContent.trim()) nodes.push(n); }
  if (!nodes.length && range.startContainer.nodeType === 3) nodes.push(range.startContainer);
  for (const n of nodes) {
    let s = 0, e = n.length;
    if (n === range.startContainer) s = range.startOffset;
    if (n === range.endContainer) e = range.endOffset;
    if (e <= s || n.parentNode.closest('h2, b')) continue;
    const target = n.splitText(s); target.splitText(e - s);
    const m = document.createElement('mark'); m.className = 'hl'; m.title = 'Click to remove highlight';
    target.parentNode.replaceChild(m, target); m.appendChild(target);
  }
}
document.addEventListener('mouseup', e => { if (e.target.closest?.('.hl-pop')) return; if (S && document.body.classList.contains('in-exam')) setTimeout(maybeShowHlPop, 10); });
document.addEventListener('touchend', () => { if (S && document.body.classList.contains('in-exam')) setTimeout(maybeShowHlPop, 300); });

// ---------- submit ----------
function askSubmit() {
  const total = allQuestions(S.test).length;
  const blank = total - Object.keys(S.answers).length;
  const flagged = S.flags.length;
  const parts = [];
  if (blank) parts.push(`<strong>${blank}</strong> unanswered`);
  if (flagged) parts.push(`<strong>${flagged}</strong> flagged`);
  modal({
    title: 'Submit your answers?',
    body: parts.length ? `You have ${parts.join(' and ')} question${blank + flagged > 1 ? 's' : ''}. There is no penalty for guessing, so fill every box before you submit.` : 'All questions are answered. You cannot change answers after submitting.',
    actions: [{ label: 'Keep working' }, { label: 'Submit', primary: true, fn: () => submit(false) }],
  });
}

function submit(auto) {
  if (!S || S.submitted) return;
  S.submitted = true; hideHlPop();
  if ($('#passage')) S.passageHTML[S.active] = $('#passage').innerHTML;
  const timing = { used: S.used, passageSeconds: S.passageSeconds, autoSubmitted: auto, duration: S.duration };
  lastResult = { test: S.test, answers: S.answers, timing, mode: S.mode };
  store.set('lastResult', lastResult);
  store.del('session');
  const rep = buildReport(S.test, S.answers, timing);
  recordHistory(rep, S.test);
  if (auto) toast('Time is up. Your answers were submitted.');
  S = null;
  renderResult();
}

function recordHistory(rep, test, replace = false) {
  if (!rep.total) return;
  const hist = store.get('history', []);
  const entry = { title: test.title, date: Date.now(), correct: rep.correct, total: rep.total, band: rep.band?.band ?? null };
  if (replace && hist.length) hist[0] = entry; else hist.unshift(entry);
  store.set('history', hist.slice(0, 30));
}

// =====================================================================
// RESULT
// =====================================================================
function renderResult() {
  document.body.classList.remove('in-exam');
  const { test, answers, timing } = lastResult;
  const r = buildReport(test, answers, timing);
  const bandTxt = r.band ? r.band.band.toFixed(1) : '–';
  const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
  const scaledNote = r.total && r.total !== 40 ? `Estimated by scaling ${r.correct}/${r.total} to a 40-question test (${r.band.raw}/40).` : 'Estimated from the usual Academic Reading conversion table. Official tables vary slightly by test.';
  const barClass = p => (p < 0.5 ? 'lo' : p < 0.75 ? 'mid' : '');

  app.innerHTML = `<div class="wrap">
    <section class="result-head">
      <div class="band-dial" style="--p:${r.band ? (r.band.band / 9) * 100 : 0}"><div><strong>${bandTxt}</strong><span>est. band</span></div></div>
      <div>
        <span class="eyebrow">Your result · ${esc(test.title)}</span>
        <h1 style="font-family:var(--f-read);font-weight:600;font-size:clamp(24px,3.4vw,34px);margin-top:6px">${r.total ? headline(r) : 'Add the answer key to see your band'}</h1>
        <div class="stats">
          <div><strong>${r.correct}/${r.total || '–'}</strong><span>correct</span></div>
          <div><strong>${pct}%</strong><span>accuracy</span></div>
          <div><strong>${formatDuration(timing.used)}</strong><span>time used of ${Math.round(timing.duration / 60)} min</span></div>
          <div><strong>${r.blanks}</strong><span>left blank</span></div>
        </div>
        <p class="muted" style="font-size:13px;margin:10px 0 0">${r.total ? scaledNote : ''}</p>
      </div>
    </section>

    ${r.keyMissing ? `<section class="card raised" style="margin-top:16px">
      <h2>${r.total ? `${r.keyMissing} question${r.keyMissing > 1 ? 's have' : ' has'} no answer key` : 'No answer key yet'}</h2>
      <p class="muted" style="margin:0">Paste the answer key to mark ${r.total ? 'the rest' : 'your answers'}.</p>
      <div class="field"><label for="lateKey">Answer key</label><textarea id="lateKey" style="min-height:90px;font-family:var(--f-num);font-size:13.5px" placeholder="1 TRUE&#10;2 iv&#10;3 food production"></textarea></div>
      <div class="row actions"><button class="btn primary" data-act="latekey">Mark my answers</button></div>
    </section>` : ''}

    <div class="result-grid">
      <section class="card full">
        <span class="eyebrow">Mentor's notes</span>
        <h2 style="margin-top:4px">${r.tips.length ? 'What to fix first' : 'Strong work'}</h2>
        ${r.goal ? `<p class="muted" style="margin:6px 0 0">To reach <strong>band ${r.goal.targetBand.toFixed(1)}</strong> on a test like this you need about <strong>${r.goal.extra} more correct answer${r.goal.extra > 1 ? 's' : ''}</strong>. The notes below are ordered by how many marks they can win back.</p>` : ''}
        ${r.strengths.length ? `<div class="strengths">${r.strengths.map(s => `<span class="tag">Strong: ${esc(s)}</span>`).join('')}</div>` : ''}
        <div class="tips">${r.tips.length ? r.tips.slice(0, 6).map(t => `<div class="tip ${t.priority >= 8 ? 'hot' : ''}"><h3>${esc(t.title)}</h3><p>${esc(t.body)}</p></div>`).join('')
          : '<div class="tip"><h3>No major weak spots in this test</h3><p>Keep the same method and move to harder material: Passage 3 style texts with Yes/No/Not Given and Matching Headings. Time yourself strictly.</p></div>'}</div>
      </section>

      <section class="card">
        <h2>By question type</h2>
        <div class="bars">${r.types.length ? r.types.map(t => `<div class="barrow"><span>${esc(t.label)}</span><span class="num" style="text-align:right">${t.correct}/${t.total}</span><div class="track"><div class="fill ${barClass(t.pct)}" style="width:${Math.max(3, t.pct * 100)}%"></div></div></div>`).join('') : '<p class="muted">Shown once answers are marked.</p>'}</div>
      </section>

      <section class="card">
        <h2>By passage</h2>
        <div class="table-wrap"><table class="grid"><thead><tr><th>Passage</th><th>Score</th><th>Time</th>${test.passages.length === 3 ? '<th>Target</th>' : ''}</tr></thead>
        <tbody>${r.byPassage.map((p, i) => `<tr><td>${i + 1}. ${esc(trunc(p.title, 34))}</td><td class="num">${p.total ? `${p.correct}/${p.total}` : '–'}</td><td class="num">${formatDuration(p.seconds)}</td>${test.passages.length === 3 ? `<td class="num">${[17, 20, 23][i]}m</td>` : ''}</tr>`).join('')}</tbody></table></div>
      </section>

      <section class="card full">
        <h2>Your 7-day plan</h2>
        <ul class="plan">${r.plan.map(p => `<li><b>${p.day}</b><span>${esc(p.task)}</span></li>`).join('')}</ul>
      </section>

      <section class="card full">
        <div class="row" style="justify-content:space-between"><h2>Answer review</h2>
          <label class="row" style="gap:6px;font-size:14px"><input type="checkbox" id="onlyWrong" style="accent-color:var(--accent)"> Show mistakes only</label></div>
        <div class="table-wrap"><table class="grid" id="reviewTable"><thead><tr><th>Q</th><th>Type</th><th>Your answer</th><th>Correct answer</th><th></th></tr></thead>
        <tbody>${r.rows.map(x => `<tr class="${x.ok === false ? 'wrong' : ''}" data-ok="${x.ok}">
          <td class="num">${x.n}</td><td class="muted">${esc(x.group.label)}</td>
          <td>${x.user ? esc(x.user) : '<span class="muted">blank</span>'}${x.nearMiss ? ' <span class="tag warn">spelling</span>' : ''}${x.overLimit ? ' <span class="tag warn">word limit</span>' : ''}</td>
          <td>${x.key ? esc(x.key) : '<span class="muted">no key</span>'}</td>
          <td class="${x.ok ? 'ok' : x.ok === false ? 'no' : ''}">${x.ok ? '✓' : x.ok === false ? '✗' : ''}</td></tr>`).join('')}</tbody></table></div>
      </section>
    </div>

    <div class="row actions end" style="margin-top:20px">
      <button class="btn ghost" data-act="home">New test</button>
      <button class="btn primary" data-act="retake">Retake this test</button>
    </div>
  </div>`;
  $('#onlyWrong').addEventListener('change', e => {
    $$('#reviewTable tbody tr').forEach(tr => { tr.hidden = e.target.checked && tr.dataset.ok !== 'false'; });
  });
  window.scrollTo(0, 0);
}

function headline(r) {
  const b = r.band.band;
  if (b >= 8) return 'Excellent. You are reading at a high level.';
  if (b >= 7) return 'Good result. A few habits stand between you and band 8.';
  if (b >= 6) return 'Solid base. Fixing two or three habits will lift your band.';
  if (b >= 5) return 'You are on your way. Focus on method before speed.';
  return 'Early days. Build the method one question type at a time.';
}

// =====================================================================
// EVENTS
// =====================================================================
app.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a) {
    const m = e.target.closest('mark.hl');
    if (m && S && getSelection().isCollapsed) {
      m.replaceWith(...m.childNodes);
      S.passageHTML[S.active] = $('#passage').innerHTML; saveSession();
    }
    return;
  }
  const act = a.dataset.act;
  if (a.tagName === 'A') e.preventDefault();
  switch (act) {
    case 'home': renderHome(); break;
    case 'parse': doParse(); break;
    case 'ai': doAI(a); break;
    case 'sample':
      $('#src').value = SAMPLE_TEST; $('#key').value = '';
      draft = { src: SAMPLE_TEST, key: '' }; store.set('draft', draft);
      toast('Sample test loaded. Press “Build my test”.'); break;
    case 'clear':
      $('#src').value = ''; $('#key').value = ''; draft = { src: '', key: '' }; store.set('draft', draft); break;
    case 'resume': S = store.get('session', null); if (S) renderExam(); break;
    case 'discard': store.del('session'); renderHome(); break;
    case 'start': {
      pending.title = $('#ttl').value.trim() || pending.title;
      const mode = $('input[name="mode"]:checked').value;
      const mins = mode === 'practice' ? Math.min(180, Math.max(5, +$('#mins').value || defaultMinutes(pending))) : defaultMinutes(pending);
      startExam(pending, mode, mins); break;
    }
    case 'ptab': switchPassage(+a.dataset.i); break;
    case 'pick': {
      const n = +a.dataset.q;
      const v = a.getAttribute('aria-pressed') === 'true' ? '' : a.dataset.v;
      a.parentNode.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === a && !!v)));
      setAnswer(n, v); break;
    }
    case 'flag': {
      const n = +a.dataset.q;
      S.flags = S.flags.includes(n) ? S.flags.filter(x => x !== n) : [...S.flags, n];
      a.setAttribute('aria-pressed', String(S.flags.includes(n)));
      drawNav(); saveSession(); break;
    }
    case 'goto': gotoQ(+a.dataset.q); break;
    case 'show': setShow(a.dataset.v); break;
    case 'pause':
      S.paused = !S.paused; a.textContent = S.paused ? 'Resume' : 'Pause'; drawTimer(); saveSession(); break;
    case 'font-up': store.set('font', Math.min(24, store.get('font', 17) + 1)); applyFont(); break;
    case 'font-dn': store.set('font', Math.max(14, store.get('font', 17) - 1)); applyFont(); break;
    case 'theme': toggleTheme(); break;
    case 'submit': askSubmit(); break;
    case 'leave':
      modal({
        title: 'Leave the test?',
        body: S.mode === 'exam' ? 'Your answers are saved. The timer keeps its place, and you can resume from the home page.' : 'Your answers are saved. You can resume from the home page.',
        actions: [{ label: 'Stay' }, { label: 'Leave', primary: true, fn: () => { saveSession(); S = null; renderHome(); } }],
      });
      break;
    case 'latekey': {
      const k = parseKey($('#lateKey').value);
      if (!Object.keys(k).length) { toast('No answers found. Write one per line, like “1 TRUE”.'); break; }
      const hadScore = buildReport(lastResult.test, lastResult.answers, lastResult.timing).total > 0;
      lastResult.test.key = { ...lastResult.test.key, ...k };
      store.set('lastResult', lastResult);
      recordHistory(buildReport(lastResult.test, lastResult.answers, lastResult.timing), lastResult.test, hadScore);
      renderResult(); break;
    }
    case 'retake': {
      const t = lastResult.test;
      pending = JSON.parse(JSON.stringify(t)); renderReview(); break;
    }
  }
});

app.addEventListener('input', e => {
  const el = e.target;
  if (S && el.matches('input.gap[data-q]')) setAnswer(+el.dataset.q, el.value);
});
app.addEventListener('change', e => {
  const el = e.target;
  if (S && el.matches('select[data-q], input[type="radio"][data-q]')) { setAnswer(+el.dataset.q, el.value); return; }
  if (pending && el.matches('[data-gtype]')) {
    const g = pending.groups[+el.dataset.gtype];
    g.label = el.value; g.type = TYPE_LABELS[el.value];
    if ((g.type === 'match' || g.type === 'multi') && !g.options.length) g.options = letterOptions(g, pending.passages);
    if (g.type === 'mcq' && !g.questions.some(q => q.options.length) && !g.options.length) g.options = 'ABCD'.split('').map(k => ({ key: k, text: '' }));
  }
  if (pending && el.matches('[data-gpass]')) pending.groups[+el.dataset.gpass].passage = +el.value;
});
app.addEventListener('focusin', e => {
  const box = e.target.closest('[data-qbox]');
  if (S && box) setCurrent(+box.dataset.qbox);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideHlPop(); $('.modal-bg')?.remove(); } });

// ---------- boot ----------
lastResult = store.get('lastResult', null);
renderHome();
