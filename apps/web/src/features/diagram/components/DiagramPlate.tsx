'use client';

/**
 * One diagram answer on screen (frames 07a–07c): the standing AI tab with the working line and Stop
 * while it draws (the model line once done), then the engraved plate: "PLATE 1" and its title, the
 * drawing beside its key, and the readout. Before the first part it is the dashed empty plate; a
 * plate that ended with no part draws nothing (the exchange says why). Parts never move as they
 * arrive: the layout is the slot grid's (`model/layout`).
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { StopButton, type FocusHandoff } from '@/features/explain/components/AnswerParts';
import { WorkingLabel } from '@/features/explain/components/AnswerStates';
import { shortModelName } from '@/features/explain/model/summary';

import { layoutPlate } from '../model/layout';
import { EMPTY_PLATE, passageKey, platePhase, plateReadout } from '../model/plate';
import { PlateDrawing } from './PlateDrawing';
import { PlateKey } from './PlateKey';

import './plate.css';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { DiagramPart } from '@/lib/api/types';

/** Props for `DiagramPlate`. */
export interface DiagramPlateProps {
  readonly answer: ViewMessage;
  /** 1-based among the plates the thread drew (a Redraw is Plate 2); null for one never drawn. */
  readonly plateNo: number | null;
  /** The thread's passage numbers (`numberPlatePassages`). */
  readonly numbers: ReadonlyMap<string, number>;
  /** Stop → Retry: the exchange's focus hand-off (S4d's, so Stop never drops focus). */
  readonly handoff: FocusHandoff;
  readonly onStop: () => void;
  /** A part was tapped (in the drawing or its key row). */
  readonly onPart: (part: DiagramPart, n: number | null) => void;
}

const plateName = (n: number | null): string => (n === null ? 'Plate' : `Plate ${String(n)}`);

function EmptyPlate({ plateNo }: { plateNo: number | null }): ReactNode {
  return (
    <div className="pt-plate pt-plate--empty" data-plate-empty>
      <p className="pt-plate__no">{plateName(plateNo)}</p>
      <p>The plate is drawn here part by part, each part with the passage it stands on.</p>
    </div>
  );
}

/** The AI's plate and the interface's lines around it. */
export function DiagramPlate({
  answer,
  plateNo,
  numbers,
  handoff,
  onStop,
  onPart,
}: DiagramPlateProps): ReactNode {
  const plate = answer.diagram ?? EMPTY_PLATE;
  const phase = platePhase(answer, plate);
  const live = phase === 'thinking' || phase === 'drawing';
  const [lit, setLit] = useState<string | null>(null);
  const layout = useMemo(
    () => layoutPlate(plate.parts, plate.links, phase === 'drawing'),
    [plate.parts, plate.links, phase],
  );
  const byLetter = useMemo(() => new Map(plate.parts.map((p) => [p.letter, p])), [plate.parts]);
  const numberOf = useCallback(
    (part: DiagramPart): number | null => {
      const key = passageKey(part.cite);
      return key === null ? null : (numbers.get(key) ?? null);
    },
    [numbers],
  );
  const tap = useCallback(
    (letter: string) => {
      const part = byLetter.get(letter);
      if (part === undefined) return;
      setLit(letter);
      onPart(part, numberOf(part));
    },
    [byLetter, numberOf, onPart],
  );
  const readout = plateReadout(plate.parts, live);
  const title = plate.title ?? 'Untitled diagram';
  const name = shortModelName(answer.usage?.model);
  // No part and no longer drawing: there is no plate to show (no AI tab, no model line, B2); the
  // notes under it say what happened.
  if (!live && plate.parts.length === 0) return null;

  return (
    <article
      className="pt-plate-answer"
      data-plate-phase={phase}
      aria-label={`${plateName(plateNo)} from the AI`}
    >
      {live ? <StopButton handoff={handoff} onStop={onStop} /> : null}
      <span className="pt-ai-tab">AI</span>
      <p className="pt-plate-answer__line">
        {live ? (
          <WorkingLabel label={phase === 'thinking' ? 'Thinking' : 'Drawing the diagram'} />
        ) : phase === 'stopped' ? (
          // The model is known only once usage arrives; a plate stopped before that says Stopped.
          answer.usage === null ? (
            'Stopped'
          ) : (
            `Stopped · ${name}`
          )
        ) : (
          `${name} · from the paper`
        )}
      </p>
      {phase === 'thinking' ? <EmptyPlate plateNo={plateNo} /> : null}
      {phase === 'thinking' ? null : (
        <div
          className="pt-plate"
          role="group"
          aria-label={`${plateName(plateNo)}, ${title}${readout === null ? '' : `: ${readout}`}`}
        >
          <header className="pt-plate__head">
            <p className="pt-plate__no">{plateName(plateNo)}</p>
            <h3 className="pt-plate__title" data-voice="ai">
              {title}
            </h3>
          </header>
          <div className="pt-plate__body">
            <div className="pt-plate__figure" data-voice="ai">
              <PlateDrawing
                layout={layout}
                parts={byLetter}
                numberOf={numberOf}
                lit={lit}
                onPart={tap}
              />
            </div>
            <PlateKey
              parts={plate.parts}
              gaps={layout.gaps}
              ghost={layout.ghost?.letter ?? null}
              numberOf={numberOf}
              routes={layout.routes}
              lit={lit}
              onLight={setLit}
              onPart={tap}
            />
          </div>
          {readout === null ? null : (
            <p className="pt-plate__readout" data-plate-readout>
              {readout}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
