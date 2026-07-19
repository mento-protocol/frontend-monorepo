import { redirect } from "next/navigation";

// Fork trust-boundary canary: intentionally no runtime behavior change.
export default function Home() {
  redirect("/basic-components");
}
