import { test } from "node:test";
import assert from "node:assert/strict";
import { readable, speechParagraphs } from "../text.ts";
import { defaults } from "../settings.ts";
import { parseVoices, resolveVoice, languageLabel } from "../voices.ts";

test("speech paragraphs keep soft line breaks, skip empty blocks and split after Markdown cleanup", () => {
  assert.deepEqual(speechParagraphs("  Primo\ncontinua\n\n \nSecondo\r\n\r\nTerzo  "), ["Primo\ncontinua", "Secondo", "Terzo"]);
  assert.deepEqual(speechParagraphs(" \n\n "), []);
  assert.deepEqual(speechParagraphs(readable("Prima.\n\n```js\nfirst()\n\nsecond()\n```\n\nDopo.", defaults)), ["Prima.", "Blocco di codice omesso.", "Dopo."]);
});

test("Markdown cleanup preserves paragraph boundaries around headings and lists", () => {
  const source = "Introduzione.\n\n### Primo punto\n- Prima voce.\n- Seconda voce.\n\n### Secondo punto\n- Terza voce.\n- Quarta voce.\n\nConclusione.";
  assert.deepEqual(speechParagraphs(readable(source, defaults)), [
    "Introduzione.",
    "Primo punto\nPrima voce.\nSeconda voce.",
    "Secondo punto\nTerza voce.\nQuarta voce.",
    "Conclusione.",
  ]);
});

test("line-oriented Markdown markers never consume vertical whitespace", () => {
  for (const block of ["### Titolo ###", "- Voce", "1. Voce", "- [x] Fatto", "> Citazione", "---", "===", "[ref]: https://example.com"]) {
    const speech = readable(`Prima.\n\n${block}\n\nDopo.`, defaults);
    const paragraphs = speechParagraphs(speech);
    assert.equal(paragraphs[0], "Prima.", `${block}: ${JSON.stringify(speech)}`);
    assert.equal(paragraphs.at(-1), "Dopo.", `${block}: ${JSON.stringify(speech)}`);
  }
});

test("omits backtick, tilde, unclosed and indented code fences", () => {
  for (const source of ["```js\nsecret()\n```", "~~~~py\nsecret()\n~~~~", "```\nsecret()", "    secret()\n    next()"])
    assert.equal(readable(source, defaults), "Blocco di codice omesso.");
  assert.match(readable("~~~\nprint(1)\n~~~", { ...defaults, readCode: true }), /print\(1\)/);
});

test("URLs are optional; link labels, reference links and image alt text survive", () => {
  const text = "[Documentazione](https://example.com/a(b)) e [Pi][p]. ![schema](pic.png)\n[p]: https://pi.dev\n<https://example.org> https://test.com/path";
  const speech = readable(text, defaults);
  assert.match(speech, /Documentazione e Pi\. schema/);
  assert.doesNotMatch(speech, /https:|example\.com|pic\.png/);
  assert.match(readable(text, { ...defaults, readUrls: true }), /https:\/\/pi.dev/);
});

test("tables become labelled rows or a single omission notice", () => {
  const table = "| Nome | Quantità |\n| :--- | ---: |\n| mele | 2 |\n| pere | 3 |";
  assert.equal(readable(table, defaults), "Tabella.\nNome: mele; Quantità: 2.\nNome: pere; Quantità: 3.");
  assert.equal(readable(table, { ...defaults, readTables: false }), "Tabella omessa.");
});

test("lists, headings, emoji, HTML and say directives are normalized without damaging filenames", () => {
  const text = "## Titolo ✅\n- [x] **Fatto**\n> Leggi `file_name.ts`.\n<b>Nota</b>\n[[slnc 99999]]";
  const speech = readable(text, defaults);
  assert.match(speech, /Titolo/); assert.match(speech, /Fatto/); assert.match(speech, /file_name\.ts/);
  assert.doesNotMatch(speech, /##|✅|<b>|\[\[/);
});

test("voice parsing supports names with spaces and fallback prefers the configured language", () => {
  const voices = parseVoices("A Voice  en_US # Hello\nPaola  it_IT # Salve\ninvalid\n");
  assert.equal(voices[0].name, "A Voice");
  assert.equal(voices[0].sample, "Hello");
  assert.equal(resolveVoice(voices, { voice: "Missing", locale: "it_IT" }).name, "Paola");
  assert.equal(resolveVoice(voices, { voice: "Missing", locale: "it_CH" }).name, "Paola");
  assert.equal(resolveVoice([], { voice: "Missing", locale: "it_IT" }), undefined);
  assert.match(languageLabel("it_IT"), /italiano/i);
});
