/**
 * MapPlan: the drawn plan of the Map view (#198, frame 01e), one SVG laid out by `layoutMap`:
 * hatched topic islands with their double rule, a dashed Unshelved, a cartouche over each, the
 * papers as small spines with their short titles (a ribbon while reading, kraft while we read it,
 * "could not read" in red), and the citation links as dotted lines with an arrowhead at the cited
 * paper and a paper tag saying how they matched. A picture with a name: `MapList` is its words.
 */
'use client';

import { useId } from 'react';

import { MAP_CHAR, mapPlanName, type MapLinksState, type MapPoint } from '../model/map';
import { clothFor, isReadingNow, spineState } from '../model/shelf';

import type { MapIsland, MapLayout, MapLink, MapToken } from '../model/map';
import type { ShelfPaper } from '../model/shelf';
import type { ReactNode } from 'react';

/** Props for `MapPlan`. */
export interface MapPlanProps {
  readonly layout: MapLayout;
  readonly links: readonly MapLink[];
  readonly matches: ReadonlySet<string> | null;
  /** Whether the links have been read: the plan's name never claims "0 links" it does not know. */
  readonly linksState: MapLinksState;
}

/** One paper on the plan. */
function Token({
  paper,
  token,
  match,
}: {
  readonly paper: ShelfPaper;
  readonly token: MapToken;
  readonly match: boolean | undefined;
}): ReactNode {
  const state = spineState(paper);
  const kraft = state === 'queued' || state === 'parsing';
  const end =
    17 + MAP_CHAR * (token.label.length + (token.note === null ? 0 : token.note.length + 3));
  return (
    <g
      className="pt-map__token"
      transform={`translate(${token.x.toFixed(1)} ${token.y.toFixed(1)})`}
      data-paper-id={paper.id}
      data-match={match === undefined ? undefined : String(match)}
    >
      <title>{paper.title}</title>
      {match === true ? (
        <rect className="pt-map__lit" x={-4} y={-15} width={end + 8} height={30} rx={2} />
      ) : null}
      <rect
        className="pt-map__spine"
        x={0}
        y={-12}
        width={9}
        height={24}
        rx={1}
        style={{ fill: kraft ? 'var(--pt-kraft)' : `var(--pt-cloth-${clothFor(paper)})` }}
      />
      <text className="pt-map__label" x={17} y={5}>
        {token.label}
        {token.note === null ? null : (
          <tspan
            className={
              token.note === 'could not read'
                ? 'pt-map__state pt-map__state--failed'
                : 'pt-map__state'
            }
          >
            {` · ${token.note}`}
          </tspan>
        )}
      </text>
      {isReadingNow(paper) ? (
        <path className="pt-map__ribbon" d={`M${end + 6} -7h7v13l-3.5-3-3.5 3z`} />
      ) : null}
    </g>
  );
}

/** An island: its circle, its cartouche, its papers and "+n more". */
function Island({
  island,
  hatch,
  matches,
}: {
  readonly island: MapIsland;
  readonly hatch: string;
  readonly matches: ReadonlySet<string> | null;
}): ReactNode {
  const { group, cx, cy, r } = island;
  const { x, y: top, w, name, meta } = island.cart;
  const middle = x + w / 2;
  return (
    <g className={`pt-map__island pt-map__island--${group.kind}`} data-group={group.key}>
      <circle
        className="pt-map__isle"
        cx={cx}
        cy={cy}
        r={r}
        style={group.kind === 'topic' ? { fill: hatch } : undefined}
      />
      <circle className="pt-map__ring" cx={cx} cy={cy} r={r - 6} />
      <g className="pt-map__cartouche">
        {/* The full name and line, for a pointer; a cut one is whole in the list too. */}
        <title>{`${group.label} · ${group.meta}`}</title>
        <rect className="pt-map__cart" x={x} y={top} width={w} height={44} />
        <rect className="pt-map__cart-rule" x={x + 3} y={top + 3} width={w - 6} height={38} />
        <text className="pt-map__cart-name" x={middle} y={top + 20} textAnchor="middle">
          {name}
        </text>
        <text className="pt-map__cart-meta" x={middle} y={top + 35} textAnchor="middle">
          {meta}
        </text>
      </g>
      {island.tokens.map((token, index) => {
        const paper = group.papers[index];
        return paper === undefined ? null : (
          <Token
            key={token.id}
            paper={paper}
            token={token}
            match={matches === null ? undefined : matches.has(paper.id)}
          />
        );
      })}
      {island.more === null ? null : (
        <text className="pt-map__more" x={island.more.x} y={island.more.y + 5}>
          +{island.hidden} more
        </text>
      )}
    </g>
  );
}

/** A link's paper tag, in two lines ("cites it" / "matched by title"), so it covers less. */
function LinkTag({
  at,
  w,
  label,
}: {
  readonly at: MapPoint;
  readonly w: number;
  readonly label: string;
}): ReactNode {
  return (
    <>
      <rect className="pt-map__tag" x={at.x - w / 2} y={at.y - 17} width={w} height={34} rx={2} />
      <text className="pt-map__tag-text" x={at.x} y={at.y - 3} textAnchor="middle">
        {label.split(' · ').map((line, index) => (
          <tspan key={line} x={at.x} dy={index === 0 ? 0 : 14}>
            {line}
          </tspan>
        ))}
      </text>
    </>
  );
}

/**
 * The plan.
 *
 * @example
 * <MapPlan layout={layoutMap(groups, 1216)} links={mapLinks(layout, links)} matches={null} linksState="ready" />
 */
export function MapPlan({ layout, links, matches, linksState }: MapPlanProps): ReactNode {
  const id = useId().replace(/:/g, '');
  const name = mapPlanName(layout, links.length, linksState);
  return (
    <svg
      className="pt-map__plan"
      role="img"
      aria-label={name}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
    >
      <defs>
        <pattern
          id={`${id}-hatch`}
          width={7}
          height={7}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line className="pt-map__hatch" x1={0} y1={0} x2={0} y2={7} />
        </pattern>
        <marker
          id={`${id}-arrow`}
          viewBox="0 0 8 8"
          refX={7}
          refY={4}
          markerWidth={7}
          markerHeight={7}
          orient="auto"
        >
          <path className="pt-map__arrowhead" d="M0 0L8 4L0 8z" />
        </marker>
      </defs>
      {layout.islands.map((island) => (
        <Island
          key={island.group.key}
          island={island}
          hatch={`url(#${id}-hatch)`}
          matches={matches}
        />
      ))}
      {links.map((drawn) => (
        <g
          key={`${drawn.link.from_paper_id}>${drawn.link.to_paper_id}`}
          className="pt-map__link"
          data-matched-by={drawn.link.matched_by}
          data-tagged={String(drawn.tag !== null)}
        >
          <title>{drawn.label}</title>
          <path d={drawn.d} markerEnd={`url(#${id}-arrow)`} />
          {drawn.tag === null ? null : (
            <LinkTag at={drawn.tag} w={drawn.tagWidth} label={drawn.label} />
          )}
        </g>
      ))}
    </svg>
  );
}
