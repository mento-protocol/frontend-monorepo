export default function V3Layout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={
        "-mx-4 -my-8 bg-slate-50 p-4 text-slate-900 md:-mx-8 md:p-8" // V3 pages background & padding adjustments
      }
    >
      {children}
    </div>
  );
}
