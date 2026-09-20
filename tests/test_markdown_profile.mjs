import test from 'node:test';
import assert from 'node:assert/strict';
import { Parser } from 'commonmark';
import { generateArtifacts } from '../integrity/generate.js';
import { fixture, receipt, outcome, bytes } from './integrity-helpers.mjs';

for (const kind of ['receipt','outcome']) test('independent golden bytes ' + kind, () => {
  const a=generateArtifacts({recordBytes:fixture('profile-'+kind+'.json')});
  assert.equal(a.report.exit_code,0); assert.deepEqual(a.markdownBytes,fixture('profile-'+kind+'.md'));
  assert.ok(a.markdownBytes.at(-1)===10 && a.markdownBytes.at(-2)!==10);
});
const payloads = ['# forged\n## section','---\n***\n___','1. list\n- list\n+ list','> quote\n    code',
  '\x60\x60\x60html\n<script>alert(1)</script>\n\x60\x60\x60','~~~\nfence\n~~~','<img src=x onerror=x><!--hide-->',
  '[text](https://example.com) ![image](x)','[ref]: https://example.com\n[ref]','<https://example.com>',
  '&lt;script&gt; &#35; title', '\\\n# after slash','\n\n\n','  indent  \n\tend\r\nlast',
  '\u0000\u001b[31mred\u202e\u2066\u2028\u2029','\u00a0 space','a | b\n--- | ---'];
function structure(markdown) {
  const events=[],walker=new Parser().parse(markdown).walker(); let event;
  while((event=walker.next())) if(event.entering) {
    const n=event.node;
    assert.ok(!['link','image','html_inline','html_block','list','item','code_block','thematic_break','code'].includes(n.type), n.type);
    // Emphasis is template-owned for absence markers; user data must not add it.
    if(['heading','block_quote','strong','paragraph','emph'].includes(n.type)) events.push([n.type,n.level]);
  }
  return events;
}
for(const payload of payloads) test('literal safety ' + JSON.stringify(payload), () => {
  const r=receipt(), baseline=structure(generateArtifacts({recordBytes:bytes(r)}).markdownBytes.toString());
  r.decision.summary=r.decision.context=r.decision.owner=payload;
  r.evidence[0].source=r.evidence[0].metric=r.evidence[0].unit=payload; r.assumptions=[payload];
  const a=generateArtifacts({recordBytes:bytes(r)});
  assert.equal(a.report.exit_code,0);assert.deepEqual(structure(a.markdownBytes.toString()),baseline);
});
test('outcome and optional conflict strings use the same literal containment',()=>{
  for(const payload of payloads) {
    for(const r of [receipt(),outcome()]) {
      if(r.record_type==='receipt') r.known_conflicts=['baseline'];
      const baseline=structure(generateArtifacts({recordBytes:bytes(r)}).markdownBytes.toString());
      if(r.record_type==='receipt') r.known_conflicts=[payload];
      else r.actual_result=r.learning=payload;
      const a=generateArtifacts({recordBytes:bytes(r)});
      assert.equal(a.report.exit_code,0);
      assert.deepEqual(structure(a.markdownBytes.toString()),baseline);
    }
  }
});
test('visible controls, backslashes, multiline, and spaces have fixed spelling', () => {
  const r=receipt();r.decision.summary=' a \n\t\r\u0000\\n';
  const md=generateArtifacts({recordBytes:bytes(r)}).markdownBytes.toString();
  assert.ok(md.includes('> &#32;a&#32;\\\n> \\\\t\\\\r\\\\u\\{000000\\}\\\\\\\\n\n'));
  assert.ok(!md.includes('\r'));
});
test('leading space encoding does not treat other Unicode whitespace as ASCII spaces', () => {
  const r=receipt();r.decision.summary='\u00a0 x';
  assert.ok(generateArtifacts({recordBytes:bytes(r)}).markdownBytes.toString().includes('> \u00a0 x\n'));
});
test('exact output budget boundary regression', () => {
  const recordBytes=fixture('profile-receipt.json');
  const length=fixture('profile-receipt.md').length;
  assert.equal(generateArtifacts({recordBytes,limits:{maxOutputBytes:length}}).report.exit_code,0);
  assert.equal(generateArtifacts({recordBytes,limits:{maxOutputBytes:length-1}}).report.exit_code,2);
});

for(const [kind,label,next,expected,edit] of [
  ['string','**Summary:**','**Context:**','**Summary:**\n\n> Ship\n\n**Context:**',()=>{}],
  ['number','**Value:**','**Unit:**','**Value:**\n\n71.2\n\n**Unit:**',()=>{}],
  ['null','**Supersedes:**','## Related receipt IDs','**Supersedes:**\n\nnull\n\n## Related receipt IDs',()=>{}],
  ['omitted','**Supersedes:**','## Related receipt IDs','**Supersedes:**\n\n_Not supplied._\n\n## Related receipt IDs',r=>delete r.revision.supersedes],
]) test('BLI-03 exact '+kind+' value terminator before next template primitive',()=>{
  const r=receipt();edit(r);
  const a=generateArtifacts({recordBytes:bytes(r)});
  assert.equal(a.report.exit_code,0);
  const start=a.markdownBytes.indexOf(Buffer.from(label));
  assert.ok(start>=0);
  const end=a.markdownBytes.indexOf(Buffer.from(next),start+label.length);
  assert.ok(end>start);
  assert.deepEqual(a.markdownBytes.subarray(start,end+Buffer.byteLength(next)),Buffer.from(expected));
});
