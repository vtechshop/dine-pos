import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import mongoose from 'mongoose';
import Settings from '../models/Settings';
import Category from '../models/Category';
import Table from '../models/Table';

export const bootstrapNewHotel = async (
  hotelId: string | mongoose.Types.ObjectId,
  hotelData: { hotelName?: string; phone?: string }
): Promise<{ kitchenPin: string }> => {
  const id = typeof hotelId === 'string' ? new mongoose.Types.ObjectId(hotelId) : hotelId;

  const rawPin = String(randomInt(1000, 9999));
  const pinHash = await bcrypt.hash(rawPin, 12);

  await Settings.findOneAndUpdate(
    { hotelId: id },
    {
      $setOnInsert: {
        hotelId: id,
        hotelName: hotelData.hotelName || '',
        phone: hotelData.phone || '',
        kitchenPin: pinHash,
        defaultTaxPercent: 5,
        isSetupComplete: true,
      },
    },
    { upsert: true, new: true }
  );

  const defaultCategories = [
    { name: 'Meals',          icon: 'restaurant',            color: '#FF6B35', sortOrder: 1 },
    { name: 'Biryani',        icon: 'lunch-dining',          color: '#E91E63', sortOrder: 2 },
    { name: 'Starters',       icon: 'local-fire-department', color: '#FF5722', sortOrder: 3 },
    { name: 'Drinks',         icon: 'local-cafe',            color: '#4CAF50', sortOrder: 4 },
    { name: 'Snacks',         icon: 'fastfood',              color: '#FF9800', sortOrder: 5 },
    { name: 'Desserts',       icon: 'cake',                  color: '#9C27B0', sortOrder: 6 },
    { name: 'Juice & Shakes', icon: 'local-bar',             color: '#00BCD4', sortOrder: 7 },
  ];

  for (const cat of defaultCategories) {
    await Category.findOneAndUpdate(
      { hotelId: id, name: cat.name },
      { $setOnInsert: { hotelId: id, ...cat, isActive: true, isDeleted: false } },
      { upsert: true }
    ).catch(() => {});
  }

  for (let i = 1; i <= 5; i++) {
    await Table.findOneAndUpdate(
      { hotelId: id, number: i },
      {
        $setOnInsert: {
          hotelId: id,
          number: i,
          name: `Table ${i}`,
          capacity: 4,
          status: 'available',
          shape: 'square',
          x: 0,
          y: 0,
        },
      },
      { upsert: true }
    ).catch(() => {});
  }

  return { kitchenPin: rawPin };
};
