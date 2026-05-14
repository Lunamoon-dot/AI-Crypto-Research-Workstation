import { useWorkspaceStore } from '@/store/useWorkspaceStore';

export function WorkspaceSwitcher() {
  const auth = useWorkspaceStore();
  return (
    <div className="top-strip-meta">
      <span className="badge">auth: {auth.mode}</span>
      <span className="badge">user: {auth.userId.slice(0, 10)}</span>
      <span className="badge">workspace: {auth.workspaceId.slice(0, 10)}</span>
    </div>
  );
}
