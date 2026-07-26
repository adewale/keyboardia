/** Prevents re-entry while one asynchronous action is still in flight. */
export class AsyncActionLatch {
  private inFlight = false;
  private generation = 0;

  get active(): boolean {
    return this.inFlight;
  }

  /** Invalidate continuations and callbacks owned by the current action. */
  cancel(): void {
    this.generation += 1;
  }

  async run(action: (isCurrent: () => boolean) => Promise<void>): Promise<boolean> {
    if (this.inFlight) return false;

    this.inFlight = true;
    const generation = ++this.generation;
    const isCurrent = () => generation === this.generation;
    try {
      await action(isCurrent);
      return true;
    } finally {
      this.inFlight = false;
    }
  }
}
