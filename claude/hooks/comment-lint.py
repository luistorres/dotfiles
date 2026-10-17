#!/usr/bin/env python3
"""PostToolUse nudge for code comments: Write / Edit / MultiEdit.

Enforces RULE #0 in ~/.claude/CLAUDE.md. Lints ONLY the newly-added text, so
legacy files are not re-flagged every time they are touched.

Exit 0 = silent. Exit 2 = stderr goes back to Claude as feedback; the edit is
already applied, so this is a revise-it nudge, not a block.

Two tiers, on purpose:
  - exit 2  for mechanical, high-precision violations (provenance stamps,
            banner dividers, test-assertion restatement, emphasis)
  - advisory for fuzzy heuristics (narration, long runs) -- these reach the
            model as context without forcing a revise cycle on a false positive

Fails open on anything it cannot parse.
"""
import json
import os
import re
import sys

MAX_COMMENT_RUN = 4

CODE_EXT = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".sol",
    ".sh", ".bash", ".zsh", ".c", ".h", ".cc", ".cpp", ".hpp", ".java", ".kt",
    ".rb", ".lua", ".zig", ".nix", ".swift", ".php", ".cs", ".scala", ".ex",
    ".exs", ".erl", ".hs", ".ml", ".dart", ".vue", ".svelte",
}

# In a hash-comment language a `//` or `*` line is almost always a string literal
# holding code for another language; linting it flags text the edit is deleting.
HASH_ONLY_EXT = {".py", ".sh", ".bash", ".zsh", ".rb", ".ex", ".exs", ".nix"}

COMMENT_RE = re.compile(r"^\s*(//+|#+|/\*+|\*+/?|--|;;?)\s?(.*)$")
HASH_RE = re.compile(r"^\s*(#+)\s?(.*)$")

TEST_PATH_RE = re.compile(r"(^|[./_-])(tests?|specs?)([./_-]|$)|\.(test|spec)\.|_test\.|^test_", re.I)
ASSERT_RE = re.compile(r"\b(expect|assert|assert_eq|assertEquals|should|must|require)\s*[(!.]|\.to(Be|Equal|Have|Throw)")

# Provenance stamps: ticket refs, plan pointers, ADR numbers on a declaration.
PROVENANCE = [
    (r"\b(ADR)[- ]?\d+", "ADR reference stamped on code"),
    (r"\b[A-Z]{2,6}-\d+\b", "ticket ID stamped on code"),
    (r"\b(per|see|from|ref|refs|closes|fixes)\s+(the\s+)?(ticket|issue|plan|spec|jira|linear|pr)\b", "ticket/plan pointer"),
    (r"\bissue\s*#\d+", "issue number stamped on code"),
    (r"\bas (decided|agreed|discussed) (in|on)\b", "decision provenance"),
]

# Design rationale and history: git log and docs/ own these.
DOC_IN_SOURCE = [
    (r"\brejected alternative", "rejected alternatives belong in docs/ or an ADR"),
    (r"\balternatives?\s+(considered|rejected)", "alternatives belong in docs/ or an ADR"),
    (r"\bit used to\b", "history belongs in the commit message"),
    (r"\bused to (say|be|read|return|live|call)\b", "history belongs in the commit message"),
    (r"\bpreviously[, ]+(this|it|we|the)\b", "history belongs in the commit message"),
    (r"\b(originally|historically)\b", "history belongs in the commit message"),
    (r"\bwe (chose|picked|went with|settled on)\b", "rationale belongs in docs/ or an ADR"),
]

# A line that points at the doc is the fix the rule asks for, not a violation of it.
CITES_DOC = re.compile(r"docs?/|\.md\b|\bsee `", re.I)

BANNER_RE = re.compile(r"(.)\1{4,}\s*$|^\s*[=*~#-]{5,}")
REGION_RE = re.compile(r"^\s*(#|//)?\s*(region|endregion|MARK:|pragma mark)", re.I)

STOPWORDS = {
    "a", "an", "the", "to", "of", "in", "on", "for", "and", "or", "is", "it",
    "this", "that", "we", "then", "with", "from", "into", "by", "as", "at",
    "if", "so", "be", "are", "was", "our", "its", "all", "each", "here",
}


def fail_open(msg=""):
    if msg and os.environ.get("COMMENT_LINT_DEBUG"):
        print(f"comment-lint: {msg}", file=sys.stderr)
    sys.exit(0)


def added_text(tool_input):
    """Text this edit introduced, or None if there is nothing to lint."""
    if "content" in tool_input:
        return tool_input["content"]
    if "new_string" in tool_input:
        return tool_input["new_string"]
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        parts = [e.get("new_string", "") for e in edits if isinstance(e, dict)]
        return "\n".join(parts) if parts else None
    return None


