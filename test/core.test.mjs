import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setup,cases} from '../examples/setup.mjs';
import {FixRelay} from '../src/core.mjs';
import {fingerprint,git,hash,run} from '../src/git.mjs';
import {probe,validateCases} from '../src/probe.mjs';

function fixture(t) {
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fixrelay-test-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const f=setup(path.join(parent,'demo')),app=new FixRelay(f.state);app.capture(f.capture);return {...f,app,parent};
}
function prepare(f,target=f.targets[0],checks=[[process.execPath,'--experimental-strip-types','--test']],contractFiles=[]) {
  const p=f.app.probe(target);assert.equal(p.status,'reproduced');return f.app.prepare({probeId:p.probeId,checks,contractFiles});
}
function repair(plan,target) {
  // Explicit test-only repair, never provided to the live runner.
  fs.writeFileSync(path.join(plan.candidate,target.file),`export function ${target.exportName}(value) { return /[",\\r\\n]/.test(value) ? '"' + value.replaceAll('"','""') + '"' : value; }\n`);
}
test('three differing JS/TS targets reproduce and verify while all originals stay intact',t=>{
  const f=fixture(t),originals=[f.source,...f.targets].map(x=>[x.repo,fingerprint(x.repo)]);
  for(const target of f.targets) {
    const plan=prepare(f,target);assert.equal(f.app.report({planId:plan.planId}).status,'awaiting_adaptation');
    repair(plan,target);const result=f.app.finish({planId:plan.planId,note:'Test-authored equivalent quote fix.'});
    assert.equal(result.status,'checks_passed');assert.equal(result.before.status,'reproduced');assert.equal(result.after.status,'not_reproduced');
    assert.match(result.diff,/LICENSE.source/);assert.match(f.app.report({planId:plan.planId,format:'markdown'}),/# FixRelay verification/);
    fs.writeFileSync(path.join(plan.candidate,'extra.txt'),'later edit');assert.equal(f.app.report({planId:plan.planId}).status,'checks_stale');
  }
  for(const [repo,before] of originals)assert.deepEqual(fingerprint(repo),before);
});
test('already-fixed, incompatible and broken imports are never advertised as reproduced bugs',t=>{
  const f=fixture(t);
  for(const [target,status] of [[f.alreadyFixed,'not_reproduced'],[f.incompatible,'incompatible'],[f.broken,'inconclusive']]) {
    const p=f.app.probe(target);assert.equal(p.status,status);assert.throws(()=>f.app.prepare({probeId:p.probeId,checks:[[process.execPath,'-e','0']]}),/Only a reproduced/);
  }
});
test('scan is nonexecuting and ranks renamed functions without treating lexical similarity as proof',t=>{
  const f=fixture(t);const result=f.app.scan({repos:[...f.targets,f.alreadyFixed,f.broken].map(t=>t.repo)});
  assert.equal(result.candidates.length,5);assert.equal(result.candidates[0].repo,f.alreadyFixed.repo);
  for(const target of f.targets)assert.ok(result.candidates.some(c=>c.exportName===target.exportName));
  assert.match(result.scope,/not proof/);
});
test('existing tests and package configuration cannot be weakened to obtain passing verification',t=>{
  const f=fixture(t),plan=prepare(f);repair(plan,f.targets[0]);
  const file=path.join(plan.candidate,'test/baseline.test.mjs');fs.writeFileSync(file,'// assertions removed\n');
  assert.throws(()=>f.app.finish({planId:plan.planId,note:'Try weakened test'}),/Frozen test/);
});
test('frozen witness, external contracts, and original source/target changes invalidate a plan',t=>{
  const f=fixture(t),contract=path.join(f.parent,'contract.mjs');fs.writeFileSync(contract,'// external\n');
  const plan=prepare(f,f.targets[0],[[process.execPath,'--experimental-strip-types','--test']],[contract]);repair(plan,f.targets[0]);
  fs.writeFileSync(contract,'// weakened\n');assert.throws(()=>f.app.finish({planId:plan.planId,note:'Must fail'}),/Frozen external/);
  fs.writeFileSync(contract,'// external\n');fs.appendFileSync(path.join(f.targets[0].repo,f.targets[0].file),'// changed original\n');
  assert.throws(()=>f.app.finish({planId:plan.planId,note:'Must fail'}),/Original repository changed/);
  git(f.targets[0].repo,['restore',f.targets[0].file]);
  const capsule=path.join(f.state,'capsule.json');fs.appendFileSync(capsule,' ');
  assert.throws(()=>f.app.finish({planId:plan.planId,note:'Must fail'}),/capsule changed/);
});
test('checks must pass before adaptation and cannot modify candidate during verification',t=>{
  const f=fixture(t),p=f.app.probe(f.targets[0]);
  assert.throws(()=>f.app.prepare({probeId:p.probeId,checks:[]}),/Register baseline/);
  assert.throws(()=>f.app.prepare({probeId:p.probeId,checks:[[process.execPath,'-e','process.exit(1)']]}),/Baseline checks/);
  const marker=path.join(f.parent,'mutate');
  const check=[process.execPath,'-e',`if(require('fs').existsSync(${JSON.stringify(marker)}))require('fs').writeFileSync('extra.txt','unexpected')`];
  const plan=f.app.prepare({probeId:p.probeId,checks:[check]});repair(plan,f.targets[0]);fs.writeFileSync(marker,'yes');
  const result=f.app.finish({planId:plan.planId,note:'Check mutates files'});assert.equal(result.status,'checks_failed');assert.equal(result.verification.changedDuringChecks,true);
});
test('source capture requires a demonstrated fix and refuses overwriting output',t=>{
  const f=fixture(t);assert.throws(()=>f.app.capture(f.capture),/must not already exist/);
  assert.throws(()=>new FixRelay(path.join(f.parent,'invalid')).capture({...f.capture,before:'HEAD'}),/must differ/);
  const invalidCases=cases.map(c=>({...c,expected:'nonsense'}));
  assert.throws(()=>new FixRelay(path.join(f.parent,'wrong-witness')).capture({...f.capture,cases:invalidCases}),/Source fix is not demonstrated/);
  assert.throws(()=>validateCases([{id:'x',kind:'control',args:[],expected:1},{id:'x',kind:'regression',args:[],expected:2}]),/unique id/);
  fs.writeFileSync(path.join(f.source.repo,'fix-context.txt'),'Related fix context\n');git(f.source.repo,['add','.']);git(f.source.repo,['commit','--amend','--no-edit']);
  const withContext=new FixRelay(path.join(f.parent,'with-context'));withContext.capture(f.capture);
  assert.match(withContext.load().capsule.diff,/fix-context.txt/,'Capture must include the whole source-fix commit diff');
});
test('a throwing or unstable function is inconclusive, not evidence of the same bug',t=>{
  const f=fixture(t),dir=path.join(f.parent,'raw');fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'fn.mjs'),'export function fn(){throw Error("not a regression")};');assert.equal(probe(dir,'fn.mjs','fn',cases).status,'inconclusive');
  fs.writeFileSync(path.join(dir,'fn.mjs'),'export function fn(){return Math.random()};');assert.equal(probe(dir,'fn.mjs','fn',cases).status,'inconclusive');
});
test('unmodified candidates and failed behavioral fixes cannot pass; CLI reports machine-readable status',t=>{
  const f=fixture(t),plan=prepare(f);assert.throws(()=>f.app.finish({planId:plan.planId,note:'No actual repair'}),/no adaptation/);
  fs.appendFileSync(path.join(plan.candidate,f.targets[0].file),'// ineffective fix\n');
  assert.equal(f.app.finish({planId:plan.planId,note:'Comment only'}).status,'checks_failed');
  const cli=run(process.cwd(),process.execPath,[new URL('../bin/fixrelay.mjs',import.meta.url).pathname,'report','--state',f.state,'--json',JSON.stringify({planId:plan.planId})]);
  assert.equal(cli.ok,true,cli.stderr);assert.equal(JSON.parse(cli.stdout).status,'checks_failed');
  repair(plan,f.targets[0]);assert.equal(f.app.finish({planId:plan.planId,note:'Now repaired'}).status,'checks_passed');
});
test('probe-side writes are detected in the isolated copy and original target stays unchanged',t=>{
  const f=fixture(t),target=f.targets[0];
  fs.appendFileSync(path.join(target.repo,target.file),'\nimport fs from "node:fs";fs.writeFileSync("probe-side-effect.txt","changed");\n');git(target.repo,['add','.']);git(target.repo,['commit','-qm','side effect fixture']);
  const original=fingerprint(target.repo);assert.equal(f.app.probe(target).status,'inconclusive');assert.deepEqual(fingerprint(target.repo),original);
});
test('batch discovery probes ranked functions and prepares only the three demonstrated buggy targets',t=>{
  const f=fixture(t),config=path.join(f.parent,'targets.json');
  fs.writeFileSync(config,JSON.stringify({targets:[...f.targets,f.alreadyFixed,f.incompatible,f.broken].map(x=>({repo:x.repo,checks:[[process.execPath,'--experimental-strip-types','--test']]})),limit:20}));
  const result=run(process.cwd(),process.execPath,[new URL('../bin/fixrelay-discover.mjs',import.meta.url).pathname,'--state',f.state,'--input',config],{timeout:60000});
  assert.equal(result.ok,true,result.stderr);const batch=JSON.parse(result.stdout);
  assert.equal(batch.results.length,6);assert.equal(batch.results.filter(p=>p.planId).length,3);
  assert.deepEqual(batch.results.filter(p=>!p.planId).map(p=>p.status).sort(),['incompatible','inconclusive','not_reproduced']);
});
