export function SectionLabel({ children }: { children: string }) {
  return (
    <div className="section-label">
      <span className="section-label__text">{children}</span>
    </div>
  );
}
