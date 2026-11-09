import type { Settings } from "./settings.ts";

type TextOptions = Pick<Settings, "readCode" | "readUrls" | "readTables">;

// A deliberately conservative Markdown-to-speech conversion, not a full parser.
export function readable(text: string, options: TextOptions): string {
  const references = new Map<string, string>();
  text = text.replace(/^\s{0,3}\[([^\]]+)\]:\s*(\S+).*$/gm, (_all, id, url) => {
    references.set(id.toLowerCase(), url);
    return "";
  });
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const code: string[] = [];
      const end = new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (++i < lines.length && !end.test(lines[i])) code.push(lines[i]);
      output.push(options.readCode ? code.join("\n") : "Blocco di codice omesso.");
      continue;
    }
    if (/^(?: {4}|\t)\S/.test(lines[i])) {
      const code = [lines[i].replace(/^(?: {4}|\t)/, "")];
      while (i + 1 < lines.length && /^(?: {4}|\t)/.test(lines[i + 1])) code.push(lines[++i].replace(/^(?: {4}|\t)/, ""));
      output.push(options.readCode ? code.join("\n") : "Blocco di codice omesso.");
      continue;
    }
    if (lines[i].includes("|") && i + 1 < lines.length && cells(lines[i + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(lines[i]);
      i++;
      const rows: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim()) rows.push(cells(lines[++i]));
      if (!options.readTables) output.push("Tabella omessa.");
      else {
        output.push("Tabella.");
        if (!rows.length) output.push(headers.join("; ") + ".");
        for (const row of rows) output.push(row.map((value, col) => `${headers[col] || `Colonna ${col + 1}`}: ${value}`).join("; ") + ".");
      }
      continue;
    }
    output.push(lines[i]);
  }
  const link = (label: string, url: string) => options.readUrls ? `${label} (${url})` : label;
  return output.join("\n")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/!\[([^\]]*)\]\([^\n]*?\)/g, "$1")
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))*)(?:\s+"[^"]*")?\)/g, (_all, label, url) => link(label, url))
    .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (_all, label, ref) => link(label, references.get((ref || label).toLowerCase()) || ""))
    .replace(/<((?:https?:\/\/|www\.)[^>]+)>/g, (_all, url) => options.readUrls ? url : " collegamento omesso ")
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/g, (url) => options.readUrls ? url : " collegamento omesso ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/&amp;/g, " e ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+|\s+#+\s*$/gm, "")
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$|^\s{0,3}={3,}\s*$/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/gm, "")
    .replace(/\*\*([^]*?)\*\*|__([^]*?)__/g, (_all, a, b) => a ?? b)
    .replace(/\*([^*\n]+)\*|(?<!\w)_([^_\n]+)_(?!\w)|~~([^]*?)~~/g, (_all, a, b, c) => a ?? b ?? c)
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    // say understands embedded [[commands]]: never execute markup from a response.
    .replace(/\[\[|\]\]/g, " ")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
}
