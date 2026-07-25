/** Prevents re-entry while one asynchronous action is still in flight. */
export class AsyncActionLatch {
  private inFlight = false;

  get active(): boolean {
    return this.inFlight;
  }

  async run(action: () => Promise<void>): Promise<boolean> {
    if (this.inFlight) return false;

    this.inFlight = true;
    try {
      await action();
      return true;
    } finally {
      this.inFlight = false;
    }
  }
}
