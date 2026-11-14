import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { backendAction, target, type BackendReader } from './backend-contracts.js';
export const backendToolNames=['targets','resolve_due','read_object','list_events','query_reminders','prepare_backend_action'] as const;
/** Model-facing tools can only read or prepare. There is no execute, approve,
 * notification enqueue, overwrite or reconciliation-write capability here. */
export function modelBackendTools(reader:BackendReader){
 const result=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify({scope:'isolated-fixtures-only',result:value})}]});
 const targetSchema=z.object({id:z.string(),title:z.string(),kind:z.enum(['event','reminder']),writable:z.boolean(),revision:z.string()}).strict();
 const wallSchema=z.object({year:z.number().int(),month:z.number().int(),day:z.number().int(),hour:z.number().int().nullish(),minute:z.number().int().nullish(),zone:z.string()}).strict();
 const dueSchema=z.object({wall:wallSchema,instant:z.number().int().nullish(),occurrence:z.enum(['earlier','later']).nullish()}).strict();
 const valueSchema=z.object({kind:z.enum(['event','reminder']),title:z.string(),start:dueSchema.nullish(),end:dueSchema.nullish(),due:dueSchema.nullish(),completed:z.boolean(),allDay:z.boolean().optional(),floating:z.boolean().optional(),recurrence:z.array(z.string()).optional()}).strict();
 const actionSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('schedule.mutate'),change:z.object({target:targetSchema,kind:z.enum(['create','reminderDue','reminderCompletion']),objectID:z.string().nullish(),beforeRevision:z.string().nullish(),beforeCorrelation:z.string().nullish(),after:valueSchema}).strict()}).strict(),
  z.object({type:z.literal('alarm.schedule'),alarm:z.object({reminderId:z.string(),title:z.string(),at:z.number().int(),zone:z.string(),owner:z.literal('local')}).strict()}).strict(),
  z.object({type:z.literal('note.review'),path:z.string(),replacement:z.string()}).strict(),
  z.object({type:z.literal('note.review.confirm'),reviewId:z.string(),reviewDigest:z.string()}).strict()
 ]);
 return [
  tool('targets','List isolated fixture targets only. Ask which target; never assume a calendar/list.',{kind:z.enum(['event','reminder'])},async args=>result(await reader.read('targets',args))),
  tool('resolve_due','Resolve explicit local wall fields and named zone. A gap is a suggestion requiring confirmation; a fold requires occurrence choice.',{wall:wallSchema,occurrence:z.enum(['earlier','later']).optional()},async args=>result(await reader.read('resolveDue',args))),
  tool('read_object','Read one isolated object from its explicitly selected target.',{id:z.string(),target:targetSchema},async args=>result(await reader.read('read',{id:args.id,target:target(args.target)}))),
  tool('list_events','Read a bounded isolated calendar range. All-day, floating and recurring events are refused.',{target:targetSchema,start:z.number().int(),end:z.number().int()},async args=>result(await reader.read('listEvents',{...args,target:target(args.target)}))),
  tool('query_reminders','Read a bounded isolated due range, including optional date-only local-day labels. End is exclusive; limit is at most 100. No task acquires a midnight alarm.',{target:targetSchema,query:z.object({start:z.number().int(),end:z.number().int(),zone:z.string(),includeCompleted:z.boolean(),includeDateOnly:z.boolean(),limit:z.number().int().min(1).max(100)}).strict()},async args=>result(await reader.read('queryReminders',{...args,target:target(args.target)}))),
  tool('prepare_backend_action','Validate an isolated action for the existing exact approval flow. This never proposes, approves, executes or reads a note. Return it as the final proposal only if the user requested that change.',{action:actionSchema},async args=>{
   const action=backendAction(args.action);if(action.type==='schedule.mutate')await reader.read('checkChange',{change:action.change});
   return result({action,requiresApproval:true,executed:false});
  })
 ];
}
