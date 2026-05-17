import { useWorkspaceStore } from '@/store/useWorkspaceStore';

export function WorkspaceSwitcher() {
  const auth = useWorkspaceStore();
  return (
    <div className="top-strip-meta">
      <span className="badge" title={`auth: ${auth.mode}`}>
        <span className="chip-prefix">auth: </span>
        {auth.mode}
      </span>
      <span className="badge" title={`user: ${auth.userId}`}>
        <span className="chip-prefix">user: </span>
        {auth.userId.slice(0, 10)}
      </span>
      <span className="badge" title={`workspace: ${auth.workspaceId}`}>
        <span className="chip-prefix">workspace: </span>
        {auth.workspaceId.slice(0, 10)}
      </span>
    </div>
  );
}
