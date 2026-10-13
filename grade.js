// IELTSDesk — marking, band estimate and mentor feedback.

export function norm(s) {
  return (s || '').toString().toLowerCase()
    .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'\- ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function canonChoice(s, type) {
  const t = norm(s);
  if (type === 'tfng') {
    if (/^(true|t)\b/.test(t)) return 'TRUE';
    if (/^(false|f)\b/.test(t)) return 'FALSE';
    if (/^(not given|ng|not|n g)\b/.test(t)) return 'NOT GIVEN';
    return t.toUpperCase();
  }
  if (type === 'ynng') {
    if (/^(yes|y)\b/.test(t)) return 'YES';
    if (/^(not given|ng|not)\b/.test(t)) return 'NOT GIVEN';
    if (/^(no|n)\b/.test(t)) return 'NO';
    return t.toUpperCase();
  }
  return (t.split(' ')[0] || '').toLowerCase();
}

function gapVariants(keyAns) {
  return keyAns.split(/\s*\/\s*|\s+OR\s+|\s*\|\s*/i).flatMap(a => [
    a.replace(/[()]/g, ''), a.replace(/\([^)]*\)/g, ''),
  ]).map(norm).filter(Boolean);
}

export function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export function bandFor(correct, total) {
  if (!total) return null;
  const raw = Math.round((correct / total) * 40);
  const table = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1]];
  for (const [min, band] of table) if (raw >= min) return { band, raw };
  return { band: 0, raw };
}

export function rawNeededFor(band) {
  const t = { 9: 39, 8.5: 37, 8: 35, 7.5: 33, 7: 30, 6.5: 27, 6: 23, 5.5: 19, 5: 15, 4.5: 13, 4: 10 };
  return t[band];
}

const wordCount = s => norm(s).split(' ').filter(w => w && !/^\d+$/.test(w)).length;

