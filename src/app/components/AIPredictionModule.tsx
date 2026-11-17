import { useState } from 'react';
import { Sparkles, Loader2, CheckCircle } from 'lucide-react';

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
}

const actionableRatings = new Set(['Fair', 'Poor', 'Bad']);

function isActionableAssessment(assessment: Record<string, string> | undefined): boolean {
  return Object.values(assessment || {}).some((rating) => actionableRatings.has(rating));
}

function inspectionFingerprint(inspection: any): string {
  return JSON.stringify([inspection.id || '', inspection.date || '', inspection.conditionRating ?? null,
    Object.entries(inspection.conditionRatings || {}).sort(([a], [b]) => a.localeCompare(b)), inspection.remarks || '']);
}

export function AIPredictionModule({
  localRoadData,
  inspections,
  predictions,
  onPredictionsChange,
}: AIPredictionModuleProps) {
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

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
    const stale = !!prediction && (prediction.inspectionFingerprint ? prediction.inspectionFingerprint !== inspectionFingerprint(inspection) : !!prediction.lastInspection && prediction.lastInspection !== 'N/A' && prediction.lastInspection !== String(inspection.date || ''));
    return [{ road, inspection, prediction, stale }];
  }).sort((a, b) => (b.prediction?.priorityScore ?? -1) - (a.prediction?.priorityScore ?? -1));

  const steps = [
    'Preparing latest eligible inspection assessments',
    'Sending assessment data to Meta Llama via Vercel AI Gateway',
    'Validating generated priority recommendations',
    'Displaying results'
  ];

  const generatePredictions = async () => {
    setErrorMessage('');
    setLoading(true);
    setCurrentStep(0);

    try {
      const items = localRoadData.flatMap((road) => {
        const inspection = latestInspectionByRoadId.get(road.id);
        if (!inspection || !isActionableAssessment(inspection.conditionRatings)) return [];

        return [{
          id: road.id,
          name: road.projectName || road.name,
          type: road.projectCategory || road.type,
          condition: road.condition,
          dateBuilt: road.dateBuilt || '',
          lastInspection: String(inspection.date || ''),
          inspectionFingerprint: inspectionFingerprint(inspection),
          inspections: [{
            date: String(inspection.date || ''),
            conditionRating: Number(inspection.conditionRating),
            assessment: inspection.conditionRatings || {},
            inspectionFindings: String(inspection.remarks || ''),
          }],
        }];
      });
      if (items.length === 0) {
        throw new Error('No projects have a Fair, Poor, or Bad rating in their latest completed inspection. Projects rated only Good or N/A are not included.');
      }
      setCurrentStep(1);

      const response = await fetch('/api/ai-priority', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || 'Unable to generate recommendations.');
      }
      if (!Array.isArray(payload?.data)) {
        throw new Error('The AI service returned an invalid response.');
      }

      setCurrentStep(2);
      const results: PredictionResult[] = payload.data.map((prediction: any) => {
        const road = localRoadData.find((item) => item.id === prediction.localRoadId);
        if (!road) throw new Error('The AI service returned a recommendation for an unknown road.');
        return {
          localRoadId: road.id,
          localRoadName: road.projectName || road.name,
          type: road.projectCategory || road.type,
          lastInspection: String(latestInspectionByRoadId.get(road.id)?.date || 'N/A'),
          inspectionFingerprint: inspectionFingerprint(latestInspectionByRoadId.get(road.id)),
          condition: road.condition,
          riskLevel: prediction.riskLevel,
          priorityScore: prediction.priorityScore,
          justification: prediction.justification,
          recommendation: prediction.recommendation,
        };
      });
      setCurrentStep(3);
      onPredictionsChange(results);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to generate recommendations.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-[#E3EEF9] min-h-screen">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-blue-700">AI Maintenance Recommendation</h1>
        </div>
        <button
          onClick={generatePredictions}
          disabled={loading || rows.length === 0}
          className={`flex items-center gap-2 rounded-2xl px-5 py-3 font-semibold shadow-md transition hover:brightness-105 ${
            loading || rows.length === 0
              ? 'bg-gray-300 cursor-not-allowed text-gray-600'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
          }`}
        >
          <Sparkles className="w-5 h-5" />
          {predictions.length > 0 ? 'Regenerate' : 'Generate Recommendations'}
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
          <h2 className="text-lg font-bold text-[#0ea5e9] mb-6">{steps[currentStep]}...</h2>

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
      {!loading && (
        <>
          <div className="min-w-0 max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>{['Project Name', 'Category', 'Condition', 'AI Justification', 'Recommended Maintenance Activity'].map(label => <th key={label} scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase text-slate-600">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map(({ road, inspection, prediction, stale }) => {
                  const rating = Number(inspection.conditionRating);
                  const condition = Number.isFinite(rating) && rating > 0 ? (rating >= 8 ? 'Good' : rating >= 5 ? 'Fair' : 'Poor') : (road.condition || prediction?.condition || 'Not rated');
                  return <tr key={road.id} className="hover:bg-blue-50/60">
                    <td className="px-6 py-4 font-medium text-[#0ea5e9]">{road.projectName || road.name || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{road.projectCategory || road.type || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{condition}</td>
                    <td className="whitespace-pre-line px-6 py-4 text-sm leading-6 text-slate-700">{prediction ? <>{prediction.justification.replace(/\s*(Inspection findings:)/i, '\n$1')}{stale && <span className="mt-2 block text-amber-700">Based on an older inspection. Regenerate to update.</span>}</> : <span className="text-slate-500">Not generated yet</span>}</td>
                    <td className="px-6 py-4 text-sm leading-6 text-slate-700">{prediction ? prediction.recommendation : <span className="text-slate-500">Not generated yet</span>}</td>
                  </tr>;
                })}
                {rows.length === 0 && <tr><td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-600">No projects have a Fair, Poor, or Bad rating in their latest completed inspection. Projects rated only Good or N/A are not shown.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 text-center">
            New eligible inspections appear automatically. Generate or regenerate to update AI justification and recommended maintenance activity.
          </div>
        </>
      )}
    </div>
  );
}
