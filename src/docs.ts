import { readdir, readFile } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";

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

function getDocsRoot(): string {
  return resolve(dirname(dirname(import.meta.path)), "docs", "spec");
}

export async function listArticles(): Promise<DocsArticle[]> {
  const docsRoot = getDocsRoot();
  const articles: DocsArticle[] = [];

  let langs: string[];
  try {
    langs = (await readdir(docsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return articles;
  }

  for (const lang of langs) {
    const langDir = join(docsRoot, lang);
    const files = (await readdir(langDir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".md"));

    for (const file of files) {
      const name = basename(file.name, ".md");
      const content = await readFile(join(langDir, file.name), "utf-8");
      const firstLine = content.split("\n").find((l) => l.startsWith("# "));
      const description = firstLine ? firstLine.slice(2).trim() : name;
      articles.push({ name, description, lang });
    }
  }

  return articles;
}

export async function loadArticle(name: string, lang: string = "ja"): Promise<string> {
  const docsRoot = getDocsRoot();
  const filePath = join(docsRoot, lang, `${name}.md`);
  return readFile(filePath, "utf-8");
}
