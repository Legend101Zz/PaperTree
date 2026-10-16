/**
 * explain — moved to `features/explain` (#202): the panel draws each thread as exchanges (ask →
 * answer → trace). This module keeps the import path `ReaderWorkspace` and the specs use, and
 * still owns the controller (`useExplainActions`).
 */
export { ExplainPanel, type ExplainPanelProps } from '@/features/explain/components/ExplainPanel';

export type { ExplainController, ExplainRequest } from './useExplainActions';
export { useExplainActions } from './useExplainActions';
