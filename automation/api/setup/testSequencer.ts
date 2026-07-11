import Sequencer from '@jest/test-sequencer';
import type { Test } from '@jest/test-sequencer';

const ORDER: Record<string, number> = {
  'auth/registration.test': 10,
  'auth/approval.test': 20,
  'auth/login.test': 30,
  'auth/refresh-token.test': 40,
  'auth/logout.test': 50,
  'menu/category.test': 60,
  'menu/product.test': 70,
  'menu/table.test': 80,
  'menu/public-menu.test': 90,
  'orders/create-order.test': 100,
  'orders/kitchen-flow.test': 110,
  'orders/waiter-flow.test': 120,
  'orders/cashier-flow.test': 130,
  'orders/status-transitions.test': 140,
  'orders/offline-idempotency.test': 150,
  'orders/qr-order.test': 160,
  'reports/daily-report.test': 170,
  'reports/range-report.test': 180,
  'reports/product-report.test': 190,
  'settings/settings.test': 200,
  'notifications/socket-events.test': 210,
  'notifications/bluetooth-print.test': 220,
  'superadmin/hotel-management.test': 230,
  'superadmin/subscription.test': 240,
  'security/jwt-security.test': 300,
  'security/injection.test': 310,
  'security/rate-limiting.test': 320,
  'security/authorization.test': 330,
  'security/xss.test': 340,
  'security/payload-size.test': 350,
  'multitenant/isolation.test': 400,
  'multitenant/socket-isolation.test': 410,
  'multitenant/concurrent-sockets.test': 420,
};

function priority(testPath: string): number {
  for (const [key, order] of Object.entries(ORDER)) {
    if (testPath.includes(key)) return order;
  }
  return 500;
}

export default class DinePOSTestSequencer extends Sequencer {
  sort(tests: Array<Test>): Array<Test> {
    return [...tests].sort((a, b) => priority(a.path) - priority(b.path));
  }
}
