import { FilesScreen } from "@/components/screens/FilesScreen";
import { getFiles } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const files = await getFiles();
  return <FilesScreen initialFiles={files.data} fileSource={files.source} />;
}
