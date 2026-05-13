import { ThesisDetail } from '@/features/theses/thesis-detail';

export default function Page({ params }: { params: { id: string } }) {
  return <ThesisDetail thesisId={params.id} />;
}
