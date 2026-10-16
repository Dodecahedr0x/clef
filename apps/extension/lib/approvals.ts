import type { ApprovalDecision, ApprovalRequest, Approver } from '@clef/wallet-core';

type Pending = { request: ApprovalRequest; resolve: (d: ApprovalDecision) => void; windowId?: number; inPanel?: boolean };

/** An open side panel that can show approvals in place of a window. */
export interface PanelHost {
  /** True when a panel took the request (it is shown there and no window opens). */
  show(id: string): boolean;
  done(id: string): void;
}

/**
 * Pending approvals, owned by the background. Each request opens an extension window identified by an
 * unguessable id; the approval page fetches the request and posts the decision by that id.
 */
export class ApprovalQueue implements Approver {
  private readonly pending = new Map<string, Pending>();
  /** Windows that closed before their id was known (the open call had not resolved yet). */
  private readonly closedEarly = new Set<number>();

  constructor(
    private readonly open: (id: string, request: ApprovalRequest) => Promise<number | undefined>,
    private readonly close: (windowId: number) => void,
    private readonly panel?: PanelHost,
  ) {}

  request(request: ApprovalRequest): Promise<ApprovalDecision> {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const entry: Pending = { request, resolve };
      this.pending.set(id, entry);
      if (this.panel?.show(id)) {
        entry.inPanel = true;
        return;
      }
      this.open(id, request).then(
        (windowId) => {
          if (windowId === undefined) return;
          entry.windowId = windowId;
          if (this.closedEarly.delete(windowId)) this.decide(id, { approved: false });
        },
        () => this.decide(id, { approved: false }),
      );
    });
  }

  get(id: string): ApprovalRequest | undefined {
    return this.pending.get(id)?.request;
  }

  decide(id: string, decision: ApprovalDecision): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.resolve(decision);
    if (entry.windowId !== undefined) this.close(entry.windowId);
    if (entry.inPanel) this.panel?.done(id);
  }

  /** Closing the side panel without deciding rejects what it was showing, like closing an approval window. */
  panelClosed(ids: Iterable<string>): void {
    for (const id of ids) if (this.pending.get(id)?.inPanel) this.decide(id, { approved: false });
  }

  /** Closing an approval window without deciding is a rejection. */
  windowClosed(windowId: number): void {
    const entry = [...this.pending.entries()].find(([, e]) => e.windowId === windowId);
    if (entry) {
      entry[1].windowId = undefined; // already closed: nothing to close
      this.decide(entry[0], { approved: false });
    } else if ([...this.pending.values()].some((e) => e.windowId === undefined)) {
      this.closedEarly.add(windowId);
    }
  }
}
