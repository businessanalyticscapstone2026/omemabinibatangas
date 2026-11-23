import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyWorkflow } from '@/lib/notifications';
import { addActivityLog } from '@/lib/supabase-data';

export async function queueInspectionNotification(admin: SupabaseClient, inspectionId: string, projectName: string, note: string) {
  const { error } = await admin.from('inspection_notification_queue').upsert(
    { inspection_id: inspectionId, project_name: projectName, actor_note: note },
    { onConflict: 'inspection_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

/** Try queued messages once. Failed attempts remain queued for the next cron. */
export async function sendQueuedInspectionNotifications(admin: SupabaseClient, inspectionId: string | null = null) {
  const { data, error } = await admin.rpc('claim_inspection_notifications', { p_inspection_id: inspectionId, p_limit: inspectionId ? 1 : 10 });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (row: { inspection_id: string; project_name: string; actor_note: string; token: string }) => {
    let sent = 0; let fullySent = false; let skipped: string | undefined;
    try {
      const result = await notifyWorkflow(admin, { kind: 'inspection-recorded', projectName: row.project_name, note: row.actor_note });
      sent = result.sent; fullySent = sent > 0 && sent === result.recipients.length; skipped = result.skipped;
    } catch (error) { console.error('Could not send inspection notification.', error); }
    const { error: finishError } = await admin.rpc('finish_inspection_notification', { p_inspection_id: row.inspection_id, p_token: row.token, p_sent: fullySent });
    if (finishError) console.error('Could not finalize inspection notification.', finishError);
    await addActivityLog(admin, { user: 'system', action: 'Inspection Email Delivery', details: `Inspection ${row.inspection_id}: ${fullySent ? 'accepted by mail server; inbox delivery not verified' : `not fully sent (${skipped || 'delivery failed'}); queued for retry`}.` });
    return { inspectionId: row.inspection_id, sent, fullySent, skipped };
  }));
}
