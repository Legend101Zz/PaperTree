'use client';

/**
 * usePageTemplate — the page's paper, switched from the side panel and saved with the page's
 * `version` (S5c, #208). Saves run one at a time and send the latest choice, so arrowing through
 * the five templates is never a race on `version`; a 409 is a conflict and is never retried.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { isStaleVersion, notebookApi } from '../api/notebookApi';

import type { NotebookPageWire } from '../api/notebookApi';
import type { PageTemplate } from '../model/page';

/** What `usePageTemplate` returns. */
export interface PageTemplateModel {
  /** The template on screen; null until the page has loaded. */
  readonly template: PageTemplate | null;
  readonly save: 'idle' | 'conflict' | 'failed';
  readonly choose: (template: PageTemplate) => void;
}

/**
 * The page's template, with saving.
 *
 * @param page - The page as loaded, or null while it loads.
 * @returns The current template, how saving stands, and `choose`.
 */
export function usePageTemplate(page: NotebookPageWire | null): PageTemplateModel {
  const [template, setTemplate] = useState<PageTemplate | null>(null);
  const [save, setSave] = useState<PageTemplateModel['save']>('idle');
  const version = useRef<number | null>(null);
  const saved = useRef<PageTemplate | null>(null);
  const wanted = useRef<PageTemplate | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const stopped = useRef(false);

  useEffect(() => {
    if (page === null || version.current !== null) return;
    version.current = page.version;
    saved.current = page.template;
    wanted.current = page.template;
    setTemplate(page.template);
  }, [page]);

  const push = useCallback(async (pageId: string): Promise<void> => {
    const target = wanted.current;
    if (stopped.current || target === null || target === saved.current) return;
    try {
      const next = await notebookApi.patchPage(pageId, {
        version: version.current ?? 0,
        template: target,
      });
      version.current = next.version;
      saved.current = next.template;
      setSave('idle');
    } catch (error) {
      if (isStaleVersion(error)) stopped.current = true;
      setSave(isStaleVersion(error) ? 'conflict' : 'failed');
    }
  }, []);

  const choose = useCallback(
    (next: PageTemplate) => {
      if (page === null) return;
      wanted.current = next;
      setTemplate(next);
      chain.current = chain.current.then(() => push(page.page_id));
    },
    [page, push],
  );

  return { template, save, choose };
}
