import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, CheckCircle, CalendarDays, MapPin } from 'lucide-react';
import { findingsSummary } from '@/lib/inspection-selection';
import { InspectionModule } from './InspectionModule';

export interface PredictionResult {
  localRoadId: string;
  localRoadName: string;
  type: string;
  lastInspection: string;
  condition: string;
  riskLevel: 'High' | 'Medium' | 'Low';
  priorityScore: number;
  justification: string;
  recommendation: string;
  inspectionFingerprint?: string;
}

interface AIPredictionModuleProps {
  localRoadData: any[];
  inspections: any[];
  predictions: PredictionResult[];
  onPredictionsChange: (predictions: PredictionResult[]) => void;
  recommendationsLoaded?: boolean;
  currentUser?: string;
  userRole?: string;
}

const actionableRatings = new Set(['Fair', 'Poor', 'Bad']);
const showProgress = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function isActionableAssessment(assessment: Record<string, string> | undefined): boolean {
  return Object.values(assessment || {}).some((rating) => actionableRatings.has(rating));
}

function inspectionFingerprint(inspection: any): string {
  return JSON.stringify([inspection.id || '', inspection.date || '', inspection.conditionRating ?? null,
    Object.entries(inspection.conditionRatings || {}).sort(([a], [b]) => a.localeCompare(b)),
    Object.entries(inspection.conditionRemarks || {}).sort(([a], [b]) => a.localeCompare(b)), inspection.remarks || '']);
}

