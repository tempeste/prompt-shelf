const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../prompt-core.js");

test("parses prompt front matter and body", () => {
  const prompt = core.loadPrompt(
    "full-output.md",
    [
      "---",
      "name: full-output",
      "description: Require full answers",
      "when_to_use: Need complete output",
      "tags: [modifier, codex]",
      "---",
      "",
      "## Codex",
      "Give the full answer.",
    ].join("\n"),
  );

  assert.equal(prompt.name, "full-output");
  assert.equal(prompt.description, "Require full answers");
  assert.deepEqual(prompt.tags, ["modifier", "codex"]);
  assert.match(prompt.body, /Give the full answer/);
});

test("returns agent-specific sections", () => {
  const body = [
    "Intro",
    "",
    "## Claude",
    "Claude text",
    "",
    "## Codex",
    "Codex text",
  ].join("\n");

  assert.equal(core.agentSection(body, "codex"), "Codex text");
  assert.equal(core.agentSection(body, "claude"), "Claude text");
  assert.equal(core.agentSection(body, "all"), body);
});

test("falls back to shared sections", () => {
  const body = [
    "## Claude / Codex",
    "Shared text",
    "",
    "## Gemini",
    "Gemini text",
  ].join("\n");

  assert.equal(core.agentSection(body, "codex"), "Shared text");
});

test("filters prompts by metadata", () => {
  const prompts = [
    { name: "full-output", description: "Complete answers", whenToUse: "", tags: ["modifier"] },
    { name: "prd", description: "Product requirements", whenToUse: "", tags: ["planning"] },
  ];

  assert.deepEqual(core.filterPrompts(prompts, "complete").map((prompt) => prompt.name), ["full-output"]);
  assert.deepEqual(core.filterPrompts(prompts, "planning").map((prompt) => prompt.name), ["prd"]);
});

