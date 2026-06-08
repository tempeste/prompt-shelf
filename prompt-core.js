(function attachPromptShelfCore(root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = core;
  } else {
    root.PromptShelfCore = core;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPromptShelfCore() {
  function stem(fileName) {
    return String(fileName || "").replace(/\\/g, "/").split("/").pop().replace(/\.md$/i, "");
  }

  function unquote(value) {
    const trimmed = String(value || "").trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  function parseInlineList(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => unquote(item).trim())
      .filter(Boolean);
  }

  function parseFrontMatterBlock(raw) {
    const data = {};
    for (const line of String(raw || "").split(/\r?\n/)) {
      if (!line.trim() || /^[ \t]/.test(line) || !line.includes(":")) continue;
      const index = line.indexOf(":");
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (!key) continue;
      const list = parseInlineList(value);
      data[key] = list || unquote(value);
    }
    return data;
  }

  function splitFrontMatter(text) {
    const source = String(text || "");
    const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) {
      return { meta: {}, frontMatter: "", body: source };
    }
    return {
      meta: parseFrontMatterBlock(match[1]),
      frontMatter: source.slice(0, match[0].length),
      body: source.slice(match[0].length),
    };
  }

  function loadPrompt(fileName, text) {
    const source = String(text || "");
    const { meta, frontMatter, body } = splitFrontMatter(source);
    const fallbackName = stem(fileName);
    return {
      id: fallbackName.toLowerCase(),
      fileName,
      rawText: source,
      frontMatter,
      bodySource: String(body || ""),
      name: String(meta.name || fallbackName),
      description: String(meta.description || ""),
      whenToUse: String(meta.when_to_use || meta.whenToUse || ""),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      body: String(body || "").trim(),
    };
  }

  function sectionRanges(body) {
    const ranges = [];
    let inFence = false;
    let offset = 0;
    const lines = String(body || "").split(/(?<=\n)/);
    for (const line of lines) {
      if (/^```/.test(line)) inFence = !inFence;
      if (!inFence) {
        const match = line.match(/^##[ \t]+(.+?)[ \t]*(?:\r?\n)?$/);
        if (match) {
          ranges.push({
            headingStart: offset,
            contentStart: offset + line.length,
            title: match[1],
          });
        }
      }
      offset += line.length;
    }
    return ranges.map((range, index) => ({
      ...range,
      contentEnd: ranges[index + 1] ? ranges[index + 1].headingStart : body.length,
    }));
  }

  function agentSection(body, agent) {
    const text = String(body || "");
    if (agent === "all") return text.trim();
    const ranges = sectionRanges(text);
    if (!ranges.length) return text.trim();

    const wanted = String(agent || "").toLowerCase();
    let fallback = null;
    for (const range of ranges) {
      const title = range.title.toLowerCase();
      const section = text.slice(range.contentStart, range.contentEnd).trim();
      if (title.includes(wanted)) return section;
      if (title.includes("same prompt") || title.includes("claude / codex")) {
        fallback = section;
      }
    }
    return fallback || text.trim();
  }

  function promptOutput(prompt, agent) {
    return `${agentSection(prompt.body, agent).trim()}\n`;
  }

  function normalizedBody(text) {
    const trimmed = String(text || "").replace(/\s+$/g, "");
    return trimmed ? `${trimmed}\n` : "";
  }

  function normalizedSection(text) {
    const body = normalizedBody(text);
    return body ? `${body}\n` : "\n";
  }

  function replaceAgentSection(body, agent, nextText) {
    const text = String(body || "");
    if (agent === "all") {
      const leadingWhitespace = text.match(/^\s*/)?.[0] || "";
      return `${leadingWhitespace}${normalizedBody(nextText)}`;
    }

    const ranges = sectionRanges(text);
    if (!ranges.length) return normalizedBody(nextText);

    const wanted = String(agent || "").toLowerCase();
    let target = ranges.find((range) => range.title.toLowerCase().includes(wanted));
    if (!target) {
      target = ranges.find((range) => {
        const title = range.title.toLowerCase();
        return title.includes("same prompt") || title.includes("claude / codex");
      });
    }
    if (!target) return normalizedBody(nextText);

    const replacement = target.contentEnd < text.length ? normalizedSection(nextText) : normalizedBody(nextText);
    return `${text.slice(0, target.contentStart)}${replacement}${text.slice(target.contentEnd)}`;
  }

  function promptTextWithOutput(prompt, agent, nextText) {
    const body = replaceAgentSection(prompt.bodySource ?? prompt.body, agent, nextText);
    return `${prompt.frontMatter || ""}${body}`;
  }

  function searchableText(prompt) {
    return [
      prompt.name,
      prompt.description,
      prompt.whenToUse,
      ...(Array.isArray(prompt.tags) ? prompt.tags : []),
    ]
      .join(" ")
      .toLowerCase();
  }

  function filterPrompts(prompts, query) {
    const terms = String(query || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!terms.length) return prompts;
    return prompts.filter((prompt) => {
      const text = searchableText(prompt);
      return terms.every((term) => text.includes(term));
    });
  }

  return {
    agentSection,
    filterPrompts,
    loadPrompt,
    promptTextWithOutput,
    promptOutput,
    splitFrontMatter,
  };
});
