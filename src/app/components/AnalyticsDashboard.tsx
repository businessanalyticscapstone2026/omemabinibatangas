import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Dashboard } from './Dashboard';

interface AnalyticsDashboardProps {
  localRoadData: any[];
  inspections: any[];
  maintenanceRecords: Array<{ status: string }>;
  onTabChange: (tab: string) => void;
}

type Slice = { name: string; value: number; color: string };

// Match the earlier pavement KPI's source fields, but keep mixed materials in
// their own category so a road is never counted twice in a pie chart.
export function pavementDistribution(projects: any[]) {
  const roads = projects.filter(item => /road/i.test(`${item.type || ''} ${item.projectCategory || ''}`));
  const counts = { Concrete: 0, Asphalt: 0, Mixed: 0, Unspecified: 0 };
  for (const road of roads) {
    const description = `${road.components || ''} ${road.description || ''} ${road.projectDescription || ''}`;
    const concrete = /concrete|pccp/i.test(description);
    const asphalt = /asphalt|bituminous/i.test(description);
    counts[concrete && asphalt ? 'Mixed' : concrete ? 'Concrete' : asphalt ? 'Asphalt' : 'Unspecified']++;
  }
  return counts;
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
          <div className="space-y-2" aria-label={`${title} breakdown`}>
            {data.map(item => (
              <div key={item.name} className="flex min-w-[190px] items-center justify-between gap-4 text-xs text-slate-700">
                <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>
                <span>{item.value} ({Math.round(item.value / total * 100)}%)</span>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="flex min-h-[200px] items-center justify-center text-center text-sm text-slate-500">{emptyMessage}</p>}
    </section>
  );
}

export function AnalyticsDashboard({ localRoadData, inspections, maintenanceRecords, onTabChange }: AnalyticsDashboardProps) {
  const pavement = pavementDistribution(localRoadData);
  const identified = pavement.Concrete + pavement.Asphalt + pavement.Mixed;
  const pavementData: Slice[] = [
    { name: 'Concrete', value: pavement.Concrete, color: '#2563eb' },
    { name: 'Asphalt', value: pavement.Asphalt, color: '#0d9488' },
    { name: 'Both materials', value: pavement.Mixed, color: '#a855f7' },
  ];
  const colors = ['#f59e0b', '#2563eb', '#94a3b8', '#10b981'];
  const maintenanceData = maintenanceDistribution(maintenanceRecords).map((entry, index) => ({
    name: entry.status, value: entry.count, color: colors[index],
  }));
  return (
    <main className="min-h-screen bg-[#E3EEF9] p-5 text-slate-800 sm:p-8">
      <header className="mb-7">
        <h1 className="text-xl font-semibold tracking-tight text-blue-700">Road Network Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Real-time pavement condition, road network classifications, and field audit status for Mabini, Batangas.</p>
      </header>
      <Dashboard analyticsSummary localRoadData={localRoadData} inspections={inspections} userName="" onTabChange={onTabChange} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <DistributionChart title="Pavement Type Ratio" description={`${identified} road projects with identified concrete or asphalt details; ${pavement.Unspecified} unspecified or other.`} data={pavementData} emptyMessage="No concrete or asphalt pavement details recorded." />
        <DistributionChart title="Maintenance Status Distribution" description="Distribution of recorded maintenance activities by status." data={maintenanceData} emptyMessage="No maintenance records available." />
      </div>
    </main>
  );
}
