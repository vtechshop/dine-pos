import { faker } from '@faker-js/faker';
import crypto from 'crypto';

export function uniquePhone(): string {
  // 9 cryptographically random digits prefixed with '8' → 10-digit unique mobile
  // Matches teardown cleanup regex '^8[0-9]{9}$' for safe DB deletion between runs
  const n = crypto.randomInt(0, 1_000_000_000);
  return '8' + n.toString().padStart(9, '0');
}

export function uniqueEmail(): string {
  // UUID-based: guaranteed unique across parallel calls and across runs
  return `test-${crypto.randomUUID()}@automation.local`;
}

export function hotelRegistrationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hotelName: `Test Hotel ${faker.company.name()}`,
    ownerName: faker.person.fullName(),
    phone: uniquePhone(),
    email: uniqueEmail(),
    businessType: 'restaurant',
    state: 'Maharashtra',
    city: 'Mumbai',
    address: faker.location.streetAddress(),
    ...overrides,
  };
}

export function orderPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tableNumber: `T${faker.number.int({ min: 1, max: 20 })}`,
    customerName: faker.person.fullName(),
    customerPhone: uniquePhone(),
    orderSource: 'dine-in',
    items: [
      {
        productName: 'Paneer Butter Masala',
        quantity: 2,
        price: 180,
        total: 360,
      },
      {
        productName: 'Naan',
        quantity: 4,
        price: 30,
        total: 120,
      },
    ],
    subtotal: 480,
    taxTotal: 43.2,
    grandTotal: 523.2,
    paymentMethod: 'cash',
    notes: '',
    ...overrides,
  };
}

export function productPayload(categoryId?: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Test Product ${faker.commerce.productName()}`,
    price: faker.number.int({ min: 50, max: 500 }),
    category: categoryId || undefined,
    isAvailable: true,
    description: faker.commerce.productDescription(),
    ...overrides,
  };
}

export function categoryPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Test Category ${faker.commerce.department()}`,
    color: '#FF5733',
    icon: '🍕',
    isActive: true,
    sortOrder: faker.number.int({ min: 1, max: 100 }),
    ...overrides,
  };
}

export function tablePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Table model requires `number` (the unique table number within a hotel)
  return {
    number: faker.number.int({ min: 100, max: 9999 }),
    name: `Table ${faker.number.int({ min: 1, max: 50 })}`,
    capacity: faker.number.int({ min: 2, max: 10 }),
    section: 'Main Hall',
    isActive: true,
    ...overrides,
  };
}

export function waiterPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: faker.person.fullName(),
    employeeCode: `W${faker.number.int({ min: 100, max: 999 })}`,
    pin: '1357',
    mobile: uniquePhone(),
    isActive: true,
    ...overrides,
  };
}

export function cashierPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: faker.person.fullName(),
    employeeCode: `C${faker.number.int({ min: 100, max: 999 })}`,
    pin: '2468',
    mobile: uniquePhone(),
    isActive: true,
    ...overrides,
  };
}

export function qrOrderPayload(hotelId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hotelId,
    tableNumber: `T${faker.number.int({ min: 1, max: 20 })}`,
    customerName: faker.person.fullName(),
    items: [
      {
        productName: 'Veg Biryani',
        quantity: 1,
        price: 150,
        total: 150,
      },
    ],
    subtotal: 150,
    taxTotal: 13.5,
    grandTotal: 163.5,
    notes: 'Less spicy please',
    orderSource: 'qr',
    ...overrides,
  };
}

export function xssPayloads(): string[] {
  return [
    '<script>alert("XSS")</script>',
    '"><img src=x onerror=alert(1)>',
    "'; DROP TABLE hotels; --",
    '<svg onload=alert(1)>',
    'javascript:alert(1)',
    '${7*7}',
    '{{7*7}}',
    '<iframe src="javascript:alert(\'XSS\')">',
  ];
}

export function nosqlInjectionPayloads(): Record<string, unknown>[] {
  return [
    { $gt: '' },
    { $ne: null },
    { $where: 'this.hotelId != ""' },
    { $regex: '.*' },
    { $exists: true },
    ['$gt', ''],
  ];
}

export function sqlInjectionStrings(): string[] {
  return [
    "' OR '1'='1",
    "1; DROP TABLE orders--",
    "' UNION SELECT * FROM hotels--",
    "admin'--",
    "' OR 1=1--",
    "'; INSERT INTO hotels VALUES ('hack')--",
  ];
}

export function oversizedPayload(sizeKB = 11): string {
  return 'x'.repeat(sizeKB * 1024);
}
