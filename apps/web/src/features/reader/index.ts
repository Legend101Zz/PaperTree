/**
 * The reader feature's chrome (#203): the header, its page counter, and (S4c2) the selection
 * toolbar's placement. Its public surface.
 */
export {
  ReaderHeader,
  type ExplainToggle,
  type ReaderHeaderProps,
} from './components/ReaderHeader';
export { PageCounter, type PageCounterProps } from './components/PageCounter';
export { counterPage, pageCounterLabel } from './model/pageCounter';
