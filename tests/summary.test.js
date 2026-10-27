import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTurnSummary, normalizeAllowedUser, parseAllowedUsers, TurnTracker, textOfMessage } from '../lib/relay.js';
import { detectSystemLanguage, durationText, normalizeLanguage, toolsText, translate } from '../lib/i18n.js';

const session = { id: 'session-1234abcd', header: { cwd: '/work/project' } };

function ev(type, data, time = 0) {
  return { type, data, time, seq: 0 };
}

test('textOfMessage joins text blocks only', () => {
  const message = {
    content: [
      { type: 'text', text: 'первый' },
      { type: 'image', attachmentId: 'x' },
      { type: 'text', text: 'второй' },
    ],
  };
  assert.equal(textOfMessage(message), 'первый\n\nвторой');
  assert.equal(textOfMessage(undefined), '');
});

test('TurnTracker folds one completed turn', () => {
  const tracker = new TurnTracker();
  tracker.onEvent(session, ev('user/message', { role: 'user', content: [{ type: 'text', text: 'почини тест' }], source: { kind: 'user' } }, 1000));
  assert.equal(tracker.onEvent(session, ev('turn/start', { turn: 1 }, 2000)), null);
  tracker.onEvent(session, ev('step/start', { turn: 1 }, 2000));
  tracker.onEvent(session, ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read' }, 2500));
  tracker.onEvent(session, ev('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'edit' }, 3000));
  tracker.onEvent(session, ev('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'готово' }] } }, 4000));
  const finished = tracker.onEvent(session, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 9000));

  assert.ok(finished);
  assert.equal(finished.state.tools, 2);
  assert.equal(finished.state.text, 'готово');
  assert.equal(finished.state.prompt, 'почини тест');
  assert.equal(finished.reason.kind, 'completed');
  assert.equal(finished.endedAt - finished.state.startedAt, 7000);
});

test('TurnTracker ignores events without an open turn', () => {
  const tracker = new TurnTracker();
  assert.equal(tracker.onEvent(session, ev('tool/call', { callId: 'c1', name: 'read' }, 1000)), null);
  assert.equal(tracker.onEvent(session, ev('turn/end', { reason: { kind: 'completed' } }, 2000)), null);
});

test('buildTurnSummary renders a completed turn', () => {
  const text = buildTurnSummary({
    title: 'Починить тест',
    question: true,
    cwd: 'project',
    durationMs: 65_000,
    tools: 3,
    reason: { kind: 'completed' },
    text: 'Тест проходит.',
  });
  assert.match(text, /DSH завершил работу/);
  assert.match(text, /❓ Починить тест/);
  assert.match(text, /project/);
  assert.match(text, /1 мин 5 с/);
  assert.match(text, /3 инструмента/);
  assert.match(text, /Тест проходит\./);
  // Meta belongs to the last line, after the body.
  const lines = text.trimEnd().split('\n');
  assert.match(lines.at(-1), /^📁 #project · ⏱️ 1 мин 5 с · 🛠 3 инструмента$/);
});

test('buildTurnSummary renders the body as Telegram HTML', () => {
  const text = buildTurnSummary({
    title: 't',
    cwd: 'w',
    durationMs: 1000,
    tools: 0,
    reason: { kind: 'completed' },
    text: '**Жирный** и `код`, ключ ||secret||',
  });
  assert.match(text, /<b>Жирный<\/b>/);
  assert.match(text, /<code>код<\/code>/);
  assert.match(text, /<span class="tg-spoiler">secret<\/span>/);
  assert.doesNotMatch(text, /\*\*/);
});

test('buildTurnSummary escapes markup and clips long output', () => {
  const text = buildTurnSummary({
    title: '<b>x</b>',
    cwd: 'a&b',
    durationMs: 1000,
    tools: 0,
    reason: { kind: 'completed' },
    text: '<script>alert(1)</script>',
    maxChars: 10,
  });
  assert.match(text, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(text, /a&amp;b/);
  assert.doesNotMatch(text, /<script>/);
  assert.ok(text.length < 400);
});

test('buildTurnSummary renders aborted and failed turns', () => {
  const aborted = buildTurnSummary({
    title: 't', durationMs: 1000, tools: 0, reason: { kind: 'aborted' }, text: '',
  });
  assert.match(aborted, /остановлен/i);

  const failed = buildTurnSummary({
    title: 't', durationMs: 1000, tools: 0,
    reason: { kind: 'error', error: { message: 'сломалось' } }, text: '',
  });
  assert.match(failed, /ошибкой/i);
  assert.match(failed, /сломалось/);
});

test('normalizeAllowedUser accepts usernames, links and ids', () => {
  assert.equal(normalizeAllowedUser('@Alice'), '@alice');
  assert.equal(normalizeAllowedUser('alice'), '@alice');
  assert.equal(normalizeAllowedUser('https://t.me/Alice'), '@alice');
  assert.equal(normalizeAllowedUser('t.me/alice'), '@alice');
  assert.equal(normalizeAllowedUser('tg://user?id=123456'), 'id:123456');
  assert.equal(normalizeAllowedUser('123456'), 'id:123456');
  assert.equal(normalizeAllowedUser(''), '');
  assert.throws(() => normalizeAllowedUser('https://t.me/+invite'), /не понял/);
});

test('parseAllowedUsers deduplicates a mixed list', () => {
  assert.deepEqual(parseAllowedUsers('@Alice, t.me/bob\n123456; @alice'), [
    '@alice',
    '@bob',
    'id:123456',
  ]);
  assert.deepEqual(parseAllowedUsers(['@alice', 'https://t.me/bob']), ['@alice', '@bob']);
});

test('normalizeLanguage accepts the three languages and falls back', () => {
  assert.equal(normalizeLanguage('ru'), 'ru');
  assert.equal(normalizeLanguage('EN'), 'en');
  assert.equal(normalizeLanguage('zh-CN'), 'zh');
  assert.equal(normalizeLanguage('fr', 'ru'), 'ru');
  assert.equal(normalizeLanguage('fr', 'en'), 'en');
  assert.equal(normalizeLanguage('es-ES'), 'en');
});

test('detectSystemLanguage follows supported locales and defaults to English', () => {
  assert.equal(detectSystemLanguage({ env: { LANG: 'ru_RU.UTF-8' } }), 'ru');
  assert.equal(detectSystemLanguage({ env: { LANG: 'en_US.UTF-8' } }), 'en');
  assert.equal(detectSystemLanguage({ env: { LANG: 'zh_CN.UTF-8' } }), 'zh');
  assert.equal(detectSystemLanguage({ env: { LC_ALL: 'ru_RU.UTF-8' } }), 'ru');
  assert.equal(detectSystemLanguage({ env: { LANG: 'es_ES.UTF-8' }, locale: 'ru-RU' }), 'en');
  assert.equal(detectSystemLanguage({ env: {}, locale: 'zh-TW' }), 'zh');
  assert.equal(detectSystemLanguage({ env: { LC_ALL: 'C', LANG: 'C.UTF-8' }, locale: 'en-US' }), 'en');
  assert.equal(detectSystemLanguage({ env: {}, locale: 'de-DE' }), 'en');
});

test('duration and tool counts are localized', () => {
  assert.equal(durationText(65_000, 'ru'), '1 мин 5 с');
  assert.equal(durationText(65_000, 'en'), '1m 5s');
  assert.equal(durationText(65_000, 'zh'), '1 分 5 秒');
  assert.equal(toolsText(1, 'en'), '1 tool');
  assert.equal(toolsText(3, 'en'), '3 tools');
  assert.equal(toolsText(3, 'zh'), '3 个工具');
  assert.equal(toolsText(3, 'ru'), '3 инструмента');
});

test('summary renders in English and Chinese', () => {
  const en = buildTurnSummary({
    title: 'Fix tests',
    cwd: 'project',
    durationMs: 65_000,
    tools: 3,
    reason: { kind: 'completed' },
    text: '**Done**',
    lang: 'en',
  });
  assert.match(en, /DSH finished the turn/);
  assert.match(en, /<b>Done<\/b>/);
  assert.match(en, /📁 #project · ⏱️ 1m 5s · 🛠 3 tools/);

  const zh = buildTurnSummary({
    title: '修复测试',
    cwd: 'project',
    durationMs: 65_000,
    tools: 3,
    reason: { kind: 'aborted' },
    text: '',
    lang: 'zh',
  });
  assert.match(zh, /DSH 已停止/);
  assert.match(zh, /📁 #project · ⏱️ 1 分 5 秒 · 🛠 3 个工具/);
});

test('translate falls back to Russian for unknown keys', () => {
  assert.equal(translate('en', 'bot.approval.allow'), '✅ Allow');
  assert.equal(translate('zh', 'bot.question.done'), '✅ 完成');
  assert.equal(translate('en', 'bot.status.questions', { count: 2 }), 'Pending questions: 2');
  assert.equal(translate('ru', 'panel.unknown.key'), 'panel.unknown.key');
});
