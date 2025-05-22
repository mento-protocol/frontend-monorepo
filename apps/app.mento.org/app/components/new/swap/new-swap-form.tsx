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

export default function NewSwapForm() {
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
        <div className="bg-incard grid grid-cols-12 gap-4 p-4">
          <div className="col-span-6">
            <FormField
              control={form.control}
              name="name_1200955998"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Deposit</FormLabel>
                  <FormControl>
                    <CoinInput placeholder="0" type="" {...field} />
                  </FormControl>
                  <FormDescription>~$0</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-6 flex flex-row items-center justify-end">
            <FormField
              control={form.control}
              name="name_4940485782"
              render={({ field }) => (
                <FormItem className="flex flex-col items-end justify-end">
                  <CoinSelect
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <CoinSelectTrigger className="mt-[22px]">
                        <CoinSelectValue placeholder="CELO" />
                      </CoinSelectTrigger>
                    </FormControl>
                    <CoinSelectContent>
                      <CoinSelectItem value="m@example.com">
                        m@example.com
                      </CoinSelectItem>
                      <CoinSelectItem value="m@google.com">
                        m@google.com
                      </CoinSelectItem>
                      <CoinSelectItem value="m@support.com">
                        m@support.com
                      </CoinSelectItem>
                    </CoinSelectContent>
                  </CoinSelect>
                  <FormDescription>
                    Balance: 3,000.00 <span className="underline">MAX</span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="bg-incard grid grid-cols-12 gap-4 p-4">
          <div className="col-span-6">
            <FormField
              control={form.control}
              name="name_0824230468"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Receive</FormLabel>
                  <FormControl>
                    <CoinInput placeholder="0" type="" {...field} />
                  </FormControl>
                  <FormDescription>~$0</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-6 flex flex-row items-center justify-end">
            <FormField
              control={form.control}
              name="name_7702026821"
              render={({ field }) => (
                <FormItem className="flex flex-col items-end justify-end">
                  <CoinSelect
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <CoinSelectTrigger className="mt-[22px]">
                        <CoinSelectValue placeholder="cUSD" />
                      </CoinSelectTrigger>
                    </FormControl>
                    <CoinSelectContent>
                      <CoinSelectItem value="m@example.com">
                        m@example.com
                      </CoinSelectItem>
                      <CoinSelectItem value="m@google.com">
                        m@google.com
                      </CoinSelectItem>
                      <CoinSelectItem value="m@support.com">
                        m@support.com
                      </CoinSelectItem>
                    </CoinSelectContent>
                  </CoinSelect>
                  <FormDescription>
                    Balance: 1,000.00 <span className="underline">MAX</span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="flex w-full flex-col items-start justify-start space-y-2">
          <div className="flex w-full flex-row items-center justify-between">
            <span className="text-muted-foreground">Quote</span>
            <span>1 CELO = 0.35 cUSD</span>
          </div>

          <div className="flex w-full flex-row items-center justify-between">
            <span className="text-muted-foreground">Transaction cost</span>
            <span>$0.90</span>
          </div>
        </div>

        <Button clipped="lg" size="lg" className="w-full" type="submit">
          Submit
        </Button>
      </form>
    </Form>
  );
}
