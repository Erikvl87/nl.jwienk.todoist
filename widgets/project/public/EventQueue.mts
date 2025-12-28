/**
 * Handles event ordering for Todoist realtime events that may arrive out of sequence.
 * Queues failed events per entity ID and retries them in timestamp order after a delay.
 */
export class EventQueue {
  private pendingEvents = new Map<string, Array<{ event: any; timestamp: number }>>();
  private pendingEventTimers = new Map<string, number>();
  private readonly reorderDelayMs: number;
  private processEvent: (event: any) => void;
  private onError: (message: string, technical?: string) => void;

  /**
   * Creates a new event queue.
   * @param processEvent Callback to process an individual event
   * @param onError Callback for unrecoverable errors
   * @param reorderDelayMs Time to wait for out-of-order events
   */
  constructor(
    processEvent: (event: any) => void,
    onError: (message: string, technical?: string) => void,
    reorderDelayMs = 3000
  ) {
    this.processEvent = processEvent;
    this.onError = onError;
    this.reorderDelayMs = reorderDelayMs;
  }

  /**
   * Processes an event, handling errors by queueing for retry.
   * @param event The event to process
   */
  public process(event: any): void {
    try {
      this.processEvent(event);
    } catch (error) {
      const entityId = event.event_data?.id;
      const err = error as Error;
      
      if (entityId) {
        console.warn(
          `[TodoistEventQueue] Failed to process ${event.event_name} for ${entityId}, queueing for retry`,
          err
        );
        
        const timestamp = event.event_data?.updated_at 
          ? Date.parse(event.event_data.updated_at) 
          : Date.now();
        
        this.queueForReorder(entityId, event, timestamp);
      } else {
        // No ID to track, trigger error handler
        this.onError('Error while handling event', err?.message);
        console.error('[TodoistEventQueue] No entity ID for failed event', error);
      }
    }
  }

  /**
   * Queues an event for reprocessing after a delay, grouped by entity ID.
   */
  private queueForReorder(entityId: string, event: any, timestamp: number): void {
    // Add to pending events for this entity
    if (!this.pendingEvents.has(entityId)) {
      this.pendingEvents.set(entityId, []);
    }
    this.pendingEvents.get(entityId)!.push({ event, timestamp });

    // Clear existing timer and set a new one
    if (this.pendingEventTimers.has(entityId)) {
      window.clearTimeout(this.pendingEventTimers.get(entityId)!);
    }

    const timer = window.setTimeout(() => {
      this.processPending(entityId);
    }, this.reorderDelayMs);

    this.pendingEventTimers.set(entityId, timer);
  }

  /**
   * Processes all queued events for an entity in timestamp order.
   */
  private processPending(entityId: string): void {
    const events = this.pendingEvents.get(entityId);
    if (!events || events.length === 0) return;

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[TodoistEventQueue] Processing ${events.length} queued event(s) for ${entityId} in order`);

    // Process each event
    for (const { event } of events) {
      try {
        this.processEvent(event);
      } catch (error) {
        console.error(`[TodoistEventQueue] Still failed after reorder for ${entityId}:`, error);
        // Final failure - trigger error handler
        this.onError('Error while handling event', (error as Error)?.message);
      }
    }

    // Cleanup
    this.pendingEvents.delete(entityId);
    this.pendingEventTimers.delete(entityId);
  }

  /**
   * Clears all pending events and timers.
   */
  public clear(): void {
    this.pendingEventTimers.forEach((timer) => window.clearTimeout(timer));
    this.pendingEvents.clear();
    this.pendingEventTimers.clear();
  }
}
