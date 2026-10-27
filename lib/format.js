/**
 * Text helpers shared by the relay: Telegram HTML escaping, length-safe
 * clipping and splitting, Russian duration/plural formatting.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/** Escape text for Telegram's HTML parse mode. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>]/g, (ch) => ESCAPES[ch]);
}

/**
 * Convert the model's Markdown into the HTML subset Telegram accepts.
 *
 * The input is escaped first, then fenced code, inline code, and links are
 * parked behind placeholders so emphasis never rewrites them. Unclosed markers
 * stay literal. Telegram supports `<b>`, `<i>`, `<s>`, `<code>`, `<pre>`,
 * `<blockquote>`, links, and `tg-spoiler`.
 */
export function renderMarkdown(value) {
  let text = String(value ?? '').replace(/\u0000/g, '');
  if (!text) return '';

  const blocks = [];
  text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const token = `\u0000b${blocks.length}\u0000`;
    blocks.push({ lang: String(lang ?? '').trim(), code: String(code ?? '').replace(/\n$/, '') });
    return token;
  });

  text = escapeHtml(text);

  const inline = [];
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const token = `\u0000c${inline.length}\u0000`;
    inline.push(String(code ?? ''));
    return token;
  });

  const links = [];
  text = text.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|tg:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_match, label, url) => {
      const token = `\u0000l${links.length}\u0000`;
      links.push({ label: String(label ?? ''), url: String(url ?? '') });
      return token;
    },
  );

  text = text
    .replace(/\*\*([^\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])__([^_\n]+?)__(?=[\s).,!?:;]|$)/g, '$1<b>$2</b>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
    .replace(/~~([^\n]+?)~~/g, '<s>$1</s>')
    .replace(/\|\|([^\n]+?)\|\|/g, '<span class="tg-spoiler">$1</span>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');

  text = text.replace(/\u0000l(\d+)\u0000/g, (_match, index) => {
    const link = links[Number(index)];
    if (!link) return '';
    const href = link.url.replace(/"/g, '%22');
    return `<a href="${href}">${link.label}</a>`;
  });
  text = text.replace(/\u0000c(\d+)\u0000/g, (_match, index) => `<code>${escapeHtml(inline[Number(index)] ?? '')}</code>`);
  text = text.replace(/\u0000b(\d+)\u0000/g, (_match, index) => {
    const block = blocks[Number(index)];
    if (!block) return '';
    const language = /^[\w+-]+$/.test(block.lang) ? ` class="language-${block.lang}"` : '';
    return `<pre><code${language}>${escapeHtml(block.code)}</code></pre>`;
  });
  return text;
}

/** Whether a prompt reads as a question, for the notification icon. */
export function isQuestionPrompt(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (/[?？]\s*$/.test(text)) return true;
  return /^(?:что|кто|где|когда|почему|зачем|как|сколько|какой|какая|какие|каков|можно ли|стоит ли|будет ли|есть ли|а\s+[а-яё])/i.test(
    text,
  );
}

/** Clip text to `max` characters, appending an ellipsis when shortened. */
export function clip(text, max) {
  const source = String(text ?? '');
  if (!Number.isFinite(max) || max <= 0) return '';
  if (source.length <= max) return source;
  return `${source.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Split a message into Telegram-sized chunks, preferring paragraph, then line,
 * then word boundaries.
 */
export function splitMessage(text, max = 3900) {
  const source = String(text ?? '');
  if (source.length <= max) return [source];
  const chunks = [];
  let rest = source;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Compact Russian duration: `2 ч 5 мин`, `5 мин 3 с`, `12 с`. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин ${seconds} с`;
  return `${seconds} с`;
}

/** Russian plural form picker. */
export function pluralRu(count, one, few, many) {
  const abs = Math.abs(Number(count)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Last path segment for either separator. */
export function baseName(value) {
  const parts = String(value ?? '').split(/[\\/]+/).filter(Boolean);
  return parts.pop() ?? '';
}

/** Local wall-clock time as HH:MM. */
export function shortTime(timestamp = Date.now()) {
  try {
    return new Date(timestamp).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** First non-empty line, clipped — a readable fallback title. */
export function firstLine(text, max = 60) {
  const line = String(text ?? '').split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? '';
  return clip(line, max);
}
