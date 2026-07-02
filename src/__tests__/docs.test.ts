import { describe, test, expect } from "bun:test";
import { parseSections, searchSections, formatIndex, listArticles, loadArticle } from "../docs.js";

const SAMPLE_MD = `# Title

Intro text.

## Section One

Content of section one.

### Subsection A

Some details here about webhooks.

## Section Two

\`\`\`
# This is not a heading
\`\`\`

More content.
`;

describe("parseSections", () => {
  test("parses headings into sections", () => {
    const sections = parseSections(SAMPLE_MD);
    expect(sections.length).toBe(4);
    expect(sections[0]!.level).toBe(1);
    expect(sections[0]!.title).toBe("Title");
    expect(sections[1]!.level).toBe(2);
    expect(sections[1]!.title).toBe("Section One");
    expect(sections[2]!.level).toBe(3);
    expect(sections[2]!.title).toBe("Subsection A");
    expect(sections[3]!.level).toBe(2);
    expect(sections[3]!.title).toBe("Section Two");
  });

  test("ignores headings inside code blocks", () => {
    const sections = parseSections(SAMPLE_MD);
    const titles = sections.map((s) => s.title);
    expect(titles).not.toContain("This is not a heading");
  });

  test("captures content for each section", () => {
    const sections = parseSections(SAMPLE_MD);
    expect(sections[2]!.content).toContain("webhooks");
  });
});

describe("searchSections", () => {
  test("finds sections matching keyword", () => {
    const sections = parseSections(SAMPLE_MD);
    const results = searchSections(sections, "webhooks");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Subsection A");
  });

  test("case-insensitive search", () => {
    const sections = parseSections(SAMPLE_MD);
    const results = searchSections(sections, "WEBHOOKS");
    expect(results.length).toBe(1);
  });

  test("returns empty array for no match", () => {
    const sections = parseSections(SAMPLE_MD);
    const results = searchSections(sections, "nonexistent");
    expect(results.length).toBe(0);
  });
});

describe("formatIndex", () => {
  test("formats sections as indented index", () => {
    const sections = parseSections(SAMPLE_MD);
    const index = formatIndex(sections);
    expect(index).toContain("# Title");
    expect(index).toContain("  ## Section One");
    expect(index).toContain("    ### Subsection A");
  });
});

describe("listArticles", () => {
  test("returns articles from docs/spec/", async () => {
    const articles = await listArticles();
    expect(articles.length).toBeGreaterThan(0);
    const names = articles.map((a) => a.name);
    expect(names).toContain("project-config");
    expect(names).toContain("runbook");
  });

  test("each article has lang and description", async () => {
    const articles = await listArticles();
    for (const a of articles) {
      expect(a.lang).toBeTruthy();
      expect(a.description).toBeTruthy();
    }
  });
});

describe("loadArticle", () => {
  test("loads project-config article", async () => {
    const content = await loadArticle("project-config", "ja");
    expect(content).toContain("prepalert.yaml");
  });

  test("throws for nonexistent article", () => {
    expect(() => loadArticle("nonexistent", "ja")).toThrow();
  });
});
