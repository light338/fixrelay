import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {safeRelative} from './git.mjs';

export const worker=new URL('./probe-worker.mjs',import.meta.url);
export function validateCases(cases) {
  if(!Array.isArray(cases)||cases.length<2||cases.length>64||JSON.stringify(cases).length>256*1024)throw Error('Provide 2–64 JSON cases, at most 256 KiB.');
  const ids=new Set();
  for(const c of cases) {
    if(!c||Object.keys(c).some(k=>!['id','kind','args','expected'].includes(k))||typeof c.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(c.id)||ids.has(c.id)||!['control','regression'].includes(c.kind)||!Array.isArray(c.args)||!Object.hasOwn(c,'expected'))throw Error('Each case needs unique id, control/regression kind, args array and expected JSON.');
    ids.add(c.id);
  }
  if(!cases.some(c=>c.kind==='control')||!cases.some(c=>c.kind==='regression'))throw Error('At least one control and one regression case are required.');
  // Reject non-JSON values before they can be normalized into false evidence.
  const check=value=>{if(value===undefined||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint'||typeof value==='number'&&!Number.isFinite(value))throw Error('Cases must contain finite JSON data.');if(value&&typeof value==='object'){if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype)throw Error('Cases must be plain JSON.');for(const v of Object.values(value))check(v);}};
  check(cases);return cases;
}
function single(repo,file,exportName,cases) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fixrelay-probe-'));
  try {
    const result=path.join(temp,'result.json');
    const r=spawnSync(process.execPath,['--experimental-strip-types',worker.pathname],{cwd:repo,input:JSON.stringify({file:path.join(repo,file),exportName,cases,result}),encoding:'utf8',timeout:10000,maxBuffer:64*1024,
      detached:process.platform!=='win32',
      env:{PATH:process.env.PATH??'',HOME:temp,TMPDIR:temp,TEMP:temp,LANG:'C.UTF-8',NODE_NO_WARNINGS:'1'}});
    if(process.platform!=='win32'&&r.pid)try{process.kill(-r.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    if(r.status!==0||r.error||!fs.existsSync(result)||fs.statSync(result).size>256*1024)return {error:r.error?.code==='ETIMEDOUT'?'Probe timed out':r.error?.message||r.stderr?.slice(0,2000)||'Probe failed to import/execute'};
    const data=JSON.parse(fs.readFileSync(result,'utf8'));
    if(data.error||!Array.isArray(data.results)||data.results.length!==cases.length||data.results.some((item,i)=>!item||item.id!==cases[i].id||!Object.hasOwn(item,'actual')&&!Object.hasOwn(item,'error')))return {error:data.error||'Invalid probe result'};
    return {results:data.results.map((item,i)=>({id:cases[i].id,kind:cases[i].kind,status:item.error?'error':isDeepStrictEqual(item.actual,cases[i].expected)?'pass':'mismatch',...item,expected:cases[i].expected}))};
  }catch(error){return {error:error.message};}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
export function probe(repo,file,exportName,cases) {
  safeRelative(file);validateCases(cases);
  if(typeof exportName!=='string'||!exportName)throw Error('Select an exported function.');
  const first=single(repo,file,exportName,cases),second=single(repo,file,exportName,cases);
  if(first.error||second.error)return {status:'inconclusive',error:first.error||second.error};
  if(!isDeepStrictEqual(first,second))return {status:'inconclusive',error:'Repeated probe outputs differ'};
  if(first.results.some(r=>r.status==='error'))return {status:'inconclusive',results:first.results,error:'Execution error is not a reproduced regression'};
  if(first.results.filter(r=>r.kind==='control').some(r=>r.status!=='pass'))return {status:'incompatible',results:first.results};
  return {status:first.results.some(r=>r.kind==='regression'&&r.status==='mismatch')?'reproduced':'not_reproduced',results:first.results};
}
