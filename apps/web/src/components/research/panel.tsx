export function Panel({
  title,
  description,
  action,
  className = '',
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
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
