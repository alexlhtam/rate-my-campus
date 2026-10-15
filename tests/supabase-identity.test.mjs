import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import ts from 'typescript';

let result,requests=0;
globalThis.__identityFixture={createServerClient:()=>({auth:{
  getClaims:async()=>({data:{claims:{sub:'account-fixture',email:'Student@UCL.AC.UK'}},error:null}),
  getUser:async()=>{requests++;return result},
}}),cookies:async()=>({getAll:()=>[],set:()=>{}})};
let code=ts.transpileModule(await readFile(new URL('../lib/supabase.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
code=code.replace(/import \{ createServerClient \} from ["']@supabase\/ssr["'];/,'const {createServerClient}=globalThis.__identityFixture;')
 .replace(/import \{ createClient \} from ["']@supabase\/supabase-js["'];/,'const createClient=()=>{throw Error("No admin client needed")};')
 .replace(/import \{ cookies \} from ["']next\/headers["'];/,'const {cookies}=globalThis.__identityFixture;');
const temporary=new URL('.supabase-identity-'+process.pid+'.mjs',import.meta.url);
await writeFile(temporary,code);
const {currentUser}=await import(temporary.href);await unlink(temporary);
const original={...process.env};
test.beforeEach(()=>{requests=0;process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='fixture-public-key'});
test.after(()=>{for(const key of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key]}delete globalThis.__identityFixture});

test('account identity uses the current Auth record and normalises its UCL address',async()=>{
 result={data:{user:{id:'account-fixture',email:'Student@UCL.AC.UK'}},error:null};
 assert.deepEqual(await currentUser(),{userId:'account-fixture',email:'student@ucl.ac.uk'});
 assert.equal(requests,1);
});
test('deleted accounts, changed non-UCL emails and Auth errors cannot use stale JWT identity',async()=>{
 for(const value of [{data:{user:null},error:{code:'user_not_found'}},{data:{user:{id:'account-fixture',email:'outside@example.com'}},error:null},{data:{user:{id:'account-fixture',email:'student@ucl.ac.uk'}},error:{status:503}},{data:{user:{id:'account-fixture'}},error:null}]){
  result=value;assert.equal(await currentUser(),null);
 }
 assert.equal(requests,4);
});
