import {
  QueryClient,
  HydrationBoundary,
  dehydrate,
} from "@tanstack/react-query";
import { ReserveTabs } from "./components/reserve-tabs";
import { TAB_ENDPOINTS, fetchV2, resolveTab, v2QueryKey } from "./lib/queries";

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const initialTab = resolveTab(params.tab);
  const eagerEndpoints = TAB_ENDPOINTS[initialTab];

  const queryClient = new QueryClient();
  await Promise.all(
    eagerEndpoints.map((endpoint) =>
      queryClient.prefetchQuery({
        queryKey: v2QueryKey(endpoint),
        queryFn: () => fetchV2(endpoint),
      }),
    ),
  );

  return (
    <section className="px-4 md:px-20 mt-8 md:mt-16 relative z-0 w-full">
      <HydrationBoundary state={dehydrate(queryClient)}>
        <ReserveTabs initialTab={initialTab} />
      </HydrationBoundary>
    </section>
  );
}
