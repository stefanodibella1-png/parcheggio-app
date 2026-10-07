export type TabName = 'test' | 'parkings' | 'results' | 'debug';

export type Route =
  | { name: 'summary'; testId: string }
  | { name: 'review'; testId: string }
  | { name: 'parking'; parkingId: string }
  | { name: 'event'; eventId: string; testId: string | null }
  | { name: 'tests' };

export interface Nav {
  tab: (t: TabName) => void;
  push: (r: Route) => void;
  back: () => void;
}
