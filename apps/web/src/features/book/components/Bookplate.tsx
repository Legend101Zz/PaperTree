/**
 * Bookplate: the left page of the opened book (#200, frame 02). The Ex libris plate on patterned
 * endpaper: the sprout, EX LIBRIS, "From the library of <name>", the topic, the arXiv id and
 * "PaperTree · shelved 15 Oct 2026". The name is the one the person chose (`display_name`); until
 * there is one the plate asks once, inline, "Whose library is this?", and after "Not now" it leaves
 * the line out. It never makes a name up from the email (GAP-A1 D5).
 */
'use client';

import { Button, SproutMark, TextField, YouText } from '@papertree/ui';
import { useState, type FormEvent, type ReactNode } from 'react';

import { bookplateOwner, shelvedLine } from '../model/book';

import type { BookPaper } from '../model/types';

/** Props for `Bookplate`. */
export interface BookplateProps {
  readonly book: BookPaper;
  /** The topic's cloth, for the little swatch beside its name. */
  readonly cloth: string;
  /** `GET /auth/me`'s name; undefined while it loads (nothing is asked until it has). */
  readonly displayName: string | null | undefined;
  /** The person said "Not now" before, in this browser. */
  readonly declined: boolean;
  /** Saves the name (`PATCH /auth/me`); rejects with the server's refusal. */
  readonly onSaveName: (name: string) => Promise<unknown>;
  readonly onDecline: () => void;
}

/** "Whose library is this?": one field, Save, Not now. */
function NameAsk({
  onSave,
  onDecline,
}: {
  readonly onSave: (name: string) => Promise<unknown>;
  readonly onDecline: () => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > 60) {
      setError('A name of 1 to 60 characters, please.');
      return;
    }
    setBusy(true);
    onSave(trimmed).then(
      () => setBusy(false),
      () => {
        setBusy(false);
        setError('Not saved; your text is kept.');
      },
    );
  };
  return (
    <form className="pt-bookplate__ask" onSubmit={submit} aria-label="Name this library">
      <TextField
        label="Whose library is this?"
        voice="you"
        value={name}
        maxLength={60}
        autoComplete="name"
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        {...(error === null ? {} : { error })}
      />
      <div className="pt-bookplate__ask-actions">
        <Button type="submit" size="touch" disabled={busy}>
          Save
        </Button>
        <Button variant="ghost" size="touch" onClick={onDecline}>
          Not now
        </Button>
      </div>
    </form>
  );
}

/**
 * The bookplate.
 *
 * @example
 * <Bookplate book={book} cloth="transformers" displayName="Mrigesh" declined={false}
 *   onSaveName={save} onDecline={decline} />
 */
export function Bookplate({
  book,
  cloth,
  displayName,
  declined,
  onSaveName,
  onDecline,
}: BookplateProps): ReactNode {
  const owner = displayName === undefined ? null : bookplateOwner(displayName, declined);
  return (
    <div className="pt-bookplate" data-bookplate="">
      <div className="pt-bookplate__rules">
        <SproutMark size={48} className="pt-bookplate__sprout" />
        <p className="pt-bookplate__exlibris">ex libris</p>
        {owner?.kind === 'name' ? (
          <>
            <p className="pt-bookplate__from">From the library of</p>
            <YouText as="p" className="pt-bookplate__name">
              {owner.name}
            </YouText>
          </>
        ) : null}
        {owner?.kind === 'ask' ? <NameAsk onSave={onSaveName} onDecline={onDecline} /> : null}
        <span className="pt-bookplate__orn" aria-hidden="true">
          <span />
          <i />
          <span />
        </span>
        <div className="pt-bookplate__foot">
          {book.topic === null || book.topic === undefined ? null : (
            <span className="pt-bookplate__topic">
              <span
                className="pt-book__swatch"
                style={{ backgroundColor: `var(--pt-cloth-${cloth})` }}
                aria-hidden="true"
              />
              {book.topic.name}
            </span>
          )}
          {book.arxivId === null ? null : (
            <span className="pt-bookplate__id">{`arXiv ${book.arxivId}`}</span>
          )}
          <span className="pt-bookplate__shelved">{shelvedLine(book.addedAt)}</span>
        </div>
      </div>
    </div>
  );
}
