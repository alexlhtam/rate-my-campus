import {createHash} from 'node:crypto';
import {z} from 'zod';
import {CLAUDE_SYSTEM, extractionJsonSchema, extractionSchema, requestJson, verifyExtraction, type ProviderConfig} from './providers';
import type {EventPage, Extraction, SourceEvent} from './types';

// Bump this when extraction or moderation policy changes: old approvals must
// never bypass a newer policy just because the source page is unchanged.
export const IMPORT_POLICY = 'union-batch-v1';
export const MAX_BATCH_EVENTS = 30;
export const MAX_BATCH_CHARACTERS = 65_000;
export const verdictSchema = z.object({approved:z.boolean(),reasons:z.array(z.string().max(200)).max(4)}).strict();
export type ImportVerdict = z.infer<typeof verdictSchema>;
export type BatchItem = {id:string;source:SourceEvent;page:EventPage;attempts?:number};
type Processing = {version:string;fingerprint:string;moderation:ImportVerdict};
export type ImportCheckpoint = Extraction & {_processing:Processing};

export function fingerprint(item:BatchItem,model:string) {
  return createHash('sha256').update(JSON.stringify({version:IMPORT_POLICY,model,source:item.source,page:item.page})).digest('hex');
}
export function readCheckpoint(value:unknown):ImportCheckpoint|null {
  if(!value||typeof value!=='object')return null;
  const {_processing,...extraction}=value as Record<string,unknown>;
  const meta=z.object({version:z.literal(IMPORT_POLICY),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),moderation:verdictSchema}).safeParse(_processing);
  const checked=extractionSchema.safeParse(extraction);
  return meta.success&&checked.success?{...checked.data,_processing:meta.data}:null;
}
export function extractionOnly(value:Extraction & {_processing?:unknown}):Extraction {
  const {_processing,...extraction}=value;void _processing;return extraction;
}
export function reusableCheckpoint(value:unknown,item:BatchItem,model:string):ImportCheckpoint|null {
  const saved=readCheckpoint(value);
  return saved?._processing.fingerprint===fingerprint(item,model)?saved:null;
}
function input(item:BatchItem) {
  return {id:item.id,event_title:item.source.title,event_url:item.source.url,event_text:item.page.text,links:item.page.links,
    calendar:{venue:item.source.sourceLocation,organizer:item.source.sourceOrganizer??null,online:item.source.sourceOnline??null}};
}
/** Bound text without truncating evidence. A long individual page stands alone. */
export function selectBatch(items:BatchItem[]):BatchItem[] {
  const selected:BatchItem[]=[];let size=0;
  const limit=items.some(item=>(item.attempts??0)>=2)?5:MAX_BATCH_EVENTS;
  for(const item of items){const length=JSON.stringify(input(item)).length;if(selected.length&&(selected.length>=limit||size+length>MAX_BATCH_CHARACTERS))break;selected.push(item);size+=length;}
  return selected;
}
const batchSchema={type:'object',additionalProperties:false,required:['events'],properties:{events:{type:'array',items:{
  type:'object',additionalProperties:false,required:['id','extraction','moderation'],properties:{id:{type:'string'},extraction:extractionJsonSchema,
    moderation:{type:'object',additionalProperties:false,required:['approved','reasons'],properties:{approved:{type:'boolean'},reasons:{type:'array',items:{type:'string'}}}},
  },
}}}};
const moderation=`For EACH event, also moderate its source title, venue, organiser and ALL generated extraction fields before publication. Reject targeted abuse, slurs, threats, harassment, private contact details, names of private individuals, exact private home flat/room numbers, unsubstantiated criminal accusations and promotional spam. Public campus room identifiers and organisation names are allowed. Ordinary official society events and their booking requirements are allowed. Do not repeat private details in reasons. If uncertain, set approved false with at most four brief reasons. Do not claim to verify truth. Assess each event independently; never transfer evidence or approval from another event.`;

/** One paid request; per-event validation isolates failures without replaying
 * successful rows. Retries are checkpointed by the worker, in smaller batches. */
export async function askClaudeBatch(items:BatchItem[],config:ProviderConfig):Promise<Map<string,{checkpoint?:ImportCheckpoint;error?:string}>> {
  if(!items.length||items.length>MAX_BATCH_EVENTS||new Set(items.map(item=>item.id)).size!==items.length)throw new Error('Invalid event batch.');
  const body=await requestJson('Claude','https://api.anthropic.com/v1/messages',config.claudeKey,{
    model:config.claudeModel,max_tokens:Math.min(32_000,2500+items.length*800),temperature:0,
    system:CLAUDE_SYSTEM+`\nBATCH MODE: Return {events:[{id,extraction,moderation}]} using the supplied schema. Return exactly one result for every input id, unchanged. Each extraction follows the rules above using ONLY its own event. Keep summaries under 45 words and omit redundant conditions. ${moderation}`,
    messages:[{role:'user',content:JSON.stringify({events:items.map(input)})}],
    output_config:{format:{type:'json_schema',schema:batchSchema}},
  },{timeoutMs:90_000,attempts:1});
  const envelope=z.object({stop_reason:z.string().nullable().optional(),content:z.array(z.object({type:z.string(),text:z.string().optional()}))}).parse(body);
  if(envelope.stop_reason==='max_tokens')throw new Error('Batch response was cut short; pending events will retry in smaller batches.');
  const text=envelope.content.filter(block=>block.type==='text').map(block=>block.text||'').join('');
  let parsed:unknown;try{parsed=JSON.parse(text)}catch{throw new Error('Batch response was unreadable; pending events will retry in smaller batches.')}
  const rows=z.object({events:z.array(z.unknown()).max(MAX_BATCH_EVENTS)}).parse(parsed).events;
  const result=new Map<string,{checkpoint?:ImportCheckpoint;error?:string}>();
  for(const item of items){
    try{
      const matches=rows.filter(row=>row&&typeof row==='object'&&(row as {id?:unknown}).id===item.id);
      if(matches.length!==1)throw new Error('Missing or duplicate event ID in batch response.');
      const row=z.object({id:z.string(),extraction:extractionSchema,moderation:verdictSchema}).strict().parse(matches[0]);
      const extraction=verifyExtraction(row.extraction,item.page);
      result.set(item.id,{checkpoint:{...extraction,_processing:{version:IMPORT_POLICY,fingerprint:fingerprint(item,config.claudeModel),moderation:row.moderation}}});
    }catch{
      result.set(item.id,{error:'This event failed batch evidence or approval validation; only this event needs retrying.'});
    }
  }
  return result;
}
