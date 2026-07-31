/**
 * What a customer is told about how this system currently classifies its
 * traffic.
 *
 * It publishes the classification and the numbers behind it, but **not the
 * lane, the topic or the worker**. Those are how the isolation is built and are
 * free to change; that a high-volume sender is handled apart from the long tail
 * is the promise, and it is the only part worth putting on the wire.
 *
 * `sendsInWindow` and `windowInSeconds` travel together because neither means
 * anything alone — "412 sends" is not an answer without "in the last minute".
 * `bulkThreshold` is included so a customer can see how close it is to being
 * reclassified rather than discovering it after the fact.
 */
export class SenderTrafficReadModel {
  constructor(
    public readonly tier: string,
    public readonly sendsInWindow: number,
    public readonly windowInSeconds: number,
    public readonly bulkThreshold: number,
  ) {}
}
