/**
 * What the design-system board lists: colour roles, relation kinds, washes and motion rows, as
 * token NAMES only. Every value (hex, ratio, duration) is read from the live stylesheet at runtime,
 * so a token edit shows up here without touching this file.
 */

/** One colour role: a token measured against the token it sits on. */
export interface ColourRole {
  readonly label: string;
  /** Foreground token (the swatch). */
  readonly token: string;
  /** Surface token it is measured against; `null` for a surface (no ratio). */
  readonly on: string | null;
  /** Minimum ratio the design asks for: 4.5 text, 3 controls and cues. */
  readonly min: 4.5 | 3 | null;
  readonly use: string;
}

/** The roles of frame 10's "Colour roles" table, in its order. */
export const COLOUR_ROLES: readonly ColourRole[] = [
  { label: 'Ground · desk', token: '--pt-ground', on: null, min: null, use: 'behind everything' },
  { label: 'Page · panels', token: '--pt-page', on: null, min: null, use: 'ivory paper, top bars' },
  { label: 'AI slip', token: '--pt-ai-slip', on: null, min: null, use: 'only AI text sits here' },
  {
    label: 'Call slip · index card',
    token: '--pt-call-slip',
    on: null,
    min: null,
    use: 'your asks, board cards',
  },
  { label: 'Board linen', token: '--pt-linen', on: null, min: null, use: 'the board' },
  {
    label: 'PDF page',
    token: '--pt-pdf-page',
    on: null,
    min: null,
    use: 'the paper stays paper, dimmed at night',
  },
  { label: 'Ink', token: '--pt-ink', on: '--pt-page', min: 4.5, use: 'body text' },
  { label: 'Ink on AI slip', token: '--pt-ink', on: '--pt-ai-slip', min: 4.5, use: 'AI text' },
  { label: 'Secondary ink', token: '--pt-ink-2', on: '--pt-page', min: 4.5, use: 'meta, captions' },
  {
    label: 'Muted ink · 13 px+',
    token: '--pt-ink-muted',
    on: '--pt-page',
    min: 4.5,
    use: 'placeholders, times',
  },
  {
    label: 'Primary text · link',
    token: '--pt-primary',
    on: '--pt-page',
    min: 4.5,
    use: 'oxblood text and outline',
  },
  {
    label: 'On primary fill',
    token: '--pt-on-primary',
    on: '--pt-primary-fill',
    min: 4.5,
    use: 'Ask, Open: gilt ring marks the edge',
  },
  { label: 'Your pen', token: '--pt-pen', on: '--pt-call-slip', min: 4.5, use: 'your typed words' },
  {
    label: 'Margin tab · marker',
    token: '--pt-on-tab',
    on: '--pt-tab',
    min: 4.5,
    use: 'tab text on the tab fill',
  },
  {
    label: 'AI tab',
    token: '--pt-ai-tab-ink',
    on: '--pt-ai-slip',
    min: 4.5,
    use: 'the standing AI tab',
  },
  {
    label: 'Not verified',
    token: '--pt-nv-ink',
    on: '--pt-ai-slip',
    min: 4.5,
    use: 'dashed tab, no fill',
  },
  {
    label: 'Danger',
    token: '--pt-danger',
    on: '--pt-page',
    min: 4.5,
    use: 'could not read, errors',
  },
  {
    label: 'Control border',
    token: '--pt-control-border',
    on: '--pt-page',
    min: 3,
    use: 'fields, buttons',
  },
  {
    label: 'Tab fill vs slip',
    token: '--pt-tab',
    on: '--pt-ai-slip',
    min: 3,
    use: 'margin tabs on the AI slip',
  },
  { label: 'Focus ring', token: '--pt-focus', on: '--pt-page', min: 3, use: '2 px, offset 2' },
  {
    label: 'Ribbon · reading now',
    token: '--pt-ribbon',
    on: '--pt-ground',
    min: 3,
    use: 'with the Continue row',
  },
  {
    label: 'Rule',
    token: '--pt-rule',
    on: null,
    min: null,
    use: 'decorative only, never the only cue',
  },
  {
    label: 'Sticky',
    token: '--pt-sticky',
    on: null,
    min: null,
    use: 'ink on it is 4.5+ (see tokens.spec)',
  },
];

/** Every token the roles read, so the hook can resolve them in one pass. */
export const ROLE_TOKENS: readonly string[] = [
  ...new Set(COLOUR_ROLES.flatMap((r) => (r.on === null ? [r.token] : [r.token, r.on]))),
];

/** The topic cloths, by subject; `language` takes paper labels (ink on it, not gilt). */
export const CLOTHS: readonly { readonly name: string; readonly token: string }[] = [
  { name: 'Transformers', token: '--pt-cloth-transformers' },
  { name: 'Vision', token: '--pt-cloth-vision' },
  { name: 'Generative', token: '--pt-cloth-generative' },
  { name: 'Optimization', token: '--pt-cloth-optimization' },
  { name: 'Language', token: '--pt-cloth-language' },
  { name: 'Reinforcement', token: '--pt-cloth-rl' },
];

/** The five highlight colours: wash plus the ink used for its edge and text. */
export const HIGHLIGHTS: readonly string[] = ['amber', 'green', 'blue', 'pink', 'purple'];

/** The motion table. `curve` is the token whose value the table prints. */
export const MOTION: readonly {
  readonly name: string;
  readonly duration: string;
  readonly curve: string | null;
  readonly usedBy: string;
}[] = [
  {
    name: 'quick',
    duration: '--pt-dur-quick',
    curve: '--pt-ease-out',
    usedBy: 'press, hover, toolbar lights',
  },
  {
    name: 'sheet',
    duration: '--pt-dur-sheet',
    curve: '--pt-ease-settle',
    usedBy: 'explain sheet, Link as',
  },
  {
    name: 'pull',
    duration: '--pt-dur-pull',
    curve: '--pt-ease-lift',
    usedBy: 'book-out of the shelf',
  },
  {
    name: 'open',
    duration: '--pt-dur-open',
    curve: '--pt-ease-lift',
    usedBy: 'cover opens, Dive in page',
  },
  { name: 'flash in', duration: '--pt-dur-flash-in', curve: null, usedBy: 'citation flash, rises' },
  {
    name: 'flash hold',
    duration: '--pt-dur-flash-hold',
    curve: null,
    usedBy: 'citation flash, holds',
  },
  {
    name: 'flash out',
    duration: '--pt-dur-flash-out',
    curve: null,
    usedBy: 'citation flash, clears',
  },
];