def words(text):
    """Identifier-aware word split: camelCase, snake_case, kebab-case."""
    out = []
    for tok in re.findall(r"[A-Za-z][A-Za-z0-9]*", text):
        parts = re.findall(r"[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+", tok)
        out.extend(p.lower() for p in parts)
    return [w for w in out if w not in STOPWORDS and len(w) > 1]


def parse(text, ext):
    """([(index, body)], {index: raw_line}) for lines that are wholly a comment."""
    pattern = HASH_RE if ext in HASH_ONLY_EXT else COMMENT_RE
    raw = text.splitlines()
    out = []
    for i, line in enumerate(raw):
        m = pattern.match(line)
        if m and line.strip() not in ("*/", "/*"):
            out.append((i, m.group(2)))
    return out, raw


def next_code_line(raw, idx, comment_indices):
    for j in range(idx + 1, min(idx + 3, len(raw))):
        if j in comment_indices:
            continue
        if raw[j].strip():
            return raw[j]
    return ""


def longest_run(indices):
    best = run = 0
    prev = None
    for i in indices:
        run = run + 1 if prev is not None and i == prev + 1 else 1
        best = max(best, run)
        prev = i
    return best


def lint(text, ext, path):
    """(problems, notes). Problems demand a revise; notes are advisory only."""
    lines, raw = parse(text, ext)
    if not lines:
        return [], []

    problems, notes = [], []
    comment_indices = {i for i, _ in lines}
    blob = "\n".join(body for _, body in lines)
    lowered = blob.lower()
    is_test = bool(TEST_PATH_RE.search(path))

    prose = "\n".join(body for _, body in lines if not CITES_DOC.search(body))
    seen = set()
    for pattern, advice in PROVENANCE + DOC_IN_SOURCE:
        m = re.search(pattern, prose, re.I)
        if m and advice not in seen:
            seen.add(advice)
            problems.append(f'"{m.group(0).strip()}" — {advice}. Cite the path instead, or cut it.')

    for i, body in lines:
        if not body.strip():
            continue
        if BANNER_RE.search(body) or REGION_RE.match(raw[i]):
            problems.append(f'Banner/divider comment: "{body.strip()[:50]}". Delete it.')
            break

    if "**" in blob or re.search(r"(?<!\w)_[A-Za-z][^_]{2,}_(?!\w)", blob):
        problems.append("Emphasis inside a comment. No bold or italics in comments.")

    narrations = []
    for i, body in lines:
        cw = words(body)
        if not cw or len(cw) > 8:
            continue
        code = next_code_line(raw, i, comment_indices)
        if not code.strip():
            continue
        if is_test and ASSERT_RE.search(code):
            problems.append(
                f'"{body.strip()[:50]}" restates the assertion below it. '
                "RULE #0: never restate an assertion in a test."
            )
            break
        kw = set(words(code))
        if kw and sum(1 for w in cw if w in kw) / len(cw) >= 0.6:
            narrations.append(body.strip()[:50])

    if narrations:
        notes.append(
            f'{len(narrations)} comment(s) look like narration of the code below '
            f'(e.g. "{narrations[0]}"). RULE #0 default is ZERO comments — delete '
            "unless it carries a non-obvious WHY, an invariant, a footgun, "
            "security reasoning, or an external-API quirk."
        )

    run = longest_run(sorted(comment_indices))
    if run > MAX_COMMENT_RUN:
        notes.append(
            f"{run}-line comment block just written. Fine only if it is a landmine "
            "that needs the mechanism spelled out; otherwise move the substance to "
            "docs/ and leave a path."
        )

    return problems, notes


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        fail_open("unparseable payload")

    if payload.get("tool_name") not in ("Write", "Edit", "MultiEdit"):
        fail_open()

    tool_input = payload.get("tool_input", {})
    path = tool_input.get("file_path", "")
    ext = os.path.splitext(path)[1]
    if ext not in CODE_EXT:
        fail_open(f"not a code file: {path}")

    text = added_text(tool_input)
    if not text:
        fail_open("no added text")

    try:
        problems, notes = lint(text, ext, path)
    except Exception as e:
        fail_open(f"lint error: {e}")

    name = os.path.basename(path)

    if problems:
        out = [f"RULE #0 (~/.claude/CLAUDE.md) — {name}:", ""]
        out += [f"  - {p}" for p in problems + notes]
        out += ["", "Delete what you just wrote, or say why it earns its place."]
        print("\n".join(out), file=sys.stderr)
        sys.exit(2)

    if notes:
        print(json.dumps({
            "suppressOutput": True,
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f"Comment check ({name}): " + " ".join(notes),
            },
        }))
    sys.exit(0)


if __name__ == "__main__":
    main()
