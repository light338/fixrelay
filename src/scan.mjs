import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {git,repoRoot,safeRelative,hash} from './git.mjs';

export function functions(file,content) {
  const tree=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true);
  if(tree.parseDiagnostics.length)throw Error(`Cannot parse ${file}`);
  const result=[];
  for(const node of tree.statements) {
    if(!node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))continue;
    const entries=ts.isFunctionDeclaration(node)?[{name:node.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)?'default':node.name?.text,body:node.body,node}]:ts.isVariableStatement(node)?node.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)&&d.initializer&&(ts.isArrowFunction(d.initializer)||ts.isFunctionExpression(d.initializer))).map(d=>({name:d.name.text,body:d.initializer.body,node:d})):[];
    for(const entry of entries)if(entry.name&&entry.body) {
      const body=entry.body.getText(tree),scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,body),tokens=[];
      let token;while((token=scanner.scan())!==ts.SyntaxKind.EndOfFileToken)tokens.push(token===ts.SyntaxKind.Identifier?'identifier':token===ts.SyntaxKind.StringLiteral?'string':token===ts.SyntaxKind.NumericLiteral?'number':scanner.getTokenText());
      result.push({exportName:entry.name,line:tree.getLineAndCharacterOfPosition(entry.node.getStart(tree)).line+1,text:entry.node.getText(tree),tokens});
    }
  }
  return result;
}
export function signature(tokens) {
  const grams=new Set();for(let i=0;i<tokens.length-2;i++)grams.add(tokens.slice(i,i+3).join('\0'));return grams;
}
export function similarity(a,b) {
  const aa=signature(a),bb=signature(b),union=new Set([...aa,...bb]);
  return union.size?[...aa].filter(v=>bb.has(v)).length/union.size:0;
}
export function scanRepos(sourceFunction,repos) {
  if(!Array.isArray(repos)||!repos.length||repos.length>32)throw Error('Provide 1–32 repository roots.');
  const candidates=[],errors=[];
  for(const input of repos) {
    const repo=repoRoot(input),head=git(repo,['rev-parse','HEAD']);
    const files=git(repo,['ls-files','-z']).split('\0').filter(f=>/\.(?:mjs|js|ts|mts)$/.test(f)&&!f.endsWith('.d.ts'));
    if(files.length>2000)throw Error('Scan limit: 2000 JS/TS files per repository.');
    for(const relative of files) {
      safeRelative(relative);const file=path.join(repo,relative);
      if(!fs.existsSync(file)) {errors.push({repo,file:relative,error:'Tracked file missing'});continue;}
      if(fs.lstatSync(file).isSymbolicLink()||fs.realpathSync(file)!==file){errors.push({repo,file:relative,error:'Symlink refused'});continue;}
      if(fs.statSync(file).size>1024*1024){errors.push({repo,file:relative,error:'File exceeds 1 MiB'});continue;}
      try {const content=fs.readFileSync(file,'utf8');for(const entry of functions(relative,content))candidates.push({repo,head,file:relative,exportName:entry.exportName,line:entry.line,score:Number(similarity(sourceFunction.tokens,entry.tokens).toFixed(4)),sha256:hash(content)});}
      catch(error){errors.push({repo,file:relative,error:error.message});}
    }
  }
  return {candidates:candidates.sort((a,b)=>b.score-a.score||a.repo.localeCompare(b.repo)||a.file.localeCompare(b.file)).slice(0,200),errors,scope:'Lexical structural ranking of tracked exported functions, not proof of semantic equivalence or a bug. No target code executed.'};
}
