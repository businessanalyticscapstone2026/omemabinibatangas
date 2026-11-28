import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { assessmentComponents, findingsSummary } from '@/lib/inspection-selection';

type Attachment = { name: string; type: string; dataUrl: string };
type Props = { inspection: any | null; road: any | null; onClose: () => void };

export function InspectionResultDialog({ inspection, road, onClose }: Props) {
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const projectName = road?.projectName || road?.name || inspection?.projectName || inspection?.localRoadName || 'Inspection result';
  const score = Number(inspection?.conditionRating);
  const condition = Number.isFinite(score) && score > 0 ? (score >= 8 ? 'Good' : score >= 5 ? 'Fair' : 'Poor') : road?.condition || 'Not rated';
  const fields = (items: Array<[string, string, boolean?]>) => <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{items.map(([label, value, full]) => <div key={label} className={full ? 'md:col-span-2' : undefined}><span className="mb-2 block text-sm font-medium text-gray-700">{label}</span><span className="block min-h-[3rem] whitespace-pre-wrap rounded-lg border border-gray-300 bg-gray-100 px-4 py-3 text-sm text-gray-700">{value || 'Not specified'}</span></div>)}</div>;
  return <>
    <Dialog open={!!inspection} onOpenChange={open => { if (!open) { setAttachment(null); onClose(); } }}>
      {inspection && <DialogContent className="inspection-detail-dialog card-details-dialog max-h-[min(620px,calc(100vh-32px))] overflow-hidden rounded-2xl border-0 bg-white p-0 text-slate-800 shadow-2xl sm:max-w-[840px]">
        <div className="bg-gradient-to-r from-blue-700 to-blue-600 px-6 py-3 pr-14 text-white"><DialogTitle className="text-xl font-bold text-white">{projectName}</DialogTitle><DialogDescription className="text-sm text-blue-100">Municipal Engineering Office · Inspection Result</DialogDescription></div>
        <div className="max-h-[calc(min(620px,100vh-32px)-76px)] space-y-5 overflow-y-auto px-6 pb-8 pt-5">
          <section className="border-b pb-6"><h3 className="mb-4 text-lg font-semibold text-gray-900">Project Information</h3>{fields([['Project / Program / Activity Name', projectName], ['Project Category', road?.projectCategory || road?.type || inspection.projectCategory || 'Local Road'], ['Location', road?.location || inspection.location || road?.barangay || '', true]])}</section>
          <section className="border-b pb-6"><h3 className="mb-4 text-lg font-semibold text-gray-900">Road Information</h3>{fields([['Road Network ID No.', road?.roadNetworkId || inspection.roadNetworkId || ''], ['Road Name', road?.roadName || road?.name || inspection.roadName || '']])}</section>
          <section className="border-b pb-6"><h3 className="mb-4 text-lg font-semibold text-gray-900">Inspection Details{inspection.annualFollowUpYear ? ` · Annual Follow-up ${inspection.annualFollowUpYear}` : ''}</h3>{fields([['Inspector', inspection.inspector || ''], ['Inspection Type', inspection.inspectionType || ''], ['Integrity', Number.isFinite(score) && score > 0 ? `${Math.round(score * 10)}%` : ''], ['Condition', condition], ['Inspection Date', inspection.date || ''], ...(!inspection.isAnnualFollowUp ? [['Validation Status', inspection.validationStatus || 'Pending Validation'] as [string, string]] : [])])}
            <p className="mb-2 mt-4 text-sm font-medium text-gray-700">Observation Notes</p><p className="min-h-[5rem] whitespace-pre-wrap rounded-lg border border-gray-300 bg-gray-100 px-4 py-3 text-sm leading-6 text-gray-700">{findingsSummary(inspection.conditionRatings || {}, inspection.conditionRemarks || {}) || inspection.remarks || 'Not specified'}</p>
          </section>
          <section><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">Local Road Condition Assessment</h3><div className="space-y-2">{assessmentComponents.map(label => {
            const rating = inspection.conditionRatings?.[label];
            const remark = inspection.conditionRemarks?.[label];
            const files: Attachment[] = inspection.conditionAttachments?.[label] || [];
            return <div key={label} className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm"><div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-700">{label}</span><span className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-slate-600">{rating || 'Not assessed'}</span></div>{remark && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700"><strong>Remarks: </strong>{remark}</p>}{files.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{files.map((file, index) => <button key={`${file.name}-${index}`} type="button" onClick={() => setAttachment(file)} className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"><FileText className="h-3.5 w-3.5" />{file.name}</button>)}</div>}</div>;
          })}</div></section>
        </div>
      </DialogContent>}
    </Dialog>
    <Dialog open={!!attachment} onOpenChange={open => { if (!open) setAttachment(null); }}>
      {attachment && <DialogContent className="max-h-[min(760px,calc(100vh-32px))] overflow-hidden rounded-2xl border-0 bg-white p-0 sm:max-w-[900px]"><div className="bg-gradient-to-r from-blue-700 to-indigo-700 px-6 py-4 pr-12 text-white"><DialogTitle>{attachment.name}</DialogTitle><DialogDescription className="text-blue-100">{attachment.type || 'File'}</DialogDescription></div><div className="flex min-h-[320px] items-center justify-center overflow-auto bg-slate-100 p-6">{attachment.type.startsWith('image/') ? <img src={attachment.dataUrl} alt={attachment.name} className="max-h-[min(620px,calc(100vh-160px))] max-w-full object-contain" /> : <iframe src={attachment.dataUrl} title={attachment.name} className="h-[min(620px,calc(100vh-160px))] w-full rounded-lg border border-slate-200 bg-white" />}</div></DialogContent>}
    </Dialog>
  </>;
}
