/**
 * Minimal Telegram Bot API transport: JSON calls, a serialized send queue with
 * per-chat pacing, 429 handling, and long polling for updates.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramApiError extends Error {
  constructor(message, { method, status, retryAfter } = {}) {
    super(message);
    this.name = 'TelegramApiError';
    this.method = method;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class TelegramBot {
  #token;
  #apiBase;
  #logger;
  #minIntervalMs;
  #queue = Promise.resolve();
  #lastSendAt = 0;
  #offset = 0;
  #running = false;
  #loop = null;
  #abort = null;
  #me = null;
  #onUpdate = null;
  #onOffset = null;
  #pollErrorLogged = false;

  constructor({ token = '', apiBase = 'https://api.telegram.org', logger, minIntervalMs = 1100 } = {}) {
    this.#token = String(token ?? '');
    this.#apiBase = String(apiBase ?? 'https://api.telegram.org').replace(/\/+$/, '');
    this.#logger = logger;
    this.#minIntervalMs = Math.max(0, Number(minIntervalMs) || 0);
  }

  get token() {
    return this.#token;
  }

  get me() {
    return this.#me;
  }

  get offset() {
    return this.#offset;
  }

  set offset(value) {
    const next = Number(value);
    if (Number.isSafeInteger(next) && next > 0) this.#offset = next;
  }

  get ready() {
    return Boolean(this.#token);
  }

  get running() {
    return this.#running;
  }

  #warn(message) {
    try {
      this.#logger?.warn?.(`[telegram-relay] ${message}`);
    } catch {
      /* logging must never break delivery */
    }
  }

  /** Raw Bot API call. Never waits behind the send queue. */
  async call(method, params = {}, { timeoutMs = 20000, signal } = {}) {
    if (!this.#token) throw new TelegramApiError('bot token is not configured', { method });
    const url = `${this.#apiBase}/bot${this.#token}/${method}`;
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params ?? {}),
        signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new TelegramApiError(`${method}: ${error?.message ?? String(error)}`, { method });
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new TelegramApiError(`${method}: invalid JSON response (HTTP ${response.status})`, {
        method,
        status: response.status,
      });
    }
    if (!payload || payload.ok !== true) {
      throw new TelegramApiError(`${method}: ${payload?.description ?? `HTTP ${response.status}`}`, {
        method,
        status: response.status,
        retryAfter: payload?.parameters?.retry_after,
      });
    }
    return payload.result;
  }

  /** Serialize outgoing calls with a minimum spacing so one burst cannot trip limits. */
  #enqueue(task) {
    const run = this.#queue.then(async () => {
      const wait = this.#minIntervalMs - (Date.now() - this.#lastSendAt);
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        this.#lastSendAt = Date.now();
      }
    });
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async getMe() {
    return await this.call('getMe', {}, { timeoutMs: 15000 });
  }

  async setMyCommands(commands) {
    return await this.call('setMyCommands', { commands });
  }

  async sendMessage(chatId, text, { keyboard, replyToMessageId } = {}) {
    return await this.#enqueue(async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.call('sendMessage', {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            ...(keyboard ? { reply_markup: keyboard } : {}),
            ...(replyToMessageId
              ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } }
              : {}),
          });
        } catch (error) {
          if (error instanceof TelegramApiError && error.retryAfter && attempt < 2) {
            this.#warn(`rate limited, retry in ${error.retryAfter}s`);
            await sleep(error.retryAfter * 1000);
            continue;
          }
          throw error;
        }
      }
    });
  }

  async editMessage(chatId, messageId, text, { keyboard } = {}) {
    return await this.#enqueue(async () => {
      try {
        return await this.call('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(keyboard ? { reply_markup: keyboard } : {}),
        });
      } catch (error) {
        // "message is not modified" is harmless for repeated status edits.
        if (!(error instanceof TelegramApiError) || !/not modified/i.test(error.message)) throw error;
        return undefined;
      }
    });
  }

  async answerCallback(callbackId, text) {
    try {
      await this.call('answerCallbackQuery', {
        callback_query_id: callbackId,
        ...(text ? { text } : {}),
      });
    } catch (error) {
      this.#warn(`answerCallbackQuery failed: ${error?.message ?? error}`);
    }
  }

  /**
   * Resolve the bot identity and start the update loop. Skips the backlog on a
   * fresh start so restarting the host does not replay old commands.
   */
  async start({ onUpdate, onOffset, skipBacklog = true } = {}) {
    if (!this.#token) throw new TelegramApiError('bot token is not configured');
    this.#me = await this.getMe();
    this.#onUpdate = onUpdate ?? null;
    this.#onOffset = onOffset ?? null;
    this.#abort = new AbortController();
    if (skipBacklog && this.#offset === 0) {
      try {
        const latest = await this.call('getUpdates', { offset: -1, timeout: 0 }, { timeoutMs: 15000 });
        const last = Array.isArray(latest) ? latest.at(-1) : undefined;
        if (last) this.#offset = last.update_id + 1;
      } catch (error) {
        this.#warn(`could not read the update cursor: ${error?.message ?? error}`);
      }
    }
    this.#running = true;
    this.#loop = this.#pollLoop();
    return this.#me;
  }

  stop() {
    this.#running = false;
    try {
      this.#abort?.abort();
    } catch {
      /* already aborted */
    }
    this.#abort = null;
    this.#loop = null;
  }

  async #pollLoop() {
    while (this.#running) {
      try {
        const updates = await this.call(
          'getUpdates',
          {
            offset: this.#offset,
            timeout: 25,
            allowed_updates: ['message', 'callback_query'],
          },
          { timeoutMs: 35000, signal: this.#abort?.signal },
        );
        this.#pollErrorLogged = false;
        for (const update of Array.isArray(updates) ? updates : []) {
          this.#offset = Math.max(this.#offset, Number(update.update_id) + 1);
          try {
            await this.#onUpdate?.(update);
          } catch (error) {
            this.#warn(`update handler failed: ${error?.stack ?? error}`);
          }
        }
        if (Array.isArray(updates) && updates.length > 0) this.#onOffset?.(this.#offset);
      } catch (error) {
        if (!this.#running) break;
        if (error instanceof TelegramApiError && error.status === 401) {
          this.#warn('bot token rejected by Telegram; polling stopped');
          this.#running = false;
          break;
        }
        if (!this.#pollErrorLogged) {
          this.#warn(`polling failed: ${error?.message ?? error}`);
          this.#pollErrorLogged = true;
        }
        await sleep(error instanceof TelegramApiError && error.status === 409 ? 10000 : 3000);
      }
    }
  }
}
