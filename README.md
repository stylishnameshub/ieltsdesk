# IELTSDesk

Paste any IELTS Academic Reading test and practise it like the real exam:
passage and questions side by side, a timer, highlighting, flags, a question
navigator, an estimated band score and mentor feedback with a 7-day plan.

## Files

```
index.html          the site
assets/style.css    design (light + dark theme)
assets/app.js       screens: paste, check, exam, result
assets/parser.js    reads pasted text into passages, question sets and answer key
assets/grade.js     marking, band estimate, mentor notes
assets/sample.js    the built-in sample test
api/parse.js        optional AI reader (Vercel serverless function)
```

No build step and no npm install needed.

## Deploy (GitHub + Vercel)

1. Create a new repository on GitHub (for example `ieltsdesk`).
2. Upload all these files to it (keep the folders as they are).
3. Go to vercel.com, sign in with GitHub, click **Add New → Project**, pick the repo.
4. Framework preset: **Other**. Leave build settings empty. Click **Deploy**.
5. Optional, for the "Build with AI" button: in Vercel open
   **Project → Settings → Environment Variables** and add
   `ANTHROPIC_API_KEY` = your key from console.anthropic.com. Redeploy.
   You can also set `ANTHROPIC_MODEL` to change the model.

Without the API key the site still works with the standard reader;
the AI button simply stays hidden.

## Run locally

```
python3 -m http.server 8000
```
Then open http://localhost:8000
