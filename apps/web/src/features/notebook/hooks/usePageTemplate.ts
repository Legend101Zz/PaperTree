'use client';

/**
 * usePageTemplate — the page's paper, switched from the side panel and saved with the page's
 * `version` (S5c, #208). Saves run one at a time and send the latest choice, so arrowing through
 * the five templates is never a race on `version`; a 409 is a conflict and a 404 a page deleted
 * elsewhere, and neither is retried. A failure stays failed until a save succeeds or the choice
 * goes back to the saved template, counts in the page's "Not saved" notice, and is sent again by
 * that notice's Try again (`retry`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api/types';

import { isStaleVersion, notebookApi } from '../api/notebookApi';

import type { NotebookPageWire } from '../api/notebookApi';
import type { PageTemplate } from '../model/page';

/** Where the template's saving stands, in the same terms as the items' `SaveStatus`. */
export interface TemplateSave {
  readonly conflict: boolean;
  /** True when the page was deleted somewhere else (the PATCH was a 404). */
  readonly pageGone: boolean;
  /** True while the latest choice failed to save. */
  readonly failed: boolean;
  /** Bumped by every failure, so a dismissed notice comes back for the next one. */
  readonly failure: number;
}

/** What `usePageTemplate` returns. */
export interface PageTemplateModel {
  /** The template on screen; null until the page has loaded. */
  readonly template: PageTemplate | null;
  readonly save: TemplateSave;
  /** True while the screen shows a template the server does not have. */
  readonly unsaved: boolean;
  readonly choose: (template: PageTemplate) => void;
  /** Send the latest choice again (after a failure). */
  readonly retry: () => void;
}

/**
 * The page's template, with saving.
 *
 * @param page - The page as loaded, or null while it loads.
 * @returns The current template, how saving stands, `choose` and `retry`.
 */
export function usePageTemplate(page: NotebookPageWire | null): PageTemplateModel {
  const [template, setTemplate] = useState<PageTemplate | null>(null);
  const [save, setSave] = useState<TemplateSave>({
    conflict: false,
    pageGone: false,
    failed: false,
    failure: 0,
  });
  const version = useRef<number | null>(null);
  const saved = useRef<PageTemplate | null>(null);
  const wanted = useRef<PageTemplate | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const stopped = useRef(false);
  const pageId = page?.page_id ?? null;

  useEffect(() => {
    if (page === null || version.current !== null) return;
    version.current = page.version;
    saved.current = page.template;
    wanted.current = page.template;
    setTemplate(page.template);
  }, [page]);

  const push = useCallback(async (id: string): Promise<void> => {
    const target = wanted.current;
    if (stopped.current || target === null) return;
    if (target === saved.current) {
      // Back to what the server has: nothing is owed, so an earlier failure is over too.
      setSave((s) => (s.failed ? { ...s, failed: false } : s));
      return;
    }
    try {
      const next = await notebookApi.patchPage(id, {
        version: version.current ?? 0,
        template: target,
      });
      version.current = next.version;
      saved.current = next.template;
      setSave((s) => ({ ...s, failed: false }));
    } catch (error) {
      if (isStaleVersion(error)) {
        stopped.current = true;
        setSave((s) => ({ ...s, conflict: true }));
      } else if (error instanceof ApiError && error.status === 404) {
        stopped.current = true;
        setSave((s) => ({ ...s, pageGone: true, failed: false }));
      } else {
        setSave((s) => ({ ...s, failed: true, failure: s.failure + 1 }));
      }
    }
  }, []);

  const send = useCallback(() => {
    if (pageId === null) return;
    chain.current = chain.current.then(() => push(pageId));
  }, [pageId, push]);

  const choose = useCallback(
    (next: PageTemplate) => {
      wanted.current = next;
      setTemplate(next);
      send();
    },
    [send],
  );

  return {
    template,
    save,
    unsaved: template !== null && template !== saved.current,
    choose,
    retry: send,
  };
}
