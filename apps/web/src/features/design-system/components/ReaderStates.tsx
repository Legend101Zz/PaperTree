/**
 * The reader-side components in their states: CallSlip, NumberedMarker and PageTab (default, lit,
 * touch), AiSlip with the quiet source line under each paragraph (SourceLine: pages, and General
 * knowledge), ReadingNowRow, LabelHolder and SproutMark. Sample words are quotes from
 * "Attention Is All You Need" (CONTENT.md) or obvious placeholders.
 */
'use client';

import {
  AiParagraph,
  AiSlip,
  CallSlip,
  LabelHolder,
  NumberedMarker,
  PageTab,
  ReadingNowRow,
  SourceLine,
  SproutMark,
  type SproutSize,
} from '@papertree/ui';
import { ArrowRight } from 'lucide-react';

import type { ReactNode } from 'react';

const SPROUTS: readonly SproutSize[] = [16, 20, 24, 48];

function noop(): void {}

/**
 * `inert` as the plain attribute `inert=""`: React 18 drops a boolean `inert`, so the value is a string
 * that the type pretends is a boolean.
 */
const INERT = { inert: '' } as unknown as { readonly inert: boolean };

/** The reader-side half of the Components section. */
export function ReaderStates(): ReactNode {
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
          <Cell2 caption="lit (hover or focus)" inert>
            <NumberedMarker n={2} label="p. 2 ¶2" lit onFlash={noop} />
            <PageTab page={2} para={2} lit />
          </Cell2>
          <Cell2 caption="touch · 44 px target" inert>
            <NumberedMarker n={3} label="p. 4 ¶1" size="touch" onFlash={noop} />
          </Cell2>
        </div>
      </div>
      <div className="ds-row">
        <h3 className="ds-label">AI slip with a quiet source line under each paragraph</h3>
        <AiSlip
          model="placeholder model"
          footer={<span className="ds-caption">4,776 tokens · ≈ $0.0027 (estimate)</span>}
        >
          <AiParagraph
            source={
              <SourceLine
                sources={[
                  {
                    page: 1,
                    passage: 'We propose a new simple network architecture, the Transformer.',
                    onShow: noop,
                  },
                  { page: 4, passage: 'Scaled Dot-Product Attention', onShow: noop },
                ]}
              />
            }
          >
            Placeholder text: the passage states the paper’s central proposal.
          </AiParagraph>
          <AiParagraph source={<SourceLine sources={[]} />}>
            Placeholder text: a paragraph from general knowledge says so in the same quiet line.
          </AiParagraph>
        </AiSlip>
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
          <span {...INERT}>
            <LabelHolder name="Optimization" count={3} onSelect={noop} selected />
          </span>
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
  inert = false,
  children,
}: {
  readonly caption: string;
  /** A pure illustration of a state: out of the tab order and the accessibility tree. */
  readonly inert?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="ds-cell" {...(inert ? INERT : {})}>
      <div className="ds-cell__items">{children}</div>
      <span className="ds-caption">{caption}</span>
    </div>
  );
}
