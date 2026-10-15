#!/usr/bin/env node
import fs from 'node:fs';
import {FixRelay} from '../src/core.mjs';
import {repoRoot,commandVectors} from '../src/git.mjs';

const args=process.argv.slice(2);let state,input;
try {
  if(args.includes('--help')||!args.length){console.log('Usage: node bin/fixrelay-discover.mjs --state /absolute/run --input repos.json\nJSON: {targets:[{repo,checks?:[[command,arg,...]]}],limit?:20,minScore?:0}\nScans and executes finite witness probes in isolated worktrees. Checks are trusted code.\nPrepares candidates only for reproduced probes with registered passing baseline checks.');}
  else {
    while(args.length){const flag=args.shift();if(flag==='--state')state=args.shift();else if(flag==='--input')input=args.shift();else throw Error(`Unknown flag: ${flag}`);}
    if(!state||!input)throw Error('Provide --state and --input.');
    const config=JSON.parse(fs.readFileSync(input,'utf8'));
    if(Object.keys(config).some(k=>!['targets','limit','minScore'].includes(k))||!Array.isArray(config.targets)||!config.targets.length||config.targets.length>32)throw Error('Provide 1–32 targets.');
    const limit=config.limit??20,minScore=config.minScore??0;
    if(!Number.isInteger(limit)||limit<1||limit>64||!Number.isFinite(minScore)||minScore<0||minScore>1)throw Error('limit must be 1–64; minScore must be 0–1.');
    const targets=config.targets.map(t=>{if(!t||Object.keys(t).some(k=>!['repo','checks','contractFiles'].includes(k)))throw Error('Invalid target fields.');if(t.checks)commandVectors(t.checks);return {...t,repo:repoRoot(t.repo)};});
    if(new Set(targets.map(t=>t.repo)).size!==targets.length)throw Error('Duplicate target repositories.');
    const app=new FixRelay(state),scan=app.scan({repos:targets.map(t=>t.repo)}),selected=scan.candidates.filter(c=>c.score>=minScore).slice(0,limit),results=[];
    for(const candidate of selected) {
      const target=targets.find(t=>t.repo===candidate.repo);
      let evidence={repo:candidate.repo,file:candidate.file,exportName:candidate.exportName,score:candidate.score};
      try {
        const result=app.probe(candidate);evidence={...evidence,...result};
        if(result.status==='reproduced'&&target.checks?.length) {
          const plan=app.prepare({probeId:result.probeId,checks:target.checks,contractFiles:target.contractFiles});evidence.planId=plan.planId;evidence.candidate=plan.candidate;
        }
      }catch(error){evidence={...evidence,status:'inconclusive',error:error.message};}
      results.push(evidence);
    }
    console.log(JSON.stringify({results,scanErrors:scan.errors,scannedCandidates:scan.candidates.length,probedCandidates:selected.length,truncated:selected.length<scan.candidates.length,
      scope:'Finite JSON witness on ranked same-interface candidates only. Controls, errors and unprobed functions are not confirmed bugs. Original projects are not merged or pushed.'},null,2));
  }
}catch(error){console.error(error.message);process.exitCode=2;}
