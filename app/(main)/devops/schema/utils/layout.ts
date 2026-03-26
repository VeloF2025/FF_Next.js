/**
 * Graph Layout Algorithm
 * Positions nodes using a force-directed layout approximation
 */

import type { Node, Edge } from 'reactflow';

interface Point {
  x: number;
  y: number;
}

export function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const positions: Record<string, Point> = {};
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  if (nodes.length === 0) return nodes;

  // Group nodes by module
  const moduleGroups: Record<string, Node[]> = {};
  nodes.forEach((node) => {
    const module = node.data?.module || 'other';
    if (!moduleGroups[module]) moduleGroups[module] = [];
    moduleGroups[module].push(node);
  });

  let currentY = 50;
  let currentX = 50;
  const moduleWidth = 300;
  const moduleHeight = 150;
  const maxPerRow = Math.ceil(Math.sqrt(Object.keys(moduleGroups).length));
  let moduleCount = 0;

  // Layout by module groups
  Object.entries(moduleGroups).forEach(([module, moduleNodes]) => {
    if (moduleCount > 0 && moduleCount % maxPerRow === 0) {
      currentY += moduleHeight;
      currentX = 50;
    }

    const groupX = currentX;
    const groupY = currentY;

    moduleNodes.forEach((node, idx) => {
      const angle = (idx / moduleNodes.length) * Math.PI * 2;
      const radius = 80;
      positions[node.id] = {
        x: groupX + Math.cos(angle) * radius,
        y: groupY + Math.sin(angle) * radius,
      };
    });

    currentX += moduleWidth;
    moduleCount++;
  });

  // Apply force-directed adjustments for edges
  for (let i = 0; i < 20; i++) {
    const forces: Record<string, Point> = {};
    Object.keys(positions).forEach((id) => {
      forces[id] = { x: 0, y: 0 };
    });

    edges.forEach((edge) => {
      const source = positions[edge.source];
      const target = positions[edge.target];
      if (!source || !target) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const desiredDistance = 200;
      const force = (distance - desiredDistance) * 0.01;

      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      forces[edge.source].x += fx;
      forces[edge.source].y += fy;
      forces[edge.target].x -= fx;
      forces[edge.target].y -= fy;
    });

    // Repulsive forces between all nodes
    const nodeIds = Object.keys(positions);
    for (let j = 0; j < nodeIds.length; j++) {
      for (let k = j + 1; k < nodeIds.length; k++) {
        const id1 = nodeIds[j];
        const id2 = nodeIds[k];
        const p1 = positions[id1];
        const p2 = positions[id2];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDistance = 150;

        if (distance < minDistance) {
          const force = (minDistance - distance) * 0.05;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;

          forces[id1].x -= fx;
          forces[id1].y -= fy;
          forces[id2].x += fx;
          forces[id2].y += fy;
        }
      }
    }

    // Update positions with damping
    Object.keys(positions).forEach((id) => {
      positions[id].x += forces[id].x * 0.5;
      positions[id].y += forces[id].y * 0.5;
    });
  }

  // Return nodes with updated positions
  return nodes.map((node) => ({
    ...node,
    position: positions[node.id] || { x: 0, y: 0 },
  }));
}
