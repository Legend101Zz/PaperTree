/**
 * The Source pane's two PDF failure states, each a designed sentence (the engine could not start,
 * or this file could not be read). Its own component so `SourcePane` keeps to the selection and
 * paint wiring.
 */
export function PdfErrorState({
  errorKind,
  reload,
}: {
  readonly errorKind: string | null;
  readonly reload: () => void;
}) {
  return (
    <div className="pt-state" role="alert">
      {errorKind === 'engine' ? (
        <>
          <h2 className="pt-state__title">The reader could not start its PDF engine</h2>
          <p className="pt-state__body">
            Reload the page; if it keeps happening, the server is missing a file.
          </p>
        </>
      ) : (
        <>
          <h2 className="pt-state__title">This PDF could not be opened</h2>
          <p className="pt-state__body">
            The file reached the reader, but it could not be read as a PDF. Trying again usually
            fixes a download that dropped part-way; if it keeps happening, the file itself may be
            damaged.
          </p>
        </>
      )}
      <button
        type="button"
        className="pt-btn pt-btn--outline"
        // pdf.js remembers a worker that failed to start for the life of the page, so re-running
        // the load in place would fail the same way; an engine failure needs a fresh page.
        onClick={errorKind === 'engine' ? () => window.location.reload() : reload}
      >
        Try again
      </button>
    </div>
  );
}
