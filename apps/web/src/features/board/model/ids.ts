/**
 * board/model/ids — client-minted ids (contracts.md §0): `cn_` + uuid for nodes, `ce_` + uuid for edges.
 * A repeat send carries the same id, so the server answers with the node it already has.
 */
function uuid(): string {
  const cryptoObj = typeof globalThis === 'undefined' ? undefined : globalThis.crypto;
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // Plain http on a LAN device has no `randomUUID`; a v4-shaped id from `Math.random` is enough
  // for an id the server only needs to be unique.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r % 4) + 8).toString(16);
  });
}

/**
 * A new card id.
 *
 * @returns `cn_` + a uuid.
 */
export const newNodeId = (): string => `cn_${uuid()}`;
/**
 * A new link id.
 *
 * @returns `ce_` + a uuid.
 */
export const newEdgeId = (): string => `ce_${uuid()}`;
