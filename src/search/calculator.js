// Named functions (angles in radians) and constants understood by the evaluator.
// Trig works in radians so `pi`/`e` compose naturally, e.g. `sin(pi/6)` → 0.5.
const cot = (x) => 1 / Math.tan(x);
const acot = (x) => Math.PI / 2 - Math.atan(x);  // principal value in (0, π)
const FUNCTIONS = {
    sin: Math.sin,
    cos: Math.cos,
    tg: Math.tan,
    tan: Math.tan,
    ctg: cot,
    cot,
    sqrt: Math.sqrt,
    ln: Math.log,        // natural logarithm
    log: Math.log10,     // base-10 logarithm
    abs: Math.abs,
    // Inverse trig, spelled out.  `arc*`/`a*` aliases and (below) the sin⁻¹ form.
    asin: Math.asin,
    arcsin: Math.asin,
    acos: Math.acos,
    arccos: Math.acos,
    atan: Math.atan,
    arctan: Math.atan,
    arctg: Math.atan,
    acot,
    arccot: acot,
    arcctg: acot,
};
// Applied when a trig name carries a superscript power of −1 (sin⁻¹, tan⁻¹): the
// inverse function, not the reciprocal (which stays `sin(x)^-1`, power after the arg).
const INVERSE = {
    sin: Math.asin,
    cos: Math.acos,
    tg: Math.atan,
    tan: Math.atan,
    ctg: acot,
    cot: acot,
};
const CONSTANTS = {pi: Math.PI, e: Math.E};
// Unicode superscript digits/signs → normal characters, so `sin⁻¹`/`x²` parse.
const SUPERSCRIPTS = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-',
};

// Safe arithmetic evaluator (no eval): tokenise + recursive-descent parse with
// standard precedence.  Returns {value, ops} for a real calculation, or null
// for anything that is not one — so ordinary searches ("c++", "node 20",
// "1.2.3", a bare "2024") never masquerade as maths.
export function evaluateExpression(raw) {
    if (!raw) return null;
    let text = raw.trim();
    if (!text) return null;
    text = text
        .replace(/[×⋅∙]/g, '*')  // × ⋅ ∙
        .replace(/÷/g, '/')                // ÷
        .replace(/[−–—]/g, '-')  // − – —
        .replace(/\*\*/g, '^')                  // 2**3 → 2^3
        // A run of superscripts becomes an explicit power: sin⁻¹ → sin^(-1), x² → x^(2).
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (s) => `^(${s.replace(/./g, (c) => SUPERSCRIPTS[c])})`)
        .replace(/(\d)\s*,\s*(\d)/g, '$1.$2');  // decimal comma between digits
    // Letters are allowed for named functions/constants; require at least one
    // alphanumeric so pure-operator noise is rejected early.
    if (!/^[\s0-9.a-zA-Z+\-*/%^()]+$/.test(text) || !/[0-9a-zA-Z]/.test(text)) return null;

    const tokens = [];
    for (let i = 0; i < text.length;) {
        const ch = text[i];
        if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
        if ('+-*/%^()'.includes(ch)) { tokens.push(ch); i++; continue; }
        if (/[a-zA-Z]/.test(ch)) {
            let j = i;
            while (j < text.length && /[a-zA-Z]/.test(text[j])) j++;
            const name = text.slice(i, j).toLowerCase();
            if (name in CONSTANTS) tokens.push(CONSTANTS[name]);
            else if (name in FUNCTIONS) tokens.push({fn: name});
            else return null;  // unknown identifier — not a calculation
            i = j;
            continue;
        }
        let j = i;
        while (j < text.length && /[0-9.]/.test(text[j])) j++;
        if (text[j] === 'e' || text[j] === 'E') {
            let k = j + 1;
            if (text[k] === '+' || text[k] === '-') k++;
            if (/[0-9]/.test(text[k] ?? '')) { while (/[0-9]/.test(text[k] ?? '')) k++; j = k; }
        }
        const slice = text.slice(i, j);
        if (!/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(slice)) return null;
        tokens.push(parseFloat(slice));
        i = j;
    }
    if (!tokens.length) return null;

    let pos = 0;
    let ops = 0;
    const peek = () => tokens[pos];
    const parsePrimary = () => {
        const t = tokens[pos];
        if (t === '(') {
            pos++;
            const value = parseExpr();
            if (tokens[pos] !== ')') throw new Error('parse');
            pos++;
            return value;
        }
        if (t !== null && typeof t === 'object' && t.fn) {
            pos++;
            ops++;
            // Optional power written before the argument.  sin^2(x) === (sin(x))^2, but a
            // superscript of −1 on a trig name means the inverse: sin⁻¹(x) === arcsin(x).
            let exponent = null;
            if (peek() === '^') { pos++; ops++; exponent = parseUnary(); }
            const arg = parsePrimary();  // argument is the following primary, e.g. (…)
            if (exponent === -1 && INVERSE[t.fn]) return INVERSE[t.fn](arg);
            const value = FUNCTIONS[t.fn](arg);
            return exponent === null ? value : Math.pow(value, exponent);
        }
        if (typeof t === 'number') { pos++; return t; }
        throw new Error('parse');
    };
    const parsePower = () => {
        const base = parsePrimary();
        if (peek() === '^') { pos++; ops++; return Math.pow(base, parseUnary()); }
        return base;
    };
    const parseUnary = () => {
        if (peek() === '+') { pos++; return parseUnary(); }
        if (peek() === '-') { pos++; return -parseUnary(); }
        return parsePower();
    };
    const parseTerm = () => {
        let value = parseUnary();
        while (peek() === '*' || peek() === '/' || peek() === '%') {
            const op = peek(); pos++; ops++;
            const rhs = parseUnary();
            value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs;
        }
        return value;
    };
    const parseExpr = () => {
        let value = parseTerm();
        while (peek() === '+' || peek() === '-') {
            const op = peek(); pos++; ops++;
            const rhs = parseTerm();
            value = op === '+' ? value + rhs : value - rhs;
        }
        return value;
    };

    let value;
    try { value = parseExpr(); } catch { return null; }
    if (pos !== tokens.length) return null;    // trailing garbage
    if (!Number.isFinite(value)) return null;  // division by zero / overflow
    if (!ops) return null;                     // a lone number is not a calculation
    return {value, ops};
}

// Tame binary noise (0.1 + 0.2) and split the result into a grouped display
// string and a plain string suitable for pasting back into a calculation.
export function formatCalcResult(value) {
    if (!Number.isFinite(value)) return null;
    let rounded = Math.round((value + Number.EPSILON) * 1e10) / 1e10;
    if (Object.is(rounded, -0)) rounded = 0;
    const magnitude = Math.abs(rounded);
    if (magnitude !== 0 && (magnitude >= 1e15 || magnitude < 1e-9)) {
        const plain = rounded.toExponential(6).replace(/\.?0+e/, 'e');
        return {plain, display: plain};
    }
    return {plain: String(rounded),
        display: new Intl.NumberFormat(undefined, {maximumFractionDigits: 10}).format(rounded)};
}
