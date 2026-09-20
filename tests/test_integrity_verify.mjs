import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { generateArtifacts } from '../integrity/generate.js';
import { verifyArtifacts, newReport, finish } from '../integrity/verify.js';
import { canonicalBytes } from '../integrity/canonicalize.js';
import { ingest } from '../integrity/ingest.js';
import { DEFAULT_LIMITS } from '../integrity/errors.js';
import { renderReceiptMarkdown } from '../renderer/render.js';
import { receipt, outcome, bytes, fixture } from './integrity-helpers.mjs';

const triplet = r => { const recordBytes=bytes(r); return {recordBytes,...generateArtifacts({recordBytes})}; };
for (const file of readdirSync(new URL('../examples/',import.meta.url)).filter(f=>f.endsWith('.json'))) {
  test('existing example and canonical re-ingestion: ' + file, () => {
    const recordBytes=readFileSync(new URL('../examples/'+file,import.meta.url));
    const a=generateArtifacts({recordBytes});
    assert.equal(a.report.exit_code,0);
    assert.equal(verifyArtifacts({recordBytes,...a}).exit_code,0);
    const canonical=canonicalBytes(ingest(recordBytes).value,DEFAULT_LIMITS);
    const b=generateArtifacts({recordBytes:canonical});
    assert.equal(b.report.exit_code,0);
    assert.deepEqual(a.integrityBytes,b.integrityBytes);
    assert.deepEqual(a.markdownBytes,b.markdownBytes);
  });
}
test('spelling aliases, object order, Unicode distinctions, array order', () => {
  const r=receipt(), a=triplet(r);
  const alias=Buffer.from(bytes(r).toString().replace('71.2','7.120e1').replace('"Ship"','"\\u0053hip"'));
  assert.equal(verifyArtifacts({...a,recordBytes:alias}).exit_code,0);
  const reverse=Object.fromEntries(Object.entries(r).reverse());
  assert.equal(verifyArtifacts({...a,recordBytes:bytes(reverse)}).exit_code,0);
  r.assumptions=['a','b']; const b=triplet(r); r.assumptions.reverse();
  assert.equal(verifyArtifacts({...b,recordBytes:bytes(r)}).checks.fingerprint_match.status,'fail');
  r.decision.summary='é'; const c=triplet(r);r.decision.summary='e\u0301';
  assert.equal(verifyArtifacts({...c,recordBytes:bytes(r)}).checks.fingerprint_match.status,'fail');
});
for(const [name, edit] of [
  ['fingerprint',m=>m.digest='0'.repeat(64)], ['receipt binding',m=>m.record_id='bl_2026-09-19_other'],
  ['type binding',m=>m.record_type='outcome'], ['unknown field',m=>m.renderer_profile='0.1'],
  ['uppercase digest',m=>m.digest=m.digest.toUpperCase()], ['short digest',m=>m.digest='a'.repeat(63)],
  ['trailing newline digest',m=>m.digest+='\n'], ['missing field',m=>delete m.hash_algorithm],
]) test('metadata rejection: '+name,()=> {
  const a=triplet(receipt()), m=JSON.parse(a.integrityBytes);edit(m);
  assert.equal(verifyArtifacts({...a,integrityBytes:bytes(m)}).exit_code,1);
});
for(const key of ['basisline_integrity_version','canonicalization','hash_algorithm','digest_encoding']) {
  test('unsupported metadata selector '+key,()=>{
    const a=triplet(receipt()),m=JSON.parse(a.integrityBytes);m[key]='unknown';
    const r=verifyArtifacts({...a,integrityBytes:bytes(m)});
    assert.equal(r.exit_code,2);assert.equal(r.checks.metadata_schema.status,'unsupported');
    assert.equal(r.checks.markdown_match.status,'skipped');
    assert.equal(r.checks.fingerprint_match.status,'skipped');
  });
}
test('strict ingestion also applies to metadata',()=>{
  const a=triplet(receipt());
  const text=a.integrityBytes.toString().replace('"digest":', '"digest":"x","\\u0064igest":');
  assert.equal(verifyArtifacts({...a,integrityBytes:Buffer.from(text)}).checks.metadata_input.code,'DUPLICATE_MEMBER');
});
test('outcome binding uses outcome ID, not receipt ID',()=>{
  const a=triplet(outcome()),m=JSON.parse(a.integrityBytes);m.record_id=outcome().receipt_id;
  assert.equal(verifyArtifacts({...a,integrityBytes:bytes(m)}).checks.record_binding.status,'fail');
});
for(const [name, transform] of [
  ['CRLF',b=>Buffer.from(b.toString().replace(/\n/g,'\r\n'))],
  ['missing final LF',b=>b.subarray(0,-1)],['extra final LF',b=>Buffer.concat([b,Buffer.from('\n')])],
  ['BOM',b=>Buffer.concat([Buffer.from('efbbbf','hex'),b])],['invalid UTF8',()=>Buffer.from([0xff])],
  ['legacy renderer',()=>Buffer.from(renderReceiptMarkdown(receipt()))],
]) test('exact Markdown comparison: '+name,()=>{
  const a=triplet(receipt()),r=verifyArtifacts({...a,markdownBytes:transform(a.markdownBytes)});
  assert.equal(r.exit_code,1);assert.equal(r.checks.fingerprint_match.status,'pass');
  assert.equal(r.checks.markdown_match.status,'fail');
});
test('explicit scopes, missing artifacts, malformed optional API arguments',()=>{
  const a=triplet(receipt());
  assert.equal(verifyArtifacts({...a,markdownBytes:undefined}).exit_code,3);
  const r=verifyArtifacts({...a,markdownBytes:undefined,recordOnly:true});
  assert.equal(r.exit_code,0);assert.equal(r.checks.markdown_match.status,'not_requested');
  assert.equal(verifyArtifacts({...a,integrityBytes:undefined}).exit_code,3);
  assert.equal(verifyArtifacts({...a,recordBytes:undefined}).exit_code,3);
  assert.equal(verifyArtifacts({...a,relatedRecords:null}).exit_code,2);
  assert.equal(verifyArtifacts({...a,relatedRecords:Array(33).fill(a.recordBytes)}).exit_code,2);
  assert.equal(verifyArtifacts({...a,recordOnly:'yes'}).exit_code,2);
});
test('independently supplied expected digest is an explicit comparison',()=>{
  const a=triplet(receipt());
  assert.equal(verifyArtifacts({...a,expectedDigest:a.report.computed_digest}).exit_code,0);
  assert.equal(verifyArtifacts({...a,expectedDigest:'0'.repeat(64)}).checks.expected_digest.status,'fail');
  assert.equal(verifyArtifacts({...a,expectedDigest:'bad'}).exit_code,2);
});
test('EXPECTED LIMITATION: replacement, replay, omission, and separate histories',()=>{
  const original=triplet(receipt()),changed=receipt();changed.decision.summary='Replaced';
  const replacement=triplet(changed);
  for(const a of [original,replacement]) {
    const r=verifyArtifacts(a);assert.equal(r.exit_code,0);
    assert.deepEqual(Object.values(r.assurance),Array(4).fill('not_established'));
    assert.equal(Object.hasOwn(r,'verified'),false);
  }
  assert.equal(verifyArtifacts({...replacement,expectedDigest:original.report.computed_digest}).exit_code,1);
  // An absent outcome is not discoverable from this valid receipt.
  assert.equal(verifyArtifacts(original).checks.relationships.status,'not_requested');
});
test('swapping sidecars and same-ID different-digest conflicts',()=>{
  const r=receipt(), a=triplet(r);r.decision.context='different';const b=triplet(r);
  assert.equal(verifyArtifacts({...a,integrityBytes:b.integrityBytes}).exit_code,1);
  assert.equal(verifyArtifacts({...a,relatedRecords:[b.recordBytes]}).checks.relationships.code,'SAME_ID_DIFFERENT_DIGEST');
});
test('receipt/outcome ID relationship and unchanged receipt digest',()=>{
  const a=triplet(receipt()),b=triplet(outcome());
  assert.equal(verifyArtifacts({...b,receiptBytes:a.recordBytes}).exit_code,0);
  const wrong=receipt();wrong.receipt_id='bl_2026-09-19_wrong';
  assert.equal(verifyArtifacts({...b,receiptBytes:bytes(wrong)}).checks.relationships.code,'RECEIPT_RELATIONSHIP_MISMATCH');
  assert.equal(verifyArtifacts({...a,relatedRecords:[b.recordBytes]}).computed_digest,a.report.computed_digest);
  assert.deepEqual(generateArtifacts({recordBytes:a.recordBytes}).integrityBytes,a.integrityBytes);
});
test('forks, cycles and dangling references are local observations, not completeness',()=>{
  const base=receipt(),a=receipt(),b=receipt();a.receipt_id='bl_2026-09-19_a2';b.receipt_id='bl_2026-09-19_a3';
  a.revision.supersedes=b.revision.supersedes=base.receipt_id;
  let r=verifyArtifacts({...triplet(base),relatedRecords:[bytes(a),bytes(b)]});
  assert.equal(r.exit_code,0);assert.ok(r.diagnostics.some(d=>d.code==='REVISION_FORK'));
  a.revision.supersedes=a.receipt_id;
  r=verifyArtifacts({...triplet(a),relatedRecords:[bytes(base)]});
  assert.ok(r.diagnostics.some(d=>d.code==='REVISION_CYCLE'));
});
test('own unexpected schema names rejected without prototype effects',()=>{
  for(const name of ['__proto__','constructor','toString']) {
    const source=bytes(receipt()).toString().replace('"decision":','"'+name+'":1,"decision":');
    assert.equal(generateArtifacts({recordBytes:Buffer.from(source)}).report.checks.record_schema.status,'fail');
  }
});
for(const c of JSON.parse(readFileSync(new URL('./date-format-cases.json',import.meta.url)))) {
  test('Integrity temporal classification '+c.format+' '+JSON.stringify(c.value),()=>{
    const r=receipt();if(c.format==='date')r.decision.date=c.value;else r.evidence_as_of=c.value;
    const a=generateArtifacts({recordBytes:bytes(r)});
    const expected=c.limitation?'unresolved':c.valid?'pass':'fail';
    assert.equal(a.report.checks.record_schema.status,expected);
    if(c.limitation) {
      assert.equal(a.report.exit_code,2);assert.equal(a.integrityBytes,undefined);
      const v=verifyArtifacts({...triplet(receipt()),recordBytes:bytes(r)});
      assert.equal(v.result,'incomplete');assert.equal(v.exit_code,2);
      assert.equal(v.checks.record_schema.code,'SCHEMA_FORMAT_UNRESOLVED');
      assert.equal(v.checks.fingerprint_match.status,'skipped');assert.equal(v.checks.markdown_match.status,'skipped');
    }
  });
}
test('known schema error is not hidden by temporal uncertainty',()=>{
  const r=receipt();r.evidence_as_of='2016-12-31T23:59:60Z';delete r.decision.owner;
  assert.equal(generateArtifacts({recordBytes:bytes(r)}).report.checks.record_schema.status,'fail');
});
test('unsupported record versions and malformed discriminators',()=>{
  for(const value of ['0.2','1.0']) {const r=receipt();r.basisline_version=value;assert.equal(generateArtifacts({recordBytes:bytes(r)}).report.exit_code,2);}
  const r=receipt();r.record_type={};
  assert.equal(generateArtifacts({recordBytes:bytes(r)}).report.exit_code,1);
});
test('object-valued enum fields are refused without coercion/tool failures',()=>{
  for(const value of [{},[],null,1,{toString:'hostile'}]) {
    const r=receipt();r.decision.confidence=value;
    const a=generateArtifacts({recordBytes:bytes(r)});
    assert.equal(a.report.exit_code,1);
    assert.equal(a.report.checks.record_schema.code,'RECORD_SCHEMA');
    const t=triplet(receipt()),m=JSON.parse(t.integrityBytes);m.record_type=value;
    const v=verifyArtifacts({...t,integrityBytes:bytes(m)});
    if(value!==null && typeof value==='object') {
      // Sidecars admit no nested containers: ingestion refuses these earlier.
      assert.equal(v.exit_code,2);
      assert.equal(v.checks.metadata_input.code,'RESOURCE_DEPTH');
      assert.equal(v.checks.metadata_schema.status,'skipped');
    } else {
      assert.equal(v.exit_code,1);
      assert.equal(v.checks.metadata_schema.code,'METADATA_SCHEMA');
    }
  }
});
test('exit precedence is independent of check insertion order',()=>{
  for(const codes of [[1,2,3,4],[4,3,2,1]]) {
    const r=newReport();codes.forEach((c,i)=>r.checks['test'+i]={status:'fail',exit_code:c});
    assert.equal(finish(r).exit_code,4);
  }
});
test('related record uncertainty takes precedence over a completed numeric schema failure',()=>{
  const r=receipt();r.evidence_as_of='2016-12-31T23:59:60Z';
  const raw=bytes(r).toString().replace('"review_after_days":1','"review_after_days":1.0000000000000001');
  assert.ok(raw.includes('1.0000000000000001'));
  const report=verifyArtifacts({...triplet(receipt()),relatedRecords:[Buffer.from(raw)]});
  assert.equal(report.exit_code,2);
  assert.equal(report.checks.relationships.code,'RELATED_RECORD_INVALID');
});

