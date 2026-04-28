"use client";

import { useQuery } from "@tanstack/react-query";
import {
  type V2Endpoint,
  type V2ResponseByEndpoint,
  fetchV2,
  v2QueryKey,
} from "./queries";

export function useV2Query<E extends V2Endpoint>(endpoint: E) {
  return useQuery<V2ResponseByEndpoint[E]>({
    queryKey: v2QueryKey(endpoint),
    queryFn: () => fetchV2(endpoint),
  });
}
