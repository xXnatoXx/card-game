import { isRank, type Stack } from '@bluff/rules';
import type { HandshakeAuth, PlayPayload } from '@bluff/protocol';

// Everything a client sends is untrusted JSON. These turn it into typed values or null.

const MAX_IDS = 32;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trims, strips control characters, and requires 1 to `max` characters. */
export function parseName(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean.length >= 1 && clean.length <= max ? clean : null;
}

export function parseAuth(value: unknown, maxName: number): HandshakeAuth | null {
  if (!isRecord(value) || typeof value.token !== 'string' || !TOKEN.test(value.token)) return null;
  return { token: value.token, name: parseName(value.name, maxName) ?? 'Player' };
}

export function parsePlay(value: unknown): PlayPayload | null {
  if (!isRecord(value)) return null;
  const { cardIds, stacks = [], rank } = value;
  if (!Array.isArray(cardIds) || cardIds.length > MAX_IDS || !cardIds.every((id) => typeof id === 'string')) return null;
  if (!Array.isArray(stacks) || stacks.length > MAX_IDS || !isRank(rank)) return null;
  const parsed: Stack[] = [];
  for (const s of stacks) {
    if (!isRecord(s) || typeof s.hidden !== 'string' || typeof s.under !== 'string') return null;
    parsed.push({ hidden: s.hidden, under: s.under });
  }
  return { cardIds: [...(cardIds as string[])], stacks: parsed, rank };
}

export function getField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}
