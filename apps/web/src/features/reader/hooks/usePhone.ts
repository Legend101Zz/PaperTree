'use client';

/**
 * Whether the reader is on a phone: narrower than 768 px, where the explain panel is a bottom sheet
 * (`ExplainPanel`'s breakpoint) and the header folds its controls into a menu (#205, frame 08b).
 */
import { useEffect, useState } from 'react';

const WIDE = '(min-width: 768px)';

function narrowNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? !window.matchMedia(WIDE).matches
    : false;
}

/**
 * True below 768 px, kept in step with the window.
 *
 * @returns Whether the phone layout applies now.
 */
export function usePhone(): boolean {
  // Read at mount, not after a first desktop paint: the reader mounts on the client (AuthGuard).
  const [phone, setPhone] = useState(narrowNow);
  useEffect(() => {
    const list = window.matchMedia(WIDE);
    const update = (): void => setPhone(!list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, []);
  return phone;
}
