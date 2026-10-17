---
name: mistral-review
description: Run a second-opinion code or design review using Mistral's `vibe` CLI (default model `mistral-medium-3.5`, thinking=high) — a different model with different blind spots. Use this whenever the user says "mistral review", "vibe review", "review with mistral", "use mistral", asks for "mistral's take". Also the reference for driving the Mistral `vibe` CLI headlessly and read-only in general.
---

# Mistral `vibe` review

Drive Mistral's `vibe` CLI headlessly in read-only mode to get an independent review of a diff or design doc. Vibe's verdict is one more opinion — surface disagreements rather than silently adopting them. In practice vibe corroborates more than it originates (it is the weakest of codex/cursor/opus/vibe) and can be too lenient, so weight any disagreement toward the stronger reviewers.

## Prerequisites

- `vibe` CLI on PATH. Check with `which vibe`. If missing, tell the user to install Mistral Vibe themselves; don't try to install it.
- User must already be authenticated (an API key in `~/.vibe/.env` / `MISTRAL_API_KEY`). If a run fails on auth, ask the user to run `vibe --setup` themselves.
- Config lives at `~/.vibe/config.toml` (active model + per-tool permissions). Default `active_model = mistral-medium-3.5` (thinking=high). Builtin agents: `default`, `plan`, `accept-edits`, `auto-approve`.

## Read-only guarantee (why this is safe)

You do **not** need a sandbox flag. Vibe's config enforces read-only when you don't pass `--auto-approve`:

- `read` and `grep` tools: permission `always` → auto-run.
- `bash`: gated to a read-only allowlist (`git diff`, `git log`, `git status`, `cat`, `ls`, `grep`, `head`, `wc`, …) with `python`/`bash`/`sh`/interactive-shells denied; there's an applied `bash_read_only_defaults_v1` migration.
- `edit` and `write_file`: permission `ask` → in programmatic `-p` mode there is no TTY to approve, so **they are unreachable** and vibe cannot modify the repo.

NEVER pass `--auto-approve` for a review — it approves every tool call (including non-allowlisted bash and writes), defeating the read-only guarantee.

## Running the review

```
vibe -p "$(< /tmp/vibe-brief.txt)" --agent default --trust --output text \
  --max-turns 60 --max-price 3.00 --max-tokens 3000000 \
  > /tmp/vibe-review.log 2>&1
```

Run it with `run_in_background: true` (like codex/cursor) and read the log when it completes.

Why each flag:
- `-p "<brief>"` — programmatic mode: send prompt, print response, exit (no interactive TUI). For a long brief, write it to a file and pass `"$(< /tmp/vibe-brief.txt)"`.
- `--agent default` — read-only by config (see above). Don't use `plan` (it tends to call `exit_plan_mode` instead of writing a review) or `auto-approve`/`accept-edits` for a plain review.
- `--trust` — trust the working dir for this run (non-interactive; skips the trust prompt). Mandatory for automation.
- `--output text` — emit only the final answer, NOT the tool transcript, so the redirect file is findings-only (you consume just the useful tokens). `json`/`streaming` exist if you need structured messages.
- `--max-price 3.00` — the real guard. mistral-medium is cheap ($1.5/$7.5 per Mtok); $3 is generous headroom for a substantive review.
- `--max-turns 60` — see the caveat below; give it plenty.
- `--max-tokens 3000000` — keep it HIGH. A from-scratch deep read can exceed 500k cumulative tokens; a low cap kills the run before it writes (observed failing at a 500k cap).

## Critical caveat — vibe is far less turn-efficient than codex/cursor

Each grep/read is one turn, so an open-ended brief makes it explore until it hits the turn or token limit and **never writes the review** (the log ends with a `<vibe_stop_event>` and no findings). Mitigate every time:

1. **Put a hard tool-call budget in the brief**, e.g.: "You have a budget of ~15 tool calls. Gather efficiently, then STOP gathering and WRITE the review even if a check is incomplete (note any you couldn't finish). The review text is the deliverable; tool calls that don't end in a written review are wasted."
2. **Point it at the small thing first** — `git diff <base>..HEAD` or a specific diff file — not "read all the files."
3. Give generous `--max-turns` (≥60) and let `--max-price` be the bound.

## Building the brief

Same shape as the codex/cursor briefs: where to look, the goal/approach, and what to flag — plus the tool-call budget above. Keep it focused; list the few highest-value things to verify rather than an exhaustive checklist (fewer mandatory checks = fewer turns = it actually finishes).

## Optional: write findings to a file

To guarantee clean structured output (or have vibe persist a findings file), add `--agent accept-edits --add-dir /tmp` and instruct it to write its review to `/tmp/vibe-findings.md` as its final action. `accept-edits` auto-accepts that file write while keeping bash on its read-only allowlist — safer than `--auto-approve`. (Usually unnecessary: `--output text` already gives findings-only output.)

## Reporting back

1. Don't paste raw output verbatim if long — summarize which findings are real, which are noise, which you're unsure about.
2. Flag disagreements explicitly: "Vibe flagged X, but I don't think it applies because Y." Don't silently adopt its conclusions.
3. Don't auto-apply suggestions — they're recommendations until the user approves.
4. `agents-review` substitutes `opencode-review` for a failed CLI reviewer, not this skill — run mistral only when the user asks for it by name.

## If a run fails (quick triage)

- Log is only `<vibe_stop_event>Turn limit ...` or `Token limit ...` → it ran out before writing. Tighten the brief's tool budget, raise `--max-turns`/`--max-tokens`, re-run.
- Hangs with no output → likely waiting on an approval-gated tool; confirm you used `--agent default` + `--trust` and didn't ask it to edit/write without the `accept-edits` variant.
- Auth/quota errors → surface to the user; don't silently retry.

## Costs

- Each run is a Mistral API call on the user's account, bounded by `--max-price`. mistral-medium-3.5 is inexpensive relative to codex/cursor.
- One more model, not an oracle — a peer review, useful and fallible.
