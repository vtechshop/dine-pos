import type { IAggregatorIntegration } from '../../models/AggregatorIntegration';
import type { ParsedAggregatorOrder, MenuSyncResult } from './types';

export abstract class BaseConnector {
  abstract readonly platform: string;

  abstract verifyWebhookSignature(
    rawBody:     string,
    headers:     Record<string, string>,
    integration: IAggregatorIntegration,
  ): boolean;

  abstract parseIncomingOrder(rawBody: string): ParsedAggregatorOrder;

  abstract acceptOrder(
    integration:           IAggregatorIntegration,
    platformOrderId:       string,
    estimatedPrepMinutes?: number,
  ): Promise<void>;

  abstract rejectOrder(
    integration:     IAggregatorIntegration,
    platformOrderId: string,
    reason:          string,
  ): Promise<void>;

  abstract markReady(
    integration:     IAggregatorIntegration,
    platformOrderId: string,
  ): Promise<void>;

  abstract markDispatched(
    integration:     IAggregatorIntegration,
    platformOrderId: string,
  ): Promise<void>;

  abstract syncMenu(
    integration: IAggregatorIntegration,
    categories:  unknown[],
    products:    unknown[],
  ): Promise<MenuSyncResult>;

  abstract updateProductAvailability(
    integration:     IAggregatorIntegration,
    platformItemId:  string,
    available:       boolean,
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
