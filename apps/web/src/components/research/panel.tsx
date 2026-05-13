export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">{title}</h3>
          {description ? (
            <p className="panel-description">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
