import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Relay } from '../lib/relay.js';
import { apply } from '../lib/index.js';
import { DICT } from '../lib/i18n.js';

function fakeContext() {
  const listeners = new Map();
  return {
    listeners,
    logger: { info() {}, warn() {}, error() {} },
    on(name, handler) {
      listeners.set(name, handler);
      return () => listeners.delete(name);
    },
    effect(callback) {
      callback();
      return () => {};
    },
    get() {
      return undefined;
    },
  };
}

test('relay starts the control panel and serves state', async () => {
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-relay-'));
  const ctx = fakeContext();
  const relay = new Relay(ctx, { port: 0, language: 'ru' });
  await relay.start();
  try {
    const state = relay.state();
    assert.ok(state.url, 'panel URL is available');
    const response = await fetch(`${state.url}/api/state`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.state.configured, false);
    assert.deepEqual(payload.state.pending, { questions: 0, approvals: 0 });
    assert.equal(payload.state.notifySubagents, true);
    assert.equal(payload.state.notifySubagentTurnEnd, true);
    assert.equal(payload.state.notifySubagentQuestions, true);

    const page = await fetch(`${state.url}/`);
    assert.equal(page.status, 200);
    const markup = await page.text();
    assert.match(markup, /DSH · Telegram Relay/);
    assert.match(markup, /id="allowed"/);
    assert.match(markup, /id="subagents"/);
    assert.match(markup, /id="subagentTurnEnd"/);
    assert.match(markup, /id="subagentQuestions"/);
    assert.match(markup, /id="reset"/);
    assert.match(markup, /id="lang"/);
    assert.match(markup, /<option value="ru">Русский<\/option>/);
    assert.match(markup, /<option value="en">English<\/option>/);
    assert.match(markup, /<option value="zh">中文<\/option>/);
    assert.match(markup, /let LANG = "ru"/);
    assert.match(markup, /replace\(\/\\\{\(\\w\+\)\\\}\/g/);
    const pageKeys = [...markup.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(pageKeys.length > 0);
    for (const key of pageKeys) assert.ok(key in DICT.ru, `missing translation ${key}`);
    const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(markup)?.[1];
    assert.ok(inlineScript, 'page carries an inline script');
    assert.doesNotThrow(() => new Function(inlineScript), 'inline script parses');

    const csrf = /const CSRF = "([^"]+)"/.exec(markup)?.[1];
    assert.ok(csrf, 'page carries a CSRF token');
    const saved = await fetch(`${state.url}/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-csrf': csrf },
      body: JSON.stringify({ allowedUsers: '@alice, https://t.me/bob' }),
    });
    assert.equal(saved.status, 200);
    const savedState = (await saved.json()).state;
    assert.deepEqual(savedState.allowedUsers, ['@alice', '@bob']);

    const subagents = await fetch(`${state.url}/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-csrf': csrf },
      body: JSON.stringify({
        notifySubagents: false,
        notifySubagentTurnEnd: false,
        notifySubagentQuestions: true,
      }),
    });
    assert.equal(subagents.status, 200);
    const subagentState = (await subagents.json()).state;
    assert.equal(subagentState.notifySubagents, false);
    assert.equal(subagentState.notifySubagentTurnEnd, false);
    assert.equal(subagentState.notifySubagentQuestions, true);

    const english = await fetch(`${state.url}/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-csrf': csrf },
      body: JSON.stringify({ language: 'en' }),
    });
    assert.equal(english.status, 200);
    const englishState = (await english.json()).state;
    assert.equal(englishState.language, 'en');
    assert.match(relay.t('bot.deny'), /bound to another user/);

    const badChat = await fetch(`${state.url}/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-csrf': csrf },
      body: JSON.stringify({ chatId: 'not a chat' }),
    });
    assert.equal(badChat.status, 400);
    assert.match((await badChat.json()).error, /chat id must be a number/);

    const reset = await fetch(`${state.url}/api/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-csrf': csrf },
      body: '{}',
    });
    assert.equal(reset.status, 200);

    const forbidden = await fetch(`${state.url}/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: '1' }),
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await relay.dispose();
  }
});

test('relay registers the session, question and approval listeners', async () => {
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-relay-'));
  const ctx = fakeContext();
  const relay = new Relay(ctx, { port: 0, language: 'ru' });
  await relay.start();
  try {
    assert.ok(ctx.listeners.has('session/event'));
    assert.ok(ctx.listeners.has('user-questions/request'));
    assert.ok(ctx.listeners.has('approval/request'));
  } finally {
    await relay.dispose();
  }
});

test('plugin entry starts the panel and disposes with the fiber', async () => {
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-relay-'));
  const lines = [];
  const cleanups = [];
  const ctx = {
    listeners: new Map(),
    logger: {
      info: (line) => lines.push(String(line)),
      warn: () => {},
      error: () => {},
    },
    on(name, handler) {
      this.listeners.set(name, handler);
      return () => this.listeners.delete(name);
    },
    effect(callback) {
      cleanups.push(callback());
      return () => {};
    },
    get() {
      return undefined;
    },
  };
  apply(ctx, { port: 0, language: 'ru' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(lines.some((line) => line.includes('панель управления')), 'panel started');
  for (const cleanup of cleanups) await cleanup();
});
