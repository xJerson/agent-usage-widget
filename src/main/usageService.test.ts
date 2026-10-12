import { describe, expect, it } from 'vitest';
import type { AgentInfo, UsageEntry, UsageProvider, UsageSnapshot } from '../shared/types';
import { UsageService } from './usageService';

function fake(id: string): UsageProvider & { present: boolean; snap: UsageSnapshot | null; reads: number } {
  const info: AgentInfo = { id, name: id, planLabel: '', brand: '#000', brandLight: '#fff' };
  const p = {
    info,
    id,
    name: id,
    present: true,
    snap: null as UsageSnapshot | null,
    reads: 0,
    detect: async () => p.present,
    read: async () => {
      p.reads++;
      return p.snap;
    },
    watchTargets: () => [],
  };
  return p;
}

const snap = (agentId: string, pct: number): UsageSnapshot => ({
  agentId,
  windows: [{ minutes: 300, usedPercent: pct, resetsAt: null }],
  updatedAt: 1,
});

describe('UsageService.refresh', () => {
  it('emits one entry per detected provider, in registry order', async () => {
    const a = fake('a');
    const b = fake('b');
    const svc = new UsageService([a, b]);
    const seen: UsageEntry[][] = [];
    svc.onChange((e) => seen.push(e));
    await svc.refresh();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.map((e) => e.agent.id)).toEqual(['a', 'b']);
  });

  it('adds and removes entries live as detection changes', async () => {
    const a = fake('a');
    const b = fake('b');
    b.present = false;
    const svc = new UsageService([a, b]);
    await svc.refresh();
    expect(svc.current().map((e) => e.agent.id)).toEqual(['a']);
    b.present = true;
    await svc.refresh();
    expect(svc.current().map((e) => e.agent.id)).toEqual(['a', 'b']);
    a.present = false;
    await svc.refresh();
    expect(svc.current().map((e) => e.agent.id)).toEqual(['b']);
  });

  it('does not emit when nothing changed', async () => {
    const a = fake('a');
    a.snap = snap('a', 10);
    const svc = new UsageService([a]);
    let n = 0;
    svc.onChange(() => n++);
    await svc.refresh();
    await svc.refresh();
    expect(n).toBe(1);
    a.snap = snap('a', 11);
    await svc.refresh();
    expect(n).toBe(2);
  });

  it('keeps the last good snapshot when a read returns null', async () => {
    const a = fake('a');
    a.snap = snap('a', 42);
    const svc = new UsageService([a]);
    await svc.refresh();
    a.snap = null; // e.g. half-written file
    await svc.refresh();
    expect(svc.current()[0]?.snapshot?.windows[0]?.usedPercent).toBe(42);
  });

  it('drops the cached snapshot once the agent disappears', async () => {
    const a = fake('a');
    a.snap = snap('a', 42);
    const svc = new UsageService([a]);
    await svc.refresh();
    a.present = false;
    await svc.refresh();
    a.present = true;
    a.snap = null;
    await svc.refresh();
    expect(svc.current()[0]?.snapshot).toBeNull();
  });

  it('survives a provider that throws', async () => {
    const a = fake('a');
    const bad = fake('bad');
    bad.read = async () => {
      throw new Error('boom');
    };
    const svc = new UsageService([bad, a]);
    await svc.refresh();
    expect(svc.current().map((e) => e.agent.id)).toEqual(['bad', 'a']);
  });
});
