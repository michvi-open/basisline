// The browser reference app ships a restrictive Content-Security-Policy and
// keeps every record-derived string escaped before it reaches innerHTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../reference-app/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../reference-app/app.js', import.meta.url), 'utf8');

test('CSP: same-origin scripts, styles and fetches only; no plugins, base or form targets', () => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(m, 'CSP meta tag present');
  const d = Object.fromEntries(m[1].split(';').map((x) => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(d['default-src'], ["'none'"]);
  assert.deepEqual(d['script-src'], ["'self'"]);
  assert.deepEqual(d['style-src'], ["'self'"]);
  assert.deepEqual(d['connect-src'], ["'self'"]);
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'none'"]);
});

test('no inline scripts, styles, event handlers or remote resources', () => {
  assert.ok(!/<script(?![^>]*\ssrc=)/.test(html));
  assert.ok(!/<style/.test(html) && !/\sstyle=/.test(html) && !/\sstyle=/.test(app));
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html));
  assert.ok(!/(src|href)="(https?:)?\/\//i.test(html));
});

test('app.js innerHTML interpolations are escaped or constant', () => {
  let checked = 0;
  for (const m of app.matchAll(/\.innerHTML\s*=([\s\S]*?);\n/g)) {
    // Every ${ in the right-hand side, including those inside nested .map()
    // templates, must open with escapeHtml( or be the errors/warnings array
    // whose own .map() template is checked by this same loop.
    for (const at of [...m[1].matchAll(/\$\{/g)].map((x) => x.index)) {
      const expr = m[1].slice(at + 2).split('\n')[0].trim();
      assert.ok(/^escapeHtml\(/.test(expr) || /^(errors|warnings)$/.test(expr), 'unreviewed innerHTML interpolation: ${' + expr);
      checked++;
    }
  }
  assert.ok(checked >= 4, `checked ${checked}`);
});
