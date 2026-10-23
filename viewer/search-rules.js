// Epsilon's rules for search in a paper, shared by the app (nav.js, "search in the paper") and the PDF viewer for
// Chrome (epsilon_pdf_reader: pdf-search.mjs, through epsilon-search.mjs): what a query looks for (findWhat), a
// formula's TeX read the same however it is written (texNorm, plainly), whether a formula has a query (texHas), the
// glyphs a query draws (glyphsOf), in the drawing's codes (hex Unicode, as MathJax's data-c), and a word as a formula
// writes it (wordsIn, wordSeqs). L2M_searchRules(macros) gives them for a paper whose own macros are macros ({name:
// its TeX}; a PDF has none). A plain script: loaded as one by the app, imported by the viewer (globalThis either way).
globalThis.L2M_searchRules = function (MACROS) {
  MACROS = MACROS || {};
  var expanded = {};
  var GLYPH = {alpha: "1D6FC", beta: "1D6FD", gamma: "1D6FE", delta: "1D6FF", epsilon: "1D716", varepsilon: "1D700", zeta: "1D701",
    eta: "1D702", theta: "1D703", vartheta: "1D717", iota: "1D704", kappa: "1D705", varkappa: "1D718", lambda: "1D706", mu: "1D707",
    nu: "1D708", xi: "1D709", pi: "1D70B", varpi: "1D71B", rho: "1D70C", varrho: "1D71A", sigma: "1D70E", varsigma: "1D70D",
    tau: "1D70F", upsilon: "1D710", phi: "1D719", varphi: "1D711", chi: "1D712", psi: "1D713", omega: "1D714", Gamma: "393",
    Delta: "394", Theta: "398", Lambda: "39B", Xi: "39E", Pi: "3A0", Sigma: "3A3", Upsilon: "3A5", Phi: "3A6", Psi: "3A8",
    Omega: "3A9", varGamma: "1D6E4", varDelta: "1D6E5", varTheta: "1D6E9", varLambda: "1D6EC", varXi: "1D6EF", varPi: "1D6F1",
    varSigma: "1D6F4", varUpsilon: "1D6F6", varPhi: "1D6F7", varPsi: "1D6F9", varOmega: "1D6FA", ell: "2113", hbar: "210F",
    hslash: "210F", partial: "1D715", nabla: "2207", infty: "221E", aleph: "2135", wp: "2118", emptyset: "2205", varnothing: "2205"};
  var GREEK = {"α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ϵ": "epsilon", "ε": "varepsilon", "ζ": "zeta", "η": "eta",
    "θ": "theta", "ϑ": "vartheta", "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi", "ρ": "rho",
    "σ": "sigma", "ς": "varsigma", "τ": "tau", "υ": "upsilon", "ϕ": "phi", "φ": "varphi", "χ": "chi", "ψ": "psi", "ω": "omega",
    "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Ξ": "Xi", "Π": "Pi", "Σ": "Sigma", "Υ": "Upsilon", "Φ": "Phi",
    "Ψ": "Psi", "Ω": "Omega", "ℓ": "ell", "ℏ": "hbar", "∂": "partial", "∇": "nabla", "∞": "infty"};

  // one symbol spelled in several ways (\varepsilon and \epsilon, \le and \leq and <=, ...): all one, both in what is
  // asked and in the formulas' TeX (SAME: each spelling's one), and as drawn (alts: the drawings of each)
  var SAME = {varepsilon: "epsilon", varphi: "phi", vartheta: "theta", varrho: "rho", varsigma: "sigma", varpi: "pi",
    varkappa: "kappa", varGamma: "Gamma", varDelta: "Delta", varTheta: "Theta", varLambda: "Lambda", varXi: "Xi", varPi: "Pi",
    varSigma: "Sigma", varUpsilon: "Upsilon", varPhi: "Phi", varPsi: "Psi", varOmega: "Omega", hslash: "hbar",
    varnothing: "emptyset", le: "leq", leqslant: "leq", ge: "geq", geqslant: "geq", ne: "neq", to: "rightarrow",
    gets: "leftarrow", dfrac: "frac", tfrac: "frac", cfrac: "frac",
    text: "mathrm", textrm: "mathrm", textup: "mathrm", textnormal: "mathrm", mbox: "mathrm"};   // (upright text, as \mathrm)
  function alts(name) {
    var one = SAME[name] || name, out = [];
    [one].concat(Object.keys(SAME).filter(function (k) { return SAME[k] === one; })).forEach(function (n) {
      var c = GLYPH[n] || OPS[n];
      if (c && out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }
  // a query typed with the symbols themselves (a phone's keys): α, ≤, x², ... read as their TeX
  var UNI = {"≤": "leq", "≥": "geq", "≠": "neq", "≈": "approx", "∼": "sim", "≡": "equiv", "∝": "propto", "∫": "int",
    "∮": "oint", "∑": "sum", "∏": "prod", "√": "sqrt", "→": "rightarrow", "←": "leftarrow", "⊗": "otimes", "⊕": "oplus",
    "∈": "in", "⊂": "subset", "±": "pm", "∓": "mp", "×": "times", "·": "cdot", "⋅": "cdot", "⟨": "langle", "⟩": "rangle",
    "†": "dagger", "…": "ldots", "⋯": "cdots", "∧": "wedge", "∨": "vee", "∩": "cap", "∪": "cup", "∘": "circ", "∗": "ast"};
  var SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ", SUPT = "0123456789+-=()ni", SUBS = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎", SUBT = "0123456789+-=()";
  function uniTeX(q) {
    if (!/[^\x00-\x7f]/.test(q)) return q;
    q = q.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+/g, function (r) { return "^{" + r.split("").map(function (c) { return SUPT.charAt(SUPS.indexOf(c)); }).join("") + "}"; })
      .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+/g, function (r) { return "_{" + r.split("").map(function (c) { return SUBT.charAt(SUBS.indexOf(c)); }).join("") + "}"; });
    return q.replace(/[^\x00-\x7f]/g, function (c) {
      var n = UNI[c] || GREEK[c];
      return n ? "\\" + n + " " : c === "′" ? "'" : c === "−" ? "-" : c;
    });
  }
  // what a query looks for: {text} (words), {tex} (TeX in formulas), {glyph} (a symbol, as drawn: its drawings)
  // operators drawn as upright words (\log, \sin, ...): their letters, as drawn
  var OPNAME = /^(log|ln|lg|exp|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|coth|arcsin|arccos|arctan|det|dim|ker|deg|hom|lim|liminf|limsup|max|min|sup|inf|arg|gcd|Pr|Tr|tr)$/;
  function findWhat(q) {
    q = q.trim();
    if (!q) return null;
    var dm = /^\\\[([\s\S]*)\\\]$/.exec(q);
    if (dm && dm[1].indexOf("\\]") < 0) q = "$" + dm[1] + "$";      // (a displayed formula, as copied: the same)
    var parts = [], last = 0, fm, FORM = /\$([^$]+)\$|\\\[([\s\S]+?)\\\]/g;
    while ((fm = FORM.exec(q))) {                  // words and formulas, as copied: "the trace $\mathrm{Tr}\,\rho$ is"
      if (q.slice(last, fm.index).trim()) parts.push({t: q.slice(last, fm.index)});
      parts.push({f: fm[1] != null ? fm[1] : fm[2]});
      last = FORM.lastIndex;
    }
    if (q.slice(last).trim()) parts.push({t: q.slice(last)});
    if (parts.length > 1 && parts.some(function (x) { return x.f != null; })) return {mixed: parts};
    if (q.charAt(0) === "$") {                       // "$...": the formulas only (the rest read as TeX)
      q = q.slice(1).replace(/\$$/, "").trim();
      if (!q) return null;
      q = uniTeX(q).trim();
      if (GLYPH[q]) q = "\\" + q;
      var c1 = /^\\([A-Za-z]+)$/.exec(q);
      return c1 && GLYPH[c1[1]] ? {glyph: alts(c1[1]), tex: q} : {tex: q};
    }
    if (GREEK[q]) return {glyph: alts(GREEK[q]), tex: "\\" + GREEK[q]};
    q = uniTeX(q).trim();
    var cmd = /^\\([A-Za-z]+)$/.exec(q);
    if (cmd && GLYPH[cmd[1]]) return {glyph: alts(cmd[1]), tex: q};
    if (/[\\^_{}]/.test(q)) return {tex: q};
    var w = {text: q.replace(/[^A-Za-z]/g, "").length >= 3 || /[^A-Za-z\s]/.test(q) && q.length >= 2 ? q.toLowerCase() : null};
    if (GLYPH[q]) { w.glyph = alts(q); w.tex = "\\" + q; }         // "phi": the word, and the symbol
    else if (/^[A-Za-z]{3,}$/.test(q) && (OPS[q] || OPNAME.test(q))) w.tex = "\\" + q;   // "sum", "log": the word, and the command
    if (!w.text && !w.tex && !w.glyph) return null;              // (too short to look for yet)
    else if (/[^A-Za-z\s]/.test(q)) w.tex = q.replace(/\s+/g, ""); // "O(N)", "a+b": in the text, and in the formulas
    if (/^[A-Za-z]{3,}$/.test(q)) w.word = q.toLowerCase();   // "leading": in the text, and as written in formulas
    var cm = /^\[\s*([0-9A-Za-z]+)\s*\]$/.exec(q);
    if (cm) w.cite = cm[1];                 // "[66]": that reference cited anywhere, [34, 66, 78] too (and its entry)
    return w;
  }
  // a letter asked for plainly is found in any font, with any accent or prime (B in \mathcal{B} > 1, \bar{B} > 1 or
  // B' > 1, for B>1); asked for in a font, with an accent or a prime, only so
  var FONTS = "mathcal|mathbb|mathfrak|mathscr|boldsymbol|bm|mathbf|mathsf|mathtt|mathit|mathrm";
  var ACCS = "hat|bar|tilde|vec|dot|ddot|check|breve|acute|grave|widehat|widetilde|overline|underline|mathring";
  var INSIDE = "((?:[^{}]|\\{[^{}]*\\})*)";      // (what a font or an accent holds: a group within too, \bar{\mathbf{a}})
  var FONTED = new RegExp("\\\\(" + FONTS + ")\\{" + INSIDE + "\\}", "g"), ACCENTED = new RegExp("\\\\(" + ACCS + ")\\{" + INSIDE + "\\}", "g");
  var HAS_FONT = new RegExp("\\\\(" + FONTS + ")(?![A-Za-z])"), HAS_ACC = new RegExp("\\\\(" + ACCS + ")(?![A-Za-z])");   // (\mathrm alone too)
  var PRIMED = /'+|\^\\prime(?![A-Za-z])|\\prime(?![A-Za-z])/g;
  var plainMemo = [];                  // (by how the query reads: with or without fonts, accents, primes)
  function plainly(t, q) {             // the formula's TeX as a plain query reads it
    var font = HAS_FONT.test(q), acc = HAS_ACC.test(q), prime = /'|\\prime/.test(q);
    var memo = plainMemo[(font ? 1 : 0) | (acc ? 2 : 0) | (prime ? 4 : 0)] || (plainMemo[(font ? 1 : 0) | (acc ? 2 : 0) | (prime ? 4 : 0)] = new Map());
    var was = memo.get(t);
    if (was !== undefined) return was;
    var t0 = t;
    if (!font) t = t.replace(FONTED, "$2");
    if (!acc) for (var k = 0; k < 3; k++) t = t.replace(ACCENTED, "$2");
    if (!prime) t = t.replace(PRIMED, "");
    t = t.replace(/([_^])\{([^{}\\]|\\[A-Za-z]+)\}/g, "$1$2");     // (^{\sf F}, the font gone: ^F, as texNorm has it)
    memo.set(t0, t);
    return t;
  }
  // ? in a query: any one symbol, or (as {?}) anything in braces: Z_? is any Z with something under it
  var GROUP = "\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\}", TOKEN = "(?:\\\\[A-Za-z]+|" + GROUP + "|[^{}\\\\])";
  function texHas(tex, q) {
    q = texNorm(q);
    var t = plainly(texNorm(tex), q), i;
    if (q.indexOf("?") >= 0) {
      return new RegExp(q.split("{?}").map(function (part) { return part.split("?").map(reEsc).join(TOKEN); }).join(GROUP)).test(t);
    }
    i = t.indexOf(q);
    while (i >= 0) {
      // \phi is not the start of \phiup: after a command name the next character is no letter
      if (!(/\\[A-Za-z]+$/.test(q) && /[A-Za-z]/.test(t.charAt(i + q.length)))) return true;
      i = t.indexOf(q, i + 1);
    }
    return false;
  }
  // the glyphs a piece of TeX draws, in the order a formula's drawing has them (a letter: italic or upright; a
  // command: its symbol; braces, _ and ^ draw nothing); null when it has something this cannot tell
  var OPS = {cdot: "22C5", times: "D7", pm: "B1", mp: "2213", sum: "2211", int: "222B", prod: "220F", oint: "222E", sqrt: "221A",
    langle: "27E8", rangle: "27E9", dagger: "2020", ldots: "2026", cdots: "22EF", to: "2192", rightarrow: "2192", leftarrow: "2190",
    leq: "2264", le: "2264", geq: "2265", ge: "2265", neq: "2260", ne: "2260", approx: "2248", sim: "223C", equiv: "2261",
    propto: "221D", otimes: "2297", oplus: "2295", wedge: "2227", vee: "2228", cap: "2229", cup: "222A", in: "2208",
    subset: "2282", mid: "2223", prime: "2032", star: "22C6", ast: "2217", circ: "2218", bullet: "2219"};
  var QUIET = /^(frac|dfrac|tfrac|mathrm|mathit|mathbf|mathsf|text|textrm|operatorname|left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|,|;|!|quad|qquad|displaystyle|textstyle|scriptstyle)$/;
  var SYM = {"+": "2B", "-": "2212", "=": "3D", "(": "28", ")": "29", "[": "5B", "]": "5D", ",": "2C", ";": "3B", ":": "3A", "!": "21",
    "/": "2F", "<": "3C", ">": "3E", "|": "7C", "'": "2032", "*": "2217", ".": "2E"};
  function hex(c) { return c.toString(16).toUpperCase(); }
  var FONTCMD = /^(mathcal|mathbb|mathfrak|mathscr|boldsymbol|bm|mathbf|mathsf|mathtt|mathit|mathrm|operatorname)$/;
  // a letter or digit in \mathcal{...} and the like, as drawn: the codes it may have (the drawing's own: \mathcal's
  // letters are the plain ones in its calligraphic font, \mathbb's and \mathbf's are Unicode's double-struck and bold)
  var ODD = {mathbb: {C: "2102", H: "210D", N: "2115", P: "2119", Q: "211A", R: "211D", Z: "2124"},
    mathfrak: {C: "212D", H: "210C", I: "2111", R: "211C", Z: "2128"},
    mathscr: {B: "212C", E: "2130", F: "2131", H: "210B", I: "2110", L: "2112", M: "2133", R: "211B", e: "212F", g: "210A", o: "2134"}};
  var FROM = {mathbb: [0x1D538, 0x1D552, 0x1D7D8], mathfrak: [0x1D504, 0x1D51E], mathscr: [0x1D49C, 0x1D4B6],
    mathbf: [0x1D400, 0x1D41A, 0x1D7CE], boldsymbol: [0x1D468, 0x1D482, 0x1D7CE], bm: [0x1D468, 0x1D482, 0x1D7CE],
    mathsf: [0x1D5A0, 0x1D5BA, 0x1D7E2], mathtt: [0x1D670, 0x1D68A, 0x1D7F6]};
  function fontGlyph(font, c) {
    var k = c.charCodeAt(0), plain = hex(k), at = c <= "9" ? 2 : c < "a" ? 0 : 1, base = FROM[font] && FROM[font][at];
    var codes = [plain];
    if (ODD[font] && ODD[font][c]) codes.push(ODD[font][c]);
    else if (base) codes.push(hex(base + k - (at === 2 ? 48 : at === 0 ? 65 : 97)));
    if (font === "boldsymbol" || font === "bm") codes.push(hex(FROM.mathbf[at] + k - (at === 2 ? 48 : at === 0 ? 65 : 97)));
    if (font === "mathit" && at < 2) codes.push(c === "h" ? "210E" : hex((at ? 0x1D44E : 0x1D434) + k - (at ? 97 : 65)));   // (an italic h: Planck's)
    return codes;
  }
  function glyphsOf(q) {
    var out = [], i = 0, m, fontTo = -1, font = "";   // letters in \mathcal{...} and the like: drawn in their own fonts
    while (i < q.length) {
      var c = q.charAt(i);
      if ((m = /^\\([A-Za-z]+|.)/.exec(q.slice(i)))) {
        var name = m[1]; i += m[0].length;
        if (FONTCMD.test(name)) {
          font = name === "operatorname" ? "mathrm" : name;
          if (q.charAt(i) === "{") {
            for (var d = 0, e = i; e < q.length; e++) { if (q.charAt(e) === "{") d++; else if (q.charAt(e) === "}" && !--d) break; }
            fontTo = e;
          } else fontTo = i + 1;
          continue;
        }
        if (name === "sqrt") {                       // a root is drawn with what is under it first, then the sign (then its index)
          var idx = "", body;
          if (q.charAt(i) === "[") { var cl = q.indexOf("]", i); if (cl < 0) return null; idx = q.slice(i + 1, cl); i = cl + 1; }
          if (q.charAt(i) === "{") {
            for (var d2 = 0, e2 = i; e2 < q.length; e2++) { if (q.charAt(e2) === "{") d2++; else if (q.charAt(e2) === "}" && !--d2) break; }
            body = q.slice(i + 1, e2); i = e2 + 1;
          } else if ((m = /^(\\[A-Za-z]+|.)/.exec(q.slice(i)))) { body = m[1]; i += m[0].length; }
          var bg = body ? glyphsOf(body) : [], ig = idx ? glyphsOf(idx) : [];
          if (!bg || !ig) return null;
          out.push.apply(out, bg); out.push(alts("sqrt")); out.push.apply(out, ig);
          continue;
        }
        if (GLYPH[name]) out.push(alts(name));
        else if (OPNAME.test(name)) { for (var o = 0; o < name.length; o++) out.push([hex(name.charCodeAt(o))]); }
        else if (OPS[name]) out.push(alts(name));
        else if (name === "{" || name === "}") out.push([hex(name.charCodeAt(0))]);
        else if (name === "|") out.push(["2016", "2225"]);
        else if (!QUIET.test(name)) return null;
        continue;
      }
      i++;
      if (c === "?") { out.push(["*"]); continue; }
      if (i - 1 < fontTo && /[A-Za-z0-9]/.test(c)) { out.push(fontGlyph(font, c)); continue; }
      if (/[A-Za-z]/.test(c)) {
        var k = c.charCodeAt(0), it = c === "h" ? "210E" : hex((c < "a" ? 0x1D434 + k - 65 : 0x1D44E + k - 97));
        out.push([it, hex(k)].concat(Object.keys(FROM).map(function (f) { return fontGlyph(f, c)[1]; })));   // (and in any font)
      } else if (/[0-9]/.test(c)) out.push([hex(c.charCodeAt(0))]);
      else if (SYM[c]) out.push([SYM[c]].concat(c === "-" ? ["2D"] : c === "|" ? ["2223"] : []));
      else if (/[\s_^{}&~]/.test(c)) continue;
      else return null;
    }
    return out.length ? out : null;
  }

  function expand(t) {
    for (var pass = 0; pass < 3; pass++) {
      var t2 = t.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, function (x, n) { return typeof MACROS[n] === "string" ? MACROS[n] + " " : x; });
      if (t2 === t) break;
      t = t2;
    }
    return t;
  }
  // the physics and braket packages' commands as what they draw, in queries and formulas alike: \ket{\psi} finds
  // |\psi\rangle, and |\psi\rangle finds \ket{\psi} (a paper's own definition of one of them wins: written out first)
  var PHYS = {ket: [1, 1], bra: [1, 1], braket: [1, 2], ketbra: [2, 2], expval: [1, 2], mel: [3, 3], abs: [1, 1], norm: [1, 1],
    dv: [1, 2], pdv: [1, 2], order: [1, 1], comm: [2, 2]};
  var PHYS_RE = /\\(ketbra|ket|braket|bra|expval|mel|abs|norm|dv|pdv|order|comm)(?![A-Za-z])\*?/g;
  function physics(t) {
    if (t.search(PHYS_RE) < 0) return t;
    var out = "", i = 0, m;
    while ((PHYS_RE.lastIndex = i, m = PHYS_RE.exec(t))) {
      var name = m[1], at = PHYS_RE.lastIndex, args = [], want = PHYS[name];
      if (typeof MACROS[name] === "string") { out += t.slice(i, at); i = at; continue; }
      while (args.length < want[1]) {
        var j = at;
        while (t.charAt(j) === " ") j++;
        if (t.charAt(j) === "{") {
          for (var d = 0, e = j; e < t.length; e++) { if (t.charAt(e) === "{") d++; else if (t.charAt(e) === "}" && !--d) break; }
          if (e >= t.length) break;
          args.push(physics(t.slice(j + 1, e))); at = e + 1;
        } else if (args.length < want[0] && t.charAt(j)) {
          var tk = /^\\([A-Za-z]+|.)|^./.exec(t.slice(j));
          args.push(tk[0]); at = j + tk[0].length;
        } else break;
      }
      if (args.length < want[0]) { out += t.slice(i, at); i = at; continue; }
      var a = args[0], b = args[1], c = args[2], drawn =
        name === "ket" ? "|" + a + "\\rangle" : name === "bra" ? "\\langle " + a + "|" :
        name === "braket" ? "\\langle " + a + "|" + (b != null ? b : a) + "\\rangle" :
        name === "ketbra" ? "|" + a + "\\rangle\\langle " + b + "|" :
        name === "expval" ? (b != null ? "\\langle " + b + "|" + a + "|" + b + "\\rangle" : "\\langle " + a + "\\rangle") :
        name === "mel" ? "\\langle " + a + "|" + b + "|" + c + "\\rangle" : name === "abs" ? "|" + a + "|" :
        name === "norm" ? "\\|" + a + "\\|" : name === "order" ? "\\mathcal{O}(" + a + ")" : name === "comm" ? "[" + a + "," + b + "]" :
        (b != null ? "\\frac{" + (name === "dv" ? "d" : "\\partial ") + a + "}{" + (name === "dv" ? "d" : "\\partial ") + b + "}"
                   : "\\frac{" + (name === "dv" ? "d" : "\\partial ") + "}{" + (name === "dv" ? "d" : "\\partial ") + a + "}");
      out += t.slice(i, m.index) + drawn + " ";
      i = at;
    }
    return out + t.slice(i);
  }
  var SIZES = /\\(left|right|middle|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|biggl|biggr|Biggl|Biggr|bigm|Bigm)(?![A-Za-z])\s*\.?/g;
  var NAMED_FA = new RegExp("\\\\(" + FONTS + "|" + ACCS + ")\\s*([A-Za-z0-9]|\\\\[A-Za-z]+)(?![A-Za-z])", "g");
  function fracBraces(t) {             // \frac12, \frac a{b}: \frac{1}{2}, \frac{a}{b}
    var out = "", i = 0, m, re = /\\frac(?![A-Za-z])/g;
    while ((re.lastIndex = i, m = re.exec(t))) {
      var at = m.index + 5;
      out += t.slice(i, at);
      for (var a = 0; a < 2; a++) {
        while (t.charAt(at) === " ") at++;
        var c = t.charAt(at), end = at;
        if (c === "{") { for (var d = 0, e = at; e < t.length; e++) { if (t.charAt(e) === "{") d++; else if (t.charAt(e) === "}" && !--d) break; } end = e + 1; out += t.slice(at, end); }
        else if (c === "\\") { var cm = /^\\([A-Za-z]+|.)/.exec(t.slice(at)); end = at + (cm ? cm[0].length : 1); out += "{" + t.slice(at, end) + "}"; }
        else if (c) { end = at + 1; out += "{" + c + "}"; }
        at = end;
      }
      i = at;
    }
    return out + t.slice(i);
  }
  var normed = {}, normedN = 0;
  // the old font switches, {\sf F}, {\rm d}, and \textsf{F} and the like: as \mathsf{F}, \mathrm{d}
  var OLDF = {rm: "mathrm", bf: "mathbf", it: "mathit", sf: "mathsf", tt: "mathtt", cal: "mathcal",
    textrm: "mathrm", textbf: "mathbf", textit: "mathit", textsf: "mathsf", texttt: "mathtt"};
  var OLDFONT = /\{\s*\\(rm|bf|it|sf|tt|cal)(?![A-Za-z])\s*([^{}]*)\}|\\(?:(textrm|textbf|textit|textsf|texttt))\{([^{}]*)\}/g;
  function texNorm(t) {
    t = t || "";
    if (normed.hasOwnProperty(t)) return normed[t];
    var was = t;
    t = uniTeX(physics(expand(t))).replace(/<=/g, "\\leq ").replace(/>=/g, "\\geq ").replace(/!=/g, "\\neq ").replace(SIZES, "");
    t = t.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, function (x, n) { return n === "lt" ? "<" : n === "gt" ? ">" : SAME[n] ? "\\" + SAME[n] : x; });
    t = fracBraces(t.replace(NAMED_FA, "\\$1{$2}"));
    t = t.replace(OLDFONT, function (x, f, a, g, b, at, all) {   // (a script's own braces kept: S_{\rm gen} is S_{\mathrm{gen}})
      var y = "\\" + OLDF[f || g] + "{" + (f ? a : b).trim() + "}";
      return f && /[_^]\s*$/.test(all.slice(Math.max(0, at - 3), at)) ? "{" + y + "}" : y;
    });
    t = t.replace(/([_^])\s*(\\[A-Za-z]+\s*\{[^{}]*\})/g, "$1{$2}");   // (S_\text{gen} as S_{\text{gen}})
    t = t.replace(/(\\[A-Za-z]+)\s+(?=[A-Za-z])/g, "$1\u0001").replace(/\s+/g, "").replace(/\u0001/g, " ");
    t = t.replace(/([_^])\{([^{}\\]|\\[A-Za-z]+)\}/g, "$1$2");
    t = t.replace(/\\sqrt(?![A-Za-z])(\[[^\]]*\])?(\\[A-Za-z]+|[^{\\\s])/g, "\\sqrt$1{$2}");   // (\sqrt2, √2: \sqrt{2})
    if (++normedN > 20000) { normed = {}; normedN = 0; }
    return (normed[was] = t);
  }
  // a word written in a formula (V_{\mathbf{leading}}, \text{if }x>0, \operatorname{Res}): the letters of its text and
  // font groups, each with the font it is drawn in; letters in a row outside them are variables, never a word
  var WORDED = /\\(text|textup|textnormal|mbox|hbox|mathrm|mathbf|mathsf|mathtt|mathit|operatorname\*?|boldsymbol|bm)\{/g;
  var SCRIPTED = /[_^]\{([A-Za-z]{3,})\}/g;
  function wordsIn(t) {
    var out = [], m;
    WORDED.lastIndex = 0;
    while ((m = WORDED.exec(t))) {
      var font = /^(mathbf|mathsf|mathtt|mathit|boldsymbol|bm)$/.test(m[1]) ? m[1] : "mathrm", letters = [];
      (function read(i, font) {             // the group from i (just past its "{"): its letters, nested fonts within
        for (var d = 1; i < t.length; i++) {
          var c = t.charAt(i), sub = /^\\([A-Za-z]+)\{/.exec(t.slice(i, i + 20));
          if (sub && /^(mathbf|mathsf|mathtt|mathit|mathrm|boldsymbol|bm|text|textup)$/.test(sub[1])) {
            i = read(i + sub[0].length, /^(text|textup)$/.test(sub[1]) ? font : sub[1]);
            continue;
          }
          if (c === "\\") { var cm = /^\\([A-Za-z]+|.)/.exec(t.slice(i)); i += cm[0].length - 1; letters.push(null); continue; }
          if (c === "{") d++;
          else if (c === "}") { if (!--d) return i; }
          else letters.push(/[A-Za-z]/.test(c) ? {c: c, font: font} : null);
        }
        return i;
      })(m.index + m[0].length, font);
      out.push(letters);
      WORDED.lastIndex = m.index + m[0].length;
    }
    // a script that is a word, V(s,u)_{leading}: its braces holding letters only, three or more, in the italic it is
    // drawn in (_{ij}, _{a+b}, _{\mu\nu} are no words)
    SCRIPTED.lastIndex = 0;
    while ((m = SCRIPTED.exec(t))) {
      out.push(m[1].split("").map(function (c) { return {c: c, font: "mathit"}; }));
    }
    return out;
  }
  function wordSeqs(t, word) {              // for each place the word is written in t: the glyphs that draw it
    var seqs = [];
    wordsIn(t).forEach(function (ls) {
      var s = ls.map(function (l) { return l ? l.c.toLowerCase() : "\u0000"; }).join(""), i = s.indexOf(word);
      while (i >= 0) {
        seqs.push(ls.slice(i, i + word.length).map(function (l) { return fontGlyph(l.font, l.c); }));
        i = s.indexOf(word, i + word.length);
      }
    });
    return seqs;
  }

  function reEsc(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  return {GLYPH: GLYPH, GREEK: GREEK, SAME: SAME, OPS: OPS, SYM: SYM, OPNAME: OPNAME, HAS_FONT: HAS_FONT, HAS_ACC:
    HAS_ACC, WORDED: WORDED, SCRIPTED: SCRIPTED, alts: alts, uniTeX: uniTeX, findWhat: findWhat, plainly: plainly,
    texHas: texHas, glyphsOf: glyphsOf, fontGlyph: fontGlyph, texNorm: texNorm, wordsIn: wordsIn, wordSeqs: wordSeqs,
    reEsc: reEsc, hex: hex};
};
