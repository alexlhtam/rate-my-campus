import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {z} from 'zod';

let auth,limit,search,calls;
class IntegrationError extends Error {constructor(status,message){super(message);this.status=status}}
const filters={query:'',category:'study',layer:'rated',tags:[],dietary:[],openNow:false};
globalThis.__searchAssistRoute={z,IntegrationError,
 currentUser:()=>{calls.push('auth');return auth()},
 consumeRateLimit:(...args)=>{calls.push(['limit',...args]);return limit()},
 assertSameOrigin:()=>{},readLimitedText:request=>request.text(),
 researchCampus:(text,options)=>{calls.push(['claude',text]);assert.ok(options.signal instanceof AbortSignal);return search()},
 integrationErrorResponse:error=>Response.json({error:error.message},{status:error instanceof z.ZodError?400:error.status||500}),
};
const source=(await readFile(new URL('../app/api/assist/route.ts',import.meta.url),'utf8')).replace(/^import\s+\{([^}]+)\}\s+from\s+"[^"]+";/gm,(_match,names)=>`const {${names}}=globalThis.__searchAssistRoute;`);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {POST}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
delete globalThis.__searchAssistRoute;
const request=signal=>new Request('https://campus.example/api/assist',{method:'POST',signal,headers:{'Content-Type':'application/json',Origin:'https://campus.example'},body:JSON.stringify({action:'search',text:'a place to study'})});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test.beforeEach(()=>{calls=[];auth=async()=>({userId:'ucl-student'});limit=async()=>{};search=async()=>({answer:'Try a campus library.',sources:[],suggestions:[],filters})});

test('search keeps the authenticated shared rate limit before invoking Claude',async()=>{
 const response=await POST(request());
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{provider:'anthropic',answer:'Try a campus library.',sources:[],suggestions:[],filters});
 assert.deepEqual(calls,['auth',['limit','ucl-student','assist',30,3600],['claude','a place to study']]);
});

test('a stalled Auth lookup times out safely and a late result cannot start rate limiting or Claude',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-15T12:00:00Z')});
 const pending=deferred();auth=()=>pending.promise;
 const result=POST(request());await flush();
 t.mock.timers.tick(8000);
 const response=await result;assert.equal(response.status,504);assert.match((await response.json()).error,/took too long/);
 pending.resolve({userId:'late-account'});await flush();
 assert.deepEqual(calls,['auth']);
});

test('Auth and rate limiting share the same budget, and a delayed database result never invokes Claude',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-15T12:00:00Z')});
 const pendingAuth=deferred(),pendingLimit=deferred();auth=()=>pendingAuth.promise;limit=()=>pendingLimit.promise;
 const result=POST(request());await flush();
 t.mock.timers.tick(6000);pendingAuth.resolve({userId:'ucl-student'});await flush();
 assert.equal(calls.length,2);
 t.mock.timers.tick(2000);
 assert.equal((await result).status,504);
 pendingLimit.resolve();await flush();assert.equal(calls.some(call=>Array.isArray(call)&&call[0]==='claude'),false);
});

test('cancelling before or during Auth fails closed without reaching the paid provider',async()=>{
 const controller=new AbortController();controller.abort('private reason');
 const before=await POST(request(controller.signal));assert.equal(before.status,408);assert.deepEqual(calls,[]);
 const active=new AbortController(),pending=deferred();auth=()=>pending.promise;
 const result=POST(request(active.signal));await flush();active.abort('private reason');
 const response=await result;assert.equal(response.status,408);assert.equal(JSON.stringify(await response.json()).includes('private reason'),false);
 pending.resolve({userId:'late-account'});await flush();assert.deepEqual(calls,['auth']);
});

test('cancelling a waiting database check prevents a later paid call',async()=>{
 const controller=new AbortController(),pending=deferred();limit=()=>pending.promise;
 const result=POST(request(controller.signal));await flush();controller.abort();
 assert.equal((await result).status,408);pending.resolve();await flush();
 assert.deepEqual(calls,['auth',['limit','ucl-student','assist',30,3600]]);
});

test('missing identity and exhausted rate limits retain their authorization failures',async()=>{
 auth=async()=>null;
 assert.equal((await POST(request())).status,401);assert.deepEqual(calls,['auth']);
 calls=[];auth=async()=>({userId:'ucl-student'});limit=async()=>{throw new IntegrationError(429,'Please wait before retrying.')};
 assert.equal((await POST(request())).status,429);assert.equal(calls.some(call=>Array.isArray(call)&&call[0]==='claude'),false);
});

test('successful prerequisites do not leave an eight-second timer that cuts off the existing Claude deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-15T12:00:00Z')});
 const provider=deferred();search=()=>provider.promise;
 const result=POST(request());await flush();
 assert.equal(calls.at(-1)[0],'claude');t.mock.timers.tick(9000);
 provider.resolve(filters);assert.equal((await result).status,200);
});
