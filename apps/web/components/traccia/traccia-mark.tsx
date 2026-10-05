/** The Traccia mark: two traces on the same trail, amber for `you` and cyan for the agent.
 *
 * The tight viewBox crops to the mark plus one stroke-width of clear space, so the element
 * fills its box instead of carrying the 512 canvas margins. Decorative by default; pass
 * `label` when it is the only thing naming the product. */
export function TracciaMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="88 158 344 204"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d="M110 180 H205 L285 228 H345" fill="none" stroke="#FF9E0B" strokeWidth={28} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M110 340 H205 L285 292 H410" fill="none" stroke="#06B6D4" strokeWidth={28} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
