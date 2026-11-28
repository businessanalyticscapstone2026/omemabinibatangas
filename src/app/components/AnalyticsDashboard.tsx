import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
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

function DistributionChart({ title, description, data, emptyMessage }: { title: string; description: string; data: Slice[]; emptyMessage: string }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-md">
      <div className="border-b border-slate-100 pb-3">
        <h2 className="text-sm font-bold text-blue-900">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      {total > 0 ? (
        <div className="flex min-h-[200px] flex-wrap items-center justify-center gap-5 py-4">
          <div className="h-[160px] w-[160px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.filter(item => item.value > 0)} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
                  {data.filter(item => item.value > 0).map(item => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5" aria-label={`${title} breakdown`}>
            {data.map(item => (
              <div key={item.name} className="flex min-w-[150px] items-center justify-between gap-3 rounded-md border border-slate-100 px-2 py-1.5 text-[9px]" title={`${item.value} recorded`}>
                <span className="flex items-center gap-1.5 text-slate-600"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>
                <span className="font-medium text-slate-600">{Math.round(item.value / total * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="flex min-h-[200px] items-center justify-center text-center text-sm text-slate-500">{emptyMessage}</p>}
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
          <DistributionChart title="Pavement Type Ratio" description={`Share of recorded pavement types and road elements, using each project's latest completed assessment or project details. A project may have multiple elements. ${pavement.unspecified} road projects have none identified.`} data={pavementData} emptyMessage="No pavement types or road elements identified." />
          <DistributionChart title="Maintenance Status Distribution" description="Distribution of recorded maintenance activities by status." data={maintenanceData} emptyMessage="No maintenance records available." />
        </div>
      } />
    </main>
  );
}
