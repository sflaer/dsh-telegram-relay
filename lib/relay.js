/**
 * The relay core: owns the bot, the control-panel state, the pending question
 * and approval registries, and the per-turn summary tracker.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { TelegramBot } from './telegram.js';
import { startControlServer } from './server.js';
import {
  baseName,
  clip,
  escapeHtml,
  firstLine,
  isQuestionPrompt,
  renderMarkdown,
  splitMessage,
} from './format.js';
import { detectSystemLanguage, durationText, normalizeLanguage, toolsText, translate } from './i18n.js';

/** Build marker: bump when behavior changes so the panel shows what is running. */
export const BUILD = '0.1.0+2026-10-27.6';

/** One-shot promise pair without relying on `Promise.withResolvers` typing. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function randomId() {
  return randomBytes(5).toString('hex');
}

/** Join the text blocks of a recorded message (or a bare block array). */
export function textOfMessage(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n');
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** Default Russian translator for standalone helpers and tests. */
const ruT = (key, params) => translate('ru', key, params);

function normalizeChatId(value, t = ruT) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^-?\d{1,20}$/.test(text)) return text;
  if (/^@[A-Za-z0-9_]{3,64}$/.test(text)) return text;
  throw new Error(t('error.chatId'));
}

/**
 * Normalize one whitelist entry to `@username` or `id:<digits>`.
 * Accepts `@name`, a bare name, `t.me/name`, `https://t.me/name`, and
 * `tg://user?id=…` (or a bare numeric id).
 */
export function normalizeAllowedUser(value, t = ruT) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^\d{3,20}$/.test(text)) return `id:${text}`;
  const idLink = /^(?:tg:\/\/user\?id=|https?:\/\/(?:www\.)?t\.me\/user\?id=)(\d{3,20})$/i.exec(text);
  if (idLink) return `id:${idLink[1]}`;
  const named = /^(?:https?:\/\/(?:www\.)?t\.me\/|t\.me\/|telegram\.me\/)([A-Za-z0-9_]{3,32})\/?$/i.exec(text);
  if (named) return `@${named[1].toLowerCase()}`;
  if (/^@[A-Za-z0-9_]{3,32}$/.test(text)) return `@${text.slice(1).toLowerCase()}`;
  if (/^[A-Za-z0-9_]{3,32}$/.test(text)) return `@${text.toLowerCase()}`;
  throw new Error(t('error.allowedUser', { value: text }));
}

/** Parse a comma/space/newline separated whitelist into normalized entries. */
export function parseAllowedUsers(value, t = ruT) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/);
  const result = [];
  for (const part of parts) {
    const normalized = normalizeAllowedUser(part, t);
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeConfig(config = {}) {
  const number = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    port: Math.trunc(number(config.port, 7810)),
    host: '127.0.0.1',
    language: normalizeLanguage(config.language || detectSystemLanguage(), 'en'),
    apiBase: typeof config.apiBase === 'string' && config.apiBase ? config.apiBase : 'https://api.telegram.org',
    tokenEnv:
      typeof config.tokenEnv === 'string' && config.tokenEnv ? config.tokenEnv : 'TELEGRAM_RELAY_BOT_TOKEN',
    notifyTurnEnd: config.notifyTurnEnd !== false,
    notifyQuestions: config.notifyQuestions !== false,
    notifyApprovals: config.notifyApprovals !== false,
    notifySubagents: toBoolean(config.notifySubagents, true),
    notifySubagentTurnEnd: toBoolean(config.notifySubagentTurnEnd, true),
    notifySubagentQuestions: toBoolean(config.notifySubagentQuestions, true),
    summaryMaxChars: Math.max(200, Math.min(3900, Math.trunc(number(config.summaryMaxChars, 1500)))),
    minTurnMs: Math.max(0, Math.trunc(number(config.minTurnMs, 0))),
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    this.data = {};
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.data = {};
    }
    return this.data;
  }

  patch(values) {
    this.data = { ...this.data, ...values };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    } catch {
      /* a read-only home must not break delivery */
    }
  }
}

/** Fold turn/step/tool/assistant events into one finishable summary. */
export class TurnTracker {
  #turns = new Map();
  #lastUser = new Map();

  lastUserText(sessionId) {
    return this.#lastUser.get(sessionId) ?? '';
  }

  onEvent(session, event) {
    const sessionId = session?.id ?? '';
    if (event.type === 'user/message') {
      if (event.data?.source?.kind === 'user') {
        const text = textOfMessage(event.data);
        if (text) this.#lastUser.set(sessionId, text);
      }
      return null;
    }
    if (event.type === 'turn/start') {
      this.#turns.set(sessionId, {
        turn: event.data?.turn ?? 0,
        startedAt: event.time ?? Date.now(),
        tools: 0,
        steps: 0,
        text: '',
        prompt: this.#lastUser.get(sessionId) ?? '',
      });
      return null;
    }
    const state = this.#turns.get(sessionId);
    if (!state) return null;
    if (event.type === 'step/start') {
      state.steps += 1;
      return null;
    }
    if (event.type === 'tool/call') {
      state.tools += 1;
      return null;
    }
    if (event.type === 'assistant/message') {
      const text = textOfMessage(event.data?.message);
      if (text) state.text = text;
      return null;
    }
    if (event.type === 'turn/end') {
      this.#turns.delete(sessionId);
      return { state, reason: event.data?.reason ?? { kind: 'completed' }, endedAt: event.time ?? Date.now() };
    }
    return null;
  }
}

