import { log, type TravelNode } from '../state.js';

const STUB_START_DATE = '2026-12-01';

/** Stub: returns a canned Paris trip, letting explicit request fields win. Replaced by B13. */
export const supervisorNode = (): TravelNode => async (state) => {
  const { overrides } = state;
  const origin = overrides.origin ?? 'Tashkent';
  const destination = 'Paris';
  const budget = overrides.budget ?? 1000;
  const durationDays = overrides.durationDays ?? 5;

  return {
    origin,
    destination,
    budget,
    durationDays,
    startDate: overrides.startDate ?? STUB_START_DATE,
    status: 'searching',
    logs: [log(state, 'Supervisor', `Planning ${durationDays} days in ${destination} from ${origin}, budget $${budget}.`)],
  };
};
