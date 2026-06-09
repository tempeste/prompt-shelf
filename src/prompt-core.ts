import type { Agent, FrontMatter, Prompt } from "./types";

interface FrontMatterSplit {
  meta: FrontMatter;
  frontMatter: string;
  body: string;
}

interface SectionRange {
  headingStart: number;
  contentStart: number;
  contentEnd: number;
  title: string;
}

type SearchablePrompt = Pick<Prompt, "name" | "description" | "whenToUse" | "tags">;

function stem(fileName: string): string {
  return String(fileName || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.md$/i, "") ?? "";
}

function unquote(value: string): string {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value: string): string[] | null {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item).trim())
    .filter(Boolean);
}

function parseFrontMatterBlock(raw: string): FrontMatter {
  const data: FrontMatter = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.trim() || /^[ \t]/.test(line) || !line.includes(":")) continue;
    const index = line.indexOf(":");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!key) continue;
    const list = parseInlineList(value);
    data[key] = list ?? unquote(value);
  }
  return data;
}

export function splitFrontMatter(text: string): FrontMatterSplit {
  const source = String(text || "");
  const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) {
    return { meta: {}, frontMatter: "", body: source };
  }
  return {
    meta: parseFrontMatterBlock(match[1] ?? ""),
    frontMatter: source.slice(0, match[0].length),
    body: source.slice(match[0].length),
  };
}

function stringMeta(meta: FrontMatter, key: string): string {
  const value = meta[key];
  return Array.isArray(value) ? "" : String(value || "");
}

export function loadPrompt(fileName: string, text: string): Prompt {
  const source = String(text || "");
  const { meta, frontMatter, body } = splitFrontMatter(source);
  const fallbackName = stem(fileName);
  const tags = meta.tags;
  return {
    id: fallbackName.toLowerCase(),
    fileName,
    rawText: source,
    frontMatter,
    bodySource: String(body || ""),
    name: stringMeta(meta, "name") || fallbackName,
    description: stringMeta(meta, "description"),
    whenToUse: stringMeta(meta, "when_to_use") || stringMeta(meta, "whenToUse"),
    tags: Array.isArray(tags) ? tags : [],
    body: String(body || "").trim(),
  };
}

function sectionRanges(body: string): SectionRange[] {
  const ranges: Array<Omit<SectionRange, "contentEnd">> = [];
  let inFence = false;
  let offset = 0;
  const lines = String(body || "").split(/(?<=\n)/);
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence) {
      const match = line.match(/^##[ \t]+(.+?)[ \t]*(?:\r?\n)?$/);
      const title = match?.[1];
      if (title) {
        ranges.push({
          headingStart: offset,
          contentStart: offset + line.length,
          title,
        });
      }
    }
    offset += line.length;
  }
  return ranges.map((range, index) => ({
    ...range,
    contentEnd: ranges[index + 1]?.headingStart ?? body.length,
  }));
}

export function agentSection(body: string, agent: Agent): string {
  const text = String(body || "");
  if (agent === "all") return text.trim();
  const ranges = sectionRanges(text);
  if (!ranges.length) return text.trim();

  const wanted = String(agent || "").toLowerCase();
  let fallback: string | null = null;
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

export function promptOutput(prompt: Prompt, agent: Agent): string {
  return `${agentSection(prompt.body, agent).trim()}\n`;
}

function normalizedBody(text: string): string {
  const trimmed = String(text || "").replace(/\s+$/g, "");
  return trimmed ? `${trimmed}\n` : "";
}

function normalizedSection(text: string): string {
  const body = normalizedBody(text);
  return body ? `${body}\n` : "\n";
}

function replaceAgentSection(body: string, agent: Agent, nextText: string): string {
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

export function promptTextWithOutput(prompt: Prompt, agent: Agent, nextText: string): string {
  const body = replaceAgentSection(prompt.bodySource ?? prompt.body, agent, nextText);
  return `${prompt.frontMatter || ""}${body}`;
}

function searchableText(prompt: SearchablePrompt): string {
  return [prompt.name, prompt.description, prompt.whenToUse, ...(Array.isArray(prompt.tags) ? prompt.tags : [])]
    .join(" ")
    .toLowerCase();
}

export function filterPrompts<T extends SearchablePrompt>(prompts: T[], query: string): T[] {
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
