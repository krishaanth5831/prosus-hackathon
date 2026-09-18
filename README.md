# prosus-hackathon

Team of 5. Idea TBD — this repo currently holds **how we work**, not what we build.
The code structure gets generated on day 1 once we pick the idea (see `docs/SETUP_PROMPT.md`).

---

## Quick start (read this before you write a line of code)

```bash
git clone git@github.com:krishaanth5831/prosus-hackathon.git
cd prosus-hackathon
cp .env.example .env     # ask Krish for the real values
```

Then: **claim a task on the board before you start it.** Nothing else in this README matters as much as that line.

---

## Branches

Two permanent branches. Everything else is temporary.

| Branch | What it is | Rules |
|---|---|---|
| `main` | Always-working code. What we demo from. | Protected. PR only, Krish approves. No force-push. No direct commits. |
| `dev` | Integration branch. Default branch — PRs land here. | No force-push, no deletion. Should be working most of the time. |
| `name/feature` | Your work. Lives **hours, not days**. | Delete after merge. |

### The loop

```bash
git switch dev && git pull            # before EVERY task, not once a day
git switch -c krish/checkout-flow     # your-name/what-it-does

# ...build for 2-4 hours...

git push -u origin krish/checkout-flow
# open PR into dev -> someone skims it -> merge -> delete branch

git switch dev && git pull            # immediately, so you're never stale
```

If your branch has been open more than ~2 hours, pull `dev` into it. Conflicts compound —
three small merges are far cheaper than one big one at hour 40.

### dev -> main

**Every time the demo works end to end, merge `dev` into `main` and tag it.**

```bash
# PR dev -> main, Krish approves, merge. Then:
git switch main && git pull
git tag demo-v1 && git push --tags
```

This is the rule that keeps `main` honest. The failure mode of a two-branch model is
everything living on `dev` while `main` quietly rots back to the day-1 skeleton — at which
point "main always works" is a comforting lie. Tag every working state; if someone breaks
things at hour 47, we present the tag.

### Hard rules

- **Never force-push `main` or `dev`.** (Blocked server-side for everyone except Krish.)
- **Never rewrite history on a branch someone else has pulled.**
- **Nothing reaches `main` without Krish's approval.**
- If a branch can't merge within a day, it was scoped wrong — split it or merge it half-done behind a flag.

---

## Code structure: vertical slices

Once we pick the idea, we organise **by feature, not by layer**:

```
src/
  features/
    auth/          # UI + API calls + types for auth, all together
    <feature>/
    <feature>/
  shared/          # only things genuinely used by 3+ features
  lib/             # api client, db client, config
```

Why: layer-based folders (`components/`, `services/`, `utils/`) force all 5 of us into the
same files all weekend. Feature folders mean a task **is** a folder — you live in
`features/checkout/` for three hours and touch nothing anyone else is in. We get
collision-free work without permanently assigning anyone an area.

**Colocate aggressively.** Component, hook, styles, API call and types for a feature stay in
its folder. Duplication between features is fine at hackathon scale — a premature `shared/`
abstraction drags everyone back into the same files, which is the exact thing we're avoiding.

---

## Hot files (where conflicts actually happen)

Feature folders kill ~90% of conflicts. The rest land in these, so handle them deliberately:

| File | Rule |
|---|---|
| Router / route registry | Keep it one line per feature. **Append at the end**, never edit the middle. |
| DB schema / migrations | **Krish owns it.** Never edit a merged migration — add a new file. |
| Shared types / API contract | **Krish owns it.** Every change gets announced out loud. |
| `package.json` / lockfiles | Whoever adds a dep says so and merges within minutes. Don't hand-resolve a lockfile — take the base version and re-run install. |
| App entry / env config | Touch it, announce it, merge it fast. |

Silent breakage comes from the type/schema files: git merges a renamed field perfectly
cleanly and the app is broken at runtime. That's why they have one owner.

---

## Workflow

**The board is the source of truth.** GitHub Projects / Notion / whiteboard — doesn't matter,
as long as everyone can see it.

- **Nothing is worked on until it's on the board with your name on it.** Two people silently
  building the same thing costs more than any merge conflict.
- **Tasks are 2-4 hours and vertical:** "checkout flow end to end with fake payment", not
  "write the checkout service". Slice-shaped tasks map onto feature folders; layer-shaped ones don't.
- **Say it in the room:** *"I'm in `features/map` and the router for the next two hours."*
  One sentence prevents most collisions.
- **Review is a 2-minute skim**, not a code review: does it run, does it delete anyone's work.
  No PR sits longer than ~15 minutes — poke people out loud, don't wait on notifications.

### Roles

- **Integrator (Krish)** — owns `main`, shared types, schema, deploy, and the ugly conflicts.
- **Demo owner** — from the halfway point, their job is the 3-minute presentation, not features.
  Hackathons are won by the demo; teams that leave it to the last hour lose to worse code with a better story.
- **Everyone else** — build. Pair up on the two hardest tracks; 5 people is rarely 5 real workstreams.

### Cadence

- **Sync every ~4 hours, 2 minutes, standing:** what's merged / what you're on / what's blocking you.
- **Feature freeze ~4 hours before submission.** Bug fixes only after that.
- **Practice the demo twice on the deployed URL**, not localhost.

---

## Day 1 checklist

Before anyone writes a feature:

- [ ] Pick the idea, then run the prompt in `docs/SETUP_PROMPT.md` to generate the structure
- [ ] Push a **skeleton that runs** — empty pages, `/health` returning 200, hardcoded fake data.
      Everyone should clone something that already starts.
- [ ] **Lock the API contract** — endpoints + request/response JSON, written down. Frontend builds
      against mocks, backend fills them in, neither waits on the other.
- [ ] Fill `.env.example` with every key anyone needs
- [ ] Everyone runs the app locally and confirms it starts
- [ ] Board created, first ~10 tasks sliced

## Before the hackathon

Install the stack and run a hello-world **this week**. Wrong runtime version, missing
CUDA, an API key nobody has — environment setup routinely eats the first 3 hours of a
hackathon and is entirely preventable now.

---

## Docs

- `docs/SETUP_PROMPT.md` — the one prompt to run once we pick the idea
- `docs/DECISIONS.md` — one-liners: "we picked X over Y because Z"
