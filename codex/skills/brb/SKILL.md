---
name: brb
description: Catch up on every AI coding session, here and in the user's other projects. Use when the user types brb, comes back after a break, or asks what their other Claude Code, Codex, Gemini or Kiro sessions did.
---

Run this in the project folder and show the user its output exactly as printed, in a code block, without summarizing it:

```
command -v brb >/dev/null 2>&1 && brb --no-ai --no-color || npx --yes @john_carl/brb --no-ai --no-color
```

The list includes the session you are in. Then ask which item they want to pick up first. To pick one up they run `brb <number>` in a terminal of their own; don't run it for them, because it starts another tool's session.
