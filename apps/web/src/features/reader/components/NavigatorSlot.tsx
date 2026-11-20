import { useMemo } from 'react';

import { Navigator, type NavigatorHighlight } from '@/components/reader/Navigator';
import { PageThumbnail } from '@/components/reader/PageThumbnail';
import { usePdfDocument } from '@/components/reader/PdfDocumentProvider';

import type { IndexedDocument } from '@papertree/anchoring';

/** The Contents drawer: the Navigator over the pdf.js page sizes (the parse's, until the PDF opens). */
export function NavigatorSlot(props: {
  doc: IndexedDocument;
  highlights: readonly NavigatorHighlight[];
  onShowSource: (blockIds: readonly string[]) => void;
  onJumpToPage: (pageIndex: number) => void;
  onSelectHighlight: (highlightId: string) => void;
  onEditHighlight: (highlightId: string) => void;
  onClose: () => void;
}) {
  const { numPages, pageMeta } = usePdfDocument();
  const pages = useMemo(() => {
    const out: { index: number; width: number; height: number }[] = [];
    const count = (numPages ?? 0) > 0 ? numPages : props.doc.pages.length;
    for (let index = 0; index < count; index += 1) {
      const meta = pageMeta?.get(index);
      const page = props.doc.pages.find((p) => p.index === index);
      out.push({
        index,
        width: meta?.width ?? page?.width ?? 612,
        height: meta?.height ?? page?.height ?? 792,
      });
    }
    return out;
  }, [numPages, pageMeta, props.doc]);
  return (
    <Navigator
      doc={props.doc}
      pages={pages}
      highlights={props.highlights}
      open
      onClose={props.onClose}
      layout="push"
      onNavigateToBlock={(blockId) => props.onShowSource([blockId])}
      onNavigateToPage={props.onJumpToPage}
      onSelectHighlight={props.onSelectHighlight}
      onEditHighlight={props.onEditHighlight}
      renderThumbnail={(pageIndex) => <PageThumbnail pageIndex={pageIndex} />}
    />
  );
}