// returns per-question results
export function gradeTest(test, answers) {
  const rows = [];
  for (const g of test.groups) {
    if (g.type === 'multi') {
      const keySet = new Set(g.questions.map(q => canonChoice(test.key[q.n] || '', 'mcq')).filter(Boolean));
      const used = new Set();
      for (const q of g.questions) {
        const user = answers[q.n] || '';
        const u = canonChoice(user, 'mcq');
        const hasKey = keySet.size > 0;
        let ok = null;
        if (hasKey) { ok = !!u && keySet.has(u) && !used.has(u); if (ok) used.add(u); }
        rows.push({ n: q.n, group: g, user, key: test.key[q.n] || '', ok, hasKey });
      }
      continue;
    }
    for (const q of g.questions) {
      const user = (answers[q.n] || '').toString();
      const key = test.key[q.n] || '';
      const row = { n: q.n, group: g, user, key, hasKey: !!key, ok: null };
      if (key) {
        if (g.type === 'gap') {
          const u = norm(user);
          const vars = gapVariants(key);
          row.ok = !!u && vars.includes(u);
          if (!row.ok && u) {
            row.nearMiss = vars.some(v => v.length > 3 && lev(u, v) <= (v.length > 7 ? 2 : 1));
            if (g.wordLimit && wordCount(user) > g.wordLimit) row.overLimit = true;
            row.partial = vars.some(v => v.includes(u) || u.includes(v));
          }
        } else {
          const u = canonChoice(user, g.type);
          const k = canonChoice(key, g.type);
          const alts = key.split(/\s*\/\s*|\s+or\s+/i).map(x => canonChoice(x, g.type));
          row.ok = !!u && (u === k || alts.includes(u));
          row.userCanon = u; row.keyCanon = k;
        }
      }
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.n - b.n);
}

// ---------- mentor feedback ----------
const TYPE_ADVICE = {
  'True / False / Not Given': 'Break each statement into subject, action and qualifier (all, some, only, always, first). Find the matching sentence and compare only with that sentence. FALSE means the passage says the opposite. NOT GIVEN means it says nothing about that exact point.',
  'Yes / No / Not Given': 'These test the writer\'s opinion, not facts. Look for opinion signals such as argues, suggests, it seems, unfortunately. If the writer gives no view on that exact claim, it is NOT GIVEN.',
  'Matching Headings': 'Read the first and last sentence of each paragraph and write a 3-4 word summary before looking at the list. The heading must cover the whole paragraph. Reject headings that match only one word or an example.',
  'Matching Information': 'Underline the type of information asked for (an example, a reason, a comparison, a prediction). Leave this type until the end of the passage, once you know where things are. One paragraph can be used more than once.',
  'Matching Features': 'Circle every name or date in the passage first. Then read the sentences around each one and match by meaning, not by repeated words.',
  'Matching Sentence Endings': 'Cut the options by grammar first: an ending that does not fit the sentence grammatically cannot be right. Then check meaning against the passage.',
  'Summary Completion (word box)': 'Answers in a word box are almost always synonyms of the passage words, not the same words. Decide the word class (noun, verb, adjective) of each gap before reading the box.',
  'Summary Completion': 'Find where the summary starts in the passage, as it usually covers one section in order. Predict the word class for each gap, then copy the exact word with the exact spelling.',
  'Sentence Completion': 'Predict what kind of word fits the gap, find the paraphrased sentence, and copy the word exactly from the passage. Check the word limit every time.',
  'Note Completion': 'Notes follow the passage order. Use the headings in the notes to find the right section quickly.',
  'Table Completion': 'Read the column and row headings first. They tell you exactly which part of the passage to scan.',
  'Flow-chart Completion': 'Flow-charts describe a process in order. Find the first step in the passage and move forward line by line.',
  'Diagram Labelling': 'All labels come from one section of the passage. Pay attention to position words: above, below, attached to, inside.',
  'Short Answer': 'The question word tells you the answer type: who = person, when = time, how many = number. Respect the word limit and copy spelling from the passage.',
  'Multiple Choice': 'Read the question stem first and find its line in the passage. Then rule out options one by one. Watch for options that reuse passage words but change the meaning.',
  'Multiple Choice (choose more than one)': 'Treat each option as a TRUE/FALSE statement. The order of your letters does not matter, but each letter can only be used once.',
};

const fmt = s => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;

export function buildReport(test, answers, timing) {
  const rows = gradeTest(test, answers);
  const keyed = rows.filter(r => r.hasKey);
  const correct = keyed.filter(r => r.ok).length;
  const total = keyed.length;
  const band = bandFor(correct, total);
  const blanks = rows.filter(r => !String(r.user).trim()).length;

  // breakdown by question type
  const byType = {};
  for (const r of keyed) {
    const l = r.group.label;
    byType[l] = byType[l] || { label: l, correct: 0, total: 0 };
    byType[l].total++; if (r.ok) byType[l].correct++;
  }
  const types = Object.values(byType).map(t => ({ ...t, pct: t.total ? t.correct / t.total : 0 })).sort((a, b) => a.pct - b.pct);

  // by passage
  const byPassage = test.passages.map((p, i) => {
    const pr = keyed.filter(r => r.group.passage === i);
    return { title: p.title, correct: pr.filter(r => r.ok).length, total: pr.length, seconds: timing.passageSeconds?.[i] || 0 };
  });

  const tips = [];
  const push = (priority, title, body) => tips.push({ priority, title, body });

  // NG confusion
  const tfRows = keyed.filter(r => (r.group.type === 'tfng' || r.group.type === 'ynng') && !r.ok && r.user);
  const ngAsFalse = tfRows.filter(r => r.keyCanon === 'NOT GIVEN' && (r.userCanon === 'FALSE' || r.userCanon === 'NO')).length;
  const falseAsNg = tfRows.filter(r => (r.keyCanon === 'FALSE' || r.keyCanon === 'NO') && r.userCanon === 'NOT GIVEN').length;
  if (ngAsFalse >= 1) push(9, `You marked ${ngAsFalse} NOT GIVEN answer${ngAsFalse > 1 ? 's' : ''} as FALSE/NO`, 'This is the most common TFNG mistake. Before you write FALSE, point to the exact words in the passage that say the opposite. If you cannot point to them, the answer is NOT GIVEN. Do not use your own knowledge to fill the gap.');
  if (falseAsNg >= 1) push(8, `You marked ${falseAsNg} FALSE/NO answer${falseAsNg > 1 ? 's' : ''} as NOT GIVEN`, 'The passage did contradict these statements, but in different words. Watch for paraphrased opposites: increase vs decline, few vs many, cheap vs costly, rarely vs often.');

  const near = keyed.filter(r => r.nearMiss).length;
  if (near) push(8, `${near} answer${near > 1 ? 's were' : ' was'} marked wrong for spelling`, 'Your idea was right but the spelling was not. In the real exam a misspelled word scores zero. Copy words letter by letter from the passage and check plurals (crop vs crops).');
  const over = keyed.filter(r => r.overLimit).length;
  if (over) push(8, `${over} answer${over > 1 ? 's' : ''} went over the word limit`, 'Read the limit before each gap-fill set. "NO MORE THAN TWO WORDS" means one or two words only. Extra words make the whole answer wrong, even if the right word is inside.');
  const partial = keyed.filter(r => r.partial && !r.nearMiss && !r.overLimit).length;
  if (partial) push(6, `${partial} gap answer${partial > 1 ? 's were' : ' was'} close but incomplete`, 'You found the right place in the passage but copied too little or too much. Read the full sentence with your answer in it: it must be grammatically correct.');

  if (blanks) push(7, `${blanks} question${blanks > 1 ? 's were' : ' was'} left blank`, 'There is no negative marking in IELTS. Never leave a blank. If time is running out, make an educated guess: for TFNG pick NOT GIVEN, for matching use letters you have not used yet.');

  // timing
  const targets = test.passages.length === 3 ? [17, 20, 23] : null;
  if (targets) byPassage.forEach((p, i) => {
    const min = p.seconds / 60;
    if (min > targets[i] + 4) push(7, `Passage ${i + 1} took ${fmt(p.seconds)}`, `Aim for about ${targets[i]} minutes on Passage ${i + 1}. When a question takes more than 90 seconds, guess, flag it and move on. Come back only if time is left.`);
  });
  if (timing.autoSubmitted) push(9, 'Time ran out before you submitted', 'Your timing plan needs work. Skim each passage for 2-3 minutes only, and keep an eye on the clock at the end of every passage: 17, 37 and 60 minutes.');
  else if (timing.used < 35 * 60 && band && band.band < 7 && test.passages.length >= 3) push(5, `You finished in ${fmt(timing.used)}`, 'You had time left. Use it: go back to flagged questions and re-check TFNG and gap-fill answers against the passage.');

  // weakest types
  types.filter(t => t.pct < 0.7 && t.total >= 2).slice(0, 3).forEach(t => {
    push(6 + (1 - t.pct) * 2, `Work on ${t.label} (${t.correct}/${t.total})`, TYPE_ADVICE[t.label] || 'Practise this question type on its own for a few days before mixing it with others.');
  });

  tips.sort((a, b) => b.priority - a.priority);

  const strengths = types.filter(t => t.pct >= 0.8 && t.total >= 2).map(t => t.label);

  // next goal
  let goal = null;
  if (band && total) {
    const targetBand = band.band >= 9 ? null : [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9].find(b => b > band.band);
    if (targetBand) {
      const need = rawNeededFor(targetBand);
      const extra = Math.max(1, Math.ceil(need * total / 40) - correct);
      goal = { targetBand, extra };
    }
  }

  // 7-day plan
  const weak = types.filter(t => t.pct < 0.8).map(t => t.label);
  const focus = weak.length ? weak : ['Matching Headings', 'True / False / Not Given'];
  const plan = [
    { day: 'Day 1', task: `${focus[0]}: do 2 sets on their own, untimed. Write why each wrong answer was wrong.` },
    { day: 'Day 2', task: `${focus[1] || focus[0]}: 2 sets, timed at 90 seconds per question.` },
    { day: 'Day 3', task: 'Paraphrase day: from one passage, list 15 word pairs where the question and passage used different words.' },
    { day: 'Day 4', task: `${focus[2] || focus[0]}: 2 sets, then re-do yesterday's mistakes.` },
    { day: 'Day 5', task: 'One full passage in 20 minutes with the skim-label-scan method.' },
    { day: 'Day 6', task: 'Full 60-minute test on IELTSDesk in exam mode.' },
    { day: 'Day 7', task: 'Review: compare this report with the new one and add every new mistake to your notebook.' },
  ];

  return { rows, correct, total, band, blanks, types, byPassage, tips, strengths, goal, plan, timing, keyMissing: rows.length - keyed.length, questionCount: rows.length };
}

export { fmt as formatDuration };
