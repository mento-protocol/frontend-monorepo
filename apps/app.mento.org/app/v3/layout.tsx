export default function V3Layout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={
        "-mx-4 -my-8 p-4 text-slate-900 md:-mx-8 md:p-8 dark:text-slate-100" // V3 pages padding adjustments with theme-aware text
      }
    >
      {children}
    </div>
  );
}
