// Render LaTeX math to SVG with MathJax 3, for epsilon_convert.py.
//
// Usage: node render_math.js job.json result.json
//   job.json:    {"items": [{"tex": "...", "display": true|false}, ...],
//                 "macros": {...MathJax macro definitions...},
//                 "packages": ["base", "ams", ...]}
//   result.json: {"out": [svg markup per item], "cache": global glyph cache,
//                 "css": MathJax stylesheet, "errors": [{"index", "tex", "message"}],
//                 "undefined": [indices of items that used undefined macros]}
const fs = require('fs');
const path = require('path');

let MJ;
try {
  MJ = path.dirname(require.resolve('mathjax-full/js/mathjax.js', {paths: [__dirname]}));
} catch (e) {
  console.error('mathjax-full is not installed. Run "npm install" in ' + __dirname);
  process.exit(2);
}
const {mathjax} = require(MJ + '/mathjax.js');
const {TeX} = require(MJ + '/input/tex.js');
const {SVG} = require(MJ + '/output/svg.js');
const {liteAdaptor} = require(MJ + '/adaptors/liteAdaptor.js');
const {RegisterHTMLHandler} = require(MJ + '/handlers/html.js');
require(MJ + '/input/tex/AllPackages.js');  // registers every extension; `packages` picks the active ones

const [jobFile, outFile] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({
  packages: job.packages,
  macros: job.macros || {},
  tags: 'ams',
  formatError: (jax, err) => { throw new Error(err.message); }
});
const svg = new SVG({fontCache: 'global'});
const doc = mathjax.document('', {InputJax: tex, OutputJax: svg});

const out = [];
const errors = [];
const undefinedUse = [];
job.items.forEach((it, k) => {
  try {
    const node = doc.convert(it.tex, {display: it.display, em: 16, ex: 8, containerWidth: 640});
    const markup = adaptor.outerHTML(node);
    if (markup.includes('data-mjx-error') || /fill="red"|color="red"/.test(markup)) undefinedUse.push(k);
    out.push(markup);
  } catch (e) {
    errors.push({index: k, tex: it.tex, message: e.message});
    const safe = it.tex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    out.push('<code class="math-error" title="' + e.message.replace(/"/g, '&quot;') + '">' + safe + '</code>');
  }
});

const cacheNode = svg.pageElements(doc);
const cache = cacheNode ? adaptor.outerHTML(cacheNode) : '';
const css = adaptor.textContent(svg.styleSheet(doc));
fs.writeFileSync(outFile, JSON.stringify({out, cache, css, errors, undefined: undefinedUse}));
