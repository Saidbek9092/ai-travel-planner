'use client';

import type { Hotel, ItineraryDay } from '@ai-travel/contracts';
import 'mapbox-gl/dist/mapbox-gl.css';
import { HotelIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Marker, Popup, Source, type MapRef } from 'react-map-gl/mapbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { env } from '@/lib/env';
import { dayColor } from '@/lib/labels';
import { boundsOf, framePoints, routeLine } from '@/lib/map';
import { cn } from '@/lib/utils';

interface MapboxViewerProps {
  itinerary: ItineraryDay[];
  hotel: Hotel | null;
  activeDay: number | null;
}

/** Shown when there is no token or nothing to plot. */
function MapPlaceholder({ itinerary, reason }: { itinerary: ItineraryDay[]; reason: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Places</CardTitle>
        <p className="text-sm text-muted-foreground">{reason}</p>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm">
          {itinerary.map((day) => (
            <li key={day.day}>
              <span className="font-semibold">Day {day.day}:</span> {day.places.map((p) => p.name).join(' → ')}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function MapboxViewer({ itinerary, hotel, activeDay }: MapboxViewerProps) {
  const mapRef = useRef<MapRef>(null);
  const [popup, setPopup] = useState<{ name: string; day: number; lng: number; lat: number } | null>(null);
  const hasPlaces = itinerary.some((d) => d.places.length > 0);
  const bounds = useMemo(() => boundsOf(framePoints(itinerary, hotel, activeDay)), [itinerary, hotel, activeDay]);
  const route = useMemo(() => routeLine(itinerary.find((d) => d.day === activeDay), hotel), [itinerary, hotel, activeDay]);
  const activeColor = activeDay === null ? '#2952CC' : dayColor(activeDay);

  useEffect(() => {
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: 48, duration: 600 });
  }, [bounds]);

  if (!env.mapboxToken) return <MapPlaceholder itinerary={itinerary} reason="Map disabled: no Mapbox token is configured." />;
  if (!hasPlaces) return <MapPlaceholder itinerary={itinerary} reason="No places to show yet." />;

  return (
    <div className="flex flex-col gap-2">
      <div className="h-80 overflow-hidden rounded-xl border">
        <Map
          ref={mapRef}
          mapboxAccessToken={env.mapboxToken}
          initialViewState={bounds ? { bounds, fitBoundsOptions: { padding: 48 } } : undefined}
          mapStyle="mapbox://styles/mapbox/streets-v12"
          onLoad={() => bounds && mapRef.current?.fitBounds(bounds, { padding: 48, duration: 0 })}
        >
          {route && (
            <Source id="route" type="geojson" data={route}>
              <Layer id="route-line" type="line" paint={{ 'line-color': activeColor, 'line-width': 3 }} />
            </Source>
          )}
          {hotel?.location && (
            <Marker longitude={hotel.location.lng} latitude={hotel.location.lat}>
              <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-background" title={hotel.name}>
                <HotelIcon className="size-4" aria-label={`Hotel: ${hotel.name}`} />
              </span>
            </Marker>
          )}
          {itinerary.flatMap((day) =>
            day.places.map((place, i) => {
              const focused = activeDay === null || activeDay === day.day;
              return (
                <Marker key={`${day.day}-${i}`} longitude={place.lng} latitude={place.lat}>
                  <button
                    type="button"
                    aria-label={`${place.name}, day ${day.day}, stop ${i + 1}`}
                    onClick={() => setPopup({ name: place.name, day: day.day, lng: place.lng, lat: place.lat })}
                    className={cn(
                      'flex items-center justify-center rounded-full text-xs font-semibold text-white',
                      focused ? 'size-6' : 'size-4 opacity-40',
                    )}
                    style={{ backgroundColor: dayColor(day.day) }}
                  >
                    {focused && i + 1}
                  </button>
                </Marker>
              );
            }),
          )}
          {popup && (
            <Popup longitude={popup.lng} latitude={popup.lat} offset={14} onClose={() => setPopup(null)} closeOnClick={false}>
              <p className="text-sm font-semibold">{popup.name}</p>
              <p className="text-xs">Day {popup.day}</p>
            </Popup>
          )}
        </Map>
      </div>
      <p className="text-xs text-muted-foreground">
        {activeDay === null ? 'Showing all days — pick a day below to see its route.' : `Showing Day ${activeDay} — pick another day below to change the route.`}
      </p>
    </div>
  );
}
