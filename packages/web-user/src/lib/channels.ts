// packages/web-user/src/lib/channels.ts
export const WA_NUMBER: string =
  (import.meta as any).env?.VITE_WA_NUMBER || '14155238886';

export const WA_JOIN: string =
  (import.meta as any).env?.VITE_WA_JOIN_CODE || '';

export function openWhatsApp(): void {
  const url = `https://wa.me/${WA_NUMBER}${
    WA_JOIN ? `?text=${encodeURIComponent(WA_JOIN)}` : ''
  }`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