/** Render the Telegram message for a finished turn. */
export function buildTurnSummary({
  title,
  question,
  cwd,
  durationMs,
  tools,
  reason,
  text,
  maxChars = 1500,
  lang = 'ru',
}) {
  const t = (key, params) => translate(lang, key, params);
  const kind = reason?.kind ?? 'completed';
  const head = t(kind === 'aborted' ? 'summary.aborted' : kind === 'error' ? 'summary.error' : 'summary.done');
  const meta = [];
  if (cwd) meta.push(t('summary.folder', { name: escapeHtml(cwd) }));
  meta.push(t('summary.duration', { value: durationText(durationMs, lang) }));
  if (tools > 0) meta.push(t('summary.tools', { value: toolsText(tools, lang) }));
  const titleLine = `<i>${question ? '❓ ' : ''}${escapeHtml(title)}</i>`;
  const lines = [head, titleLine];
  if (kind === 'error') {
    const errorText = reason?.error?.message ?? reason?.error?.code ?? t('summary.unknownError');
    lines.push('', escapeHtml(clip(errorText, 400)));
  } else if (text) {
    let body = renderMarkdown(clip(text, maxChars));
    // A pathological amount of inline markup could exceed one Telegram message;
    // fall back to plain text rather than risk splitting an HTML tag.
    if (body.length > 3900) body = escapeHtml(clip(text, 3900));
    if (body) lines.push('', body);
  }
  lines.push('', meta.join(' · '));
  return lines.join('\n');
}

export class Relay {
  #ctx;
  #config;
  #store;
  #csrf = randomBytes(16).toString('hex');
  #bot = null;
  #chatId = '';
  #ownerUserId = '';
  #ownerUsername = '';
  #allowedUsers = [];
  #hasToken = false;
  #pendingQuestions = new Map();
  #pendingApprovals = new Map();
  #tracker = new TurnTracker();
  #recent = [];
  #lastError = null;
  #language = 'ru';
  #tokenSource = '';
  #lastTokenCheck = 0;
  #notifySubagents = true;
  #notifySubagentTurnEnd = true;
  #notifySubagentQuestions = true;
  #server = null;
  #startedAt = Date.now();
  #stopped = false;
  #registered = false;

  constructor(ctx, config = {}) {
    this.#ctx = ctx;
    this.#config = normalizeConfig(config);
    this.#language = this.#config.language;
    this.#store = new Store(path.join(dshHome(), 'storages', 'telegram-relay'));
  }

  get csrfToken() {
    return this.#csrf;
  }

  get language() {
    return this.#language;
  }

