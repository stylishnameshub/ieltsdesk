// IELTSDesk — turns pasted test text into a structured test.
// Works without AI: looks for "Reading Passage N", "Questions X–Y" and an answer key.

export const TYPE_LABELS = {
  'True / False / Not Given': 'tfng',
  'Yes / No / Not Given': 'ynng',
  'Multiple Choice': 'mcq',
  'Multiple Choice (choose more than one)': 'multi',
  'Matching Headings': 'match',
  'Matching Information': 'match',
  'Matching Features': 'match',
  'Matching Sentence Endings': 'match',
  'Summary Completion (word box)': 'match',
  'Summary Completion': 'gap',
  'Sentence Completion': 'gap',
  'Note Completion': 'gap',
  'Table Completion': 'gap',
  'Flow-chart Completion': 'gap',
  'Diagram Labelling': 'gap',
  'Short Answer': 'gap',
};

const PASSAGE_RE = /^\s*(?:reading\s+)?passage\s*(\d+)\b\s*[:.\-–—]?\s*(.*)$/i;
const QHEAD_RE = /^\s*questions?\s+(\d{1,2})\s*(?:-|–|—|to|and|&)\s*(\d{1,2})\b\s*[:.]?\s*(.*)$/i;
const KEY_HEAD_RE = /^\s*(?:answer\s*keys?|answers?|key)\s*[:.]?\s*$/i;
const SKIP_RE = /you should spend about \d+ minutes/i;
const ROMAN_RE = /^(?:x{0,1}(?:ix|iv|v?i{1,3}|v|x))$/i;

const QLINE_RE = /^\s*(?:Q(?:uestion)?\s*)?(\d{1,2})\s*[.):]?\s+(.+)$/i;
const QNUM_ONLY_RE = /^\s*(\d{1,2})\s*[.):]?\s*$/;
const ROMAN_LINE_RE = /^\s*([ivx]{1,5})\s*[.):]?\s+(.+)$/i;
const LETTER_LINE_RE = /^\s*([A-L])\s*[.):]?\s+(.+)$/;
const LETTER_ONLY_RE = /^\s*([A-L])\s*[.):]?\s*$/;

function isPassageMarker(line) {
  const t = line.trim();
  if (t.length > 70) return false;
  return !/paragraph|section|has |below|questions|based on/i.test(t);
}

function nextLetter(l) { return String.fromCharCode(l.charCodeAt(0) + 1); }

// ---------- answer key ----------
export function parseKey(text) {
  const key = {};
  if (!text || !text.trim()) return key;
  const t = text.replace(/\r/g, '');
  const pieces = t
    .split(/\n|[;,](?=\s*\d{1,2}\s*[.):\-–—=]?\s*\S)|\s+(?=\d{1,2}\s*[.):\-–—=]\s*\S)|\s+(?=\d{1,2}\s+(?:TRUE|FALSE|NOT GIVEN|YES|NO|[A-L]|[ivx]{1,5}|\()(?:\b|\s))|\s+(?=\d{1,2}\s*(?:-|–|&|and)\s*\d{1,2}\s+[A-L]\b)/i)
    .map(s => s.trim())
    .filter(Boolean);
  for (const p of pieces) {
    let m = p.match(/^(?:Q(?:uestion)?\.?\s*)?(\d{1,2})\s*(?:&|and|-|–|—)\s*(\d{1,2})\s*[.):=]?\s+(.+)$/i);
    if (m && /^[A-L](?:\s*(?:,|and|&|\s)\s*[A-L])+$/i.test(m[3].trim())) {
      const a = +m[1], b = +m[2];
      const letters = m[3].match(/[A-L]/gi) || [];
      for (let n = a, i = 0; n <= b; n++, i++) if (letters[i]) key[n] = letters[i].toUpperCase();
      continue;
    }
    m = p.match(/^(?:Q(?:uestion)?\.?\s*)?(\d{1,2})\s*[.):\-–—=]?\s*(.+?)\s*$/i);
    if (m) {
      const n = +m[1];
      if (n >= 1 && n <= 60 && !(n in key)) key[n] = m[2].trim();
    }
  }
  // answers written on one line ("3 A 4 obsidian 5 blow"): split at the next question number
  for (const n of Object.keys(key).map(Number).sort((a, b) => a - b)) {
    let v = key[n]; let cur = n;
    for (;;) {
      const m = v.match(new RegExp(`^(.*?)\\s+${cur + 1}\\s*[.):\\-–—=]?\\s+(.+)$`));
      if (!m || (cur + 1) in key) break;
      key[cur] = m[1].trim(); key[cur + 1] = m[2].trim(); v = m[2]; cur++;
    }
  }
  return key;
}

