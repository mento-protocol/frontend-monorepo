// Server Component (Next.js App Router default)
import { Suspense, lazy } from "react";
// import { WelcomeMessage } from "./components/server/WelcomeMessage";

// Dynamically import the client component container
const ClientComponents = lazy(() =>
  import("./components/client/ClientComponents").then((mod) => ({
    default: mod.ClientComponents,
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
        {/* <WelcomeMessage /> */}

        {/* Client-side interactive components with Suspense boundary */}
        <Suspense fallback={<LoadingFallback />}>
          <ClientComponents />
        </Suspense>
      </div>
    </main>
  );
}
