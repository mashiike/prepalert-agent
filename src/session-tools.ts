import { z } from "zod/v4";
import { tool, createSdkMcpServer, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { type SessionWriter, validateArtifactName } from "./session-writer.js";

/**
 * Builds an inline MCP server providing session tools (create_report, create_artifact).
 */
export function buildSessionToolsServer(writer: SessionWriter): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "session-tools",
    alwaysLoad: true,
    tools: buildSessionTools(writer),
  });
}

function buildSessionTools(writer: SessionWriter) {
  return [
    tool(
      "create_report",
      "Create an investigation report for this session. The report will be saved and viewable in the session viewer frontend. Write in Markdown format.",
      { content: z.string().describe("Markdown content of the investigation report") },
      async (args) => {
        await writer.writeReport(args.content);
        return { content: [{ type: "text" as const, text: "Report saved successfully." }] };
      },
    ),
    tool(
      "create_artifact",
      "Save a supplementary file (graph image, CSV, log excerpt, etc.) as a session artifact. Artifacts are viewable alongside the report in the session viewer.",
      {
        name: z.string().describe("Filename for the artifact (e.g. 'metrics.csv', 'graph.png')"),
        content: z.string().describe("File content as text (UTF-8) or base64-encoded binary"),
        encoding: z.enum(["utf-8", "base64"]).optional().describe("Content encoding. Defaults to utf-8"),
      },
      async (args) => {
        const encoding = args.encoding ?? "utf-8";
        let safeName: string;
        let bytes: Uint8Array;
        try {
          safeName = validateArtifactName(args.name);
          if (encoding === "base64") {
            const decodedSize = Buffer.byteLength(args.content, "base64");
            if (decodedSize > 10 * 1024 * 1024) {
              throw new Error(`artifact too large: ${decodedSize} bytes (max ${10 * 1024 * 1024})`);
            }
            bytes = Buffer.from(args.content, "base64");
          } else {
            bytes = new TextEncoder().encode(args.content);
            if (bytes.byteLength > 10 * 1024 * 1024) {
              throw new Error(`artifact too large: ${bytes.byteLength} bytes (max ${10 * 1024 * 1024})`);
            }
          }
          await writer.writeArtifact(safeName, bytes);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { content: [{ type: "text" as const, text: `Error saving artifact: ${msg}` }], isError: true };
        }
        return { content: [{ type: "text" as const, text: `Artifact "${safeName}" saved successfully.` }] };
      },
    ),
  ];
}
