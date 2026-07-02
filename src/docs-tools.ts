import { z } from "zod/v4";
import { tool, createSdkMcpServer, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { listArticles, loadArticle, parseSections, searchSections, formatIndex } from "./docs.js";

/**
 * Builds an inline MCP server providing documentation tools for interactive sessions.
 * Use this instead of `prepalert-agent docs` CLI command within agent sessions.
 */
export function buildDocsToolsServer(): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "docs-tools",
    alwaysLoad: true,
    tools: buildDocsTools(),
  });
}

export function buildDocsTools() {
  return [
    tool(
      "docs_list",
      "List available prepalert-agent documentation articles. Use this to discover what documentation is available before searching or reading.",
      {},
      async () => {
        const articles = await listArticles();
        const text = articles.length === 0
          ? "No articles found."
          : articles.map((a) => `[${a.lang}] ${a.name} — ${a.description}`).join("\n");
        return { content: [{ type: "text" as const, text }] };
      },
    ),
    tool(
      "docs_index",
      "Show the table of contents (section headings) of a prepalert-agent documentation article. Useful for understanding the structure before reading specific sections.",
      {
        article: z.string().describe("Article name (e.g. 'project-config', 'runbook', 'auth')"),
        lang: z.string().optional().describe("Language: 'ja' or 'en'. Defaults to 'ja'"),
      },
      async (args) => {
        const lang = args.lang ?? "ja";
        try {
          const content = await loadArticle(args.article, lang);
          const sections = parseSections(content);
          const text = formatIndex(sections);
          return { content: [{ type: "text" as const, text }] };
        } catch {
          return {
            content: [{ type: "text" as const, text: `Article "${args.article}" not found (lang: ${lang}). Use docs_list to see available articles.` }],
            isError: true,
          };
        }
      },
    ),
    tool(
      "docs_search",
      "Search prepalert-agent documentation by keyword. Returns matching sections from the specified article. Use this instead of 'prepalert-agent docs --search' CLI command.",
      {
        keyword: z.string().describe("Search keyword (case-insensitive substring match)"),
        article: z.string().optional().describe("Article name to search in. Defaults to 'project-config'. Use docs_list to see available articles."),
        lang: z.string().optional().describe("Language: 'ja' or 'en'. Defaults to 'ja'"),
      },
      async (args) => {
        const articleName = args.article ?? "project-config";
        const lang = args.lang ?? "ja";
        try {
          const content = await loadArticle(articleName, lang);
          const sections = parseSections(content);
          const matched = searchSections(sections, args.keyword);
          if (matched.length === 0) {
            return { content: [{ type: "text" as const, text: `No sections found matching "${args.keyword}" in article "${articleName}".` }] };
          }
          const text = matched.map((s) => s.content.trimEnd()).join("\n\n---\n\n");
          return { content: [{ type: "text" as const, text }] };
        } catch {
          return {
            content: [{ type: "text" as const, text: `Article "${articleName}" not found (lang: ${lang}). Use docs_list to see available articles.` }],
            isError: true,
          };
        }
      },
    ),
    tool(
      "docs_read",
      "Read the full content of a prepalert-agent documentation article. For large articles, prefer docs_search or docs_index first to find the relevant section.",
      {
        article: z.string().describe("Article name (e.g. 'project-config', 'runbook', 'auth')"),
        lang: z.string().optional().describe("Language: 'ja' or 'en'. Defaults to 'ja'"),
      },
      async (args) => {
        const lang = args.lang ?? "ja";
        try {
          const content = await loadArticle(args.article, lang);
          return { content: [{ type: "text" as const, text: content }] };
        } catch {
          return {
            content: [{ type: "text" as const, text: `Article "${args.article}" not found (lang: ${lang}). Use docs_list to see available articles.` }],
            isError: true,
          };
        }
      },
    ),
  ];
}
