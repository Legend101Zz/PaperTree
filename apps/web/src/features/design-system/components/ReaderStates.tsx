/**
 * The reader-side components in their states: CallSlip, NumberedMarker and PageTab (cited, lit,
 * not verified), AiSlip with a margin cell and an uncited block, TraceList with a lit row,
 * CoverageReadout, ReadingNowRow, LabelHolder and SproutMark. Sample words are quotes from
 * "Attention Is All You Need" (CONTENT.md) or obvious placeholders.
 */
'use client';

import {
  AiParagraph,
  AiSlip,
  CallSlip,
  CoverageReadout,
  LabelHolder,
  NumberedMarker,
  PageTab,
  ReadingNowRow,
  SproutMark,
  TraceList,
  type SproutSize,
  type TraceRowData,
} from '@papertree/ui';
import { ArrowRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

const SPROUTS: readonly SproutSize[] = [16, 20, 24, 48];
const ROWS: readonly TraceRowData[] = [
  {
    n: 1,
    page: 1,
    para: 1,
    where: 'Abstract',
    citedCount: 5,
    status: 'cited',
    quote:
      'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.',
  },
  {
    n: 2,
    page: 2,
    para: 2,
    where: 'Introduction',
    citedCount: 1,
    status: 'cited',
    quote:
      'Recurrent models typically factor computation along the symbol positions of the input and output sequences. Aligning the positions to steps in computation time, they generate a sequence…',
  },
];

function noop(): void {}

/** The reader-side half of the Components section. */
export function ReaderStates(): ReactNode {
  const [lit, setLit] = useState<number | null>(2);
  return (
    <>
      <div className="ds-row">
        <h3 className="ds-label">Call slip</h3>
        <CallSlip
          quote={{
            text: 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.',
            page: 1,
            para: 1,
          }}
          ask="Explain this passage"
          time="2:14 pm"
        />
      </div>
      <div className="ds-row">
        <h3 className="ds-label">Marker + margin tab</h3>
        <div className="ds-cells ds-cells--inline">
          <Cell2 caption="default">
            <NumberedMarker n={2} label="p. 2 ¶2" onFlash={noop} />
            <PageTab page={2} para={2} />
          </Cell2>
          <Cell2 caption="lit (hover or focus)">
            <NumberedMarker n={2} label="p. 2 ¶2" lit onFlash={noop} />
            <PageTab page={2} para={2} lit />
          </Cell2>
          <Cell2 caption="not verified · dashed tab">
            <NumberedMarker n={6} label="p. 10" notVerified onFlash={noop} />
            <PageTab page={10} status="not-verified" />
          </Cell2>
          <Cell2 caption="touch · 44 px target">
            <NumberedMarker n={3} label="p. 4 ¶1" size="touch" onFlash={noop} />
          </Cell2>
        </div>
      </div>
      <div className="ds-row">
        <h3 className="ds-label">AI slip with margin cells and an uncited block</h3>
        <AiSlip
          model="placeholder model"
          source="from the paper"
          headingLevel={3}
          uncited={
            <p>Placeholder text: a paragraph of the model’s own reading, with no citation.</p>
          }
          footer={<span className="ds-caption">4,776 tokens · ≈ $0.0027 (estimate)</span>}
        >
          <AiParagraph
            aside={
              <>
                <NumberedMarker n={1} label="p. 1 ¶1" onFlash={noop} />
                <PageTab page={1} para={1} />
              </>
            }
          >
            Placeholder text: the passage states the paper’s central proposal.
          </AiParagraph>
          <AiParagraph>
            Placeholder text: a paragraph with no margin cell keeps the grid.
          </AiParagraph>
        </AiSlip>
      </div>
      <div className="ds-row">
        <h3 className="ds-label">Trace list · lit row (hover or focus lights one)</h3>
        <TraceList rows={ROWS} lit={lit} onLight={setLit} onShowInPaper={noop} />
      </div>
      <div className="ds-row">
        <h3 className="ds-label">Coverage readout</h3>
        <CoverageReadout passages={4} citations={11} uncitedParagraphs={1} />
      </div>
      <div className="ds-row">
        <h3 className="ds-label">Reading now</h3>
        <ReadingNowRow
          title="Attention Is All You Need"
          page={4}
          pageCount={15}
          onContinue={noop}
          arrow={<ArrowRight size={16} />}
        />
      </div>
      <div className="ds-row">
        <h3 className="ds-label">Shelf label holder</h3>
        <div className="ds-cells ds-cells--inline">
          <LabelHolder name="Transformers & attention" count={7} onSelect={noop} />
          <LabelHolder name="Optimization" count={3} onSelect={noop} selected />
        </div>
      </div>
      <div className="ds-row">
        <h3 className="ds-label">Sprout mark</h3>
        <div className="ds-cells ds-cells--inline">
          {SPROUTS.map((s) => (
            <Cell2 key={s} caption={`${String(s)} px`}>
              <SproutMark size={s} />
            </Cell2>
          ))}
        </div>
      </div>
    </>
  );
}

/** Inline cell: items side by side over a caption. */
function Cell2({
  caption,
  children,
}: {
  readonly caption: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="ds-cell">
      <div className="ds-cell__items">{children}</div>
      <span className="ds-caption">{caption}</span>
    </div>
  );
}
