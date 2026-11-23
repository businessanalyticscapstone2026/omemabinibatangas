import type { SupabaseClient } from '@supabase/supabase-js';
import { automaticNote, notifyWorkflow } from '@/lib/notifications';
import { listValidationReminderLogs, recordValidationReminder } from '@/lib/supabase-data';
import { pendingValidationReminders, reminderDetails, type ReminderProject } from '@/lib/validation-reminders';

/** Attempt owed reminders on project refresh as well as the daily cron.
 * The DB lease prevents concurrent refreshes and cron from sending the same year.
 * A failed attempt remains eligible for a later retry. */
export async function sendValidationReminders(admin: SupabaseClient, projects: ReminderProject[], limit = 20) {
  const logs = await listValidationReminderLogs(admin);
  const due = pendingValidationReminders(projects, logs);
  const reminders: Array<{ id: string; year: number; name: string; sent: number; skipped?: string }> = [];
  // Cap each request; subsequent refreshes and the daily job handle the rest.
  for (let offset = 0; offset < Math.min(due.length, limit); offset += 4) {
    await Promise.all(due.slice(offset, Math.min(offset + 4, limit)).map(async (reminder) => {
      const { data: token, error } = await admin.rpc('claim_validation_reminder', { p_project_id: reminder.id, p_year: reminder.year });
      if (error) { console.error('Could not claim validation reminder.', error); return; }
      if (!token) return;
      let sent = 0;
      let fullySent = false;
      let skipped: string | undefined;
      try {
        const result = await notifyWorkflow(admin, {
          kind: 'for-validation', projectName: reminder.name,
          note: automaticNote(reminder.dueDate ? `the ${reminder.year} validation window opened on ${reminder.dueDate}` : `the ${reminder.year} validation window is open`),
        });
        sent = result.sent;
        fullySent = sent > 0 && sent === result.recipients.length;
        skipped = result.skipped;
      } catch (error) { console.error('Could not send a validation reminder.', error); }
      const { error: finishError } = await admin.rpc('finish_validation_reminder', { p_project_id: reminder.id, p_year: reminder.year, p_token: token, p_sent: fullySent });
      if (finishError) console.error('Could not finalize validation reminder claim.', finishError);
      if (fullySent) {
        try { await recordValidationReminder(admin, reminderDetails(reminder.id, reminder.year, reminder.name)); }
        catch (error) { console.error('Could not record validation reminder.', error); }
      }
      reminders.push({ id: reminder.id, year: reminder.year, name: reminder.name, sent, skipped });
    }));
  }
  return { due: due.length, sent: reminders.reduce((total, item) => total + item.sent, 0), reminders };
}
