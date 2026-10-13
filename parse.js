// Vercel serverless function: turns pasted test text into structured JSON with Claude.
// Set ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables.
// Optional: ANTHROPIC_MODEL (defaults to a fast, low-cost model).

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const MAX_CHARS = 60000;

const SYSTEM = `You convert a pasted IELTS Academic Reading test into JSON. Output ONLY valid JSON, no prose, no code fences.

Schema:
{
  "title": string,
  "passages": [{ "title": string, "text": string }],
  "groups": [{
    "from": number, "to": number,
    "passage": number,               // 0-based index of the passage these questions belong to
    "type": "tfng" | "ynng" | "mcq" | "multi" | "match" | "gap",
    "label": one of ["True / False / Not Given","Yes / No / Not Given","Multiple Choice","Multiple Choice (choose more than one)","Matching Headings","Matching Information","Matching Features","Matching Sentence Endings","Summary Completion (word box)","Summary Completion","Sentence Completion","Note Completion","Table Completion","Flow-chart Completion","Diagram Labelling","Short Answer"],
    "instruction": string,           // the instructions exactly as written
    "optionsTitle": string,          // e.g. "List of Headings", or ""
    "options": [{ "key": string, "text": string }],   // shared options (headings i-x, people A-E, endings A-G, word box A-L, paragraph letters)
    "body": string,                  // summary/notes/table text with gaps shown as "(14) ____", or ""
    "wordLimit": number | null,
    "questions": [{ "n": number, "text": string, "options": [{ "key": string, "text": string }] }]
  }],
  "key": { "1": "TRUE", "2": "iv", "10": "food production" },
  "keyEstimated": boolean
}

Rules:
- Keep passage text word for word. Separate paragraphs with a blank line. If paragraphs are lettered, start each paragraph with its letter on its own line followed by a newline.
- mcq: each question has its own options A-D. multi: "choose TWO/THREE letters" sets; list the shared options in "options" and one question per number.
- match: answers are option keys from the shared "options". For "which paragraph contains" questions, options are the paragraph letters with text "Paragraph X".
- gap: answers are words typed by the student. For gaps inside a summary/notes/table, put that text in "body" and make each question's text the sentence around the gap with "____".
- Keys for multi questions: give one letter per question number.
- If an answer key is included in the paste or provided separately, use it exactly (keep alternatives like "crop / crops") and set keyEstimated false.
- If no answer key is given, work out the answers from the passage yourself and set keyEstimated true.`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    return res.status(200).json({ ai: !!process.env.ANTHROPIC_API_KEY });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI parsing is not set up on this site.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = (body?.text || '').toString();
  const key = (body?.key || '').toString();
  if (text.trim().length < 200) return res.status(400).json({ error: 'The pasted test is too short.' });
  if (text.length + key.length > MAX_CHARS) return res.status(413).json({ error: 'The pasted test is too long. Paste one full test at a time.' });

  const userMsg = `TEST TEXT:\n"""\n${text}\n"""\n\nSEPARATE ANSWER KEY (may be empty):\n"""\n${key}\n"""`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'The AI service returned an error.' });
    const out = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const start = out.indexOf('{');
    const end = out.lastIndexOf('}');
    if (start < 0 || end < 0) return res.status(502).json({ error: 'The AI did not return a test. Try the standard parser.' });
    const test = JSON.parse(out.slice(start, end + 1));
    test.source = 'ai';
    return res.status(200).json({ test });
  } catch (e) {
    return res.status(500).json({ error: 'Could not read the test with AI. Try the standard parser.' });
  }
}
