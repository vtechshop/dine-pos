import AggregatorIntegration, {
  type IAggregatorIntegration,
  type AggregatorPlatform,
} from '../../models/AggregatorIntegration';
import MenuSyncHistory from '../../models/MenuSyncHistory';
import { decrypt } from '../../utils/encryption';
import { SwiggyConnector } from './SwiggyConnector';
import { ZomatoConnector } from './ZomatoConnector';
import type { BaseConnector } from './BaseConnector';
import type { ConnectorContext, MenuSyncResult } from './types';

interface SyncOptions {
  triggeredBy?:      'manual' | 'scheduled' | 'system';
  triggeredByUserId?: string;
  syncType?:         'full' | 'availability' | 'item' | 'scheduled';
}

class AggregatorServiceClass {
  private readonly connectors = new Map<AggregatorPlatform, BaseConnector>([
    ['swiggy', new SwiggyConnector()],
    ['zomato', new ZomatoConnector()],
  ]);

  getConnector(platform: AggregatorPlatform): BaseConnector {
    const c = this.connectors.get(platform);
    if (!c) throw new Error(`Unknown aggregator platform: ${platform}`);
    return c;
  }

  /** Decrypt stored secrets into a ConnectorContext — never log or persist the result. */
  private toContext(integration: IAggregatorIntegration): ConnectorContext {
    return {
      storeId:    integration.storeId,
      apiKey:     integration.apiKeyEnc     ? decrypt(integration.apiKeyEnc)     : '',
      apiSecret:  integration.apiSecretEnc  ? decrypt(integration.apiSecretEnc)  : '',
      autoAccept: integration.autoAccept,
    };
  }

  async getIntegration(
    hotelId:  string,
    platform: AggregatorPlatform,
  ): Promise<IAggregatorIntegration | null> {
    return AggregatorIntegration.findOne({ hotelId, platform });
  }

  async getIntegrationByStoreId(
    platform: AggregatorPlatform,
    storeId:  string,
  ): Promise<IAggregatorIntegration | null> {
    return AggregatorIntegration.findOne({ platform, storeId, enabled: true });
  }

  async acceptOrder(
    hotelId:         string,
    platform:        AggregatorPlatform,
    platformOrderId: string,
    prepMin = 20,
  ): Promise<void> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) return;
    await this.getConnector(platform).acceptOrder(this.toContext(integration), platformOrderId, prepMin);
  }

  async rejectOrder(
    hotelId:         string,
    platform:        AggregatorPlatform,
    platformOrderId: string,
    reason:          string,
  ): Promise<void> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) return;
    await this.getConnector(platform).rejectOrder(this.toContext(integration), platformOrderId, reason);
  }

  async markReady(
    hotelId:         string,
    platform:        AggregatorPlatform,
    platformOrderId: string,
  ): Promise<void> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) return;
    await this.getConnector(platform).markReady(this.toContext(integration), platformOrderId);
  }

  async markDispatched(
    hotelId:         string,
    platform:        AggregatorPlatform,
    platformOrderId: string,
  ): Promise<void> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) return;
    await this.getConnector(platform).markDispatched(this.toContext(integration), platformOrderId);
  }

  async syncMenu(
    hotelId:    string,
    platform:   AggregatorPlatform,
    categories: unknown[],
    products:   unknown[],
    options?:   SyncOptions,
  ): Promise<MenuSyncResult> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) throw new Error('Integration not enabled');

    const startedAt  = new Date();
    const totalItems = (products as unknown[]).length;

    const historyDoc = await MenuSyncHistory.create({
      hotelId,
      platform,
      syncType:          options?.syncType       ?? 'full',
      triggeredBy:       options?.triggeredBy    ?? 'manual',
      triggeredByUserId: options?.triggeredByUserId ?? null,
      status:            'running',
      startedAt,
      totalItems,
    });

    await AggregatorIntegration.findByIdAndUpdate(integration._id, { menuSyncStatus: 'syncing' });

    try {
      const result = await this.getConnector(platform).syncMenu(
        this.toContext(integration),
        categories,
        products,
      );

      const completedAt = new Date();
      const durationMs  = completedAt.getTime() - startedAt.getTime();
      const syncStatus: 'success' | 'partial' | 'failed' =
        result.failedCount === 0 ? 'success'
        : result.syncedCount > 0 ? 'partial'
        : 'failed';

      const integrationUpdate: Record<string, unknown> = {
        menuSyncStatus:  syncStatus,
        lastSyncAt:      completedAt,
        syncedItemCount: result.syncedCount,
        failedItemCount: result.failedCount,
        lastSyncError:   result.error ?? null,
      };
      if (options?.triggeredBy === 'scheduled') {
        integrationUpdate.lastAutoSyncAt = completedAt;
      }

      await Promise.all([
        AggregatorIntegration.findByIdAndUpdate(integration._id, integrationUpdate),
        MenuSyncHistory.findByIdAndUpdate(historyDoc._id, {
          status:         syncStatus,
          completedAt,
          durationMs,
          syncedItems:    result.syncedCount,
          failedItems:    result.failedCount,
          errorCount:     result.failedCount,
          externalSynced: process.env.AGGREGATOR_EXTERNAL_ENABLED === 'true',
          failureSummary: (result.failedItems ?? []).map((fi: { name: string; error: string }) => ({
            itemName: fi.name,
            error:    fi.error,
          })),
        }),
      ]);

      return result;
    } catch (err: unknown) {
      const msg         = err instanceof Error ? err.message : String(err);
      const completedAt = new Date();
      const durationMs  = completedAt.getTime() - startedAt.getTime();

      await Promise.all([
        AggregatorIntegration.findByIdAndUpdate(integration._id, {
          menuSyncStatus: 'failed',
          lastSyncAt:     completedAt,
          lastSyncError:  msg,
        }),
        MenuSyncHistory.findByIdAndUpdate(historyDoc._id, {
          status:         'failed',
          completedAt,
          durationMs,
          errorCount:     1,
          externalSynced: process.env.AGGREGATOR_EXTERNAL_ENABLED === 'true',
          failureSummary: [{ itemName: 'Sync Error', error: msg }],
        }),
      ]);

      throw err;
    }
  }

  // Fire-and-forget per enabled platform — called on product/stock changes
  async syncProductAvailability(
    hotelId:        string,
    productId:      string,
    platformItemId: string,
    available:      boolean,
  ): Promise<void> {
    const integrations = await AggregatorIntegration.find({ hotelId, enabled: true });
    for (const integration of integrations) {
      const connector = this.getConnector(integration.platform as AggregatorPlatform);
      connector
        .updateProductAvailability(this.toContext(integration), platformItemId || productId, available)
        .catch(err =>
          console.error(`[AggregatorService] availability sync failed for ${integration.platform}:`, err),
        );
    }
  }
}

export const AggregatorService = new AggregatorServiceClass();
export { AggregatorPlatform };
