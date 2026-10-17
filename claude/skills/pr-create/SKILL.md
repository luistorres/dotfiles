---
name: pr-create
description: Create a pull request following a structured workflow - creating a branch, staging changes, committing, pushing, and generating a PR with proper formatting. Use this when the user asks to create a PR or pull request.
---

# Create a pull request

**Important**: No mentions to Claude, Cursor or any other AI whatsoever in any commit or pull request or anywhere else.

1. Create a new branch for the changes. Keep the branch name short and descriptive using the format `lt/X` where X is at most 4 words
2. **Run the linter/formatter before staging**: `npx biome check --write .` (or the project's equivalent lint/fix command). Fix any issues before proceeding.
3. Stage the relevant changes (including any formatting fixes from step 2).
4. Create a single-line commit message. Compare against `main` (or `master`) to see what changed and use this to generate an appropriate commit title.
5. Push the changes to the remote repository.
6. Use the `pr-message` skill to generate the pull request title and body following the proper format.
7. Use `gh pr create` with the generated title and body to create the pull request

After finishing, display a link to the PR.
