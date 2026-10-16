'use client';

/**
 * One diagram answer on screen (frames 07a–07c): the standing AI tab with the working line and Stop
 * while it draws (the model line once done), then the engraved plate: "PLATE 1" and its title, the
 * drawing beside its key, and the readout. Before the first part it is the dashed empty plate; a
 * plate that ended with no part draws nothing (the exchange says why). Parts never move as they
 * arrive: the layout is the slot grid's (`model/layout`).
 */
import { Button } from '@papertree/ui';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { StatusLine } from '@/features/explain/components/AnswerStates';
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
  /** 1-based among the thread's plates: a Redraw is Plate 2. */
  readonly plateNo: number;
  /** The thread's passage numbers (`numberPlatePassages`). */
  readonly numbers: ReadonlyMap<string, number>;
  readonly onStop: () => void;
  /** A part was tapped (in the drawing or its key row). */
  readonly onPart: (part: DiagramPart, n: number | null) => void;
}

function EmptyPlate({ plateNo }: { plateNo: number }): ReactNode {
  return (
    <div className="pt-plate pt-plate--empty" data-plate-empty>
      <p className="pt-plate__no">Plate {plateNo}</p>
      <p>The plate is drawn here part by part, each part with the passage it stands on.</p>
    </div>
  );
}

/** The AI's plate and the interface's lines around it. */
export function DiagramPlate({
  answer,
  plateNo,
  numbers,
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

  return (
    <article
      className="pt-plate-answer"
      data-plate-phase={phase}
      aria-label={`Plate ${String(plateNo)} from the AI`}
    >
      <span className="pt-ai-tab">AI</span>
      {live ? (
        <>
          <div className="pt-plate-answer__line">
            <StatusLine label={phase === 'thinking' ? 'Thinking' : 'Drawing the diagram'} />
          </div>
          <Button
            className="pt-plate-answer__stop"
            leadingIcon={<span className="pt-plate-answer__stop-mark" />}
            onClick={onStop}
          >
            Stop
          </Button>
        </>
      ) : answer.usage === null ? null : (
        <p className="pt-plate-answer__line pt-plate-answer__source">
          {shortModelName(answer.usage.model)} · from the paper
        </p>
      )}
      {phase === 'thinking' ? <EmptyPlate plateNo={plateNo} /> : null}
      {phase === 'thinking' || phase === 'failed' ? null : (
        <div
          className="pt-plate"
          role="group"
          aria-label={`Plate ${String(plateNo)}, ${title}${readout === null ? '' : `: ${readout}`}`}
        >
          <header className="pt-plate__head">
            <p className="pt-plate__no">Plate {plateNo}</p>
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
