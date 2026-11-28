import { ArrowUpRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dashboardMetrics, chartInsight, type DashboardSlice } from '@/lib/dashboard-analytics';
import { Dashboard } from './Dashboard';

type Props = {
  localRoadData: any[]; inspections: any[]; maintenanceRecords: any[];
  scheduledInspectionIds: string[]; scheduledArchivedInspections: any[];
  userName: string; userRole: string; userId: string; onTabChange: (tab: string) => void;
};
type Chart = { title: string; description: string; data: DashboardSlice[]; type: 'bar' | 'donut'; unit: string; tab: string };
const colors: Record<string, string> = { Pending: '#f59e0b', Completed: '#10b981', Returned: '#ef4444', Validated: '#2563eb', Scheduled: '#f59e0b', 'In Progress': '#2563eb', Deferred: '#94a3b8', Fair: '#60a5fa', Poor: '#f59e0b', Bad: '#ef4444' };

function DashboardChart({ chart, onTabChange }: { chart: Chart; onTabChange: (tab: string) => void }) {
  const total = chart.data.reduce((sum, item) => sum + item.value, 0);
  return <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-md">
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
      <div><h2 className="text-xs font-bold text-blue-900">{chart.title}</h2><p className="mt-1 text-[9px] text-slate-400">{chart.description}</p></div>
      <button type="button" onClick={() => onTabChange(chart.tab)} className="flex shrink-0 items-center gap-1 text-[9px] text-blue-600 hover:text-blue-800">View All <ArrowUpRight className="h-3 w-3" /></button>
    </div>
    {!total ? <div className="flex h-[180px] items-center justify-center text-xs text-slate-500">No data available.</div> : chart.type === 'bar' ?
      <div className="h-[180px] pt-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart.data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid vertical={false} stroke="#e8eef7" strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="value" name="Count" fill="#2563eb" radius={[3, 3, 0, 0]} maxBarSize={32} />
      </BarChart></ResponsiveContainer></div> :
      <div className="flex min-h-[180px] flex-wrap items-center justify-center gap-5 py-3"><div className="h-[140px] w-[140px]"><ResponsiveContainer width="100%" height="100%"><PieChart>
        <Pie data={chart.data.filter(item => item.value)} dataKey="value" nameKey="name" innerRadius={47} outerRadius={62} paddingAngle={2} stroke="none">{chart.data.filter(item => item.value).map(item => <Cell key={item.name} fill={colors[item.name] || '#2563eb'} />)}</Pie><Tooltip />
      </PieChart></ResponsiveContainer></div><div className="space-y-1.5">{chart.data.map(item => <div key={item.name} className="flex min-w-[150px] items-center justify-between gap-3 rounded-md border border-slate-100 px-2 py-1.5 text-xs"><span className="flex items-center gap-2 text-slate-600"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[item.name] || '#2563eb' }} />{item.name}</span><span>{item.value} ({Math.round(item.value / total * 100)}%)</span></div>)}</div></div>}
    <p className="border-t border-slate-100 pt-3 text-sm leading-relaxed text-slate-700">{chartInsight(chart.data, chart.unit)}</p>
  </section>;
}

export function RoleDashboard(props: Props) {
  const { localRoadData, inspections, maintenanceRecords, scheduledInspectionIds, scheduledArchivedInspections, userName, userRole, userId, onTabChange } = props;
  const m = dashboardMetrics(localRoadData, inspections, maintenanceRecords, scheduledInspectionIds, scheduledArchivedInspections, userRole, userId);
  const pendingAssignment: Chart = { title: 'Pending Inspector Assignments', description: 'Validated projects without an assigned inspector, by category', type: 'bar', data: m.pendingAssignments, unit: 'projects awaiting assignment', tab: 'project-management' };
  const revisions: Chart = { title: 'Projects Returned for Revision', description: 'Projects with a returned validation entry, by category', type: 'bar', data: m.returned, unit: 'projects returned for revision', tab: userRole === 'Staff - Validator' ? 'validation-management' : 'project-management' };
  const needsMaintenance: Chart = { title: 'Projects for Maintenance', description: 'Unscheduled inspection results grouped by worst recorded rating', type: 'donut', data: m.maintenanceNeeded, unit: 'inspection results awaiting maintenance', tab: 'maintenance-management' };
  const inspectionStatus: Chart = { title: 'Project Inspection Status', description: 'One inspection history card per project', type: 'donut', data: m.inspectionStatus, unit: 'inspection project cards', tab: 'inspection-management' };
  const maintenanceStatus: Chart = { title: 'Project Maintenance Status', description: 'Maintenance records by status', type: 'donut', data: m.maintenanceStatus, unit: 'maintenance records', tab: 'maintenance-management' };
  const validationStatus: Chart = { title: 'Project Validation Status', description: 'Annual validation entries by decision', type: 'donut', data: m.validation, unit: 'validation entries', tab: 'validation-management' };
  const pendingInspections: Chart = { title: 'Pending Inspection Assessment', description: 'Your assigned pending inspection project cards, by category', type: 'bar', data: m.pendingInspections, unit: 'projects awaiting inspection', tab: 'inspection-management' };
  const charts = userRole === 'Head Engineer' ? [pendingAssignment, needsMaintenance, inspectionStatus, maintenanceStatus]
    : userRole === 'Staff - Encoder' ? [revisions, needsMaintenance, maintenanceStatus]
      : userRole === 'Staff - Validator' ? [validationStatus, revisions]
        : userRole === 'Staff - Inspector' ? [inspectionStatus, pendingInspections] : [];
  const permitted = userRole === 'Staff - Validator' ? ['validation-management'] : userRole === 'Staff - Inspector' ? ['inspection-management'] : userRole === 'Staff - Encoder' ? ['project-management', 'maintenance-management'] : ['project-management', 'inspection-management', 'maintenance-management'];
  const navigate = (tab: string) => { if (permitted.includes(tab)) onTabChange(tab); };
  return <main className="min-h-screen bg-[#E3EEF9] p-6 text-slate-800">
    <header className="mb-6"><h1 className="text-xl font-semibold tracking-tight text-blue-700">Welcome, {userName || 'User'}</h1><p className="mt-1 text-sm text-slate-500">Real-time pavement condition, road network classifications, and field audit status for Mabini, Batangas.</p></header>
    <Dashboard analyticsSummary kpiOnly localRoadData={m.visibleProjects} inspections={m.visibleInspections} userName={userName} onTabChange={navigate} />
    {charts.length > 0 && <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">{charts.map(chart => <DashboardChart key={chart.title} chart={chart} onTabChange={navigate} />)}</div>}
  </main>;
}
