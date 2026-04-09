/**
 * useNearbyTickets Hook - Fetch tickets within a radius of GPS coordinates
 *
 * Shows other tickets nearby (within 100m by default).
 * Excludes the current ticket from results.
 */

'use client';

import { useQuery } from '@tanstack/react-query';

export interface NearbyTicket {
  id: string;
  ticket_uid: string;
  title: string;
  status: string;
  dr_number: string | null;
  created_at: string;
  gps_coordinates: string;
  distance_meters: number;
}

interface UseNearbyTicketsResult {
  nearbyTickets: NearbyTicket[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

async function fetchNearbyTickets(
  ticketId: string,
  lat: number,
  lng: number,
  radius: number
): Promise<NearbyTicket[]> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lng: lng.toString(),
    radius: radius.toString(),
    exclude: ticketId,
  });

  const response = await fetch(`/api/noc/nearby-tickets?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Failed to fetch nearby tickets');
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to fetch nearby tickets');
  }

  return (result.data || []).map((t: NearbyTicket) => ({
    ...t,
    distance_meters: Number(t.distance_meters),
  }));
}

/**
 * Hook to fetch nearby tickets by GPS coordinates
 *
 * @param ticketId - Current ticket ID (to exclude from results)
 * @param gpsCoordinates - GPS string "lat,lng" or null
 * @param radius - Search radius in meters (default 100)
 */
export function useNearbyTickets(
  ticketId: string,
  gpsCoordinates: string | null | undefined,
  radius = 100
): UseNearbyTicketsResult {
  const parsed = parseGPS(gpsCoordinates);

  const query = useQuery({
    queryKey: ['tickets', 'nearby', ticketId, gpsCoordinates, radius],
    queryFn: () => fetchNearbyTickets(ticketId, parsed!.lat, parsed!.lng, radius),
    enabled: !!parsed && !!ticketId,
    staleTime: 60000,
  });

  return {
    nearbyTickets: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

function parseGPS(gps: string | null | undefined): { lat: number; lng: number } | null {
  if (!gps) return null;
  const parts = gps.split(',').map(p => p.trim());
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0] ?? '');
  const lng = parseFloat(parts[1] ?? '');
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}
