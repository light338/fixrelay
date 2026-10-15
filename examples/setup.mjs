import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {git} from '../src/git.mjs';

export const project=fileURLToPath(new URL('..',import.meta.url));
export const cases=[
  {id:'plain',kind:'control',args:['alpha'],expected:'alpha'},
  {id:'comma',kind:'control',args:['a,b'],expected:'"a,b"'},
  {id:'quote',kind:'control',args:['a"b'],expected:'"a""b"'},
  {id:'unicode',kind:'control',args:['東京 Café'],expected:'東京 Café'},
  {id:'empty',kind:'control',args:[''],expected:''},
  {id:'lf',kind:'regression',args:['first\nsecond'],expected:'"first\nsecond"'},
  {id:'cr',kind:'regression',args:['first\rsecond'],expected:'"first\rsecond"'},
  {id:'crlf',kind:'regression',args:['first\r\nsecond'],expected:'"first\r\nsecond"'},
];
export function setup(input) {
  let root=path.resolve(input);if(fs.existsSync(root))throw Error('Demo directory must not already exist.');fs.mkdirSync(root,{recursive:true});root=fs.realpathSync(root);
  const license=fs.readFileSync(path.join(project,'LICENSE'));
  const make=(name,file,code,exportName,extra='')=>{
    const repo=path.join(root,name);fs.mkdirSync(path.dirname(path.join(repo,file)),{recursive:true});
    fs.writeFileSync(path.join(repo,file),code);fs.writeFileSync(path.join(repo,'LICENSE'),license);fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name,private:true,type:'module'}));
    fs.mkdirSync(path.join(repo,'test'));fs.writeFileSync(path.join(repo,'test/baseline.test.mjs'),`import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {${exportName}} from '../${file}';\ntest('existing CSV controls',()=>{assert.equal(${exportName}('plain'),'plain');assert.equal(${exportName}('x,y'),'"x,y"');assert.equal(${exportName}('q"z'),'"q""z"');${extra}});\n`);
    git(repo,['init','-q']);git(repo,['config','user.name','FixRelay demo']);git(repo,['config','user.email','demo@localhost']);git(repo,['add','.']);git(repo,['commit','-qm','Baseline implementation']);return {repo,file,exportName};
  };
  const old='export function csvCell(value) { return /[",]/.test(value) ? `"${value.replaceAll(\'"\',\'""\')}"` : value; }\n';
  const fixed=old.replace('[",]','[",\\r\\n]');
  const source=make('source','src/csv.mjs',old,'csvCell');fs.writeFileSync(path.join(source.repo,source.file),fixed);git(source.repo,['add','.']);git(source.repo,['commit','-qm','Quote embedded CSV line breaks']);
  // Target implementations are intentionally buggy inputs. No target repair code is provided.
  const targets=[
    make('billing','lib/cell.mjs','export function encodeCell(text) { const escaped = text.replace(/"/g, \'""\'); if (text.includes(",") || text.includes(\'"\')) return \'"\' + escaped + \'"\'; return text; }\n','encodeCell'),
    make('crm','utils/format.ts','export const serializeField = (entry: string): string => { let needsQuotes = entry.indexOf(",") >= 0 || entry.indexOf(\'"\') >= 0; const safe = entry.split(\'"\').join(\'""\'); return needsQuotes ? `"${safe}"` : entry; };\n','serializeField'),
    make('exporter','csv/escape.mjs','export function escapeRecordValue(input) { const symbols = [",", \'"\']; const quoted = symbols.some(symbol => input.indexOf(symbol) !== -1); const escaped = input.replaceAll(\'"\', \'""\'); return quoted ? [\'"\', escaped, \'"\'].join("") : input; }\n','escapeRecordValue'),
  ];
  const alreadyFixed=make('already-fixed','csv.mjs',fixed,'csvCell');
  const incompatible=make('unrelated','encode.mjs','export function encodeValue(value) { return encodeURIComponent(value); }\n','encodeValue');
  const broken=make('broken-import','broken.mjs','import "./missing.mjs";\nexport function csvCell(value) { return value; }\n','csvCell');
  const state=path.join(root,'run');
  const capture={source:source.repo,entry:source.file,exportName:source.exportName,cases,instruction:'Carry the source CSV fix so embedded CR, LF and CRLF fields are quoted, preserving each target API and existing quoting behavior.'};
  fs.writeFileSync(path.join(root,'capture.json'),JSON.stringify(capture,null,2));
  fs.writeFileSync(path.join(root,'fixtures.json'),JSON.stringify({root,source,targets,alreadyFixed,incompatible,broken,state},null,2));
  return {root,source,targets,alreadyFixed,incompatible,broken,state,capture};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(setup(process.argv[2]??path.join(project,'demo-work')),null,2));
