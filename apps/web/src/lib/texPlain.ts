/**
 * lib/texPlain — TeX as short readable plain text, for the places that cannot typeset (a folded
 * preview, a diagram's SVG label, `aria` text). A reading aid, not a TeX parser: common commands
 * become their Unicode glyph, `\frac{a}{b}` becomes "a/b", and anything else loses its backslash.
 * It never returns a `$`.
 */

const GLYPHS: Readonly<Record<string, string>> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  cdot: '·',
  times: '×',
  div: '÷',
  pm: '±',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  mapsto: '↦',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  sum: '∑',
  prod: '∏',
  int: '∫',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  cup: '∪',
  cap: '∩',
  forall: '∀',
  exists: '∃',
  ldots: '…',
  cdots: '…',
  dots: '…',
  circ: '∘',
  odot: '⊙',
  oplus: '⊕',
  sqrt: '√',
  langle: '⟨',
  rangle: '⟩',
};

/** The content of the first `{…}` group at `from`, and the index after it (-1 when none). */
function group(tex: string, from: number): { body: string; end: number } {
  if (tex[from] !== '{') return { body: '', end: -1 };
  let depth = 0;
  for (let i = from; i < tex.length; i += 1) {
    const ch = tex[i];
    if (ch === '\\') i += 1;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { body: tex.slice(from + 1, i), end: i + 1 };
    }
  }
  return { body: tex.slice(from + 1), end: tex.length };
}

const WRAPPERS = new Set([
  'text',
  'mathrm',
  'mathbf',
  'mathit',
  'mathcal',
  'mathbb',
  'operatorname',
  'boldsymbol',
  'textbf',
  'textit',
  'hat',
  'bar',
  'tilde',
  'vec',
  'left',
  'right',
]);

/**
 * TeX as plain readable text.
 *
 * @param tex - The TeX source, without delimiters.
 * @returns Plain text with no backslash commands and no `$`.
 * @example
 * texToPlain('F(x) := H(x) - x') // "F(x) := H(x) - x"
 * texToPlain('\\frac{a}{b} \\le \\alpha') // "(a/b) ≤ α"
 */
export function texToPlain(tex: string): string {
  let out = '';
  let i = 0;
  while (i < tex.length) {
    const ch = tex[i] as string;
    if (ch === '\\') {
      const name = /^[A-Za-z]+/.exec(tex.slice(i + 1))?.[0];
      if (name === undefined) {
        const escaped = tex[i + 1] ?? '';
        out +=
          escaped === ',' || escaped === ';' || escaped === ':' || escaped === '!' ? ' ' : escaped;
        i += 2;
        continue;
      }
      i += 1 + name.length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const top = group(tex, i);
        const bottom = top.end === -1 ? top : group(tex, top.end);
        if (top.end !== -1 && bottom.end !== -1) {
          out += `(${texToPlain(top.body)}/${texToPlain(bottom.body)})`;
          i = bottom.end;
        }
        continue;
      }
      if (WRAPPERS.has(name)) {
        const arg = group(tex, i);
        if (arg.end !== -1) {
          out += texToPlain(arg.body);
          i = arg.end;
        }
        continue;
      }
      out += GLYPHS[name] ?? name;
      continue;
    }
    if (ch === '{' || ch === '}') {
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out.replace(/\s+/g, ' ').trim();
}
