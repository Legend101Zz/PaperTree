/**
 * The diagram feature: the engraved plate (#217). Its public surface: the exchange the explain
 * panel draws for a diagram thread, the plate model (events, verdicts, readout, passage numbers)
 * and the slot-grid layout.
 */
export { DiagramExchange, type DiagramExchangeProps } from './components/DiagramExchange';
export { DiagramPlate, type DiagramPlateProps } from './components/DiagramPlate';
export { layoutPlate, type PlateLayout } from './model/layout';
export {
  applyPlateEvent,
  EMPTY_PLATE,
  numberPlatePassages,
  withNote,
  type PlateEvent,
  plateReadout,
  verdictOf,
  type PlateView,
} from './model/plate';