  /** Translate one key with the current panel/bot language. */
  t(key, params) {
    return translate(this.#language, key, params);
  }

  // ---------------------------------------------------------------- lifecycle

  async start() {
    const saved = this.#store.read();
    this.#language = normalizeLanguage(saved.language ?? this.#config.language, 'en');
    this.#chatId = String(saved.chatId ?? '');
    this.#ownerUserId = String(saved.ownerUserId ?? '');
    this.#ownerUsername = String(saved.ownerUsername ?? '').toLowerCase();
    this.#allowedUsers = Array.isArray(saved.allowedUsers)
      ? saved.allowedUsers.map((entry) => String(entry)).filter(Boolean)
      : [];
    this.#notifySubagents = toBoolean(saved.notifySubagents, this.#config.notifySubagents);
    this.#notifySubagentTurnEnd = toBoolean(
      saved.notifySubagentTurnEnd,
      this.#config.notifySubagentTurnEnd,
    );
    this.#notifySubagentQuestions = toBoolean(
      saved.notifySubagentQuestions,
      this.#config.notifySubagentQuestions,
    );
    const { token, source } = await this.#readToken(saved);
    this.#server = await startControlServer({
      relay: this,
      host: this.#config.host,
      port: this.#config.port,
    });
    this.#store.patch({ panelUrl: this.#server.url });
    this.#register();
    this.#log('log.build', { build: BUILD });
    this.#log('log.panel', { url: this.#server.url });
    if (token) {
      this.#hasToken = true;
      this.#tokenSource = source;
      void this.#startBot(token, Number(saved.offset) || 0);
    } else {
      this.#log('log.noToken');
    }
  }

  async dispose() {
    this.#stopped = true;
    this.#bot?.stop();
    for (const ask of this.#pendingQuestions.values()) {
      ask.settled = true;
      ask.deferred.reject(new Error('relay stopped'));
    }
    this.#pendingQuestions.clear();
    for (const approval of this.#pendingApprovals.values()) {
      approval.settled = true;
      approval.deferred.resolve('cancelled');
    }
    this.#pendingApprovals.clear();
    await this.#server?.close();
  }

  // ------------------------------------------------------------------- config

  /**
   * Resolve the bot token from the credential store first, then the plugin's
   * own state file, then the environment. The local copy makes a restart
   * independent of the credential service's load order.
   */
  async #readToken(saved = this.#store.data) {
    try {
      const credentials = this.#ctx.get?.('credentials');
      const hit = await credentials?.resolve?.(this.#config.tokenEnv);
      if (hit?.value) return { token: String(hit.value), source: 'credentials' };
    } catch (error) {
      this.#warn('log.credentialsResolveFailed', { error: error?.message ?? error });
    }
    if (typeof saved.token === 'string' && saved.token) return { token: saved.token, source: 'file' };
    const fromEnv = process.env[this.#config.tokenEnv];
    if (typeof fromEnv === 'string' && fromEnv) return { token: fromEnv, source: 'env' };
    return { token: '', source: '' };
  }

  async #writeToken(token) {
    let stored = false;
    try {
      const credentials = this.#ctx.get?.('credentials');
      if (credentials?.set) {
        await credentials.set(this.#config.tokenEnv, token);
        stored = true;
      }
    } catch (error) {
      this.#warn('log.credentialFailed', { error: error?.message ?? error });
    }
    // Always keep a local copy: the credential service may mount after this
    // plugin, and then a restart would otherwise lose the token.
    this.#store.patch({ token });
    this.#tokenSource = stored ? 'credentials+file' : 'file';
  }

  /** Called once the credential service is available, to pick up a stored token. */
  attachCredentials() {
    void this.#ensureToken(true);
  }

  async #ensureToken(force = false) {
    if (this.#stopped || this.#hasToken) return;
    const now = Date.now();
    if (!force && now - this.#lastTokenCheck < 3000) return;
    this.#lastTokenCheck = now;
    const { token, source } = await this.#readToken(this.#store.data);
    if (!token) return;
    this.#hasToken = true;
    this.#tokenSource = source;
    this.#log('log.tokenLoaded', { source });
    void this.#startBot(token, Number(this.#store.data.offset) || 0);
  }

  async #refreshCommands() {
    if (!this.#bot) return;
    try {
      await this.#bot.setMyCommands([
        { command: 'start', description: this.t('bot.command.start') },
        { command: 'status', description: this.t('bot.command.status') },
        { command: 'help', description: this.t('bot.command.help') },
      ]);
    } catch {
      /* menu descriptions are cosmetic */
    }
  }

  async #startBot(token, offset) {
    this.#bot?.stop();
    this.#bot = null;
    const bot = new TelegramBot({
      token,
      apiBase: this.#config.apiBase,
      logger: this.#ctx.logger,
    });
    bot.offset = offset;
    try {
      const me = await bot.start({
        onUpdate: (update) => this.#onUpdate(update),
        onOffset: (value) => this.#store.patch({ offset: value }),
        skipBacklog: true,
      });
      this.#bot = bot;
      this.#store.patch({ botUsername: me.username });
      this.#log('log.botReady', { username: me.username });
      void this.#refreshCommands();
    } catch (error) {
      bot.stop();
      this.#fail('log.botFailed', { error: error?.message ?? error });
    }
  }

  // ------------------------------------------------------------- control API

  state() {
    if (!this.#hasToken) void this.#ensureToken();
    const me = this.#bot?.me ?? null;
    return {
      url: this.#server?.url ?? null,
      port: this.#server?.port ?? this.#config.port,
      build: BUILD,
      language: this.#language,
      configured: this.#hasToken,
      tokenSource: this.#tokenSource || null,
      running: Boolean(this.#bot?.running),
      bot: me ? { id: me.id, username: me.username, name: me.first_name ?? '' } : null,
      chatId: this.#chatId || null,
      owner:
        this.#ownerUserId || this.#ownerUsername
          ? { id: this.#ownerUserId || null, username: this.#ownerUsername || null }
          : null,
      allowedUsers: [...this.#allowedUsers],
      notifySubagents: this.#notifySubagents,
      notifySubagentTurnEnd: this.#notifySubagentTurnEnd,
      notifySubagentQuestions: this.#notifySubagentQuestions,
      pending: {
        questions: this.#pendingQuestions.size,
        approvals: this.#pendingApprovals.size,
      },
      startedAt: this.#startedAt,
      uptimeSec: Math.round((Date.now() - this.#startedAt) / 1000),
      recent: this.#recent.slice(-30),
      lastError: this.#lastError ? this.t(this.#lastError.key, this.#lastError.params) : '',
    };
  }

  async saveConfig(input = {}) {
    this.#lastError = null;
    if (Object.hasOwn(input, 'language')) {
      const language = normalizeLanguage(input.language, this.#language);
      this.#language = language;
      this.#store.patch({ language });
      this.#log('log.language', { language });
      void this.#refreshCommands();
    }
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    if (token) {
      const probe = new TelegramBot({
        token,
        apiBase: this.#config.apiBase,
        logger: this.#ctx.logger,
      });
      let me;
      try {
        me = await probe.getMe();
      } catch (error) {
        throw new Error(this.t('error.tokenRejected', { error: error?.message ?? error }));
      }
      await this.#writeToken(token);
      this.#hasToken = true;
      this.#store.patch({ botUsername: me.username });
      this.#log('log.tokenSaved', { username: me.username });
      void this.#startBot(token, this.#store.data.offset ?? 0);
    }
    if (Object.hasOwn(input, 'chatId')) {
      const chatId = normalizeChatId(input.chatId, this.t.bind(this));
      this.#chatId = chatId;
      this.#store.patch({ chatId });
      this.#log(chatId ? 'log.chatBound' : 'log.chatUnbound', { chatId });
    }
    if (Object.hasOwn(input, 'allowedUsers')) {
      const allowedUsers = parseAllowedUsers(input.allowedUsers, this.t.bind(this));
      this.#allowedUsers = allowedUsers;
      this.#store.patch({ allowedUsers });
      this.#log(allowedUsers.length > 0 ? 'log.whitelist' : 'log.whitelistEmpty', {
        users: allowedUsers.join(', '),
      });
    }
    if (Object.hasOwn(input, 'notifySubagents')) {
      this.#notifySubagents = toBoolean(input.notifySubagents, this.#notifySubagents);
      this.#store.patch({ notifySubagents: this.#notifySubagents });
    }
    if (Object.hasOwn(input, 'notifySubagentTurnEnd')) {
      this.#notifySubagentTurnEnd = toBoolean(
        input.notifySubagentTurnEnd,
        this.#notifySubagentTurnEnd,
      );
      this.#store.patch({ notifySubagentTurnEnd: this.#notifySubagentTurnEnd });
    }
    if (Object.hasOwn(input, 'notifySubagentQuestions')) {
      this.#notifySubagentQuestions = toBoolean(
        input.notifySubagentQuestions,
        this.#notifySubagentQuestions,
      );
      this.#store.patch({ notifySubagentQuestions: this.#notifySubagentQuestions });
    }
    return this.state();
  }

  /** Clear the chat binding and its auto-assigned owner (the whitelist stays). */
  resetBinding() {
    this.#chatId = '';
    this.#ownerUserId = '';
    this.#ownerUsername = '';
    this.#store.patch({ chatId: '', ownerUserId: '', ownerUsername: '' });
    this.#log('log.bindingReset');
    return this.state();
  }

  async sendTest() {
    if (!this.#bot?.running) throw new Error(this.t('error.botNotRunning'));
    if (!this.#chatId) throw new Error(this.t('error.chatNotBound'));
    await this.#bot.sendMessage(this.#chatId, this.t('bot.test'));
    this.#log('log.testSent');
    return this.state();
  }

  // --------------------------------------------------------------- listeners

  #register() {
    if (this.#registered) return;
    this.#registered = true;
    this.#ctx.on('session/event', (session, event) => {
      try {
        this.#onSessionEvent(session, event);
      } catch (error) {
        this.#warn('log.sessionHandlerFailed', { error: error?.message ?? error });
      }
    });
    this.#ctx.on(
      'user-questions/request',
      (request, next) => this.#onQuestionRequest(request, next),
      { prepend: true },
    );
    this.#ctx.on(
      'approval/request',
      (request, next) => this.#onApprovalRequest(request, next),
      { prepend: true },
    );
  }

  #onSessionEvent(session, event) {
    const subagent = session?.header?.origin === 'subagent';
    if (subagent && (!this.#notifySubagents || !this.#notifySubagentTurnEnd)) return;
    const finished = this.#tracker.onEvent(session, event);
    if (!finished || !this.#config.notifyTurnEnd) return;
    const durationMs = Math.max(0, finished.endedAt - finished.state.startedAt);
    if (durationMs < this.#config.minTurnMs) return;
    if (!this.#canNotify()) return;
    const title = this.#titleOf(session, finished.state.prompt);
    const text = buildTurnSummary({
      title,
      question: isQuestionPrompt(finished.state.prompt),
      cwd: baseName(session?.header?.cwd),
      durationMs,
      tools: finished.state.tools,
      reason: finished.reason,
      text: finished.state.text,
      maxChars: this.#config.summaryMaxChars,
      lang: this.#language,
    });
    void this.#bot
      .sendMessage(this.#chatId, text)
      .catch((error) => this.#fail('log.summaryFailed', { error: error?.message ?? error }));
  }

  // --------------------------------------------------------------- questions

  #onQuestionRequest(request, next) {
    if (!this.#config.notifyQuestions || !this.#canNotify()) return next();
    if (
      request?.agent?.session?.header?.origin === 'subagent' &&
      (!this.#notifySubagents || !this.#notifySubagentQuestions)
    ) {
      return next();
    }
    const questions = Array.isArray(request?.questions) ? request.questions : [];
    if (questions.length === 0) return next();
    const ask = {
      id: randomId(),
      kind: 'question',
      request,
      questions,
      chatId: this.#chatId,
      title: this.#titleOf(request?.agent?.session, ''),
      answers: new Map(),
      messages: new Map(),
      texts: new Map(),
      marked: new Set(),
      awaiting: null,
      settled: false,
      deferred: deferred(),
      abortListener: null,
    };
    this.#pendingQuestions.set(ask.id, ask);
    this.#log('log.questionForwarded', { count: questions.length });

    const viaTelegram = this.#deliverQuestions(ask);
    const viaLocal = Promise.resolve().then(next);

    return new Promise((resolve, reject) => {
      let done = false;
      let remaining = 2;
      let localError;
      const settle = (value, source) => {
        if (done) return;
        done = true;
        this.#finishAsk(ask, source);
        resolve(value);
      };
      const fail = (error) => {
        if (done) return;
        remaining -= 1;
        if (remaining > 0) return;
        done = true;
        this.#finishAsk(ask, 'error');
        reject(localError ?? error);
      };
      viaLocal.then(
        (value) => settle(value, 'local'),
        (error) => {
          localError = error;
          fail(error);
        },
      );
      viaTelegram.then(
        (value) => settle(value, 'telegram'),
        (error) => fail(error),
      );
    });
  }

  async #deliverQuestions(ask) {
    const signal = ask.request?.signal;
    if (signal) {
      ask.abortListener = () => this.#abortAsk(ask);
      signal.addEventListener('abort', ask.abortListener, { once: true });
    }
    for (let index = 0; index < ask.questions.length; index += 1) {
      const question = ask.questions[index];
      if (typeof question.detail === 'string' && question.detail.trim()) {
        const detail = clip(question.detail.trim(), 6000);
        for (const chunk of splitMessage(detail, 3500)) {
          await this.#bot.sendMessage(
            ask.chatId,
            `${this.t('bot.question.details')}\n\n${escapeHtml(chunk)}`,
          );
        }
      }
      const hasOptions = Array.isArray(question.options) && question.options.length > 0;
      const text = this.#renderQuestion(ask, index);
      const sent = await this.#bot.sendMessage(ask.chatId, text, {
        ...(hasOptions ? { keyboard: this.#questionKeyboard(ask, index) } : {}),
      });
      ask.messages.set(index, sent.message_id);
      ask.texts.set(index, text);
    }
    return await ask.deferred.promise;
  }

  #renderQuestion(ask, index) {
    const question = ask.questions[index];
    const total = ask.questions.length;
    const lines = [this.t('bot.question.title'), `<i>${escapeHtml(ask.title)}</i>`, ''];
    if (total > 1) lines.push(this.t('bot.question.progress', { index: index + 1, total }));
    if (question.header) lines.push(`<b>${escapeHtml(question.header)}</b>`);
    lines.push(escapeHtml(question.question));
    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length > 0) {
      lines.push('');
      options.forEach((option, optionIndex) => {
        const description = option.description ? ` — ${escapeHtml(option.description)}` : '';
        lines.push(`${optionIndex + 1}. <b>${escapeHtml(option.label)}</b>${description}`);
      });
      if (question.multiSelect) lines.push('', `<i>${this.t('bot.question.multiHint')}</i>`);
    } else {
      lines.push('', `<i>${this.t('bot.question.textHint')}</i>`);
    }
    return lines.join('\n');
  }

  #questionKeyboard(ask, index) {
    const question = ask.questions[index];
    const rows = [];
    const answer = ask.answers.get(index);
    (question.options ?? []).forEach((option, optionIndex) => {
      const chosen = answer?.selected?.has(option.label);
      rows.push([
        {
          text: `${chosen ? '✓ ' : ''}${clip(option.label, 40)}`,
          callback_data: `q|${ask.id}|${index}|${optionIndex}`,
        },
      ]);
    });
    rows.push([{ text: this.t('bot.question.other'), callback_data: `q|${ask.id}|${index}|c` }]);
    if (question.multiSelect) {
      rows.push([{ text: this.t('bot.question.done'), callback_data: `q|${ask.id}|done` }]);
    }
    return { inline_keyboard: rows };
  }

  #allAnswered(ask) {
    return ask.questions.every((_, index) => {
      const answer = ask.answers.get(index);
      return Boolean(answer && (answer.custom || answer.selected?.size > 0));
    });
  }

  #maybeComplete(ask) {
    if (!this.#allAnswered(ask)) return false;
    const payload = {
      answers: ask.questions.map((question, index) => {
        const answer = ask.answers.get(index);
        return {
          id: question.id,
          selected: [...(answer?.selected ?? [])],
          ...(answer?.custom ? { custom: answer.custom } : {}),
        };
      }),
    };
    ask.deferred.resolve(payload);
    return true;
  }

  async #onQuestionChoice(ask, index, optionIndex) {
    const question = ask.questions[index];
    const option = question.options?.[optionIndex];
    if (!option) return;
    let answer = ask.answers.get(index);
    if (!answer) {
      answer = { selected: new Set(), custom: '' };
      ask.answers.set(index, answer);
    }
    if (question.multiSelect) {
      if (answer.selected.has(option.label)) answer.selected.delete(option.label);
      else answer.selected.add(option.label);
      await this.#refreshQuestionMessage(ask, index);
      return;
    }
    answer.selected = new Set([option.label]);
    answer.custom = '';
    await this.#refreshQuestionMessage(ask, index, `✅ <i>${escapeHtml(option.label)}</i>`);
    this.#maybeComplete(ask);
  }

  async #refreshQuestionMessage(ask, index, suffix = '') {
    const messageId = ask.messages.get(index);
    if (!messageId) return;
    const base = ask.texts.get(index) ?? '';
    const multi = ask.questions[index]?.multiSelect;
    if (suffix) ask.marked.add(index);
    try {
      await this.#bot.editMessage(ask.chatId, messageId, suffix ? `${base}\n\n${suffix}` : base, {
        ...(multi ? { keyboard: this.#questionKeyboard(ask, index) } : {}),
      });
    } catch (error) {
      this.#warn('log.editQuestionFailed', { error: error?.message ?? error });
    }
  }

  async #answerCustom(ask, index, value) {
    const text = String(value ?? '').trim();
    if (!text) return;
    const existing = ask.answers.get(index) ?? { selected: new Set(), custom: '' };
    existing.custom = text;
    // A typed answer overrides a single choice; it supplements a multi-select.
    if (!ask.questions[index]?.multiSelect) existing.selected = new Set();
    ask.answers.set(index, existing);
    const messageId = ask.messages.get(index);
    const base = ask.texts.get(index) ?? '';
    if (messageId) {
      try {
        await this.#bot.editMessage(
          ask.chatId,
          messageId,
          `${base}\n\n✏️ <i>${escapeHtml(clip(text, 500))}</i>`,
        );
      } catch (error) {
        this.#warn('log.answerFailed', { error: error?.message ?? error });
      }
    }
    this.#maybeComplete(ask);
  }

  #abortAsk(ask) {
    if (ask.settled) return;
    ask.settled = true;
    this.#pendingQuestions.delete(ask.id);
    ask.deferred.reject(new Error('question aborted'));
    void this.#markAsk(ask, `\n\n${this.t('bot.question.cancelled')}`);
  }

  #finishAsk(ask, source) {
    if (ask.settled) return;
    ask.settled = true;
    this.#pendingQuestions.delete(ask.id);
    if (ask.abortListener && ask.request?.signal) {
      ask.request.signal.removeEventListener('abort', ask.abortListener);
    }
    const suffix =
      source === 'local'
        ? `\n\n${this.t('bot.question.answeredLocal')}`
        : source === 'error'
          ? `\n\n${this.t('bot.question.inactive')}`
          : `\n\n${this.t('bot.question.answeredTelegram')}`;
    void this.#markAsk(ask, suffix);
  }

  async #markAsk(ask, suffix) {
    for (const [index, messageId] of ask.messages) {
      if (ask.marked.has(index)) continue;
      const base = ask.texts.get(index) ?? '';
      try {
        await this.#bot.editMessage(ask.chatId, messageId, `${base}${suffix}`);
      } catch (error) {
        this.#warn('log.closeQuestionFailed', { error: error?.message ?? error });
      }
    }
  }

  // --------------------------------------------------------------- approvals

  #onApprovalRequest(request, next) {
    const local = Promise.resolve()
      .then(next)
      .then(
        (value) => value,
        () => 'unavailable',
      );
    if (!this.#config.notifyApprovals || !this.#canNotify()) return local;
    if (
      request?.agent?.session?.header?.origin === 'subagent' &&
      (!this.#notifySubagents || !this.#notifySubagentQuestions)
    ) {
      return local;
    }
    const approval = {
      id: randomId(),
      request,
      chatId: this.#chatId,
      title: this.#titleOf(request?.agent?.session, ''),
      messageId: null,
      settled: false,
      deferred: deferred(),
      abortListener: null,
    };
    this.#pendingApprovals.set(approval.id, approval);
    const viaTelegram = this.#deliverApproval(approval);
    this.#log('log.approvalForwarded', { tool: request?.toolName ?? 'tool' });

    return new Promise((resolve) => {
      let done = false;
      let localSettled = false;
      let localValue = 'unavailable';
      let telegramSettled = false;
      const settle = (outcome, source) => {
        if (done) return;
        done = true;
        this.#closeApproval(approval, source, outcome);
        resolve(outcome);
      };
      local.then((value) => {
        localSettled = true;
        localValue = value;
        if (value !== 'unavailable') settle(value, 'local');
        else if (telegramSettled) settle('unavailable', 'local');
      });
      viaTelegram.then(
        (value) => {
          telegramSettled = true;
          if (value !== 'unavailable') settle(value, 'telegram');
          else if (localSettled) settle(localValue, 'local');
        },
        () => {
          telegramSettled = true;
          if (localSettled) settle(localValue, 'local');
        },
      );
    });
  }

  async #deliverApproval(approval) {
    try {
      const signal = approval.request?.signal;
      if (signal) {
        approval.abortListener = () => {
          if (approval.settled) return;
          approval.deferred.resolve('cancelled');
        };
        signal.addEventListener('abort', approval.abortListener, { once: true });
      }
      const sent = await this.#bot.sendMessage(approval.chatId, this.#renderApproval(approval), {
        keyboard: {
          inline_keyboard: [
            [
              { text: this.t('bot.approval.allow'), callback_data: `a|${approval.id}|allow` },
              { text: this.t('bot.approval.deny'), callback_data: `a|${approval.id}|deny` },
            ],
          ],
        },
      });
      approval.messageId = sent.message_id;
      return await approval.deferred.promise;
    } catch (error) {
      this.#warn('log.sendApprovalFailed', { error: error?.message ?? error });
      return 'unavailable';
    }
  }

  #renderApproval(approval) {
    const request = approval.request ?? {};
    const reason = request.displayReason || request.reason || '';
    const lines = [
      this.t('bot.approval.title'),
      `<i>${escapeHtml(approval.title)}</i>`,
      '',
      this.t('bot.approval.tool', { tool: escapeHtml(request.toolName ?? 'tool') }),
    ];
    if (reason) lines.push('', escapeHtml(clip(reason, 800)));
    return lines.join('\n');
  }

  #closeApproval(approval, source, outcome) {
    approval.settled = true;
    this.#pendingApprovals.delete(approval.id);
    if (approval.abortListener && approval.request?.signal) {
      approval.request.signal.removeEventListener('abort', approval.abortListener);
    }
    if (!approval.messageId) return;
    const label =
      outcome === 'allowed-once'
        ? this.t('bot.approval.allowed')
        : outcome === 'rejected'
          ? this.t('bot.approval.rejected')
          : outcome === 'cancelled'
            ? this.t('bot.approval.cancelled')
            : source === 'local'
              ? this.t('bot.approval.local')
              : this.t('bot.approval.unavailable');
    void this.#bot
      .editMessage(approval.chatId, approval.messageId, `${this.#renderApproval(approval)}\n\n${label}`)
      .catch((error) => this.#warn('log.closeApprovalFailed', { error: error?.message ?? error }));
    approval.request = null;
  }

  // ----------------------------------------------------------- update router

  async #onUpdate(update) {
    if (this.#stopped) return;
    if (update.callback_query) {
      await this.#onCallback(update.callback_query);
      return;
    }
    const message = update.message;
    if (message) await this.#onMessage(message);
  }

  async #onCallback(query) {
    if (!this.#isAllowed(query.from)) {
      this.#warn('log.deniedCallback', { id: query.from?.id ?? '?' });
      await this.#bot.answerCallback(query.id, this.t('bot.noAccess'));
      return;
    }
    const data = typeof query.data === 'string' ? query.data : '';
    const parts = data.split('|');
    if (parts[0] === 'q' && parts.length >= 3) {
      const ask = this.#pendingQuestions.get(parts[1]);
      if (!ask || ask.settled) {
        await this.#bot.answerCallback(query.id, this.t('bot.staleQuestion'));
        return;
      }
      if (parts[2] === 'done') {
        const complete = this.#maybeComplete(ask);
        await this.#bot.answerCallback(
          query.id,
          complete ? undefined : this.t('bot.unanswered'),
        );
        return;
      }
      await this.#bot.answerCallback(query.id);
      const index = Number(parts[2]);
      if (parts[3] === 'c') {
        ask.awaiting = index;
        const base = ask.texts.get(index) ?? '';
        try {
          await this.#bot.editMessage(
            ask.chatId,
            ask.messages.get(index),
            `${base}\n\n${this.t('bot.question.awaiting')}`,
          );
        } catch {
          /* message may be too old to edit */
        }
        return;
      }
      await this.#onQuestionChoice(ask, index, Number(parts[3]));
      return;
    }
    if (parts[0] === 'a' && parts.length === 3) {
      const approval = this.#pendingApprovals.get(parts[1]);
      if (!approval || approval.settled) {
        await this.#bot.answerCallback(query.id, this.t('bot.staleApproval'));
        return;
      }
      await this.#bot.answerCallback(query.id);
      approval.deferred.resolve(parts[2] === 'allow' ? 'allowed-once' : 'rejected');
      return;
    }
    await this.#bot.answerCallback(query.id);
  }

  async #onMessage(message) {
    const chatId = String(message.chat?.id ?? '');
    if (!chatId) return;
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    const from = message.from ?? {};
    const isStart = text === '/start' || text.startsWith('/start@');
    if (!this.#chatId) {
      if (isStart) {
        if (message.chat.type !== 'private') return;
        if (this.#hasPolicy() && !this.#isAllowed(from)) {
          await this.#deny(chatId);
          return;
        }
        this.#chatId = chatId;
        this.#store.patch({ chatId });
        if (!this.#hasPolicy()) this.#setOwner(from);
        this.#log('log.chatBound', { chatId });
        await this.#bot.sendMessage(chatId, this.#welcomeText());
        return;
      }
      await this.#bot.sendMessage(chatId, this.t('bot.needStart'));
      return;
    }
    if (chatId !== this.#chatId) return;
    if (!this.#hasPolicy() && isStart && message.chat.type !== 'private') this.#setOwner(from);
    if (!this.#isAllowed(from)) {
      this.#warn('log.denied', { id: from.id ?? '?' });
      if (isStart) await this.#deny(chatId);
      return;
    }
    if (text.startsWith('/')) {
      await this.#onCommand(chatId, text);
      return;
    }
    if (!text) return;
    // A reply to a question message is a free-text answer.
    const replyId = message.reply_to_message?.message_id;
    for (const ask of this.#pendingQuestions.values()) {
      for (const [index, messageId] of ask.messages) {
        if (messageId === replyId) {
          await this.#answerCustom(ask, index, text);
          return;
        }
      }
    }
    if (this.#pendingQuestions.size === 1) {
      const [ask] = this.#pendingQuestions.values();
      if (ask.questions.length === 1 && !(ask.questions[0].options?.length ?? 0)) {
        await this.#answerCustom(ask, 0, text);
        return;
      }
    }
    await this.#bot.sendMessage(chatId, this.t('bot.noQuestion'));
  }

  async #onCommand(chatId, text) {
    const command = text.split(/\s+/)[0].replace(/@.*$/, '');
    if (command === '/start') {
      await this.#bot.sendMessage(chatId, this.#welcomeText());
      return;
    }
    if (command === '/status') {
      await this.#bot.sendMessage(chatId, this.#statusText());
      return;
    }
    if (command === '/help') {
      await this.#bot.sendMessage(
        chatId,
        [
          '<b>DSH Telegram Relay</b>',
          '',
          this.t('bot.help.questions'),
          this.t('bot.help.approvals'),
          this.t('bot.help.summary'),
          '',
          this.t('bot.help.status'),
          this.t('bot.help.panel', { url: this.#server?.url ?? '—' }),
        ].join('\n'),
      );
    }
  }

  #welcomeText() {
    return [
      this.t('bot.welcome.title'),
      '',
      this.t('bot.welcome.body'),
      '',
      this.#statusText(),
    ].join('\n');
  }

  #accessText() {
    if (this.#ownerUsername) return `@${this.#ownerUsername}`;
    if (this.#ownerUserId) return `id ${this.#ownerUserId}`;
    if (this.#allowedUsers.length > 0) return this.t('panel.whitelistShort');
    return '—';
  }

  #statusText() {
    const state = this.state();
    return [
      '<b>DSH Telegram Relay</b>',
      this.t('bot.status.bot', {
        value: state.bot?.username ? `@${state.bot.username}` : '—',
      }),
      this.t('bot.status.chat', { value: `<code>${escapeHtml(state.chatId ?? '—')}</code>` }),
      this.t('bot.status.access', { value: this.#accessText() }),
      this.t('bot.status.questions', { count: state.pending.questions }),
      this.t('bot.status.approvals', { count: state.pending.approvals }),
      this.t('bot.status.panel', { url: state.url ?? '—' }),
    ].join('\n');
  }

  // ----------------------------------------------------------------- helpers

  #hasPolicy() {
    return Boolean(this.#ownerUserId || this.#ownerUsername || this.#allowedUsers.length > 0);
  }

  /**
   * One whitelist check for messages and button presses. The owner always
   * passes; `@username` and `id:<digits>` entries match the Telegram sender.
   * With no policy configured, a private bound chat authorizes its own user.
   */
  #isAllowed(from) {
    if (!from) return false;
    const id = String(from.id ?? '');
    const username = String(from.username ?? '').toLowerCase();
    if (this.#ownerUserId && id && id === this.#ownerUserId) return true;
    if (this.#ownerUsername && username && username === this.#ownerUsername) return true;
    for (const entry of this.#allowedUsers) {
      if (entry.startsWith('@') && username && entry === `@${username}`) return true;
      if (entry.startsWith('id:') && id && entry === `id:${id}`) return true;
    }
    if (!this.#hasPolicy()) return this.#chatId ? this.#chatId === id : true;
    return false;
  }

  #setOwner(from) {
    this.#ownerUserId = String(from?.id ?? '');
    this.#ownerUsername = String(from?.username ?? '').toLowerCase();
    this.#store.patch({ ownerUserId: this.#ownerUserId, ownerUsername: this.#ownerUsername });
    this.#log('log.owner', { owner: this.#accessText() });
  }

  async #deny(chatId) {
    try {
      await this.#bot.sendMessage(chatId, this.t('bot.deny'));
    } catch (error) {
      this.#warn('log.denyFailed', { error: error?.message ?? error });
    }
  }

  #canNotify() {
    if (this.#stopped) return false;
    return Boolean(this.#bot?.running && this.#chatId);
  }

  #titleOf(session, fallbackText) {
    try {
      const service = this.#ctx.get?.('sessionTitle');
      const title = service?.get?.(session);
      if (typeof title === 'string' && title.trim()) return title.trim();
    } catch {
      /* optional service */
    }
    const prompt = fallbackText || this.#tracker.lastUserText(session?.id);
    const line = firstLine(prompt, 50);
    if (line) return line;
    const id = String(session?.id ?? '').replace(/^session-/, '');
    return id ? this.t('summary.session', { id: id.slice(0, 8) }) : 'DSH';
  }

  #log(key, params) {
    this.#recent.push({ time: Date.now(), kind: 'info', key, params });
    if (this.#recent.length > 80) this.#recent.splice(0, this.#recent.length - 80);
    try {
      this.#ctx.logger?.info?.(`[telegram-relay] ${this.t(key, params)}`);
    } catch {
      /* ignore */
    }
  }

  #warn(key, params) {
    this.#recent.push({ time: Date.now(), kind: 'warn', key, params });
    if (this.#recent.length > 80) this.#recent.splice(0, this.#recent.length - 80);
    try {
      this.#ctx.logger?.warn?.(`[telegram-relay] ${this.t(key, params)}`);
    } catch {
      /* ignore */
    }
  }

  #fail(key, params) {
    this.#lastError = { key, params };
    this.#warn(key, params);
  }
}

