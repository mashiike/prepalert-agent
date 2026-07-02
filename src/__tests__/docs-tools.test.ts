import { describe, test, expect } from "bun:test";
import { buildDocsTools } from "../docs-tools.js";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";

function findTool<Name extends string>(
  tools: ReturnType<typeof buildDocsTools>,
  name: Name,
): SdkMcpToolDefinition {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

function textOf(result: { content: Array<{ text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

describe("docs_list", () => {
  test("lists available articles including project-config", async () => {
    const tools = buildDocsTools();
    const docsList = findTool(tools, "docs_list");

    const result = await docsList.handler({}, undefined);

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("project-config");
  });
});

describe("docs_index", () => {
  test("returns the section headings for a known article", async () => {
    const tools = buildDocsTools();
    const docsIndex = findTool(tools, "docs_index");

    const result = await docsIndex.handler({ article: "project-config", lang: "ja" }, undefined);

    expect(result.isError).toBeUndefined();
    expect(textOf(result).length).toBeGreaterThan(0);
  });

  test("defaults to ja when lang is not given", async () => {
    const tools = buildDocsTools();
    const docsIndex = findTool(tools, "docs_index");

    const result = await docsIndex.handler({ article: "project-config" }, undefined);

    expect(result.isError).toBeUndefined();
  });

  test("returns an error for an unknown article", async () => {
    const tools = buildDocsTools();
    const docsIndex = findTool(tools, "docs_index");

    const result = await docsIndex.handler({ article: "nonexistent-article", lang: "ja" }, undefined);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not found");
  });
});

describe("docs_search", () => {
  test("finds sections matching a keyword", async () => {
    const tools = buildDocsTools();
    const docsSearch = findTool(tools, "docs_search");

    const result = await docsSearch.handler({ keyword: "runbooksDir" }, undefined);

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("runbooksDir");
  });

  test("reports no matches for a keyword that does not appear", async () => {
    const tools = buildDocsTools();
    const docsSearch = findTool(tools, "docs_search");

    const result = await docsSearch.handler({ keyword: "zzz-nonexistent-keyword-zzz" }, undefined);

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("No sections found");
  });

  test("returns an error for an unknown article", async () => {
    const tools = buildDocsTools();
    const docsSearch = findTool(tools, "docs_search");

    const result = await docsSearch.handler({ keyword: "x", article: "nonexistent-article" }, undefined);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not found");
  });
});

describe("docs_read", () => {
  test("returns the full content of a known article", async () => {
    const tools = buildDocsTools();
    const docsRead = findTool(tools, "docs_read");

    const result = await docsRead.handler({ article: "project-config", lang: "ja" }, undefined);

    expect(result.isError).toBeUndefined();
    expect(textOf(result).length).toBeGreaterThan(0);
  });

  test("returns an error for an unknown article", async () => {
    const tools = buildDocsTools();
    const docsRead = findTool(tools, "docs_read");

    const result = await docsRead.handler({ article: "nonexistent-article", lang: "ja" }, undefined);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not found");
  });
});
