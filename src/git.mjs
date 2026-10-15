// Snapshot technique adapted from Unmix (MIT), light338 and Unmix contributors.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const hash = data => createHash('sha256').update(data).digest('hex');
export function run(cwd, command, args = [], options = {}) {
  const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,...options,env:{...process.env,...options.env}});
  return {ok:r.status===0&&!r.error,code:r.status,stdout:r.stdout??'',stderr:r.stderr??'',error:r.error?.message??null};
}
export function git(cwd,args,options={}) {
  const r=run(cwd,'git',['-c','core.hooksPath=/dev/null',...args],options);
  if(!r.ok) throw Error(`Git ${args[0]}: ${r.stderr.toString().trim()||r.error}`);
  return Buffer.isBuffer(r.stdout)?r.stdout:r.stdout.trimEnd();
}
export function repoRoot(input) {
  const supplied=fs.realpathSync(input),root=fs.realpathSync(git(supplied,['rev-parse','--show-toplevel']));
  if(root!==supplied) throw Error('Use the Git repository root, not a subdirectory.');
  return root;
}
export function snapshot(repo,parent=null,message='FixRelay snapshot') {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fixrelay-index-'));
  const env={GIT_INDEX_FILE:path.join(temporary,'index'),GIT_AUTHOR_NAME:'FixRelay',GIT_AUTHOR_EMAIL:'fixrelay@localhost',GIT_COMMITTER_NAME:'FixRelay',GIT_COMMITTER_EMAIL:'fixrelay@localhost'};
  try {
    git(repo,['read-tree',parent||'HEAD'],{env}); git(repo,['add','-A','--','.'],{env});
    const tree=git(repo,['write-tree'],{env});
    return parent?git(repo,['commit-tree',tree,'-p',parent],{env,input:message+'\n'}):tree;
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}
export function fingerprint(repo) {
  return {head:git(repo,['rev-parse','HEAD']),tree:snapshot(repo),index:hash(git(repo,['ls-files','--stage','-z'])),status:git(repo,['status','--porcelain=v1','-z'])};
}
export function atomic(file,data) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(data,null,2)+'\n',{mode:0o600}); fs.renameSync(temporary,file);
}
export function safeRelative(value) {
  if(typeof value!=='string'||!value||value.includes('\0')||value.includes('\\')||path.posix.isAbsolute(value)||value.split('/').some(v=>!v||v==='.'||v==='..'||v==='.git')) throw Error(`Unsafe relative path: ${value}`);
  return value;
}
export function commandVectors(value) {
  if(!Array.isArray(value)||value.length>32||value.some(c=>!Array.isArray(c)||!c.length||c.length>64||c.some(v=>typeof v!=='string'||!v||v.includes('\0')))) throw Error('Checks must be nonempty command argument arrays.');
  return value;
}
export function clean(repo) {
  if(git(repo,['status','--porcelain'])) throw Error('Commit or remove nonignored changes before creating a relay.');
}
