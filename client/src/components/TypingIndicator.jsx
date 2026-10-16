export default function TypingIndicator({ label }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted" aria-live="polite">
      <div className="neu-sm flex items-center gap-1 rounded-full px-3 py-2">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
      </div>
      {label && <span>{label}</span>}
    </div>
  );
}