// ---------- type detection ----------
function detectType(instr, all, g) {
  const t = instr + '\n' + all;
  const withOpts = g.questions.filter(q => q.options && q.options.length >= 2).length;
  if (/TRUE[\s\S]{0,120}FALSE[\s\S]{0,120}NOT GIVEN/.test(t)) return ['tfng', 'True / False / Not Given'];
  if (/\bYES\b[\s\S]{0,120}\bNO\b[\s\S]{0,120}NOT GIVEN/.test(t)) return ['ynng', 'Yes / No / Not Given'];
  if (/heading/i.test(instr)) return ['match', 'Matching Headings'];
  if (/which (paragraph|section) contains|following information/i.test(instr)) return ['match', 'Matching Information'];
  if (/choose (two|three|four)\b/i.test(instr)) return ['multi', 'Multiple Choice (choose more than one)'];
  if (/correct ending|sentence endings?/i.test(instr)) return ['match', 'Matching Sentence Endings'];
  if (/from the (box|list) below|(?:words?|options?) (?:in|from) the box|choose (?:your answers )?from the box/i.test(instr)) return ['match', 'Summary Completion (word box)'];
  if (withOpts >= Math.max(1, Math.ceil(g.questions.length / 2))) return ['mcq', 'Multiple Choice'];
  if (/\bmatch\b|correct (person|researcher|scientist|company|country)|list of (people|researchers|features|scientists|findings)/i.test(instr)) return ['match', 'Matching Features'];
  if (/NO MORE THAN|ONLY ONE WORD|ONE WORD ONLY|AND\/OR A NUMBER|ONE WORD AND|\bA NUMBER\b/i.test(t)) {
    if (/summary/i.test(instr)) return ['gap', 'Summary Completion'];
    if (/table/i.test(instr)) return ['gap', 'Table Completion'];
    if (/flow[\s-]?chart/i.test(instr)) return ['gap', 'Flow-chart Completion'];
    if (/notes?\b/i.test(instr)) return ['gap', 'Note Completion'];
    if (/diagram|label/i.test(instr)) return ['gap', 'Diagram Labelling'];
    if (/answer the questions|questions below/i.test(instr)) return ['gap', 'Short Answer'];
    return ['gap', 'Sentence Completion'];
  }
  if (g.options.length >= 2) return ['match', 'Matching Features'];
  return ['gap', 'Short Answer'];
}

export function wordLimitOf(instr) {
  const words = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  let m = instr.match(/NO MORE THAN (ONE|TWO|THREE|FOUR|FIVE) WORDS?/i);
  if (m) return words[m[1].toUpperCase()];
  if (/ONE WORD ONLY|ONLY ONE WORD/i.test(instr)) return 1;
  return null;
}

function paragraphLetters(passageText) {
  const letters = [];
  for (const line of passageText.split('\n')) {
    const m = line.match(/^\s*([A-L])(?:\s*$|\s+\S)/);
    if (m && m[1] === (letters.length ? nextLetter(letters[letters.length - 1]) : 'A')) letters.push(m[1]);
  }
  return letters.length >= 2 ? letters : null;
}

