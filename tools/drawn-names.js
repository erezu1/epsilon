// The commands MathJax draws as letters of their own (\lim: lim, \bmod: mod, \injlim: injlim), from MathJax itself:
// every command of every package the app draws papers with, drawn alone (or with digits for its arguments), and the
// Latin letters in its drawing read off (any font: italic, upright, bold; not ℓ, ℏ or ℜ, symbols of their own).
// The search rules (viewer/search-rules.js) read such a command as its letters, and every other one as one symbol, so
// that a search finds what is drawn: lim in \varprojlim, never ac in \frac.
//
// Usage: node tools/drawn-names.js [out.json]          the table, as JSON (default: printed)
//        node tools/drawn-names.js --rules viewer/search-rules.js
//                                                     the table written into the rules, between their two marks
// The table: {"mathjax": version, "always": {name: letters}, "packages": {pkg: {name: letters, or "" where the
// package draws a command of the always-on ones as no letters}}}; a command drawn with arguments (\pmod{1}) is named
// with a "#" after it (pmod#: mod), its letters its own, not its arguments'. Run again after a MathJax update.
const fs = require("fs");
const path = require("path");
const MJ = path.dirname(require.resolve("mathjax-full/js/mathjax.js", {paths: [path.join(__dirname, "..")]}));
const {mathjax} = require(MJ + "/mathjax.js");
const {TeX} = require(MJ + "/input/tex.js");
const {SVG} = require(MJ + "/output/svg.js");
const {liteAdaptor} = require(MJ + "/adaptors/liteAdaptor.js");
const {RegisterHTMLHandler} = require(MJ + "/handlers/html.js");
const {ConfigurationHandler} = require(MJ + "/input/tex/Configuration.js");
const {MapHandler} = require(MJ + "/input/tex/MapHandler.js");
require(MJ + "/input/tex/AllPackages.js");

// as epsilon_convert.py's mathjax_config: always on, and those a paper's own packages turn on (noundefined left out:
// a command it does not know would be drawn as its name)
const ALWAYS = ["base", "ams", "newcommand", "configmacros", "textmacros", "boldsymbol", "upgreek"];
const OPTIONAL = ["mathtools", "physics", "braket", "cancel", "color", "gensymb", "cases", "empheq", "centernot", "extpfeil"];

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

function namesOf(pkg) {                          // the commands a package's own tables hold
  const conf = ConfigurationHandler.get(pkg), out = new Set();
  if (!conf) return out;
  for (const m of conf.handler.macro || []) {
    const map = MapHandler.getMap(m);
    if (map && map.map) for (const k of map.map.keys()) out.add(k);
  }
  return out;
}

// a Latin letter, from its code in any of the drawing's fonts (Mathematical Alphanumeric Symbols included)
const HOLES = {0x210E: "h"};                     // (italic h: Planck's sign, outside the block)
function letterOf(code) {
  if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) return String.fromCharCode(code);
  if (code >= 0x1D400 && code <= 0x1D6A3) { const k = (code - 0x1D400) % 52; return String.fromCharCode(k < 26 ? 0x41 + k : 0x61 + k - 26); }
  return HOLES[code] || "";
}

function drawer(packages) {
  const tex = new TeX({packages, formatError: (jax, err) => { throw new Error(err.message); }});
  const svg = new SVG({fontCache: "none"});
  const doc = mathjax.document("", {InputJax: tex, OutputJax: svg});
  return function letters(name) {
    for (const args of ["", "{1}", "{1}{2}", "{1}{2}{3}", "[1]{2}", "{1}{2}{3}{4}"]) {
      let node;
      try { node = doc.convert("\\" + name + args, {display: false}); } catch (e) { continue; }
      const html = adaptor.outerHTML(node);
      if (/data-mjx-error|merror/.test(html)) continue;
      let s = "";
      for (const m of html.matchAll(/data-c="([0-9A-F]+)"/g)) s += letterOf(parseInt(m[1], 16));
      return args ? {s, args: true} : {s, args: false};
    }
    return null;                                  // (not to be drawn alone, or with plain arguments: \left, \begin)
  };
}

const always = {}, base = drawer(ALWAYS);
const names = new Set();
for (const p of ALWAYS) for (const n of namesOf(p)) names.add(n);
const key = (n, l) => n + (l.args ? "#" : "");
for (const n of [...names].sort()) { if (!/^[A-Za-z]+$/.test(n)) continue; const l = base(n); if (l && l.s) always[key(n, l)] = l.s; }
const packages = {};
for (const p of OPTIONAL) {
  const draw = drawer(ALWAYS.concat([p])), own = {};
  for (const n of [...namesOf(p)].sort()) {
    if (!/^[A-Za-z]+$/.test(n)) continue;
    const l = draw(n);
    if (l === null) continue;
    const k = key(n, l);
    if (l.s && l.s !== always[k]) own[k] = l.s;   // (a command it adds, or draws as other letters)
    else if (!l.s && always[k]) own[k] = "";      // (one it draws as no letters, where the always-on ones did)
  }
  if (Object.keys(own).length) packages[p] = own;
}
const out = {mathjax: mathjax.version, always, packages};
if (process.argv[2] === "--rules") {               // into the rules, between their marks, as one line each
  const file = process.argv[3], src = fs.readFileSync(file, "utf8");
  const A = "  // ---- drawn names: written by tools/drawn-names.js from MathJax " + mathjax.version + "; not to be edited by hand\n";
  const Z = "  // ---- end of drawn names\n";
  const i = src.indexOf("  // ---- drawn names:"), j = src.indexOf(Z);
  if (i < 0 || j < i) { console.error("no drawn-names marks in " + file); process.exit(1); }
  const block = A + "  var DRAWN_ALWAYS = " + JSON.stringify(always) + ";\n  var DRAWN_PACKAGES = " + JSON.stringify(packages) + ";\n" + Z;
  fs.writeFileSync(file, src.slice(0, i) + block + src.slice(j + Z.length));
  console.log("written: " + Object.keys(always).length + " always, " + Object.keys(packages).map((p) => p + " " + Object.keys(packages[p]).length).join(", "));
} else {
  const json = JSON.stringify(out, null, 1);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], json + "\n"); else console.log(json);
}
