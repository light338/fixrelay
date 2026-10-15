import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {setup,project,cases} from './setup.mjs';
import {FixRelay} from '../src/core.mjs';
import {fingerprint,hash,run} from '../src/git.mjs';
import {probe,worker} from '../src/probe.mjs';

const f=setup(process.argv[2]??path.join(project,'demo-work')),app=new FixRelay(f.state),evidence=path.join(f.root,'evidence');fs.mkdirSync(evidence);
const originals=[f.source,...f.targets,f.alreadyFixed,f.incompatible,f.broken].map(x=>({repo:x.repo,fingerprint:fingerprint(x.repo)}));
const runtimeFiles=['src/core.mjs','src/probe.mjs','src/probe-worker.mjs','src/git.mjs','src/scan.mjs','bin/fixrelay.mjs'];
const runtimeHashes=Object.fromEntries(runtimeFiles.map(file=>[file,hash(fs.readFileSync(path.join(project,file)))]));
const captured=app.capture(f.capture),capsuleHash=hash(fs.readFileSync(path.join(f.state,'capsule.json')));
const scan=app.scan({repos:[...f.targets,f.alreadyFixed,f.incompatible,f.broken].map(x=>x.repo)});
fs.writeFileSync(path.join(evidence,'scan.json'),JSON.stringify(scan,null,2));
const plans=[];const baselineHashes={};
for(const target of f.targets) {
  assert.ok(scan.candidates.some(c=>c.repo===target.repo&&c.file===target.file&&c.exportName===target.exportName));
  const p=app.probe(target);assert.equal(p.status,'reproduced');
  const plan=app.prepare({probeId:p.probeId,checks:[[process.execPath,'--experimental-strip-types','--test']]});plans.push({...plan,target});
  baselineHashes[plan.planId]=hash(fs.readFileSync(path.join(plan.candidate,'test/baseline.test.mjs')));
}
const controls=[];
for(const [target,expected] of [[f.alreadyFixed,'not_reproduced'],[f.incompatible,'incompatible'],[f.broken,'inconclusive']]) {
  const result=app.probe(target);assert.equal(result.status,expected);controls.push({repo:target.repo,...result});
}
const cli=path.join(project,'bin/fixrelay.mjs');
const prompt=`FixRelay has demonstrated a CSV bug in three independently written JS/TS fixture repositories. The original source fix commit is pinned. You must implement equivalent fixes yourself ONLY in these candidate worktrees: ${JSON.stringify(plans.map(p=>({planId:p.planId,candidate:p.candidate,file:p.target.file,exportName:p.target.exportName})))}.\nRead the brief for each plan by running ${process.execPath} ${cli} prompt --state ${f.state} --json '{"planId":"PLAN_ID"}'. Read the source before/after and witness cases in ${path.join(f.state,'capsule.json')}. Preserve each target's export/API, implementation style and existing quoting behavior; do not blindly replace all functions with one copied implementation. Add a regression test if useful. Existing tracked tests and package.json must stay byte-for-byte unchanged. Do not edit the FixRelay source, probe worker, capsule, ledger, source worktrees or original repos; do not commit/merge/push.\nFor each candidate, after editing, call ${process.execPath} ${cli} finish --state ${f.state} --json '{"planId":"PLAN_ID","note":"Explain the actual target adaptation"}'. Fix real errors and repeat if verification fails. Complete all three. Do not fabricate verification. No prewritten target repairs are supplied. Report the plan IDs, changes and results. The scope is a controlled fixture, not external adoption.`;
fs.writeFileSync(path.join(evidence,'agent-prompt.txt'),prompt);
const args=['exec','--ephemeral','--ignore-user-config','--skip-git-repo-check','-s',process.env.FIXRELAY_CODEX_SANDBOX??'workspace-write','-c','approval_policy="never"','-C',project,'--add-dir',f.root,'--json','-o',path.join(evidence,'agent-final.txt'),'-'];
console.log(`Real Codex adaptation of three candidates. Evidence: ${evidence}`);
const child=spawn(process.env.FIXRELAY_CODEX_BIN??'codex',args,{env:{...process.env,PATH:`${path.dirname(process.execPath)}:${process.env.PATH}`},stdio:['pipe','pipe','pipe']});child.stdin.end(prompt);
child.stdout.pipe(fs.createWriteStream(path.join(evidence,'agent-events.jsonl')));child.stderr.pipe(fs.createWriteStream(path.join(evidence,'agent-stderr.txt')));
await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`Codex exited ${code}; see evidence.`)));});
for(const item of originals)assert.deepEqual(fingerprint(item.repo),item.fingerprint,'An original changed');
assert.equal(hash(fs.readFileSync(path.join(f.state,'capsule.json'))),capsuleHash);
for(const [file,expected] of Object.entries(runtimeHashes))assert.equal(hash(fs.readFileSync(path.join(project,file))),expected,'Verifier source changed');
const results=[];
for(const plan of plans) {
  const report=app.report({planId:plan.planId});assert.equal(report.status,'checks_passed');assert.equal(report.verificationStale,false);
  assert.equal(hash(fs.readFileSync(path.join(plan.candidate,'test/baseline.test.mjs'))),baselineHashes[plan.planId]);
  assert.equal(probe(plan.candidate,plan.target.file,plan.target.exportName,cases).status,'not_reproduced');
  assert.equal(run(plan.candidate,process.execPath,['--experimental-strip-types','--test']).ok,true);
  fs.writeFileSync(path.join(evidence,`${plan.planId}.diff`),report.diff);results.push(report);
}
const report={version:1,liveAgent:true,prewrittenTargetRepairs:false,sourceFix:captured.source,sourceProof:captured.proof,candidateCount:3,results,controls,originalsUnchanged:true,existingTestsUnchanged:true,capsuleUnchanged:true,verifierUnchanged:true,independentPostAgentChecks:true,
  scope:'One authored CSV fixture with three JS/TS variants, three negative controls and a real Codex CLI adaptation. Not independently selected projects or external users.'};
fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(evidence,'review.md'),app.report({format:'markdown'}));
console.log(JSON.stringify({passed:true,plans:results.map(p=>({planId:p.planId,candidate:p.candidate,status:p.status})),evidence},null,2));
