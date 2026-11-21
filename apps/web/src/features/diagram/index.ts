/**
 * The diagram feature: the engraved plate (#217). Its public surface: the exchange the explain
 * panel draws for a diagram thread, the plate model (events, readout)
 * and the slot-grid layout.
 */
export { DiagramExchange, type DiagramExchangeProps } from './components/DiagramExchange';
export { DiagramPlate, type DiagramPlateProps } from './components/DiagramPlate';
export { InlineDiagram, type InlineDiagramProps } from './components/InlineDiagram';
export { MermaidDiagram, type MermaidDiagramProps } from './components/MermaidDiagram';
export { parseDiagramFence, type InlineFigure } from './model/fence';
export { PlateMiniature, type PlateMiniatureProps } from './components/PlateMiniature';
export { layoutPlate, type PlateLayout } from './model/layout';
export {
  applyPlateEvent,
  EMPTY_PLATE,
  withNote,
  type PlateEvent,
  plateReadout,
  type PlateView,
} from './model/plate';
