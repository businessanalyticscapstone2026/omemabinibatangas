import { NextResponse } from 'next/server';
import { requireRole, withRefresh } from '@/lib/api';
import { addActivityLog } from '@/lib/supabase-data';
import { canRemoveAnnualValidation } from '@/lib/project-validation-workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Retain the row as a tombstone so the automatic annual generator cannot recreate it.
export async function DELETE(request: Request) {
  const { auth, denied } = await requireRole(request, ['validator']);
  if (denied) return denied;
  const payload = await request.json().catch(() => null) as { projectId?: unknown; year?: unknown } | null;
  const projectId = typeof payload?.projectId === 'string' ? payload.projectId.trim() : '';
  const year = payload?.year;
  if (!projectId || typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 9999) {
    return NextResponse.json({ message: 'A project and annual validation year are required.' }, { status: 400 });
  }
  try {
    const { data: project, error: projectError } = await auth.db.from('projects').select('actual_completion_date').eq('id', projectId).is('archived_at', null).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return NextResponse.json({ message: 'Project not found.' }, { status: 404 });
    if (!canRemoveAnnualValidation({ actualCompletionDate: project.actual_completion_date }, year)) return NextResponse.json({ message: 'The first anniversary validation cannot be removed.' }, { status: 403 });
    const { data, error } = await auth.admin.from('annual_validation_entries')
      .update({ deleted_at: new Date().toISOString() }).eq('project_id', projectId).eq('year', year)
      .is('deleted_at', null).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ message: 'Annual validation not found. Refresh and try again.' }, { status: 404 });
    await addActivityLog(auth.admin, { userId: auth.userId, user: auth.profile.username, action: 'Annual Validation Removed', details: `Removed annual validation ${year} for project ${projectId}` }).catch(error => console.error('Annual validation removed; activity logging failed.', error));
    return withRefresh(NextResponse.json({ success: true }), auth);
  } catch (error) {
    console.error('Failed to remove annual validation.', error);
    return NextResponse.json({ message: 'Unable to remove this annual validation.' }, { status: 500 });
  }
}
