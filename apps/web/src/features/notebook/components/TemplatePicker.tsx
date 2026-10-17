'use client';

/**
 * The side panel's "Paper" picker (S5c, #208, frame 05): the five templates as tiles, each a small
 * swatch of its paper (notebook.css), the current one marked "in use". Native radio buttons, so
 * arrow keys, Tab and the screen reader's "1 of 5" come from the browser.
 */
import type { PageTemplate } from '../model/page';
import type { ReactNode } from 'react';

/** Props for `TemplatePicker`. */
export interface TemplatePickerProps {
  readonly value: PageTemplate;
  readonly onChange: (template: PageTemplate) => void;
}

/** The five templates in the order of frame 05, with their names. */
export const TEMPLATES: readonly { readonly id: PageTemplate; readonly name: string }[] = [
  { id: 'blank', name: 'Blank' },
  { id: 'dot', name: 'Dot grid' },
  { id: 'lined', name: 'Lined' },
  { id: 'cornell', name: 'Cornell' },
  { id: 'derivation', name: 'Derivation grid' },
];

/** The template tiles. */
export function TemplatePicker({ value, onChange }: TemplatePickerProps): ReactNode {
  return (
    <fieldset className="pt-nb-templates">
      <legend className="pt-sr-only">Page template</legend>
      {TEMPLATES.map((t) => (
        <label key={t.id} className="pt-nb-templates__tile" data-checked={t.id === value}>
          <input
            type="radio"
            name="pt-nb-template"
            value={t.id}
            checked={t.id === value}
            onChange={() => onChange(t.id)}
          />
          <span className="pt-nb-templates__swatch" data-template={t.id} aria-hidden="true" />
          <span className="pt-nb-templates__name">
            {t.name}
            {t.id === value ? <span className="pt-nb-templates__in-use">in use</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
