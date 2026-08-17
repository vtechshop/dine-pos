import type { ParsedAggregatorOrder, MenuSyncResult, ConnectorContext } from './types';

export abstract class BaseConnector {
  abstract readonly platform: string;

  abstract verifyWebhookSignature(
    rawBody:       string,
    headers:       Record<string, string>,
    webhookSecret: string,
  ): boolean;

  abstract parseIncomingOrder(rawBody: string): ParsedAggregatorOrder;

  abstract acceptOrder(
    ctx:                   ConnectorContext,
    platformOrderId:       string,
    estimatedPrepMinutes?: number,
  ): Promise<void>;

  abstract rejectOrder(
    ctx:             ConnectorContext,
    platformOrderId: string,
    reason:          string,
  ): Promise<void>;

  abstract markReady(
    ctx:             ConnectorContext,
    platformOrderId: string,
  ): Promise<void>;

  abstract markDispatched(
    ctx:             ConnectorContext,
    platformOrderId: string,
  ): Promise<void>;

  abstract syncMenu(
    ctx:        ConnectorContext,
    categories: unknown[],
    products:   unknown[],
  ): Promise<MenuSyncResult>;

  abstract updateProductAvailability(
    ctx:            ConnectorContext,
    platformItemId: string,
    available:      boolean,
  ): Promise<void>;

  protected externalEnabled(): boolean {
    return process.env.AGGREGATOR_EXTERNAL_ENABLED === 'true';
  }

  protected logExternalSkip(method: string, data: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.info(
      `[AggregatorService] AGGREGATOR_EXTERNAL_ENABLED=false — skipping ${this.platform}.${method}`,
      JSON.stringify(data),
    );
  }
}
