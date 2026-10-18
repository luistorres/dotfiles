# User-level directives (apply to every project)

> Installed from ~/dotfiles/claude/CLAUDE.md. Edit that file and re-run ~/dotfiles/claude/install.sh; changes made to the installed copy are overwritten by the next install.

## RULE #0 — Do not write comments. Earn each one.

**Default to ZERO comments. A comment is an exception that must justify itself.** I have corrected
this repeatedly across sessions; treat it as the highest-priority style rule, above any habit.

Write a comment ONLY for: a non-obvious WHY, an invariant, a gotcha/footgun, security-critical
reasoning, or an external-API quirk. If a reader could work it out from the code, there is no comment.

NEVER write:
- Narration of what the line does — `// set the status to sent`, `// loop over the rows`,
  `// the provider's id for this send` above `providerId: x`.
- Restating an assertion in a test above that assertion.
- Repeating in a call site what a type/schema/doc comment already says. Say it ONCE, at its home.
- Provenance stamps on declarations (issue numbers, plan/ticket refs, "(ADR NNN)" on everything).
- A banner//section-divider comment for code that is already short and readable.

Before writing any comment, ask: *"Does this say something the code cannot?"* If no — delete it.
Before keeping an existing comment you are editing, re-ask the same question from zero: when the
stale part (a dead file ref, an outdated note) was the comment's only real content, **DELETE the
comment; do not reword it to keep it alive.**

Applies to code, tests, config, and generated-file edits alike.

## Dependencies: always install the latest stable version

Before adding a new package/dependency, scaffolding a tool, or bootstrapping anything new, ALWAYS check the current latest stable version from the live registry before pinning — never install a version number recalled from training data (it is months stale). Confirm the package isn't deprecated, renamed, or consolidated into another package.

- npm: `npm view <pkg> version`, `npm view <pkg> dist-tags`, `npm view <pkg> deprecated`
- PyPI / crates / others: use the registry equivalent
- Prefer the latest stable release. Only pin lower for a concrete, documented compatibility reason.
- When bootstrapping a new stack (create-* scaffolds, starter templates), verify the whole toolchain is current, not just one package — scaffolds pin stale versions too.

## Dependencies: implement from the current docs, not from memory

Checking the version is not enough — before USING a newly added package/framework/tool,
consult its current official docs for that exact major version (WebFetch the docs site or the
package README for the installed version) and implement per those docs:

- Never write integration/setup code recalled from training data or copied from an undated
  online example — APIs, config formats, and idioms drift between majors (e.g. Zod 3→4,
  Prisma 6→7, Tailwind 3→4, Biome 1→2).
- Verify the specific APIs/config you are about to use exist in the installed version; note
  the nuances (breaking changes, new recommended setup, deprecated options) before writing code.
- If docs and observed behavior disagree, trust observed behavior and say so.

No exceptions, any repo.

## RULE #1 — Length comes from what you leave out, not how you word it

**Cut content, don't compress prose.** Terse phrasing of the same volume is still a wall of text,
and it reads worse. If a response feels long, the fix is deleting whole points, not shortening
sentences.

**Lead with the outcome.** First sentence answers "what happened" or "what did you find" — the thing
I'd ask for if I said "just the TLDR". Supporting detail after, for the reader who wants it.

**The test for every line: does this change what I do next?** If no, cut it. That deletes, by default:

- Recaps of what you just did when I watched you do it, and closing summaries of a short answer.
- Options you considered and rejected. Give the recommendation; mention the alternative only if I
  might reasonably pick it.
- Restating my question back to me before answering it.
- Preamble about what you're *about* to explain. Just explain it.
- Caveats that don't change the decision. One sentence for a real limitation; none for a theoretical one.
- Re-explaining something already established earlier in the conversation.

**Formatting is content too.** A table needs 3+ rows and 2+ columns worth comparing — otherwise it's
a list. A header needs a section under it. Bold is for the one thing that matters in a paragraph, not
for every noun phrase; when everything is bold nothing is.

**Match depth to the question.** A yes/no question gets a yes or no, then the reason. "How do I X"
gets the command. Deep-dive only when asked, or when the short answer would be actively misleading.

Readability beats brevity where they conflict — write complete sentences, spell out terms, skip the
arrow chains and invented abbreviations. Being short is a result of selecting well, not of compressing.

## GitHub: edit PRs/issues via the REST API, not `gh pr edit`/`gh issue edit`

`gh pr edit` and `gh issue edit` trigger a deprecated Projects-classic GraphQL query
(`repository.pullRequest.projectCards`) that errors and **silently aborts the edit before the
title/body change is applied** — the command appears to run but nothing changes. To update a PR
or issue title/description, use the REST API, which avoids that GraphQL path:

```bash
# PR title/body
gh api repos/{owner}/{repo}/pulls/{number} -X PATCH -f title="…" -F body=@<file>
# issue title/body
gh api repos/{owner}/{repo}/issues/{number} -X PATCH -f title="…" -F body=@<file>
```

Read multi-line bodies from a file with `-F body=@<path>` (a heredoc into a scratch file). After
editing, verify with `gh pr view <n> --json title,body`. `gh pr create` and `gh pr view --json`
are unaffected — this workaround is only for **edits**.
