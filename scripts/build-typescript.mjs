import ts from 'typescript';
import { mkdir,writeFile,rename,rm } from 'node:fs/promises';
import { resolve,dirname,sep } from 'node:path';
import { randomUUID } from 'node:crypto';

// Emit first, then atomically replace only this package's generated dist files.
// Windows scanners/editors may temporarily lock an existing output. Never reset source or disable protections.
const project=resolve(process.cwd(),'tsconfig.json');
const config=ts.readConfigFile(project,ts.sys.readFile);
const format={getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:file=>file,getNewLine:()=> '\n'};
if(config.error) { console.error(ts.formatDiagnosticsWithColorAndContext([config.error],format));process.exit(1); }
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,dirname(project));
const outputRoot=resolve(parsed.options.outDir ?? '');
if(outputRoot!==resolve(process.cwd(),'dist')) throw new Error('Atomic build only supports the current package dist directory');
const program=ts.createProgram(parsed.fileNames,parsed.options);
const diagnostics=[...parsed.errors,...ts.getPreEmitDiagnostics(program)];
if(diagnostics.length) { console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,format));process.exit(1); }
const outputs=[];
const emitted=program.emit(undefined,(file,data,bom)=>outputs.push({file:resolve(file),data:(bom?'\uFEFF':'')+data}));
if(emitted.emitSkipped || emitted.diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(emitted.diagnostics,format));process.exit(1);
}
for(const {file,data} of outputs) {
  if(!file.startsWith(outputRoot+sep)) throw new Error('Generated output escaped package dist');
  await mkdir(dirname(file),{recursive:true});
  const temporary=file+'.gss-build-'+randomUUID()+'.tmp';
  try {
    await writeFile(temporary,data,'utf8');
    for(let attempt=0;;attempt++) {
      try { await rename(temporary,file);break; }
      catch(error) {
        if(!['EBUSY','EPERM','EACCES','UNKNOWN'].includes(error.code) || attempt>=5) throw error;
        console.warn('Retrying temporarily busy generated output: '+file);
        await new Promise(resolveDelay=>setTimeout(resolveDelay,100*(attempt+1)));
      }
    }
  } finally {
    if(!resolve(temporary).startsWith(outputRoot+sep) || !temporary.includes('.gss-build-')) throw new Error('Unsafe compiler cleanup');
    await rm(temporary,{force:true}); // Only our uniquely named compiler temporary, never a source/output tree.
  }
}
