export default function Logo({ size = 36, withText = true }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="neu-accent flex items-center justify-center rounded-2xl" style={{ width: size, height: size }}>
        <svg
          viewBox="0 0 32 32"
          width={size * 0.6}
          height={size * 0.6}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 17h5l3-7 5 14 3-7h8" />
        </svg>
      </div>
      {withText && <span className="text-xl font-extrabold tracking-tight">Pulse</span>}
    </div>
  );
}
