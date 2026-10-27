import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { TelegramBot } from '../lib/telegram.js';
import { Relay } from '../lib/relay.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

let sent = [];
let sequence = 0;
let updateHandler = null;
let restore = () => {};

function patchBot() {
  const proto = TelegramBot.prototype;
  const originals = {
    getMe: proto.getMe,
    start: proto.start,
    sendMessage: proto.sendMessage,
    editMessage: proto.editMessage,
    answerCallback: proto.answerCallback,
    setMyCommands: proto.setMyCommands,
  };
  sent = [];
  sequence = 0;
  updateHandler = null;

  proto.getMe = async () => ({ id: 1, username: 'test_bot', first_name: 'Test' });
  proto.start = async function start({ onUpdate } = {}) {
    updateHandler = onUpdate;
    return await this.getMe();
  };
  proto.sendMessage = async function sendMessage(chatId, text) {
    sequence += 1;
    const message = { id: sequence, chatId, text };
    sent.push(message);
    return { message_id: sequence };
  };
  proto.editMessage = async function editMessage(chatId, messageId, text) {
    sent.push({ id: messageId, chatId, text, edit: true });
  };
  proto.answerCallback = async () => {};
  proto.setMyCommands = async () => {};

  const running = Object.getOwnPropertyDescriptor(proto, 'running');
  const me = Object.getOwnPropertyDescriptor(proto, 'me');
  Object.defineProperty(proto, 'running', { configurable: true, get: () => true });
  Object.defineProperty(proto, 'me', {
    configurable: true,
    get: () => ({ id: 1, username: 'test_bot', first_name: 'Test' }),
  });

  restore = () => {
    Object.assign(proto, originals);
    if (running) Object.defineProperty(proto, 'running', running);
    if (me) Object.defineProperty(proto, 'me', me);
  };
}

async function startRelay({ chatId = '42', allowedUsers } = {}) {
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-relay-flow-'));
  const ctx = fakeContext();
  const relay = new Relay(ctx, { port: 0, language: 'ru' });
  await relay.start();
  await relay.saveConfig({
    token: '123456:test',
    ...(chatId ? { chatId } : {}),
    ...(allowedUsers !== undefined ? { allowedUsers } : {}),
  });
  for (let attempt = 0; attempt < 50 && !relay.state().running; attempt += 1) await sleep(10);
  assert.ok(relay.state().running, 'bot is running');
  return { ctx, relay };
}

function buttonFor(message, index = 0) {
  return message.keyboard.inline_keyboard.flat()[index].callback_data;
}

test('question is delivered, answered by a button, and resolved', async () => {
  patchBot();
  const { ctx, relay } = await startRelay();
  try {
    const controller = new AbortController();
    const request = {
      questions: [
        {
          id: 'q1',
          question: 'Какой вариант?',
          options: [{ label: 'Первый' }, { label: 'Второй' }],
        },
      ],
      signal: controller.signal,
      agent: { session: { id: 'session-test', header: { cwd: '/work/project' } } },
    };
    let sentKeyboard = null;
    const originalSend = TelegramBot.prototype.sendMessage;
    TelegramBot.prototype.sendMessage = async function send(chatId, text, options) {
      const result = await originalSend.call(this, chatId, text);
      if (options?.keyboard) sentKeyboard = options.keyboard;
      return result;
    };
    try {
      const answer = ctx.listeners.get('user-questions/request')(request, () =>
        Promise.reject(new Error('no local answerer')),
      );
      await sleep(30);
      assert.ok(sent.some((message) => message.text.includes('DSH спрашивает')));
      const message = sent.find((item) => item.text.includes('DSH спрашивает'));
      const data = sentKeyboard.inline_keyboard[0][0].callback_data;
      assert.match(data, /^q\|[0-9a-f]+\|0\|0$/);
      await updateHandler({ callback_query: { id: 'cb1', from: { id: 42, username: 'owner' }, data } });
      const payload = await answer;
      assert.deepEqual(payload, { answers: [{ id: 'q1', selected: ['Первый'] }] });
      assert.ok(message);
    } finally {
      TelegramBot.prototype.sendMessage = originalSend;
    }
  } finally {
    await relay.dispose();
    restore();
  }
});

test('free-text reply answers a question without options', async () => {
  patchBot();
  const { ctx, relay } = await startRelay();
  try {
    const controller = new AbortController();
    const request = {
      questions: [{ id: 'q1', question: 'Назови ветку' }],
      signal: controller.signal,
      agent: { session: { id: 'session-test', header: { cwd: '/w' } } },
    };
    const answer = ctx.listeners.get('user-questions/request')(request, () =>
      Promise.reject(new Error('no local answerer')),
    );
    await sleep(30);
    const question = sent.find((message) => message.text.includes('DSH спрашивает'));
    assert.ok(question);
    await updateHandler({
      message: {
        chat: { id: 42, type: 'private' },
        from: { id: 42, username: 'owner' },
        text: 'feature/x',
        reply_to_message: { message_id: question.id },
      },
    });
    const payload = await answer;
    assert.deepEqual(payload, { answers: [{ id: 'q1', selected: [], custom: 'feature/x' }] });
  } finally {
    await relay.dispose();
    restore();
  }
});

