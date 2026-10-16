export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      {Icon && (
        <div className="neu flex h-20 w-20 items-center justify-center rounded-3xl text-accent">
          <Icon size={32} />
        </div>
      )}
      <div className="max-w-sm">
        <h3 className="text-lg font-bold">{title}</h3>
        {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
