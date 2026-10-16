/**
 * Public surface of the notebook feature's model (S5b, #207). The UI (S5c, S5d) imports from here
 * only; everything below is pure TypeScript with no React, DOM or network.
 */

export * from './model/page';
export * from './model/stroke';
export * from './model/outline';
export * from './model/hitTest';
export * from './model/history';
