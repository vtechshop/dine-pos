import { apiFetch } from './client';
import type { Expense } from '../types';

export async function fetchExpenses(date: string): Promise<{ expenses: Expense[]; total: number }> {
  return apiFetch(`/expenses?date=${date}&limit=200`);
}

export async function createExpense(body: {
  description: string;
  amount: number;
  category: Expense['category'];
  date: string;
  notes: string;
}): Promise<Expense> {
  return apiFetch('/expenses', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateExpense(id: string, body: {
  description: string;
  amount: number;
  category: Expense['category'];
  notes: string;
}): Promise<Expense> {
  return apiFetch(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteExpense(id: string): Promise<void> {
  return apiFetch(`/expenses/${id}`, { method: 'DELETE' });
}
