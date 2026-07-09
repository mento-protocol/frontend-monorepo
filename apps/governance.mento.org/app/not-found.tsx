import Link from "next/link";
import { Button } from "@repo/ui";

export default function NotFound() {
  return (
    <main className="gap-4 flex min-h-[60vh] flex-col items-center justify-center">
      <h1 className="text-2xl font-medium">Page not found</h1>
      <p>The page you are looking for does not exist.</p>
      <Button asChild>
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
