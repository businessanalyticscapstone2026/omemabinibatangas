import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowUpRight } from 'lucide-react';
import { Dashboard } from './Dashboard';
import { assessmentComponents, isPendingInspection, latestByProject } from '@/lib/inspection-selection';

interface AnalyticsDashboardProps {
  localRoadData: any[];
  inspections: any[];
  maintenanceRecords: Array<{ status: string }>;
  onTabChange: (tab: string) => void;
}

type Slice = { name: string; value: number; color: string };

const componentPatterns: Record<string, RegExp> = {
  Concrete: /\b(?:concrete|pccp)\b/i, Asphalt: /\b(?:asphalt|bituminous)\b/i,
  Gravel: /\bgravel\b/i, Earth: /\bearth\b/i, Shoulder: /\bshoulders?\b/i,
  'Side Drain': /\bside[\s-]+drains?\b/i, Sidewalk: /\bsidewalks?\b/i,
  Drainage: /\bdrainage\b/i, 'Solar Lights': /\bsolar[\s-]+lights?\b/i,
  'Slope Protection': /\bslope[\s-]+protection\b/i, 'Retaining Wall': /\bretaining[\s-]+walls?\b/i,
};

export function pavementDistribution(projects: any[], inspections: any[]) {
  const roads = projects.filter(item => /road/i.test(`${item.type || ''} ${item.projectCategory || ''}`));
  const latest = new Map(latestByProject(inspections.filter(item => !isPendingInspection(item))).map(item => [item.localRoadId, item]));
  const counts: Record<string, number> = Object.fromEntries(assessmentComponents.map(name => [name, 0]));
  let unspecified = 0;
  for (const road of roads) {
    const assessment = latest.get(road.id)?.conditionRatings || {};
    const hasAssessment = assessmentComponents.some(name => ['good', 'fair', 'poor', 'bad', 'n/a'].includes(String(assessment[name] || '').trim().toLowerCase()));
    const description = `${road.components || ''} ${road.description || ''} ${road.projectDescription || ''}`;
    const present = assessmentComponents.filter(name => hasAssessment
      ? ['good', 'fair', 'poor', 'bad'].includes(String(assessment[name] || '').trim().toLowerCase())
      : componentPatterns[name].test(description));
    if (!present.length) unspecified++;
    for (const name of present) counts[name]++;
  }
  return { counts, unspecified };
}

export function maintenanceDistribution(records: Array<{ status: string }>) {
  return ['Scheduled', 'In Progress', 'Deferred', 'Completed'].map(status => ({
    status, count: records.filter(record => record.status === status).length,
  }));
}

export function distributionInsight(data: Slice[], kind: 'pavement' | 'maintenance', unspecified = 0): string {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return kind === 'maintenance' ? 'No maintenance records are available for analysis.' : `No pavement types or road elements have been identified. ${unspecified} road projects have none identified.`;
  const max = Math.max(...data.map(item => item.value));
  const leaders = data.filter(item => item.value === max).map(item => item.name);
  const leadingText = leaders.length > 1 ? `${leaders.join(', ')} are tied for the most at ${max} each` : `${leaders[0]} is the most common at ${max}`;
  if (kind === 'pavement') return `${total} pavement type and road element occurrences are recorded. ${leadingText}. A project may contribute more than one element; ${unspecified} road projects have none identified. Based on the latest completed inspection or project details when no assessment is available.`;
  const completed = data.find(item => item.name === 'Completed')?.value || 0;
  const breakdown = data.map(item => `${item.name}: ${item.value}`).join(', ');
  return `${total} maintenance ${total === 1 ? 'record is' : 'records are'} recorded (${breakdown}). ${completed} (${Math.round(completed / total * 100)}%) ${completed === 1 ? 'is' : 'are'} completed. ${leadingText}.`;
}

