import { runScheduled } from "../../server/cron.mjs";

export default async () => { await runScheduled(); };
// Hourly. Cron is evaluated in UTC; the job itself works in Philippine time (UTC+8, no DST).
export const config = { schedule: "0 * * * *" };
