export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h2 className="page-title">{title}</h2>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
