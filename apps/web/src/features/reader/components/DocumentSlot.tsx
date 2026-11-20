import { GuidedView } from '@/components/reader/GuidedView';
import { SourcePane } from '@/components/reader/SourcePane';
import { SplitView } from '@/components/reader/SplitView';

import type { IndexedDocument } from '@papertree/anchoring';
import type { Failure } from '../model/failure';
import type { ViewProps } from './viewProps';

function GuidedPane(props: ViewProps & { readonly doc: IndexedDocument }) {
  return (
    <GuidedView
      doc={props.doc}
      onShowSource={props.onShowSource}
      highlights={props.highlights.highlights}
      initialBlockId={props.initialBlockId}
      followBlockId={props.mode === 'split' ? props.followBlockId : null}
      onTopBlockChange={props.onGuidedTop}
      flashBlockId={props.guidedFlash}
      className="h-full"
    />
  );
}

function PdfUnavailable({
  failure,
  onRetry,
}: {
  readonly failure: Failure;
  readonly onRetry: () => void;
}) {
  const body =
    failure.kind === 'unreachable'
      ? 'The PDF could not be downloaded: PaperTree is not reachable. Check the connection, then try again.'
      : failure.kind === 'not_parsed'
        ? 'The PDF opens here as soon as PaperTree has finished reading it.'
        : 'The PDF could not be downloaded from PaperTree. Try again in a moment.';
  return (
    <div className="pt-state" role={failure.kind === 'not_parsed' ? 'status' : 'alert'}>
      <h2 className="pt-state__title">
        {failure.kind === 'not_parsed' ? 'The PDF is almost ready' : 'The PDF is not available'}
      </h2>
      <p className="pt-state__body">{body}</p>
      {failure.kind === 'not_parsed' ? null : (
        <button type="button" className="pt-btn pt-btn--outline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

function SourceSlot(props: ViewProps) {
  if (props.pdfFailure !== null)
    return <PdfUnavailable failure={props.pdfFailure} onRetry={props.onRetryPdf} />;
  return (
    <SourcePane
      doc={props.doc}
      zoom={props.zoom}
      highlights={props.highlights.highlights}
      onCreateHighlight={props.onCreateHighlight}
      onCreateNote={props.onCreateNote}
      onCreateAnchors={props.onCreateAnchors}
      onNoteAnchors={props.onNoteAnchors}
      {...(props.onOpenBoard === undefined ? {} : { onOpenBoard: props.onOpenBoard })}
      onVisiblePages={props.onVisiblePages}
      boardBeside={props.beside.open}
      highlightUnavailableReason={props.highlights.unavailableReason}
      onActivateHighlight={props.onActivateHighlight}
      activeHighlightId={props.activeHighlightId}
      flash={props.flash}
      narrow={props.narrow}
      sheetOpen={props.narrow && props.navigatorOpen}
      onViewportResize={props.onViewportResize}
      onSelectionChange={props.onSelectionChange}
      documentRef={props.documentRef}
      initialPosition={props.initialPosition}
      onPositionChange={props.onSourcePosition}
      onNotice={props.onNotice}
    />
  );
}

/** Source, Guided or Split, by mode: the one document region. */
export function DocumentSlot(props: ViewProps) {
  const doc = props.doc;
  if (props.mode === 'guided' && doc !== null) return <GuidedPane {...props} doc={doc} />;
  if (props.mode === 'split' && doc !== null) {
    return (
      <SplitView
        source={<SourceSlot {...props} />}
        guided={<GuidedPane {...props} doc={doc} />}
        className="h-full"
      />
    );
  }
  return <SourceSlot {...props} />;
}
