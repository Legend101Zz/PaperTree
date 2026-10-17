/**
 * Spacing, radius, elevation and motion: each value is read from the live token (`useTokenText`),
 * so the reduced-motion column is the stylesheet's own answer when the OS asks for it.
 */
'use client';

import { useTokenText } from '../hooks/useSchemeColours';
import { MOTION } from '../model/roles';

import type { ReactNode } from 'react';

const SPACES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--pt-space-${String(n)}`);
const RADII: readonly (readonly [string, string])[] = [
  ['paper', '--pt-radius-paper'],
  ['controls', '--pt-radius-control'],
  ['menus', '--pt-radius-menu'],
  ['phone sheet', '--pt-radius-sheet'],
  ['pins, avatar', '--pt-radius-round'],
];
const ELEVATIONS: readonly (readonly [string, string])[] = [
  ['e1', 'slips on the desk'],
  ['e2', 'popovers, picker'],
  ['e3', 'pulled book'],
];
const ALL = [
  ...SPACES,
  ...RADII.map((r) => r[1]),
  ...MOTION.flatMap((m) => [m.duration, ...(m.curve === null ? [] : [m.curve])]),
];

/** Space, radius, elevation (e1 to e3) and the motion table. */
export function SpacingMotion(): ReactNode {
  const v = useTokenText(ALL);
  return (
    <section className="ds-section" aria-labelledby="ds-space">
      <h2 id="ds-space" className="ds-h2">
        Spacing, radius, elevation, motion
      </h2>
      <p className="ds-lede">
        Small numbers, used everywhere the same way. Elevation steps fill in lamp-lit: switch the
        scheme to see it.
      </p>
      <h3 className="ds-label">Spacing · 4 px base</h3>
      <ul className="ds-space" aria-label="Spacing scale">
        {SPACES.map((t) => (
          <li key={t}>
            <span
              className="ds-space__bar"
              style={{ inlineSize: `var(${t})`, blockSize: `var(${t})` }}
              aria-hidden="true"
            />
            <code>{v[t] ?? ''}</code>
          </li>
        ))}
      </ul>
      <h3 className="ds-label">Elevation · light from top-left</h3>
      <ul className="ds-elev" aria-label="Elevations">
        {ELEVATIONS.map(([e, use]) => (
          <li
            key={e}
            className="ds-elev__card"
            style={{
              background: `var(--pt-${e}-fill)`,
              boxShadow: `var(--pt-${e}), var(--pt-${e}-edge)`,
            }}
          >
            <strong>{e}</strong> · {use}
          </li>
        ))}
      </ul>
      <h3 className="ds-label">Radius</h3>
      <ul className="ds-radii" aria-label="Radii">
        {RADII.map(([name, t]) => (
          <li key={t}>
            <span
              className="ds-radii__box"
              style={{ borderRadius: `var(${t})` }}
              aria-hidden="true"
            />
            {v[t] ?? ''} · {name}
          </li>
        ))}
      </ul>
      <h3 className="ds-label">Motion · nothing bounces</h3>
      <table className="ds-table">
        <caption className="ds-sr">Motion tokens</caption>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Time</th>
            <th scope="col">Curve</th>
            <th scope="col">Used by</th>
            <th scope="col">Reduced motion</th>
          </tr>
        </thead>
        <tbody>
          {MOTION.map((m) => (
            <tr key={m.name}>
              <th scope="row">{m.name}</th>
              <td>{v[m.duration] ?? ''}</td>
              <td>{m.curve === null ? 'in · hold · out' : (v[m.curve] ?? '')}</td>
              <td>{m.usedBy}</td>
              <td className="ds-use">
                {m.name === 'flash hold' || m.name === 'quick'
                  ? 'unchanged'
                  : m.name.startsWith('flash')
                    ? 'appears and clears'
                    : 'cross-fade'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
