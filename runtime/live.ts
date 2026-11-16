/** What the conversation is doing right now, reduced from pi-durable's own events into the few facts the page draws:
 * one row per step with its state and time, the words of the reply as far as they have arrived, and the model turns so far.
 * The reducer holds no clock of its own: the caller passes the time, so a recorded run replays to the same rows. */

export type LiveStep = {id: string; label: string; state: 'running' | 'done' | 'failed'; startedAt: number; milliseconds?: number};
export type Live = {running: boolean; startedAt: number; turns: number; steps: LiveStep[]; words: string};

export const idle = (): Live => ({running: false, startedAt: 0, turns: 0, steps: [], words: ''});

const SHOWN = 40;
const clip = (value: unknown, limit = 60) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > limit ? text.slice(0, limit - 1) + '…' : text; };
const first = (args: Record<string, unknown>, ...names: string[]) => names.map(name => args[name]).find(value => typeof value === 'string' && value) as string | undefined;
const host = (value?: string) => { try { return value ? new URL(value).hostname : undefined; } catch { return undefined; } };
const file = (value?: string) => value?.split('/').filter(Boolean).pop();

/** One short line for a tool, in the words a person would use: "Read friday.txt", never a tool name. */
export function describe(name: string, args: Record<string, unknown> = {}): string {
 const target = first(args, 'path', 'file', 'filePath', 'file_path');
 const url = first(args, 'url');
 switch (name) {
  case 'read': return target ? `Read ${clip(file(target))}` : 'Read a file';
  case 'write': return target ? `Wrote ${clip(file(target))}` : 'Wrote a file';
  case 'edit': return target ? `Edited ${clip(file(target))}` : 'Edited a file';
  case 'bash': return 'Ran a command';
  case 'read_public_url': return host(url) ? `Read ${host(url)}` : 'Read a page';
  case 'search_public_web': return first(args, 'query') ? `Searched for “${clip(first(args, 'query'), 40)}”` : 'Searched the web';
  case 'present_draft': return 'Wrote a draft';
  case 'copy_to_clipboard': return 'Copied to the clipboard';
  case 'open_url': return host(url) ? `Opened ${host(url)}` : 'Opened a link';
  case 'open_app': return 'Opened an app';
  case 'save_note': return 'Saved a note';
  case 'send_message': return 'Sent a message';
  case 'make_payment': return 'Made a payment';
  case 'publish_content': return 'Published something';
  case 'delete_item': return 'Deleted something';
  case 'propose_action': return 'Prepared a change to what Pip remembers';
  case 'list_events': case 'query_reminders': case 'read_object': case 'resolve_due': return 'Checked your calendar and reminders';
  default: return clip(name.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase()), 50);
 }
}

type Event = {type?: string; [key: string]: unknown};

/** Apply one event. Returns a new state; the input is never changed. Unknown events leave it as it was. */
export function reduce(live: Live, event: Event, now: number): Live {
 switch (event.type) {
  case 'run_start': return {running: true, startedAt: now, turns: 0, steps: [], words: ''};
  case 'run_end': return {...live, running: false, steps: live.steps.map(step => step.state === 'running' ? {...step, state: 'done', milliseconds: now - step.startedAt} : step)};
  case 'message_start': {
   const message = event.message as {role?: string} | undefined;
   return message?.role === 'assistant' ? {...live, turns: live.turns + 1, words: ''} : live;
  }
  case 'message_update': {
   const changes = (event.changes ?? []) as {type?: string; delta?: string}[];
   const added = changes.filter(change => change.type === 'text_delta' && typeof change.delta === 'string').map(change => change.delta).join('');
   return added ? {...live, words: live.words + added} : live;
  }
  case 'tool_execution_start': {
   const id = String(event.toolCallId ?? '');
   if (!id || live.steps.some(step => step.id === id)) return live;
   const step: LiveStep = {id, label: describe(String(event.toolName ?? ''), (event.args ?? {}) as Record<string, unknown>), state: 'running', startedAt: now};
   return {...live, steps: [...live.steps, step].slice(-SHOWN)};
  }
  case 'tool_execution_end': {
   const id = String(event.toolCallId ?? '');
   const result = ((event.entry as {model?: {isError?: boolean; durationMs?: number}[]} | undefined)?.model ?? [])[0];
   return {...live, steps: live.steps.map(step => step.id === id ? {...step, state: result?.isError ? 'failed' : 'done', milliseconds: Math.max(0, now - step.startedAt)} : step)};
  }
  default: return live;
 }
}

/** The events of a snapshot or a batch, in order. */
export const replay = (events: readonly Event[], now: () => number, from: Live = idle()) => events.reduce((state, event) => reduce(state, event, now()), from);
