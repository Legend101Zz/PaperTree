/**
 * explain — moved to `features/explain` (#202): the panel draws each thread as exchanges (ask →
 * answer → trace). This module keeps the import path `ReaderWorkspace` and the specs use; the
 * controller (`useExplainActions`) lives in `features/explain/hooks`.
 */
export {
  ExplainPanel,
  useExplainActions,
  type ExplainController,
  type ExplainPanelProps,
  type ExplainRequest,
} from '@/features/explain';
