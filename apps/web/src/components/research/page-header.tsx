export function PageHeader({
  action,
}: {
  action?: React.ReactNode;
  [key: string]: unknown;
}) {
  return action ? <div className="page-header page-header-actions">{action}</div> : null;
}
