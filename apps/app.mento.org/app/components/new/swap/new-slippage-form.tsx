"use client";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@repo/ui";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@repo/ui";
import { Input } from "@repo/ui";

const formSchema = z.object({
  slippage: z.string(),
});

export default function MyForm() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      console.log(values);
      toast(
        <pre className="bg-muted mt-2 w-[340px] rounded-md p-4">
          <code className="text-white">{JSON.stringify(values, null, 2)}</code>
        </pre>,
      );
    } catch (error) {
      console.error("Form submission error", error);
      toast.error("Failed to submit the form. Please try again.");
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mx-auto max-w-3xl space-y-8 py-10"
      >
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-9 flex flex-row items-center justify-between gap-4">
            <Button variant="outline">0.25%</Button>
            <Button variant="outline">0.5%</Button>
            <Button variant="outline">1%</Button>
          </div>

          <div className="col-span-3">
            <FormField
              control={form.control}
              name="slippage"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="Custom" className="h-8" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
        <Button clipped="lg" size="lg" className="w-full" type="submit">
          Confirm
        </Button>
      </form>
    </Form>
  );
}
