// Epsilon's rules for search in a paper, shared by the app (nav.js, "search in the paper") and the PDF viewer for
// Chrome (epsilon_pdf_reader: pdf-search.mjs, through epsilon-search.mjs): what a query looks for (findWhat), a
// formula's TeX read the same however it is written (texNorm, plainly), whether a formula has a query (texHas), the
// glyphs a query draws (glyphsOf), in the drawing's codes (hex Unicode, as MathJax's data-c), and a word as a formula
// writes it (wordsIn, wordSeqs). L2M_searchRules(macros, packages) gives them for a paper whose own macros are macros
// ({name: its TeX}; a PDF has none) and whose MathJax packages are packages (["physics", ...]; a PDF: the ones always
// on). A plain script: loaded as one by the app, imported by the viewer (globalThis either way).
globalThis.L2M_searchRules = function (MACROS, PACKAGES) {
  MACROS = MACROS || {};
  // the tables below hold no built-in names: a query "constructor" or "\\toString" is no symbol, and "hasOwnProperty"
  // or "__proto__" kept as a query's reading can't break the next search
  function own(o) { var m = Object.create(null); Object.keys(o).forEach(function (k) { m[k] = o[k]; }); return m; }
  function macro(n) { return Object.prototype.hasOwnProperty.call(MACROS, n) && typeof MACROS[n] === "string" ? MACROS[n] : null; }
  // The commands MathJax draws as letters of their own (\lim: lim, \varprojlim: lim with an arrow, \bmod: mod), as
  // MathJax has them: every other command is one symbol, its name no letters of the formula (ac is not in \frac). For
  // the packages always on, and what each other package adds or changes (physics: \Re is Re, \Tr is Tr); a name with
  // # takes arguments (\pmod{x}: mod), its letters its own.
  // ---- drawn names: written by tools/drawn-names.js from MathJax 3.2.2; not to be edited by hand
  var DRAWN_ALWAYS = {"LaTeX":"LATEX","Pr":"Pr","TeX":"TEX","arccos":"arccos","arcsin":"arcsin","arctan":"arctan","arg":"arg","bmod":"mod","cos":"cos","cosh":"cosh","cot":"cot","coth":"coth","csc":"csc","deg":"deg","det":"det","dim":"dim","exp":"exp","gcd":"gcd","hom":"hom","inf":"inf","injlim":"injlim","ker":"ker","lg":"lg","lim":"lim","liminf":"liminf","limsup":"limsup","ln":"ln","log":"log","max":"max","min":"min","mod#":"mod","pmod#":"mod","projlim":"projlim","sec":"sec","sin":"sin","sinh":"sinh","sup":"sup","tan":"tan","tanh":"tanh","varinjlim":"lim","varliminf":"lim","varlimsup":"lim","varprojlim":"lim"};
  var DRAWN_PACKAGES = {"physics":{"Im":"Im","PV":"PV","Probability":"Pr","Re":"Re","Res":"Res","Residue":"Res","Tr":"Tr","Trace":"Tr","acos":"acos","acosecant":"acsc","acosine":"acos","acot":"acot","acotangent":"acot","acsc":"acsc","arccosecant":"arccsc","arccosine":"arccos","arccot":"arccot","arccotangent":"arccot","arccsc":"arccsc","arcsec":"arcsec","arcsecant":"arcsec","arcsine":"arcsin","arctangent":"arctan","asec":"asec","asecant":"asec","asin":"asin","asine":"asin","atan":"atan","atangent":"atan","cosecant":"csc","cosine":"cos","cotangent":"cot","csch":"csch","dd":"d","derivative#":"dd","determinant":"det","diffd":"d","differential":"d","dv#":"dd","erf":"erf","exponential":"exp","hypcosecant":"csch","hypcosine":"cosh","hypcotangent":"coth","hypsecant":"sech","hypsine":"sinh","hyptangent":"tanh","logarithm":"log","naturallogarithm":"ln","order#":"O","principalvalue":"P","pv":"P","qall":"all","qand":"and","qas":"as","qassume":"assume","qcc":"cc","qelse":"else","qeven":"even","qfor":"for","qgiven":"given","qif":"if","qin":"in","qinteger":"integer","qlet":"let","qodd":"odd","qor":"or","qotherwise":"otherwise","qsince":"since","qthen":"then","qunless":"unless","qusing":"using","rank":"rank","secant":"sec","sech":"sech","sine":"sin","tangent":"tan","tr":"tr","trace":"tr"}};
  // ---- end of drawn names
  var DRAWN = own(DRAWN_ALWAYS), ROMAN_RE = !PACKAGES || PACKAGES.indexOf("physics") >= 0;
  (PACKAGES || []).forEach(function (p) {
    var o = Object.prototype.hasOwnProperty.call(DRAWN_PACKAGES, p) ? DRAWN_PACKAGES[p] : null;
    if (o) Object.keys(o).forEach(function (k) { if (o[k]) DRAWN[k] = o[k]; else delete DRAWN[k]; });
  });
  var GLYPH = own({alpha: "1D6FC", beta: "1D6FD", gamma: "1D6FE", delta: "1D6FF", epsilon: "1D716", varepsilon: "1D700", zeta: "1D701",
    eta: "1D702", theta: "1D703", vartheta: "1D717", iota: "1D704", kappa: "1D705", varkappa: "1D718", lambda: "1D706", mu: "1D707",
    nu: "1D708", xi: "1D709", pi: "1D70B", varpi: "1D71B", rho: "1D70C", varrho: "1D71A", sigma: "1D70E", varsigma: "1D70D",
    tau: "1D70F", upsilon: "1D710", phi: "1D719", varphi: "1D711", chi: "1D712", psi: "1D713", omega: "1D714", Gamma: "393",
    Delta: "394", Theta: "398", Lambda: "39B", Xi: "39E", Pi: "3A0", Sigma: "3A3", Upsilon: "3A5", Phi: "3A6", Psi: "3A8",
    Omega: "3A9", varGamma: "1D6E4", varDelta: "1D6E5", varTheta: "1D6E9", varLambda: "1D6EC", varXi: "1D6EF", varPi: "1D6F1",
    varSigma: "1D6F4", varUpsilon: "1D6F6", varPhi: "1D6F7", varPsi: "1D6F9", varOmega: "1D6FA", ell: "2113", hbar: "210F",
    hslash: "210F", partial: "1D715", nabla: "2207", infty: "221E", aleph: "2135", wp: "2118", emptyset: "2205", varnothing: "2205"});
  var GREEK = own({"α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ϵ": "epsilon", "ε": "varepsilon", "ζ": "zeta", "η": "eta",
    "θ": "theta", "ϑ": "vartheta", "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi", "ρ": "rho",
    "σ": "sigma", "ς": "varsigma", "τ": "tau", "υ": "upsilon", "ϕ": "phi", "φ": "varphi", "χ": "chi", "ψ": "psi", "ω": "omega",
    "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Ξ": "Xi", "Π": "Pi", "Σ": "Sigma", "Υ": "Upsilon", "Φ": "Phi",
    "Ψ": "Psi", "Ω": "Omega", "ℓ": "ell", "ℏ": "hbar", "∂": "partial", "∇": "nabla", "∞": "infty", "ϖ": "varpi", "ϱ": "varrho",
    "ϰ": "varkappa"});

  // one symbol spelled in several ways (\varepsilon and \epsilon, \le and \leq and <=, ...): all one, both in what is
  // asked and in the formulas' TeX (SAME: each spelling's one), and as drawn (alts: the drawings of each)
  var SAME = own({varepsilon: "epsilon", varphi: "phi", vartheta: "theta", varrho: "rho", varsigma: "sigma", varpi: "pi",
    varkappa: "kappa", varGamma: "Gamma", varDelta: "Delta", varTheta: "Theta", varLambda: "Lambda", varXi: "Xi", varPi: "Pi",
    varSigma: "Sigma", varUpsilon: "Upsilon", varPhi: "Phi", varPsi: "Psi", varOmega: "Omega", hslash: "hbar",
    // (an arrow, a relation, an operator: one only with what MathJax draws the same, \le and \leq, \implies and
    // \Longrightarrow; a long arrow and its short form, a slanted ≤, a big ∪ are other signs, found apart: Erez, Oct 2026)
    varnothing: "emptyset", le: "leq", ge: "geq", ne: "neq", to: "rightarrow",
    leqslant: "leq", geqslant: "geq",   // (but ≤ and ⩽ one: a paper's font draws all its \le one way, Erez, Oct 25)
    gets: "leftarrow", dfrac: "frac", tfrac: "frac", cfrac: "frac", implies: "Rightarrow", iff: "Leftrightarrow",
    // (an arrow one with its long form: a publisher's font draws arrows its own length, \to at 1.6 em; Erez, Oct 25)
    longrightarrow: "rightarrow", Longrightarrow: "Rightarrow", longleftarrow: "leftarrow", Longleftarrow: "Leftarrow",
    longleftrightarrow: "leftrightarrow", Longleftrightarrow: "Leftrightarrow", longmapsto: "mapsto",
  stackrel: "overset", Box: "square", operatorname: "mathrm", dots: "ldots", dotsc: "ldots", dotso: "ldots", dotsb: "ldots",
  dotsm: "ldots", dotsi: "ldots", cdots: "ldots", smallint: "int", bm: "mathbf", boldsymbol: "mathbf", mathscr: "mathcal",
  mathds: "mathbb", mathbbm: "mathbb",   // (every row of dots one sign: readers write \ldots for all)
    backslash: "setminus", smallsetminus: "setminus", bot: "perp", dag: "dagger", ddag: "ddagger", leadsto: "rightsquigarrow",
    widetilde: "tilde", widehat: "hat", Bar: "bar", Tilde: "tilde", Hat: "hat", Vec: "vec", Dot: "dot", Ddot: "ddot",
    Check: "check", Breve: "breve", Acute: "acute", Grave: "grave", dbinom: "binom", tbinom: "binom", pmb: "mathbf",
    text: "mathrm", textrm: "mathrm", textup: "mathrm", textnormal: "mathrm", mbox: "mathrm", textsc: "mathrm", emph: "mathrm",
    textmd: "mathrm", textbf: "mathrm", textit: "mathrm", textsl: "mathrm", texttt: "mathtt", textsf: "mathsf"});   // (text as its font: upright \mathrm, bold \mathbf, as \textbf{p} a bold vector; italic \mathit)
  function alts(name) {
    var one = SAME[name] || name, out = [];
    [one].concat(Object.keys(SAME).filter(function (k) { return SAME[k] === one; })).forEach(function (n) {
      var c = GLYPH[n] || OPS[n];
      if (c && out.indexOf(c) < 0) out.push(c);
      (OPS_TOO[n] || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    });
    return out;
  }
  // a query typed with the symbols themselves (a phone's keys): α, ≤, x², ... read as their TeX
  var UNI = own({"≤": "leq", "≥": "geq", "≠": "neq", "≈": "approx", "∼": "sim", "≡": "equiv", "∝": "propto", "∫": "int",
    "∮": "oint", "∑": "sum", "∏": "prod", "√": "sqrt", "→": "rightarrow", "←": "leftarrow", "⊗": "otimes", "⊕": "oplus",
    "∈": "in", "⊂": "subset", "±": "pm", "∓": "mp", "×": "times", "·": "cdot", "⋅": "cdot", "⟨": "langle", "⟩": "rangle",
    "†": "dagger", "…": "ldots", "⋯": "cdots", "∧": "wedge", "∨": "vee", "∩": "cap", "∪": "cup", "∘": "circ", "∗": "ast",
    "◦": "circ", "∀": "forall", "∃": "exists", "¬": "neg", "≪": "ll", "≫": "gg", "≃": "simeq", "≅": "cong", "∉": "notin",
    "⊆": "subseteq", "⊃": "supset", "⊇": "supseteq", "↦": "mapsto", "⇒": "Rightarrow", "⇔": "Leftrightarrow",
    "⟹": "Longrightarrow", "⟺": "Longleftrightarrow", "⟶": "longrightarrow", "⊥": "perp", "≺": "prec", "≻": "succ",
    "≲": "lesssim", "≳": "gtrsim", "∖": "setminus", "‡": "ddagger", "⋄": "diamond", "□": "square", "∠": "angle", "⋮": "vdots",
    "⋱": "ddots", "⌊": "lfloor", "⌋": "rfloor", "⌈": "lceil", "⌉": "rceil", "⋃": "bigcup", "⋂": "bigcap", "⨁": "bigoplus",
    "⨂": "bigotimes", "ϖ": "varpi", "ϱ": "varrho", "∥": "parallel", "‖": "|", "≔": "coloneqq", "≕": "eqqcolon", "∬": "iint", "∭": "iiint", "⨌": "iiiint"});
  var SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ", SUPT = "0123456789+-=()ni", SUBS = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎", SUBT = "0123456789+-=()";
  function uniTeX(q) {
    if (!/[^\x00-\x7f]/.test(q)) return q;
    q = q.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+/g, function (r) { return "^{" + r.split("").map(function (c) { return SUPT.charAt(SUPS.indexOf(c)); }).join("") + "}"; })
      .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+/g, function (r) { return "_{" + r.split("").map(function (c) { return SUBT.charAt(SUBS.indexOf(c)); }).join("") + "}"; });
    return q.replace(/[^\x00-\x7f]/g, function (c) {
      var n = UNI[c] || GREEK[c];
      return n ? "\\" + n + " " : c === "′" ? "'" : c === "−" ? "-" : c === "∶" ? ":" : c;   // (∶, the ratio sign APS sets for ":")
    });
  }
  // what a query looks for: {text} (words), {tex} (TeX in formulas), {glyph} (a symbol, as drawn: its drawings)
  // a command drawn as its own name's letters (\log, \sin, \lim ...), as MathJax has it (and \Tr, \tr: a paper's own,
  // \mathrm{Tr}, drawn so)
  var OPNAME = {test: function (n) { return DRAWN[n] === n || n === "Tr" || n === "tr"; }};
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
    q = bareCmds(q);                                  // (sqrt{2}: \sqrt{2}, matched and its glyphs read as one)
    // A query read every way its places read (spots, readings): a formula found by any; tex the most typed reading, alts
    // the others, TeX as written last. In $...$: TeX only (Erez, Oct 25)
    if (q.charAt(0) === "$") return readWhat(q);
    var rs = readings(q);
    if (rs.length === 1) return readWhat(q);
    var ws = rs.map(readWhat), w = null;
    ws.forEach(function (x) {
      if (!x) return;
      if (!w) { w = x; return; }
      if (x.tex && x.tex !== w.tex && (w.alts || (w.alts = [])).indexOf(x.tex) < 0) w.alts.push(x.tex);
      if (x.text && !w.text) w.text = x.text;
      if (x.word && !w.word) w.word = x.word;
    });
    if (w && w.alts) w.tex2 = w.alts[w.alts.length - 1];   // (TeX as written: tex2, for a reader of one other reading)
    return w;
  }
  function readWhat(q) {
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
    // one or two letters or digits (C, ab, x2 has its text): in the formulas, as drawn, case and all (as words they
    // would be found in nearly every word)
    if (!w.text && !w.tex && !w.glyph && /^[A-Za-z0-9]{1,2}$/.test(q)) return {tex: q};
    if (!w.text && !w.tex && !w.glyph) return null;
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
  // a script of one token, its braces off (x^{2}: x^2), a command kept apart from a letter after it (^{\infty}n: ^\infty n)
  var SCRIPT1 = /([_^])\{([^{}\\]|\\[A-Za-z]+|\\[^A-Za-z])\}(?=([A-Za-z])?)/g;
  function script1(x, s, a, next) { return s + a + (next && a.charAt(0) === "\\" ? " " : ""); }
  // a font's or an accent's group, its command gone: what it held, kept apart from a command before it (\rho\mathit{U}:
  // \rho U, not \rhoU)
  // what takes the place of a piece of the TeX taken out (a font's or an accent's wrapping, a prime, a script's marks),
  // kept apart from a command's name on either side: \varphi^{i} is \varphi i, never \varphii; \phi'R is \phi R
  function apart(r, at, len, all) {
    var next = all.charAt(at + len);
    if (/\\[A-Za-z]+$/.test(all.slice(Math.max(0, at - 40), at)) && /^[A-Za-z]/.test(r || next)) r = " " + r;
    if (/\\[A-Za-z]+$/.test(r) && /[A-Za-z]/.test(next)) r += " ";
    return r;
  }
  function unwrap(x, name, inner, at, all) { return apart(inner, at, x.length, all); }
  // (a removal done one place at a time, each seen with those before it done: \bar{\alpha}\bar{b} is \alpha b)
  function each(t, re, fn) {
    var one = new RegExp(re.source, re.flags.replace("g", "")), k = 0, g;
    while (k++ < 400 && (g = t.replace(one, fn)) !== t) t = g;
    return t;
  }
  function unprime(x, at, all) { return apart("", at, x.length, all); }
  function plainly(t, q) {             // the formula's TeX as a plain query reads it
    var font = HAS_FONT.test(q), acc = HAS_ACC.test(q), prime = /'|\\prime/.test(q);
    var memo = plainMemo[(font ? 1 : 0) | (acc ? 2 : 0) | (prime ? 4 : 0)] || (plainMemo[(font ? 1 : 0) | (acc ? 2 : 0) | (prime ? 4 : 0)] = new Map());
    var was = memo.get(t);
    if (was !== undefined) return was;
    var t0 = t;
    if (!font) t = each(t, FONTED, unwrap);
    if (!acc) t = each(t, ACCENTED, unwrap);
    if (!prime) t = each(t, PRIMED, unprime);
    t = t.replace(SCRIPT1, script1);     // (^{\sf F}, the font gone: ^F, as texNorm has it)
    memo.set(t0, t);
    return t;
  }
  // ? in a query: any one symbol, or (as {?}) anything in braces: Z_? is any Z with something under it
  var GROUP = "\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\}", TOKEN = "(?:\\\\[A-Za-z]+(?![A-Za-z])|\\\\[^A-Za-z]|" + GROUP + "|[^{}\\\\])";   // (a command whole: \\alpha is one symbol, never \\al and then pha)
  // a query with no script in it (no _ or ^): a symbol found wherever it sits, on the line, under or over (q3 finds
  // q_3, q^3 and q3; x2 finds x_2 and x^2); the formula read with its scripts' marks and braces gone
  var flatMemo = new Map();
  function flat(t) {
    var was = flatMemo.get(t);
    if (was !== undefined) return was;
    var f = t, k = 0, g;
    // (one at a time, each seen with the ones before it gone: _{\pi}^{t} is \pi t, not \pit)
    var one = function (x, a, at, all) { return apart(a, at, x.length, all); };
    while (k++ < 400 && (g = f.replace(/[_^]\{((?:[^{}]|\{[^{}]*\})*)\}/, one)) !== f) f = g;
    k = 0;
    while (k++ < 400 && (g = f.replace(/[_^]/, function (x, at, all) { return apart("", at, 1, all); })) !== f) f = g;
    if (flatMemo.size > 20000) flatMemo.clear();
    flatMemo.set(t, f);
    return f;
  }
  // a command's name typed without its backslash, with its argument after it (sqrt{2}, frac{1}{2}, hat{x}): the
  // command, in the query as it is matched and as its glyphs are read
  var BARE_CMD = new RegExp("(^|[^A-Za-z\\\\])(" + ACCS + "|sqrt|frac|dfrac|tfrac|binom|overline|underline)(?=\\{)", "g");
  // (and <=, >=, != as typed: \leq, \geq, \neq; only in a query: in a formula's TeX they are what they are, <a,b>=0 or n!=1)
  // (a query that is a formula as typed, with =, _, ^, \\, brackets, digits...: a run of letters that is wholly symbols'
  // names is them, psi(t,x), 1/rho, = L psi, munu; and a script of more than one digit or letter is all of it, F_14,
  // delta_ij; a word alone, phi, or among words, the phi meson: a word)
  var NAMES = Object.keys(GLYPH).filter(function (n) { return n.length > 1; }).concat(["sum", "prod", "int", "iint", "oint", "coprod"]);   // (and the big signs: sum_i)
  var NAMED = own({}); NAMES.forEach(function (n) { NAMED[n] = 1; });
  function asNames(run) {                          // run as names one after another (munu: mu nu), or null
    var at = [[]];
    for (var i = 1; i <= run.length; i++) {
      at[i] = null;
      for (var j = Math.max(0, i - 10); j < i && !at[i]; j++) if (at[j] && NAMED[run.slice(j, i)]) at[i] = at[j].concat([run.slice(j, i)]);
    }
    return at[run.length];
  }
  var FORMULA_LIKE = /[_^\\{}=+*\/<>()\[\]|0-9]/;
  function bareCmds(q) { return q.replace(BARE_CMD, "$1\\$2").replace(/<=/g, "\\leq ").replace(/>=/g, function (x, at, all) { return /<[^<>]*$/.test(all.slice(0, at)) ? x : "\\geq "; }).replace(/(^|[^\\])!=/g, "$1\\neq "); }   // (<a,b>=0: a bracket's end)   // (\!= is a thin space less and =)
  // (a query typed, not in $...$, TeX as written: its names and scripts as a person means them)
  // The places in a query that read two ways, as typed or as TeX (Erez, Oct 25): a run of letters wholly symbols'
  // names (psi, munu: \psi, \mu\nu; as TeX, letters), a script of more than one digit or of letters of one case (F_14,
  // x_ij: all of it; as TeX, its first); each place either way, in the same query (x_ij + alpha: x_i j + \alpha too)
  function spots(q) {
    var out = [];
    if (!FORMULA_LIKE.test(q)) return out;
    q.replace(/(\\?)([A-Za-z]+)/g, function (x, sl, run, at, all) {
      if (sl) return x;                                // (a command's own name)
      if (/\\(text[a-z]*|math[a-z]+|operatorname|mbox|begin|end)\s*\{$/.test(all.slice(Math.max(0, at - 20), at))) return x;   // (words in a font's or a text's braces)
      var ns = asNames(run);
      if (!ns) return x;
      var r = ns.map(function (n) { return "\\" + n; }).join("");
      if (ns.length > 1 && /[_^]$/.test(all.slice(0, at))) r = "{" + r + "}";   // (^munu: ^{\mu\nu})
      else if (/^[A-Za-z]/.test(all.charAt(at + x.length))) r += " ";
      out.push({at: at, len: x.length, typed: r});
      return x;
    });
    q.replace(/([_^])(\d{2,}|[a-z]{2,}|[A-Z]{2,})(?![A-Za-z0-9\\{_^])/g, function (x, s1, run, at) {
      var a = at + 1;
      if (!out.some(function (o) { return a < o.at + o.len && o.at < a + run.length; })) out.push({at: a, len: run.length, typed: "{" + run + "}"});
      return x;
    });
    return out.sort(function (x, y) { return x.at - y.at; });
  }
  // the query's readings: every way of reading its places, the most typed first and TeX as written last (beyond four
  // places: those two)
  function readings(q) {
    var sp = spots(q), n = sp.length, out = [];
    if (!n) return [q];
    var masks = [];
    if (n <= 4) for (var m = (1 << n) - 1; m >= 0; m--) masks.push(m); else masks = [(1 << n) - 1, 0];
    masks.forEach(function (m) {
      var r = "", last = 0;
      sp.forEach(function (o, i) { r += q.slice(last, o.at) + (m & (1 << i) ? o.typed : q.substr(o.at, o.len)); last = o.at + o.len; });
      r += q.slice(last);
      if (out.indexOf(r) < 0) out.push(r);
    });
    return out;
  }

  // A formula and a query's readings (tex, then its alts): the first reading the formula has, or -1. Its readings
  // differ only in how their places are spelled (\alpha or alpha, {ij} or ij): without \, braces and spaces they are
  // one skeleton, which the formula's own (as the query reads it) must hold for any reading to be in it: tried once
  var skelQ = new Map(), skelT = new Map();
  function skeleton(x) { return x.replace(/[\\{}\s\u0005]/g, ""); }
  function texHasAny(tex, qs) {
    if (qs.length === 1 || qs[0].indexOf("?") >= 0) { for (var j = 0; j < qs.length; j++) if (texHas(tex, qs[j])) return j; return -1; }
    var q0 = texNorm(bareCmds(qs[0])).replace(SCRIPT1, script1), key = (HAS_FONT.test(q0) ? 1 : 0) + (HAS_ACC.test(q0) ? 2 : 0) + (/'|\\prime/.test(q0) ? 4 : 0) + (/[_^]/.test(q0) ? 8 : 0);
    var sk = skelT.get(key + "|" + tex);
    if (sk === undefined) {
      var t = plainly(texNorm(tex), q0);
      sk = skeleton(key & 8 ? t : flat(t));
      if (skelT.size > 40000) skelT.clear();
      skelT.set(key + "|" + tex, sk);
    }
    var any = false;
    for (var i = 0; i < qs.length && !any; i++) {
      var s0 = skelQ.get(qs[i]);
      if (s0 === undefined) { s0 = skeleton(texNorm(bareCmds(qs[i])).replace(SCRIPT1, script1)); skelQ.set(qs[i], s0); }
      any = sk.indexOf(s0) >= 0;
    }
    if (!any) return -1;
    for (var k = 0; k < qs.length; k++) if (texHas(tex, qs[k])) return k;
    return -1;
  }
  // (a space, a text's or one made between words, matched anywhere or nowhere: \text{Res str} is \mathrm{Res}\;\text{str};
  // one after a command's name, \alpha x, kept)
  function despace(x) { return x.indexOf(" ") < 0 ? x : x.replace(/(\\[A-Za-z]+)?( +)/g, function (m, c, sp, at, all) { return c && /[A-Za-z]/.test(all.charAt(at + m.length)) ? c + " " : c || ""; }); }
  function texHas(tex, q) {
    q = despace(texNorm(bareCmds(q)).replace(SCRIPT1, script1));   // (a one-symbol script's braces gone, as plainly takes them from the formula's)
    var t = despace(plainly(texNorm(tex), q)), i;
    if (!/[_^]/.test(q)) t = flat(t);
    // a letter inside a command's name is none of the formula's: a is not in \frac, q not in \sqrt (\log is drawn as
    // its letters, and found so by its own rule)
    // (nor the | of \| or any other mark of a control symbol, nor the letters of an environment's name, \begin{pmatrix})
    function inName(at) {
      var before = t.slice(Math.max(0, at - 40), at);
      if (!/[A-Za-z]/.test(t.charAt(at))) return /(^|[^\\])(\\\\)*\\$/.test(before);   // (a control symbol's mark, \|)
      if (/\\(begin|end)\{[A-Za-z]*$/.test(before)) return true;
      var b = /\\([A-Za-z]*)$/.exec(before);
      return !!b && !OPNAME.test(b[1] + /^[A-Za-z]*/.exec(t.slice(at))[0]);   // (one drawn as its letters: theirs)
    }
    if (q.indexOf("?") >= 0) {
      var re = new RegExp(q.split("{?}").map(function (part) { return part.split("?").map(reEsc).join(TOKEN); }).join(GROUP), "g"), m;
      while ((m = re.exec(t))) { if (!inName(m.index)) return true; re.lastIndex = m.index + 1; }
      return false;
    }
    i = t.indexOf(q);
    while (i >= 0) {
      // \phi is not the start of \phiup: after a command name the next character is no letter
      if (!inName(i) && !(/\\[A-Za-z]+$/.test(q) && /[A-Za-z]/.test(t.charAt(i + q.length)))) return true;
      i = t.indexOf(q, i + 1);
    }
    return false;
  }
  // the glyphs a piece of TeX draws, in the order a formula's drawing has them (a letter: italic or upright; a
  // command: its symbol; braces, _ and ^ draw nothing); null when it has something this cannot tell
  var OPS = own({cdot: "22C5", times: "D7", pm: "B1", mp: "2213", sum: "2211", int: "222B", prod: "220F", oint: "222E", sqrt: "221A",
    langle: "27E8", rangle: "27E9", dagger: "2020", ldots: "2026", cdots: "22EF", to: "2192", rightarrow: "2192", leftarrow: "2190",
    leq: "2264", le: "2264", geq: "2265", ge: "2265", neq: "2260", ne: "2260", approx: "2248", sim: "223C", equiv: "2261",
    propto: "221D", otimes: "2297", oplus: "2295", wedge: "2227", vee: "2228", cap: "2229", cup: "222A", in: "2208",
    subset: "2282", mid: "2223", prime: "2032", star: "22C6", ast: "2217", circ: "2218", bullet: "2219",
    forall: "2200", exists: "2203", neg: "AC", lnot: "AC", ll: "226A", gg: "226B", simeq: "2243", cong: "2245", doteq: "2250",
    notin: "2209", ni: "220B", subseteq: "2286", supset: "2283", supseteq: "2287", mapsto: "21A6", longmapsto: "27FC", Rightarrow: "21D2",
    Leftarrow: "21D0", Leftrightarrow: "21D4", leftrightarrow: "2194", longrightarrow: "27F6", longleftarrow: "27F5",
    longleftrightarrow: "27F7", Longrightarrow: "27F9", Longleftarrow: "27F8", Longleftrightarrow: "27FA", uparrow: "2191",
    downarrow: "2193", perp: "22A5", prec: "227A", succ: "227B", preceq: "2AAF", succeq: "2AB0", lesssim: "2272", gtrsim: "2273",
    setminus: "2216", ddagger: "2021", diamond: "22C4", square: "25A1", angle: "2220", vdots: "22EE", ddots: "22F1",
    lfloor: "230A", rfloor: "230B", lceil: "2308", rceil: "2309", bigcup: "22C3", bigcap: "22C2", bigvee: "22C1", bigwedge: "22C0", bigsqcup: "2A06", bigoplus: "2A01",
    bigotimes: "2A02", bigodot: "2A00", coprod: "2210", ominus: "2296", odot: "2299", oslash: "2298", vdash: "22A2",
    models: "22A8", div: "F7", iint: "222C", iiint: "222D", top: "22A4", coloneqq: "2254", triangle: "25B3", sqcup: "2294", sqcap: "2293",
    // (the AMS symbols: relations, arrows, brackets)
    leqslant: "2A7D", geqslant: "2A7E", leqq: "2266", geqq: "2267", lessapprox: "2A85", gtrapprox: "2A86", lll: "22D8", ggg: "22D9",
    nleq: "2270", ngeq: "2271", nless: "226E", ngtr: "226F", preccurlyeq: "227C", succcurlyeq: "227D", precsim: "227E", succsim: "227F",
    subsetneq: "228A", supsetneq: "228B", sqsubseteq: "2291", sqsupseteq: "2292", vartriangleleft: "22B2", vartriangleright: "22B3",
    trianglelefteq: "22B4", trianglerighteq: "22B5", approxeq: "224A", backsim: "223D", eqsim: "2242", triangleq: "225C",
    bumpeq: "224F", Bumpeq: "224E", circeq: "2257", multimap: "22B8", therefore: "2234", because: "2235", complement: "2201",
    nexists: "2204", boxplus: "229E", boxtimes: "22A0", boxminus: "229F", boxdot: "22A1", curlyvee: "22CE", curlywedge: "22CF",
    rightsquigarrow: "21DD", leftrightsquigarrow: "21AD", hookrightarrow: "21AA", hookleftarrow: "21A9", twoheadrightarrow: "21A0",
    rightarrowtail: "21A3", rightleftharpoons: "21CC", leftrightharpoons: "21CB", rightharpoonup: "21C0", nrightarrow: "219B",
    leftleftarrows: "21C7", rightrightarrows: "21C9", llbracket: "27E6", rrbracket: "27E7", varpropto: "221D", mho: "2127",
    asymp: "224D", rtimes: "22CA", ltimes: "22C9", sharp: "266F", flat: "266D", natural: "266E", fint: "2A0F", spadesuit: "2660",
    clubsuit: "2663", heartsuit: "2661", diamondsuit: "2662", lrcorner: "231F", llcorner: "231E", ulcorner: "231C", urcorner: "231D",
    lessgtr: "2276", gtrless: "2277", intercal: "22BA", Subset: "22D0", Supset: "22D1", lhd: "22B2", rhd: "22B3", unlhd: "22B4",
    unrhd: "22B5", pitchfork: "22D4", wr: "2240", amalg: "2A3F", smile: "2323", frown: "2322"});
  // (and other codes the same sign is drawn with: TeX's fonts, as pdf.js names them)
  var OPS_TOO = own({circ: ["25E6"], setminus: ["5C"], bullet: ["2022"], neg: ["AC"], notin: ["2208"], square: ["25FB"], perp: ["27C2"],
    neq: ["338"]});   // (\neq drawn as \not=: its slash, over the =)
  var QUIET = /^(frac|dfrac|tfrac|mathrm|mathit|mathbf|mathsf|text|textrm|operatorname|left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|,|;|!|quad|qquad|displaystyle|textstyle|scriptstyle|overline|underline|substack|\\)$/;
  var SYM = own({"+": "2B", "-": "2212", "=": "3D", "(": "28", ")": "29", "[": "5B", "]": "5D", ",": "2C", ";": "3B", ":": "3A", "!": "21",
    "/": "2F", "<": "3C", ">": "3E", "|": "7C", "'": "2032", "*": "2217", ".": "2E"});
  function hex(c) { return c.toString(16).toUpperCase(); }
  var FONTCMD = /^(mathcal|mathbb|mathfrak|mathscr|boldsymbol|bm|mathbf|mathsf|mathtt|mathit|mathrm|operatorname)$/;
  // a letter or digit in \mathcal{...} and the like, as drawn: the codes it may have (the drawing's own: \mathcal's
  // letters are the plain ones in its calligraphic font, \mathbb's and \mathbf's are Unicode's double-struck and bold)
  var ODD = own({mathbb: own({C: "2102", H: "210D", N: "2115", P: "2119", Q: "211A", R: "211D", Z: "2124"}),
    mathfrak: own({C: "212D", H: "210C", I: "2111", R: "211C", Z: "2128"}),
    mathscr: own({B: "212C", E: "2130", F: "2131", H: "210B", I: "2110", L: "2112", M: "2133", R: "211B", e: "212F", g: "210A", o: "2134"})});
  var FROM = own({mathbb: [0x1D538, 0x1D552, 0x1D7D8], mathfrak: [0x1D504, 0x1D51E], mathscr: [0x1D49C, 0x1D4B6],
    mathbf: [0x1D400, 0x1D41A, 0x1D7CE], boldsymbol: [0x1D468, 0x1D482, 0x1D7CE], bm: [0x1D468, 0x1D482, 0x1D7CE],
    mathsf: [0x1D5A0, 0x1D5BA, 0x1D7E2], mathtt: [0x1D670, 0x1D68A, 0x1D7F6]});
  function fontGlyph(font, c) {
    var k = c.charCodeAt(0), plain = hex(k), at = c <= "9" ? 2 : c < "a" ? 0 : 1, base = FROM[font] && FROM[font][at];
    var codes = [plain];
    if (ODD[font] && ODD[font][c]) codes.push(ODD[font][c]);
    else if (base) codes.push(hex(base + k - (at === 2 ? 48 : at === 0 ? 65 : 97)));
    if (font === "mathcal") codes.push.apply(codes, fontGlyph("mathscr", c).slice(1));   // (a script letter: \mathscr's too)
    if (font === "boldsymbol" || font === "bm") codes.push(hex(FROM.mathbf[at] + k - (at === 2 ? 48 : at === 0 ? 65 : 97)));
    if (font === "mathbf") codes.push(hex(FROM.boldsymbol[at] + k - (at === 2 ? 48 : at === 0 ? 65 : 97)));   // (bold italic too, \boldsymbol being \mathbf)
    if (font === "mathit" && at < 2) codes.push(c === "h" ? "210E" : hex((at ? 0x1D44E : 0x1D434) + k - (at ? 97 : 65)));   // (an italic h: Planck's)
    return codes;
  }
  // an accent's drawing, after what it is over (as TeX's PDF and MathJax both draw it)
  var ACC_DRAWN = own({hat: ["5E", "2C6", "302"], widehat: ["5E", "2C6", "302"], bar: ["AF", "2C9", "304"], tilde: ["7E", "2DC", "303"],
    widetilde: ["7E", "2DC", "303"], vec: ["20D7", "2192"], dot: ["2D9", "307"], ddot: ["A8", "308"], check: ["2C7", "30C"],
    breve: ["2D8", "306"], acute: ["B4", "2CA", "301"], grave: ["60", "2CB", "300"], slashed: ["2F", "338"], mathring: ["2DA", "30A"],
    overrightarrow: ["2192", "27F6", "20D7"], overleftarrow: ["2190", "27F5", "20D6"], overleftrightarrow: ["2194", "27F7", "20E1"]});
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
        if (ACC_DRAWN[name] || /^(overset|underset|xrightarrow|xleftarrow|binom|overbrace|underbrace)$/.test(name)) {
          var two = /^(overset|underset|binom)$/.test(name), gA = [], parts = [];
          for (var pa = 0; pa < (two ? 2 : 1); pa++) {
            if (q.charAt(i) === "{") {
              for (var d3 = 0, e3 = i; e3 < q.length; e3++) { if (q.charAt(e3) === "{") d3++; else if (q.charAt(e3) === "}" && !--d3) break; }
              parts.push(q.slice(i + 1, e3)); i = e3 + 1;
            } else if ((m = /^(\\[A-Za-z]+|.)/.exec(q.slice(i)))) { parts.push(m[1]); i += m[0].length; }
          }
          // (an accent asked for alone, \hat: its mark; at the end of more, +\bar, nothing to tell: what it is over is not asked)
          if (!parts.length && ACC_DRAWN[name] && !out.length && i >= q.length) { out.push(ACC_DRAWN[name]); continue; }
          if (parts.length < (two ? 2 : 1)) return null;
          parts = parts.map(function (x) { return glyphsOf(x) || null; });
          if (parts.some(function (x) { return !x; })) return null;
          if (ACC_DRAWN[name]) gA = parts[0].concat([ACC_DRAWN[name]]);
          else if (name === "binom") gA = [["28"]].concat(parts[0], parts[1], [["29"]]);
          else if (name === "overbrace" || name === "underbrace") gA = parts[0].concat([[name === "overbrace" ? "23DE" : "23DF"]]);
          else if (two) gA = parts[1].concat(parts[0]);
          else gA = [name === "xrightarrow" ? ["2192", "27F6"] : ["2190", "27F5"]].concat(parts[0]);
          out.push.apply(out, gA);
          continue;
        }
        if (name === "sqrt") {                       // a root is drawn with what is under it first, then the sign (then its index)
          var idx = "", body;
          if (q.charAt(i) === "[") { var cl = q.indexOf("]", i); if (cl < 0) return null; idx = q.slice(i + 1, cl); i = cl + 1; }
          if (q.charAt(i) === "{") {
            for (var d2 = 0, e2 = i; e2 < q.length; e2++) { if (q.charAt(e2) === "{") d2++; else if (q.charAt(e2) === "}" && !--d2) break; }
            body = q.slice(i + 1, e2); i = e2 + 1;
          } else if ((m = /^(\\[A-Za-z]+|.)/.exec(q.slice(i)))) { body = m[1]; i += m[0].length; }
          if (body === undefined) return null;         // (\sqrt with nothing under it yet, (\sqrt: what it is over is not asked)
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
        out.push([it, hex(k)].concat(Object.keys(FROM).map(function (f) { return fontGlyph(f, c)[1]; }), c === "i" ? ["131", "1D6A4"] : c === "j" ? ["237", "1D6A5"] : []));   // (and in any font; i and j dotless too)
      } else if (/[0-9]/.test(c)) out.push([hex(c.charCodeAt(0))].concat(Object.keys(FROM).map(function (f) { return fontGlyph(f, c)[1]; }).filter(function (x, k, a) { return x && a.indexOf(x) === k; })));   // (and in any font, \mathbf{1})
      else if (SYM[c]) out.push([SYM[c]].concat(c === "-" ? ["2D"] : c === "|" ? ["2223"] : []));
      else if (/[\s_^{}&~]/.test(c)) continue;
      else return null;
    }
    return out.length ? out : null;
  }

  function expand(t) {
    for (var pass = 0; pass < 3; pass++) {
      var t2 = t.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, function (x, n) { var b = macro(n); return b != null ? b + " " : x; });
      if (t2 === t) break;
      t = t2;
    }
    return t;
  }
  // the physics and braket packages' commands as what they draw, in queries and formulas alike: \ket{\psi} finds
  // |\psi\rangle, and |\psi\rangle finds \ket{\psi} (a paper's own definition of one of them wins: written out first)
  var PHYS = own({ket: [1, 1], bra: [1, 1], braket: [1, 2], ketbra: [2, 2], expval: [1, 2], ev: [1, 2], mel: [3, 3], abs: [1, 1], norm: [1, 1],
    dv: [1, 2], pdv: [1, 3], order: [1, 1], comm: [2, 2], acomm: [2, 2], dd: [1, 1], vb: [1, 1], vu: [1, 1], va: [1, 1],
    grad: [0, 1], div: [0, 1], curl: [0, 1], laplacian: [0, 1], qty: [0, 1], eval: [1, 1], tr: [0, 1], Tr: [0, 1]});
  var PHYS_RE = /\\(ketbra|ket|braket|bra|expval|ev|mel|abs|norm|dv|pdv|order|acomm|comm|dd|vb|vu|va|grad|div|curl|laplacian|qty|eval|tr|Tr)(?![A-Za-z])\*?/g;
  // a derivative as drawn: \dv{f}{x} df/dx, \dv[2]{f}{x} d^2f/dx^2, \pdv{f}{x}{y} \partial^2f/\partial x\partial y, \dv{x} d/dx
  function diff(d, a, b, c, pow) {
    var n = c != null ? "2" : pow, top = d + (n ? "^{" + n + "}" : "");
    if (b == null) return "\\frac{" + top + "}{" + d + a + (n ? "^{" + n + "}" : "") + "}";
    return "\\frac{" + top + a + "}{" + d + b + (c != null ? d + c : n ? "^{" + n + "}" : "") + "}";
  }
  function physics(t) {
    if (t.search(PHYS_RE) < 0) return t;
    var out = "", i = 0, m;
    while ((PHYS_RE.lastIndex = i, m = PHYS_RE.exec(t))) {
      var name = m[1], at = PHYS_RE.lastIndex, args = [], want = PHYS[name], pow = "";
      if (macro(name) != null) { out += t.slice(i, at); i = at; continue; }
      if (name === "ev") name = "expval";
      if (name === "div" && !/^\s*[{(]/.test(t.slice(at))) { out += t.slice(i, at); i = at; continue; }   // (a ÷ b: no argument)
      var om = /^\s*\[([^\]]*)\]/.exec(t.slice(at));      // (\dv[2]{f}{x}, \dd[3]{x}: the power)
      if (om && /^(dv|pdv|dd)$/.test(name)) { pow = om[1]; at += om[0].length; }
      var braced = /^\s*\{/.test(t.slice(at));            // (\tr{\rho}, \qty{x}: drawn with braces; \tr(\rho), \qty(x): with what follows)
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
        name === "acomm" ? "\\{" + a + "," + b + "\\}" : name === "dd" ? "\\mathrm{d}" + (pow ? "^{" + pow + "}" : "") + a :
        name === "vb" ? "\\mathbf{" + a + "}" : name === "vu" ? "\\hat{\\mathbf{" + a + "}}" : name === "va" ? "\\vec{\\mathbf{" + a + "}}" :
        name === "grad" ? "\\nabla " + (a || "") : name === "div" ? "\\nabla\\cdot " + (a || "") : name === "curl" ? "\\nabla\\times " + (a || "") :
        name === "laplacian" ? "\\nabla^2 " + (a || "") : name === "qty" ? (braced ? "\\{" + a + "\\}" : "") : name === "eval" ? a + "|" :
        name === "tr" || name === "Tr" ? "\\mathrm{" + name + "}" + (braced ? "\\{" + a + "\\}" : "") :
        diff(name === "dv" ? "\\mathrm{d}" : "\\partial ", a, b, c, pow);
      out += t.slice(i, m.index) + drawn + " ";
      i = at;
    }
    return out + t.slice(i);
  }
  var SIZES = /\\(left|right|middle|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|biggl|biggr|Biggl|Biggr|bigm|Bigm|displaystyle|textstyle|scriptstyle|scriptscriptstyle|limits|nolimits)(?![A-Za-z])\s*\.?/g;   // (and the style switches, \limits)
  var NAMED_FA = new RegExp("\\\\(" + FONTS + "|" + ACCS + ")(?![A-Za-z])\\s*([A-Za-z0-9]|\\\\[A-Za-z]+(?![A-Za-z]))", "g");   // (\mathrm dx: \mathrm{d}x, a letter one token)
  function fracBraces(t) {             // \frac12, \frac a{b}: \frac{1}{2}, \frac{a}{b}
    var out = "", i = 0, m, re = /\\(?:frac|binom)(?![A-Za-z])/g;   // (\binom q{w+1} too)
    while ((re.lastIndex = i, m = re.exec(t))) {
      var at = m.index + m[0].length;
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
  var normed = new Map();
  // TeX's spacing (\, \; \: \! \  ~ \quad ...): none, as a space is none; a row's end, \\, kept
  var SPACING = /(^|[^\\])((?:\\\\)*)\\(?:[,;:! \/]|(?:qquad|quad|enspace|thinspace|medspace|thickspace|negthinspace|negmedspace|negthickspace)(?![A-Za-z]))/g;
  // A table's cells and rows, and the lines of a display, as drawn: in a matrix, an array, cases, a cell apart from the
  // next and a row from the next (SEP, which no query has: nothing found across it); an array's columns' letters
  // ({cc}) nothing drawn; in an aligned display & nothing (an alignment point: x&=y is x=y), and a line apart from the
  // next unless it goes on the one before (a line starting or the one before ending with a sign: a+\\ +b is a++b)
  var SEP = "\u001f", TABLES = /\\begin\s*\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|array|cases|dcases|rcases|tabular|subarray)(\*?)\}([\s\S]*?)\\end\s*\{\1\2\}/g;
  var ROW = /\\\\(?:\s*\[[^\]]*\])?|\\cr(?![A-Za-z])/g;
  function cells(t) {
    if (t.indexOf("&") < 0 && t.indexOf("\\") < 0 && !/\\cr(?![A-Za-z])/.test(t)) return t;
    t = t.replace(/\\begin\s*\{(array|tabular|subarray)\}\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, "\\begin{$1}");
    t = t.replace(TABLES, function (x, env, star, body) { return "\\begin{" + env + star + "}" + body.replace(ROW, SEP).replace(/&/g, SEP) + "\\end{" + env + star + "}"; });
    t = t.replace(ROW, " ");                          // (a display's lines, a limit's two: one, as a display broken anywhere is the same)
    return t.replace(/\\&/g, "\u0003").replace(/&/g, "").replace(/\u0003/g, "\\&");   // (\& a drawn &)
  }
  function unspaced(t) {
    for (var k = 0; k < 4 && t.search(SPACING) >= 0; k++) t = t.replace(SPACING, "$1$2 ");
    return t.replace(/\\~/g, "\u0002").replace(/~/g, " ").replace(/\u0002/g, "\\~");   // (every ~, ~~ too; a text accent \~ kept)
  }
  // braces round a piece after a sign or an opening, or at the start, which group nothing (+{r^2}d\Omega): none
  // whether the group closed at j is the first argument of a command of two (\frac{a}{b}: a)
  function firstOfTwo(t, j) {
    for (var d = 0, s = j; s >= 0; s--) {
      var ch = t.charAt(s), esc = s > 0 && t.charAt(s - 1) === "\\";
      if (esc) continue;
      if (ch === "}") d++; else if (ch === "{" && !--d) break;
    }
    return s > 0 && /\\(frac|dfrac|tfrac|cfrac|binom|dbinom|tbinom|overset|underset|stackrel)\s*$/.test(t.slice(Math.max(0, s - 12), s));
  }
  // whether braces at i are a command's argument (\hat{x}) or a script's ({x}^2 after _ or ^): not after a symbol, \times{\mathbb Z}
  function argAt(t, i) {
    var before = t.slice(Math.max(0, i - 30), i), c = /\\([A-Za-z]+)$/.exec(before);
    if (c) return c[1] === "sqrt" || !(GLYPH[c[1]] || OPS[c[1]] || OPNAME.test(c[1]) || SAME[c[1]] && (GLYPH[SAME[c[1]]] || OPS[SAME[c[1]]]));   // (\sqrt: a sign that takes one)
    return /[_^}]$/.test(before);
  }
  function groupEnd(t, i) {               // the "}" that closes the "{" at i (t.length when none)
    for (var d = 0, e = i; e < t.length; e++) {
      var ch = t.charAt(e);
      if (ch === "\\") { e++; continue; }
      if (ch === "{") d++; else if (ch === "}" && !--d) return e;
    }
    return t.length;
  }
  // braces that group nothing (T_{{b_i}{b_j}}, {\bar{q}}_\pm, 1{-}x, \in{{\mathbb Z}^n}): not a command's argument (\hat{x},
  // \frac{a}{b}, \sqrt[3]{y}), not a script (^{..}, _{..}), not after a letter (sqrt{2}, typed for \sqrt{2}), and not
  // several things before a script ({x+y}^2 is not x+y^2)
  function idleBraces(t, i) {
    var e = groupEnd(t, i);
    if (e >= t.length) return false;
    var before = t.slice(Math.max(0, i - 40), i).replace(/\s+$/, ""), inner = t.slice(i + 1, e);
    if (!inner) return false;
    if (/\\(?:over|atop|choose|above|brack|brace)(?![A-Za-z])/.test(inner)) return false;   // ({1\over 2}: the braces are the fraction's)
    if (/[_^]$/.test(before) || /(?:^|[^A-Za-z\\])[A-Za-z]{2,}$/.test(before) && !/^\\/.test(inner)) return false;
    var cmd = /\\([A-Za-z]+)\*?$/.exec(before);
    if (cmd && argAt(t, i)) return false;
    if (/\\[A-Za-z]+\*?\s*\[[^\]]*\]$/.test(before)) return false;               // (\sqrt[3]{y}, \xrightarrow[a]{b})
    if (/\}$/.test(before) && !/\\\}$/.test(before) && firstOfTwo(t, t.lastIndexOf("}", i - 1))) return false;
    var atom = /^(?:\\[A-Za-z]+\*?(?:\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*|\\.|[^{}\\\s])(?:[_^'](?:\{(?:[^{}]|\{[^{}]*\})*\}|\\[A-Za-z]+|[^{}\\\s]))*$/.test(inner);   // (one thing, with its own scripts)
    if (!atom && /^\s*[_^']/.test(t.slice(e + 1))) return false;
    return true;
  }
  function loose(t) {
    for (var k = 0; k < 3; k++) {
      var out = "", i = 0, changed = false;
      while (i < t.length) {
        var c = t.charAt(i);
        if (c === "\\") { var cm = /^\\([A-Za-z]+|.)/.exec(t.slice(i)), tk = cm ? cm[0] : c; out += tk; i += tk.length; continue; }
        if (c === "{" && idleBraces(t, i)) {      // (braces that group nothing: what they hold, as it is)
          var ge = groupEnd(t, i), inner = t.slice(i + 1, ge);
          out += (/^[A-Za-z]/.test(inner) && /\\[A-Za-z]+$/.test(out) ? " " : "") + inner +
            (/\\[A-Za-z]+$/.test(inner) && /^[A-Za-z]/.test(t.charAt(ge + 1)) ? " " : "");   // ({\omega}G: \omega G, never \omegaG)
          i = ge + 1; changed = true; continue;
        }
        var one = c === "{" && /^\{(\\[A-Za-z]+|[A-Za-z0-9])\}/.exec(t.slice(i));   // (a single token's braces: {e}^{a} as e^a)
        if (one && !argAt(t, i) && !/[A-Za-z]$/.test(t.slice(Math.max(0, i - 30), i).replace(/\\[A-Za-z]+$/, ""))) { out += (/^[A-Za-z]/.test(one[1]) && /\\[A-Za-z]+$/.test(out) ? " " : "") + one[1] + (/^[A-Za-z]/.test(t.charAt(i + one[0].length)) && one[1].charAt(0) === "\\" ? " " : ""); i += one[0].length; changed = true; continue; }   // (not after a letter: sqrt{2}, typed for \sqrt{2}, keeps them)
        if (c === "{" && (i === 0 || /[=+\-*\/(,\[|<>;:]/.test(t.charAt(i - 1)))) {
          for (var d = 0, e = i; e < t.length; e++) { if (t.charAt(e) === "\\") { e++; continue; } if (t.charAt(e) === "{") d++; else if (t.charAt(e) === "}" && !--d) break; }
          if (e < t.length && !/^[\^_]/.test(t.slice(e + 1)) && !/\\(?:over|atop|choose|above|brack|brace)(?![A-Za-z])/.test(t.slice(i + 1, e))) { out += t.slice(i + 1, e); i = e + 1; changed = true; continue; }
        }
        if (c === "{" && /^\{(?:[(\[]|\\\{)/.test(t.slice(i)) && !/(\\[A-Za-z]+|[_^])$/.test(t.slice(Math.max(0, i - 30), i)) &&
            (t.charAt(i - 1) !== "}" || !firstOfTwo(t, i - 1))) {   // ({\left[...\right]}: [...]; after a group too, \sqrt{g}{[..]}, not \frac{a}{[b]})
          for (var d2 = 0, e2 = i; e2 < t.length; e2++) { if (t.charAt(e2) === "\\") { e2++; continue; } if (t.charAt(e2) === "{") d2++; else if (t.charAt(e2) === "}" && !--d2) break; }
          if (e2 < t.length && /(?:[)\]]|\\\})$/.test(t.slice(i + 1, e2))) { out += t.slice(i + 1, e2); i = e2 + 1; changed = true; continue; }
        }
        out += c; i++;
      }
      t = out;
      if (!changed) break;
    }
    return t;
  }
  var TWO_SCRIPTS = /([_^])(\{[^{}]*\}|\\[A-Za-z]+|[^{}\\\s])\1(\{[^{}]*\}|\\[A-Za-z]+|[^{}\\\s])/g;
  var FONT_GROUP = /\{(\\(?:mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|mathfrak|mathscr|boldsymbol)\{[^{}]*\})\}/g;
  var FONT_RUN = /\\(mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|mathfrak|mathscr|boldsymbol)\s*\{([^{}]*)\}([\s\u0005]*-?[\s\u0005]*)\\\1\s*\{/g;   // (and across a hyphen: \mathrm{on}-\mathrm{shell})
  // a run of one font joined (\mathrm{for}\mathrm{all}); not a script's own group with what follows it (\otimes_\mathbb{Z}\mathbb{R})
  function fontRun(x, f, a, sep, at, all) {
    if (/[_^]\s*$/.test(all.slice(Math.max(0, at - 4), at))) return x;
    if (/-/.test(sep) && !(f === "mathrm" && /^[A-Za-z\s]*$/.test(a) && /^[A-Za-z]/.test(all.slice(at + x.length)))) return x;   // (a minus between two bold symbols: no word)
    // (a command's name kept apart from the letter the next group starts with: \mathcal{\beta}\mathcal{c} is \mathcal{\beta c})
    return "\\" + f + "{" + a + (!sep && /\\[A-Za-z]+$/.test(a) && /^[A-Za-z]/.test(all.slice(at + x.length)) ? " " : sep);
  }
  // a letter's two scripts in one order, its subscript first: x^a_b is x_b^a
  function scriptOrder(t) {
    if (t.indexOf("^") < 0 || t.indexOf("_") < 0) return t;
    var arg = function (i) {                     // the end of the script that starts at i
      var c = t.charAt(i);
      if (c === "{") { for (var d = 0, e = i; e < t.length; e++) { if (t.charAt(e) === "{") d++; else if (t.charAt(e) === "}" && !--d) return e + 1; } return t.length; }
      if (c === "\\") { var cm = /^\\([A-Za-z]+|.)/.exec(t.slice(i)); return i + (cm ? cm[0].length : 1); }
      return i + 1;
    };
    var out = "", i = 0;
    while (i < t.length) {
      var c = t.charAt(i);
      if (c === "\\") { var cm = /^\\([A-Za-z]+|.)/.exec(t.slice(i)), tk = cm ? cm[0] : c; out += tk; i += tk.length; continue; }   // (a \ at the end, as typed: itself)
      if (c === "^" && i + 1 < t.length) {
        var a1 = arg(i + 1);
        if (t.charAt(a1) === "_" && a1 + 1 < t.length) {
          var b1 = arg(a1 + 1);
          out += "_" + scriptOrder(t.slice(a1 + 1, b1)) + "^" + scriptOrder(t.slice(i + 1, a1));
          i = b1;
          continue;
        }
      }
      out += c; i++;
    }
    return out;
  }
  // the old font switches, {\sf F}, {\rm d}, and \textsf{F} and the like: as \mathsf{F}, \mathrm{d}
  // what lays out and draws nothing: \hspace{..}, \vspace{..}, \kern-3em, \mkern-9mu, \phantom{..}
  var LAYOUT = /\\[hv]space\*?\s*\{[^{}]*\}|\\m?kern\s*-?\s*[\d.]+\s*(?:em|ex|pt|mu|cm|mm|in|bp|pc|sp)|\\[hv]?phantom\s*\{(?:[^{}]|\{[^{}]*\})*\}/g;
  var OLDF = own({rm: "mathrm", bf: "mathbf", it: "mathit", sf: "mathsf", tt: "mathtt", cal: "mathcal",
    textrm: "mathrm", textbf: "mathbf", textit: "mathit", textsf: "mathsf", texttt: "mathtt"});
  var OLDFONT = /\{\s*\\(rm|bf|it|sf|tt|cal)(?![A-Za-z])\s*([^{}]*)\}|\\(?:(textrm|textbf|textit|textsf|texttt))\{([^{}]*)\}/g;
  var TEXTY = /\\(text|textrm|textit|textbf|textsf|texttt|textsc|textup|textnormal|textmd|textsl|emph|mbox|hbox|fbox|intertext|shortintertext|tag\*?)\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
  function texNorm(t) {
    t = t || "";
    var hit = normed.get(t);
    if (hit !== undefined) return hit;
    var was = t;
    t = uniTeX(physics(expand(t)).replace(/—/g, "---").replace(/–/g, "--")).replace(SIZES, "")
      .replace(/\\([A-Za-z]+)(?![A-Za-z])/g, function (x, n) { var l = DRAWN[n]; return l && l !== n ? "\\mathrm{" + l + "}" : x; });   // (a command drawn as other letters, \varprojlim, \bmod: them)   // (– and —: -- and ---, in formulas only; a text keeps its dash)
    t = t.replace(/\}\s+\{/g, "}{").replace(/(\\[A-Za-z]+)\s+\{/g, "$1{");   // (\frac<line's end>{a}<line's end>{b}: its arguments, as drawn; TeX takes no space after a command's name)
    // (a text's spaces, drawn, kept: \text{analytic in}, not analyticin; a math's, which TeX does not draw, gone, as in
    // \mathrm{for all}; at a text's two ends none, \text{ where } as \text{where})
    // (and a text's dash a dash, not a math's minus: 25\text{–}30 has no -3)
    // (text in any style, plain, italic, bold, as text; one bold letter, \textbf{p}, a bold symbol, a vector)
    t = t.replace(/\\textbf\s*\{\s*([A-Za-z])\s*\}/g, "\\mathbf{$1}").replace(/\\(?:mathbf|bf)\s*\{([A-Za-z]{3,})\}/g, "\\text{$1}");   // (and a bold word, \mathbf{susy}, text)
    // (and a space made in an upright group, \mathrm{B \; USD}, nothing: a math's space, matched anywhere or nowhere)
    t = t.replace(/\\mathrm\s*\{([^{}]*)\}/g, function (x, a) { return /\\[,;: ]|\\q?quad|~/.test(a) ? "\\mathrm{" + a.replace(/\s*(?:\\[,;: ]|\\q?quad(?![A-Za-z])|~)\s*/g, "") + "}" : x; });
    t = t.replace(TEXTY, function (x, c, a) { a = a.replace(/\\[,;: ]|\\q?quad(?![A-Za-z])|~/g, " "); return "\\" + c + "{" + a.replace(/^\s+|\s+$/g, "").replace(/\s+/g, "\u0005").replace(/---/g, "\u2014").replace(/--/g, "\u2013") + "}"; });
    t = t.replace(/\\x(right|left)arrow\s*\{\s*(?:\\[,;:! ]\s*)*\}/g, "\\$1arrow ");   // (\xrightarrow{}: drawn as long as \rightarrow; with a label, long)
    t = unspaced(cells(t))
      .replace(/\\prescript\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "{}^{$1}_{$2}$3")   // (mathtools' \prescript)
      .replace(LAYOUT, "")                                                              // (\hspace{-0.9cm}, \kern-3em, \phantom{x}: nothing drawn)
      .replace(/\\(?:newline|nonumber|notag)(?![A-Za-z])/g, "")   // (rows: cells(), above)
      .replace(/\\tensor\*?\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "$1$2")   // (\tensor{\eta}{_\mu}: \eta_\mu)
      .replace(/\\indices\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "$1")
      .replace(/[_^]\s*\{\s*\}/g, "")                                                  // (an empty script, \eta^{*}{}^{}: none)
      .replace(/\{\s*([_^])\s*(\{[^{}]*\}|\\[A-Za-z]+|[^{}\\\s])\s*\}/g, "$1$2")          // (\mathsf{D}{_{\mu}}: \mathsf{D}_{\mu})
      .replace(/\\operatorname\*/g, "\\operatorname").replace(/\{\s*\}/g, "")   // (x\,dx, a,\ b; \Gamma^\mu{}_{\nu\rho}, {}_2F_1)
      .replace(/\\(?:lvert|rvert|vert|mid)(?![A-Za-z])/g, "|").replace(/\\(?:lVert|rVert|Vert|parallel)(?![A-Za-z])/g, "\\|")
      .replace(/\\ensuremath\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g, "$1")   // (\ensuremath{X}: X)
      .replace(/\.\.\.+/g, "\\ldots ")                                                // (1...k: 1\ldots k, as typed)
      .replace(/\\(i{2,4})nt(?![A-Za-z])/g, function (x, is) { return new Array(is.length + 1).join("\\int "); })   // (\iint: \int\int, as a PDF can't tell them apart)
      .replace(/\\textsc\s*\{([^{}]*)\}/g, function (x, w) { return "\\mathrm{" + w.toUpperCase() + "}"; })   // (small capitals drawn: capitals)
      .replace(/\\colon(?![A-Za-z])/g, ":").replace(/\\%/g, "%").replace(/\\#/g, "#").replace(/\\&/g, "&")
      .replace(/\\(?:boxed|fbox)\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g, "$1")             // (\boxed{x}: x, its frame a rule)
      .replace(/\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?)\\(over|choose)(?![A-Za-z])((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g, function (x, a, k, b) { return (k === "over" ? "\\frac{" : "\\binom{") + a.trim() + "}{" + b.trim() + "}"; })   // ({a\over b}: \frac{a}{b})
      .replace(/\\([ij])math(?![A-Za-z])\s*/g, "$1")                                     // (\imath: i)
      .replace(/\\up(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![A-Za-z])/g, "\\$1")   // (\upbeta: \beta)
      .replace(/\\(overset|underset|stackrel)\s*(\{(?:[^{}]|\{[^{}]*\})*\}|\\[A-Za-z]+|[^\s{}\\])\s*(\\[A-Za-z]+|[^\s{}\\])(?![A-Za-z])/g, function (x, c, a, b) { return "\\" + c + (a.charAt(0) === "{" ? a : "{" + a + "}") + "{" + b + "}"; })   // (\overset{n\to\infty}\longrightarrow: its second part braced)
      .replace(/\\x(right|left)arrow\s*\[([^\]]*)\]\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "\\overset{$3}{\\underset{$2}{\\long$1arrow}}")   // (\xrightarrow[b]{a}: a over, b under; drawn long)
      .replace(/\\x(right|left)arrow\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "\\overset{$2}{\\long$1arrow}")   // (\xrightarrow{\Phi}: \overset{\Phi}{\longrightarrow}, as long at least)
      .replace(/\\boldsymbol\s*\{\s*([0-9]+)\s*\}/g, "\\mathbf{$1}")                     // (\boldsymbol{1}: \mathbf{1}, a digit set bold)
      .replace(/\\math(?:rm|it)\s*\{\s*(\\[A-Za-z]+)\s*\}/g, function (x, c) { return GLYPH[c.slice(1)] ? c + " " : x; })   // (\mathrm{\theta}: \theta)
      .replace(/\\mathrm\s*\{\s*([0-9.]+)([A-Za-z][^{}]*)\}/g, "$1\\mathrm{$2}")       // (\mathrm{1pt}: 1\mathrm{pt}, digits taking no font)
      .replace(/\\pmod\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|(\\[A-Za-z]+|[^\s{\\]))/g, "(\\mathrm{mod}$1$2)").replace(/\\b?mod(?![A-Za-z])/g, "\\mathrm{mod}")   // (\pmod{n}: (mod n))
      .replace(/\\not\s*=/g, "\\neq ").replace(/\\not\s*\\in(?![A-Za-z])/g, "\\notin ")
      .replace(/\\ast(?![A-Za-z])/g, "*").replace(/\\coloneqq(?![A-Za-z])/g, ":=").replace(/\\eqqcolon(?![A-Za-z])/g, "=:")
      .replace(/\\math(?:op|ord|bin|rel|open|close|punct|inner)(?![A-Za-z])\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\})?/g, "$1")                             // (\mathop{}\!\mathrm{d}x: \mathrm{d}x; what it holds, as it is)
      .replace(/\\(Re|Im)(?![A-Za-z])/g, ROMAN_RE ? "\\mathrm{$1}" : "$&")               // (\Re: Re as the physics package draws it; with no package said, as a PDF, Re or ℜ)
      .replace(/\^\s*\{\s*((?:\\prime\s*)+)((?:[^{}]|\{[^{}]*\})*)\}/g, function (x, p, r) { return p.replace(/\\prime\s*/g, "'") + (r.trim() ? "^{" + r.trim() + "}" : ""); })   // (^{\prime 2}: '^{2})
      .replace(/\^\s*\\prime(?![A-Za-z])\s*/g, "'")                                         // (y^\prime: y')
      .replace(/\^\s*\{\s*('+)\s*((?:[^{}]|\{[^{}]*\})*)\}/g, function (x, p, r) { return p + (r.trim() ? "^{" + r.trim() + "}" : ""); })   // (^{'k}: '^{k})
      .replace(/\{\s*([A-Za-z])\s*('+)\s*\}(?=\s*[\^_])/g, "$1$2")                  // ({x'}^2: x'^2)
      .replace(/\\substack\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "$1");                   // (\sum_{\substack{i<j\\ j<N}}: its rows)
    t = t.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, function (x, n) { return n === "lt" ? "<" : n === "gt" ? ">" : SAME[n] ? "\\" + SAME[n] : x; });
    t = t.replace(new RegExp("\\\\(" + ACCS + ")(?![A-Za-z])\\s*(\\\\(?:" + FONTS + "|mathfrak|mathscr|mathsf|mathtt)\\s*\\{(?:[^{}]|\\{[^{}]*\\})*\\})", "g"), "\\$1{$2}");   // (\tilde \mathcal{C}: \tilde{\mathcal{C}})
    t = fracBraces(t.replace(NAMED_FA, "\\$1{$2}"))
      .replace(/([_^])\s*\\frac(\{(?:[^{}]|\{[^{}]*\})*\}\{(?:[^{}]|\{[^{}]*\})*\})/g, "$1{\\frac$2}");   // (p^\frac N2: p^{\frac{N}{2}})
    t = t.replace(/\\(rm|bf|it|sf|tt|cal)(?![A-Za-z])\s*\{([^{}]*)\}/g, function (x, f, a) { return "\\" + OLDF[f] + "{" + a.trim() + "}"; })   // (\rm{UU}: \mathrm{UU})
      .replace(/\\([A-Za-z]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, function (x, n, a) { return OPNAME.test(n) && !/^(tr|Tr)$/.test(n) ? "\\" + n + " " + a + " " : x; });   // (\sin{\theta}: \sin\theta, no argument)
    t = t.replace(OLDFONT, function (x, f, a, g, b, at, all) {   // (a script's own braces kept: S_{\rm gen} is S_{\mathrm{gen}})
      var y = "\\" + OLDF[f || g] + "{" + (f ? a : b).trim() + "}";
      return f && (/[_^]\s*$/.test(all.slice(Math.max(0, at - 3), at)) || /\\[A-Za-z]+\s*$/.test(all.slice(Math.max(0, at - 30), at)) && argAt(all, at)) ? "{" + y + "}" : y;   // (and an argument's: \tilde{\cal N})
    });
    t = t.replace(/\\(rm|bf|it|sf|tt|cal)(?![A-Za-z])\s*([A-Za-z0-9]+)/g, function (x, f, w) { return "\\" + OLDF[f] + "{" + w + "}"; });   // (\rm eff: \mathrm{eff})
    // (one font inside the same font: once)
    t = t.replace(/\\(mathrm|mathbf|mathit|mathcal|mathbb|mathsf|mathtt)\s*\{\s*\\\1\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*\}/g, "\\$1{$2}")   // (\mathrm{\rm X}: \mathrm{X})
      .replace(/\\(mathrm|mathbf|mathit|mathcal|mathbb|mathsf|mathtt)\s*\\\1(?![A-Za-z])/g, "\\$1");
    for (var kr = 0; kr < 6 && t.search(FONT_RUN) >= 0; kr++) { var t0 = t; t = t.replace(FONT_RUN, fontRun); if (t === t0) break; }   // (a run of one font, joined first: \mathrm{Set}-\mathrm{I})
    t = t.replace(/\\(mathtt|mathsf|mathbf|mathit)\s*\{\s*\\mathrm\s*\{([^{}]*)\}\s*\}/g, "\\$1{$2}");   // (\texttt{\textup{D}}: \mathtt{D})
    for (var kn = 0; kn < 3; kn++) t = t.replace(/\\(mathrm|mathbf|mathit|mathsf|mathcal|mathbb|mathfrak)\s*\{([^{}\\]*)\\(mathrm|mathbf|mathit|mathsf|mathcal|mathbb|mathfrak)\s*\{([^{}]*)\}([^{}\\]*)\}/g, function (x, f, a, g, b, c) {
      return (a.trim() ? "\\" + f + "{" + a + "}" : "") + "\\" + g + "{" + b + "}" + (c.trim() ? "\\" + f + "{" + c + "}" : "");
    });   // (a font group inside another font's: \mathrm{\mathbf{R}Hom} is \mathbf{R}\mathrm{Hom})
    // a font round a letter and its scripts (\mathcal{B^*}: \mathcal{B}^*; \mathrm{La_{0.6}Sr_{0.4}}: \mathrm{La}_{0.6}\mathrm{Sr}_{0.4})
    t = t.replace(/\\(mathfrak|mathcal|mathbb|mathbf|mathrm|mathsf|mathit|mathtt)\s*\{((?:[^{}]|\{[^{}]*\})*[_^](?:[^{}]|\{[^{}]*\})*)\}/g, function (x, f, b) {
      return b.split(/([_^](?:\{[^{}]*\}|\\[A-Za-z]+|.))/).map(function (y, k) { return k % 2 ? y : y ? "\\" + f + "{" + y + "}" : ""; }).join("");
    });
    // brackets, signs and punctuation in an upright or bold group: outside it (\mathrm{(even)}: (\mathrm{even}))
    t = t.replace(/\\(mathrm|mathbf|mathit|mathsf)\s*\{([^{}\\]*)\}/g, function (x, f, b) {
      if (/^[A-Za-z\s]*$/.test(b)) return x;
      return b.split(/([^A-Za-z\s]+)/).map(function (y, k) { return k % 2 ? y : y.trim() ? "\\" + f + "{" + y + "}" : ""; }).join("");
    });
    // an upright letter alone: the letter (\mathrm{d}x: dx, \mathrm{I}_A, \chi_{\rm r}: \chi_r), and italic text as italic letters
    t = t.replace(/\\(?:mathrm\s*\{\s*([A-Za-z])\s*\}|mathit\s*\{((?:[^{}]|\{[^{}]*\})*)\})/g, function (x, c, it, at, all) { var v = c || it; if (c && (/^\u0005*\\mathrm\{/.test(all.slice(at + x.length)) || /\}\u0005+$/.test(all.slice(Math.max(0, at - 3), at)))) return x;   /* (a letter among a text's words, \text{B USD}: its group) */ return (/^[A-Za-z]/.test(v) && /\\[A-Za-z]+$/.test(all.slice(Math.max(0, at - 30), at)) ? " " : "") + v; });
    t = t.replace(/\\math(?:bb|bf)\s*\{\s*1\s*\}/g, "1");                                   // (\mathbb{1}: 1, an indicator's one)
    // an operator's name as upright text (\mathrm{dim}: \dim); arg min and ess sup as TeX draws them
    t = t.replace(/\\mathrm\s*\{\s*([A-Za-z]+)\s*\}/g, function (x, n) { return OPNAME.test(n) && !/^(tr|Tr)$/.test(n) ? "\\" + n + " " : x; })
      .replace(/\\arg(min|max)(?![A-Za-z])|\\mathrm\s*\{\s*arg\s*(min|max)\s*\}|\\arg\s*\\(min|max)(?![A-Za-z])/g, function (x, a, b, c) { return "\\arg\\" + (a || b || c) + " "; })
      .replace(/\\ess(sup|inf)(?![A-Za-z])|\\mathrm\s*\{\s*ess\s*(sup|inf)\s*\}|\\mathrm\s*\{\s*ess\s*\}\s*\\(sup|inf)(?![A-Za-z])/g, function (x, a, b, c) { return "\\mathrm{ess}\\" + (a || b || c) + " "; });
    // an operator's limit under it (\underset{x}{\min}: \min_{x})
    t = t.replace(/\\underset\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*\{\s*(\\[A-Za-z]+(?:\s*\\[A-Za-z]+)?)\s*\}/g, function (x, a, op) { var n = op.replace(/^\\|\s.*$/g, ""); return OPNAME.test(n) || OPS[n] || /^(arg|mathrm)/.test(n) ? op + "_{" + a + "}" : x; });
    t = t.replace(/([_^])\s*(\\([A-Za-z]+)\s*\{[^{}]*\})/g, function (x, s1, g, n) { return GLYPH[n] || OPS[n] || OPNAME.test(n) ? x : s1 + "{" + g + "}"; });   // (S_\text{gen} as S_{\text{gen}}; ^\infty{1} not)
    t = t.replace(/(\\[A-Za-z]+)\s+(?=[A-Za-z])/g, "$1\u0001").replace(/\s+/g, "").replace(/\u0001/g, " ");
    t = t.replace(SCRIPT1, script1);
    t = t.replace(/\\sqrt(?![A-Za-z])(\[[^\]]*\])? ?(\\[A-Za-z]+|[^{\\\s\[])/g, "\\sqrt$1{$2}");   // (\sqrt2, √2: \sqrt{2})
    for (var k = 0; k < 4; k++) t = t.replace(FONT_RUN, fontRun);   // (\mathrm{for}\mathrm{all}: \mathrm{forall}, as \text{for all})
    t = t.replace(FONT_GROUP, function (x, g, at, all) { return argAt(all, at) ? x : g; });   // ({\mathbb R}^2: \mathbb{R}^2; an argument, \hat{\mathbf{n}}, kept)
    t = t.replace(/\\mathrm\{(\\math(?:tt|sf|bf|it|cal|bb|frak)\{[^{}]*\})\}/g, "$1")      // (\textup{\texttt{Eff}}: \mathtt{Eff})
      .replace(/\{([,.])\}/g, "$1")                                                     // (50{,}000)
      .replace(TWO_SCRIPTS, function (x, s, a, b) { return s + "{" + a.replace(/^\{|\}$/g, "") + b.replace(/^\{|\}$/g, "") + "}"; })   // (\eta^{*}{}^{\mu}: \eta^{*\mu})
      .replace(/\\overline(?![A-Za-z])/g, "\\bar")
      .replace(new RegExp("\\\\(mathbf|boldsymbol|mathrm|mathit|mathcal|mathbb)\\{\\\\(" + ACCS + ")\\{([^{}]*)\\}\\}", "g"), "\\$2{\\$1{$3}}")   // (\boldsymbol{\hat{r}}: \hat{\boldsymbol{r}})                      // (\overline as \bar: a bar over what it holds, either way; a paper's own \bar may be \overline)
      .replace(/([A-Za-z}])('+)_(\{(?:[^{}]|\{[^{}]*\})*\}|\\[A-Za-z]+|[^{}\\])/g, "$1_$3$2");          // (e'_i: e_i', its prime after its subscript)
    t = t.replace(new RegExp("\\\\(" + ACCS + ")\\{\\\\(mathfrak|mathcal|mathbb|mathbf|mathrm|mathsf|mathit|mathscr)\\{([A-Za-z])([A-Za-z]+)\\}\\}", "g"), "\\$1{\\$2{$3}}\\$2{$4}");   // (\dot{\mathfrak{gl}}: the dot over the g, as a PDF reads it)
    t = loose(t);
    for (var kl = 0; kl < 4; kl++) t = t.replace(FONT_RUN, fontRun);   // (and runs whose braces loose() took off: \mathbf{X}{\boldsymbol{w}})
    t = t.replace(TWO_SCRIPTS, function (x, s, a, b) { return s + "{" + a.replace(/^\{|\}$/g, "") + b.replace(/^\{|\}$/g, "") + "}"; });   // ({x^a}^b, its braces gone: x^{ab})
    t = scriptOrder(t).replace(/('+)_(\{(?:[^{}]|\{[^{}]*\})*\}|\\[A-Za-z]+|[^{}\\])/g, "_$2$1");
    // (a space only between a command's name and a letter after it: \mu e, not e_\mu^a e)
    t = t.replace(/ +/g, function (m, at, all) { return /\\[A-Za-z]+$/.test(all.slice(Math.max(0, at - 30), at)) && /^[A-Za-z]/.test(all.slice(at + m.length)) ? " " : ""; });
    if (normed.size > 20000) normed.clear();
    t = t.replace(/\u0005/g, " ");                   // (a text's spaces, kept to here)
    normed.set(was, t);
    return t;
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
          if (c === "\\") { var cm = /^\\([A-Za-z]+|.)/.exec(t.slice(i)); i += (cm ? cm[0].length : 1) - 1; letters.push(null); continue; }   // (a \ at the end: itself)
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
    HAS_ACC, WORDED: WORDED, SCRIPTED: SCRIPTED, alts: alts, uniTeX: uniTeX, findWhat: findWhat, texHasAny: texHasAny, plainly: plainly,
    texHas: texHas, glyphsOf: glyphsOf, fontGlyph: fontGlyph, texNorm: texNorm, wordsIn: wordsIn, wordSeqs: wordSeqs,
    reEsc: reEsc, hex: hex};
};
// (this file's version: changed with every change to the rules; the PDF viewer for Chrome keeps its own copy and takes this one when it differs)
globalThis.L2M_searchRules.version = "2026-10-25.18";
