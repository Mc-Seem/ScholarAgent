import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import dagre from 'dagre';


const DEFAULT_FIXTURE = '../tests/fixtures/knowledge_graph_baseline.json';
const ITERATIONS = 30;


function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}


function transformGraph(graph) {
  const nodes = graph.nodes.map(node => ({
    id: node.id,
    type: node.type,
    data: {
      label: node.label,
      context: node.context,
      definition: node.definition,
      statement: node.statement,
      summary: node.summary,
      latex: node.latex,
      domNodeId: node.dom_node_id,
    },
    position: { x: 0, y: 0 },
  }));
  const edges = graph.edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.type,
    data: { evidence: edge.evidence },
  }));
  return { nodes, edges };
}


function layoutGraph(nodes, edges) {
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 200, ranker: 'network-simplex' });
  nodes.forEach(node => layout.setNode(node.id, { width: 180, height: 80 }));
  edges.forEach(edge => layout.setEdge(edge.source, edge.target));
  dagre.layout(layout);
  nodes.forEach(node => {
    const position = layout.node(node.id);
    node.position = { x: position.x - 90, y: position.y - 40 };
  });
}


function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) : undefined;
}


function syntheticGraph(graph, requestedNodes, requestedEdges) {
  if (!requestedNodes) return graph;
  const nodes = Array.from({ length: requestedNodes }, (_, index) => {
    const source = graph.nodes[index % graph.nodes.length];
    return { ...source, id: `${source.id}-${index}`, label: `${source.label} ${index}` };
  });
  const edgeCount = requestedEdges ?? Math.min(requestedNodes * 2, requestedNodes * (requestedNodes - 1));
  const edges = Array.from({ length: edgeCount }, (_, index) => {
    const source = index % requestedNodes;
    let target = (index * 7 + 1) % requestedNodes;
    if (target === source) target = (target + 1) % requestedNodes;
    const template = graph.edges[index % graph.edges.length];
    return {
      ...template,
      id: `synthetic-edge-${index}`,
      source: nodes[source].id,
      target: nodes[target].id,
    };
  });
  return { nodes, edges };
}


async function main() {
  const fixtureArgument = process.argv.slice(2).find(value => !value.startsWith('--') && !/^\d+$/.test(value));
  const fixturePath = resolve(process.cwd(), fixtureArgument ?? DEFAULT_FIXTURE);
  const source = await readFile(fixturePath, 'utf8');
  const graph = syntheticGraph(
    JSON.parse(source).graph,
    argumentValue('--nodes'),
    argumentValue('--edges'),
  );
  const transformTimes = [];
  const layoutTimes = [];

  for (let index = 0; index < ITERATIONS; index += 1) {
    const transformStart = performance.now();
    const transformed = transformGraph(graph);
    transformTimes.push(performance.now() - transformStart);

    const layoutStart = performance.now();
    layoutGraph(transformed.nodes, transformed.edges);
    layoutTimes.push(performance.now() - layoutStart);
  }

  console.log(JSON.stringify({
    fixture: fixturePath,
    iterations: ITERATIONS,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    payloadBytes: Buffer.byteLength(JSON.stringify(graph), 'utf8'),
    transformMs: {
      median: percentile(transformTimes, 0.5),
      p95: percentile(transformTimes, 0.95),
    },
    layoutMs: {
      median: percentile(layoutTimes, 0.5),
      p95: percentile(layoutTimes, 0.95),
    },
  }, null, 2));
}


await main();