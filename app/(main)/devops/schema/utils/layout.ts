/**
 * Obsidian-style Force-Directed Graph Layout
 * Simulates a force-directed graph to naturally cluster related nodes
 */

import type { Node, Edge } from '@xyflow/react';

interface Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const SIMULATION_ITERATIONS = 50;
const LINK_STRENGTH = 0.3;
const REPULSION_STRENGTH = 100;
const DAMPING = 0.85;
const DESIRED_LINK_DISTANCE = 120;

export function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const positions: Map<string, Point> = new Map();
  const edgeMap = new Map<string, Set<string>>();

  // Initialize positions with some randomness
  const centerX = 0;
  const centerY = 0;
  const spread = Math.sqrt(nodes.length) * 50;

  nodes.forEach((node) => {
    positions.set(node.id, {
      x: centerX + (Math.random() - 0.5) * spread,
      y: centerY + (Math.random() - 0.5) * spread,
      vx: 0,
      vy: 0,
    });
    edgeMap.set(node.id, new Set());
  });

  // Build edge map
  edges.forEach((edge) => {
    const sourceSet = edgeMap.get(edge.source);
    const targetSet = edgeMap.get(edge.target);
    if (sourceSet) sourceSet.add(edge.target);
    if (targetSet) targetSet.add(edge.source);
  });

  // Force-directed simulation
  for (let iter = 0; iter < SIMULATION_ITERATIONS; iter++) {
    const forces = new Map<string, Point>();
    positions.forEach((_, id) => {
      forces.set(id, { x: 0, y: 0, vx: 0, vy: 0 });
    });

    // Spring forces (attractive) for connected nodes
    edges.forEach((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const ratio = (distance - DESIRED_LINK_DISTANCE) / distance;
      const force = ratio * LINK_STRENGTH;

      const sourceForce = forces.get(edge.source);
      const targetForce = forces.get(edge.target);
      if (sourceForce) {
        sourceForce.x += force * dx;
        sourceForce.y += force * dy;
      }
      if (targetForce) {
        targetForce.x -= force * dx;
        targetForce.y -= force * dy;
      }
    });

    // Repulsive forces between all node pairs
    const nodeIds = Array.from(positions.keys());
    for (let i = 0; i < nodeIds.length; i += 1) {
      for (let j = i + 1; j < nodeIds.length; j += 1) {
        const id1 = nodeIds[i] as string;
        const id2 = nodeIds[j] as string;
        const p1 = positions.get(id1);
        const p2 = positions.get(id2);

        if (!p1 || !p2) continue;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const force = REPULSION_STRENGTH / (distance * distance);

        const fx = (force * dx) / distance;
        const fy = (force * dy) / distance;

        const force1 = forces.get(id1);
        const force2 = forces.get(id2);
        if (force1) {
          force1.x -= fx;
          force1.y -= fy;
        }
        if (force2) {
          force2.x += fx;
          force2.y += fy;
        }
      }
    }

    // Update velocities and positions
    positions.forEach((pos, id) => {
      const force = forces.get(id);
      if (!force) return;

      pos.vx = (pos.vx + force.x) * DAMPING;
      pos.vy = (pos.vy + force.y) * DAMPING;

      const speed = Math.sqrt(pos.vx * pos.vx + pos.vy * pos.vy);
      if (speed > 2) {
        pos.vx = (pos.vx / speed) * 2;
        pos.vy = (pos.vy / speed) * 2;
      }

      pos.x += pos.vx;
      pos.y += pos.vy;
    });
  }

  // Return nodes with updated positions
  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) || { x: 0, y: 0 },
  }));
}
