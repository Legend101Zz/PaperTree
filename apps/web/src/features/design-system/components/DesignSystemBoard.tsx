/**
 * The /design-system board (frame 10): the tokens and every shared component in one page, built
 * from the real stylesheet and the real `@papertree/ui` components. It is the visual baseline
 * later slices compare against. Developer-only (see `model/guard.ts`).
 */
'use client';

import { SproutMark } from '@papertree/ui';

import { ThemeSwitch, useTheme } from '@/features/settings';

import './design-system.css';
import { ColourRoles } from './ColourRoles';
import { ControlStates } from './ControlStates';
import { Furniture, TypeVoices } from './FurnitureTypeVoices';
import { ReaderStates } from './ReaderStates';
import { SpacingMotion } from './SpacingMotion';

import type { ReactNode } from 'react';

/** The whole board, with the theme switch on top so both schemes can be inspected. */
export function DesignSystemBoard(): ReactNode {
  const { choice, setChoice } = useTheme();
  return (
    <main className="ds-board">
      <header className="ds-header">
        <div>
          <p className="ds-label">PaperTree v0.2 · developer page</p>
          <h1 className="ds-h1">
            <SproutMark size={48} /> Design system
          </h1>
          <p className="ds-lede">
            Two schemes, daylight and lamp-lit study. Every pair is measured from the live tokens.
          </p>
        </div>
        <ThemeSwitch value={choice} onChange={setChoice} />
      </header>
      <ColourRoles />
      <Furniture />
      <TypeVoices />
      <SpacingMotion />
      <section className="ds-section" aria-labelledby="ds-components">
        <h2 id="ds-components" className="ds-h2">
          Components
        </h2>
        <p className="ds-lede">
          Core controls in their states, then the reader parts. Switch the scheme above to see both.
        </p>
        <ControlStates />
        <ReaderStates />
      </section>
    </main>
  );
}
