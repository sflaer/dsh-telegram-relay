/**
 * `dsh-telegram-relay` entry point.
 *
 * A host-only plugin: it listens to session events and to the two human
 * interaction seams (questions and approvals), forwards them to a Telegram bot,
 * and serves a loopback control panel for the bot token and chat binding.
 */

import { Relay } from './relay.js';

export const name = 'telegram-relay';

/** The session store owns the event feed the summary tracker folds. */
export const inject = ['sessions'];

/**
 * Mount the relay for the lifetime of the plugin fiber.
 * @param ctx - cordis context of the plugin.
 * @param config - profile configuration (`port`, `apiBase`, notification switches).
 */
export function apply(ctx, config = {}) {
  const relay = new Relay(ctx, config ?? {});
  ctx.effect(() => () => relay.dispose(), 'telegram-relay: bot, panel, pending interactions');
  relay.start().catch((error) => {
    try {
      ctx.logger?.error?.(`[telegram-relay] start failed: ${error?.stack ?? error}`);
    } catch {
      /* nothing else to do */
    }
  });
}