test('approval is delivered with allow/deny buttons and resolved', async () => {
  patchBot();
  const { ctx, relay } = await startRelay();
  try {
    const controller = new AbortController();
    const request = {
      agent: { session: { id: 'session-test', header: { cwd: '/w' } } },
      toolName: 'write',
      reason: 'нужно записать файл',
      signal: controller.signal,
    };
    let keyboard = null;
    const originalSend = TelegramBot.prototype.sendMessage;
    TelegramBot.prototype.sendMessage = async function send(chatId, text, options) {
      const result = await originalSend.call(this, chatId, text);
      if (options?.keyboard) keyboard = options.keyboard;
      return result;
    };
    try {
      const outcome = ctx.listeners.get('approval/request')(request, () => Promise.resolve('unavailable'));
      await sleep(30);
      const message = sent.find((item) => item.text.includes('Нужно разрешение'));
      assert.ok(message);
      const data = buttonFor({ keyboard }, 0);
      assert.match(data, /^a\|[0-9a-f]+\|allow$/);
      await updateHandler({ callback_query: { id: 'cb2', from: { id: 42, username: 'owner' }, data } });
      assert.equal(await outcome, 'allowed-once');
    } finally {
      TelegramBot.prototype.sendMessage = originalSend;
    }
  } finally {
    await relay.dispose();
    restore();
  }
});

test('a batch completes only after every question is answered', async () => {
  patchBot();
  const { ctx, relay } = await startRelay();
  try {
    const controller = new AbortController();
    const request = {
      questions: [
        { id: 'q1', question: 'Первый?', options: [{ label: 'Да' }, { label: 'Нет' }] },
        { id: 'q2', question: 'Второй?' },
      ],
      signal: controller.signal,
      agent: { session: { id: 's', header: { cwd: '/w' } } },
    };
    let firstKeyboard = null;
    const originalSend = TelegramBot.prototype.sendMessage;
    TelegramBot.prototype.sendMessage = async function send(chatId, text, options) {
      const result = await originalSend.call(this, chatId, text);
      if (options?.keyboard && text.includes('Первый?')) firstKeyboard = options.keyboard;
      return result;
    };
    try {
      const answer = ctx.listeners.get('user-questions/request')(request, () =>
        Promise.reject(new Error('no local answerer')),
      );
      await sleep(30);
      const questionMessages = sent.filter((message) => message.text.includes('DSH спрашивает'));
      assert.equal(questionMessages.length, 2);
      await updateHandler({ callback_query: { id: 'cb3', from: { id: 42, username: 'owner' }, data: firstKeyboard.inline_keyboard[0][0].callback_data } });
      await sleep(20);
      await updateHandler({
        message: {
          chat: { id: 42, type: 'private' },
          from: { id: 42, username: 'owner' },
          text: 'второй ответ',
          reply_to_message: { message_id: questionMessages[1].id },
        },
      });
      const payload = await answer;
      assert.deepEqual(payload, {
        answers: [
          { id: 'q1', selected: ['Да'] },
          { id: 'q2', selected: [], custom: 'второй ответ' },
        ],
      });
    } finally {
      TelegramBot.prototype.sendMessage = originalSend;
    }
  } finally {
    await relay.dispose();
    restore();
  }
});

test('whitelist blocks a stranger callback and accepts the allowed user', async () => {
  patchBot();
  const { ctx, relay } = await startRelay({ allowedUsers: '@alice' });
  try {
    const controller = new AbortController();
    const request = {
      questions: [{ id: 'q1', question: 'Выбор', options: [{ label: 'A' }, { label: 'B' }] }],
      signal: controller.signal,
      agent: { session: { id: 's', header: { cwd: '/w' } } },
    };
    let keyboard = null;
    const originalSend = TelegramBot.prototype.sendMessage;
    TelegramBot.prototype.sendMessage = async function send(chatId, text, options) {
      const result = await originalSend.call(this, chatId, text);
      if (options?.keyboard) keyboard = options.keyboard;
      return result;
    };
    try {
      const answer = ctx.listeners.get('user-questions/request')(request, () =>
        Promise.reject(new Error('no local answerer')),
      );
      await sleep(30);
      const data = keyboard.inline_keyboard[0][0].callback_data;
      let settled = false;
      answer.then(() => { settled = true; }, () => { settled = true; });

      await updateHandler({ callback_query: { id: 'bob', from: { id: 7, username: 'bob' }, data } });
      await sleep(30);
      assert.equal(settled, false, 'stranger cannot answer');

      await updateHandler({ callback_query: { id: 'alice', from: { id: 8, username: 'alice' }, data } });
      assert.deepEqual(await answer, { answers: [{ id: 'q1', selected: ['A'] }] });
    } finally {
      TelegramBot.prototype.sendMessage = originalSend;
    }
  } finally {
    await relay.dispose();
    restore();
  }
});

