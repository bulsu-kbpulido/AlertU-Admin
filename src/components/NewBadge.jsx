export default function NewBadge({ className = '' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold uppercase leading-none tracking-wide text-white ${className}`}
    >
      New
    </span>
  );
}
