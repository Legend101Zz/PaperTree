# S6b shots (#212): board cards, brass pins and the seven threads

Taken at 1440 × 900 (and 390 × 844) against the demo Attention board on a copy of the v0.2 data,
beside `reference/06-board-1440.png` (daylight) and `reference/09c-board-other.png` (lamp-lit).

| File | What |
| --- | --- |
| `06-board-cards-1440-light.png`, `-dark.png` | part 1: the six card kinds |
| `06-board-threads-1440-light.png`, `-dark.png` | part 2: pins, the seven threads, the legend |
| `06-board-drawing-a-thread-1440.png` | a thread being drawn: dashed navy, the open pin lit |
| `06-board-390-legend-light.png` | the phone, legend unfolded |

## Departures from the mock-up, on purpose

- **Brass pins have a rim.** The mock-up draws claim-out and answer-out as bare brass. The brass
  gradient's middle stop is 2.2:1 against daylight linen, and a pin is a control, so WCAG 1.4.11
  asks 3:1 for its outline. Each brass pin is edged in `--pt-pin-ring`, the token the open pins
  already use: 4.7:1 on daylight linen, 7.2:1 on the lamp-lit board
  (`packages/ui/test/tokens.spec.ts`, `apps/web/src/features/board/components/pins-contrast.spec.ts`).
- **Paper tags paint below the cards.** A tag sits above frames and below every card, so it never
  covers a card's words or buttons; where a card overlaps a thread's middle, the card wins.

## Still different from the frame (other slices, or no data yet)

- Header, toolbar, frames with paper tags, minimap: v0.1 until S6d (#214). The "Link as" picker:
  v0.1's dialog until S6c (#213).
- Passage tabs read `p. 2`, not `p. 2 ¶2`: an anchor carries no paragraph (a server-side locator,
  filed separately).
- The diagram card is an empty plate with its title until the diagrams land (S7).
- Real answers are longer than the mock-up's, so AI cards fade into "more".
