// @mine — email 1 of the officer's flow (2026-11-12): Encoder → Validator, driven by
// the calendar. Once the 30-day window opens before an anniversary, the Validator is
// told the project is waiting. Encoding a project sends nothing.
//
// Runs daily from Vercel Cron (vercel.json), and the Head Engineer can run it by hand.
// Interactive project refreshes also attempt reminders. Database leases prevent
// concurrent sends; failed inspection notifications are retried here too.
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, unauthorized, forbidden } from '@/lib/api';
import { listRoads } from '@/lib/supabase-data';
import { sendValidationReminders } from '@/lib/send-validation-reminders';
import { sendQueuedInspectionNotifications } from '@/lib/inspection-notification-queue';
import type { ReminderProject } from '@/lib/validation-reminders';
import { cronAuthorized } from '@/lib/retention';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** @mine — send every reminder that is owed; returns what happened, never throws. */
async function runValidationReminders(db: SupabaseClient, admin: SupabaseClient) {
  const projects = await listRoads(db, admin);
  const [reminders, inspectionNotifications] = await Promise.all([
    sendValidationReminders(admin, projects as unknown as ReminderProject[]),
    sendQueuedInspectionNotifications(admin),
  ]);
  return { ...reminders, inspectionNotifications };
}

export async function GET(request: Request) {
  const scheduled = cronAuthorized(request.headers);

  if (scheduled) {
    try {
      const admin = createAdminClient();
      return NextResponse.json(await runValidationReminders(admin, admin));
    } catch (error) {
      console.error('The scheduled validation reminders failed.', error);
      return NextResponse.json({ message: 'The validation reminders could not run.' }, { status: 500 });
    }
  }

  // A person asking by hand: Head Engineer only.
  const auth = await requireAuth(request);
  if (!auth) return unauthorized();
  if (auth.profile.roleDb !== 'head_engineer') return forbidden();
  try {
    return NextResponse.json(await runValidationReminders(auth.db, auth.admin));
  } catch (error) {
    console.error('The validation reminders could not run.', error);
    return NextResponse.json({ message: 'The validation reminders could not run.' }, { status: 500 });
  }
}

/** @mine — a scheduled call carrying the shared secret may also ask for them. */
export async function POST(request: Request) {
  if (!cronAuthorized(request.headers)) return unauthorized();
  try {
    const admin = createAdminClient();
    return NextResponse.json(await runValidationReminders(admin, admin));
  } catch (error) {
    console.error('The scheduled validation reminders failed.', error);
    return NextResponse.json({ message: 'The validation reminders could not run.' }, { status: 500 });
  }
}