export function letterOptions(g, passages) {
  const r = g.instruction.match(/\b([A-L])\s*(?:-|–|—|to)\s*([A-L])\b/);
  let letters = null;
  if (r && r[1] < r[2]) {
    letters = [];
    for (let c = r[1]; c <= r[2]; c = nextLetter(c)) letters.push(c);
  }
  if (!letters) letters = paragraphLetters(passages[g.passage]?.text || '');
  if (!letters) letters = 'ABCDEFGH'.split('');
  return letters.map(k => ({ key: k, text: g.label === 'Matching Information' ? `Paragraph ${k}` : '' }));
}

// ---------- one question group ----------
function parseGroup(raw, passages) {
  const g = {
    from: raw.from, to: raw.to, passage: raw.passage,
    instruction: '', optionsTitle: '', options: [], questions: [], body: '', inline: false,
  };
  const lines = raw.lines;
  const inRange = n => n >= g.from && n <= g.to;
  const taken = new Set();
  const instr = [];
  const body = [];
  let phase = 'instr';
  let lastQ = null;
  let lastWasOption = false;
  let letterList = null; // { owner: q|null, expect }
  let romanStarted = false;

  const gapRe = n => new RegExp(`(?:\\(\\s*${n}\\s*\\)|\\[\\s*${n}\\s*\\]|(?:^|\\s)${n}\\s*[._…\\u2026]{2,})`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { lastWasOption = false; continue; }

    if (/^list of\b/i.test(trimmed) && trimmed.length < 60) {
      g.optionsTitle = trimmed; phase = 'rest'; continue;
    }

    let m = trimmed.match(QLINE_RE);
    let qn = m ? +m[1] : null;
    let qtext = m ? m[2] : '';
    if (!m) {
      const only = trimmed.match(QNUM_ONLY_RE);
      if (only && inRange(+only[1]) && !taken.has(+only[1]) && lines[i + 1] && lines[i + 1].trim()) {
        qn = +only[1]; qtext = lines[++i].trim(); m = true;
      }
    }
    if (m && inRange(qn) && !taken.has(qn) && !(phase === 'instr' && /^(?:in|on) boxes/i.test(qtext))) {
      phase = 'rest';
      lastQ = { n: qn, text: qtext, options: [] };
      g.questions.push(lastQ); taken.add(qn);
      letterList = { owner: lastQ, expect: 'A' };
      lastWasOption = true;
      continue;
    }

    const rm = trimmed.match(ROMAN_LINE_RE);
    if (rm && ROMAN_RE.test(rm[1]) && (romanStarted ? true : rm[1].toLowerCase() === 'i') && trimmed.length < 200 && rm[1] === rm[1].toLowerCase()) {
      romanStarted = true; phase = 'rest';
      g.options.push({ key: rm[1].toLowerCase(), text: rm[2].trim() });
      continue;
    }

    let lm = trimmed.match(LETTER_LINE_RE);
    if (!lm) {
      const lo = trimmed.match(LETTER_ONLY_RE);
      if (lo && lines[i + 1] && lines[i + 1].trim() && lines[i + 1].trim().length < 200) lm = [null, lo[1], lines[++i].trim()];
    }
    if (lm && trimmed.length < 220) {
      if (!letterList || (lm[1] === 'A' && letterList.expect !== 'A')) {
        // a new list starts: attach to the last question only if we are right after it
        letterList = { owner: lastWasOption && lastQ ? lastQ : null, expect: 'A' };
      }
      if (lm[1] === letterList.expect) {
        const target = letterList.owner ? letterList.owner.options : g.options;
        target.push({ key: lm[1], text: lm[2].trim() });
        letterList.expect = nextLetter(lm[1]);
        lastWasOption = true; phase = 'rest';
        continue;
      }
    }

    // inline gap numbers mean the body (summary/notes/table) has started
    if (phase === 'instr') {
      let hasGap = false;
      for (let n = g.from; n <= g.to; n++) if (gapRe(n).test(trimmed)) { hasGap = true; break; }
      if (hasGap) phase = 'rest';
    }
    if (phase === 'instr') instr.push(trimmed);
    else body.push(trimmed);
    lastWasOption = false;
    if (lastQ && letterList && letterList.owner === lastQ) letterList = null;
  }

  // Shared letter list that got attached to the last question only (matching endings, features)
  const withOpts = g.questions.filter(q => q.options.length);
  if (withOpts.length === 1 && g.questions.length > 1 && withOpts[0] === g.questions[g.questions.length - 1] && !g.options.length) {
    g.options = withOpts[0].options; withOpts[0].options = [];
  }
  // lists of one item are probably prose that starts with "A "
  for (const q of g.questions) if (q.options.length === 1) { body.push(`${q.options[0].key} ${q.options[0].text}`); q.options = []; }
  if (g.options.length === 1) { body.push(`${g.options[0].key} ${g.options[0].text}`); g.options = []; }

  g.instruction = instr.join('\n');
  g.body = body.join('\n');

  // gaps written inside the body text
  const bodyText = g.body;
  for (let n = g.from; n <= g.to; n++) {
    if (taken.has(n)) continue;
    const re = gapRe(n);
    const hit = bodyText.match(re);
    if (hit) {
      const idx = hit.index;
      let start = Math.max(0, idx - 140);
      const before = bodyText.slice(0, idx);
      const sb = [...before.matchAll(/[!?]\s|[a-z)]\.\s/g)].pop();
      if (sb && sb.index + 2 > start) start = sb.index + 2;
      let end = bodyText.indexOf('.', idx + hit[0].length);
      if (end === -1 || end - idx > 160) end = Math.min(bodyText.length, idx + 160);
      const snippet = bodyText.slice(start, end + 1).replace(re, ' ____ ').replace(/\s+/g, ' ').trim();
      g.questions.push({ n, text: snippet, options: [] });
      g.inline = true; taken.add(n);
    }
  }
  for (let n = g.from; n <= g.to; n++) if (!taken.has(n)) g.questions.push({ n, text: '', options: [], missing: true });
  g.questions.sort((a, b) => a.n - b.n);

  const [type, label] = detectType(g.instruction, g.body + '\n' + g.questions.map(q => q.text).join('\n'), g);
  g.type = type; g.label = label;
  g.wordLimit = wordLimitOf(g.instruction);
  return g;
}

