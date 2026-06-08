# PromptShelf

Chrome extension for browsing a local prompt folder, previewing agent-specific prompt sections, and copying the selected prompt to the clipboard.

## Features

- Choose a local prompts folder once.
- Auto-refresh prompts when the popup opens.
- Refresh manually after editing prompt files.
- Search prompt names, descriptions, usage notes, and tags.
- Preview the selected prompt.
- Copy the Codex, Claude, or full prompt body.

Prompt files should be Markdown with optional YAML-style front matter:

```markdown
---
name: full-output
description: Require complete output with no placeholders
when_to_use: Use when the answer must be complete
tags: [modifier, codex]
---

## Claude
...

## Codex
...
```

## Install Locally

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click `Load unpacked`.
4. Select this repository folder.
5. Open PromptShelf and choose your `prompts/` folder.

## Development

No build step is required.

Run parser tests:

```bash
npm test
```

The extension uses Chrome's File System Access API. If Chrome revokes folder permission, choose the folder again.

