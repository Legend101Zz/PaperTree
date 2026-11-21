import { frameForPdfPage } from '@papertree/anchoring';

import type { TextLayerInfo } from './PdfPage';
import type { PageTextSource } from './useSelectionCapture';

/** One rendered page's pdf.js items and frame, in the shape the selection capture measures. */
export function pageTextSourceOf(info: TextLayerInfo, userUnit: number): PageTextSource {
  return {
    frame: frameForPdfPage({ view: info.page.view, rotate: info.page.rotate, userUnit }),
    items: info.items.map((item) => {
      const style = item.fontName === undefined ? undefined : info.styles[item.fontName];
      return {
        str: item.str,
        transform: item.transform,
        width: item.width,
        height: item.height,
        ...(item.hasEOL === undefined ? {} : { hasEOL: item.hasEOL }),
        ...(style?.ascent === undefined ? {} : { ascent: style.ascent }),
        ...(style?.descent === undefined ? {} : { descent: style.descent }),
        // The family the text layer sets this span in: the capture measures glyph advances in it.
        ...(typeof style?.fontFamily === 'string' && style.fontFamily !== ''
          ? { fontFamily: style.fontFamily }
          : {}),
      };
    }),
  };
}
