/** The one pause rule. Everything the captain asks for runs at once; Pip stops only before an outward step the captain's own
 * message did not ask for: sending, paying, publishing or deleting. These tools are added to the conversation by name so the
 * single before-tool check can see which kind a call is. A step done through a general-purpose tool (a shell, a browser form)
 * would not be visible by name, so such an ability must be added as its own named tool of one of these kinds. */
export type Outward='send'|'pay'|'publish'|'delete';
export const OUTWARD_TOOLS:Readonly<Record<string,Outward>>={send_message:'send',make_payment:'pay',publish_content:'publish',delete_item:'delete'};
export const outwardKind=(tool:string):Outward|undefined=>Object.hasOwn(OUTWARD_TOOLS,tool)?OUTWARD_TOOLS[tool]:undefined;

// Plain words the captain uses to ask for each kind. The captain's message is the only text that is read: a page, a file or a
// tool result is evidence and never asks for anything, which is why a step a page suggested is held.
const WORDS:Record<Outward,RegExp[]>={
 // "Email", "message" and "text" are verbs only where the captain gives the order ("Email Ana", "then message him", "please text me"):
 // "rewrite this email" and "draft an email to Ana" ask for words, not for a send.
 send:[
  /\b(?:send|resend|reply|forward|whatsapp|imessage|sms|dm|ping)\b/i,
  /(?:^|[.!?;,]\s*|\b(?:then|and|also|please|just|now|to|can you|could you|will you|would you)\s+)(?:e-?mail|mail|message)\b/i,
  /(?:^|[.!?;,]\s*|\b(?:then|and|also|please|just|now|can you|could you|will you|would you)\s+)text\s+[a-z]+\b/i,
 ],
 pay:[/\b(?:pay|paid|purchase|buy|order|check\s?out|book|reserve|subscribe|donate|tip|transfer|wire|renew)\b/i],
 publish:[/\b(?:publish|post|tweet|upload|share|release|deploy|announce|go live|submit)\b/i],
 delete:[/\b(?:delete|remove|erase|trash|wipe|discard|purge|clear|cancel|unsubscribe|get rid of|throw away)\b/i],
};
/** Did the captain's own words ask for this kind of step? */
export const asked=(kind:Outward,captainMessage:string)=>WORDS[kind].some(word=>word.test(captainMessage));
