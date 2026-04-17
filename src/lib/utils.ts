import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£',
    AED: 'د.إ', SGD: 'S$', JPY: '¥', CAD: 'CA$',
  };
  const symbol = symbols[currency] ?? currency;
  if (amount >= 1_00_000) return `${symbol}${(amount / 1_00_000).toFixed(1)}L`;
  if (amount >= 1000) return `${symbol}${(amount / 1000).toFixed(1)}K`;
  return `${symbol}${amount}`;
}

export function getDayName(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
