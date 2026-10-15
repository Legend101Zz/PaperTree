// PLANTED FAILURE (CI track, #141): an invalid route segment config passes tsc and lint and
// breaks only `next build`. Reverted in the next commit.
export const dynamic = 'sometimes';

export default function Planted() {
  return <p>planted</p>;
}
