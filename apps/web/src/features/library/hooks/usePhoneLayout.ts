/**
 * usePhoneLayout: whether the library draws its phone layout (#199, frame 08a): the viewport is at
 * most `PHONE_MAX_WIDTH` wide. Width only, unlike `useTouchTargets`: a tablet held sideways is a
 * finger but has room for the standing shelf, so it keeps the spines with 44 px chrome.
 */
'use client';

import { useEffect, useState } from 'react';

import { PHONE_QUERY } from '../model/phone';

/**
 * True at phone width, kept current; false on the server and before mount. The list loads after
 * mount, so the shelf is first drawn already knowing the width.
 *
 * @returns Whether to lay the library out for a phone.
 */
export function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(PHONE_QUERY);
    const apply = (): void => setPhone(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return phone;
}
