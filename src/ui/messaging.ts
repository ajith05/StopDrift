/** Promise wrapper around chrome.runtime.sendMessage for UI pages. */
import type { Command, CommandResponse } from '../core/protocol.js';

export async function send(command: Command): Promise<CommandResponse> {
  try {
    return (await chrome.runtime.sendMessage(command)) as CommandResponse;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach the extension.',
    };
  }
}
