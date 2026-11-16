/** Injectable clock so tests can move time without fake timers (which break the DB driver). */
export interface Clock { now(): number }
export const systemClock: Clock = { now: () => Date.now() };
export class TestClock implements Clock {
  constructor(public t = Date.now()) {}
  now() { return this.t; }
  advance(ms: number) { this.t += ms; }
}
