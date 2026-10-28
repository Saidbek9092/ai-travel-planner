'use client';

import type { Hotel, ItineraryDay } from '@ai-travel/contracts';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, Marker, NavigationControl, Popup, Source, type MapRef } from 'react-map-gl/mapbox';
import { HotelPin, StopPin } from '@/components/MapPins';
import { env } from '@/lib/env';
import { dayColor } from '@/lib/labels';
import { boundsOf, framePoints, routeLine } from '@/lib/map';

interface MapboxViewerProps {
  itinerary: ItineraryDay[];
  hotel: Hotel | null;
  /** `null` = every day in its colour (live run). */
  activeDay: number | null;
  /** Show stop names next to the selected day's pins. */
  labels: boolean;
}

/** Street map; only rendered when `env.mapboxToken` is set (the overview falls back to `SchematicMap`). */
export default function MapboxViewer({ itinerary, hotel, activeDay, labels }: MapboxViewerProps) {
  const mapRef = useRef<MapRef>(null);
  const [popup, setPopup] = useState<{ name: string; day: number; lng: number; lat: number } | null>(null);
  const bounds = useMemo(() => boundsOf(framePoints(itinerary, hotel, activeDay)), [itinerary, hotel, activeDay]);
  const routes = useMemo(
    () =>
      (activeDay === null ? itinerary : itinerary.filter((d) => d.day === activeDay))
        .map((day) => ({ day: day.day, line: routeLine(day, hotel) }))
        .filter((r) => r.line !== null),
    [itinerary, hotel, activeDay],
  );

  useEffect(() => {
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: 48, duration: 600 });
  }, [bounds]);

  if (!env.mapboxToken) return null;

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={env.mapboxToken}
      initialViewState={bounds ? { bounds, fitBoundsOptions: { padding: 48 } } : undefined}
      mapStyle="mapbox://styles/mapbox/light-v11"
      style={{ width: '100%', height: '100%' }}
      onLoad={() => bounds && mapRef.current?.fitBounds(bounds, { padding: 48, duration: 0 })}
    >
      <NavigationControl position="top-right" showCompass={false} />
      {routes.map(({ day, line }) => (
        <Source key={day} id={`route-${day}`} type="geojson" data={line!}>
          <Layer
            id={`route-line-${day}`}
            type="line"
            layout={{ 'line-cap': 'round' }}
            paint={{ 'line-color': dayColor(day), 'line-width': activeDay === null ? 2.5 : 3.5, 'line-dasharray': [0.5, 2] }}
          />
        </Source>
      ))}
      {itinerary.flatMap((day) =>
        day.places.map((place, i) => {
          const selected = activeDay === day.day;
          return (
            <Marker key={`${day.day}-${i}`} longitude={place.lng} latitude={place.lat} style={{ zIndex: selected ? 2 : 1 }}>
              <StopPin
                day={day.day}
                index={i}
                name={place.name}
                look={activeDay === null ? 'dot' : selected ? 'numbered' : 'muted'}
                showLabel={labels && selected}
                onClick={() => setPopup({ name: place.name, day: day.day, lng: place.lng, lat: place.lat })}
              />
            </Marker>
          );
        }),
      )}
      {hotel?.location && (
        <Marker longitude={hotel.location.lng} latitude={hotel.location.lat} style={{ zIndex: 3 }}>
          <HotelPin name={hotel.name} showLabel={labels} />
        </Marker>
      )}
      {popup && (
        <Popup longitude={popup.lng} latitude={popup.lat} offset={14} onClose={() => setPopup(null)} closeOnClick={false}>
          <p className="text-sm font-semibold">{popup.name}</p>
          <p className="text-xs">Day {popup.day}</p>
        </Popup>
      )}
    </Map>
  );
}
