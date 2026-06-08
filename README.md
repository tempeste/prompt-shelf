# PromptShelf

Chrome extension for browsing a local prompt folder, previewing agent-specific prompt sections, and copying the selected prompt to the clipboard.

## Features

- Choose a local prompts folder once.
- Show the last synced prompt list immediately from local browser storage.
- Auto-sync prompts when the popup opens and Chrome still has folder permission.
- Refresh manually after editing prompt files.
- Search prompt names, descriptions, usage notes, and tags.
- Preview the selected prompt.
- Copy the Codex, Claude, or full prompt body.
- Edit the preview text and save it back to the prompt markdown file.

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

## Agent Skill

PromptShelf includes a public skill at `skills/prompt-shelf-prompt-maker/SKILL.md` for agents that support local skills. Use it to create or normalize prompt markdown files for a `prompts/` folder.

The extension uses Chrome's File System Access API plus IndexedDB. PromptShelf stores the last parsed prompt list locally, so you can still browse and copy cached prompts if Chrome asks to reconnect the folder. Click `Refresh` to grant folder access again and sync the latest files. Click `Edit` to grant write access, make changes in the preview, then click `Done` to save the matching markdown file.
