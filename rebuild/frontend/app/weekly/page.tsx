import { WeeklyScreen } from "@/components/screens/WeeklyScreen";
import { getWeeklyTasks } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function WeeklyPage() {
  const weekly = await getWeeklyTasks();
  return <WeeklyScreen initialTasks={weekly.data} />;
}
