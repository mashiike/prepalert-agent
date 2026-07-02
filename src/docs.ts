import { basename } from "node:path";
import { EMBEDDED_DOCS } from "./embedded-assets.js";

export interface DocsSection {
  level: number;
  title: string;
  content: string;
  line: number;
}

export interface DocsArticle {
  name: string;
  description: string;
  lang: string;
}

export interface DocsOutput {
  article: string;
  mode: "full" | "index" | "search";
  query?: string;
  sections: DocsSection[];
}

export function parseSections(content: string): DocsSection[] {
  const lines = content.split("\n");
  const sections: DocsSection[] = [];
  let current: DocsSection | null = null;
  let body: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    }

    if (!inCodeBlock && line.startsWith("#")) {
      if (current) {
        current.content = body.join("\n");
        sections.push(current);
      }

      let level = 0;
      for (const c of line) {
        if (c === "#") level++;
        else break;
      }
      const title = line.slice(level).trim();

      current = { level, title, content: "", line: i + 1 };
      body = [line];
    } else if (current) {
      body.push(line);
    }
  }

  if (current) {
    current.content = body.join("\n");
    sections.push(current);
  }

  return sections;
}

export function searchSections(sections: DocsSection[], query: string): DocsSection[] {
  const lower = query.toLowerCase();
  return sections.filter((s) => s.content.toLowerCase().includes(lower));
}

export function formatIndex(sections: DocsSection[]): string {
  return sections
    .map((s) => {
      const indent = "  ".repeat(s.level - 1);
      const prefix = "#".repeat(s.level);
      return `${indent}${prefix} ${s.title} (L${s.line})`;
    })
    .join("\n");
}

export async function listArticles(): Promise<DocsArticle[]> {
  return Object.entries(EMBEDDED_DOCS).map(([key, content]) => {
    const slashIdx = key.indexOf("/");
    const lang = slashIdx >= 0 ? key.slice(0, slashIdx) : "ja";
    const name = basename(key, ".md");
    const firstLine = content.split("\n").find((l) => l.startsWith("# "));
    const description = firstLine ? firstLine.slice(2).trim() : name;
    return { name, description, lang };
  });
}

export async function loadArticle(name: string, lang: string = "ja"): Promise<string> {
  if (/[/\\]|\.\./.test(name) || /[/\\]|\.\./.test(lang)) {
    throw new Error(`invalid article name or lang: ${name}, ${lang}`);
  }
  const key = `${lang}/${name}.md`;
  const content = EMBEDDED_DOCS[key];
  if (!content) throw new Error(`article not found: ${name} (lang: ${lang})`);
  return content;
}
