export interface InspectionSummary {
  id: string;
  localRoadId: string;
  date: string;
  annualFollowUpYear?: number;
  isScheduledAnnualFollowUp?: boolean;
  isPendingValidationInspection?: boolean;
  isValidationInspection?: boolean;
  conditionRatings?: Record<string, string>;
  conditionRating?: number;
}

export function isPendingInspection(inspection: InspectionSummary): boolean {
  return inspection.isScheduledAnnualFollowUp === true || inspection.isPendingValidationInspection === true ||
    (inspection.isValidationInspection === true && inspection.isPendingValidationInspection !== false);
}

// Annual year, not the date the results were entered, determines follow-up order.
export function latestByProject<T extends InspectionSummary>(inspections: T[]): T[] {
  const selected = new Map<string, T>();
  const compare = (a: T, b: T) => {
    const yearA = a.annualFollowUpYear || Number(a.date?.slice(0, 4)) || 0;
    const yearB = b.annualFollowUpYear || Number(b.date?.slice(0, 4)) || 0;
    const sameFollowUp = a.annualFollowUpYear && a.annualFollowUpYear === b.annualFollowUpYear;
    return yearA - yearB || (sameFollowUp ? Number(!isPendingInspection(a)) - Number(!isPendingInspection(b)) : 0) || String(a.date || '').localeCompare(String(b.date || '')) ||
      Number(!isPendingInspection(a)) - Number(!isPendingInspection(b)) || a.id.localeCompare(b.id);
  };
  for (const inspection of inspections) {
    const previous = selected.get(inspection.localRoadId);
    if (!previous || compare(inspection, previous) > 0) selected.set(inspection.localRoadId, inspection);
  }
  return Array.from(selected.values());
}

/** Prefer the earliest validated follow-up awaiting results; retain completed history. */
export function inspectionCardsByValidation<T extends InspectionSummary>(inspections: T[], roads: Array<{ id: string; annualValidationEntries?: Array<{ year: number; result: string }> }>): T[] {
  const grouped = new Map<string, T[]>();
  for (const inspection of inspections) grouped.set(inspection.localRoadId, [...(grouped.get(inspection.localRoadId) || []), inspection]);
  const selected: T[] = [];
  for (const [roadId, records] of Array.from(grouped)) {
    const road = roads.find(item => item.id === roadId);
    // Legacy callers without validation metadata retain their existing display.
    if (!road || !Array.isArray(road.annualValidationEntries)) {
      selected.push(...latestByProject(records));
      continue;
    }
    const validated = new Set(road.annualValidationEntries.filter(entry => entry.result === 'Validated').map(entry => entry.year));
    const pending = records.filter(item => isPendingInspection(item) && item.annualFollowUpYear && validated.has(item.annualFollowUpYear))
      .sort((a, b) => (a.annualFollowUpYear || 0) - (b.annualFollowUpYear || 0));
    if (pending.length) selected.push(pending[0]);
    else selected.push(...latestByProject(records.filter(item => !isPendingInspection(item))));
  }
  return selected;
}

export function maintenanceEligible(inspection: InspectionSummary): boolean {
  if (isPendingInspection(inspection)) return false;
  const ratings = Object.values(inspection.conditionRatings || {});
  if (ratings.length) return ratings.some(rating => ['fair', 'poor', 'bad'].includes(String(rating).trim().toLowerCase()));
  const score = Number(inspection.conditionRating);
  return score > 0 && score < 8;
}

/** A follow-up may be scheduled once, including when older years are entered later. */
export function eligibleMaintenanceInspections<T extends InspectionSummary>(inspections: T[], scheduledIds: string[], archivedInspections: InspectionSummary[] = []): T[] {
  const scheduled = new Set(scheduledIds);
  const scheduledYears = new Set<string>();
  for (const inspection of [...inspections, ...archivedInspections]) {
    if (!scheduled.has(inspection.id)) continue;
    const year = inspection.annualFollowUpYear || Number(inspection.date?.slice(0, 4)) || 0;
    if (year) scheduledYears.add(`${inspection.localRoadId}:${year}`);
  }
  return inspections.filter(inspection => {
    const year = inspection.annualFollowUpYear || Number(inspection.date?.slice(0, 4)) || 0;
    return maintenanceEligible(inspection) && !scheduled.has(inspection.id) && (!year || !scheduledYears.has(`${inspection.localRoadId}:${year}`));
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export const assessmentComponents = ['Concrete', 'Asphalt', 'Gravel', 'Earth', 'Shoulder', 'Side Drain', 'Sidewalk', 'Drainage', 'Solar Lights', 'Slope Protection', 'Retaining Wall'];
export function findingsSummary(ratings: Record<string, string>, remarks: Record<string, string>): string {
  // Combine the inspector's observations without inventing details or exposing
  // a category-by-category list. Full remarks remain stored under each component.
  const seen = new Set<string>();
  const observations = assessmentComponents.flatMap(label => {
    if (!remarks[label]?.trim()) return [];
    const text = remarks[label].trim().replace(/\s+/g, ' ').replace(/[.;]+$/, '');
    const key = text.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [text];
  });
  const combined = observations.join('; ');
  return combined ? `${combined}.` : '';
}
export function validateAssessment(ratings: Record<string, string>, remarks: Record<string, string>, attachments: Record<string, unknown[]>): boolean {
  const allowed = ['Good', 'Fair', 'Poor', 'Bad', 'N/A'];
  return assessmentComponents.every(label => allowed.includes(ratings[label])) &&
    assessmentComponents.some(label => ratings[label] !== 'N/A') &&
    assessmentComponents.every(label => ['N/A', 'Good'].includes(ratings[label]) ||
      (typeof remarks[label] === 'string' && !!remarks[label].trim() && Array.isArray(attachments[label]) && attachments[label].length > 0));
}
