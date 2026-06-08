---
name: prompt-shelf-prompt-maker
description: Create, rewrite, format, or normalize Markdown prompt files for PromptShelf and agent-prompt. Use when the user asks to make a reusable prompt, turn rough instructions into a prompt file, fix PromptShelf front matter, choose prompt tags or filenames, split Codex/Claude prompt sections, or prepare prompts for a prompts/ folder.
---

# PromptShelf Prompt Maker

Use this skill to produce copy-ready PromptShelf prompt files. Prefer a complete Markdown artifact over prose about how to make one.

## File Shape

Use one Markdown file per prompt:

```markdown
---
name: kebab-case-name
description: Short user-facing purpose.
when_to_use: One sentence describing when to use it.
tags: [planning, debugging]
---

Prompt body goes here.
```

Rules:
- Filename should usually be `prompts/<name>.md`.
- `name` should match the filename stem and be kebab-case.
- Keep YAML simple: no multiline front matter values, no nested objects.
- Use `tags` as a short inline list, usually 2-4 lowercase tags.
- Keep `description` under one sentence and make it useful in a picker UI.
- Use `when_to_use` for trigger guidance, not a second description.

## Body Style

Write the prompt as instructions the receiving agent can execute immediately:

- Start with the job to do, not “Here is a prompt”.
- Prefer direct imperatives and concrete constraints.
- Include output format only when it changes the result.
- Preserve the user’s actual intent; remove chatter, duplicates, and implementation-specific context that does not belong in a reusable prompt.
- Do not include private local paths, repo-specific secrets, or one-off conversation details unless the prompt is explicitly private and scoped.

## Agent Sections

If the same prompt works for every agent, use a shared body with no agent headings.

If behavior should differ by agent, use level-2 headings:

```markdown
## Claude

Claude-specific prompt text.

## Codex

Codex-specific prompt text.
```

If the same section should be used by both Claude and Codex, use:

```markdown
## Claude / Codex

Shared prompt text.
```

PromptShelf copies the selected agent section when present. If no matching section exists, it falls back to shared text.

## Workflow

1. Infer the slug, description, trigger, and tags from the user’s request.
2. Ask at most one clarifying question only if the prompt’s purpose is genuinely ambiguous.
3. Draft the prompt file.
4. If editing an existing prompt, preserve useful front matter and improve only what is needed.
5. If writing to a repo, create or update `prompts/<slug>.md` unless the user names another path.

## Quality Bar

Before finishing, check:
- Front matter is valid simple YAML.
- The body is reusable outside the current chat.
- The picker fields are concise enough for PromptShelf’s UI.
- The output contains no accidental personal or project-sensitive details.
