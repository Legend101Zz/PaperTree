/**
 * Behaviour of the v0.2 controls (#189): Button, ToolbarButton, TextField.
 *
 * A native `<button type="button">` is activated by Enter and Space by the browser, so the
 * keyboard assertion is that the element is one; happy-dom does not synthesise that click.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, NOT_SENT_MESSAGE, TextField, ToolbarButton } from '../src/index.js';
import type { ButtonVariant } from '../src/index.js';

afterEach(cleanup);

describe('Button', () => {
  const variants: ButtonVariant[] = ['primary', 'secondary', 'outline', 'danger', 'ghost'];

  it.each(variants)('%s is a named native button that clicks', (variant) => {
    const onClick = vi.fn();
    render(
      <Button variant={variant} onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain(`pt-button--${variant}`);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled sets aria-disabled, swallows clicks and stays focusable', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('md is 40 px and touch is 44 px, inline', () => {
    render(
      <>
        <Button>Desk</Button>
        <Button size="touch">Phone</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Desk' }).style.minHeight).toBe('40px');
    expect(screen.getByRole('button', { name: 'Phone' }).style.minHeight).toBe('44px');
  });

  it('hides icons from the accessible name', () => {
    render(<Button trailingIcon={<span>ARROWTEXT</span>}>Continue</Button>);
    // An icon with text content would pollute the name unless its wrapper is aria-hidden.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
});

describe('ToolbarButton', () => {
  it("a null icon draws no icon box: a text-only button (the reader header's Explain tab)", () => {
    render(<ToolbarButton label="Explain" icon={null} pressed={false} />);
    const button = screen.getByRole('button', { name: 'Explain' });
    expect(button.querySelector('.pt-toolbtn__icon')).toBeNull();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
  function Harness(): React.ReactNode {
    const [on, setOn] = useState(false);
    return <ToolbarButton label="Board" icon={<svg />} pressed={on} onPressedChange={setOn} />;
  }

  it('toggles aria-pressed', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Board' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('is not a toggle without pressed, and icon-only keeps its name and 44 px', () => {
    render(<ToolbarButton label="Fit all" icon={<svg />} iconOnly size="touch" />);
    const button = screen.getByRole('button', { name: 'Fit all' });
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    expect(button.style.minWidth).toBe('44px');
    expect(button.style.minHeight).toBe('44px');
  });
});

describe('TextField', () => {
  it('links the hint and the error with aria-describedby and keeps the value', () => {
    render(
      <TextField
        label="Ask"
        hint="Ask about this paper"
        error
        value="why is attention scaled?"
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('Ask') as HTMLInputElement;
    expect(input.value).toBe('why is attention scaled?');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0]!)?.textContent).toBe('Ask about this paper');
    expect(document.getElementById(ids[1]!)?.textContent).toBe(NOT_SENT_MESSAGE);
  });

  it('shows a custom error and marks the person voice on a textarea', () => {
    render(<TextField multiline voice="you" label="Follow-up" error="Too long" />);
    const area = screen.getByLabelText('Follow-up');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.getAttribute('data-voice')).toBe('you');
    expect(screen.getByRole('alert').textContent).toBe('Too long');
  });

  it('has no description and no invalid flag when there is nothing to say', () => {
    render(<TextField label="Title" />);
    const input = screen.getByLabelText('Title');
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });
});
