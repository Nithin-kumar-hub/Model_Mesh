import type { DAGNode, DAGValidationError } from '@modelmesh/types';

/**
 * The subtask DAG (Rule 2).
 *
 * A list can only express "all sequential" or "all parallel". A DAG expresses
 * what actually happens: four analyses run at once, synthesis waits for all
 * four, and a critique waits for synthesis. Everything the scheduler does is
 * derived from this structure.
 */
export class DAG {
  readonly nodes: Map<string, DAGNode>;

  constructor(nodes: DAGNode[]) {
    this.nodes = new Map(nodes.map((node) => [node.id, node]));
  }

  /**
   * @param knownIds ids that exist outside this node set and are already
   *   satisfied — used when validating the remainder of a partially executed
   *   plan, where a pending node legitimately depends on a completed one.
   */
  static validate(nodes: DAGNode[], knownIds: Set<string> = new Set()): DAGValidationError[] {
    const errors: DAGValidationError[] = [];

    if (nodes.length === 0) {
      return [{ code: 'EMPTY', message: 'Decomposition produced no subtasks', nodeIds: [] }];
    }

    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const node of nodes) {
      if (seen.has(node.id)) duplicates.add(node.id);
      seen.add(node.id);
    }
    if (duplicates.size > 0) {
      errors.push({
        code: 'DUPLICATE_ID',
        message: `Duplicate subtask ids: ${[...duplicates].join(', ')}`,
        nodeIds: [...duplicates],
      });
    }

    const missing = new Set<string>();
    for (const node of nodes) {
      for (const dependency of node.dependencies) {
        if (!seen.has(dependency) && !knownIds.has(dependency)) missing.add(`${node.id}→${dependency}`);
      }
    }
    if (missing.size > 0) {
      errors.push({
        code: 'MISSING_DEPENDENCY',
        message: `Dependencies reference unknown subtasks: ${[...missing].join(', ')}`,
        nodeIds: [...missing],
      });
    }

    const cycle = DAG.findCycle(nodes);
    if (cycle.length > 0) {
      errors.push({
        code: 'CYCLE',
        message: `Dependency cycle: ${cycle.join(' → ')}`,
        nodeIds: cycle,
      });
    }

    return errors;
  }

  /** Depth-first search with a colour marker; returns the offending path. */
  private static findCycle(nodes: DAGNode[]): string[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const state = new Map<string, 'visiting' | 'done'>();
    const path: string[] = [];

    const visit = (id: string): string[] => {
      const current = state.get(id);
      if (current === 'done') return [];
      if (current === 'visiting') return [...path.slice(path.indexOf(id)), id];

      state.set(id, 'visiting');
      path.push(id);

      for (const dependency of byId.get(id)?.dependencies ?? []) {
        if (!byId.has(dependency)) continue;
        const cycle = visit(dependency);
        if (cycle.length > 0) return cycle;
      }

      path.pop();
      state.set(id, 'done');
      return [];
    };

    for (const node of nodes) {
      const cycle = visit(node.id);
      if (cycle.length > 0) return cycle;
    }
    return [];
  }

  /**
   * Kahn's algorithm. Each returned group is a set of nodes with no unmet
   * dependencies — i.e. a batch that can run concurrently.
   */
  parallelGroups(maxGroupSize?: number): string[][] {
    const inDegree = new Map<string, number>();
    for (const node of this.nodes.values()) {
      inDegree.set(node.id, node.dependencies.filter((dep) => this.nodes.has(dep)).length);
    }

    const dependents = new Map<string, string[]>();
    for (const node of this.nodes.values()) {
      for (const dependency of node.dependencies) {
        if (!this.nodes.has(dependency)) continue;
        dependents.set(dependency, [...(dependents.get(dependency) ?? []), node.id]);
      }
    }

    let queue = [...this.nodes.values()]
      .filter((node) => (inDegree.get(node.id) ?? 0) === 0)
      .sort((a, b) => b.priority - a.priority)
      .map((node) => node.id);

    const groups: string[][] = [];
    const emitted = new Set<string>();

    while (queue.length > 0) {
      // A quota-bound batch keeps us from hammering one provider with 12 calls.
      const batch = maxGroupSize && maxGroupSize > 0 ? queue.slice(0, maxGroupSize) : queue;
      const deferred = maxGroupSize && maxGroupSize > 0 ? queue.slice(maxGroupSize) : [];

      groups.push(batch);
      for (const id of batch) emitted.add(id);

      const next: string[] = [...deferred];
      for (const id of batch) {
        for (const dependent of dependents.get(id) ?? []) {
          const remaining = (inDegree.get(dependent) ?? 0) - 1;
          inDegree.set(dependent, remaining);
          if (remaining === 0 && !emitted.has(dependent)) next.push(dependent);
        }
      }

      queue = [...new Set(next)].sort(
        (a, b) => (this.nodes.get(b)?.priority ?? 0) - (this.nodes.get(a)?.priority ?? 0),
      );
    }

    return groups;
  }

  /** Nodes whose dependencies have all completed successfully. */
  readySet(completed: Set<string>, failed: Set<string>): DAGNode[] {
    return [...this.nodes.values()]
      .filter(
        (node) =>
          !completed.has(node.id) &&
          !failed.has(node.id) &&
          node.dependencies.every((dependency) => completed.has(dependency)),
      )
      .sort((a, b) => b.priority - a.priority);
  }

  /** Everything downstream of `id` — what a failure would strand. */
  descendants(id: string): Set<string> {
    const found = new Set<string>();
    const stack = [id];

    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      for (const node of this.nodes.values()) {
        if (node.dependencies.includes(current) && !found.has(node.id)) {
          found.add(node.id);
          stack.push(node.id);
        }
      }
    }

    return found;
  }

  topologicalOrder(): string[] {
    return this.parallelGroups().flat();
  }

  /** Longest dependency chain by estimated latency — the real plan duration. */
  criticalPathMs(): number {
    const memo = new Map<string, number>();

    const cost = (id: string): number => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;

      const node = this.nodes.get(id);
      if (!node) return 0;

      const upstream = node.dependencies.reduce((max, dependency) => Math.max(max, cost(dependency)), 0);
      const total = upstream + node.estimatedLatencyMs;
      memo.set(id, total);
      return total;
    };

    return [...this.nodes.keys()].reduce((max, id) => Math.max(max, cost(id)), 0);
  }

  /** Sum of every node's latency — what strictly sequential execution costs. */
  sequentialMs(): number {
    return [...this.nodes.values()].reduce((sum, node) => sum + node.estimatedLatencyMs, 0);
  }

  toArray(): DAGNode[] {
    return [...this.nodes.values()];
  }
}
