// @mine — email 1, as the officer described the flow on 2026-11-12.
//
// The Validator is *not* emailed when an Encoder saves a project. The email is driven
// by the calendar: once the 30-day validation window opens before an anniversary, the
// system tells the Validator that the project is waiting. Encoding is not a trigger,
// and neither is saving the project again.
//
// So the selection lives here, pure and testable: given the projects and what has
// already been sent, which reminders are still owed today?
import { anniversaryMinusDays, hasFourDigitYear, VALIDATION_DAYS_BEFORE } from '@/lib/project-form-validation';

export const VALIDATION_REMINDER_ACTION = 'Validation Reminder Sent';

/** The stable marker for one project-year; the activity log keeps it forever. */
export function reminderMarker(projectId: string, year: number): string {
  return `${projectId} ${year}`;
}

/** `Validation Reminder Sent` details, e.g. `abc 2027 — Poblacion Road`. */
export function reminderDetails(projectId: string, year: number, projectName: string): string {
  return `${reminderMarker(projectId, year)} — ${projectName}`;
}

export type ReminderProject = {
  id: string;
  projectName?: string;
  name?: string;
  archivedAt?: string;
  actualCompletionDate?: string;
  validationResult?: 'Validated' | 'Return for Revision';
  annualValidationEntries?: Array<{
    year: number;
    dueDate: string;
    result: 'Pending' | 'Validated' | 'Return for Revision';
    remarks: string;
    validatedAt?: string;
  }>;
};

export type PendingReminder = { id: string; year: number; name: string; dueDate?: string };

/**
 * @mine — the projects whose validation window is open, whose year has no decision
 * yet, and whose reminder has never been sent. One entry per project-year.
 */
export function pendingValidationReminders(
  projects: ReminderProject[],
  logs: Array<{ action?: string; details?: string }>,
  now: Date = new Date(),
): PendingReminder[] {
  const alreadySent: Record<string, true> = {};
  for (const log of logs ?? []) {
    if (String(log?.action ?? '') !== VALIDATION_REMINDER_ACTION) continue;
    const marker = String(log?.details ?? '').split(' — ')[0].trim();
    if (marker) alreadySent[marker] = true;
  }

  const due: PendingReminder[] = [];
  const takenInThisRun: Record<string, true> = {};
  for (const project of projects ?? []) {
    if (project.archivedAt) continue;
    const completion = project.actualCompletionDate;
    if (!completion || !hasFourDigitYear(completion)) continue;
    const today = now.toISOString().slice(0, 10);
    for (const entry of project.annualValidationEntries ?? []) {
      // A revised submission has its own Information Updated notification.
      if (entry.result !== 'Pending' || entry.remarks?.trim() || entry.year <= Number(completion.slice(0, 4))) continue;
      const dueDate = anniversaryMinusDays(completion, entry.year, VALIDATION_DAYS_BEFORE);
      if (!dueDate || dueDate > today) continue;
      const marker = reminderMarker(project.id, entry.year);
      if (alreadySent[marker] || takenInThisRun[marker]) continue;
      takenInThisRun[marker] = true;
      due.push({ id: project.id, year: entry.year, name: String(project.projectName || project.name || ''), dueDate });
    }
  }
  return due;
}
