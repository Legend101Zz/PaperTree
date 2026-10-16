/**
 * The "Colour roles" and "Seven relation kinds" tables. Hex and ratio come from the live tokens in
 * both schemes (`useSchemeColours`), never from typed numbers: a ratio below its bar prints a
 * warning mark instead of a check.
 */
'use client';

import { contrastRatio, toHex, type Rgba } from '../model/contrast';
import { COLOUR_ROLES, RELATION_KINDS, ROLE_TOKENS } from '../model/roles';
import { useSchemeColours, type Scheme } from '../hooks/useSchemeColours';

import type { ReactNode } from 'react';

const WIRE_TOKENS = [...RELATION_KINDS.map((k) => k.token), '--pt-linen'];
const ALL_TOKENS = [...ROLE_TOKENS, ...WIRE_TOKENS];

/** One scheme's cell: swatch, hex and the measured ratio against the role's surface. */
function RoleCell({
  fg,
  bg,
  min,
}: {
  readonly fg: Rgba | undefined;
  readonly bg: Rgba | undefined;
  readonly min: number | null;
}): ReactNode {
  if (fg === undefined) return <td />;
  const ratio = bg === undefined ? null : contrastRatio(fg, bg);
  return (
    <td>
      <span className="ds-swatch" style={{ background: toHex(fg) }} aria-hidden="true" />
      <code className="ds-hex">{toHex(fg)}</code>
      {ratio === null || min === null ? null : (
        <span className="ds-ratio" data-pass={ratio >= min ? 'yes' : 'no'}>
          {ratio.toFixed(1)}:1 {ratio >= min ? '✓' : '✗ below ' + String(min)}
        </span>
      )}
    </td>
  );
}

/** Colour roles of both schemes with their measured ratios. */
export function ColourRoles(): ReactNode {
  const colours = useSchemeColours(ALL_TOKENS);
  const cell = (scheme: Scheme, token: string): Rgba | undefined => colours[scheme][token];
  return (
    <section className="ds-section" aria-labelledby="ds-colour">
      <h2 id="ds-colour" className="ds-h2">
        Colour roles
      </h2>
      <p className="ds-lede">
        Roles, not paint. Each row gives both schemes and the pair measured against its surface:
        text 4.5:1, control edges and focus 3:1. Ratios are computed from the live tokens.
      </p>
      <table className="ds-table">
        <caption className="ds-sr">
          Colour roles in daylight and lamp-lit, with contrast ratios
        </caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Daylight</th>
            <th scope="col">Lamp-lit</th>
            <th scope="col">Use</th>
          </tr>
        </thead>
        <tbody>
          {COLOUR_ROLES.map((role) => (
            <tr key={role.label}>
              <th scope="row">{role.label}</th>
              {(['light', 'dark'] as const).map((scheme) => (
                <RoleCell
                  key={scheme}
                  fg={cell(scheme, role.token)}
                  bg={role.on === null ? undefined : cell(scheme, role.on)}
                  min={role.min}
                />
              ))}
              <td className="ds-use">{role.use}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="ds-h3">Seven relation kinds: colour plus a second cue (pattern and glyph)</h3>
      <ul className="ds-wires">
        {RELATION_KINDS.map((kind) => (
          <li key={kind.name} className="ds-wire">
            <span className="ds-wire__name">
              <span aria-hidden="true">{kind.glyph}</span> {kind.name}
            </span>
            <svg width="120" height="14" viewBox="0 0 120 14" aria-hidden="true">
              <line
                x1="2"
                y1="7"
                x2="118"
                y2="7"
                stroke={`var(${kind.token})`}
                strokeWidth={kind.width}
                strokeDasharray={kind.dash === '' ? undefined : kind.dash}
                strokeLinecap="round"
              />
            </svg>
            <span className="ds-wire__glyph">glyph: {kind.glyphName}</span>
            {(['light', 'dark'] as const).map((scheme) => {
              const fg = cell(scheme, kind.token);
              const bg = cell(scheme, '--pt-linen');
              const ratio = fg === undefined || bg === undefined ? null : contrastRatio(fg, bg);
              return (
                <code key={scheme} className="ds-hex">
                  {fg === undefined ? '' : toHex(fg)}
                  {ratio === null ? '' : ` · ${ratio.toFixed(1)}`}
                </code>
              );
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
