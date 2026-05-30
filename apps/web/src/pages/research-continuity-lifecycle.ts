import type {
  ResearchContinuityLifecycleItemType,
  ResearchContinuityLifecycleStatus,
  ResearchContinuityTimelineEventResponse,
  ResearchContinuityTimelineResponse,
} from '../types';

export type LifecycleStatusCounts = Record<
  'active' | 'updated' | 'resolved' | 'weakened' | 'invalidated',
  number
>;

export interface LifecycleTimelineFilters {
  itemType?: ResearchContinuityLifecycleItemType | 'all';
  status?: ResearchContinuityLifecycleStatus | 'all';
}

export type LifecycleStatusFilterOption = {
  label: string;
  value: ResearchContinuityLifecycleStatus | 'all';
};

const COUNTED_STATUSES: Array<keyof LifecycleStatusCounts> = [
  'active',
  'updated',
  'resolved',
  'weakened',
  'invalidated',
];

const STATUS_FILTER_OPTIONS: LifecycleStatusFilterOption[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Updated', value: 'updated' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Weakened', value: 'weakened' },
  { label: 'Invalidated', value: 'invalidated' },
];

export function lifecycleStatusFilterOptions(): LifecycleStatusFilterOption[] {
  return STATUS_FILTER_OPTIONS;
}

export function lifecycleStatusCounts(
  timeline: Pick<ResearchContinuityTimelineResponse, 'lifecycle_items'> | null,
): LifecycleStatusCounts {
  const counts = {
    active: 0,
    updated: 0,
    resolved: 0,
    weakened: 0,
    invalidated: 0,
  };
  for (const item of timeline?.lifecycle_items ?? []) {
    if (COUNTED_STATUSES.includes(item.status as keyof LifecycleStatusCounts)) {
      counts[item.status as keyof LifecycleStatusCounts] += 1;
    }
  }
  return counts;
}

export function filterLifecycleTimelineEvents<
  T extends Pick<ResearchContinuityTimelineEventResponse, 'item_type' | 'status'>,
>(events: T[], filters: LifecycleTimelineFilters): T[] {
  return events.filter((event) => {
    const itemType = filters.itemType ?? 'all';
    const status = filters.status ?? 'all';
    return (
      (itemType === 'all' || event.item_type === itemType) &&
      (status === 'all' || event.status === status)
    );
  });
}

export function selectedLifecycleTimelineEvents(
  timeline: Pick<
    ResearchContinuityTimelineResponse,
    'lifecycle_items' | 'timeline_events'
  > | null,
  selectedStableItemKey: string | null,
): ResearchContinuityTimelineEventResponse[] {
  if (!timeline) {
    return [];
  }
  const selectedKey =
    selectedStableItemKey ?? timeline.lifecycle_items[0]?.stable_item_key ?? null;
  if (!selectedKey) {
    return [];
  }
  const selectedItem = timeline.lifecycle_items.find(
    (item) => item.stable_item_key === selectedKey,
  );
  if (!selectedItem) {
    return [];
  }
  const selectedEventIds = new Set(selectedItem.timeline_event_ids);
  return timeline.timeline_events.filter((event) => selectedEventIds.has(event.id));
}

export function windowedLifecycleLabel(
  timeline: Pick<ResearchContinuityTimelineResponse, 'window'> | null,
): string | null {
  if (!timeline?.window.truncated) {
    return null;
  }
  return `Windowed to the latest ${timeline.window.entry_limit} entries; first-seen values and counts are scoped to this window.`;
}
