import { describe, expect, it } from 'vitest';
import {
  ARGON_MODEL_AGENT,
  GEMINI_MODEL_AGENT,
  THIRD_PARTY_MODEL_AGENT,
  splitAntigravityEntry,
} from './antigravityModels';
import type { UsageEntry } from './types';

describe('splitAntigravityEntry', () => {
  it('splits 5 Antigravity windows into Gemini, Argon and Third-party entries', () => {
    const input: UsageEntry = {
      agent: {
        id: 'antigravity',
        name: 'Antigravity',
        planLabel: '',
        brand: '#4E82EE',
        brandLight: '#A87FFB',
      },
      snapshot: {
        agentId: 'antigravity',
        plan: 'Pro',
        updatedAt: 1000,
        windows: [
          { id: 'gemini-5h', label: 'Gemini · 5h', order: 1, minutes: 300, usedPercent: 10, resetsAt: 2000 },
          { id: 'gemini-weekly', label: 'Gemini · Weekly (7d)', order: 2, minutes: 10080, usedPercent: 20, resetsAt: 3000 },
          { id: 'gemini-argon-wtu-weekly', label: 'Gemini Argon · WTU Weekly', order: 3, minutes: 10080, usedPercent: 75, resetsAt: 4000 },
          { id: '3p-5h', label: 'Third-party (3P) · 5h', order: 4, minutes: 300, usedPercent: 0, resetsAt: 5000 },
          { id: '3p-weekly', label: 'Third-party (3P) · Weekly (7d)', order: 5, minutes: 10080, usedPercent: 50, resetsAt: 6000 },
        ],
      },
    };

    const { gemini, argon, thirdParty } = splitAntigravityEntry(input);

    expect(gemini.agent).toEqual(GEMINI_MODEL_AGENT);
    expect(gemini.snapshot?.agentId).toBe('antigravity:gemini');
    expect(gemini.snapshot?.windows.map((w) => w.id)).toEqual(['gemini-5h', 'gemini-weekly']);

    expect(argon.agent).toEqual(ARGON_MODEL_AGENT);
    expect(argon.snapshot?.agentId).toBe('antigravity:argon');
    expect(argon.snapshot?.windows.map((w) => w.id)).toEqual(['gemini-argon-wtu-weekly']);

    expect(thirdParty.agent).toEqual(THIRD_PARTY_MODEL_AGENT);
    expect(thirdParty.snapshot?.agentId).toBe('antigravity:3p');
    expect(thirdParty.snapshot?.windows.map((w) => w.id)).toEqual(['3p-5h', '3p-weekly']);
  });

  it('handles null snapshot gracefully', () => {
    const input: UsageEntry = {
      agent: { id: 'antigravity', name: 'Antigravity', planLabel: '', brand: '#4E82EE', brandLight: '#A87FFB' },
      snapshot: null,
    };
    const { gemini, argon, thirdParty } = splitAntigravityEntry(input);
    expect(gemini.snapshot).toBeNull();
    expect(argon.snapshot).toBeNull();
    expect(thirdParty.snapshot).toBeNull();
  });
});
