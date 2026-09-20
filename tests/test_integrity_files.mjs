import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir, open, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readCaptured, writeCompanions } from '../integrity/files.js';
import { generateArtifacts } from '../integrity/generate.js';
import { verifyArtifacts } from '../integrity/verify.js';
import { fixture, receipt, bytes } from './integrity-helpers.mjs';

const cli=resolve('integrity/cli.js');
async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'basisline-integrity-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const recordPath=join(dir,'record.json'), integrityPath=join(dir,'record.integrity.json'), markdownPath=join(dir,'record.md');
  await writeFile(recordPath,fixture('profile-receipt.json'));
  return {dir,recordPath,integrityPath,markdownPath};
}
function args(p) {return ['--record',p.recordPath,'--integrity',p.integrityPath,'--markdown',p.markdownPath,'--json'];}
function run(a, env={}) {
  const result=spawnSync(process.execPath,[cli,...a],{encoding:'utf8',env:{...process.env,...env}});
  assert.equal(result.error,undefined);
  assert.equal(result.stdout.trim().split('\n').length,1);
  const report=JSON.parse(result.stdout);
  assert.equal(report.exit_code,result.status);
  return {report,result};
}
test('CLI generate and verify explicit paths, no authoritative record write',async t=>{
  const p=await setup(t), before=await readFile(p.recordPath);
  assert.equal(run(['generate',...args(p)]).report.exit_code,0);
  assert.deepEqual(await readFile(p.recordPath),before);
  assert.deepEqual(await readFile(p.markdownPath),fixture('profile-receipt.md'));
  assert.equal(run(['verify',...args(p)]).report.exit_code,0);
  assert.equal(run(['generate',...args(p)]).report.exit_code,4);
  assert.deepEqual(await readFile(p.recordPath),before);
});
test('CLI exit classes, invocation precedence and missing required companions',async t=>{
  const p=await setup(t);
  assert.equal(run(['unknown']).report.exit_code,2);
  assert.equal(run(['verify']).report.exit_code,3);
  assert.equal(run(['verify',...args(p),'--expected-digest','bad']).report.exit_code,2);
  assert.equal(run(['verify',...args(p)]).report.exit_code,3);
  run(['generate',...args(p)]);
  await writeFile(p.markdownPath,'wrong');
  assert.equal(run(['verify',...args(p)]).report.exit_code,1);
  await writeFile(p.recordPath,'{');
  assert.equal(run(['verify',...args(p)]).report.exit_code,2);
});
test('CLI invalid invocation is one contained JSON report without a stack trace',()=>{
  const {report,result}=run(['unknown']);
  assert.equal(report.exit_code,2);
  assert.equal(report.checks.operation.code,'USAGE');
  assert.equal(result.stderr,'');
  assert.ok(!result.stdout.includes('IntegrityError')&&!result.stdout.includes('at run'));
  for(const value of Object.values(report.assurance)) assert.equal(value,'not_established');
});
test('CLI module startup failure is contained without importing error helpers',async t=>{
  const p=await setup(t), copy=join(p.dir,'cli.mjs');
  await writeFile(copy,await readFile(cli));
  const result=spawnSync(process.execPath,[copy,'unknown'],{encoding:'utf8'});
  assert.equal(result.status,4);
  assert.equal(result.stderr,'');
  assert.equal(result.stdout.trim().split('\n').length,1);
  const report=JSON.parse(result.stdout);
  assert.equal(report.code,'TOOL_STARTUP_FAILURE');
  for(const value of Object.values(report.assurance)) assert.equal(value,'not_established');
});
test('CLI acquisition errors retain their actual class and deterministic precedence',async t=>{
  const p=await setup(t);run(['generate',...args(p)]);
  const link=join(p.dir,'link.json');await symlink(p.recordPath,link);
  const linked={...p,recordPath:link};
  let report=run(['verify',...args(linked)]).report;
  assert.equal(report.exit_code,2);
  assert.equal(report.checks.record_input.code,'SYMLINK_REFUSED');
  assert.equal(report.checks.fingerprint_match.status,'skipped');
  report=run(['verify',...args(p),'--max-bytes','4']).report;
  assert.equal(report.exit_code,2);
  assert.equal(report.checks.record_input.code,'RESOURCE_BYTES');
  assert.equal(report.checks.metadata_input.code,'RESOURCE_BYTES');
  report=run(['verify',...args({...linked,integrityPath:join(p.dir,'absent')})]).report;
  assert.equal(report.exit_code,3);
  report=run(['verify',...args(p),'--receipt-record',link,'--related-record',join(p.dir,'absent')]).report;
  assert.equal(report.exit_code,3);
  assert.equal(report.checks.relationships.code,'SYMLINK_REFUSED');
  assert.ok(Object.values(report.checks).some(c=>c.code==='ARTIFACT_MISSING'));
});
test('explicit record-only scope and expected digest',async t=>{
  const p=await setup(t);const {report}=run(['generate',...args(p)]);
  const a=['verify','--record',p.recordPath,'--integrity',p.integrityPath,'--record-only'];
  assert.equal(run([...a,'--expected-digest',report.computed_digest]).report.exit_code,0);
  assert.equal(run([...a,'--expected-digest','0'.repeat(64)]).report.exit_code,1);
  assert.equal(run([...a,'--markdown',p.markdownPath]).report.exit_code,2);
  assert.equal(run([...a,'--max-bytes','12abc']).report.exit_code,2);
});
test('symlinks, directories, special files and output aliases refused',async t=>{
  const p=await setup(t), link=join(p.dir,'link.json');await symlink(p.recordPath,link);
  await assert.rejects(readCaptured(link,1024*1024),/SYMLINK_REFUSED/);
  await assert.rejects(readCaptured(p.dir,1024),/REGULAR_FILE_REQUIRED/);
  await assert.rejects(readCaptured('/dev/null',1024),/REGULAR_FILE_REQUIRED/);
  const a=generateArtifacts({recordBytes:fixture('profile-receipt.json')});
  await assert.rejects(writeCompanions({...p,markdownPath:p.recordPath,...a}),/OUTPUT_PATH_COLLISION/);
  await symlink(p.recordPath,p.markdownPath);
  await assert.rejects(writeCompanions({...p,...a}),/OUTPUT_EXISTS/);
  assert.deepEqual(await readFile(p.recordPath),fixture('profile-receipt.json'));
});
test('outputs use restrictive permissions and refuse collision without deleting files',async t=>{
  const p=await setup(t),a=generateArtifacts({recordBytes:fixture('profile-receipt.json')});
  await writeFile(p.integrityPath,'existing');
  await assert.rejects(writeCompanions({...p,...a}),e=>e.code==='OUTPUT_EXISTS'&&e.details.possibly_incomplete_outputs.includes(p.markdownPath));
  assert.equal((await readFile(p.markdownPath)).length,0);
  assert.equal((await readFile(p.integrityPath)).toString(),'existing');
  assert.equal((await stat(p.markdownPath)).mode & 0o777,0o600);
});
test('partial second write reports incomplete outputs and cannot pass verification',async t=>{
  const p=await setup(t),a=generateArtifacts({recordBytes:fixture('profile-receipt.json')});
  const probe=await open(p.recordPath,'r'),proto=Object.getPrototypeOf(probe);await probe.close();
  const original=proto.writeFile;let calls=0;
  t.mock.method(proto,'writeFile',async function(...parameters) {
    if(++calls===2) {const e=new Error('disk full');e.code='ENOSPC';throw e;}
    return original.apply(this,parameters);
  });
  await assert.rejects(writeCompanions({...p,...a}),e=>e.code==='IO_FAILURE'&&e.details.possibly_incomplete_outputs.length===2);
  t.mock.restoreAll();
  assert.deepEqual(await readFile(p.markdownPath),a.markdownBytes);
  assert.equal(verifyArtifacts({recordBytes:fixture('profile-receipt.json'),integrityBytes:await readFile(p.integrityPath),markdownBytes:await readFile(p.markdownPath)}).exit_code,2);
});
test('process crash between companion writes leaves no successful triplet',async t=>{
  const p=await setup(t);
  const source = "import {open,readFile} from 'node:fs/promises';"+
    "import {generateArtifacts} from './integrity/generate.js';import {writeCompanions} from './integrity/files.js';"+
    "const p=JSON.parse(process.argv[1]);const h=await open(p.recordPath,'r');const proto=Object.getPrototypeOf(h);await h.close();"+
    "const original=proto.writeFile;proto.writeFile=async function(...a){await original.apply(this,a);process.exit(77);};"+
    "await writeCompanions({...p,...generateArtifacts({recordBytes:await readFile(p.recordPath)})});";
  const r=spawnSync(process.execPath,['--input-type=module','-e',source,JSON.stringify(p)]);
  assert.equal(r.status,77);assert.equal(run(['verify',...args(p)]).report.exit_code,2);
});
test('unresolved timestamp generation creates no outputs',async t=>{
  const p=await setup(t),r=receipt();r.evidence_as_of='2016-12-31T23:59:60Z';await writeFile(p.recordPath,bytes(r));
  const v=run(['generate',...args(p)]).report;
  assert.equal(v.exit_code,2);assert.equal(v.checks.record_schema.status,'unresolved');
  await assert.rejects(stat(p.integrityPath),{code:'ENOENT'});await assert.rejects(stat(p.markdownPath),{code:'ENOENT'});
});
test('missing output parent is an I/O failure, not a missing input artifact',async t=>{
  const p=await setup(t);p.markdownPath=join(p.dir,'absent-parent','record.md');
  const report=run(['generate',...args(p)]).report;
  assert.equal(report.exit_code,4);
  assert.equal(report.checks.operation.code,'IO_FAILURE');
  assert.deepEqual(report.checks.operation.possibly_incomplete_outputs,[]);
  await assert.rejects(stat(p.integrityPath),{code:'ENOENT'});
});
test('captured bytes are stable after pathname content replacement',async t=>{
  const p=await setup(t);const captured=await readCaptured(p.recordPath,1048576);
  await writeFile(p.recordPath,'{}');
  assert.deepEqual(captured,fixture('profile-receipt.json'));
  assert.equal(generateArtifacts({recordBytes:captured}).report.exit_code,0);
});
test('observable in-place change during descriptor read is refused',async t=>{
  const p=await setup(t),probe=await open(p.recordPath,'r'),proto=Object.getPrototypeOf(probe);await probe.close();
  const original=proto.read;let changed=false;
  t.mock.method(proto,'read',async function(...a) {
    const result=await original.apply(this,a);
    if(!changed){changed=true;await writeFile(p.recordPath,'x');}
    return result;
  });
  await assert.rejects(readCaptured(p.recordPath,1048576),/FILE_CHANGED_DURING_READ/);
  t.mock.restoreAll();
});
test('file read budgets and unsupported options fail closed',async t=>{
  const p=await setup(t);
  await assert.rejects(readCaptured(p.recordPath,4),/RESOURCE_BYTES/);
  assert.equal(run(['verify',...args(p),'--renderer-profile','legacy']).report.exit_code,2);
  assert.equal(run(['verify',...args(p),'--max-nodes','0']).report.exit_code,2);
});
test('machine diagnostics escape hostile output path characters',async t=>{
  const p=await setup(t);p.integrityPath=join(p.dir,'evil\u001b[31m\u202e\n.json');
  const {report,result}=run(['generate',...args(p)]);
  assert.equal(report.exit_code,0);
  assert.ok(!result.stdout.includes('\u001b')&&!result.stdout.includes('\u202e'));
  assert.equal(result.stderr,'');
});
test('locale/timezone determinism against fixed golden bytes',async t=>{
  for(const [TZ,LANG] of [['UTC','C'],['Asia/Kolkata','en_IN.UTF-8'],['America/New_York','tr_TR.UTF-8']]) {
    const p=await setup(t);
    assert.equal(run(['generate',...args(p)],{TZ,LANG,LC_ALL:LANG}).report.exit_code,0);
    assert.deepEqual(await readFile(p.markdownPath),fixture('profile-receipt.md'));
  }
});
test('long interior zero and space runs do not cause quadratic suffix scanning',()=>{
  const source = `
    import assert from 'node:assert/strict';
    import {generateArtifacts} from './integrity/generate.js';
    import {receipt} from './tests/integrity-helpers.mjs';
    const n=300000, r=receipt();
    r.decision.summary='x'+' '.repeat(n)+'y';
    const token='1'+'0'.repeat(n)+'1e-'+(n+1);
    const raw=JSON.stringify(r).replace('"value":71.2','"value":'+token);
    assert.ok(raw.includes(token));
    const a=generateArtifacts({recordBytes:Buffer.from(raw)});
    assert.equal(a.report.exit_code,0);
    assert.ok(a.markdownBytes.toString().includes('> '+r.decision.summary+'\\n'));
    assert.ok(a.report.diagnostics.some(d=>d.code==='DECIMAL_ROUNDING'));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stderr);
});

for(const reverse of [false,true]) {
  for(const mismatch of [false,true]) test('BLI-01 CLI related permutation reverse='+reverse+', receipt mismatch='+mismatch,async t=>{
    const p=await setup(t);
    if(mismatch) await writeFile(p.recordPath,fixture('profile-outcome.json'));
    assert.equal(run(['generate',...args(p)]).report.exit_code,0);
    const invalid=receipt(), unresolved=receipt();
    delete invalid.decision.owner;unresolved.evidence_as_of='2016-12-31T23:59:60Z';
    const invalidPath=join(p.dir,'invalid.json'), unresolvedPath=join(p.dir,'unresolved.json');
    await writeFile(invalidPath,bytes(invalid));await writeFile(unresolvedPath,bytes(unresolved));
    const paths=[invalidPath,unresolvedPath], codes=['RECORD_SCHEMA','SCHEMA_FORMAT_UNRESOLVED'];
    if(reverse) {paths.reverse();codes.reverse();}
    const invocation=['verify',...args(p),...paths.flatMap(path=>['--related-record',path])];
    if(mismatch) {
      const wrong=receipt();wrong.receipt_id='bl_2026-09-19_wrong';
      const wrongPath=join(p.dir,'wrong.json');await writeFile(wrongPath,bytes(wrong));
      invocation.push('--receipt-record',wrongPath);
    }
    const {report,result}=run(invocation);
    assert.equal(result.stderr,'');
    assert.equal(report.exit_code,2);assert.equal(report.result,'incomplete');
    const causes=report.checks.relationships.causes;
    for(const [index,code] of codes.entries()) {
      const cause=causes.find(c=>c.index===index&&c.input==='related-record'&&c.code===code);
      assert.ok(cause,code);
      assert.equal(cause.status,code==='RECORD_SCHEMA'?'fail':'unresolved');
      assert.equal(cause.exit_code,code==='RECORD_SCHEMA'?1:2);
      if(code==='SCHEMA_FORMAT_UNRESOLVED') assert.equal(cause.path,'/evidence_as_of');
    }
    assert.equal(causes.length,mismatch?3:2);
    if(mismatch) assert.ok(causes.some(c=>c.code==='RECEIPT_RELATIONSHIP_MISMATCH'&&c.exit_code===1));
    assert.deepEqual(Object.values(report.assurance),Array(4).fill('not_established'));
    assert.equal(run(invocation).result.stdout,result.stdout);
  });
  test('BLI-01 CLI acquisition failure preserves captured unresolved cause, reverse='+reverse,async t=>{
    const p=await setup(t);assert.equal(run(['generate',...args(p)]).report.exit_code,0);
    const unresolved=receipt();unresolved.evidence_as_of='2016-12-31T23:59:60Z';
    const unresolvedPath=join(p.dir,'unresolved.json'), link=join(p.dir,'link.json');
    await writeFile(unresolvedPath,bytes(unresolved));await symlink(p.recordPath,link);
    for(const [failedPath,code,exit] of [[link,'SYMLINK_REFUSED',2],[join(p.dir,'missing'),'ARTIFACT_MISSING',3]]) {
      const paths=[failedPath,unresolvedPath];if(reverse) paths.reverse();
      const {report}=run(['verify',...args(p),...paths.flatMap(path=>['--related-record',path])]);
      assert.equal(report.exit_code,exit);assert.equal(report.result,'incomplete');
      assert.ok(report.checks.relationships.causes.some(c=>c.code==='SCHEMA_FORMAT_UNRESOLVED'&&c.status==='unresolved'));
      assert.ok(Object.values(report.checks).some(c=>c.code===code&&c.exit_code===exit));
    }
  });
}

async function associationInputs(t) {
  const p=await setup(t);
  assert.equal(run(['generate',...args(p)]).report.exit_code,0);
  const invalid=receipt(), unresolved=receipt();
  delete invalid.decision.owner;
  unresolved.evidence_as_of='2016-12-31T23:59:60Z';
  const records={invalid:bytes(invalid),unresolved:bytes(unresolved),valid:bytes(receipt())};
  const paths={missing:join(p.dir,'missing.json'),missing2:join(p.dir,'missing2.json'),io:join(p.recordPath,'not-a-directory')};
  for(const [name,record] of Object.entries(records)) {
    paths[name]=join(p.dir,name+'.json');await writeFile(paths[name],record);
  }
  return {p,records,paths};
}
const associationExpectations={
  invalid:{code:'RECORD_SCHEMA',status:'fail',exit_code:1},
  unresolved:{code:'SCHEMA_FORMAT_UNRESOLVED',status:'unresolved',exit_code:2,path:'/evidence_as_of'},
  missing:{code:'ARTIFACT_MISSING',status:'fail',exit_code:3},
  missing2:{code:'ARTIFACT_MISSING',status:'fail',exit_code:3},
  io:{code:'IO_FAILURE',status:'fail',exit_code:4},
};
function associations(report) {
  const failures=[...(report.checks.relationships.causes||[]),...Object.values(report.checks).filter(c=>c.input)];
  return failures.filter(c=>c.input).map(({input,index,code,status,exit_code,path})=>({input,index,code,status,exit_code,...(path===undefined?{}:{path})}))
    .sort((a,b)=>a.input.localeCompare(b.input)||a.index-b.index);
}
function expectedAssociations(order,input='related-record') {
  return order.flatMap((name,index)=>associationExpectations[name]?[{input,index,...associationExpectations[name]}]:[]);
}
for(const [order,exit] of [
  [['missing','invalid','unresolved'],3],
  [['invalid','missing','unresolved'],3],
  [['invalid','unresolved','missing'],3],
  [['missing','unresolved','invalid'],3],
  [['unresolved','missing','invalid'],3],
  [['unresolved','invalid','missing'],3],
  [['missing','invalid','missing2','unresolved'],3],
  [['valid','missing','invalid','valid','missing2','unresolved','valid'],3],
  [['missing','missing2'],3],
  [['invalid','valid'],1],
  [['unresolved','invalid','valid'],2],
  [['valid','valid'],0],
  [['io','missing','invalid','unresolved'],4],
  [['unresolved','invalid','missing','io'],4],
]) test('BLI-04 original CLI association '+order.join(','),async t=>{
  const {p,paths}=await associationInputs(t);
  const invocation=['verify',...args(p),...order.flatMap(name=>['--related-record',paths[name]])];
  const {report,result}=run(invocation);
  assert.equal(report.exit_code,exit);
  assert.equal(report.result,exit===0?'checks_passed':exit===1?'checks_failed':'incomplete');
  assert.equal(result.stderr,'');
  assert.equal(result.stdout.trim().split('\n').length,1);
  assert.deepEqual(associations(report),expectedAssociations(order));
  assert.deepEqual(report.assurance,{
    historical_existence:'not_established',authorship:'not_established',
    currentness:'not_established',history_completeness:'not_established',
  });
});
for(const reference of ['missing','invalid','unresolved','valid']) {
  test('BLI-04 explicit receipt association remains separate: '+reference,async t=>{
    const {p,paths}=await associationInputs(t);
    const report=run(['verify',...args(p),'--receipt-record',paths[reference],
      '--related-record',paths.missing2,'--related-record',paths.invalid,'--related-record',paths.unresolved]).report;
    assert.equal(report.exit_code,3);assert.equal(report.result,'incomplete');
    const inputCauses=associations(report);
    const expected=[...expectedAssociations(['missing2','invalid','unresolved']),...expectedAssociations([reference],'receipt-reference')]
      .sort((a,b)=>a.input.localeCompare(b.input)||a.index-b.index);
    assert.deepEqual(inputCauses,expected);
    if(reference==='valid') assert.ok(report.checks.relationships.causes.some(c=>c.code==='RECEIPT_RELATIONSHIP_MISMATCH'&&c.exit_code===1));
  });
}
test('BLI-04 maximum count keeps original slots and rejects 33 inputs',async t=>{
  const {p,paths}=await associationInputs(t);
  const order=Array.from({length:32},(_,i)=>['missing','invalid','unresolved','valid'][i%4]);
  const invocation=['verify',...args(p),...order.flatMap(name=>['--related-record',paths[name]])];
  const report=run(invocation).report;
  assert.equal(report.exit_code,3);
  assert.deepEqual(associations(report),expectedAssociations(order));
  assert.equal(associations(report).length,24);
  const excess=run([...invocation,'--related-record',paths.io]).report;
  assert.equal(excess.exit_code,2);
  assert.equal(excess.checks.operation.code,'RELATED_LIMIT');
  assert.deepEqual(associations(excess),[]);
});
test('BLI-04 all-acquired CLI report and direct byte API semantics remain unchanged',async t=>{
  const {p,records,paths}=await associationInputs(t);
  const inputs={recordBytes:await readFile(p.recordPath),integrityBytes:await readFile(p.integrityPath),markdownBytes:await readFile(p.markdownPath)};
  const order=['invalid','valid','unresolved'];
  const cliReport=run(['verify',...args(p),...order.flatMap(name=>['--related-record',paths[name]])]).report;
  const apiReport=verifyArtifacts({...inputs,relatedRecords:order.map(name=>records[name])});
  assert.deepEqual(cliReport,apiReport);
  assert.deepEqual(associations(apiReport),expectedAssociations(order));
  const missingApi=verifyArtifacts({...inputs,relatedRecords:[undefined,records.invalid,records.unresolved]});
  assert.equal(missingApi.exit_code,3);
  assert.deepEqual(associations(missingApi),[
    {input:'related-record',index:0,code:'RECORD_MISSING',status:'fail',exit_code:3},
    {input:'related-record',index:1,...associationExpectations.invalid},
    {input:'related-record',index:2,...associationExpectations.unresolved},
  ]);
});
