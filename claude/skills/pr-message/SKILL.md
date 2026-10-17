---
name: pr-message
description: Generate pull request titles and bodies following a specific format with Why/This change sections. Use this when creating PR messages or when the user asks for a pull request message.
---

## Pull Request Message Format

When I ask for a "PR message" or "pull request message", provide it in this exact format:

**<Concise Title (imperative mood, no period)>**

**Why:**
<1-3 sentences explaining the problem/issue that exists and why this change is needed. Focus on the business/technical impact, not on the specific lines you changed>

**This change addresses the need by:**
<Bullet points explaining what was changed and how it solves the problem. Be specific about the technical approach and implementation details.>

Keep things short and concise, no longer than 3/4 points

Note: No mentions to claude or any other AI whatsoever in any commit or pull request or anywhere else.
