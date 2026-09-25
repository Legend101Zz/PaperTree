/**
 * canvas/sendToCanvas — the `sendToCanvas` half of `ReaderActions` (contracts.md §5).
 *
 * S0 STUB, owned by S7. It resolves, says so on the console, and makes NO request: a board is
 * created only by an explicit send that actually persists (ADR-002 §3.7), and a stub that half-
 * sent would create exactly the phantom board that rule exists to prevent. S7 replaces the body
 * with `boardsApi.createNode` behind the same signature.
 */
import type { SendToCanvasInput } from '@/components/reader/actions';

export async function sendToCanvas(paperId: string | null, input: SendToCanvasInput): Promise<void> {
  console.info(
    `[papertree] Send to canvas (${input.kind}) is not connected yet; nothing was sent` +
      (paperId === null ? '.' : ` for ${paperId}.`),
  );
}
