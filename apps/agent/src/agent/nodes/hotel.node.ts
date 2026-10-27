import { log, type TravelNode } from '../state.js';
import { stubHotels } from './stubData.js';

/** Stub: one canned hotel. Replaced by B12. */
export const hotelNode = (): TravelNode => async (state) => {
  const hotels = stubHotels();
  return {
    hotels,
    status: 'planning',
    logs: [log(state, 'HotelAgent', `Picked ${hotels[0]!.name} at $${hotels[0]!.pricePerNight}/night.`)],
  };
};
