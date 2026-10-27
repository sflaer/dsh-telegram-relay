import assert from 'node:assert/strict';
import test from 'node:test';

import {
  baseName,
  clip,
  escapeHtml,
  firstLine,
  formatDuration,
  isQuestionPrompt,
  pluralRu,
  renderMarkdown,
  splitMessage,
} from '../lib/format.js';

test('escapeHtml escapes the three HTML-significant characters', () => {
  assert.equal(escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml(null), '');
});

test('clip keeps short text and truncates long text', () => {
  assert.equal(clip('hello', 10), 'hello');
  assert.equal(clip('hello world', 8), 'hello w…');
  assert.equal(clip('hello', 0), '');
});

test('splitMessage respects the limit and keeps all content', () => {
  const text = Array.from({ length: 40 }, (_, index) => `строка ${index} с текстом`).join('\n');
  const chunks = splitMessage(text, 120);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 120);
  assert.equal(chunks.join('\n').replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim());
});

test('formatDuration renders Russian units', () => {
  assert.equal(formatDuration(5_000), '5 с');
  assert.equal(formatDuration(65_000), '1 мин 5 с');
  assert.equal(formatDuration(3_725_000), '1 ч 2 мин');
});

test('pluralRu picks the right form', () => {
  assert.equal(pluralRu(1, 'инструмент', 'инструмента', 'инструментов'), 'инструмент');
  assert.equal(pluralRu(3, 'инструмент', 'инструмента', 'инструментов'), 'инструмента');
  assert.equal(pluralRu(11, 'инструмент', 'инструмента', 'инструментов'), 'инструментов');
  assert.equal(pluralRu(21, 'инструмент', 'инструмента', 'инструментов'), 'инструмент');
});

test('baseName handles both separators', () => {
  assert.equal(baseName('C:\\work\\project'), 'project');
  assert.equal(baseName('/home/user/project/'), 'project');
});

test('firstLine clips the first non-empty line', () => {
  assert.equal(firstLine('\n\n  привет мир  \nещё', 20), 'привет мир');
});

test('renderMarkdown converts bold, italic, strike and spoiler', () => {
  assert.equal(renderMarkdown('**важно**'), '<b>важно</b>');
  assert.equal(renderMarkdown('*курсив*'), '<i>курсив</i>');
  assert.equal(renderMarkdown('~~удалено~~'), '<s>удалено</s>');
  assert.equal(
    renderMarkdown('ключ ||sk-secret||'),
    'ключ <span class="tg-spoiler">sk-secret</span>',
  );
  assert.equal(renderMarkdown('**a *b* c**'), '<b>a <i>b</i> c</b>');
});

test('renderMarkdown converts inline and fenced code', () => {
  assert.equal(renderMarkdown('`npm test`'), '<code>npm test</code>');
  const block = renderMarkdown('```js\nconst a = 1;\n```');
  assert.match(block, /<pre><code class="language-js">/);
  assert.match(block, /const a = 1;/);
  assert.match(block, /<\/code><\/pre>/);
  // Markdown inside code must stay literal.
  assert.equal(renderMarkdown('`**not bold**`'), '<code>**not bold**</code>');
});

test('renderMarkdown links only safe schemes and escapes the rest', () => {
  assert.equal(
    renderMarkdown('[сайт](https://example.com?a=1&b=2)'),
    '<a href="https://example.com?a=1&amp;b=2">сайт</a>',
  );
  assert.equal(renderMarkdown('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(renderMarkdown('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('renderMarkdown keeps unclosed markers literal', () => {
  assert.equal(renderMarkdown('**не закрыто'), '**не закрыто');
  assert.equal(renderMarkdown('a * b * c'), 'a <i> b </i> c');
});

test('isQuestionPrompt recognizes questions', () => {
  assert.equal(isQuestionPrompt('а он только из этого чата будет приходить?'), true);
  assert.equal(isQuestionPrompt('Как это работает'), true);
  assert.equal(isQuestionPrompt('почини тест'), false);
  assert.equal(isQuestionPrompt(''), false);
});
