import { canAssignInspector } from './project-validation-workflow';
import { inspectionCardsByValidation, isPendingInspection } from './inspection-selection';

type RecordItem = Record<string, any>;
export type DashboardSlice = { name: string; value: number };

export function byCategory(projects: RecordItem[]): DashboardSlice[] {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const name = String(project.projectCategory || project.type || '').trim() || 'Uncategorized';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name));
}

export function dashboardMetrics(projects: RecordItem[], inspections: RecordItem[], maintenance: RecordItem[], scheduledIds: string[], _archivedInspections: RecordItem[], role: string, userId: string) {
  // Inspector views must exclude historical projects assigned to another person.
  const visibleProjects = role === 'Staff - Inspector' ? projects.filter(project => userId && project.inspectorId === userId) : projects;
  const visibleIds = new Set(visibleProjects.map(project => project.id));
  const visibleInspections = role === 'Staff - Inspector' ? inspections.filter(item => visibleIds.has(item.localRoadId)) : inspections;
  const cards = inspectionCardsByValidation(visibleInspections as any[], visibleProjects as any[]);
  const pendingCards = cards.filter(item => isPendingInspection(item));
  const completedCards = cards.filter(item => !isPendingInspection(item));
  const pendingAssignments = projects.filter(project => !project.inspectorId && canAssignInspector(project as any));
  const returned = projects.filter(project => (project.annualValidationEntries || []).some((entry: RecordItem) => entry.result === 'Return for Revision') || (!(project.annualValidationEntries || []).length && project.validationResult === 'Return for Revision'));
  const validationCounts = { Pending: 0, Returned: 0, Validated: 0 };
  for (const project of projects) {
    const entries = project.annualValidationEntries || [];
    const decisions = entries.length ? entries.map((entry: RecordItem) => entry.result) : (project.validationResult ? [project.validationResult] : []);
    for (const result of decisions) {
      if (result === 'Pending') validationCounts.Pending++;
      else if (result === 'Return for Revision') validationCounts.Returned++;
      else if (result === 'Validated') validationCounts.Validated++;
    }
  }
  const scheduled = Array.from(new Set([...scheduledIds, ...maintenance.map(item => item.inspectionId).filter(Boolean)]));
  const scheduledSet = new Set(scheduled);
  const eligible = inspections.filter(item => !isPendingInspection(item as any) && !scheduledSet.has(item.id) && Object.values(item.conditionRatings || {}).some(rating => ['fair', 'poor', 'bad'].includes(String(rating).trim().toLowerCase())));
  const maintenanceNeeded = ['Fair', 'Poor', 'Bad'].map(name => ({ name, value: eligible.filter(item => {
    const ratings = Object.values(item.conditionRatings || {}).map(value => String(value).trim().toLowerCase());
    return (ratings.includes('bad') ? 'Bad' : ratings.includes('poor') ? 'Poor' : 'Fair') === name;
  }).length }));
  const status = ['Scheduled', 'In Progress', 'Deferred', 'Completed'].map(name => ({ name, value: maintenance.filter(item => item.status === name).length }));
  const inspectionStatus = [{ name: 'Pending', value: pendingCards.length }, { name: 'Completed', value: completedCards.length }];
  const projectById = new Map(visibleProjects.map(project => [project.id, project]));
  const pendingByCategory = byCategory(pendingCards.map(item => projectById.get(item.localRoadId) || {}));
  return { visibleProjects, visibleInspections, pendingAssignments: byCategory(pendingAssignments), returned: byCategory(returned), validation: Object.entries(validationCounts).map(([name, value]) => ({ name, value })), maintenanceNeeded, maintenanceStatus: status, inspectionStatus, pendingInspections: pendingByCategory };
}

export function chartInsight(data: DashboardSlice[], unit: string): string {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return `No ${unit} to display.`;
  const max = Math.max(...data.map(item => item.value));
  const leaders = data.filter(item => item.value === max).map(item => item.name);
  const breakdown = data.map(item => `${item.name}: ${item.value}`).join(', ');
  return `${total} ${unit} in total (${breakdown}). ${leaders.length > 1 ? `${leaders.join(', ')} are tied for the highest count at ${max} each` : `${leaders[0]} has the highest count at ${max}`}.`;
}