function DistributionChart({ title, description, data, emptyMessage, insight, legendBelow = false, centerLabel, onViewAll }: {
  title: string; description: string; data: Slice[]; emptyMessage: string; insight: string;
  legendBelow?: boolean; centerLabel?: string; onViewAll?: () => void;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const completed = data.find(item => item.name === 'Completed')?.value || 0;
  return (
    <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-md">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div><h2 className="text-xs font-bold text-blue-900">{title}</h2>
          <p className="mt-1 text-[9px] text-slate-400">{description}</p></div>
        {onViewAll && <button type="button" onClick={onViewAll} className="flex shrink-0 items-center gap-1 text-[9px] text-blue-600 hover:text-blue-800">View All <ArrowUpRight className="h-3 w-3" /></button>}
      </div>
      {total > 0 ? (
        <div className={legendBelow ? 'flex flex-col items-center justify-center gap-4 py-4' : 'flex min-h-[155px] flex-wrap items-center justify-center gap-3 py-4 sm:gap-6'}>
          <div className="relative h-[140px] w-[140px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.filter(item => item.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={47} outerRadius={62} paddingAngle={2} stroke="none">
                  {data.filter(item => item.value > 0).map(item => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            {centerLabel && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <strong className="text-sm text-blue-900">{Math.round(completed / total * 100)}%</strong>
              <span className="whitespace-nowrap text-[8px] leading-none tracking-wide text-slate-400">{centerLabel}</span>
            </div>}
          </div>
          <div className={legendBelow ? 'grid w-full grid-cols-2 gap-1.5 sm:grid-cols-6' : 'space-y-1.5'} aria-label={`${title} breakdown`}>
            {data.map(item => (
              <div key={item.name} className={`flex items-center justify-between gap-1 rounded-md border border-slate-100 px-2 py-1.5 text-[9px] ${legendBelow ? 'min-w-0' : 'min-w-[130px]'}`} title={`${item.value} recorded`}>
                <span className="flex min-w-0 items-center gap-1.5 text-slate-600"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>
                <span className="shrink-0 font-medium text-slate-600">{Math.round(item.value / total * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="flex min-h-[155px] items-center justify-center text-center text-sm text-slate-500">{emptyMessage}</p>}
      <p className="border-t border-slate-100 pt-3 text-sm leading-relaxed text-slate-700">{insight}</p>
    </section>
  );
}

export function AnalyticsDashboard({ localRoadData, inspections, maintenanceRecords, onTabChange }: AnalyticsDashboardProps) {
  const pavement = pavementDistribution(localRoadData, inspections);
  const pavementColors = ['#2563eb', '#0d9488', '#d97706', '#92400e', '#7c3aed', '#0891b2', '#db2777', '#4f46e5', '#ca8a04', '#16a34a', '#64748b'];
  const pavementData: Slice[] = assessmentComponents.map((name, index) => ({ name, value: pavement.counts[name], color: pavementColors[index] }));
  const colors = ['#f59e0b', '#2563eb', '#94a3b8', '#10b981'];
  const maintenanceData = maintenanceDistribution(maintenanceRecords).map((entry, index) => ({
    name: entry.status, value: entry.count, color: colors[index],
  }));
  return (
    <main className="min-h-screen bg-[#E3EEF9] p-6 text-slate-800">
      <header className="mb-7">
        <h1 className="text-xl font-semibold tracking-tight text-blue-700">Road Network Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Real-time pavement condition, road network classifications, and field audit status for Mabini, Batangas.</p>
      </header>
      <Dashboard analyticsSummary localRoadData={localRoadData} inspections={inspections} userName="" onTabChange={onTabChange} afterRoadCharts={
        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
          <DistributionChart title="Pavement Type Ratio" description="Recorded pavement types and road elements across road projects" data={pavementData} emptyMessage="No pavement types or road elements identified." insight={distributionInsight(pavementData, 'pavement', pavement.unspecified)} legendBelow />
          <DistributionChart title="Maintenance Status Distribution" description="Local road maintenance activities by status" data={maintenanceData} emptyMessage="No maintenance records available." insight={distributionInsight(maintenanceData, 'maintenance')} centerLabel="Completed" onViewAll={() => onTabChange('maintenance-management')} />
        </div>
      } />
    </main>
  );
}
