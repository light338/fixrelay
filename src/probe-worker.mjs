import {pathToFileURL} from 'node:url';
import fs from 'node:fs';

const request=JSON.parse(fs.readFileSync(0,'utf8'));
try {
  const module=await import(pathToFileURL(request.file).href),fn=module[request.exportName];
  if(typeof fn!=='function')throw Error('Selected export is not callable');
  const results=[];
  for(const sample of request.cases) {
    try {
      const actual=await fn(...structuredClone(sample.args));
      if(actual===undefined)throw Error('Undefined return value is outside the JSON contract');
      const encoded=JSON.stringify(actual,(_,v)=>{if(typeof v==='number'&&!Number.isFinite(v))throw Error('Non-finite return value');return v;});
      if(encoded===undefined)throw Error('Return value is outside JSON');
      results.push({id:sample.id,actual:JSON.parse(encoded)});
    }catch(error){results.push({id:sample.id,error:String(error.message).slice(0,2000)});}
  }
  // Use a private result channel: ordinary console output cannot masquerade as JSON.
  fs.writeFileSync(request.result,JSON.stringify({results}));
}catch(error){fs.writeFileSync(request.result,JSON.stringify({error:String(error.message).slice(0,2000)}));process.exitCode=1;}
