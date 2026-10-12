import {readFileSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve,extname} from 'node:path';
import {after} from 'node:test';
import ts from 'typescript';
const files=new Map(),prefix='.freebie-test-'+process.pid+'-'+Math.random().toString(36).slice(2);
const testRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repository=resolve(testRoot,'..');
after(()=>{for(const file of files.values())try{unlinkSync(file)}catch{}});
export function compileFreebie(file){
 const sourcePath=file instanceof URL?fileURLToPath(file):resolve(file);
 if(files.has(sourcePath))return pathToFileURL(files.get(sourcePath)).href;
 const output=resolve(testRoot,prefix+'-'+files.size+'.mjs');files.set(sourcePath,output);
 let code=ts.transpileModule(readFileSync(sourcePath,'utf8'),{fileName:sourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 code=code.replace(/import\s*["'][^"']+\.css["'];?/g,'');
 code=code.replace(/(from\s+|import\s*)(["'])(\.[^"']+|@\/[^"']+)\2/g,(_,before,quote,relative)=>{
  const base=relative.startsWith('@/')?resolve(repository,relative.slice(2)):resolve(dirname(sourcePath),relative);
  const target=extname(base)?base:existsSync(base+'.ts')?base+'.ts':base+'.tsx';
  return before+quote+compileFreebie(target)+quote;
 });
 writeFileSync(output,code);
 return pathToFileURL(output).href;
}
export async function loadFreebie(relative){return import(compileFreebie(new URL('../../'+relative,import.meta.url)))}