test('whitelist decides who may bind the chat', async () => {
  patchBot();
  const { relay } = await startRelay({ chatId: '', allowedUsers: '@alice' });
  try {
    assert.equal(relay.state().chatId, null);
    await updateHandler({
      message: { chat: { id: 7, type: 'private' }, from: { id: 7, username: 'bob' }, text: '/start' },
    });
    assert.equal(relay.state().chatId, null, 'stranger cannot bind');
    await updateHandler({
      message: { chat: { id: 8, type: 'private' }, from: { id: 8, username: 'alice' }, text: '/start' },
    });
    assert.equal(relay.state().chatId, '8');
    assert.deepEqual(relay.state().allowedUsers, ['@alice']);
  } finally {
    await relay.dispose();
    restore();
  }
});

test('without a whitelist the first /start becomes the owner', async () => {
  patchBot();
  const { relay } = await startRelay({ chatId: '' });
  try {
    await updateHandler({
      message: { chat: { id: 7, type: 'private' }, from: { id: 7, username: 'bob' }, text: '/start' },
    });
    assert.equal(relay.state().chatId, '7');
    assert.equal(relay.state().owner?.id, '7');
  } finally {
    await relay.dispose();
    restore();
  }
});

test('bot messages follow the configured language', async () => {
  patchBot();
  const { ctx, relay } = await startRelay();
  try {
    await relay.saveConfig({ language: 'en' });
    assert.equal(relay.state().language, 'en');

    await updateHandler({
      message: { chat: { id: 42, type: 'private' }, from: { id: 42, username: 'owner' }, text: '/status' },
    });
    const status = sent.find((message) => message.text.includes('Pending questions:'));
    assert.ok(status, 'status is in English');
    assert.match(status.text, /Bot: @test_bot/);

    const controller = new AbortController();
    const answer = ctx.listeners.get('user-questions/request')(
      {
        questions: [{ id: 'q1', question: 'Which one?', options: [{ label: 'A' }] }],
        signal: controller.signal,
        agent: { session: { id: 's', header: { cwd: '/w' } } },
      },
      () => Promise.reject(new Error('no local answerer')),
    );
    await sleep(30);
    const question = sent.find((message) => message.text.includes('DSH asks'));
    assert.ok(question, 'question is in English');
    assert.match(question.text, /Which one\?/);
    controller.abort();
    await assert.rejects(answer);
  } finally {
    await relay.dispose();
    restore();
  }
});

test('token is retried from late credentials and survives a restart locally', async () => {
  patchBot();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-relay-token-'));
  process.env.DSH_HOME = home;
  try {
    const services = {};
    const ctx = {
      ...fakeContext(),
      get(name) {
        return services[name];
      },
    };
    const relay = new Relay(ctx, { port: 0 });
    await relay.start();
    assert.equal(relay.state().configured, false);

    services.credentials = {
      resolve: async () => ({ value: '111:first' }),
      set: async () => {},
    };
    relay.attachCredentials();
    await sleep(50);
    assert.equal(relay.state().configured, true);
    assert.equal(relay.state().tokenSource, 'credentials');
    assert.equal(relay.state().running, true);

    await relay.saveConfig({ token: '222:second' });
    const stored = JSON.parse(
      fs.readFileSync(path.join(home, 'storages', 'telegram-relay', 'config.json'), 'utf8'),
    );
    assert.equal(stored.token, '222:second');
    await relay.dispose();

    const restart = new Relay({ ...fakeContext(), get: () => undefined }, { port: 0 });
    await restart.start();
    assert.equal(restart.state().configured, true);
    assert.equal(restart.state().tokenSource, 'file');
    await restart.dispose();
  } finally {
    await restore();
  }
});

test('a local answer wins and closes the Telegram copy', async () => {
  patchBot();
  const { ctx, relay } = await startRelay();
  try {
    const controller = new AbortController();
    const request = {
      questions: [
        { id: 'q1', question: 'Выбор', options: [{ label: 'A' }, { label: 'B' }] },
      ],
      signal: controller.signal,
      agent: { session: { id: 's', header: { cwd: '/w' } } },
    };
    const localAnswer = { answers: [{ id: 'q1', selected: ['B'] }] };
    const answer = ctx.listeners.get('user-questions/request')(request, () =>
      Promise.resolve(localAnswer),
    );
    await sleep(30);
    assert.deepEqual(await answer, localAnswer);
    assert.ok(sent.some((message) => message.edit && message.text.includes('Ответ дан в DSH')));
  } finally {
    await relay.dispose();
    restore();
  }
});
