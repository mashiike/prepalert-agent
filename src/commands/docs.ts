import { Command } from "commander";
import { listArticles, loadArticle, parseSections, searchSections, formatIndex, type DocsOutput } from "../docs.js";

export function createDocsCommand(): Command {
  return new Command("docs")
    .description("Show documentation for prepalert-agent")
    .option("--list", "list available articles")
    .option("--index", "show table of contents")
    .option("--search <keyword>", "search keyword in documents")
    .option("--article <name>", "article name to display", "project-config")
    .option("--lang <lang>", "language (ja, en)", "ja")
    .option("--json", "output in JSON format")
    .action(async (opts) => {
      const jsonOutput = opts.json === true;
      const lang = opts.lang as string;

      if (opts.list) {
        const articles = listArticles();
        if (jsonOutput) {
          console.log(JSON.stringify(articles, null, 2));
        } else {
          if (articles.length === 0) {
            console.log("no articles found");
            return;
          }
          for (const a of articles) {
            console.log(`  [${a.lang}] ${a.name} — ${a.description}`);
          }
        }
        return;
      }

      const articleName = opts.article as string;
      let content: string;
      try {
        content = loadArticle(articleName, lang);
      } catch {
        console.error(`error: article "${articleName}" not found (lang: ${lang})`);
        console.error('Use --list to see available articles.');
        process.exit(1);
      }

      if (opts.index) {
        const sections = parseSections(content);
        if (jsonOutput) {
          const out: DocsOutput = {
            article: articleName,
            mode: "index",
            sections: sections.map((s) => ({ level: s.level, title: s.title, content: "", line: s.line })),
          };
          console.log(JSON.stringify(out, null, 2));
        } else {
          console.log(formatIndex(sections));
        }
        return;
      }

      if (opts.search) {
        const keyword = opts.search as string;
        const sections = parseSections(content);
        const matched = searchSections(sections, keyword);
        if (matched.length === 0) {
          console.error(`no sections found matching "${keyword}" in article "${articleName}"`);
          process.exit(1);
        }
        if (jsonOutput) {
          const out: DocsOutput = { article: articleName, mode: "search", query: keyword, sections: matched };
          console.log(JSON.stringify(out, null, 2));
        } else {
          console.log(matched.map((s) => s.content.trimEnd()).join("\n\n---\n\n"));
        }
        return;
      }

      if (jsonOutput) {
        const sections = parseSections(content);
        const out: DocsOutput = { article: articleName, mode: "full", sections };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log(content);
      }
    });
}
