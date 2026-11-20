import { useMemo } from 'react';

import { usePdfDocument } from '@/components/reader/PdfDocumentProvider';
import { UnanchoredTray } from '@/components/reader/UnanchoredTray';

import { useNavigatorHighlights } from '../hooks/useNavigatorHighlights';
import { DocumentSlot } from './DocumentSlot';
import { NavigatorSlot } from './NavigatorSlot';
import { useExplainToggle } from './ReaderActionsMount';
import { ReaderHeader, type BoardBesideToggle } from './ReaderHeader';
import { useImageTool } from '../hooks/useImageTool';

import type { ViewProps } from './viewProps';

/**
 * The view half of the workspace: the header, the banners, Contents, the document and the tray.
 * It owns no reading state; it only turns what the workspace passes into each region's props.
 */
export function ReaderWorkspaceView(props: ViewProps) {
  const { doc, mode } = props;
  const paper = props.paper;

  const title =
    doc?.blocks.find((block) => block.type === 'title')?.text.replace(/\n/g, ' ') ??
    (paper.kind === 'api' ? 'Opening the paper…' : paper.slug);

  const explain = useExplainToggle();
  const imageTool = useImageTool();
  const toggleBeside = props.beside.toggle;
  const besideToggle = useMemo<BoardBesideToggle>(
    () => ({ open: props.beside.open, onToggle: toggleBeside }),
    [props.beside.open, toggleBeside],
  );
  const { numPages } = usePdfDocument();
  const pageCount = (numPages ?? 0) > 0 ? numPages : (doc?.pages.length ?? null);

  const { painted, unplaced, navigatorHighlights } = useNavigatorHighlights(
    doc,
    props.highlights.highlights,
  );

  return (
    <div className="pt-reader" data-reader-mode={mode}>
      <ReaderHeader
        title={title}
        page={props.page}
        pageCount={pageCount}
        mode={mode}
        onModeChange={props.onModeChange}
        guidedAvailable={doc !== null}
        zoom={props.zoom}
        zoomMode={props.zoomMode}
        onZoomChange={props.onZoomChange}
        navigatorOpen={props.navigatorOpen}
        navigatorAvailable={doc !== null}
        onNavigatorToggle={props.onNavigatorToggle}
        highlightCount={props.highlights.highlights.length}
        boardHref={
          props.paper.kind === 'api'
            ? `/paper/${encodeURIComponent(props.paper.paperId)}/board`
            : null
        }
        explain={explain}
        boardBeside={props.onOpenBoard === undefined ? null : besideToggle}
        imageTool={doc === null || paper.kind !== 'api' ? null : imageTool}
      />

      {props.stillReading ? (
        <p className="pt-banner" role="status">
          This paper is still being read. You can read the PDF now; highlights, Guided and Split
          arrive when it is ready.
        </p>
      ) : null}
      {props.highlights.load === 'error' && props.highlights.loadError !== null ? (
        <div className="pt-banner" role="alert">
          <span className="flex-1">{props.highlights.loadError}</span>
          <button
            type="button"
            className="pt-btn pt-btn--outline"
            onClick={props.highlights.reload}
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {props.navigatorOpen && doc !== null ? (
          <aside className="pt-drawer" aria-label="Contents">
            <NavigatorSlot
              doc={doc}
              highlights={navigatorHighlights}
              onShowSource={props.onShowSource}
              onJumpToPage={props.onJumpToPage}
              onSelectHighlight={props.onFocusHighlight}
              onEditHighlight={(id) => props.onActivateHighlight(id, null)}
              onClose={props.onNavigatorToggle}
            />
          </aside>
        ) : null}

        <main className="min-w-0 flex-1 overflow-hidden" aria-label="Document">
          <DocumentSlot {...props} />
        </main>
      </div>

      {doc === null || unplaced.length === 0 ? null : (
        <UnanchoredTray
          items={unplaced.map((item) => ({
            ...item,
            placedElsewhere: new Set(
              painted.filter((p) => p.highlightId === item.highlightId).map((p) => p.key),
            ).size,
          }))}
          sourceHash={doc.sourceHash}
          onJumpToPage={(pageIndex) => props.onJumpToPage(pageIndex)}
          onForget={(anchorId) => {
            const owner = unplaced.find((u) => u.anchor.id === anchorId);
            if (owner !== undefined) void props.highlights.remove(owner.highlightId);
          }}
        />
      )}
    </div>
  );
}
