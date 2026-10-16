/**
 * The shared controls in their states: Button (variants x default / hover / focus / disabled),
 * ToolbarButton, SegmentedControl, TextField and Toast. Hover and focus are forced with
 * `data-state` (the stylesheet answers `[data-state='hover']` like `:hover`); the pressed state
 * (`:active`) cannot be held still, so it is not shown.
 */
'use client';

import {
  Button,
  SegmentedControl,
  TextField,
  Toast,
  ToolbarButton,
  type ButtonVariant,
} from '@papertree/ui';
import { ArrowRight, Layers } from 'lucide-react';
import { useState, type ReactNode } from 'react';

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'outline', 'danger', 'ghost'];
const LABELS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'Ask',
  secondary: 'To board',
  outline: 'Dive in',
  danger: 'Delete',
  ghost: 'Undo',
};
const STATES = ['default', 'hover', 'focus', 'disabled'] as const;

function noop(): void {}

/** A labelled cell of the states grid. */
function Cell({
  caption,
  children,
}: {
  readonly caption: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="ds-cell">
      {children}
      <span className="ds-caption">{caption}</span>
    </div>
  );
}

/** Buttons: every variant in every state the CSS can hold still. */
function ButtonGrid(): ReactNode {
  return (
    <>
      {VARIANTS.map((variant) => (
        <div key={variant} className="ds-row">
          <h3 className="ds-label">Button · {variant}</h3>
          <div className="ds-cells">
            {STATES.map((state) => (
              <Cell key={state} caption={state}>
                <Button
                  variant={variant}
                  disabled={state === 'disabled'}
                  data-state={state === 'hover' || state === 'focus' ? state : undefined}
                  leadingIcon={variant === 'secondary' ? <Layers size={16} /> : undefined}
                  trailingIcon={variant === 'outline' ? <ArrowRight size={16} /> : undefined}
                >
                  {LABELS[variant]}
                </Button>
              </Cell>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** The controls half of the Components section. */
export function ControlStates(): ReactNode {
  const [mode, setMode] = useState<'source' | 'guided' | 'split'>('guided');
  const [toast, setToast] = useState(true);
  return (
    <>
      <ButtonGrid />
      <div className="ds-row">
        <h3 className="ds-label">Toolbar button</h3>
        <div className="ds-cells">
          <Cell caption="default">
            <ToolbarButton label="Board" icon={<Layers size={16} />} />
          </Cell>
          <Cell caption="pressed">
            <ToolbarButton
              label="Board"
              icon={<Layers size={16} />}
              pressed
              onPressedChange={noop}
            />
          </Cell>
          <Cell caption="icon only · 44 touch">
            <ToolbarButton label="Board" icon={<Layers size={16} />} iconOnly size="touch" />
          </Cell>
          <Cell caption="disabled">
            <ToolbarButton label="Board" icon={<Layers size={16} />} disabled />
          </Cell>
        </div>
      </div>
      <div className="ds-row">
        <h3 className="ds-label">Text field</h3>
        <div className="ds-cells">
          <Cell caption="empty">
            <TextField label="Ask a follow-up" placeholder="Ask a follow-up" />
          </Cell>
          <Cell caption="focus · your words">
            <TextField
              label="Follow-up"
              voice="you"
              defaultValue="Why does it"
              data-state="focus"
            />
          </Cell>
          <Cell caption="error · text kept">
            <TextField label="Follow-up" voice="you" defaultValue="Explain p. 99" error />
          </Cell>
        </div>
      </div>
      <div className="ds-row">
        <h3 className="ds-label">Segmented control</h3>
        <div className="ds-cells">
          <Cell caption="selected: interactive">
            <SegmentedControl
              label="Reading mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'source', label: 'Source' },
                { value: 'guided', label: 'Guided' },
                { value: 'split', label: 'Split' },
              ]}
            />
          </Cell>
        </div>
      </div>
      <div className="ds-row">
        <h3 className="ds-label">Toast with Undo</h3>
        <div className="ds-cells">
          {toast ? (
            <Toast
              className="ds-toast"
              message="Highlight removed"
              duration={0}
              onUndo={() => {
                setToast(false);
              }}
              onDismiss={() => {
                setToast(false);
              }}
            />
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setToast(true);
              }}
            >
              Show the toast again
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
