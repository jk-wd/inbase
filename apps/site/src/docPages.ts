import fs from "node:fs";
import path from "node:path";

export const DOC_PAGES = [
  { slug: "install-and-start", title: "Install and start", file: "install-and-start.md" },
  { slug: "using-the-map", title: "Using the map", file: "using-the-map.md" },
  { slug: "llm-interaction", title: "LLM interaction", file: "llm-interaction.md" },
  {
    slug: "starting-a-llm-session",
    title: "Starting a LLM session",
    file: "starting-a-llm-session.md",
  },
  { slug: "walk-mode", title: "Walk mode", file: "walk-mode.md" },
  { slug: "explain-mode", title: "Explain mode", file: "explain-mode.md" },
  { slug: "inbase-cli", title: "InBase cli", file: "inbase-cli.md" },
] as const;

const docsDir = path.resolve(process.cwd(), "../../docs");

export function readDocSource(file: string) {
  return fs
    .readFileSync(path.join(docsDir, file), "utf8")
    .replace(/(src|srcset)="(?:docs\/)?images\//g, '$1="/images/')
    .replace(/\]\((?:docs\/)?images\//g, '](/images/');
}
