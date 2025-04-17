// Server Component (Next.js App Router default)
import { Suspense, lazy } from "react";
import { WelcomeMessage } from "./components/server/WelcomeMessage";
import { OptimizedImage } from "./components/shared/OptimizedImage";

// Dynamically import client components for code splitting
const ButtonGroup = lazy(() =>
  import("./components/client/ButtonGroup").then((mod) => ({
    default: mod.ButtonGroup,
  })),
);

// Loading fallback component
function LoadingFallback() {
  return <div className="p-4 text-center">Loading components...</div>;
}

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 md:p-24">
      <div className="z-10 w-full max-w-5xl items-center justify-center font-mono text-sm">
        {/* Server-rendered content */}
        <WelcomeMessage />

        <div className="rounded-lg bg-white p-8 shadow-lg">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <h2 className="mb-4 text-2xl font-semibold">
                Using UI Components
              </h2>

              {/* Client-side interactive components with Suspense boundary */}
              <Suspense fallback={<LoadingFallback />}>
                <ButtonGroup />
              </Suspense>
            </div>

            <div>
              <h2 className="mb-4 text-2xl font-semibold">Optimized Images</h2>
              <OptimizedImage
                src="/vercel.svg"
                alt="Vercel Logo"
                width={150}
                height={48}
                className="mx-auto"
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
