/** Raised when a value typed as `OwnerId` was not minted by this `PaperTreeDb` connection. */
export class OwnershipError extends Error {
  override readonly name = 'OwnershipError';
}

/** Raised when the migrations on disk disagree with what the database records. */
export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}
