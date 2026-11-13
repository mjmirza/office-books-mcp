// Token bucket matching the Lexware limit of 2 requests per second across all endpoints.

export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly rate: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<void> = Promise.resolve();

  constructor(o: TokenBucketOptions) {
    if (!(o.capacity > 0) || !(o.refillPerSecond > 0)) throw new Error("capacity and refillPerSecond must be positive");
    this.capacity = o.capacity;
    this.rate = o.refillPerSecond;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? realSleep;
    this.tokens = o.capacity;
    this.last = this.now();
  }

  /** Resolves when one request may be sent. Calls are served in order. */
  take(): Promise<void> {
    const next = this.queue.then(() => this.takeOne());
    this.queue = next.catch(() => {});
    return next;
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
  }

  private async takeOne(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      await this.sleep(Math.ceil(((1 - this.tokens) / this.rate) * 1000));
      this.refill();
    }
    this.tokens -= 1;
  }
}
