import { ResearchRunWorkspace } from '@/features/research-runs/research-run-workspace';

export default function Page({ params }: { params: { id: string } }) {
  return <ResearchRunWorkspace runId={params.id} journal />;
}
