'use client';

/**
 * reader/PageThumbnail — a page of the PDF itself, small, for the Navigator's Pages tab.
 *
 * Rendered by pdf.js from the ONE document the reader opened (it reads `usePdfDocument`, so it
 * opens nothing of its own), without a text layer, and only once it scrolls into view: a 55-page
 * paper does not raster 55 canvases because the tab was opened.
 */

import { useEffect, useRef, useState } from 'react';

import { PdfPage } from './PdfPage';
import { usePdfDocument } from './PdfDocumentProvider';

/** The thumbnail's CSS width. Two columns in a 340 px panel. */
export const THUMB_WIDTH = 140;

export function PageThumbnail({ pageIndex }: { readonly pageIndex: number }): JSX.Element {
  const { pageMeta } = usePdfDocument();
  const meta = pageMeta.get(pageIndex);
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null || visible) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  const zoom = meta === undefined ? 0 : THUMB_WIDTH / (meta.width * meta.userUnit);
  return (
    <span ref={ref} className="block h-full w-full" data-thumbnail-page={pageIndex}>
      {visible && meta !== undefined && zoom > 0 ? (
        <PdfPage pageIndex={pageIndex} zoom={zoom} textLayer={false} className="!shadow-none" />
      ) : null}
    </span>
  );
}
