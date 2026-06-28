import { fnoNetworks, projectArchetypes } from '../data/fnoAtlasData';
import type { FnoNetwork } from '../data/fnoAtlasData';

export function findFnosForProject(archetypeId: string): FnoNetwork[] {
  const archetype = projectArchetypes.find((item) => item.id === archetypeId);
  if (!archetype) return [];

  const byId = new Map(fnoNetworks.map((network) => [network.id, network]));
  return archetype.bestFitFnos
    .map((id) => byId.get(id))
    .filter((network): network is FnoNetwork => Boolean(network));
}

export function filterFnos(query: string, region: string, type: string): FnoNetwork[] {
  const normalisedQuery = query.trim().toLowerCase();

  return fnoNetworks.filter((network) => {
    const matchesQuery = !normalisedQuery || [
      network.name,
      network.footprint,
      network.backhaulNotes,
      ...network.projectFit,
      ...network.strongRegions,
    ].some((value) => value.toLowerCase().includes(normalisedQuery));

    const matchesRegion = region === 'all' || network.strongRegions.includes(region);
    const matchesType = type === 'all' || network.types.includes(type as FnoNetwork['types'][number]);

    return matchesQuery && matchesRegion && matchesType;
  });
}

export function getAllRegions(): string[] {
  return Array.from(new Set(fnoNetworks.flatMap((network) => network.strongRegions))).sort();
}

export function getCoverageConfidenceSummary() {
  return fnoNetworks.reduce(
    (summary, network) => {
      summary[network.confidence] += 1;
      return summary;
    },
    { High: 0, Medium: 0, 'Needs verification': 0 } as Record<FnoNetwork['confidence'], number>
  );
}
