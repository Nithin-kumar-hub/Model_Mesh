import { describe, expect, it } from 'vitest';
import { AgentRole } from '@modelmesh/types';
import { DAG } from '../../src/core/orchestrator/dag';
import { makeNode } from '../helpers/factories';

/**
 * Rule 2 — DAG, not list. These tests pin the structural guarantees the
 * scheduler depends on: validity, batching, readiness, and reach.
 */
describe('DAG.validate', () => {
  it('rejects an empty decomposition', () => {
    const errors = DAG.validate([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('EMPTY');
  });

  it('reports duplicate node ids', () => {
    const errors = DAG.validate([makeNode('a'), makeNode('a'), makeNode('b')]);
    expect(errors.map((error) => error.code)).toContain('DUPLICATE_ID');
    expect(errors.find((error) => error.code === 'DUPLICATE_ID')?.nodeIds).toEqual(['a']);
  });

  it('reports dependencies that reference unknown nodes', () => {
    const errors = DAG.validate([makeNode('synthesis', { dependencies: ['ghost'] })]);
    expect(errors.map((error) => error.code)).toContain('MISSING_DEPENDENCY');
  });

  it('accepts a dependency satisfied by an already-completed node (re-plan case)', () => {
    // The bug this pins: re-planning the remainder of a partially executed plan
    // passes only the *pending* nodes, whose dependencies may already be done.
    const remaining = [makeNode('synthesis', { dependencies: ['security_analyzer'] })];

    expect(DAG.validate(remaining).map((error) => error.code)).toEqual(['MISSING_DEPENDENCY']);
    expect(DAG.validate(remaining, new Set(['security_analyzer']))).toEqual([]);
  });

  it('detects a dependency cycle', () => {
    const errors = DAG.validate([
      makeNode('a', { dependencies: ['b'] }),
      makeNode('b', { dependencies: ['a'] }),
    ]);
    const cycle = errors.find((error) => error.code === 'CYCLE');
    expect(cycle).toBeDefined();
    expect(cycle?.nodeIds.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts a valid fan-out/fan-in graph', () => {
    expect(
      DAG.validate([
        makeNode('a'),
        makeNode('b'),
        makeNode('synthesis', { dependencies: ['a', 'b'] }),
      ]),
    ).toEqual([]);
  });
});

describe('DAG.parallelGroups', () => {
  const fanOut = [
    makeNode('security_analyzer'),
    makeNode('coder'),
    makeNode('performance_analyzer'),
    makeNode('synthesis', { role: AgentRole.SYNTHESIZER, dependencies: ['security_analyzer', 'coder', 'performance_analyzer'] }),
  ];

  it('puts every independent node in the first batch and the join in the second', () => {
    const groups = new DAG(fanOut).parallelGroups();

    expect(groups).toHaveLength(2);
    expect([...(groups[0] ?? [])].sort()).toEqual(['coder', 'performance_analyzer', 'security_analyzer']);
    expect(groups[1]).toEqual(['synthesis']);
  });

  it('honours maxGroupSize by deferring the overflow to the next batch', () => {
    const groups = new DAG(fanOut).parallelGroups(2);

    expect(groups.map((group) => group.length)).toEqual([2, 1, 1]);
    expect(groups.at(-1)).toEqual(['synthesis']);
    // No node appears twice, and every node appears.
    const flat = groups.flat();
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat).toHaveLength(4);
  });

  it('orders a ready batch by descending priority', () => {
    const groups = new DAG([
      makeNode('low', { priority: 1 }),
      makeNode('high', { priority: 9 }),
      makeNode('mid', { priority: 5 }),
    ]).parallelGroups();

    expect(groups[0]).toEqual(['high', 'mid', 'low']);
  });

  it('emits a chain as one node per batch', () => {
    const groups = new DAG([
      makeNode('a'),
      makeNode('b', { dependencies: ['a'] }),
      makeNode('c', { dependencies: ['b'] }),
    ]).parallelGroups();

    expect(groups).toEqual([['a'], ['b'], ['c']]);
  });

  it('ignores dependencies on nodes outside the set (a re-planned remainder)', () => {
    const groups = new DAG([makeNode('synthesis', { dependencies: ['already_done'] })]).parallelGroups();
    expect(groups).toEqual([['synthesis']]);
  });
});

describe('DAG traversal', () => {
  const dag = new DAG([
    makeNode('a'),
    makeNode('b'),
    makeNode('c'),
    makeNode('synthesis', { dependencies: ['a', 'b', 'c'] }),
  ]);

  it('readySet excludes nodes with unmet dependencies', () => {
    const ready = dag.readySet(new Set(['a']), new Set());
    expect(ready.map((node) => node.id).sort()).toEqual(['b', 'c']);
  });

  it('readySet releases the join once every dependency has completed', () => {
    const ready = dag.readySet(new Set(['a', 'b', 'c']), new Set());
    expect(ready.map((node) => node.id)).toEqual(['synthesis']);
  });

  it('readySet never releases a node whose dependency failed', () => {
    const ready = dag.readySet(new Set(['a', 'b']), new Set(['c']));
    expect(ready.map((node) => node.id)).toEqual([]);
  });

  it('descendants finds everything a failure would strand', () => {
    const chain = new DAG([
      makeNode('a'),
      makeNode('b', { dependencies: ['a'] }),
      makeNode('c', { dependencies: ['b'] }),
      makeNode('unrelated'),
    ]);

    expect([...chain.descendants('a')].sort()).toEqual(['b', 'c']);
    expect([...chain.descendants('c')]).toEqual([]);
  });

  it('topologicalOrder never places a node before its dependency', () => {
    const order = dag.topologicalOrder();
    for (const node of dag.toArray()) {
      for (const dependency of node.dependencies) {
        expect(order.indexOf(dependency)).toBeLessThan(order.indexOf(node.id));
      }
    }
  });
});

describe('DAG latency estimation', () => {
  it('criticalPathMs takes the longest chain, not the sum', () => {
    const dag = new DAG([
      makeNode('a', { estimatedLatencyMs: 100 }),
      makeNode('b', { estimatedLatencyMs: 100 }),
      makeNode('c', { estimatedLatencyMs: 100 }),
      makeNode('synthesis', { dependencies: ['a', 'b', 'c'], estimatedLatencyMs: 200 }),
    ]);

    expect(dag.criticalPathMs()).toBe(300);
    expect(dag.sequentialMs()).toBe(500);
  });

  it('criticalPathMs equals sequentialMs for a pure chain', () => {
    const dag = new DAG([
      makeNode('a', { estimatedLatencyMs: 100 }),
      makeNode('b', { dependencies: ['a'], estimatedLatencyMs: 200 }),
      makeNode('c', { dependencies: ['b'], estimatedLatencyMs: 300 }),
    ]);

    expect(dag.criticalPathMs()).toBe(600);
    expect(dag.sequentialMs()).toBe(600);
  });
});
