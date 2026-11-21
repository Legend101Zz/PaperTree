/** A full-page designed state for a paper that cannot be opened (or is still being read). */
export function ReaderState({
  title,
  body,
  action,
  busy = false,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: React.ReactNode;
  readonly busy?: boolean;
}) {
  return (
    <div className="pt-reader">
      <div className="pt-state" role={busy ? 'status' : 'alert'} aria-live="polite">
        <h1 className="pt-state__title">{title}</h1>
        <p className="pt-state__body">{body}</p>
        {action}
      </div>
    </div>
  );
}
