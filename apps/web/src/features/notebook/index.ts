/**
 * Public surface of the notebook feature: the S5b model (#207, pure TypeScript) and the S5c page
 * (#208): the screen, the page list, and the typed client over the notebook routes. The reader
 * imports `hooks/useFocusFromNotebook` directly, so it does not pull the page's styles in.
 */

export * from './model/page';
export * from './model/stroke';
export * from './model/outline';
export * from './model/hitTest';
export * from './model/history';

export { NotebookView } from './components/NotebookView';
export { NotebookPageList } from './components/NotebookPageList';
export { notebookApi, notebookKeys } from './api/notebookApi';
