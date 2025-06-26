"use client";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CoinInput,
  Label,
  Datepicker,
} from "@repo/ui";
import { useRef, useState } from "react";
import { ProgressBar } from "./progress-bar";
import spacetime from "spacetime";

export default function VotingPowerForm() {
  const amountRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [unlockDate, setUnlockDate] = useState<Date | undefined>(
    spacetime.tomorrow().toNativeDate(),
  );

  return (
    <div className="flex flex-col gap-8 md:flex-row md:gap-20">
      <Card className="border-border md:max-w-1/2">
        <CardHeader className="text-2xl font-medium">Lock MENTO</CardHeader>
        <CardContent>
          <div
            className="bg-incard border-border dark:border-input maybe-hover:border-border-secondary focus-within:!border-primary dark:focus-within:!border-primary mb-8 flex grid-cols-12 flex-col gap-4 border p-4 transition-colors md:grid md:h-[120px]"
            onClick={() => {
              amountRef.current?.focus();
            }}
          >
            <div className="col-span-8 flex flex-col gap-2">
              <Label>MENTO to lock</Label>
              <CoinInput
                ref={amountRef}
                data-testid="sellAmountInput"
                placeholder="0"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                }}
              />
              <span className="text-muted-foreground">
                Max available: 4000,000 MENTO{" "}
              </span>
            </div>
            <div className="col-span-4 flex flex-row items-center md:justify-end">
              <Datepicker
                value={unlockDate}
                onChange={setUnlockDate}
                label="Lock until"
                formatter={(date) => {
                  return spacetime(date).format("dd.MM.yyyy");
                }}
              />
            </div>
          </div>
          <ProgressBar
            mode="time"
            data={{
              labels: {
                start: "1 week",
                middle: "13 months",
                end: "2 years",
              },
              currentValue: 13,
              maxValue: 24,
              valueLabel: "100,000 veMENTO",
            }}
          />
          <div className="my-8 flex justify-between text-sm">
            <span className="text-muted-foreground">You receive veMENTO</span>
            <span>100,000 veMENTO</span>
          </div>
        </CardContent>
        <CardFooter className="mt-auto">
          <Button className="h-12 w-full" clipped="lg">
            Lock MENTO
          </Button>
        </CardFooter>
      </Card>
      <Card className="border-border w-full md:h-[480px] md:min-w-[494px]">
        <CardHeader className="text-2xl font-medium">
          Your existing veMENTO lock
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">MENTO</span>
              <span>6000</span>
            </div>
            <hr className="border-border h-full" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">veMENTO</span>
              <span>6000</span>
            </div>
            <hr className="border-border h-full" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expires</span>
              <span>17.10.2027</span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="mt-auto flex flex-col gap-4">
          <Button className="h-12 w-full" clipped="default" variant="secondary">
            Withraw 1000 MENTO
          </Button>
          <Button className="h-12 w-full" clipped="default" variant="abstain">
            Extend lock
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
