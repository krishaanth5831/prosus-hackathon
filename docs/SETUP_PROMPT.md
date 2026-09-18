# The one prompt

Once the idea is picked, open Claude Code in this repo and paste the block below,
filling in the four bracketed parts. Everything else is already decided and recorded
in the README — don't re-explain the workflow.

---

```
We picked the idea for the Prosus hackathon. Set up the repo structure.

IDEA: [one or two sentences — what it does, for whom]
STACK: [e.g. Next.js + FastAPI + Postgres, or "you pick, here are the constraints"]
FEATURES (the vertical slices): [3-6 feature names, e.g. auth, map-view, checkout, dashboard]
DEADLINE: [when the demo is]

Follow the branch model and vertical-slice structure already in README.md.
Build it on a branch and open a PR into dev — do not merge it.

I want:
1. Feature-based folder structure, one folder per feature above, colocated
   (component + hook + api call + types together). shared/ and lib/ as per the README.
2. A skeleton that actually RUNS: empty pages/routes per feature, a /health endpoint
   returning 200, hardcoded fake data. It must start with one command from a fresh clone.
3. The API contract written down — endpoints + request/response JSON for each feature,
   so frontend can build against mocks while backend fills them in.
4. .env.example updated with every key the stack needs.
5. README quick-start updated with the real setup + run commands (target: under 5 commands).
6. The router / entry point kept thin — one line per feature, appended at the end.
7. First ~10 tasks sliced as 2-4 hour vertical slices, written to docs/TASKS.md,
   each with a clear demo-visible "done".
```

---

## Why this works

The structure can't be generated now because the folder names *are* the feature names —
`features/checkout/` only exists if there's a checkout. Everything that doesn't depend on
the idea (branch model, protection, conventions, ignore rules, review rituals) is already done.
