import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { Logger } from '@nestjs/common';

export const WORKFLOW_STARTER = Symbol('WORKFLOW_STARTER');

/** Starts durable workflows. Idempotent per workflow id (a repeat start is a no-op). */
export interface WorkflowStarter {
  readonly kind: 'temporal' | 'manual';
  start(workflowType: string, workflowId: string, taskQueue: string, input: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * Temporal client (lazy connection, so a temporarily unavailable Temporal does not stop the API
 * booting; the start call fails with an error the caller reports as retryable).
 */
export class TemporalWorkflowStarter implements WorkflowStarter {
  readonly kind = 'temporal' as const;
  private readonly logger = new Logger(TemporalWorkflowStarter.name);
  private client: Promise<{ client: Client; connection: Connection }> | undefined;

  constructor(
    private readonly options: {
      address: string;
      namespace: string;
      tls: boolean;
      apiKey?: string | undefined;
    },
  ) {}

  async start(workflowType: string, workflowId: string, taskQueue: string, input: unknown) {
    const { client } = await this.connect();
    try {
      await client.workflow.start(workflowType, {
        workflowId,
        taskQueue,
        args: [input],
        // One workflow per request id, ever: a retried start must not run it twice.
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        this.logger.log({ workflow_id: workflowId }, 'Workflow already started (idempotent)');
        return;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.client) return;
    const { connection } = await this.client;
    await connection.close();
  }

  private connect() {
    this.client ??= (async () => {
      const connection = await Connection.connect({
        address: this.options.address,
        tls: this.options.tls,
        ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
      });
      return { connection, client: new Client({ connection, namespace: this.options.namespace }) };
    })().catch((error: unknown) => {
      this.client = undefined; // allow a later retry
      throw error;
    });
    return this.client;
  }
}

/** LOCAL/TEST ONLY (refused when deployed): records starts; steps run via internal endpoints. */
export class ManualWorkflowStarter implements WorkflowStarter {
  readonly kind = 'manual' as const;
  readonly started: { workflowType: string; workflowId: string; input: unknown }[] = [];
  start(workflowType: string, workflowId: string, _taskQueue: string, input: unknown) {
    if (!this.started.some((s) => s.workflowId === workflowId)) {
      this.started.push({ workflowType, workflowId, input });
    }
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}
