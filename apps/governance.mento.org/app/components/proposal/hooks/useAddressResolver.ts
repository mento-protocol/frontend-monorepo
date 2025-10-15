"use client";
import { addressResolverService } from "../services/address-resolver-service";
import { useMemo } from "react";

export function useAllResolvedMappings(): Array<{
  name: string;
  address: string;
  friendlyName?: string;
  symbol?: string;
}> {
  return useMemo(() => {
    return addressResolverService.getAllLocalMappings();
  }, []);
}