export function AIPredictionModule({
  localRoadData,
  inspections,
  predictions,
  onPredictionsChange,
  recommendationsLoaded = true,
  currentUser = '',
  userRole = '',
}: AIPredictionModuleProps) {
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const completedInspections = inspections.filter((inspection) =>
    inspection.isScheduledAnnualFollowUp !== true &&
    inspection.isPendingValidationInspection !== true &&
    !(inspection.isValidationInspection === true && inspection.isPendingValidationInspection !== false)
  );
  const latestInspectionByRoadId = new Map<string, any>();
  for (const inspection of completedInspections) {
    const current = latestInspectionByRoadId.get(inspection.localRoadId);
    if (!current || String(inspection.date || '').localeCompare(String(current.date || '')) > 0) {
      latestInspectionByRoadId.set(inspection.localRoadId, inspection);
    }
  }
  // Project rows come from inspections, not from the last AI run. New eligible
  // inspections are visible immediately, even when no recommendation exists yet.
  const rows = localRoadData.flatMap(road => {
    const inspection = latestInspectionByRoadId.get(road.id);
    if (!inspection || !isActionableAssessment(inspection.conditionRatings)) return [];
    const prediction = predictions.find(item => item.localRoadId === road.id);
    const stale = !!prediction && prediction.inspectionFingerprint !== inspectionFingerprint(inspection);
    return [{ road, inspection, prediction, stale }];
  }).sort((a, b) => (b.prediction?.priorityScore ?? -1) - (a.prediction?.priorityScore ?? -1));

  const steps = [
    'Preparing latest eligible inspection assessments',
    'Sending assessment data to Meta Llama via Vercel AI Gateway',
    'Validating generated priority recommendations',
    'Displaying results'
  ];

  const attempted = useRef(new Set<string>());
  const inFlight = useRef(false);
  const state = useRef({ rows, predictions, onPredictionsChange });
  state.current = { rows, predictions, onPredictionsChange };
  const missingSignature = JSON.stringify(rows.filter(row => !row.prediction || row.stale)
    .map(row => [row.road.id, inspectionFingerprint(row.inspection)]));

  const generatePredictions = async (force = false) => {
    if (inFlight.current) return;
    const selected = state.current.rows.filter(({road, inspection, prediction, stale}) => {
      const key = JSON.stringify([road.id, inspectionFingerprint(inspection)]);
      return force || ((!prediction || stale) && !attempted.current.has(key));
    }).slice(0, 200);
    if (!selected.length) return;
    for (const {road, inspection} of selected) attempted.current.add(JSON.stringify([road.id, inspectionFingerprint(inspection)]));
    inFlight.current = true;
    setErrorMessage('');
    setLoading(true);
    setCurrentStep(0);
    try {
      // Capture the exact inspection sent to the model, so a response arriving
      // after a newer inspection cannot be mislabeled as current.
      const items = selected.map(({road, inspection}) => ({
        id: road.id, name: String(road.projectName || road.name || ''), type: String(road.projectCategory || road.type || ''),
        condition: String(road.condition || ''), dateBuilt: String(road.dateBuilt || ''), lastInspection: String(inspection.date || ''),
        inspectionFingerprint: inspectionFingerprint(inspection),
        inspections: [{ date: String(inspection.date || ''), conditionRating: Number(inspection.conditionRating),
          assessment: inspection.conditionRatings || {}, inspectionFindings: findingsSummary(inspection.conditionRatings || {}, inspection.conditionRemarks || {}) || String(inspection.remarks || '') }],
      }));
      setCurrentStep(1);
      const response = await fetch('/api/ai-priority', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Unable to generate recommendations.');
      if (!Array.isArray(payload?.data) || payload.data.length !== items.length) throw new Error('The AI service returned an invalid response.');
      setCurrentStep(2);
      // Let the browser render each real stage before the synchronous work finishes.
      await showProgress(250);
      const seen = new Set<string>();
      const results: PredictionResult[] = payload.data.map((prediction: any) => {
        const item = items.find(item => item.id === prediction.localRoadId);
        if (!item || seen.has(item.id)) throw new Error('The AI service returned an invalid project.');
        seen.add(item.id);
        return { localRoadId: item.id, localRoadName: item.name, type: item.type,
          lastInspection: item.lastInspection || 'N/A', inspectionFingerprint: item.inspectionFingerprint,
          condition: item.condition, riskLevel: prediction.riskLevel, priorityScore: prediction.priorityScore,
          justification: prediction.justification, recommendation: prediction.recommendation };
      });
      setCurrentStep(3);
      const replaced = new Set(results.map(result => result.localRoadId));
      state.current.onPredictionsChange([...state.current.predictions.filter(item => !replaced.has(item.localRoadId)), ...results]);
      if (payload.persistenceWarning) setErrorMessage(payload.persistenceWarning);
      await showProgress(250);
      setCurrentStep(steps.length);
      // Keep the completed checklist visible before returning to the results.
      await showProgress(1000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to generate recommendations.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (recommendationsLoaded && !loading) void generatePredictions();
    // This signature changes only when a project/inspection needs a result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingSignature, recommendationsLoaded, loading]);

  return (
    <div className="p-6 space-y-6 bg-[#E3EEF9] min-h-screen">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-blue-700">AI Maintenance Recommendation</h1>
          <p className="mt-1 text-sm text-slate-500">Maintenance recommendations generated from field inspection component rating and inspector findings.</p>
        </div>
        <button
          onClick={() => void generatePredictions(true)}
          disabled={loading || rows.length === 0}
          className={`flex items-center gap-2 rounded-2xl px-5 py-3 font-semibold shadow-md transition hover:brightness-105 ${
            loading || rows.length === 0
              ? 'bg-gray-300 cursor-not-allowed text-gray-600'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
          }`}
        >
          <Sparkles className="w-5 h-5" />
          {errorMessage ? 'Retry' : predictions.length > 0 ? 'Regenerate' : 'Generate Recommendations'}
        </button>
      </div>

      {errorMessage && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-white rounded-xl shadow-lg p-12 flex flex-col items-center justify-center">
          <Loader2 className="w-10 h-10 text-[#0ea5e9] animate-spin mb-6" />
          <h2 className="text-lg font-bold text-[#0ea5e9] mb-6" aria-live="polite">
            {currentStep === steps.length ? 'Recommendations ready' : `${steps[currentStep]}...`}
          </h2>

          <div className="w-full max-w-lg bg-gray-50 rounded-lg p-6 space-y-3">
            {steps.map((step, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  index < currentStep ? 'bg-[#0ea5e9]' :
                  index === currentStep ? 'bg-[#38bdf8]' :
                  'bg-gray-300'
                }`} />
                <span className={`text-sm ${
                  index <= currentStep ? 'text-[#0ea5e9]' : 'text-gray-400'
                }`}>
                  {step}
                </span>
                {index < currentStep && (
                  <CheckCircle className="w-4 h-4 text-[#0ea5e9] ml-auto" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results State */}
      {(
        <>
          <div className="space-y-4">
            {rows.map(({ road, inspection, prediction, stale }) => {
              const rating = Number(inspection.conditionRating);
              const condition = Number.isFinite(rating) && rating > 0 ? (rating >= 8 ? 'Good' : rating >= 5 ? 'Fair' : 'Poor') : (road.condition || prediction?.condition || 'Not rated');
              const badgeColor = (value: string) => value === 'Good' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : value === 'Fair' ? 'border-amber-200 bg-amber-50 text-amber-700' : value === 'Poor' ? 'border-orange-200 bg-orange-50 text-orange-700' : value === 'Bad' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-600';
              const issues = Object.entries(inspection.conditionRatings || {}).filter(([, value]) => actionableRatings.has(String(value)));
              const placeholder = errorMessage ? 'Not generated. Retry to generate.' : 'Generating recommendation…';
              return <button key={road.id} type="button" onClick={() => setSelectedProjectId(road.id)} aria-label={`View inspection result for ${road.projectName || road.name || 'project'}`} className="w-full overflow-hidden rounded-2xl border border-slate-200 border-l-4 border-l-amber-400 bg-white text-left shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
                  <div className="min-w-0"><h2 className="text-base font-bold text-slate-900">{road.projectName || road.name || 'N/A'}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"><span>{road.projectCategory || road.type || 'N/A'}</span><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{road.barangay || 'Barangay not specified'}</span><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Inspected {inspection.date || 'Date not specified'}</span></div>
                  </div><span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${badgeColor(condition)}`}>{condition}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-y border-slate-100 bg-slate-50/70 px-5 py-3"><span className="mr-1 text-xs font-semibold text-slate-500">Detected Component Issues:</span>{issues.map(([name, value]) => <span key={name} className={`rounded-md border px-2 py-1 text-xs font-semibold ${badgeColor(String(value))}`}>{name} · {String(value)}</span>)}</div>
                <div className="grid grid-cols-1 gap-3 p-5 lg:grid-cols-2"><section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">AI Justification</h3><p className="whitespace-pre-line text-sm leading-6 text-slate-700">{prediction ? prediction.justification.replace(/\s*(Inspection findings:)/i, '\n$1') : placeholder}</p>{prediction && stale && <p className="mt-2 text-sm text-amber-700">{errorMessage ? 'Update failed. Retry to refresh.' : 'Updating from the latest inspection.'}</p>}</section><section className="rounded-xl border border-blue-100 bg-blue-50/40 p-4"><h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700"><Sparkles className="h-4 w-4" />Recommended Maintenance Activity</h3><p className="whitespace-pre-line text-sm leading-6 text-slate-700">{prediction ? prediction.recommendation : placeholder}</p></section></div>
              </button>;
            })}
            {rows.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-600">No projects have a Fair, Poor, or Bad rating in their latest completed inspection. Projects rated only Good or N/A are not shown.</div>}
          </div>
          {rows.find(row => row.road.id === selectedProjectId)?.inspection?.id && <InspectionModule
            key={selectedProjectId}
            detailInspectionId={rows.find(row => row.road.id === selectedProjectId)!.inspection.id}
            onDetailClose={() => setSelectedProjectId(null)}
            inspections={inspections}
            localRoadList={localRoadData}
            currentUser={currentUser}
            userRole={userRole}
            onAddInspection={() => {}}
            onEditInspection={async () => false}
            onDeleteInspection={async () => false}
          />}

          {/* Footer */}
          <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 text-center">
            Engineers can review and oversee the recommended maintenance activities.
          </div>
        </>
      )}
    </div>
  );
}