function relatedFailures() {
  const invalid=receipt(), unresolved=receipt();
  delete invalid.decision.owner;
  unresolved.evidence_as_of='2016-12-31T23:59:60Z';
  return [bytes(invalid),bytes(unresolved)];
}
function assertRelatedFailures(report, order) {
  assert.equal(report.exit_code,2);
  assert.equal(report.result,'incomplete');
  assert.equal(report.checks.relationships.code,'RELATED_RECORD_INVALID');
  const causes=report.checks.relationships.causes;
  for(const [index,code] of order.entries()) {
    const cause=causes.find(c=>c.input==='related-record'&&c.index===index&&c.code===code);
    assert.ok(cause,code);
    assert.equal(cause.check,'record_schema');
    assert.equal(cause.status,code==='RECORD_SCHEMA'?'fail':'unresolved');
    assert.equal(cause.exit_code,code==='RECORD_SCHEMA'?1:2);
    if(code==='SCHEMA_FORMAT_UNRESOLVED') assert.equal(cause.path,'/evidence_as_of');
  }
  assert.deepEqual(report.assurance,{
    historical_existence:'not_established',authorship:'not_established',
    currentness:'not_established',history_completeness:'not_established',
  });
}
for(const reverse of [false,true]) {
  test('BLI-01 API classifies both independent failures, reverse='+reverse,()=>{
    const relatedRecords=relatedFailures(), order=['RECORD_SCHEMA','SCHEMA_FORMAT_UNRESOLVED'];
    if(reverse) {relatedRecords.reverse();order.reverse();}
    const input={...triplet(receipt()),relatedRecords};
    const report=verifyArtifacts(input);
    assertRelatedFailures(report,order);
    assert.equal(report.checks.relationships.causes.length,2);
    assert.deepEqual(verifyArtifacts(input),report);
  });
  test('BLI-01 API retains receipt mismatch with unresolved input, reverse='+reverse,()=>{
    const relatedRecords=relatedFailures(), order=['RECORD_SCHEMA','SCHEMA_FORMAT_UNRESOLVED'];
    if(reverse) {relatedRecords.reverse();order.reverse();}
    const wrong=receipt();wrong.receipt_id='bl_2026-09-19_wrong';
    const report=verifyArtifacts({...triplet(outcome()),receiptBytes:bytes(wrong),relatedRecords});
    assertRelatedFailures(report,order);
    assert.ok(report.checks.relationships.causes.some(c=>c.code==='RECEIPT_RELATIONSHIP_MISMATCH'&&c.exit_code===1&&c.status==='fail'));
  });
  test('BLI-01 valid-record conflict survives independent uncertainty, reverse='+reverse,()=>{
    const changed=receipt();changed.decision.summary='Different';
    const relatedRecords=[bytes(changed),relatedFailures()[1]];
    if(reverse) relatedRecords.reverse();
    const report=verifyArtifacts({...triplet(receipt()),relatedRecords});
    assert.equal(report.exit_code,2);
    const causes=report.checks.relationships.causes;
    assert.ok(causes.some(c=>c.code==='SAME_ID_DIFFERENT_DIGEST'&&c.exit_code===1));
    assert.ok(causes.some(c=>c.code==='SCHEMA_FORMAT_UNRESOLVED'&&c.status==='unresolved'));
  });
}
test('BLI-01 independent related uncertainty is classified with an invalid primary',()=>{
  const [invalid,unresolved]=relatedFailures();
  const report=verifyArtifacts({...triplet(receipt()),recordBytes:invalid,relatedRecords:[unresolved]});
  assert.equal(report.checks.record_schema.code,'RECORD_SCHEMA');
  assertRelatedFailures(report,['SCHEMA_FORMAT_UNRESOLVED']);
  const validRelated=verifyArtifacts({...triplet(receipt()),recordBytes:invalid,relatedRecords:[bytes(receipt())]});
  assert.equal(validRelated.exit_code,1);
  assert.equal(validRelated.checks.relationships.status,'skipped');
});
test('BLI-01 all 32 related records are classified without truncating unresolved causes',()=>{
  const [invalid,unresolved]=relatedFailures();
  const relatedRecords=Array(31).fill(invalid).concat(unresolved);
  for(const inputs of [relatedRecords,[...relatedRecords].reverse()]) {
    const report=verifyArtifacts({...triplet(receipt()),receiptBytes:invalid,relatedRecords:inputs});
    assert.equal(report.exit_code,2);
    assert.equal(report.checks.relationships.causes.length,33);
    assert.equal(report.checks.relationships.causes.filter(c=>c.code==='RECORD_SCHEMA').length,32);
    assert.equal(report.checks.relationships.causes.filter(c=>c.code==='SCHEMA_FORMAT_UNRESOLVED').length,1);
    assert.ok(report.diagnostics.length<=20);
  }
  assert.equal(verifyArtifacts({...triplet(receipt()),relatedRecords:[...relatedRecords,invalid]}).checks.operation.code,'INVALID_SCOPE_OR_RELATED_LIMIT');
});
test('BLI-01 missing related entries, including sparse holes, retain exit 3 precedence',()=>{
  const [invalid,unresolved]=relatedFailures();
  for(const relatedRecords of [[invalid,unresolved,undefined],[undefined,unresolved,invalid],Array(1)]) {
    const report=verifyArtifacts({...triplet(receipt()),relatedRecords});
    assert.equal(report.exit_code,3);
    assert.equal(report.result,'incomplete');
    assert.ok(report.checks.relationships.causes.some(c=>c.code==='RECORD_MISSING'&&c.exit_code===3));
    if(relatedRecords.length>1) assert.ok(report.checks.relationships.causes.some(c=>c.code==='SCHEMA_FORMAT_UNRESOLVED'));
  }
});
test('BLI-01 related tool failures retain exit 4 and do not stop later classification',()=>{
  class BrokenBytes extends Uint8Array { get buffer() { throw new Error('read failure'); } }
  const [invalid,unresolved]=relatedFailures();
  for(const relatedRecords of [[new BrokenBytes(1),invalid,unresolved],[unresolved,invalid,new BrokenBytes(1)]]) {
    const report=verifyArtifacts({...triplet(receipt()),relatedRecords});
    assert.equal(report.exit_code,4);
    const causes=report.checks.relationships.causes;
    assert.equal(causes.length,3);
    assert.ok(causes.some(c=>c.code==='TOOL_FAILURE'&&c.exit_code===4));
    assert.ok(causes.some(c=>c.code==='RECORD_SCHEMA'&&c.exit_code===1));
    assert.ok(causes.some(c=>c.code==='SCHEMA_FORMAT_UNRESOLVED'&&c.exit_code===2));
  }
});
test('BLI-02 outcome supersedes target is a specific nonfatal wrong-type diagnostic',()=>{
  const r=receipt(), target=outcome();r.revision.supersedes=target.outcome_id;
  const report=verifyArtifacts({...triplet(r),relatedRecords:[bytes(target)]});
  assert.equal(report.exit_code,0);
  assert.equal(report.checks.relationships.status,'pass');
  assert.deepEqual(report.diagnostics,[{code:'REVISION_TARGET_TYPE_MISMATCH'},{code:'RECEIPT_ID_MATCH_ONLY'}]);
  assert.deepEqual(Object.values(report.assurance),Array(4).fill('not_established'));
});
test('BLI-02 valid receipt supersedes target remains traversable without wrong-type diagnostic',()=>{
  const r=receipt(), target=receipt();target.receipt_id='bl_2026-09-19_prior';
  r.revision.supersedes=target.receipt_id;
  const report=verifyArtifacts({...triplet(r),relatedRecords:[bytes(target)]});
  assert.equal(report.exit_code,0);
  assert.equal(report.checks.relationships.status,'pass');
  assert.deepEqual(report.diagnostics,[]);
});