function splitTitle(lines) {
  const clean = lines.filter(l => !SKIP_RE.test(l));
  let i = 0;
  while (i < clean.length && !clean[i].trim()) i++;
  const first = (clean[i] || '').trim();
  if (first && first.length < 90 && !/[.:]$/.test(first) && !/^[A-L]$/.test(first)) {
    return { title: first, text: clean.slice(i + 1).join('\n').trim() };
  }
  return { title: '', text: clean.join('\n').trim() };
}

// ---------- full test ----------
export function ruleParse(raw, keyRaw = '') {
  const lines = (raw || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  const passages = [];
  const groups = [];
  let keyText = '';
  let cur = null;
  const newPassage = () => { const p = { lines: [] }; passages.push(p); return p; };

  for (const line of lines) {
    let m;
    if (KEY_HEAD_RE.test(line) && (groups.length || passages.length)) { cur = { kind: 'k' }; continue; }
    if (cur && cur.kind === 'k') { keyText += '\n' + line; continue; }
    if ((m = line.match(PASSAGE_RE)) && isPassageMarker(line)) {
      const p = newPassage();
      if (m[2] && m[2].trim()) p.lines.push(m[2].trim());
      cur = { kind: 'p', obj: p }; continue;
    }
    if ((m = line.match(QHEAD_RE))) {
      const a = +m[1], b = +m[2];
      if (b >= a && b - a < 20) {
        if (!passages.length) newPassage();
        const g = { from: a, to: b, passage: passages.length - 1, lines: [] };
        if (m[3] && m[3].trim()) g.lines.push(m[3].trim());
        groups.push(g);
        cur = { kind: 'g', obj: g }; continue;
      }
    }
    if (!cur) cur = { kind: 'p', obj: newPassage() };
    if (cur.kind === 'g' && line.trim().length > 300 && !/\d/.test(line.slice(0, 4))) {
      const g = cur.obj;
      const hasLast = g.lines.some(l => new RegExp(`(^|\\s|\\()${g.to}(\\s|\\.|\\)|$)`).test(l));
      if (hasLast) cur = { kind: 'p', obj: newPassage() };
    }
    cur.obj.lines.push(line);
  }

  const P = passages
    .map(p => splitTitle(p.lines))
    .map((p, i) => ({ title: p.title || `Passage ${i + 1}`, text: p.text }));

  // drop empty passages but keep group references right
  const map = []; const finalP = [];
  P.forEach((p, i) => { if (p.text.length > 40) { map[i] = finalP.length; finalP.push(p); } else map[i] = Math.max(0, finalP.length - 1); });
  if (!finalP.length) finalP.push({ title: 'Passage 1', text: P.map(p => p.text).join('\n\n') });

  const G = groups.map(g => parseGroup({ ...g, passage: map[g.passage] ?? 0 }, finalP));
  for (const g of G) if (g.type === 'match' && !g.options.length) g.options = letterOptions(g, finalP);

  const key = { ...parseKey(keyText), ...parseKey(keyRaw) };
  return normalizeTest({ title: finalP[0]?.title || 'Reading test', passages: finalP, groups: G, key, keyEstimated: false, source: 'rule' });
}

// ---------- shared clean-up (also used for AI output) ----------
export function normalizeTest(t) {
  const passages = (t.passages || []).filter(p => p && (p.text || '').trim()).map((p, i) => ({
    title: (p.title || `Passage ${i + 1}`).toString().trim(), text: (p.text || '').toString().trim(),
  }));
  if (!passages.length) passages.push({ title: 'Passage 1', text: '' });
  const validTypes = ['tfng', 'ynng', 'mcq', 'multi', 'match', 'gap'];
  const groups = (t.groups || []).map(g => {
    const questions = (g.questions || []).map(q => ({
      n: +q.n, text: (q.text || '').toString(),
      options: (q.options || []).map(o => ({ key: String(o.key).trim(), text: (o.text || '').toString() })),
      missing: !!q.missing,
    })).filter(q => q.n > 0).sort((a, b) => a.n - b.n);
    const from = +g.from || (questions[0]?.n ?? 0);
    const to = +g.to || (questions[questions.length - 1]?.n ?? 0);
    const label = TYPE_LABELS[g.label] ? g.label : (Object.keys(TYPE_LABELS).find(l => TYPE_LABELS[l] === g.type) || 'Short Answer');
    return {
      from, to,
      passage: Math.min(Math.max(+g.passage || 0, 0), passages.length - 1),
      type: validTypes.includes(g.type) ? g.type : TYPE_LABELS[label],
      label,
      instruction: (g.instruction || '').toString(),
      optionsTitle: (g.optionsTitle || '').toString(),
      options: (g.options || []).map(o => ({ key: String(o.key).trim(), text: (o.text || '').toString() })),
      questions,
      body: (g.body || '').toString(),
      inline: !!g.inline,
      wordLimit: g.wordLimit || wordLimitOf(g.instruction || ''),
    };
  }).filter(g => g.questions.length).sort((a, b) => a.from - b.from);
  const key = {};
  for (const [k, v] of Object.entries(t.key || {})) if (v != null && String(v).trim()) key[+k] = String(v).trim();
  return {
    title: (t.title || passages[0].title || 'Reading test').toString(),
    passages, groups, key, keyEstimated: !!t.keyEstimated, source: t.source || 'rule',
  };
}

export function allQuestions(test) {
  return test.groups.flatMap(g => g.questions.map(q => ({ ...q, group: g })));
}
