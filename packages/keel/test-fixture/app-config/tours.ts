import type { TourDefinition } from 'keel/demo-static/tour/contracts'

/**
 * The APP's registered TOURS (ADR-0012 seam). EMPTY REGISTRATION: the fixture ships no `file://` demo,
 * so there is no walkthrough to script. The registration exists so the seam stays conforming.
 */
export const tours: TourDefinition[] = []
