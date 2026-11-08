/** Só os dígitos de um telefone ou JID ('5511999998888:12@s.whatsapp.net' -> '5511999998888'). */
export function digits(value: unknown): string {
  return String(value ?? '').split('@')[0]!.split(':')[0]!.replace(/\D/g, '');
}

/**
 * Compara pelos 8 últimos dígitos, como no n8n: o WhatsApp às vezes manda o
 * celular brasileiro sem o 9 extra, então o número completo não bate.
 */
export function samePhone(a: string, b: string): boolean {
  const x = digits(a);
  const y = digits(b);
  return x.length >= 8 && y.length >= 8 && x.slice(-8) === y.slice(-8);
}

export function last8(value: string): string {
  return digits(value).slice(-8);
}
