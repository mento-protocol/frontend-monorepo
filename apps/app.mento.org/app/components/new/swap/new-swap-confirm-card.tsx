"use client";
import { useState } from "react";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { cn } from "@repo/ui";

import { Button } from "@repo/ui";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@repo/ui";

import { CoinInput } from "@repo/ui";

import {
  CoinSelect,
  CoinSelectContent,
  CoinSelectItem,
  CoinSelectTrigger,
  CoinSelectValue,
} from "@repo/ui";

const formSchema = z.object({
  name_1200955998: z.string().min(1),
  name_4940485782: z.string(),
  name_2218626813: z.boolean(),
  name_0824230468: z.string().min(1),
  name_7702026821: z.string(),
});

export default function NewSwapConfirmCard() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      console.log(values);
      // toast(
      //   <pre className="mt-2 w-[340px] rounded-md bg-slate-950 p-4">
      //     <code className="text-white">{JSON.stringify(values, null, 2)}</code>
      //   </pre>,
      // );
    } catch (error) {
      console.error("Form submission error", error);
      // toast.error("Failed to submit the form. Please try again.");
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mx-auto max-w-3xl space-y-6"
      >
        <div className="grid grid-cols-[200px_auto_200px] items-center gap-0">
          <div className="bg-incard flex aspect-square h-52 flex-col items-center justify-center gap-2">
            <strong className="text-3xl">2,000.00</strong>
            <span className="text-muted-foreground">~$2.000</span>
          </div>
          <div></div>
          <div className="bg-incard flex aspect-square h-52 flex-col items-center justify-center gap-2">
            <strong className="text-3xl">700.00</strong>
            <span className="text-muted-foreground">~$700</span>
          </div>
        </div>

        <div className="flex w-full flex-col items-start justify-start space-y-2">
          <div className="flex w-full flex-row items-center justify-between">
            <span className="text-muted-foreground">Quote</span>
            <span>1 CELO = 0.35 cUSD</span>
          </div>

          <div className="flex w-full flex-row items-center justify-between">
            <span className="text-muted-foreground">Fee</span>
            <span>$0.90</span>
          </div>

          <div className="flex w-full flex-row items-center justify-between">
            <span className="text-muted-foreground">Gas Prize</span>
            <span>$5.90</span>
          </div>

          <div className="flex w-full flex-row items-center justify-between">
            <span className="text-muted-foreground">Slippage</span>
            <span>0.25%</span>
          </div>
        </div>

        <Button clipped="lg" size="lg" className="w-full" type="submit">
          Approve
        </Button>
      </form>
    </Form>
  );
}
