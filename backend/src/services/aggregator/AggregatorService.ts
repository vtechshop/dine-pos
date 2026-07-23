import AggregatorIntegration, {
  type IAggregatorIntegration,
  type AggregatorPlatform,
} from '../../models/AggregatorIntegration';
import { SwiggyConnector } from './SwiggyConnector';
import { ZomatoConnector } from './ZomatoConnector';
import type { BaseConnector } from './BaseConnector';
import type { MenuSyncResult } from './types';

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

  async getIntegration(
    hotelId: string,
    platform: AggregatorPlatform,
  ): Promise<IAggregatorIntegration | null> {
    return AggregatorIntegration.findOne({ hotelId, platform });
  }

  async getIntegrationByStoreId(
    platform: AggregatorPlatform,
    storeId: string,
  ): Promise<IAggregatorIntegration | null> {
    return AggregatorIntegration.findOne({ platform, storeId, enabled: true });
  }

  async acceptOrder(
    hotelId: string,
    platform: AggregatorPlatform,
    platformOrderId: string,
    prepMin = 20,
  ): Promise<void> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) return;
    await this.getConnector(platform).acceptOrder(integration, platformOrderId, prepMin);
  }

  async rejectOrder(
    hotelId: string,
    platform: AggregatorPlatform,
    platformOrderId: string,
    reason: string,
  ): Promise<void> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) return;
    await this.getConnector(platform).rejectOrder(integration, platformOrderId, reason);
  }

  async markReady(
    hotelId: string,
    platform: AggregatorPlatform,
    platformOrderId: string,
  ): Promise<void> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) return;
    await this.getConnector(platform).markReady(integration, platformOrderId);
  }

  async markDispatched(
    hotelId: string,
    platform: AggregatorPlatform,
    platformOrderId: string,
  ): Promise<void> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) return;
    await this.getConnector(platform).markDispatched(integration, platformOrderId);
  }

  async syncMenu(
    hotelId: string,
    platform: AggregatorPlatform,
    categories: unknown[],
    products: unknown[],
  ): Promise<MenuSyncResult> {
    const integration = await this.getIntegration(hotelId, platform);
    if (!integration?.enabled) throw new Error('Integration not enabled');

    await AggregatorIntegration.findByIdAndUpdate(integration._id, {
      menuSyncStatus: 'syncing',
    });

    try {
      const result = await this.getConnector(platform).syncMenu(integration, categories, products);
      await AggregatorIntegration.findByIdAndUpdate(integration._id, {
        menuSyncStatus:  result.success ? 'success' : 'failed',
        lastSyncAt:      new Date(),
        syncedItemCount: result.syncedCount,
        failedItemCount: result.failedCount,
        lastSyncError:   result.error ?? null,
      });
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await AggregatorIntegration.findByIdAndUpdate(integration._id, {
        menuSyncStatus: 'failed',
        lastSyncAt:     new Date(),
        lastSyncError:  msg,
      });
      throw err;
    }
  }

  // Called from product/stock update flow — fire-and-forget per platform
  async syncProductAvailability(
    hotelId: string,
    productId: string,
    platformItemId: string,
    available: boolean,
  ): Promise<void> {
    const integrations = await AggregatorIntegration.find({ hotelId, enabled: true });
    for (const integration of integrations) {
      const connector = this.getConnector(integration.platform as AggregatorPlatform);
      connector
        .updateProductAvailability(integration, platformItemId || productId, available)
        .catch(err =>
          console.error(`[AggregatorService] availability sync failed for ${integration.platform}:`, err),
        );
    }
  }
}

export const AggregatorService = new AggregatorServiceClass();
export { AggregatorPlatform };
